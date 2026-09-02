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
import { easeIn, easeInOutSine, easeOutBack } from "../../interactions/util";
import { createDinerAudio, defaultPositions, type DinerAudio } from "../index";
import { gainToDb } from "../dsp";
import { POUR_POINTS, wiredPositions } from "../wiring";

/* ------------------------------------------------------------------ */
/* offline render                                                      */
/* ------------------------------------------------------------------ */

export interface OfflineRequest {
  seconds?: number;
  seed?: number;
  sampleRate?: number;
  /** yaw 0 looks toward −z, positive turns left (toward −x); pitch positive looks up. Degrees. */
  listener?: { x: number; y: number; z: number; yawDeg: number; pitchDeg?: number };
  /** Also fire the one-shots at fixed times (pour 1 s, clink 5 s, door 6 s; outside opens in 0.7 s and holds). */
  sfx?: boolean;
  /**
   * System 7 timelines, exactly as `src/interactions/Pour.ts` / `DoorSwing.ts` drive the audio:
   *   "pour"  t0: clink at the decanter rest → t0+1.3 s pourCoffee(2.5, mugTop) → t0+5.3 s clink at rest
   *   "door"  t0: doorOpen(); setOutside(deg/85) every `tickHz` frame along the 7.15 s swing/hold/close/latch
   * `t0` defaults to 1 s.
   */
  scenario?: "pour" | "door" | "sys9";
  t0?: number;
  /** Scheduler / per-frame call rate for the scenario (default 50 Hz; the game runs 60–120). */
  tickHz?: number;
  /** Bus names to keep; everything else is muted (the mix then contains only these). */
  solo?: string[];
  masterDb?: number;
  /** Bus names whose stereo PCM (pre-compressor tap) is returned as well as the mix. */
  taps?: string[];
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
  /** Requested bus taps (pre-compressor), same encoding. */
  taps: Record<string, string>;
  /** Scenario timeline (context seconds) for the analysis: when each call was made. */
  timeline: { name: string; t: number }[];
  /** Emitter positions the graph was built with (the scene's `wiredPositions()` over the defaults). */
  positions: Record<string, unknown>;
}

const BUS_ORDER = ["mix", "sum", "interior", "ac", "fan", "radio", "coffee", "room", "kitchen", "outside", "sfx-coffee", "sfx-door", "sfx-player", "sfx-openables"];

/**
 * DoorSwing.ts's leaf angle for `t` seconds into the cycle (kept in step with `TL` /
 * `OPEN_DEG` / `SWEEP_TO_DEG` there): ease-out-back to 85° over 1.1 s, hold to 5.1 s,
 * sine sweep to 8° by 6.9 s, cubic latch to 0° at 7.15 s.
 */
export const DOOR_TL = { open: [0, 1.1], hold: [1.1, 5.1], sweep: [5.1, 6.9], latch: [6.9, 7.15], end: 7.15, openDeg: 85, sweepToDeg: 8 } as const;
export function doorLeafDeg(t: number): number {
  const ph = (a: number, b: number): number => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const { open, hold, sweep, latch, openDeg, sweepToDeg } = DOOR_TL;
  if (t < 0 || t >= DOOR_TL.end) return 0;
  if (t < open[1]) return openDeg * easeOutBack(ph(open[0], open[1]), 0.6);
  if (t < hold[1]) return openDeg;
  if (t < sweep[1]) return openDeg - (openDeg - sweepToDeg) * easeInOutSine(ph(sweep[0], sweep[1]));
  if (t < latch[1]) return sweepToDeg * (1 - easeIn(ph(latch[0], latch[1])));
  return 0;
}

/** Pour.ts timeline: clink at start, stream from 1.3 s for 2.5 s, clink when the decanter is back at 5.3 s. */
export const POUR_TL = { clinkA: 0, stream: [1.3, 3.8], clinkB: 5.3, fill: [1.42, 3.75] } as const;

