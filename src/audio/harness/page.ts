/**
 * Audio harness page (NOT shipped in the scene — the diner has no UI).
 *
 * Live: click Start, solo/mute each layer, fire the one-shots, drag the
 * listener around the plan, watch the meter.
 *
 * Offline: tools/audio-harness.mjs calls window.__renderOffline() which builds
 * the same graph on an OfflineAudioContext, taps every bus to its own channel
 * pair, renders N seconds and returns per-bus statistics plus the stereo mix as
 * 16-bit PCM.
 */
import { PerspectiveCamera, MathUtils } from "three";
import { ROOM, COUNTER, BACK_BAR, BOOTH, DOOR, WINDOW } from "../../scene/layout";
import { createDinerAudio, defaultPositions, type DinerAudio } from "../index";
import { gainToDb } from "../dsp";

/* ------------------------------------------------------------------ */
/* offline render                                                      */
/* ------------------------------------------------------------------ */

export interface OfflineRequest {
  seconds?: number;
  seed?: number;
  sampleRate?: number;
  listener?: { x: number; y: number; z: number; yawDeg: number };
  /** Also fire the one-shots at fixed times (pour 1 s, clink 5 s, door 6 s; outside opens over 1.5 s and holds). */
  sfx?: boolean;
  /** Bus names to keep; everything else is muted (the mix then contains only these). */
  solo?: string[];
  masterDb?: number;
}

export interface ChannelStats {
  name: string;
  rmsDb: number;
  peakDb: number;
  dc: number;
  clipped: number;
  /** Per-second RMS, dBFS. */
  perSecondDb: number[];
}

export interface OfflineResult {
  sampleRate: number;
  seconds: number;
  stats: ChannelStats[];
  /** Every discrete event the layers scheduled inside the render. */
  events: { name: string; t: number; dur: number }[];
  /** Stereo mix as interleaved 16-bit PCM, base64. */
  pcm16: string;
}

const BUS_ORDER = ["mix", "sum", "ac", "fan", "radio", "coffee", "room", "outside", "sfx-coffee", "sfx-door"];

async function renderOffline(req: OfflineRequest = {}): Promise<OfflineResult> {
  const seconds = req.seconds ?? 10;
  const sampleRate = req.sampleRate ?? 48000;
  const channels = BUS_ORDER.length * 2;
  const ctx = new OfflineAudioContext(channels, Math.floor(seconds * sampleRate), sampleRate);

  const audio = createDinerAudio({}, { context: ctx, seed: req.seed ?? 20260902, masterDb: req.masterDb });
  await audio.start();
  const engine = audio.engine!;

  const l = req.listener ?? { x: 0, y: 1.62, z: 0.9, yawDeg: 90 };
  const yaw = MathUtils.degToRad(l.yawDeg);
  engine.setListenerImmediate(
    { x: l.x, y: l.y, z: l.z },
    { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) },
    { x: 0, y: 1, z: 0 },
  );

  // Tap every bus (pre-compressor) to its own channel pair; the master already
  // lands on channels 0/1 through the destination's discrete up-mix.
  const merger = ctx.createChannelMerger(channels);
  const buses = new Map<string, GainNode>();
  buses.set("sum", engine.input);
  for (const layer of audio.layers) buses.set(layer.name, layer.bus);
  buses.set("outside", audio.door!.outsideBus);
  buses.set("sfx-coffee", audio.coffee!.bus);
  buses.set("sfx-door", audio.door!.bus);
  if (req.solo?.length) {
    for (const [name, bus] of buses) {
      if (name !== "sum" && !req.solo.includes(name)) bus.gain.value = 0;
    }
  }
  BUS_ORDER.forEach((name, i) => {
    if (name === "mix") return;
    const bus = buses.get(name);
    if (!bus) return;
    const split = ctx.createChannelSplitter(2);
    bus.connect(split);
    split.connect(merger, 0, i * 2);
    split.connect(merger, 1, i * 2 + 1);
  });
  merger.connect(ctx.destination);

  // Drive the schedulers every 250 ms of rendered time, and the SFX script.
  const step = 0.25;
  let fired = new Set<string>();
  const once = (key: string, fn: () => void): void => {
    if (fired.has(key)) return;
    fired.add(key);
    fn();
  };
  for (let t = step; t < seconds; t += step) {
    void ctx.suspend(t).then(() => {
      engine.tick();
      if (req.sfx) {
        const now = ctx.currentTime;
        if (now >= 1.0) once("pour", () => audio.sfx.pourCoffee(3));
        if (now >= 5.0) once("clink", () => audio.sfx.mugClink());
        if (now >= 6.0) {
          once("door", () => {
            audio.sfx.doorOpen();
            audio.sfx.setOutside(1, 1.5); // swings open over 1.5 s and stays open
          });
        }
      }
      void ctx.resume();
    });
  }
  fired = new Set();

  const buffer = await ctx.startRendering();
  const stats: ChannelStats[] = BUS_ORDER.map((name, i) => channelStats(name, buffer, i * 2));
  const pcm16 = encodePcm16(buffer.getChannelData(0), buffer.getChannelData(1));
  const events = engine.events.filter((e) => e.t < seconds).map((e) => ({ name: e.name, t: e.t, dur: e.dur }));
  return { sampleRate, seconds, stats, events, pcm16 };
}

