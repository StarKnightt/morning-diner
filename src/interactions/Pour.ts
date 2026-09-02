/**
 * Pouring coffee at the brewer. Press E beside the `pourMug`: the decanter
 * (`coffeePot`) slides out from under the brew head, lifts, travels to the mug
 * turning spout-first, tilts until its surface reaches the lip (the tilt is
 * solved from the fill level, so the coffee visibly meets the spout), pours
 * for 2.5 s, untilts and returns to the warmer. Hand-less; ~5.3 s.
 *
 *   stream   thin dark cylinder from the lip to the liquid, shader wobble +
 *            taper + a slight parabola; the leading edge falls at g and the
 *            tail detaches at the end
 *   mug      a meniscus disc that rises 13 → 75 mm (the mug is opaque, so
 *            only the surface is needed), ripples while the stream lands
 *   decanter the fixed 55 % coffee body is swapped for a taller body cut by a
 *            world-horizontal clipping plane; back faces are shaded with an
 *            up-facing normal so the cut reads as the liquid surface. Level
 *            drops 9 mm (≈ the 0.2 l that landed in the mug) and stays there
 *   steam    Steam.ts, off the rim, 30 s
 *
 * One pour fills the mug; E again gives a 4 mm bob (and a clink), no refill.
 * Everything runs off one internal clock so `seek(t)` is deterministic.
 */
import * as THREE from "three";
import type { Palette } from "../core/materials";
import { Steam } from "./Steam";
import { clamp01, easeIn, easeInOut, easeOut, lerp, phase, type Interactable } from "./util";

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

const STREAM_R = 0.0028;
const G = 9.81;

/** Timeline, seconds. */
const TL = {
  lift: [0, 0.5],
  carry: [0.5, 1.0],
  tiltOn: [1.0, 1.35],
  stream: [1.3, 3.8],
  fill: [1.42, 3.75],
  tiltOff: [3.8, 4.15],
  carryBack: [4.15, 4.75],
  lower: [4.75, 5.3],
  end: 5.3,
} as const;
export const POUR_STREAM_START = TL.stream[0];
export const POUR_END = TL.end;

const BOB_DURATION = 0.22;

export interface PourAudio {
  clink(at: THREE.Vector3): void;
  pour(seconds: number, at: THREE.Vector3): void;
}

type State = "idle" | "pouring" | "full";

export class PourInteraction {
  readonly interactable: Interactable;
  state: State = "idle";
  private t = 0;
  private bobT = -1;
  private potLevel = POT_LEVEL0;

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
  private readonly steam: Steam;
  private readonly uniforms = {
    uTime: { value: 0 },
    uLen: { value: 0.1 },
    uRad: { value: STREAM_R },
    uDir: { value: new THREE.Vector2(0, -1) },
    uRipple: { value: 0 },
  };

  // Lip keyframes (world)
  private readonly L0 = new THREE.Vector3();
  private readonly LA = new THREE.Vector3();
  private readonly LB = new THREE.Vector3();
  private readonly L1 = new THREE.Vector3();
  private readonly yaw1: number;

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly axisY = new THREE.Vector3(0, 1, 0);
  private readonly axisZ = new THREE.Vector3(0, 0, 1);
  private readonly focusPoint = new THREE.Vector3();

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

