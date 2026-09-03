/**
 * Touch controls — the least that lets a phone walk the diner (after jungle-trail's
 * `mobile/touch.js`: drag anywhere to look, one pad to move, nothing else drawn).
 *
 * Left half: a virtual stick; the vector writes the same `KeyW/A/S/D` codes the keyboard
 * does into `FirstPerson.keys`, so acceleration, bob, footsteps and collision are the desktop
 * walk. Right half: a drag turns the head (yaw / pitch on the controller). A short tap on the
 * right half (no drag) is the interact key: it dispatches a `keydown` KeyE, which is what the
 * prompt listens for. Pointer lock is never requested — the canvas's `requestPointerLock` is
 * replaced by a no-op here, because iOS has no Pointer Lock API and Android rejects a request
 * made from a touch gesture (an unhandled rejection either way).
 *
 * Only imported when `isTouchPrimary()` (core/quality.ts) is true; a mouse never downloads it.
 */
import type { FirstPerson } from "./FirstPerson";

const LOOK = 0.0042; // rad / CSS px — a thumb has a screen width of travel, a mouse has a desk
const PITCH_LIMIT = 1.35;
const STICK_RADIUS = 56; // px: full deflection
const DEAD = 0.25;
const TAP_MS = 250, TAP_PX = 12;

export function attachTouch(player: FirstPerson, canvas: HTMLElement): () => void {
  (canvas as unknown as { requestPointerLock: () => Promise<void> }).requestPointerLock = () => Promise.resolve();

  const root = document.createElement("div");
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:15;touch-action:none";
  const ring = document.createElement("div");
  ring.style.cssText = `position:absolute;width:${STICK_RADIUS * 2}px;height:${STICK_RADIUS * 2}px;margin:-${STICK_RADIUS}px;border-radius:50%;border:1.5px solid rgba(255,255,255,.35);background:rgba(255,255,255,.06);display:none`;
  const knob = document.createElement("div");
  knob.style.cssText = "position:absolute;width:44px;height:44px;margin:-22px;border-radius:50%;background:rgba(255,255,255,.45);display:none";
  const hint = document.createElement("div");
  hint.style.cssText = "position:absolute;left:50%;bottom:6%;transform:translateX(-50%);font:12px/1.4 system-ui,sans-serif;color:rgba(255,255,255,.6);text-align:center;letter-spacing:.04em;transition:opacity 1s";
  hint.textContent = "left: walk · right: look · tap: interact";
  root.append(ring, knob, hint);
  document.body.appendChild(root);
  setTimeout(() => (hint.style.opacity = "0"), 6000);

  let stickId: number | null = null, lookId: number | null = null;
  let sx = 0, sy = 0, lx = 0, ly = 0, lookT = 0, lookMoved = 0;
  const keys = player.keys;
  const setKeys = (dx: number, dy: number) => {
    const nx = dx / STICK_RADIUS, ny = dy / STICK_RADIUS;
    const on = (k: string, v: boolean) => (v ? keys.add(k) : keys.delete(k));
    on("KeyW", ny < -DEAD); on("KeyS", ny > DEAD); on("KeyA", nx < -DEAD); on("KeyD", nx > DEAD);
  };
  const clearKeys = () => { for (const k of ["KeyW", "KeyA", "KeyS", "KeyD"]) keys.delete(k); };

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return;
    if (e.clientX < window.innerWidth / 2) {
      if (stickId !== null) return;
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      ring.style.display = knob.style.display = "block";
      ring.style.left = knob.style.left = `${sx}px`;
      ring.style.top = knob.style.top = `${sy}px`;
    } else {
      if (lookId !== null) return;
      lookId = e.pointerId; lx = e.clientX; ly = e.clientY; lookT = performance.now(); lookMoved = 0;
    }
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      let dx = e.clientX - sx, dy = e.clientY - sy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
      knob.style.left = `${sx + dx}px`; knob.style.top = `${sy + dy}px`;
      setKeys(dx, dy);
      e.preventDefault();
    } else if (e.pointerId === lookId) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lookMoved += Math.abs(dx) + Math.abs(dy);
      player.yaw -= dx * LOOK;
      player.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, player.pitch - dy * LOOK));
      lx = e.clientX; ly = e.clientY;
      e.preventDefault();
    }
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      stickId = null; clearKeys();
      ring.style.display = knob.style.display = "none";
    } else if (e.pointerId === lookId) {
      lookId = null;
      if (performance.now() - lookT < TAP_MS && lookMoved < TAP_PX) {
        // Tap = interact. The interactions listen on document keydown for KeyE.
        document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE", key: "e", bubbles: true }));
        document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyE", key: "e", bubbles: true }));
      }
    }
  };
  const releaseAll = () => { stickId = lookId = null; clearKeys(); ring.style.display = knob.style.display = "none"; };

  canvas.style.touchAction = "none";
  window.addEventListener("pointerdown", down, { passive: false });
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", releaseAll);

  return () => {
    releaseAll();
    window.removeEventListener("pointerdown", down);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("blur", releaseAll);
    document.removeEventListener("visibilitychange", releaseAll);
    root.remove();
  };
}
