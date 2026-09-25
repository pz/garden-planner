export type SunExposure = 'full-sun' | 'part-shade' | 'shade';

export type CropFamily =
  | 'fruiting'
  | 'brassica'
  | 'root'
  | 'allium'
  | 'legume'
  | 'leafy'
  | 'cucurbit'
  | 'herb';

export type SowMethod = 'transplant' | 'direct-sow';

/** Static, codified plant info — never LLM-generated. */
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
  /** Days from sowing/transplanting outside to first harvest. */
  daysToMaturity: number;
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

/** A single planted instance, in inches from the bed's top-left corner. */
export interface PlantInstance {
  id: string;
  cropId: string;
  x: number;
  y: number;
  variety?: string;
  /** Instances sharing a groupId are one patch — moved, warned, and dismissed as a unit. */
  groupId: string;
}

export interface Bed {
  id: string;
  name: string;
  widthIn: number;
  heightIn: number;
}

export interface GardenPlan {
  version: 2;
  /** Identifies this garden among the user's saved gardens; also its localStorage key. */
  id: string;
  profile: Profile;
  bed: Bed;
  plants: PlantInstance[];
  /** Canonical (sorted, "::"-joined) groupId pairs whose overlap warning the user dismissed. */
  dismissedConflictKeys: string[];
}
