import { createCourseDeg, type Vessel } from "../config/map";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function parseMmsi(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.(\d{1,9}) ([+-]\d{4}) UTC$/.exec(
    value,
  );
  if (!match) {
    return null;
  }

  const [, date, time, fraction, offset] = match;
  const milliseconds = fraction.slice(0, 3).padEnd(3, "0");
  const isoOffset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  const parsed = new Date(`${date}T${time}.${milliseconds}${isoOffset}`);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value >= min && value <= max ? value : null;
}

function parseSpeed(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value >= 0 && value <= 102.2 ? value : null;
}

function parseCourse(value: unknown): Vessel["courseDeg"] {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 360) {
    return null;
  }

  return createCourseDeg(value);
}

export function parsePositionReport(message: unknown): Vessel | null {
  if (!isRecord(message) || !isRecord(message.MetaData) || !isRecord(message.Message)) {
    return null;
  }

  const metaData = message.MetaData;
  const messageBody = message.Message;
  if (!isRecord(messageBody.PositionReport)) {
    return null;
  }

  const positionReport = messageBody.PositionReport;
  const id = parseMmsi(metaData.MMSI);
  const lat = parseCoordinate(positionReport.Latitude, -90, 90);
  const lon = parseCoordinate(positionReport.Longitude, -180, 180);
  const timestamp = parseTimestamp(metaData.time_utc);

  if (id === null || lat === null || lon === null || timestamp === null) {
    return null;
  }

  const name = typeof metaData.ShipName === "string" ? metaData.ShipName.trim() || null : null;

  return {
    id,
    name,
    lat,
    lon,
    speedKnots: parseSpeed(positionReport.Sog),
    courseDeg: parseCourse(positionReport.Cog),
    timestamp,
    source: "aisstream",
  };
}