function channelStats(name: string, buffer: AudioBuffer, first: number): ChannelStats {
  const L = buffer.getChannelData(first);
  const R = buffer.getChannelData(first + 1);
  const n = L.length;
  let sq = 0, peak = 0, sum = 0, clipped = 0;
  const perSecond: number[] = [];
  const sr = buffer.sampleRate;
  let secSq = 0, secN = 0;
  for (let i = 0; i < n; i++) {
    const a = L[i], b = R[i];
    sq += a * a + b * b;
    sum += a + b;
    const pa = Math.abs(a), pb = Math.abs(b);
    if (pa > peak) peak = pa;
    if (pb > peak) peak = pb;
    if (pa >= 0.999 || pb >= 0.999) clipped++;
    secSq += a * a + b * b;
    secN += 2;
    if ((i + 1) % sr === 0 || i === n - 1) {
      perSecond.push(gainToDb(Math.sqrt(secSq / secN)));
      secSq = 0;
      secN = 0;
    }
  }
  return {
    name,
    rmsDb: gainToDb(Math.sqrt(sq / (2 * n))),
    peakDb: gainToDb(peak),
    dc: sum / (2 * n),
    clipped,
    perSecondDb: perSecond,
  };
}

function encodePcm16(L: Float32Array, R: Float32Array): string {
  const n = L.length;
  const bytes = new Uint8Array(n * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), true);
    view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), true);
  }
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(out);
}

declare global {
  interface Window {
    __renderOffline?: (req?: OfflineRequest) => Promise<OfflineResult>;
    __HARNESS_READY?: boolean;
  }
}
window.__renderOffline = renderOffline;