async function renderOffline(req: OfflineRequest = {}): Promise<OfflineResult> {
  const seconds = req.seconds ?? 10;
  const sampleRate = req.sampleRate ?? 48000;
  const channels = BUS_ORDER.length * 2;
  const ctx = new OfflineAudioContext(channels, Math.floor(seconds * sampleRate), sampleRate);

  // The scene's graph: `wireDinerAudio()` = createDinerAudio(wiredPositions()).
  const positions = wiredPositions();
  const audio = createDinerAudio(positions, { context: ctx, seed: req.seed ?? 20260902, masterDb: req.masterDb });
  await audio.start();
  const engine = audio.engine!;

  const l = req.listener ?? { x: 0, y: 1.62, z: 0.9, yawDeg: 90 };
  const yaw = MathUtils.degToRad(l.yawDeg);
  const pitch = MathUtils.degToRad(l.pitchDeg ?? 0);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  engine.setListenerImmediate(
    { x: l.x, y: l.y, z: l.z },
    { x: -Math.sin(yaw) * cp, y: sp, z: -Math.cos(yaw) * cp },
    { x: Math.sin(yaw) * sp, y: cp, z: Math.cos(yaw) * sp },
  );

  // Tap every bus (pre-compressor) to its own channel pair; the master already
  // lands on channels 0/1 through the destination's discrete up-mix.
  const merger = ctx.createChannelMerger(channels);
  const buses = new Map<string, GainNode>();
  buses.set("sum", engine.input);
  buses.set("interior", engine.interior);
  for (const layer of audio.layers) buses.set(layer.name, layer.bus);
  buses.set("outside", audio.door!.outsideBus);
  buses.set("sfx-coffee", audio.coffee!.bus);
  buses.set("sfx-door", audio.door!.bus);
  if (audio.playerSfx) buses.set("sfx-player", audio.playerSfx.bus);
  if (audio.openablesSfx) buses.set("sfx-openables", audio.openablesSfx.bus);
  if (req.solo?.length) {
    for (const [name, bus] of buses) {
      if (name !== "sum" && name !== "interior" && !req.solo.includes(name)) bus.gain.value = 0;
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
  const t0 = req.t0 ?? 1.0;
  const timeline: { name: string; t: number }[] = [];
  const call = (name: string, fn: () => void): void => {
    timeline.push({ name, t: ctx.currentTime });
    fn();
  };
  let fired = new Set<string>();
  const once = (key: string, fn: () => void): void => {
    if (fired.has(key)) return;
    fired.add(key);
    call(key, fn);
  };
  // Suspend points: coarse 250 ms ticks for the schedulers, plus the scenario's own frame rate
  // while it runs (setOutside is a per-frame call in the game).
  const times = new Set<number>();
  const tickStep = 0.25;
  for (let t = tickStep; t < seconds; t += tickStep) times.add(Math.round(t * 1000) / 1000);
  let lastTick = 0;
  if (req.scenario) {
    const frame = 1 / (req.tickHz ?? 50);
    const span = req.scenario === "door" ? DOOR_TL.end + 0.5 : req.scenario === "sys9" ? 8 : POUR_TL.clinkB + 0.5;
    for (let t = t0; t <= Math.min(seconds - frame, t0 + span); t += frame) times.add(Math.round(t * 1000) / 1000);
  }
  for (const t of [...times].sort((a, b) => a - b)) {
    void ctx.suspend(t).then(() => {
      const now = ctx.currentTime;
      if (now - lastTick >= tickStep - 1e-6) {
        engine.tick();
        lastTick = now;
      }
      if (req.sfx) {
        if (now >= 1.0) once("pour", () => audio.sfx.pourCoffee(3));
        if (now >= 5.0) once("clink", () => audio.sfx.mugClink());
        if (now >= 6.0) {
          once("door", () => {
            audio.sfx.doorOpen();
            audio.sfx.setOutside(1, 0.7); // swings open in 0.7 s and stays open
          });
        }
      }
      if (req.scenario === "pour") {
        const u = now - t0;
        if (u >= POUR_TL.clinkA) once("clink-lift", () => audio.sfx.mugClink(POUR_POINTS.potRest));
        if (u >= POUR_TL.stream[0]) once("pour", () => audio.sfx.pourCoffee(POUR_TL.stream[1] - POUR_TL.stream[0], POUR_POINTS.mugTop));
        if (u >= POUR_TL.clinkB) once("clink-set", () => audio.sfx.mugClink(POUR_POINTS.potRest));
      } else if (req.scenario === "door") {
        const u = now - t0;
        if (u >= 0) {
          once("door-open", () => audio.sfx.doorOpen());
          // DoorSwing.apply(): setOutside(deg / 85) whenever the progress changed, every frame.
          const p = Math.min(1, Math.max(0, doorLeafDeg(u) / DOOR_TL.openDeg));
          audio.sfx.setOutside(p);
          if (u >= DOOR_TL.end) once("door-latched", () => audio.sfx.setOutside(0));
        }
      } else if (req.scenario === "sys9") {
        // System 9 one-shots in order: footfall, sip, cabinet release / stop / close, kitchen door.
        const u = now - t0;
        const cab = { x: -2.6, y: 0.5, z: -0.15 };
        const kd = { x: -5.15, y: 1.1, z: -2.6 };
        if (u >= 0) once("footfall", () => audio.sfx.footfall(1));
        if (u >= 1) once("sip", () => audio.sfx.sip());
        if (u >= 2.5) once("cab-release", () => audio.sfx.cabinetCatch(cab, "release"));
        if (u >= 3.2) once("cab-stop", () => audio.sfx.cabinetStop(cab));
        if (u >= 4.2) once("cab-close", () => audio.sfx.cabinetCatch(cab, "close"));
        if (u >= 5.5) once("kd-push", () => audio.sfx.kitchenDoorPush(kd));
        if (u >= 5.9) once("kd-pass", () => audio.sfx.kitchenDoorPass(kd, 1));
        if (u >= 6.8) once("kd-pass2", () => audio.sfx.kitchenDoorPass(kd, 0.5));
        if (u >= 7.6) once("kd-settle", () => audio.sfx.kitchenDoorSettle(kd));
      }
      void ctx.resume();
    });
  }
  fired = new Set();

  const buffer = await ctx.startRendering();
  const stats: ChannelStats[] = BUS_ORDER.map((name, i) => channelStats(name, buffer, i * 2));
  const pcm16 = encodePcm16(buffer.getChannelData(0), buffer.getChannelData(1));
  const taps: Record<string, string> = {};
  for (const name of req.taps ?? []) {
    const i = BUS_ORDER.indexOf(name);
    if (i > 0) taps[name] = encodePcm16(buffer.getChannelData(i * 2), buffer.getChannelData(i * 2 + 1));
  }
  const events = engine.events.filter((e) => e.t < seconds).map((e) => ({ name: e.name, t: e.t, dur: e.dur }));
  return { sampleRate, seconds, stats, events, pcm16, taps, timeline, positions: { ...defaultPositions(), ...positions } };
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
    __HARNESS_LAYOUT?: Record<string, unknown>;
    __HARNESS_READY?: boolean;
  }
}
window.__renderOffline = renderOffline;
// Floor plan + emitter positions for tools/audio-harness.mjs (it builds its listener poses from these).
window.__HARNESS_LAYOUT = {
  room: ROOM,
  door: DOOR,
  window: WINDOW,
  booth: BOOTH,
  counter: COUNTER,
  backBar: BACK_BAR,
  positions: { ...defaultPositions(), ...wiredPositions() },
  pour: POUR_POINTS,
  // Sit.ts: eye 1.15 m, 0.6 m from the booth centre, turned 35° to the window, −9° pitch.
  seated: { eye: 1.15, fromCentre: 0.6, turnDeg: 35, pitchDeg: -9 },
  doorTimeline: DOOR_TL,
  pourTimeline: POUR_TL,
};

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