    // Lip path. Rest → out from under the brew head (+z) and up → over the mug, high → down onto the lip point.
    this.L0.copy(LIP_LOCAL).applyQuaternion(this.potRestQ).add(this.potRest);
    this.LA.copy(this.L0).add(this.tmpV.set(0, 0.05, 0.28));
    this.L1.set(this.mugTop.x, this.mugTop.y + 0.06, this.mugTop.z + 0.012);
    this.LB.copy(this.L1).add(this.tmpV.set(0, 0.15, 0));
    // Spout must point at the mug (−z): RotY(ψ)·(−1,0,0) = (−cos ψ, 0, sin ψ) = (0, 0, −1).
    this.yaw1 = -Math.PI / 2;

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
    this.potCoffee.visible = false;
    pot.add(this.potCoffee);

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
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 24, true);
    cyl.translate(0, -0.5, 0); // y ∈ [−1, 0]: top at the lip
    const streamMat = pal.coffee.clone();
    streamMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uLen = this.uniforms.uLen;
      shader.uniforms.uRad = this.uniforms.uRad;
      shader.uniforms.uDir = this.uniforms.uDir;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uLen; uniform float uRad; uniform vec2 uDir;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          {
            float s = clamp(-transformed.y, 0.0, 1.0);   // 0 at the lip, 1 at the surface
            float d = s * uLen;                            // metres fallen
            // Taper as the stream accelerates, plus a faint travelling ripple.
            float taper = mix(1.0, 0.7, s) * (1.0 + 0.07 * sin(d * 95.0 - uTime * 34.0));
            transformed.xz *= taper;
            // Wobble (metres → local units) growing with the fall.
            vec2 wob = vec2(sin(d * 23.0 + uTime * 9.0), cos(d * 19.0 - uTime * 7.3)) * 0.0011 * s;
            // Parabola: the liquid leaves the lip with a little horizontal speed toward the mug.
            float tf = sqrt(2.0 * max(d, 0.0) / 9.81);
            transformed.xz += (wob + uDir * 0.04 * tf) / uRad;
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

    this.steam = new Steam(scene);
    this.steam.setOrigin(this.tmpV.set(this.mugTop.x, this.mugTop.y - 0.004, this.mugTop.z));

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

  start(): void {
    if (this.state !== "idle") return;
    this.state = "pouring";
    this.t = 0;
    this.audio.clink(this.potRest);
    this.potCoffeeOriginal.visible = false;
    this.potCoffee.visible = true;
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
    this.potCoffeeOriginal.visible = false;
    this.potCoffee.visible = true;
    this.steam.seek(seconds - TL.stream[0]);
    this.applyFrame(seconds);
  }

  reset(): void {
    this.state = "idle";
    this.t = 0;
    this.bobT = -1;
    this.potLevel = POT_LEVEL0;
    this.pot.position.copy(this.potRest);
    this.pot.quaternion.copy(this.potRestQ);
    this.potCoffeeOriginal.visible = true;
    this.potCoffee.visible = false;
    this.mugLiquid.visible = false;
    this.stream.visible = false;
    this.mug.position.y = this.mugRestY;
    this.steam.stop();
    this.uniforms.uRipple.value = 0;
  }

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
    this.steam.update(dt);
    if (this.bobT >= 0) {
      this.bobT += dt;
      const u = clamp01(this.bobT / BOB_DURATION);
      this.mug.position.y = this.mugRestY + 0.004 * Math.sin(Math.PI * u);
      if (u >= 1) {
        this.bobT = -1;
        this.mug.position.y = this.mugRestY;
      }
    }
    if (this.state !== "pouring") return;
    const before = this.t;
    this.t += dt;
    if (before < TL.stream[0] && this.t >= TL.stream[0]) {
      this.audio.pour(TL.stream[1] - TL.stream[0], this.mugTop);
      this.steam.start();
    }
    this.applyFrame(this.t);
    if (this.t >= TL.end) {
      this.state = "full";
      this.audio.clink(this.potRest);
      this.pot.position.copy(this.potRest);
      this.pot.quaternion.copy(this.potRestQ);
      this.setPotSurface(0);
    }
  }

  /** Pose every animated piece for pour-time `t`. */
  private applyFrame(t: number): void {
    const fill = phase(t, TL.fill[0], TL.fill[1]);
    this.potLevel = POT_LEVEL0 - POT_DROP * fill;
    const level = lerp(MUG_FLOOR, MUG_FULL, fill);
    const streamOn = t >= TL.stream[0] && t < TL.stream[1] + 0.25;

    /* ---- decanter: lip position, yaw, tilt ---- */
    const L = this.tmpV;
    let yaw = POT_YAW0;
    let tilt = 0;
    const tiltPour = Math.atan((POT_H - this.potLevel) / LIP_R);
    if (t < TL.lift[1]) {
      const u = phase(t, TL.lift[0], TL.lift[1]);
      L.set(this.L0.x, lerp(this.L0.y, this.LA.y, easeOut(u)), lerp(this.L0.z, this.LA.z, easeInOut(u)));
    } else if (t < TL.carry[1]) {
      const u = easeInOut(phase(t, TL.carry[0], TL.carry[1]));
      L.lerpVectors(this.LA, this.LB, u);
      L.y += 0.05 * Math.sin(Math.PI * u);
      yaw = lerp(POT_YAW0, this.yaw1, u);
    } else if (t < TL.tiltOn[1]) {
      const u = easeInOut(phase(t, TL.tiltOn[0], TL.tiltOn[1]));
      L.lerpVectors(this.LB, this.L1, u);
      yaw = this.yaw1;
      tilt = tiltPour * u;
    } else if (t < TL.tiltOff[0]) {
      L.copy(this.L1);
      yaw = this.yaw1;
      tilt = tiltPour;
    } else if (t < TL.tiltOff[1]) {
      const u = easeInOut(phase(t, TL.tiltOff[0], TL.tiltOff[1]));
      L.lerpVectors(this.L1, this.LB, u);
      yaw = this.yaw1;
      tilt = tiltPour * (1 - u);
    } else if (t < TL.carryBack[1]) {
      const u = easeInOut(phase(t, TL.carryBack[0], TL.carryBack[1]));
      L.lerpVectors(this.LB, this.LA, u);
      L.y += 0.05 * Math.sin(Math.PI * u);
      yaw = lerp(this.yaw1, POT_YAW0, u);
    } else if (t < TL.lower[1]) {
      const u = phase(t, TL.lower[0], TL.lower[1]);
      L.set(this.L0.x, lerp(this.LA.y, this.L0.y, easeIn(u)), lerp(this.LA.z, this.L0.z, easeInOut(u)));
    } else {
      L.copy(this.L0);
    }
    // Q = RotY(yaw) · RotZ(tilt); positive tilt about local z lowers the −x (spout) side.
    this.tmpQ.setFromAxisAngle(this.axisY, yaw);
    this.tmpQ2.setFromAxisAngle(this.axisZ, tilt);
    this.tmpQ.multiply(this.tmpQ2);
    this.pot.quaternion.copy(this.tmpQ);
    this.pot.position.copy(L).sub(this.tmpV2.copy(LIP_LOCAL).applyQuaternion(this.tmpQ));
    // Liquid surface: a horizontal plane through the axis point at the fill level (volume-preserving
    // for a tilted cylinder), nudged 1 mm up while pouring so the coffee is seen leaving the lip.
    this.setPotSurface(streamOn ? 0.001 : 0);

    /* ---- mug ---- */
    if (fill > 0) {
      this.mugLiquid.visible = true;
      this.mugLiquid.position.y = level;
      const k = mugInnerRadius(level) / MUG_LATHE_R;
      this.mugLiquid.scale.set(k, 1, k);
    }
    const landing = t >= TL.stream[0] + 0.17 && t < TL.stream[1] + 0.12;
    this.uniforms.uRipple.value = landing ? 1 : streamOn ? 0.4 : Math.max(0, this.uniforms.uRipple.value - 0.05);

    /* ---- stream ---- */
    if (streamOn) {
      // Lip world position is L (the stream hangs from it). Surface world y:
      const surfaceY = this.mug.position.y + level;
      let top = L.y - 0.002;
      // Leading edge falls at g from the lip; the tail detaches at the end and falls too.
      const sinceStart = t - TL.stream[0];
      const fullLen = top - surfaceY;
      let len = Math.min(fullLen, 0.5 * G * sinceStart * sinceStart);
      if (t >= TL.stream[1]) {
        const sinceEnd = t - TL.stream[1];
        top -= 0.5 * G * sinceEnd * sinceEnd;
        len = top - surfaceY;
      }
      if (len > 0.002) {
        const flow = Math.min(1, sinceStart / 0.12);
        this.stream.visible = true;
        this.stream.position.set(L.x, top, L.z);
        this.stream.scale.set(STREAM_R * flow, len, STREAM_R * flow);
        this.uniforms.uLen.value = len;
        this.uniforms.uRad.value = STREAM_R * flow;
        // Initial horizontal direction = spout direction in the xz plane.
        this.uniforms.uDir.value.set(-Math.cos(yaw), Math.sin(yaw));
      } else {
        this.stream.visible = false;
      }
    } else {
      this.stream.visible = false;
    }
  }

  private setPotSurface(extra: number): void {
    const axisPoint = this.tmpV2.set(0, this.potLevel, 0).applyQuaternion(this.pot.quaternion).add(this.pot.position);
    // Plane keeps y < h: normal (0,−1,0), constant h.
    this.clipPlane.constant = axisPoint.y + extra;
  }
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
