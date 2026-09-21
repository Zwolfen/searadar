export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
export const AISSTREAM_WINDOW_MS = 15_000;

export type ReaderClock = {
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (handle: ReturnType<typeof globalThis.setTimeout>) => void;
};

type ReaderMessageEvent = {
  data: unknown;
};

type ReaderSocket = {
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

export type SnapshotReaderResult =
  | { ok: true; raw: unknown | null; attemptedAt: string; collectedAt: string }
  | {
      ok: false;
      code: "connect_failed" | "provider_error" | "disconnected" | "internal";
      attemptedAt: string;
    };

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

export function readSnapshot({
  apiKey,
  boundingBox,
  socketFactory = createSocket,
  clock = systemClock,
  signal,
}: SnapshotReaderOptions): Promise<SnapshotReaderResult> {
  const attemptedAt = new Date(clock.now()).toISOString();

  return new Promise((resolve) => {
    let socket: ReaderSocket | undefined;
    let timeout: ReturnType<typeof globalThis.setTimeout>;
    let opened = false;
    let subscribed = false;
    let settled = false;

    const finish = (result: SnapshotReaderResult) => {
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
      if (!subscribed) {
        finish({ ok: false, code: "internal", attemptedAt });
        return;
      }

      void decodeMessage((event as ReaderMessageEvent).data)
        .then((raw) => {
          if (
            typeof raw === "object" &&
            raw !== null &&
            "MessageType" in raw &&
            raw.MessageType === "SubscriptionConfirmation"
          ) {
            return;
          }

          finish({
            ok: true,
            raw,
            attemptedAt,
            collectedAt: new Date(clock.now()).toISOString(),
          });
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
        finish({
          ok: true,
          raw: null,
          attemptedAt,
          collectedAt: new Date(clock.now()).toISOString(),
        });
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
