/**
 * Transmission-buffer resolution for the storefront panes (window glass, door glass).
 *
 * Lighting.ts runs three's transmission pass at half resolution (renderer
 * `transmissionResolutionScale` 0.5, measured: 3.4 → 0.5 ms at `length`) on the grounds that
 * what is behind the panes is the lot — low-frequency content that survives a 960 × 540 buffer.
 * That holds from every player pose inside the room, where the blinds hang in FRONT of the
 * glass and draw in the main pass at full resolution.
 *
 * From the lot the same blinds sit BEHIND the glass, so they render into the transmission
 * buffer instead: a 1" slat pitch is ≈ 2.5 px at 1080p and 1.25 px in the half-size buffer,
 * below the Nyquist limit even with the buffer's 4× MSAA. The beat between the slat pitch and
 * the buffer's rows changes with perspective across each pane, so the aliasing forms curved
 * bands, and the bicubic upsample then smears them into the "melting" slats of the fix-glass
 * report (shots/fix-glass-before-exterior.png). Roughness, the dust/smudge roughness map,
 * DoubleSide, thickness and ior were each A/B'd to zero with no change; `?txscale=1` alone
 * gave straight slats.
 *
 * So the buffer is full-size only while the camera is on the lot side of the pane's plane,
 * and Lighting's value (or the `?txscale` override) is restored the moment it is back inside.
 * The switch runs in the panes' `onBeforeRender`, which three calls for the transmission pass
 * and the main pass alike; the renderer reads the scale at the start of `render()`, so a
 * change lands on the next frame. Only poses with a pane in the frustum ever pay for it.
 */
import type * as THREE from "three";

let lotSide = false;
let insideScale = 0.5;

export function installLotSideTransmission(pane: THREE.Mesh, planeZ: number): void {
  const prev = pane.onBeforeRender;
  pane.onBeforeRender = function (this: THREE.Mesh, renderer, scene, camera, geometry, material, group) {
    // World z of the camera (the pose rig may parent it); positive is toward the lot.
    const outside = camera.matrixWorld.elements[14] > planeZ;
    if (outside !== lotSide) {
      if (outside) {
        insideScale = renderer.transmissionResolutionScale;
        renderer.transmissionResolutionScale = 1;
      } else {
        renderer.transmissionResolutionScale = insideScale;
      }
      lotSide = outside;
    }
    prev.call(this, renderer, scene, camera, geometry, material, group);
  };
}
