/**
 * System 8 pipeline. One call from main.ts, after `await diner.build()`:
 *
 *   const post = createPostPipeline(renderer, scene, camera, { sun: diner.sun });
 *   ...
 *   post.render();            // instead of renderer.render(scene, camera)
 *
 * `?post=0` (or settings.enabled = false) makes render() a plain renderer.render.
 *
 * Two suns / shadow-once (System 3 rev 2 + loader): the dust and haze read the
 * BUILDING sun's shadow map — `diner.sun`, a SpotLight with a perspective 4096²
 * map (the slat stripes); `diner.sunLot`'s ortho map never contains the room.
 * Both maps are rendered once at boot and again only after
 * `diner.invalidateShadows()`; the scene pass below goes through
 * `renderer.render`, so the `installShadowMasks` wrapper runs (and re-renders
 * both maps when `needsUpdate` is set) before the opaque pass, and the haze /
 * composite passes that follow read a map that is current for this frame.
 *
 * Pass order (all targets HalfFloat, linear; sizes at the drawing-buffer size):
 *   1. scene      → sceneRT (MSAA n× + resolved float depth). Dust motes and steam are
 *                   scene objects, so they are depth-tested and MSAA-resolved here.
 *   2. haze       → hazeRT ½ res: single-scatter march through the beam prisms
 *   3. composite  → compRT: scene fetch with the exterior heat shimmer + haze upsample
 *   4. bloom      → ½ res prefilter (soft-knee threshold) → blur → ¼ res → blur
 *   5. finish     → screen (or ldrRT when SMAA is on): CA + corner softness, bloom,
 *                   vignette, tone map (ACES/AgX/Neutral), sRGB, grain
 *   6. smaa       → (optional) SMAA 1x on the display-encoded frame, then a grain pass
 *
 * GPU time per pass: window.__post.timings() (EXT_disjoint_timer_query_webgl2).
 * Live knobs: window.__post.settings (see settings.ts).
 */
import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { ROOM } from "../scene/layout";
import { apertureUniforms, beamBounds, findSun, setSunUniforms, sunRaysOf, type SunLight, type SunRays } from "./beams";
import { SunDust } from "./Dust";
import { GpuTimer } from "./GpuTimer";
import { applyUrlOverrides, defaultSettings, type AAMode, type PostSettings, type ToneMap } from "./settings";
import { blurFragment, bloomPrefilterFragment, compositeFragment, downsampleFragment, finishFragment, fsVertex, grainFragment, hazeFragment } from "./shaders";
import { SteamEmitter } from "./Steam";

export interface PostPipeline {
  readonly settings: PostSettings;
  /** Renders one frame (scene + post, or plain when disabled). */
  render(): void;
  /** Per-pass GPU ms (EMA) or null when timer queries are unavailable. */
  timings(): Record<string, { ema: number; last: number; samples: number }> | null;
  resetTimers(): void;
  /** Read back one pixel of the linear HDR scene target (for tuning exposure-relative knobs). */
  probeHDR(x: number, y: number): [number, number, number] | null;
  readonly dust: SunDust | null;
  readonly steam: SteamEmitter | null;
  dispose(): void;
}

declare global {
  interface Window {
    __post?: PostPipeline;
  }
}

function msaaSamples(mode: AAMode): number {
  return mode === "msaa8" ? 8 : mode === "msaa4" || mode === "msaa4+smaa" ? 4 : 0;
}
function usesSmaa(mode: AAMode): boolean {
  return mode === "smaa" || mode === "msaa4+smaa";
}
function toneMapIndex(t: ToneMap | null, renderer: THREE.WebGLRenderer): number {
  if (t === null) {
    switch (renderer.toneMapping) {
      case THREE.AgXToneMapping:
        return 1;
      case THREE.NeutralToneMapping:
        return 2;
      case THREE.NoToneMapping:
      case THREE.LinearToneMapping:
        return 3;
      case THREE.CustomToneMapping:
        return 4; // System 4's camera curve (scene/Lighting.ts installCameraToneMapping)
      default:
        return 0;
    }
  }
  return t === "agx" ? 1 : t === "neutral" ? 2 : t === "none" ? 3 : t === "camera" ? 4 : 0;
}

export interface PostPipelineOptions {
  /**
   * The building sun whose shadow map lights the dust and haze (`Diner.sun`). When
   * omitted the scene is searched for a shadow-casting SpotLight, then a DirectionalLight
   * — but pass it: the lot sun is also a shadow-casting DirectionalLight.
   */
  sun?: SunLight | null;
}

