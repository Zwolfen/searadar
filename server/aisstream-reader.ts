import type { Vessel } from "../config/map";
import { parsePositionReport } from "./position-report-parser";

export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
export const AISSTREAM_WINDOW_MS = 15_000;
export const AISSTREAM_MAX_VESSELS = 100;

export type ReaderClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
};

type ReaderMessageEvent = {
  data: unknown;
};

export type ReaderSocket = {
  addEventListener: (
    event: string,
    listener: (event: Event | ReaderMessageEvent) => void,
  ) => void;
  removeEventListener: (
    event: string,
    listener: (event: Event | ReaderMessageEvent) => void,
  ) => void;
  send: (data: string) => void;
  close: () => void;
  binaryType?: string;
  readyState?: number;
};

export type ReaderSocketFactory = (url: string) => ReaderSocket;

export type SnapshotReaderOptions = {
  apiKey: string;
  boundingBox: readonly [readonly [number, number], readonly [number, number]];
  socketFactory?: ReaderSocketFactory;
  clock?: ReaderClock;
  signal?: AbortSignal;
};

type SnapshotCollectionSuccess = {
  ok: true;
  vessels: Vessel[];
  collectedAt: string;
  windowSeconds: number;
  count: number;
  truncated: boolean;
  reason: "window_elapsed" | "limit_reached";
};

type SnapshotCollectionFailure = {
  ok: false;
  code: "connect_failed" | "provider_error" | "disconnected" | "internal";
  attemptedAt: string;
};

export type SnapshotCollectionResult = SnapshotCollectionSuccess | SnapshotCollectionFailure;

const systemClock: ReaderClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

const createSocket: ReaderSocketFactory = (url) => {
  const socket = new globalThis.WebSocket(url) as unknown as ReaderSocket;
  socket.binaryType = "arraybuffer";
  return socket;
};

async function decodeMessage(data: unknown): Promise<unknown> {
  if (typeof data === "string") {
    return JSON.parse(data);
  }

  if (data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(new Uint8Array(data)));
  }

  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return JSON.parse(await data.text());
  }

  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return JSON.parse(
      new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
    );
  }

  throw new TypeError("Unsupported WebSocket message data");
}

function isSubscriptionConfirmation(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "MessageType" in value &&
    value.MessageType === "SubscriptionConfirmation"
  );
}

function isProviderError(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "MessageType" in value &&
    value.MessageType === "Error"
  );
}

function createSuccess(
  vessels: Map<string, Vessel>,
  clock: ReaderClock,
  reason: SnapshotCollectionSuccess["reason"],
  truncated: boolean,
): SnapshotCollectionSuccess {
  const values = [...vessels.values()];

  return {
    ok: true,
    vessels: values,
    collectedAt: new Date(clock.now()).toISOString(),
    windowSeconds: AISSTREAM_WINDOW_MS / 1000,
    count: values.length,
    truncated,
    reason,
  };
}

export function collectSnapshot({
  apiKey,
  boundingBox,
  socketFactory = createSocket,
  clock = systemClock,
  signal,
}: SnapshotReaderOptions): Promise<SnapshotCollectionResult> {
  const attemptedAt = new Date(clock.now()).toISOString();

  return new Promise((resolve) => {
    let socket: ReaderSocket | undefined;
    let timeout: ReturnType<typeof globalThis.setTimeout>;
    let opened = false;
    let subscribed = false;
    let settled = false;
    const vessels = new Map<string, Vessel>();

    const finish = (result: SnapshotCollectionResult) => {
      if (settled) {
        return;
      }

      settled = true;
      clock.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (socket) {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("message", handleMessage);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
        if (socket.readyState === undefined || socket.readyState < 2) {
          socket.close();
        }
      }
      resolve(result);
    };

    const handleOpen = () => {
      opened = true;
      try {
        socket?.send(
          JSON.stringify({
            APIKey: apiKey,
            BoundingBoxes: [boundingBox],
            FilterMessageTypes: ["PositionReport"],
          }),
        );
        subscribed = true;
      } catch {
        finish({ ok: false, code: "internal", attemptedAt });
      }
    };

    const handleMessage = (event: Event | ReaderMessageEvent) => {
      if (settled || !subscribed) {
        return;
      }

      void decodeMessage((event as ReaderMessageEvent).data)
        .then((raw) => {
          if (settled || isSubscriptionConfirmation(raw)) {
            return;
          }

          if (isProviderError(raw)) {
            finish({ ok: false, code: "provider_error", attemptedAt });
            return;
          }

          const vessel = parsePositionReport(raw);
          if (vessel === null) {
            return;
          }

          const previous = vessels.get(vessel.id);
          if (previous === undefined) {
            vessels.set(vessel.id, vessel);
          } else {
            const previousTime = Date.parse(previous.timestamp);
            const nextTime = Date.parse(vessel.timestamp);
            if (nextTime > previousTime) {
              vessels.set(vessel.id, vessel);
            }
            return;
          }

          if (vessels.size === AISSTREAM_MAX_VESSELS) {
            finish(createSuccess(vessels, clock, "limit_reached", true));
          }
        })
        .catch(() => {
          finish({ ok: false, code: "provider_error", attemptedAt });
        });
    };

    const handleError = () => {
      finish({
        ok: false,
        code: opened ? "provider_error" : "connect_failed",
        attemptedAt,
      });
    };

    const handleClose = () => {
      if (settled) {
        return;
      }

      finish({
        ok: false,
        code: opened ? "disconnected" : "connect_failed",
        attemptedAt,
      });
    };

    const abort = () => {
      finish({ ok: false, code: "disconnected", attemptedAt });
    };

    timeout = clock.setTimeout(() => {
      if (opened && subscribed) {
        finish(createSuccess(vessels, clock, "window_elapsed", false));
      } else {
        finish({ ok: false, code: "connect_failed", attemptedAt });
      }
    }, AISSTREAM_WINDOW_MS);

    signal?.addEventListener("abort", abort, { once: true });

    try {
      socket = socketFactory(AISSTREAM_URL);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("message", handleMessage);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    } catch {
      finish({ ok: false, code: "connect_failed", attemptedAt });
    }
  });
}
