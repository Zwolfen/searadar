export const MAP_BOUNDS: [[number, number], [number, number]] = [
  [50.75, 0.95],
  [51.25, 1.95],
];

export const MAP_CENTER: [number, number] = [51.0, 1.45];
export const MAP_ZOOM = 10;
export const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION = "© OpenStreetMap contributors";

export type VesselSource = "demo" | "aisstream";
export type CourseDeg = number & { readonly __courseDeg: unique symbol };

export interface Vessel {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  speedKnots: number | null;
  courseDeg: CourseDeg | null;
  timestamp: string;
  source: VesselSource;
}

export function normalizeVesselName(name: string | null): string | null {
  return name === "" ? null : name;
}

export function createCourseDeg(value: number | null): CourseDeg | null {
  if (value === null) {
    return null;
  }

  if (value < 0 || value >= 360 || !Number.isFinite(value)) {
    throw new RangeError("courseDeg must be in the range [0, 360)");
  }

  return value as CourseDeg;
}

export const DEMO_VESSEL: Vessel = {
  id: "demo-1",
  name: normalizeVesselName("Демо-судно 1"),
  lat: 51.0,
  lon: 1.45,
  speedKnots: 12.3,
  courseDeg: createCourseDeg(135),
  timestamp: "2026-01-01T12:00:00Z",
  source: "demo",
};
