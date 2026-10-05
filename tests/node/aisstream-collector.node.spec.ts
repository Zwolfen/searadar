import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import {
  AISSTREAM_MAX_VESSELS,
  AISSTREAM_URL,
  AISSTREAM_WINDOW_MS,
  collectSnapshot,
  type ReaderClock,
  type ReaderSocket,
} from "../../server/aisstream-reader";

const sample = JSON.parse(
  readFileSync(resolve(process.cwd(), "data/samples/position-report.sample.json"), "utf8"),
) as Record<string, any>;
const startTime = Date.parse("2026-01-01T12:00:00Z");

type Listener = (event: Event | { data: unknown }) => void;

class FakeSocket implements ReaderSocket {
  binaryType = "arraybuffer";
  readyState = 1;
  closeCalls = 0;
  sent: string[] = [];
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeEventListener(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = 3;
  }

  emit(event: string, payload: unknown = {}): void {
    const eventPayload = event === "message" ? { data: payload } : payload;
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(eventPayload as Event | { data: unknown });
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }
}

class FakeClock implements ReaderClock {
  currentTime = startTime;
  setCalls = 0;
  clearCalls = 0;
  private callbacks = new Map<number, () => void>();
  private nextId = 1;

  now = (): number => this.currentTime;

  setTimeout = (callback: () => void, delayMs: number): ReturnType<typeof globalThis.setTimeout> => {
    expect(delayMs).toBe(AISSTREAM_WINDOW_MS);
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    this.setCalls += 1;
    return id as unknown as ReturnType<typeof globalThis.setTimeout>;
  };

  clearTimeout = (handle: ReturnType<typeof globalThis.setTimeout>): void => {
    this.callbacks.delete(handle as unknown as number);
    this.clearCalls += 1;
  };

  advanceTo(isoTime: string): void {
    this.currentTime = Date.parse(isoTime);
  }

  fireTimeout(): void {
    const pending = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of pending) {
      callback();
    }
  }

  pendingCount(): number {
    return this.callbacks.size;
  }
}

function createHarness() {
  const socket = new FakeSocket();
  const clock = new FakeClock();
  const controller = new AbortController();
  const result = collectSnapshot({
    apiKey: "test-key-not-a-secret",
    boundingBox: [
      [50.75, 0.95],
      [51.25, 1.95],
    ],
    socketFactory: (url) => {
      expect(url).toBe(AISSTREAM_URL);
      return socket;
    },
    clock,
    signal: controller.signal,
  });

  return { socket, clock, controller, result };
}

function syntheticPositionReport(
  id: number,
  options: {
    time?: string;
    lat?: number;
    lon?: number;
    name?: string | null;
  } = {},
): Record<string, any> {
  const message = structuredClone(sample);
  message.MetaData.MMSI = id;
  message.MetaData.ShipName = options.name === undefined ? `VESSEL-${id}` : options.name;
  message.MetaData.time_utc = `${options.time ?? "2026-01-01 12:00:00.000000000 +0000 UTC"}`;
  message.Message.PositionReport.Latitude = options.lat ?? 51.1;
  message.Message.PositionReport.Longitude = options.lon ?? 1.5;
  return message;
}

function emitPosition(socket: FakeSocket, report: Record<string, any>): void {
  socket.emit("message", JSON.stringify(report));
}

async function flushMessages(): Promise<void> {
  await Promise.resolve();
}

function assertCleaned(socket: FakeSocket, clock: FakeClock): void {
  expect(socket.closeCalls).toBe(1);
  expect(socket.listenerCount()).toBe(0);
  expect(clock.pendingCount()).toBe(0);
  expect(clock.clearCalls).toBe(1);
}

test("два одинаковых сообщения о судне A дают один объект", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  const report = syntheticPositionReport(111000111);
  emitPosition(socket, report);
  emitPosition(socket, report);
  await flushMessages();
  clock.advanceTo("2026-01-01T12:00:15Z");
  clock.fireTimeout();

  const response = await result;
  expect(response).toMatchObject({ ok: true, count: 1, reason: "window_elapsed", truncated: false });
  if (response.ok) expect(response.vessels).toHaveLength(1);
  assertCleaned(socket, clock);
});

test("для A сохраняется сообщение с более новым time_utc", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  emitPosition(socket, syntheticPositionReport(111000111, { time: "2026-01-01 12:01:00.000000000 +0000 UTC", lat: 51.2, lon: 1.7 }));
  emitPosition(socket, syntheticPositionReport(111000111, { time: "2026-01-01 12:00:00.000000000 +0000 UTC", lat: 51.1, lon: 1.5 }));
  await flushMessages();
  clock.advanceTo("2026-01-01T12:01:15Z");
  clock.fireTimeout();

  const response = await result;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.count).toBe(1);
    expect(response.vessels[0].lat).toBe(51.2);
    expect(response.vessels[0].lon).toBe(1.7);
  }
  assertCleaned(socket, clock);
});

test("при одинаковой метке времени остаётся первая позиция A", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  emitPosition(socket, syntheticPositionReport(111000111, { lat: 51.2, lon: 1.7 }));
  emitPosition(socket, syntheticPositionReport(111000111, { lat: 51.1, lon: 1.5 }));
  await flushMessages();
  clock.advanceTo("2026-01-01T12:00:15Z");
  clock.fireTimeout();

  const response = await result;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.vessels[0].lat).toBe(51.2);
    expect(response.vessels[0].lon).toBe(1.7);
  }
  assertCleaned(socket, clock);
});

