import { readFileSync } from "node:fs";

import { parsePositionReport } from "../server/position-report-parser";

type Sample = {
  MetaData: {
    MMSI: unknown;
    ShipName: unknown;
    time_utc: unknown;
  };
  Message: {
    PositionReport: {
      Latitude: unknown;
      Longitude: unknown;
      Sog: unknown;
      Cog: unknown;
    };
  };
};

const sample = JSON.parse(
  readFileSync("data/samples/position-report.sample.json", "utf8"),
) as Sample;
const vessel = parsePositionReport(sample);

if (vessel === null) {
  throw new Error("Sample was not converted to a vessel");
}

const sourceValues = {
  id: sample.MetaData.MMSI,
  name: sample.MetaData.ShipName,
  lat: sample.Message.PositionReport.Latitude,
  lon: sample.Message.PositionReport.Longitude,
  speedKnots: sample.Message.PositionReport.Sog,
  courseDeg: sample.Message.PositionReport.Cog,
  timestamp: sample.MetaData.time_utc,
  source: "<нет в sample; константа преобразователя>",
};

for (const field of [
  "id",
  "name",
  "lat",
  "lon",
  "speedKnots",
  "courseDeg",
  "timestamp",
  "source",
] as const) {
  console.log(`${field}: ${JSON.stringify(vessel[field])} ← sample: ${JSON.stringify(sourceValues[field])}`);
}
