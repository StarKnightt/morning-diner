/**
 * Bootstrap: renderer, scene, player, frame-capped loop, resize.
 *
 * Frame cap: ~120 fps while focused and visible, ~10 fps when the tab is
 * hidden or the window is blurred (the machine is shared with a game on the
 * primary monitor; this page must never free-run).
 */
import * as THREE from "three";
import { gpuRendererString, installCaptureApi, markSceneReady } from "./capture/pose";
import { FirstPerson } from "./player/FirstPerson";
import { Diner } from "./scene/Diner";

const params = new URLSearchParams(location.search);
const DEBUG = params.has("debug");

const renderer = new THREE.WebGLRenderer({ powerPreference: "high-performance", antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// r185 deprecated PCFSoftShadowMap (it silently maps to PCF anyway); PCF with
// shadow.radius gives the same soft edge without the console warning.
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

if (DEBUG) console.log(`[gpu] ${gpuRendererString(renderer)}`);

const scene = new THREE.Scene();
// Vertical FOV 37° ≈ 61° horizontal at 16:9 — a 32 mm full-frame equivalent.
// Wider lenses skew every near edge into a trapezoid and read as a game.
const camera = new THREE.PerspectiveCamera(37, window.innerWidth / window.innerHeight, 0.05, 200);

const diner = new Diner(scene, renderer);
const player = new FirstPerson(camera, renderer.domElement, diner.colliders);
installCaptureApi(renderer, scene, camera, player);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------------- loop ---------------- */
let focused = true;
window.addEventListener("blur", () => (focused = false));
window.addEventListener("focus", () => (focused = true));

const MAX_FPS = 120;
const IDLE_FPS = 10;
let last = -Infinity;
let frames = 0;
let lastStats = 0;

renderer.setAnimationLoop((now: number) => {
  const throttled = document.hidden || !focused;
  const minDelta = throttled ? 1000 / IDLE_FPS : 1000 / MAX_FPS - 0.75;
  if (now - last < minDelta) return;
  const dt = Math.min(0.1, last === -Infinity ? 1 / 60 : (now - last) / 1000);
  last = now;

  player.update(dt);
  diner.update(dt);
  renderer.render(scene, camera);

  frames++;
  if (frames === 2) markSceneReady();
  if (DEBUG && now - lastStats > 5000) {
    lastStats = now;
    const r = renderer.info.render;
    console.log(`[render] calls=${r.calls} tris=${r.triangles} programs=${renderer.info.programs?.length ?? "?"}`);
  }
});