export function createPostPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: PostPipelineOptions = {}): PostPipeline {
  const settings = applyUrlOverrides(defaultSettings());
  const DEBUG = new URLSearchParams(location.search).has("debug");

  if (!settings.enabled) {
    const off: PostPipeline = {
      settings,
      render: () => renderer.render(scene, camera),
      timings: () => null,
      resetTimers: () => {},
      probeHDR: () => null,
      dust: null,
      steam: null,
      dispose: () => {},
    };
    window.__post = off;
    return off;
  }

  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = new GpuTimer(gl);
  if (DEBUG) console.log(`[post] timer queries ${timer.available ? "available" : "UNAVAILABLE"}`);
  renderer.info.autoReset = false;

  const sun = options.sun ?? findSun(scene);
  if (!sun) console.warn("[post] no shadow-casting sun light found: dust and haze disabled");
  else if (DEBUG) console.log(`[post] sun = ${(sun as THREE.SpotLight).isSpotLight ? "SpotLight (perspective map)" : "DirectionalLight (ortho map)"} ${sun.shadow.mapSize.x}²  shadow map ${sun.shadow.map ? "rendered" : "NOT YET RENDERED"}`);

  /* ---------------- scene-side objects ---------------- */
  const dust = sun ? new SunDust(sun, settings.dust, renderer.getPixelRatio()) : null;
  if (dust) scene.add(dust.points);

  // Ambient steam off the decanter on the warmer (System 7 makes its own emitter for the pour).
  let steam: SteamEmitter | null = null;
  const pot = scene.getObjectByName("coffeePot");
  {
    if (pot) {
      steam = new SteamEmitter({ count: settings.steam.count, rise: settings.steam.rise, life: settings.steam.life, strength: settings.steam.strength });
      const p = new THREE.Vector3();
      pot.updateWorldMatrix(true, false);
      p.setFromMatrixPosition(pot.matrixWorld);
      steam.object.position.set(p.x, p.y + 0.178, p.z); // decanter mouth (Props.ts: Hd = 0.178)
      steam.object.name = "post:steam-decanter";
      scene.add(steam.object);
    }
  }

  /* ---------------- targets ---------------- */
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  let aaMode: AAMode = settings.aa;

  const makeSceneRT = (w: number, h: number, samples: number) => {
    const depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    depthTexture.format = THREE.DepthFormat;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    rt.texture.name = "post.scene";
    return rt;
  };
  const makeRT = (w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType) =>
    new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      type,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

  let sceneRT = makeSceneRT(size.x, size.y, msaaSamples(aaMode));
  let hazeRT = makeRT(size.x >> 1, size.y >> 1);
  let compRT = makeRT(size.x, size.y);
  let bloomHalfA = makeRT(size.x >> 1, size.y >> 1);
  let bloomHalfB = makeRT(size.x >> 1, size.y >> 1);
  let bloomQA = makeRT(size.x >> 2, size.y >> 2);
  let bloomQB = makeRT(size.x >> 2, size.y >> 2);
  let ldrA: THREE.WebGLRenderTarget | null = null;
  let ldrB: THREE.WebGLRenderTarget | null = null;
  let smaa: SMAAPass | null = null;

  const ensureSmaa = (on: boolean) => {
    if (on && !smaa) {
      smaa = new SMAAPass();
      smaa.setSize(size.x, size.y);
      ldrA = makeRT(size.x, size.y, THREE.UnsignedByteType);
      ldrB = makeRT(size.x, size.y, THREE.UnsignedByteType);
    } else if (!on && smaa) {
      smaa.dispose();
      smaa = null;
      ldrA?.dispose();
      ldrB?.dispose();
      ldrA = ldrB = null;
    }
  };
  ensureSmaa(usesSmaa(aaMode));

  const resize = (w: number, h: number) => {
    sceneRT.setSize(w, h);
    hazeRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    compRT.setSize(w, h);
    bloomHalfA.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    bloomHalfB.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    bloomQA.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    bloomQB.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    ldrA?.setSize(w, h);
    ldrB?.setSize(w, h);
    smaa?.setSize(w, h);
  };

  /* ---------------- materials ---------------- */
  const ap = apertureUniforms();
  const shadowUniforms = {
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowBias: { value: 0 },
  };
  const depthUniforms = {
    tDepth: { value: sceneRT.depthTexture },
    uInvProj: { value: new THREE.Matrix4() },
    uInvView: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uNear: { value: camera.near },
    uFar: { value: camera.far },
  };
  const bounds = new THREE.Box3();
  const boundsDir = new THREE.Vector3(NaN, NaN, NaN);
  const rays: SunRays = { dir: new THREE.Vector3(), apex: null };

  const hazeMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: hazeFragment,
    uniforms: {
      ...depthUniforms,
      ...ap,
      ...shadowUniforms,
      uBoxMin: { value: new THREE.Vector3() },
      uBoxMax: { value: new THREE.Vector3() },
      uSunRadiance: { value: new THREE.Color() },
      uStrength: { value: 0 },
      uG: { value: 0.75 },
      uSteps: { value: 24 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const compositeMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: compositeFragment,
    uniforms: {
      ...depthUniforms,
      ...ap,
      tScene: { value: sceneRT.texture },
      tHaze: { value: hazeRT.texture },
      uResolution: { value: new THREE.Vector2() },
      uHazeSize: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uShimmerAmp: { value: 1 },
      uShimmerFreq: { value: 11 },
      uShimmerSpeed: { value: 0.9 },
      uShimmerScroll: { value: 0.45 },
      uMinDepth: { value: 8 },
      uHeightFade: { value: 2.2 },
      uWallZ: { value: ROOM.zFront + ROOM.wallThickness },
      uShimmerOn: { value: 1 },
      uHazeOn: { value: 1 },
      uDebug: { value: 0 },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const prefilterMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: bloomPrefilterFragment,
    uniforms: { tColor: { value: compRT.texture }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 2 }, uKnee: { value: 0.5 } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: blurFragment,
    uniforms: { tColor: { value: null }, uDir: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const downMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: downsampleFragment,
    uniforms: { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const finishUniforms = {
    tColor: { value: compRT.texture },
    tBloomHalf: { value: bloomHalfA.texture },
    tBloomQuarter: { value: bloomQA.texture },
    uResolution: { value: new THREE.Vector2() },
    uBloomStrength: { value: 0 },
    uVignetteEV: { value: 0.3 },
    uVignettePower: { value: 2.4 },
    uCA: { value: 0.5 },
    uCornerSoft: { value: 0.7 },
    uCornerSoftStart: { value: 0.55 },
    uHighlightDesat: { value: 0 },
    uToneMap: { value: 0 },
    uBloomOn: { value: 1 },
    uDebug: { value: 0 },
    toneMappingExposure: { value: 1 },
    uGrain: { value: 0 },
    uGrainChroma: { value: 0.3 },
    uGrainSize: { value: 1 },
    uFrame: { value: 0 },
  };
  const finishMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: finishFragment,
    uniforms: finishUniforms,
    defines: { GRAIN: "" },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const finishNoGrainMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: finishFragment,
    uniforms: finishUniforms, // shared uniform objects: one update serves both variants
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const grainMat = new THREE.ShaderMaterial({
    vertexShader: fsVertex,
    fragmentShader: grainFragment,
    uniforms: {
      tColor: { value: null },
      uGrain: finishUniforms.uGrain,
      uGrainChroma: finishUniforms.uGrainChroma,
      uGrainSize: finishUniforms.uGrainSize,
      uFrame: finishUniforms.uFrame,
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const quad = new FullScreenQuad(hazeMat);

  const runPass = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  };

  /* ---------------- frame ---------------- */
  const t0 = performance.now();
  let frame = 0;
  let lastLog = 0;
  const probeBuf = new Float32Array(4);

  const render = () => {
    renderer.info.reset();
    const s = settings;
    const time = (performance.now() - t0) / 1000;
    frame = (frame + 1) % 4096;

    // Lazy resize / AA-mode change (no allocation unless something changed).
    renderer.getDrawingBufferSize(size);
    if (sceneRT.width !== size.x || sceneRT.height !== size.y) resize(size.x, size.y);
    if (s.aa !== aaMode) {
      aaMode = s.aa;
      sceneRT.depthTexture?.dispose();
      sceneRT.dispose();
      sceneRT = makeSceneRT(size.x, size.y, msaaSamples(aaMode));
      depthUniforms.tDepth.value = sceneRT.depthTexture;
      compositeMat.uniforms.tScene.value = sceneRT.texture;
      ensureSmaa(usesSmaa(aaMode));
    }

    const shadowReady = !!sun?.shadow.map?.depthTexture;
    if (dust) {
      // debug.view 5 → motes ignore the shadow map; 6 → every mote lit (spawn-volume check)
      dust.update(time, camera, renderer.getPixelRatio(), s.debug.view === 5 ? 1 : s.debug.view === 6 ? 2 : 0);
      dust.points.visible = s.dust.enabled && shadowReady;
    }
    if (steam) {
      steam.params.strength = s.steam.enabled ? s.steam.strength : 0;
      steam.params.count = s.steam.count;
      steam.params.rise = s.steam.rise;
      steam.params.life = s.steam.life;
      if (pot) {
        const p = steam.object.position;
        p.setFromMatrixPosition(pot.matrixWorld);
        p.x += s.steam.offset[0];
        p.y += 0.178 + s.steam.offset[1];
        p.z += s.steam.offset[2];
      }
      steam.update(time);
    }

    // 1. scene. renderer.render runs the shadow pass first (through the installShadowMasks
    // wrapper: both maps, only when shadowMap.needsUpdate is set) and restores sceneRT
    // as the target before the opaque pass, so the map the haze reads below is current.
    timer.begin("scene");
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);
    timer.end();

    // shared camera uniforms
    depthUniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    depthUniforms.uInvView.value.copy(camera.matrixWorld);
    depthUniforms.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    depthUniforms.uNear.value = camera.near;
    depthUniforms.uFar.value = camera.far;
    if (sun) {
      sunRaysOf(sun, rays);
      setSunUniforms(ap, rays); // `ap` objects are shared by hazeMat and compositeMat
      // Persistent depth texture of the one-shot shadow map (same object every frame until
      // the map is re-allocated, e.g. a mapSize change); matrix = bias × proj × view.
      shadowUniforms.uShadowMap.value = sun.shadow.map?.depthTexture ?? null;
      shadowUniforms.uShadowMatrix.value.copy(sun.shadow.matrix);
      shadowUniforms.uShadowBias.value = sun.shadow.bias;
    }

    // 2. haze (half res)
    const hazeOn = s.haze.enabled && !!sun && shadowReady;
    if (hazeOn) {
      timer.begin("haze");
      if (!boundsDir.equals(rays.dir)) {
        // Only when System 4 moves the sun (or once at start): the box is otherwise static.
        boundsDir.copy(rays.dir);
        bounds.copy(beamBounds(rays));
      }
      (hazeMat.uniforms.uBoxMin.value as THREE.Vector3).copy(bounds.min);
      (hazeMat.uniforms.uBoxMax.value as THREE.Vector3).copy(bounds.max);
      (hazeMat.uniforms.uSunRadiance.value as THREE.Color).copy(sun!.color).multiplyScalar(sun!.intensity);
      hazeMat.uniforms.uStrength.value = s.haze.strength;
      hazeMat.uniforms.uG.value = s.haze.g;
      hazeMat.uniforms.uSteps.value = Math.max(4, Math.min(64, Math.round(s.haze.steps)));
      runPass(hazeMat, hazeRT);
      timer.end();
    }

    // 3. composite (shimmer + haze)
    timer.begin("composite");
    {
      const u = compositeMat.uniforms;
      (u.uResolution.value as THREE.Vector2).set(size.x, size.y);
      (u.uHazeSize.value as THREE.Vector2).set(hazeRT.width, hazeRT.height);
      u.uTime.value = time;
      u.uShimmerAmp.value = s.shimmer.amplitude * (size.y / 1080);
      u.uShimmerFreq.value = s.shimmer.frequency;
      u.uShimmerSpeed.value = s.shimmer.speed;
      u.uShimmerScroll.value = s.shimmer.scroll;
      u.uMinDepth.value = s.shimmer.minDepth;
      u.uHeightFade.value = s.shimmer.heightFade;
      u.uShimmerOn.value = s.shimmer.enabled ? 1 : 0;
      u.uHazeOn.value = hazeOn ? 1 : 0;
      u.uDebug.value = s.debug.view;
      runPass(compositeMat, compRT);
    }
    timer.end();

    // 4. bloom
    if (s.bloom.enabled) {
      timer.begin("bloom");
      (prefilterMat.uniforms.uTexel.value as THREE.Vector2).set(1 / size.x, 1 / size.y);
      prefilterMat.uniforms.uThreshold.value = s.bloom.threshold;
      prefilterMat.uniforms.uKnee.value = Math.max(1e-3, s.bloom.knee);
      runPass(prefilterMat, bloomHalfA);
      const r = s.bloom.radius;
      blurMat.uniforms.tColor.value = bloomHalfA.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(r / bloomHalfA.width, 0);
      runPass(blurMat, bloomHalfB);
      blurMat.uniforms.tColor.value = bloomHalfB.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(0, r / bloomHalfA.height);
      runPass(blurMat, bloomHalfA);
      downMat.uniforms.tColor.value = bloomHalfA.texture;
      (downMat.uniforms.uTexel.value as THREE.Vector2).set(1 / bloomHalfA.width, 1 / bloomHalfA.height);
      runPass(downMat, bloomQA);
      blurMat.uniforms.tColor.value = bloomQA.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(r / bloomQA.width, 0);
      runPass(blurMat, bloomQB);
      blurMat.uniforms.tColor.value = bloomQB.texture;
      (blurMat.uniforms.uDir.value as THREE.Vector2).set(0, r / bloomQA.height);
      runPass(blurMat, bloomQA);
      timer.end();
    }

    // 5. finish
    timer.begin("finish");
    {
      const f = s.finish;
      finishUniforms.tColor.value = compRT.texture;
      finishUniforms.tBloomHalf.value = bloomHalfA.texture;
      finishUniforms.tBloomQuarter.value = bloomQA.texture;
      (finishUniforms.uResolution.value as THREE.Vector2).set(size.x, size.y);
      finishUniforms.uBloomStrength.value = s.bloom.strength;
      finishUniforms.uBloomOn.value = s.bloom.enabled ? 1 : 0;
      finishUniforms.uVignetteEV.value = f.vignetteEV;
      finishUniforms.uVignettePower.value = f.vignettePower;
      const scale = size.y / 1080; // px knobs are specified at 1080p
      finishUniforms.uCA.value = f.ca * scale;
      finishUniforms.uCornerSoft.value = f.cornerSoft * scale;
      finishUniforms.uCornerSoftStart.value = f.cornerSoftStart;
      finishUniforms.uHighlightDesat.value = f.highlightDesat;
      finishUniforms.uToneMap.value = toneMapIndex(f.tonemap, renderer);
      finishUniforms.toneMappingExposure.value = f.exposure ?? renderer.toneMappingExposure;
      finishUniforms.uDebug.value = s.debug.view;
      finishUniforms.uGrain.value = f.grain;
      finishUniforms.uGrainChroma.value = f.grainChroma;
      finishUniforms.uGrainSize.value = Math.max(1, f.grainSize) * scale;
      finishUniforms.uFrame.value = frame;
      if (smaa && ldrA && ldrB) {
        runPass(finishNoGrainMat, ldrA);
        timer.end();
        timer.begin("smaa");
        smaa.renderToScreen = false;
        smaa.render(renderer, ldrB, ldrA, 0, false);
        grainMat.uniforms.tColor.value = ldrB.texture;
        runPass(grainMat, null);
      } else {
        runPass(finishMat, null);
      }
    }
    timer.end();

    if (DEBUG && time - lastLog > 5) {
      lastLog = time;
      const t = timer.timings();
      if (t) {
        const parts = Object.entries(t).map(([k, v]) => `${k}=${v.ema.toFixed(2)}`);
        const post = Object.entries(t).filter(([k]) => k !== "scene").reduce((a, [, v]) => a + v.ema, 0);
        console.log(`[post] ms ${parts.join(" ")} | post total=${post.toFixed(2)}`);
      }
    }
  };

  const pipeline: PostPipeline = {
    settings,
    render,
    timings: () => timer.timings(),
    resetTimers: () => timer.reset(),
    probeHDR: (x, y) => {
      renderer.readRenderTargetPixels(sceneRT, x, sceneRT.height - 1 - y, 1, 1, probeBuf);
      return [probeBuf[0], probeBuf[1], probeBuf[2]];
    },
    dust,
    steam,
    dispose: () => {
      for (const rt of [sceneRT, hazeRT, compRT, bloomHalfA, bloomHalfB, bloomQA, bloomQB]) rt.dispose();
      sceneRT.depthTexture?.dispose();
      ensureSmaa(false);
      for (const m of [hazeMat, compositeMat, prefilterMat, blurMat, downMat, finishMat, finishNoGrainMat, grainMat]) m.dispose();
      quad.dispose();
      dust?.points.removeFromParent();
      dust?.dispose();
      steam?.dispose();
      renderer.info.autoReset = true;
    },
  };
  window.__post = pipeline;
  return pipeline;
}