/* ------------------------------------------------------------------ */
/* live page                                                           */
/* ------------------------------------------------------------------ */

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function livePage(): void {
  const audio: DinerAudio = createDinerAudio();
  const camera = new PerspectiveCamera(37, 16 / 9, 0.05, 100);
  const listener = { x: 0, z: 0.9, yaw: Math.PI / 2 };
  const meterCanvas = $("meter") as HTMLCanvasElement;
  const planCanvas = $("plan") as HTMLCanvasElement;
  const layerBox = $("layers");
  const status = $("status");
  let analyser: AnalyserNode | null = null;
  const busAnalysers: { name: string; an: AnalyserNode; el: HTMLElement }[] = [];
  let peakHold = 0;

  const placeCamera = (): void => {
    camera.position.set(listener.x, 1.62, listener.z);
    camera.rotation.set(0, listener.yaw, 0, "YXZ");
    camera.updateMatrixWorld();
  };
  placeCamera();

  const startBtn = $("start") as HTMLButtonElement;
  startBtn.addEventListener("click", async () => {
    if (audio.started) return;
    startBtn.disabled = true;
    await audio.start();
    const engine = audio.engine!;
    analyser = engine.ctx.createAnalyser();
    analyser.fftSize = 2048;
    engine.master.connect(analyser);
    status.textContent = `running · ${engine.ctx.sampleRate} Hz · ${audio.layers.length} layers`;

    const rows: { name: string; bus: GainNode; enable: (on: boolean) => void }[] = [
      ...audio.layers.map((l) => ({ name: l.name, bus: l.bus, enable: (on: boolean) => l.setEnabled(on) })),
      { name: "outside", bus: audio.door!.outsideBus, enable: (on) => audio.door!.outsideBus.gain.setTargetAtTime(on ? 1 : 0, engine.now, 0.03) },
      { name: "sfx-coffee", bus: audio.coffee!.bus, enable: (on) => audio.coffee!.bus.gain.setTargetAtTime(on ? 1 : 0, engine.now, 0.03) },
      { name: "sfx-door", bus: audio.door!.bus, enable: (on) => audio.door!.bus.gain.setTargetAtTime(on ? 1 : 0, engine.now, 0.03) },
    ];
    const checks: HTMLInputElement[] = [];
    for (const row of rows) {
      const line = document.createElement("label");
      line.className = "row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.addEventListener("change", () => row.enable(cb.checked));
      checks.push(cb);
      const solo = document.createElement("button");
      solo.textContent = "solo";
      solo.addEventListener("click", (e) => {
        e.preventDefault();
        rows.forEach((r, i) => {
          const on = r === row;
          checks[i].checked = on;
          r.enable(on);
        });
      });
      const name = document.createElement("span");
      name.textContent = row.name;
      const level = document.createElement("span");
      level.className = "lvl";
      level.textContent = "—";
      line.append(cb, solo, name, level);
      layerBox.append(line);
      const an = engine.ctx.createAnalyser();
      an.fftSize = 1024;
      row.bus.connect(an);
      busAnalysers.push({ name: row.name, an, el: level });
    }
    $("all").addEventListener("click", () => {
      rows.forEach((r, i) => {
        checks[i].checked = true;
        r.enable(true);
      });
    });
  });

  $("pour").addEventListener("click", () => audio.sfx.pourCoffee(3.5));
  $("clink").addEventListener("click", () => audio.sfx.mugClink());
  $("door").addEventListener("click", () => audio.sfx.doorOpen());
  const outside = $("outside") as HTMLInputElement;
  outside.addEventListener("input", () => audio.sfx.setOutside(Number(outside.value) / 100));
  const volume = $("volume") as HTMLInputElement;
  volume.addEventListener("input", () => audio.setMasterVolume(Number(volume.value) / 100));

  // Plan: click to place the listener, wheel or Q/E to turn.
  const plan = planCanvas.getContext("2d")!;
  const scale = planCanvas.width / (ROOM.halfX * 2 + 3);
  const toPx = (x: number, z: number): [number, number] => [
    planCanvas.width / 2 + x * scale,
    planCanvas.height / 2 - (z - (ROOM.zBack + ROOM.zFront) / 2) * scale,
  ];
  planCanvas.addEventListener("pointerdown", (e) => {
    const r = planCanvas.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * planCanvas.width;
    const py = ((e.clientY - r.top) / r.height) * planCanvas.height;
    listener.x = (px - planCanvas.width / 2) / scale;
    listener.z = (ROOM.zBack + ROOM.zFront) / 2 - (py - planCanvas.height / 2) / scale;
    placeCamera();
  });
  planCanvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    listener.yaw += e.deltaY > 0 ? -0.15 : 0.15;
    placeCamera();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyQ") listener.yaw += 0.15;
    if (e.code === "KeyE") listener.yaw -= 0.15;
    placeCamera();
  });

  const pos = defaultPositions();
  const drawPlan = (): void => {
    plan.fillStyle = "#1a1a1a";
    plan.fillRect(0, 0, planCanvas.width, planCanvas.height);
    plan.strokeStyle = "#777";
    plan.lineWidth = 2;
    const [x0, z0] = toPx(-ROOM.halfX, ROOM.zFront);
    const [x1, z1] = toPx(ROOM.halfX, ROOM.zBack);
    plan.strokeRect(x0, z0, x1 - x0, z1 - z0);
    plan.fillStyle = "#333";
    const [cx0, cz0] = toPx(COUNTER.xMin, COUNTER.topFrontZ);
    const [cx1, cz1] = toPx(COUNTER.xMax, COUNTER.topFrontZ - COUNTER.overhang - COUNTER.dieDepth);
    plan.fillRect(cx0, cz0, cx1 - cx0, cz1 - cz0);
    const [bx0, bz0] = toPx(BACK_BAR.xMin, BACK_BAR.zFront);
    const [bx1, bz1] = toPx(BACK_BAR.xMax, BACK_BAR.zFront - BACK_BAR.depth);
    plan.fillRect(bx0, bz0, bx1 - bx0, bz1 - bz0);
    for (const wx of WINDOW.centersX) {
      const [tx0, tz0] = toPx(wx - BOOTH.table.length / 2, BOOTH.zOuter);
      const [tx1, tz1] = toPx(wx + BOOTH.table.length / 2, BOOTH.zInner);
      plan.fillRect(tx0, tz0, tx1 - tx0, tz1 - tz0);
      plan.strokeStyle = "#8ab";
      plan.beginPath();
      plan.moveTo(...toPx(wx - WINDOW.width / 2, ROOM.zFront));
      plan.lineTo(...toPx(wx + WINDOW.width / 2, ROOM.zFront));
      plan.stroke();
    }
    plan.strokeStyle = "#c96";
    plan.beginPath();
    plan.moveTo(...toPx(DOOR.centerX - DOOR.width / 2, ROOM.zFront));
    plan.lineTo(...toPx(DOOR.centerX + DOOR.width / 2, ROOM.zFront));
    plan.stroke();
    const dot = (p: { x: number; z: number }, color: string, label: string): void => {
      const [px, pz] = toPx(p.x, p.z);
      plan.fillStyle = color;
      plan.beginPath();
      plan.arc(px, pz, 5, 0, Math.PI * 2);
      plan.fill();
      plan.fillStyle = "#ccc";
      plan.font = "11px system-ui";
      plan.fillText(label, px + 7, pz + 4);
    };
    dot(pos.radio, "#e9c46a", "radio");
    dot(pos.ac, "#4cc9f0", "AC");
    dot(pos.fan, "#b5e48c", "fan");
    dot(pos.coffeeWarmer, "#f4a261", "coffee");
    dot(pos.mug, "#f4a261", "mug");
    // Listener.
    const [lx, lz] = toPx(listener.x, listener.z);
    plan.fillStyle = "#fff";
    plan.beginPath();
    plan.arc(lx, lz, 6, 0, Math.PI * 2);
    plan.fill();
    plan.strokeStyle = "#fff";
    plan.beginPath();
    plan.moveTo(lx, lz);
    plan.lineTo(lx - Math.sin(listener.yaw) * 18, lz + Math.cos(listener.yaw) * 18);
    plan.stroke();
  };

  const meter = meterCanvas.getContext("2d")!;
  const buf = new Float32Array(2048);
  const small = new Float32Array(1024);
  const drawMeter = (): void => {
    const w = meterCanvas.width, h = meterCanvas.height;
    meter.fillStyle = "#111";
    meter.fillRect(0, 0, w, h);
    if (analyser) {
      analyser.getFloatTimeDomainData(buf);
      let sq = 0, pk = 0;
      for (let i = 0; i < buf.length; i++) {
        sq += buf[i] * buf[i];
        const a = Math.abs(buf[i]);
        if (a > pk) pk = a;
      }
      const rms = gainToDb(Math.sqrt(sq / buf.length));
      const peak = gainToDb(pk);
      peakHold = Math.max(peak, peakHold - 0.3);
      const px = (db: number): number => Math.max(0, Math.min(w, ((db + 72) / 72) * w));
      meter.fillStyle = "#2a9d8f";
      meter.fillRect(0, 8, px(rms), h - 16);
      meter.fillStyle = "#e9c46a";
      meter.fillRect(px(peak) - 2, 4, 3, h - 8);
      meter.fillStyle = "#e76f51";
      meter.fillRect(px(peakHold) - 1, 0, 2, h);
      meter.fillStyle = "#eee";
      meter.font = "13px ui-monospace, monospace";
      meter.fillText(`RMS ${rms.toFixed(1)} dBFS   peak ${peak.toFixed(1)}   hold ${peakHold.toFixed(1)}`, 8, h / 2 + 5);
      for (const db of [-60, -48, -36, -30, -24, -12, -6]) {
        meter.fillStyle = "#555";
        meter.fillRect(px(db), 0, 1, h);
        meter.fillStyle = "#888";
        meter.fillText(`${db}`, px(db) + 3, 12);
      }
      for (const b of busAnalysers) {
        b.an.getFloatTimeDomainData(small);
        let s = 0;
        for (let i = 0; i < small.length; i++) s += small[i] * small[i];
        b.el.textContent = `${gainToDb(Math.sqrt(s / small.length)).toFixed(1)} dB`;
      }
    } else {
      meter.fillStyle = "#666";
      meter.font = "13px ui-monospace, monospace";
      meter.fillText("click Start", 8, h / 2 + 5);
    }
  };

  const frame = (): void => {
    audio.update(camera);
    drawPlan();
    drawMeter();
    requestAnimationFrame(frame);
  };
  frame();
}

if (!new URLSearchParams(location.search).has("offline") && document.getElementById("start")) livePage();
window.__HARNESS_READY = true;
