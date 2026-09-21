import { NextResponse } from "next/server";

import { MAP_BOUNDS } from "../../../config/map";
import {
  readSnapshot,
  type SnapshotReaderResult,
} from "../../../server/aisstream-reader";

export const runtime = "nodejs";

const ERROR_MESSAGES = {
  connect_failed: "Не удалось подключиться к источнику",
  disconnected: "Соединение с источником разорвано",
  provider_error: "Источник вернул ошибку",
  internal: "Внутренняя ошибка сервера",
} as const;

export async function GET(request: Request) {
  const attemptedAt = new Date().toISOString();
  const apiKey = process.env.AISSTREAM_API_KEY?.trim();

  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        attemptedAt,
        error: {
          code: "no_api_key",
          message: "Ключ AISStream не настроен",
        },
      },
      { status: 502 },
    );
  }

  const result = await readSnapshot({
    apiKey,
    boundingBox: MAP_BOUNDS,
    signal: request.signal,
  });

  return toResponse(result);
}

function toResponse(result: SnapshotReaderResult) {
  if (result.ok) {
    return NextResponse.json(result, { status: 200 });
  }

  return NextResponse.json(
    {
      ok: false,
      attemptedAt: result.attemptedAt,
      error: {
        code: result.code,
        message: ERROR_MESSAGES[result.code],
      },
    },
    { status: 502 },
  );
}
