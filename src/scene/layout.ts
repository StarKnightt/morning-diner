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
  wallThickness: 0.2,
  /** Exterior ground sits this far below the interior floor slab. */
  slabDrop: 0.15,
} as const;

export const WINDOW = {
  width: 1.6,
  height: 1.5,
  sill: 0.9,
  /** Centres along x of the 5 front windows; each has a booth in front of it. */
  centersX: [-4.4, -2.6, -0.8, 1.0, 2.8],
} as const;

export const DOOR = {
  width: 0.9,
  height: 2.1,
  /** Hinge side x (door swings on this edge); leaf extends toward +x. */
  hingeX: 4.15,
  centerX: 4.6,
} as const;

export const BOOTH = {
  /** Booths sit against the window wall and project into the room by this much. */
  depth: 1.4,
  table: { length: 1.2, width: 0.7, top: 0.75, thickness: 0.04 },
  bench: { depth: 0.5, seatHeight: 0.45, backHeight: 1.0, length: 1.2 },
  /** Distance from booth centre x to the centre of each bench. */
  benchOffset: 0.6,
} as const;

export const COUNTER = {
  /** Front face (customer side) and back face z. */
  zFront: 0.15,
  depth: 0.6,
  height: 1.05,
  xMin: -5.5,
  xMax: 2.0,
  overhang: 0.08,
  /** The L-return at the door end runs from the counter back toward this z. */
  lReturnZ: -1.15,
} as const;

export const KITCHEN_DOOR = {
  /** Closed swing door in the kitchen partition, near the door end. */
  centerX: 4.4,
  width: 0.9,
  height: 2.1,
} as const;

export const STOOL = {
  seatDiameter: 0.35,
  seatHeight: 0.72,
  z: 0.72,
  centersX: [-4.55, -3.85, -3.15, -2.45, -1.75, -1.05, -0.35, 0.35],
} as const;

export const BACK_BAR = {
  zFront: -1.95,
  depth: 0.65,
  height: 0.9,
  xMin: -5.5,
  xMax: 2.0,
  /** Where the coffee warmer will live (System 2/7). */
  coffeeX: -1.4,
} as const;

export const PASS_THROUGH = {
  width: 1.4,
  height: 0.6,
  sill: 1.2,
  centerX: -0.5,
} as const;

export const CEILING = {
  tile: 0.6,
  /** T-bar rail depth below the tile plane. */
  railDrop: 0.025,
  railWidth: 0.024,
  troffer: { w: 1.2, d: 0.6 },
  /** Troffer centres (x, z). Aligned to the 0.6 grid. */
  troffers: [
    [-3.9, 1.0], [-1.5, 1.0], [0.9, 1.0], [3.3, 1.0],
    [-3.9, -1.1], [-1.5, -1.1], [0.9, -1.1], [3.3, -0.5],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const FAN = {
  x: -1.0,
  z: 1.05,
  downrod: 0.3,
  bladeSpan: 1.32,
  rpm: 40,
} as const;

export const AC_UNIT = {
  /** Mounted in the -x end wall. */
  z: 0.9,
  centerY: 2.05,
  w: 0.66,
  h: 0.42,
  d: 0.7,
} as const;

export const PLAYER = {
  eyeHeight: 1.65,
  radius: 0.28,
  walkSpeed: 1.4,
  start: { x: DOOR.centerX, z: ROOM.zFront + 1.5, yawDeg: 0, pitchDeg: 0 },
} as const;
