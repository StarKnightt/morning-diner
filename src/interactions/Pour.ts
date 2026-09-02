/**
 * Pouring coffee at the brewer. Press E beside the `pourMug`: the decanter
 * (`coffeePot`) is lifted off the warmer, carried over the mug on an arc while
 * the wrist already starts to tilt it, tips until the coffee reaches the spout,
 * pours for ≈ 2.6 s, snaps back upright (cutting the stream, two drips), and
 * returns to the plate. Hand-less; 5.95 s from the E press.
 *
 * Timeline (seconds from E) — see TL:
 *   reach     0 → 0.25   nothing moves; the hint has time to fade. Clink as the glass leaves the plate
 *   lift      0.25 → 0.75 off the plate (fast) and out from under the brew head
 *   carry     0.75 → 1.50 quadratic-Bézier arc of the spout lip to 4 cm above the pour point; yaw turns
 *                        the spout to the mug; from 55 % of the carry the tilt starts (70 % of the lip angle)
 *   tilt-on   1.50 → 1.78 lip settles onto the pour point while the tilt completes: the coffee meets the lip
 *   stream    1.78 → 4.35 flow ramps in over 0.35 s (a thread that thickens), holds, dies over the last
 *                        0.4 s. The pot over-tilts up to 6° beyond the lip angle in proportion to the flow
 *                        (that is what controls a pour), dips 1.5 cm toward the mug as it fills, and its
 *                        own level drops 9 mm so the lip angle creeps up during the pour
 *   tilt-off  4.33 → 4.68 quick wrist snap upright (ease-out) — the tail detaches and falls at g;
 *                        two drips leave the lip at 4.50 and 4.75
 *   carry back / lower   arc back, set down decelerating (no slam); clink on the plate at 5.95
 *
 *   stream   tapered cylinder from the lip; radius ∝ sqrt(flow) × (v0 / v(d))^½ (continuity: a
 *            falling stream thins), a faint travelling ripple, and as the flow dies a Rayleigh–
 *            Plateau bead-up that pinches the thread into drops; parabola from the lip speed
 *   mug      a meniscus disc whose height is the volume actually landed so far (flow integrated
 *            with the fall delay, through the mug's inner-radius profile — the narrow foot fills
 *            fast, the flared rim slowly); ripples while the stream lands
 *   decanter Props' fixed 55 % coffee body is hidden from boot and replaced by a taller body cut by
 *            a world-horizontal clipping plane; back faces are shaded as the surface. Level drops
 *            9 mm and stays
 *   steam    `SteamEmitter` (src/post/Steam.ts — the same emitter as the decanter's ambient wisp)
 *            at the rim: strength, rise and size build over 1.5 s from the first splash, hold,
 *            then fade 18 → 30 s after
 *
 * One pour fills the mug; E again gives a 4 mm bob (and a clink), no refill.
 * Everything runs off one internal clock so `seek(t)` is deterministic.
 */
import * as THREE from "three";
import { CoffeeSfx } from "../audio/sfx/Coffee";
import type { Palette } from "../core/materials";
import { SteamEmitter } from "../post/Steam";
import { clamp01, easeInOut, easeOut, lerp, phase, type Interactable } from "./util";

const MUG_H = 0.089;
const MUG_FLOOR = 0.013;
const MUG_FULL = 0.075;
/** Mug inner wall (y, r) from Props.ts, floor to rim. */
const MUG_INNER: ReadonlyArray<readonly [number, number]> = [
  [0.013, 0.026], [0.016, 0.03], [0.03, 0.032], [0.05, 0.0315], [0.072, 0.0325], [0.084, 0.0335],
];
const MUG_LATHE_R = 0.032;

const POT_R = 0.0865;
const POT_H = 0.178;
const POT_LEVEL0 = 0.098;
const POT_DROP = 0.009;
const POT_YAW0 = -0.4;
/** Spout lip in decanter space: on the −x side (the handle is +x), at the rim. */
const LIP_LOCAL = new THREE.Vector3(-0.061, POT_H, 0);
const LIP_R = 0.061;
/** Tilt beyond the lip angle at full flow (what the wrist does to control a pour). */
const OVER_TILT = THREE.MathUtils.degToRad(6);
/** How far the pourer lowers the pot toward the mug over the pour (less splash as it fills). */
const POUR_DIP = 0.015;

