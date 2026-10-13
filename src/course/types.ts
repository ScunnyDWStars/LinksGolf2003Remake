/**
 * Holes are authored in "plan" coordinates: [x, f] where x is metres to the right of the tee-line and
 * f is metres forward from the tee. The terrain converts these to world space (x, z = -f) so that the
 * player looks down -Z from the tee, matching Three.js' default camera orientation.
 */
export type P = readonly [x: number, f: number];

export interface EllipseSpec {
  at: P;
  rx: number;
  rz: number;
  /** Rotation in degrees (clockwise seen from above). */
  rot?: number;
}

export interface BunkerSpec extends EllipseSpec {
  depth?: number;
}

export type WaterSpec =
  | ({ kind: 'pond' } & EllipseSpec)
  | { kind: 'burn'; points: readonly P[]; width: number };

export interface TreeCluster {
  at: P;
  radius: number;
  count: number;
  kind: 'pine' | 'gorse' | 'birch';
}

export interface GreenSpec extends EllipseSpec {
  /** Grade (rise per metre) along x and f. Back-to-front slope = positive f component. */
  slope: P;
  /** Height of the green's internal undulations, metres. */
  undulation?: number;
}

export interface HoleSpec {
  number: number;
  name: string;
  par: 3 | 4 | 5;
  handicap: number;
  tee: P;
  /** Tee to green centre, through the landing zones. */
  centerline: readonly P[];
  fairwayWidth: number;
  /** Distance along the centerline where the fairway begins (carry from the tee over rough). */
  fairwayStart: number;
  green: GreenSpec;
  /** Pin position relative to the green centre. */
  pin: P;
  bunkers: readonly BunkerSpec[];
  water: readonly WaterSpec[];
  trees: readonly TreeCluster[];
  elevation: { tee: number; green: number; dunes: number };
  /** Out-of-bounds stakes, lateral metres from the centerline. Omit a side for no OB there. */
  ob?: { left?: number; right?: number };
  /** Extra mound on the line of play (blind shots), as an ellipse with a height. */
  mounds?: readonly (EllipseSpec & { height: number })[];
}

export interface CourseSpec {
  name: string;
  location: string;
  holes: readonly HoleSpec[];
}
