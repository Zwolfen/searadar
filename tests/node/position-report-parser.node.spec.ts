import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import type { Vessel } from "../../config/map";
import { parsePositionReport } from "../../server/position-report-parser";

type SampleMessage = {
  MetaData: {
    MMSI?: unknown;
    ShipName?: unknown;
    time_utc?: unknown;
  };
  Message: {
    PositionReport: {
      Latitude?: unknown;
      Longitude?: unknown;
      Sog?: unknown;
      Cog?: unknown;
    };
  };
};

const sample = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/samples/position-report.sample.json"), "utf8"),
) as SampleMessage;

function syntheticMessage(
  update: (message: SampleMessage) => void,
): SampleMessage {
  const message = structuredClone(sample);
  update(message);
  return message;
}

test("PositionReport sample maps to the Vessel fields", () => {
  const result = parsePositionReport(sample);

  const expected: Vessel = {
    id: "538012240",
    name: "ULSAN",
    lat: 51.03220833333333,
    lon: 1.5697583333333334,
    speedKnots: 11.3,
    courseDeg: 40.9 as Vessel["courseDeg"],
    timestamp: "2026-09-17T19:00:44.111Z",
    source: "aisstream",
  };

  expect(result).toEqual(expected);
});

test("synthetic missing and whitespace-only names become null", () => {
  const missingName = syntheticMessage((message) => {
    delete message.MetaData.ShipName;
  });
  const whitespaceName = syntheticMessage((message) => {
    message.MetaData.ShipName = "   \t  ";
  });

  expect(parsePositionReport(missingName)?.name).toBeNull();
  expect(parsePositionReport(whitespaceName)?.name).toBeNull();
});

test("synthetic speed zero is preserved and invalid speeds become null", () => {
  const speedZero = syntheticMessage((message) => {
    message.Message.PositionReport.Sog = 0;
  });
  const speedTooHigh = syntheticMessage((message) => {
    message.Message.PositionReport.Sog = 102.3;
  });
  const speedNegative = syntheticMessage((message) => {
    message.Message.PositionReport.Sog = -1;
  });
  const speedMissing = syntheticMessage((message) => {
    delete message.Message.PositionReport.Sog;
  });

  expect(parsePositionReport(speedZero)?.speedKnots).toBe(0);
  expect(parsePositionReport(speedTooHigh)?.speedKnots).toBeNull();
  expect(parsePositionReport(speedNegative)?.speedKnots).toBeNull();
  expect(parsePositionReport(speedMissing)?.speedKnots).toBeNull();
});

test("synthetic course 360 becomes null", () => {
  const message = syntheticMessage((synthetic) => {
    synthetic.Message.PositionReport.Cog = 360;
  });

  expect(parsePositionReport(message)?.courseDeg).toBeNull();
});

test("synthetic unavailable and out-of-range coordinates discard the position", () => {
  const unavailable = syntheticMessage((message) => {
    message.Message.PositionReport.Latitude = 91;
    message.Message.PositionReport.Longitude = 181;
  });
  const outsideRange = syntheticMessage((message) => {
    message.Message.PositionReport.Latitude = 95;
    message.Message.PositionReport.Longitude = -200;
  });

  expect(parsePositionReport(unavailable)).toBeNull();
  expect(parsePositionReport(outsideRange)).toBeNull();
});

test("synthetic string coordinate discards the position", () => {
  const message = syntheticMessage((synthetic) => {
    synthetic.Message.PositionReport.Latitude = "51.03220833333333";
  });

  expect(parsePositionReport(message)).toBeNull();
});

test("synthetic missing and empty MMSI discard the position", () => {
  const missingMmsi = syntheticMessage((message) => {
    delete message.MetaData.MMSI;
  });
  const emptyMmsi = syntheticMessage((message) => {
    message.MetaData.MMSI = "   ";
  });

  expect(parsePositionReport(missingMmsi)).toBeNull();
  expect(parsePositionReport(emptyMmsi)).toBeNull();
});

test("synthetic unparsable time discards the position", () => {
  const message = syntheticMessage((synthetic) => {
    synthetic.MetaData.time_utc = "not-a-timestamp";
  });

  expect(parsePositionReport(message)).toBeNull();
});