const STREAM_R = 0.0028;
/** Speed of the coffee as it leaves the lip, m/s (sets the parabola and the thinning). */
const LIP_SPEED = 0.3;
const G = 9.81;

/** Timeline, seconds from the E press. */
const TL = {
  reach: [0, 0.25],
  lift: [0.25, 0.75],
  carry: [0.75, 1.5],
  tiltOn: [1.5, 1.78],
  stream: [1.78, 4.35],
  flowUp: 0.35,
  flowDown: 0.4,
  tiltOff: [4.33, 4.68],
  carryBack: [4.72, 5.45],
  lower: [5.45, 5.95],
  end: 5.95,
} as const;
/** Drips leave the lip at these times (seconds from E). */
const DRIPS = [4.5, 4.75] as const;
const DRIP_R = 0.0032;
export const POUR_STREAM_START = TL.stream[0];
export const POUR_END = TL.end;

const BOB_DURATION = 0.22;

export interface PourAudio {
  clink(at: THREE.Vector3): void;
  /**
   * Coffee landing in the mug for `seconds`. Called `CoffeeSfx.LANDING_S` before the stream's
   * leading edge hits the surface: System 6's `pourCoffee()` models the fall and starts the splash
   * that much after the call, so the sound lands with the liquid.
   */
  pour(seconds: number, at: THREE.Vector3): void;
}

type State = "idle" | "pouring" | "full";

/** Flow rate 0..1 at pour-time t: linear ramp in, hold, linear ramp out. */
function flowAt(t: number): number {
  const [a, b] = TL.stream;
  if (t <= a || t >= b) return 0;
  return Math.min(1, (t - a) / TL.flowUp, (b - t) / TL.flowDown);
}

/** Steam at the mug rim: the shared `SteamEmitter`, driven off the pour clock so seeks are exact. */
class MugSteam {
  readonly emitter: SteamEmitter;
  /** Seconds since the first splash, or −1 when off. */
  private started = -1;
  private time = 0;

  constructor(scene: THREE.Scene, rim: THREE.Vector3) {
    this.emitter = new SteamEmitter({
      count: 24,
      radius: 0.022,
      rise: 0.28,
      life: 2.6,
      size: [0.022, 0.075],
      spread: 0.035,
      curl: 2.6,
      strength: 0,
      wind: [0.008, -0.003],
    });
    this.emitter.object.name = "pour:steam";
    this.emitter.object.position.copy(rim);
    scene.add(this.emitter.object);
    this.emitter.update(0);
  }

  start(): void {
    this.started = 0;
  }

  stop(): void {
    this.started = -1;
    this.emitter.strength = 0;
    this.emitter.update(this.time);
  }

  /** Jump to `seconds` after the first splash (deterministic captures). */
  seek(seconds: number): void {
    if (seconds < 0) {
      this.stop();
      return;
    }
    this.started = seconds;
    this.time = seconds;
    this.update(0);
  }

  update(dt: number): void {
    if (this.started < 0) return;
    this.started += dt;
    this.time += dt;
    const s = this.started;
    // Build: a fresh pour steams more each second as the mug's surface heats — strength, plume
    // height and puff size all grow over 1.5 s; then hold; fade 18 → 30 s.
    const build = 1 - Math.pow(1 - clamp01(s / 1.5), 2);
    const fade = 1 - THREE.MathUtils.smoothstep(s, 18, 30);
    const p = this.emitter.params;
    p.strength = 1.3 * build * fade;
    p.rise = lerp(0.06, 0.28, build);
    p.size[0] = lerp(0.012, 0.022, build);
    p.size[1] = lerp(0.03, 0.075, build);
    this.emitter.update(this.time);
    if (s > 30) this.stop();
  }
}

export class PourInteraction {
  readonly interactable: Interactable;
  state: State = "idle";
  private t = 0;
  private bobT = -1;
  private potLevel = POT_LEVEL0;
  private moved = false;

  private readonly pot: THREE.Group;
  private readonly mug: THREE.Mesh;
  private readonly potRest = new THREE.Vector3();
  private readonly potRestQ = new THREE.Quaternion();
  private readonly mugRestY: number;
  private readonly mugTop = new THREE.Vector3();

