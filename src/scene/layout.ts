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
  /** Interior half-length along x (11.6 m room). */
  halfX: 5.8,
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
  sill: 0.85,
  head: 2.62,
  /** Horizontal transom bar. */
  transomY: 2.2,
  /** Head bulkhead (blind pocket) between the window head trim and the ceiling grid. */
  headSoffit: { bottom: 2.7, depth: 0.2 },
  /** Centres along x of the 5 front windows; each has a booth in front of it. Pitch 1.8. */
  centersX: [-4.7, -2.9, -1.1, 0.7, 2.5],
} as const;

export const DOOR = {
  /** Rough opening; 50 mm jambs inside it leave a 0.9 × 2.1 clear opening for the leaf. */
  width: 1.0,
  height: 2.15,
  jamb: 0.05,
  /** Reveal between leaf and jamb / head. */
  reveal: 0.004,
  /** Hinge side x; leaf extends toward +x. 1.0 m clear of the last booth partition (vestibule zone). */
  hingeX: 4.45,
  centerX: 4.95,
} as const;

export const BOOTH = {
  pitch: 1.8,
  /** Aisle end and wall end of the seating (z). Table wall edge sits 24 mm off the apron. */
  zInner: 2.0,
  zOuter: 3.21,
  /** Table is inset 120 mm from the end panels; 50 mm corner radii. */
  /** `length` is the x-extent alias the audio harness plan view (src/audio) reads; keep it equal to `width`. */
  table: { width: 0.7, length: 0.7, inset: 0.12, top: 0.75, thickness: 0.038, cornerR: 0.05, band: 0.032 },
  pedestal: { bellR: 0.235, bellRim: 0.04, bossR: 0.075, bossH: 0.09, columnR: 0.045, spider: 0.36 },
  seat: { front: 0.36, depth: 0.45, thickness: 0.14, top: 0.45, edgeR: 0.04 },
  /** Wedge back: front face reclined, rear face vertical against the divider, tapering to the roll. */
  back: { frontX: 0.76, rearX: 0.88, top: 0.97, reclineDeg: 9, rollR: 0.045 },
  divider: { x0: 0.88, x1: 0.92 },
  /** One continuous mitred cap per divider (T in plan: divider + both end panels). */
  cap: { y0: 1.04, y1: 1.08, width: 0.06, bullnose: 0.016 },
  endPanel: 0.04,
  kick: 0.1,
} as const;

export const COUNTER = {
  /** Front (customer) edge of the top. */
  topFrontZ: 0.15,
  overhang: 0.3,
  dieDepth: 0.4,
  height: 1.05,
  topThickness: 0.036,
  xMin: -5.8,
  xMax: 2.0,
  /** L-return at the door end: die x ∈ [xMax, xMax+dieDepth], top out to lReturnXOuter. */
  lReturnXOuter: 2.7,
  lReturnZEnd: -1.15,
  /** Chrome footrail: 36 mm Ø at 230 mm AFF, 130 mm off the die, brackets every 1.2 m. */
  footrest: { y: 0.2, tubeR: 0.018, gap: 0.13, bracketPitch: 1.2 },
  kickHeight: 0.1,
  kickRecess: 0.05,
} as const;

export const STOOL = {
  /** Domed vinyl cushion Ø 370, 90 mm thick, 25 mm crown, 6 mm rolled welt, 22 mm chrome band. */
  seatDiameter: 0.37,
  seatHeight: 0.73,
  seatThickness: 0.09,
  columnR: 0.04,
  baseR: 0.215,
  /** Torus footring: centre 290 mm AFF, ring Ø 0.42, tube Ø 20 mm, on four spokes + collar. */
  footringY: 0.29,
  footringR: 0.21,
  footringTube: 0.01,
  /** Seat centre z: seat front 75 mm from the counter overhang edge. */
  z: 0.4,
  /** 610 mm centre-to-centre; nine stools, the register end of the counter stays clear. */
  pitch: 0.61,
  centersX: [-5.05, -4.44, -3.83, -3.22, -2.61, -2.0, -1.39, -0.78, -0.17],
} as const;

export const BACK_BAR = {
  zFront: -1.95,
  depth: 0.65,
  height: 0.9,
  /** Starts clear of the kitchen door casing at the -x end. */
  xMin: -4.5,
  xMax: 2.4,
  /** Where the coffee warmer lives (System 2/7). */
  coffeeX: -1.4,
  /** Under-counter equipment: reach-in cooler door, and a two-drawer unit. */
  cooler: [-3.9, -2.9] as readonly [number, number],
  drawers: [0.4, 1.1] as readonly [number, number],
  /** Under-counter cabinet bay below the brewer: two hinged laminate doors (System 9, Openables.ts). */
  cabinet: [-2.3, -1.3] as readonly [number, number],
} as const;

/** System 2 tabletop and back-counter props. */
export const PROPS = {
  /** Table sets (dispenser + sugar + S&P) on the counter at every second stool, toward the back edge. */
  /** One set per three stools, centred between a stool pair: 9 stools → 3 sets. */
  napkinCounterX: [-4.135, -2.305, -0.475],
  napkinCounterZ: -0.3,
  /** Stool positions that get an inverted mug on a saucer. */
  saucerStoolX: [-3.22, -0.78],
  saucerZ: -0.08,
  /** Two-burner brewer on the back counter: body footprint and height. */
  /** BUNN VPR-class brewer on the back counter: 411 W × 203 D × 513 H, 50 mm off the wall. */
  brewer: { x: -1.7, zBack: -2.55, width: 0.411, depth: 0.203, height: 0.513 },
  /** Upright mug beside the brewer (filled in System 7). */
  pourMug: { x: -1.36, z: -2.3 },
  /** Stainless drip tray for the inverted mug row. */
  mugLedge: { x0: -2.62, x1: -1.98, z0: -2.52, z1: -2.24 },
  /** Stack of service trays at the L-return end of the back counter. */
  trays: { x: 2.1, z: -2.28, count: 5 },
  /** Wall clock over the pass-through. */
  clock: { x: -0.5, y: 2.03, radius: 0.15, hour: 8, minute: 4 },
} as const;

export const CABINETS = {
  /** Bottoms 450 mm above the 0.9 m back counter. */
  bottom: 1.35,
  top: 2.3,
  depth: 0.3,
  /** Bulkhead from cabinet tops to the ceiling, 60 mm proud of the cabinet faces. */
  soffitDepth: 0.36,
  doorWidth: 0.533,
  /** Two runs flanking the pass-through; the left run stops short to leave a bay for the brewer. */
  runs: [
    [-4.5, -2.05],
    [0.35, 2.4],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

export const PASS_THROUGH = {
  width: 1.4,
  height: 0.6,
  sill: 1.2,
  centerX: -0.5,
  jamb: 0.045,
  /** Stainless shelf through the opening, and the heat-lamp bar above it. */
  shelfDepth: 0.35,
  heatLampAbove: 0.45,
  /** Shallow dark kitchen interior behind the opening. */
  kitchenDepth: 1.7,
  kitchenHalfWidth: 1.6,
} as const;

export const KITCHEN_DOOR = {
  /** Closed swing door at the -x end of the back-bar wall; the service aisle opens onto it. */
  centerX: -5.15,
  width: 0.9,
  height: 2.1,
  jamb: 0.1,
  lite: { w: 0.25, h: 0.75, centerY: 1.45 },
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
  x: -1.3,
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
