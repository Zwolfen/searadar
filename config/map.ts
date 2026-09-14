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

export type RoutePoint = readonly [number, number];

export interface DemoVesselConfig {
  id: string;
  name: string | null;
  speedKnots: number;
  route: readonly [RoutePoint, RoutePoint, ...RoutePoint[]];
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function calculateBearingDeg(from: RoutePoint, to: RoutePoint): CourseDeg {
  const [fromLat, fromLon] = from.map(toRadians);
  const [toLat, toLon] = to.map(toRadians);
  const deltaLon = toLon - fromLon;
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;

  return createCourseDeg((bearing + 360) % 360) as CourseDeg;
}

export const DEMO_TICK_MS = 2000;

export const DEMO_VESSELS: readonly DemoVesselConfig[] = [
  {
    id: "demo-1",
    name: normalizeVesselName("Демо-судно 1"),
    speedKnots: 12.3,
    route: [
      [50.86, 1.12],
      [50.89, 1.16],
      [50.92, 1.2],
      [50.95, 1.24],
      [50.98, 1.28],
      [51.01, 1.32],
      [51.04, 1.36],
      [51.07, 1.4],
      [51.1, 1.44],
      [51.13, 1.48],
    ],
  },
  {
    id: "demo-2",
    name: normalizeVesselName("Демо-судно 2"),
    speedKnots: 9.8,
    route: [
      [51.1, 1.32],
      [51.12, 1.36],
      [51.14, 1.4],
      [51.16, 1.44],
      [51.18, 1.48],
      [51.2, 1.52],
      [51.18, 1.56],
      [51.16, 1.6],
      [51.14, 1.64],
    ],
  },
  {
    id: "demo-3",
    name: normalizeVesselName("Демо-судно 3"),
    speedKnots: 15.1,
    route: [
      [51.17, 1.78],
      [51.14, 1.74],
      [51.11, 1.7],
      [51.08, 1.66],
      [51.05, 1.62],
      [51.02, 1.58],
      [50.99, 1.54],
      [50.96, 1.5],
      [50.93, 1.46],
      [50.9, 1.42],
      [50.87, 1.38],
    ],
  },
];

export function createInitialDemoVessel(config: DemoVesselConfig, timestamp: string): Vessel {
  const [lat, lon] = config.route[0];

  return {
    id: config.id,
    name: config.name,
    lat,
    lon,
    speedKnots: config.speedKnots,
    courseDeg: calculateBearingDeg(config.route[0], config.route[1]),
    timestamp,
    source: "demo",
  };
}