  private readonly potCoffeeOriginal: THREE.Mesh;
  private readonly potCoffee: THREE.Mesh;
  private readonly clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly mugLiquid: THREE.Mesh;
  private readonly stream: THREE.Mesh;
  private readonly drips: THREE.Mesh[] = [];
  private readonly steam: MugSteam;
  private readonly uniforms = {
    uTime: { value: 0 },
    uLen: { value: 0.1 },
    uRad: { value: STREAM_R },
    uDir: { value: new THREE.Vector2(0, -1) },
    uRipple: { value: 0 },
    uBreak: { value: 0 },
  };

  // Lip keyframes (world)
  private readonly L0 = new THREE.Vector3();
  private readonly LA = new THREE.Vector3();
  private readonly L1 = new THREE.Vector3();
  /** Arrival point: 4 cm above the pour point (the carry arc lands here, the tilt-on settles down). */
  private readonly L1H = new THREE.Vector3();
  /** Back-off point after the wrist snap: half-way up to L1H, less half the pour dip; the return arc starts here. */
  private readonly L1B = new THREE.Vector3();
  /** Bézier control for the carry arc. */
  private readonly LC = new THREE.Vector3();
  private readonly yaw1: number;

  /** Fill LUT: landed-volume fraction → liquid height, and the pour-time → volume fraction integral. */
  private readonly fillLut: Float32Array;
  private readonly fallDelay: number;

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpV3 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  private readonly focusPoint = new THREE.Vector3();
  private readonly pose = { L: new THREE.Vector3(), yaw: 0, tilt: 0 };

  constructor(
    scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
    pal: Palette,
    pot: THREE.Group,
    mug: THREE.Mesh,
    private readonly audio: PourAudio,
  ) {
    this.pot = pot;
    this.mug = mug;
    this.potRest.copy(pot.position);
    this.potRestQ.copy(pot.quaternion);
    this.mugRestY = mug.position.y;
    this.mugTop.set(mug.position.x, mug.position.y + MUG_H, mug.position.z);
    this.focusPoint.set(mug.position.x, mug.position.y + 0.06, mug.position.z);

    // Lip path. Rest → up off the plate and out from under the brew head (+z) → arc → 4 cm over the
    // pour point → down onto it.
    this.L0.copy(LIP_LOCAL).applyQuaternion(this.potRestQ).add(this.potRest);
    this.LA.copy(this.L0).add(this.tmpV.set(0, 0.06, 0.28));
    this.L1.set(this.mugTop.x, this.mugTop.y + 0.06, this.mugTop.z + 0.012);
    this.L1H.copy(this.L1).add(this.tmpV.set(0, 0.04, 0));
    this.L1B.copy(this.L1).add(this.tmpV.set(0, 0.02 - POUR_DIP / 2, 0));
    this.LC.addVectors(this.LA, this.L1H).multiplyScalar(0.5).add(this.tmpV.set(0, 0.12, 0));
    // Spout must point at the mug (−z): RotY(ψ)·(−1,0,0) = (−cos ψ, 0, sin ψ) = (0, 0, −1).
    this.yaw1 = -Math.PI / 2;
    // Leading edge falls from 2 mm under the lip to the empty mug's floor.
    this.fallDelay = Math.sqrt((2 * (this.L1.y - 0.002 - (mug.position.y + MUG_FLOOR))) / G);

    // ∫flow dt over the stream, normalised: pour-time → fraction of the total volume landed.
    const N = 256;
    this.fillLut = new Float32Array(N + 1);
    let acc = 0;
    const [sa, sb] = TL.stream;
    for (let i = 1; i <= N; i++) {
      const ta = sa + ((i - 1) / N) * (sb - sa), tb = sa + (i / N) * (sb - sa);
      acc += ((flowAt(ta) + flowAt(tb)) / 2) * ((sb - sa) / N);
      this.fillLut[i] = acc;
    }
    for (let i = 0; i <= N; i++) this.fillLut[i] /= acc;

    renderer.localClippingEnabled = true;

    /* ---- decanter liquid: tall body + world clipping plane + flat-cap back faces ---- */
    this.potCoffeeOriginal = pot.getObjectByName("coffeePot:coffee") as THREE.Mesh;
    const V2 = (x: number, y: number) => new THREE.Vector2(x, y);
    const s = 0.0003; // sit 0.3 mm inside the glass
    const tall = new THREE.LatheGeometry(
      [
        V2(0, 0.0035), V2(0.045 - s, 0.0035), V2(0.064 - s, 0.0085), V2(0.0765 - s, 0.02), V2(POT_R - 0.0045 - s, 0.045),
        V2(POT_R - 0.0025 - s, 0.08), V2(POT_R - 0.0055 - s, 0.11), V2(0.0715 - s, 0.14), V2(0.0615 - s, 0.158), V2(0.0575 - s, 0.168), V2(0, 0.168),
      ],
      64,
    );
    const potMat = pal.coffee.clone();
    potMat.side = THREE.DoubleSide;
    potMat.clippingPlanes = [this.clipPlane];
    potMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        // Back faces are the far inner wall seen through the cut: shade them as the horizontal surface.
        if (!gl_FrontFacing) { normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz); nonPerturbedNormal = normal; }`,
      );
    };
    potMat.customProgramCacheKey = () => "coffee-flatcap";
    this.potCoffee = new THREE.Mesh(tall, potMat);
    this.potCoffee.name = "coffeePot:coffee-live";
    this.potCoffee.castShadow = this.potCoffee.receiveShadow = true;
    pot.add(this.potCoffee);
    // The live body replaces Props' fixed 55 % body from boot on (at rest they look the same).
    // Reason: `renderer.compile()` links materials without their clipping planes, so the
    // numClippingPlanes=1 variant of this material only exists once it has actually been drawn —
    // a 0.7 s synchronous HLSL link on the first E at the mug when it was swapped in lazily.
    // Drawing it in the loader's first frame moves that link into load time; `frustumCulled =
    // false` because the boot camera does not look at the decanter (one 64-segment lathe, free).
    this.potCoffee.frustumCulled = false;
    this.potCoffeeOriginal.visible = false;
    this.setPotSurface(0);
    // Likewise the shadow maps: they rendered once inside Diner.build(), before this body existed,
    // so its clipped depth-pass variant would also link on the first pour. Flag a move now and the
    // first frame re-renders the maps (index.ts → diner.invalidateShadows()) with it in place.
    this.moved = true;

