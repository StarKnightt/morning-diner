/**
 * Floor plan of the diner, in metres. Single source of truth for every system:
 * geometry (System 1), lighting (4), sound emitters (6) and interactions (7)
 * all read positions from here rather than hard-coding them.
 *
 * Axes: +x runs the length of the room (door end is +x), +z is toward the
 * parking lot (the window wall), +y is up. Origin is at floor level in the
 * middle of the dining room.
 */

export const ROOM = {
  /** Interior half-length along x. */
  halfX: 5.5,
  /** Interior z extents: partition to the kitchen at zBack, window wall at zFront. */
  zBack: -2.6,
  zFront: 3.25,
  height: 2.9,
  wallThickness: 0.25,
  /** Exterior ground sits this far below the interior floor slab. */
  slabDrop: 0.15,
} as const;

export const WINDOW = {
  width: 1.35,
  sill: 0.82,
  head: 2.62,
  /** Horizontal transom bar. */
  transomY: 2.2,
  /** Centres along x of the 5 front windows; each has a booth in front of it. Pitch 1.8. */
  centersX: [-4.4, -2.6, -0.8, 1.0, 2.8],
} as const;

export const DOOR = {
  /** Rough opening; 50 mm jambs inside it leave a 0.9 × 2.1 clear opening for a 0.88 m leaf. */
  width: 1.0,
  height: 2.15,
  jamb: 0.05,
  /** Hinge side x (door swings on this edge); leaf extends toward +x. */
  hingeX: 4.15,
  centerX: 4.65,
} as const;

export const BOOTH = {
  pitch: 1.8,
  /** Aisle end and wall end of the seating (z). */
  zInner: 2.0,
  zOuter: 3.2,
  table: { width: 0.7, length: 1.2, top: 0.75, thickness: 0.038, cornerR: 0.03, band: 0.025 },
  seat: { front: 0.36, depth: 0.45, thickness: 0.14, top: 0.45, edgeR: 0.04 },
  back: { frontX: 0.79, rearX: 0.88, top: 0.99, reclineDeg: 8, rollR: 0.045 },
  divider: { x0: 0.88, x1: 0.92 },
  cap: { y0: 1.05, y1: 1.08, proud: 0.03 },
  kick: 0.1,
} as const;

export const COUNTER = {
  /** Front (customer) edge of the top. */
  topFrontZ: 0.15,
  overhang: 0.3,
  dieDepth: 0.4,
  height: 1.05,
  topThickness: 0.04,
  xMin: -5.5,
  xMax: 2.0,
  /** L-return at the door end: die x ∈ [xMax, xMax+dieDepth], top out to lReturnXOuter. */
  lReturnXOuter: 2.7,
  lReturnZEnd: -1.15,
  /** Register / pie-case cabinet block on the top, x range. */
  register: { x0: 1.25, x1: 1.85 },
  footrest: { y: 0.22, tubeR: 0.02, gap: 0.05, bracketPitch: 1.2 },
} as const;

export const STOOL = {
  seatDiameter: 0.35,
  seatHeight: 0.73,
  seatThickness: 0.08,
  columnR: 0.04,
  baseR: 0.21,
  footringY: 0.25,
  footringR: 0.2,
  /** Seat centre z: seat front 75 mm from the counter overhang edge. */
  z: 0.4,
  pitch: 0.6,
  centersX: [-4.9, -4.3, -3.7, -3.1, -2.5, -1.9, -1.3, -0.7, -0.1, 0.5],
} as const;

export const BACK_BAR = {
  zFront: -1.95,
  depth: 0.65,
  height: 0.9,
  xMin: -5.5,
  xMax: 2.4,
  /** Where the coffee warmer lives (System 2/7). */
  coffeeX: -1.4,
  /** Under-counter equipment openings in the die, x ranges. */
  openings: [
    [-4.6, -3.6],
    [0.4, 1.1],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const CABINETS = {
  bottom: 1.45,
  top: 2.3,
  depth: 0.35,
  soffitDepth: 0.45,
  doorWidth: 0.525,
  /** Two runs flanking the pass-through. */
  runs: [
    [-5.5, -1.3],
    [0.3, 2.4],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const PASS_THROUGH = {
  width: 1.4,
  height: 0.6,
  sill: 1.2,
  centerX: -0.5,
  jamb: 0.045,
  shelfDepth: 0.25,
} as const;

export const KITCHEN_DOOR = {
  /** Closed swing door in the kitchen partition, at the open end of the service aisle. */
  centerX: 3.35,
  width: 0.9,
  height: 2.1,
  jamb: 0.1,
} as const;

export const REGISTER = {
  /** Supply register high on the -x end wall. */
  z: 0.9,
  w: 0.6,
  h: 0.3,
  top: 2.8,
} as const;

export const CEILING = {
  tile: 0.6,
  teeDepth: 0.025,
  mainFace: 0.024,
  crossFace: 0.015,
  tegularDrop: 0.006,
  /** Troffers occupy two cells (i, i+1) × j. Cell (i, j) spans x∈[-halfX+0.6i, +0.6), z∈[zBack+0.6j, +0.6). */
  troffers: [
    [2, 6], [8, 6], [14, 6],
    [2, 2], [8, 2], [14, 2],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export function cellX(i: number): number {
  return -ROOM.halfX + i * CEILING.tile;
}
export function cellZ(j: number): number {
  return ROOM.zBack + j * CEILING.tile;
}
/** World centre of a troffer given its cell indices. */
export function trofferCenter([i, j]: readonly [number, number]): [number, number] {
  return [cellX(i) + CEILING.tile, cellZ(j) + CEILING.tile / 2];
}

export const FAN = {
  /** Centre of cell (7, 6). */
  x: -1.0,
  z: 1.3,
  downrod: 0.4,
  housingR: 0.1,
  bladeSpan: 1.32,
  rpm: 40,
} as const;

export const PLAYER = {
  eyeHeight: 1.62,
  radius: 0.28,
  walkSpeed: 1.4,
  start: { x: DOOR.centerX, z: ROOM.zFront + 1.6, yawDeg: 0, pitchDeg: 0 },
} as const;
