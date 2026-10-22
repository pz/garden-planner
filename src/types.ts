export type SunExposure = 'full-sun' | 'part-shade' | 'shade';

export type CropFamily =
  | 'nightshade'
  | 'brassica'
  | 'root'
  | 'allium'
  | 'legume'
  | 'leafy'
  | 'cucurbit'
  | 'herb'
  | 'flower'
  | 'grain'
  | 'perennial'
  /** The gardener's own plants (see `CropDef.look`). */
  | 'custom';

export type SowMethod = 'transplant' | 'direct-sow';

/** How a user-made plant is drawn: like a built-in plant, or a generic shape with leaf and flower/fruit colors. */
export interface CropLook {
  like?: string;
  shape?: string;
  leaf?: string;
  accent?: string;
}

/** Static, codified plant info — never LLM-generated. A user-made plant (`look` set) is the one runtime-added kind. */
export interface CropDef {
  id: string;
  name: string;
  family: CropFamily;
  /** Minimum center-to-center spacing between plants of this crop, in inches. */
  spacingIn: number;
  /** Whether this crop is normally grown as a multi-plant patch. */
  defaultPatch: boolean;
  sowMethod: SowMethod;
  /** For transplants: weeks before last frost to start seeds indoors. */
  startIndoorsWeeksBeforeLastFrost?: number;
  /** For transplants: weeks after last frost it's safe to move outside. */
  transplantWeeksAfterLastFrost?: number;
  /** For direct-sow crops: weeks relative to last frost to sow outside (negative = before). */
  directSowWeeksRelativeToLastFrost?: number;
  /** Days from sowing/transplanting outside to first harvest. 0 for a user-made plant, which has no schedule. */
  daysToMaturity: number;
  /** Typical mature height, in inches (varies by variety); what the shade rule compares. 0 for a user-made plant whose height isn't known. */
  heightIn: number;
  /** How much sun it needs: `full` (about 6+ hours; shade hurts it) or `partial` (tolerates some shade). */
  sunNeed: SunNeed;
  /** Crops usually kept away from this one (the pair counts whichever side lists it), each with why and how well supported. */
  avoidNear?: AvoidNear[];
  /** Set only on a user-made plant: how it's drawn. Its presence is what makes a crop custom. */
  look?: CropLook;
}

export type SunNeed = 'full' | 'partial';

export interface AvoidNear {
  cropId: string;
  /** Short reason, shown to the user. */
  reason: string;
  /** `extension`: backed by a university extension source. `anecdotal`: traditional advice without good evidence. */
  evidence: 'extension' | 'anecdotal';
}

/** Where the garden is, as picked on the setup screen's map. */
export interface GardenLocation {
  lat: number;
  /** Normalized to [-180, 180). */
  lng: number;
  /** Human-readable place name from search or reverse geocoding, if we have one. */
  label?: string;
}

export interface Profile {
  zoneId: string;
  sunExposure: SunExposure;
  onboarded: boolean;
  /** Absent for gardens set up before the map picker, or if the user never placed a pin. */
  location?: GardenLocation;
}

/** A single planted instance, in inches from its bed's (unrotated) top-left corner. */
export interface PlantInstance {
  id: string;
  /** The bed this plant grows in; its x/y are local to that bed. */
  bedId: string;
  cropId: string;
  x: number;
  y: number;
  variety?: string;
  /** Instances sharing a groupId are one patch — moved, warned, and dismissed as a unit. */
  groupId: string;
}

export interface Point {
  x: number;
  y: number;
}

export type BedShape = 'rect' | 'ellipse' | 'polygon';

/** One bed in the garden layout. Garden coordinates are inches, y pointing down. */
export interface Bed {
  id: string;
  name: string;
  shape: BedShape;
  /** Center of the bed, in garden coordinates. */
  cx: number;
  cy: number;
  widthIn: number;
  heightIn: number;
  /**
   * Clockwise rotation about the center, in degrees. Stored now so turning beds later needs no
   * data migration; nothing sets it to anything but 0 yet.
   */
  rotationDeg: number;
  /**
   * Polygon beds only (and always present on them): the corners, in order, in the bed's local
   * frame. They span exactly 0…widthIn and 0…heightIn, so the box handles fit the shape.
   */
  points?: Point[];
  /** Rectangular beds only: how rounded the corners are, in inches. Absent means the default. */
  cornerRadiusIn?: number;
}

/** A straight line drawn on the layout (a path, fence, hose…), in garden coordinates. */
export interface GardenLine {
  id: string;
  a: Point;
  b: Point;
}

export interface GardenPlan {
  version: 3;
  /** Identifies this garden among the user's saved gardens; also its localStorage key. */
  id: string;
  name: string;
  profile: Profile;
  /**
   * Which way geographic north points on the layout, in degrees clockwise from straight up the
   * screen (90 = north is to the right). Absent means 0: north is up. Shade prediction needs it
   * to know where the sun is relative to the beds.
   */
  northDeg?: number;
  beds: Bed[];
  plants: PlantInstance[];
  /** Lines drawn on the layout. Absent means none. */
  lines?: GardenLine[];
  /** Canonical (sorted, "::"-joined) groupId pairs whose overlap warning the user dismissed. */
  dismissedConflictKeys: string[];
  /** Ids of dismissed shade and companion warnings (spacing ones are in `dismissedConflictKeys`). Absent means none. */
  dismissedWarnings?: string[];
}