    /* ---- mug liquid: meniscus disc, scaled to the inner radius at its height ---- */
    // Profile runs from the wall inward so the lathe's normals face UP (a lathe's normal is the
    // profile direction turned −90°: an outward-running profile would face down and be culled).
    const disc = new THREE.LatheGeometry(
      [V2(MUG_LATHE_R + 0.0007, 0.0022), V2(MUG_LATHE_R - 0.0008, 0.001), V2(MUG_LATHE_R - 0.0025, 0.0003), V2(MUG_LATHE_R - 0.006, 0), V2(0, 0)],
      48,
    );
    const mugMat = pal.coffee.clone();
    mugMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uRipple = this.uniforms.uRipple;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uRipple;")
        .replace(
          "#include <beginnormal_vertex>",
          `#include <beginnormal_vertex>
          float rr = length(position.xz);
          float ph = rr * 620.0 - uTime * 22.0;
          float amp = uRipple * 0.0006 * (1.0 - smoothstep(0.02, 0.031, rr));
          vec2 rdir = rr > 1e-5 ? position.xz / rr : vec2(0.0);
          objectNormal.xz -= rdir * cos(ph) * amp * 620.0 * 0.6;
          objectNormal = normalize(objectNormal);`,
        )
        .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed.y += sin(ph) * amp;");
    };
    mugMat.customProgramCacheKey = () => "coffee-ripple";
    this.mugLiquid = new THREE.Mesh(disc, mugMat);
    this.mugLiquid.name = "pourMug:coffee";
    this.mugLiquid.visible = false;
    this.mugLiquid.receiveShadow = true;
    mug.add(this.mugLiquid);

    /* ---- stream ---- */
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 32, true);
    cyl.translate(0, -0.5, 0); // y ∈ [−1, 0]: top at the lip
    const streamMat = pal.coffee.clone();
    streamMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uLen = this.uniforms.uLen;
      shader.uniforms.uRad = this.uniforms.uRad;
      shader.uniforms.uDir = this.uniforms.uDir;
      shader.uniforms.uBreak = this.uniforms.uBreak;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uTime; uniform float uLen; uniform float uRad; uniform vec2 uDir; uniform float uBreak;",
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            float s = clamp(-transformed.y, 0.0, 1.0);   // 0 at the lip, 1 at the surface
            float d = s * uLen;                            // metres fallen
            // Continuity: the stream speeds up as it falls and thins as sqrt(v0 / v).
            float v0 = ${LIP_SPEED.toFixed(3)};
            float v = sqrt(v0 * v0 + 2.0 * 9.81 * d);
            float taper = sqrt(v0 / v);
            // Faint travelling ripple on the surface of the stream.
            taper *= 1.0 + 0.06 * sin(d * 110.0 - uTime * 36.0);
            // Rayleigh-Plateau bead-up as the flow dies: the thread pinches into drops along its length.
            float bead = 0.5 + 0.5 * sin(d * 520.0 - uTime * 48.0 + s * 3.0);
            taper *= 1.0 - uBreak * (0.55 + 0.45 * smoothstep(0.2, 1.0, s)) * bead;
            transformed.xz *= taper;
            // Wobble (metres → local units) growing with the fall.
            vec2 wob = vec2(sin(d * 23.0 + uTime * 9.0), cos(d * 19.0 - uTime * 7.3)) * 0.0011 * s;
            // Parabola: the liquid leaves the lip with a little horizontal speed toward the mug.
            float tf = sqrt(2.0 * max(d, 0.0) / 9.81);
            transformed.xz += (wob + uDir * v0 * tf) / uRad;
          }`,
        );
    };
    streamMat.customProgramCacheKey = () => "coffee-stream";
    this.stream = new THREE.Mesh(cyl, streamMat);
    this.stream.name = "pour:stream";
    this.stream.castShadow = true;
    this.stream.visible = false;
    this.stream.frustumCulled = false;
    scene.add(this.stream);

    /* ---- drips: two small elongated drops that leave the lip after the stream cuts ---- */
    const dripGeo = new THREE.SphereGeometry(DRIP_R, 12, 10);
    dripGeo.scale(1, 1.35, 1);
    for (let i = 0; i < DRIPS.length; i++) {
      const d = new THREE.Mesh(dripGeo, pal.coffee);
      d.name = `pour:drip${i}`;
      d.visible = false;
      d.castShadow = false;
      d.frustumCulled = false;
      scene.add(d);
      this.drips.push(d);
    }

    this.steam = new MugSteam(scene, this.tmpV.set(this.mugTop.x, this.mugTop.y - 0.004, this.mugTop.z));

    this.interactable = {
      name: "pour",
      label: () => "Pour coffee",
      focus: (out) => out.copy(this.focusPoint),
      reach: 1.25,
      halfAngleDeg: 22,
      available: () => this.state !== "pouring",
      interact: () => (this.state === "idle" ? this.start() : this.bob()),
    };
  }

  /**
   * True once if the decanter, the mug or the stream moved since the last call. index.ts
   * polls this every frame and calls `diner.invalidateShadows()` — the shadow maps are
   * rendered once at boot, so a lifted decanter would otherwise leave its shadow on the warmer.
   */
  consumeMoved(): boolean {
    const m = this.moved;
    this.moved = false;
    return m;
  }

  /** Pour-time at which the first coffee lands in the mug (steam and the pour SFX start here). */
  get impactTime(): number {
    return TL.stream[0] + this.fallDelay;
  }

  start(): void {
    if (this.state !== "idle") return;
    this.state = "pouring";
    this.t = 0;
    this.update(0);
  }

  /** The mug is full: a small lift-and-drop plus a clink. */
  bob(): void {
    if (this.state !== "full" || this.bobT >= 0) return;
    this.bobT = 0;
    this.audio.clink(this.mugTop);
  }

  /** Jump to `seconds` into the pour (silently — no audio). Deterministic. */
  seek(seconds: number): void {
    this.reset();
    this.state = seconds >= TL.end ? "full" : "pouring";
    this.t = seconds;
    this.moved = true;
    this.steam.seek(seconds - this.impactTime);
    this.applyFrame(seconds);
    if (this.state === "full") this.settleFull();
  }

  reset(): void {
    this.moved = true;
    this.state = "idle";
    this.t = 0;
    this.bobT = -1;
    this.potLevel = POT_LEVEL0;
    this.pot.position.copy(this.potRest);
    this.pot.quaternion.copy(this.potRestQ);
    this.setPotSurface(0);
    this.mugLiquid.visible = false;
    this.stream.visible = false;
    for (const d of this.drips) d.visible = false;
    this.mug.position.y = this.mugRestY;
    this.steam.stop();
    this.uniforms.uRipple.value = 0;
    this.uniforms.uBreak.value = 0;
  }

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
    this.steam.update(dt);
    if (this.bobT >= 0) {
      this.moved = true;
      this.bobT += dt;
      const u = clamp01(this.bobT / BOB_DURATION);
      this.mug.position.y = this.mugRestY + 0.004 * Math.sin(Math.PI * u);
      if (u >= 1) {
        this.bobT = -1;
        this.mug.position.y = this.mugRestY;
      }
    }
    if (this.state !== "pouring") return;
    if (dt > 0) this.moved = true; // the decanter (and its shadow) is on the move
    const before = this.t;
    this.t += dt;
    if (dt > 0) {
      // SFX on the visual: glass leaves the plate; coffee lands; glass back on the plate.
      if (before < TL.lift[0] && this.t >= TL.lift[0]) this.audio.clink(this.potRest);
      const impact = this.impactTime;
      // System 6 rev 3's pourCoffee() schedules its first splash CoffeeSfx.LANDING_S (0.17 s, the
      // fall from the lip to the mug floor) after the call, so the cue goes out that much before
      // the visual impact and the sound lands with the leading edge (fallDelay ≈ 0.167 s here).
      const cue = impact - CoffeeSfx.LANDING_S;
      if (before < cue && this.t >= cue) {
        // Liquid lands from the first splash until the tail (and the drips) have come down.
        const lastLanding = DRIPS[DRIPS.length - 1] + this.fallDelay;
        this.audio.pour(lastLanding - impact, this.mugTop);
      }
      if (before < impact && this.t >= impact) this.steam.start();
      if (before < TL.end && this.t >= TL.end) this.audio.clink(this.potRest);
    }
    this.applyFrame(this.t);
    if (this.t >= TL.end) this.settleFull();
  }

  private settleFull(): void {
    this.state = "full";
    this.moved = true;
    this.pot.position.copy(this.potRest);
    this.pot.quaternion.copy(this.potRestQ);
    this.setPotSurface(0);
    this.stream.visible = false;
    for (const d of this.drips) d.visible = false;
  }

  /** Volume fraction landed at pour-time t (flow integrated with the fall delay). */
  private landedFraction(t: number): number {
    const [sa, sb] = TL.stream;
    const u = clamp01((t - this.fallDelay - sa) / (sb - sa));
    const x = u * (this.fillLut.length - 1), i = Math.floor(x), f = x - i;
    return i >= this.fillLut.length - 1 ? 1 : this.fillLut[i] + (this.fillLut[i + 1] - this.fillLut[i]) * f;
  }

  /**
   * Lip position (world), yaw and tilt of the decanter at pour-time t, into `out`.
   * `lipTilt` is the angle at which the coffee surface reaches the spout for the current level.
   */
  private solvePose(t: number, lipTilt: number, out: { L: THREE.Vector3; yaw: number; tilt: number }): void {
    const L = out.L;
    let yaw = POT_YAW0;
    let tilt = 0;
    const flow = flowAt(t);
    if (t < TL.lift[0]) {
      L.copy(this.L0);
    } else if (t < TL.lift[1]) {
      const u = phase(t, TL.lift[0], TL.lift[1]);
      L.set(this.L0.x, lerp(this.L0.y, this.LA.y, easeOut(u)), lerp(this.L0.z, this.LA.z, easeInOut(u)));
    } else if (t < TL.carry[1]) {
      const u = easeInOut(phase(t, TL.carry[0], TL.carry[1]));
      bezier2(this.LA, this.LC, this.L1H, u, L);
      yaw = lerp(POT_YAW0, this.yaw1, u);
      // The wrist starts tipping the pot while it is still arriving.
      tilt = lipTilt * 0.7 * easeInOut(phase(u, 0.55, 1));
    } else if (t < TL.tiltOn[1]) {
      const u = easeInOut(phase(t, TL.tiltOn[0], TL.tiltOn[1]));
      L.lerpVectors(this.L1H, this.L1, u);
      yaw = this.yaw1;
      tilt = lipTilt * lerp(0.7, 1, u);
    } else if (t < TL.tiltOff[0]) {
      // Pouring: lip angle + over-tilt ∝ flow; pot dips toward the mug as it fills.
      L.copy(this.L1);
      L.y -= POUR_DIP * this.landedFraction(t);
      yaw = this.yaw1;
      tilt = lipTilt + OVER_TILT * flow;
    } else if (t < TL.tiltOff[1]) {
      // Wrist snap upright: ease-out (fast first) cuts the stream cleanly.
      const u = easeOut(phase(t, TL.tiltOff[0], TL.tiltOff[1]));
      L.copy(this.L1);
      L.y -= POUR_DIP;
      L.lerp(this.L1B, u);
      yaw = this.yaw1;
      tilt = (lipTilt + OVER_TILT * flow) * (1 - u);
    } else if (t < TL.carryBack[0]) {
      L.copy(this.L1B);
      yaw = this.yaw1;
    } else if (t < TL.carryBack[1]) {
      const u = easeInOut(phase(t, TL.carryBack[0], TL.carryBack[1]));
      bezier2(this.L1B, this.LC, this.LA, u, L);
      yaw = lerp(this.yaw1, POT_YAW0, u);
    } else if (t < TL.lower[1]) {
      // Set down: z first, then a decelerating landing (quadratic ease-out — no slam).
      const u = phase(t, TL.lower[0], TL.lower[1]);
      const uy = 1 - (1 - u) * (1 - u);
      L.set(this.L0.x, lerp(this.LA.y, this.L0.y, uy), lerp(this.LA.z, this.L0.z, easeInOut(Math.min(1, u * 1.25))));
    } else {
      L.copy(this.L0);
    }
    out.yaw = yaw;
    out.tilt = tilt;
  }

  /** Pose every animated piece for pour-time `t`. */
  private applyFrame(t: number): void {
    const fill = this.landedFraction(t);
    this.potLevel = POT_LEVEL0 - POT_DROP * fill;
    const level = mugLevelForVolume(fill);
    const flow = flowAt(t);
    const lipTilt = Math.atan((POT_H - this.potLevel) / LIP_R);
    const tailDown = TL.stream[1] + this.fallDelay + 0.05;
    const streamOn = t >= TL.stream[0] && t < tailDown;

    /* ---- decanter ---- */
    const pose = this.pose;
    this.solvePose(t, lipTilt, pose);
    const L = pose.L;
    // Q = RotY(yaw) · RotZ(tilt); positive tilt about local z lowers the −x (spout) side.
    this.tmpQ.setFromAxisAngle(this.axisY, pose.yaw);
    this.tmpQ2.setFromAxisAngle(this.axisZ, pose.tilt);
    this.tmpQ.multiply(this.tmpQ2);
    this.pot.quaternion.copy(this.tmpQ);
    this.pot.position.copy(L).sub(this.tmpV2.copy(LIP_LOCAL).applyQuaternion(this.tmpQ));
    // Liquid surface: a horizontal plane through the axis point at the fill level (volume-preserving
    // for a tilted cylinder), nudged 1 mm up while pouring so the coffee is seen leaving the lip.
    this.setPotSurface(flow > 0 ? 0.001 : 0);

    /* ---- mug ---- */
    if (fill > 0) {
      this.mugLiquid.visible = true;
      this.mugLiquid.position.y = level;
      const k = mugInnerRadius(level) / MUG_LATHE_R;
      this.mugLiquid.scale.set(k, 1, k);
    }
    const landing = t >= this.impactTime && t < tailDown;
    this.uniforms.uRipple.value = landing ? lerp(0.4, 1, flow) : Math.max(0, this.uniforms.uRipple.value - 0.05);

    /* ---- stream ---- */
    const surfaceY = this.mug.position.y + level;
    if (streamOn) {
      let top = L.y - 0.002;
      const sinceStart = t - TL.stream[0];
      const fullLen = top - surfaceY;
      // Leading edge falls at g from the lip; the tail detaches when the flow stops and falls too.
      let len = Math.min(fullLen, LIP_SPEED * sinceStart + 0.5 * G * sinceStart * sinceStart);
      if (t >= TL.stream[1]) {
        const sinceEnd = t - TL.stream[1];
        top -= LIP_SPEED * sinceEnd + 0.5 * G * sinceEnd * sinceEnd;
        len = top - surfaceY;
      }
      // Radius ∝ sqrt(flow) (area ∝ volume rate at a given exit speed); never below a thread.
      const r = STREAM_R * Math.max(0.18, Math.sqrt(Math.max(flow, t >= TL.stream[1] ? 0.03 : 0)));
      if (len > 0.002) {
        this.stream.visible = true;
        this.stream.position.set(L.x, top, L.z);
        this.stream.scale.set(r, len, r);
        this.uniforms.uLen.value = len;
        this.uniforms.uRad.value = r;
        // Bead-up when the flow is a thread (start and end) and along the detached tail.
        this.uniforms.uBreak.value = t >= TL.stream[1] ? 0.85 : 1 - THREE.MathUtils.smoothstep(flow, 0.05, 0.4);
        // Initial horizontal direction = spout direction in the xz plane.
        this.uniforms.uDir.value.set(-Math.cos(pose.yaw), Math.sin(pose.yaw));
      } else {
        this.stream.visible = false;
      }
    } else {
      this.stream.visible = false;
    }

    /* ---- drips ---- */
    for (let i = 0; i < DRIPS.length; i++) {
      const td = DRIPS[i];
      const d = this.drips[i];
      const since = t - td;
      if (since < 0) {
        d.visible = false;
        continue;
      }
      // Where the lip was when the drop let go; it falls from there.
      const p = this.pose;
      const save = this.tmpV3.copy(p.L);
      const saveYaw = p.yaw, saveTilt = p.tilt;
      this.solvePose(td, lipTilt, p);
      const y = p.L.y - 0.004 - 0.5 * G * since * since;
      if (y > surfaceY + DRIP_R) {
        d.visible = true;
        d.position.set(p.L.x, y, p.L.z);
        // A falling drop stretches a little with speed.
        const stretch = 1 + Math.min(0.6, 0.12 * since * G);
        d.scale.set(1, stretch, 1);
      } else {
        d.visible = false;
        if (since < 0.6) this.uniforms.uRipple.value = Math.max(this.uniforms.uRipple.value, 0.5);
      }
      p.L.copy(save);
      p.yaw = saveYaw;
      p.tilt = saveTilt;
    }
  }

  private setPotSurface(extra: number): void {
    const axisPoint = this.tmpV2.set(0, this.potLevel, 0).applyQuaternion(this.pot.quaternion).add(this.pot.position);
    // Plane keeps y < h: normal (0,−1,0), constant h.
    this.clipPlane.constant = axisPoint.y + extra;
  }
}

function bezier2(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, u: number, out: THREE.Vector3): THREE.Vector3 {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  return out.set(a * p0.x + b * p1.x + c * p2.x, a * p0.y + b * p1.y + c * p2.y, a * p0.z + b * p1.z + c * p2.z);
}

function mugInnerRadius(y: number): number {
  const p = MUG_INNER;
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][0]) {
      const u = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return lerp(p[i - 1][1], p[i][1], u);
    }
  }
  return p[p.length - 1][1];
}

/**
 * Liquid height for a fraction of the full volume (floor → MUG_FULL), through the inner
 * profile: 64-step cumulative volume table built once, inverted by linear search.
 */
const VOL_STEPS = 64;
const VOL_TABLE: Float32Array = (() => {
  const t = new Float32Array(VOL_STEPS + 1);
  let acc = 0;
  for (let i = 1; i <= VOL_STEPS; i++) {
    const y0 = MUG_FLOOR + ((i - 1) / VOL_STEPS) * (MUG_FULL - MUG_FLOOR), y1 = MUG_FLOOR + (i / VOL_STEPS) * (MUG_FULL - MUG_FLOOR);
    const r0 = mugInnerRadius(y0), r1 = mugInnerRadius(y1);
    acc += (Math.PI * (r0 * r0 + r1 * r1) * (y1 - y0)) / 2;
    t[i] = acc;
  }
  for (let i = 0; i <= VOL_STEPS; i++) t[i] /= acc;
  return t;
})();
function mugLevelForVolume(fraction: number): number {
  const f = clamp01(fraction);
  for (let i = 1; i <= VOL_STEPS; i++) {
    if (f <= VOL_TABLE[i]) {
      const u = (f - VOL_TABLE[i - 1]) / Math.max(1e-9, VOL_TABLE[i] - VOL_TABLE[i - 1]);
      return MUG_FLOOR + ((i - 1 + u) / VOL_STEPS) * (MUG_FULL - MUG_FLOOR);
    }
  }
  return MUG_FULL;
}