test("100 уникальных судов завершают сбор лимитом и 101-е не принимается", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  for (let id = 1; id <= 100; id += 1) {
    emitPosition(socket, syntheticPositionReport(100000000 + id));
  }
  emitPosition(socket, syntheticPositionReport(100000101));

  const response = await result;
  expect(AISSTREAM_MAX_VESSELS).toBe(100);
  expect(response).toMatchObject({ ok: true, count: 100, reason: "limit_reached", truncated: true });
  if (response.ok) expect(response.vessels).toHaveLength(100);
  assertCleaned(socket, clock);
});

test("100 сообщений одного судна дают один объект и сбор продолжается до окна", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  for (let index = 0; index < 100; index += 1) {
    emitPosition(socket, syntheticPositionReport(111000111, {
      time: "2026-01-01 12:00:00.000000000 +0000 UTC",
      lat: 51.1 + index / 1000,
    }));
  }
  await flushMessages();

  expect(clock.pendingCount()).toBe(1);
  expect(socket.closeCalls).toBe(0);
  clock.advanceTo("2026-01-01T12:00:15Z");
  clock.fireTimeout();

  const response = await result;
  expect(response).toMatchObject({ ok: true, count: 1, reason: "window_elapsed", truncated: false });
  assertCleaned(socket, clock);
});

test("живое соединение без сообщений завершается пустым успехом по окну", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  clock.advanceTo("2026-01-01T12:00:15Z");
  clock.fireTimeout();

  const response = await result;
  expect(response).toMatchObject({ ok: true, vessels: [], count: 0, reason: "window_elapsed", truncated: false });
  assertCleaned(socket, clock);
});

test("соединение, не открывшееся к концу срока, возвращает connect_failed", async () => {
  const { socket, clock, result } = createHarness();
  clock.advanceTo("2026-01-01T12:00:15Z");
  clock.fireTimeout();

  expect(await result).toMatchObject({ ok: false, code: "connect_failed" });
  assertCleaned(socket, clock);
});

test("ошибка сокета до open немедленно возвращает connect_failed", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("error");

  expect(await result).toMatchObject({ ok: false, code: "connect_failed" });
  expect(clock.pendingCount()).toBe(0);
  assertCleaned(socket, clock);
});

test("provider error после трёх судов не возвращает частичный набор", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  for (let id = 1; id <= 3; id += 1) emitPosition(socket, syntheticPositionReport(100000000 + id));
  await flushMessages();
  socket.emit("message", JSON.stringify({ MessageType: "Error", Error: "synthetic" }));

  expect(await result).toMatchObject({ ok: false, code: "provider_error" });
  assertCleaned(socket, clock);
});

test("разрыв после трёх судов не возвращает частичный набор", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  for (let id = 1; id <= 3; id += 1) emitPosition(socket, syntheticPositionReport(100000000 + id));
  await flushMessages();
  socket.emit("close");

  expect(await result).toMatchObject({ ok: false, code: "disconnected" });
  assertCleaned(socket, clock);
});

test("provider error после завершения по лимиту не меняет результат и не завершает его дважды", async () => {
  const { socket, clock, result } = createHarness();
  let resolveCount = 0;
  void result.then(() => { resolveCount += 1; });
  socket.emit("open");
  for (let id = 1; id <= 100; id += 1) emitPosition(socket, syntheticPositionReport(100000000 + id));
  socket.emit("message", JSON.stringify({ MessageType: "Error", Error: "late synthetic error" }));

  const response = await result;
  await Promise.resolve();
  expect(response).toMatchObject({ ok: true, count: 100, reason: "limit_reached", truncated: true });
  expect(resolveCount).toBe(1);
  assertCleaned(socket, clock);
});

test("отмена до конца окна не завершает сбор и очищает ресурсы", async () => {
  const { socket, clock, controller, result } = createHarness();
  let resultSettled = false;
  void result.then(() => {
    resultSettled = true;
  });

  socket.emit("open");
  controller.abort();
  await Promise.resolve();

  assertCleaned(socket, clock);
  expect(resultSettled).toBe(false);
});

test("новое сообщение A с null name заменяет весь объект", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  emitPosition(socket, syntheticPositionReport(111000111, { time: "2026-01-01 12:00:00.000000000 +0000 UTC", name: "ALPHA", lat: 51.1, lon: 1.5 }));
  emitPosition(socket, syntheticPositionReport(111000111, { time: "2026-01-01 12:01:00.000000000 +0000 UTC", name: null, lat: 51.2, lon: 1.7 }));
  await flushMessages();
  clock.advanceTo("2026-01-01T12:01:15Z");
  clock.fireTimeout();

  const response = await result;
  expect(response.ok).toBe(true);
  if (response.ok) {
    expect(response.vessels).toHaveLength(1);
    expect(response.vessels[0].name).toBeNull();
    expect(response.vessels[0].lat).toBe(51.2);
    expect(response.vessels[0].lon).toBe(1.7);
  }
  assertCleaned(socket, clock);
});

test("collectedAt берётся литералом из переданных часов в момент завершения", async () => {
  const { socket, clock, result } = createHarness();
  socket.emit("open");
  clock.advanceTo("2026-01-01T12:00:15.000Z");
  clock.fireTimeout();

  const response = await result;
  expect(response).toMatchObject({
    ok: true,
    collectedAt: "2026-01-01T12:00:15.000Z",
    reason: "window_elapsed",
  });
  assertCleaned(socket, clock);
});
