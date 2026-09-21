"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";

import {
  calculateBearingDeg,
  createInitialDemoVessel,
  DEMO_TICK_MS,
  DEMO_VESSELS,
  MAP_ATTRIBUTION,
  MAP_BOUNDS,
  MAP_CENTER,
  MAP_TILE_URL,
  MAP_ZOOM,
  type Vessel,
} from "../config/map";

type ViewMode = "idle-demo" | "loading" | "success" | "empty" | "error";

type SnapshotSuccess = {
  ok: true;
  vessels: Vessel[];
  collectedAt: string;
  windowSeconds: number;
  count: number;
  truncated: boolean;
  reason: "window_elapsed" | "limit_reached";
};

type SnapshotError = {
  ok: false;
  attemptedAt: string;
  error: {
    message: string;
  };
};

type SnapshotResponse = SnapshotSuccess | SnapshotError;

type SuccessMeta = Omit<SnapshotSuccess, "ok" | "vessels" | "reason"> & {
  reason: SnapshotSuccess["reason"];
};

type ErrorMeta = {
  attemptedAt: string | null;
  message: string;
};

function formatUnknown(value: string | number | null): string {
  return value === null || value === "" ? "Нет данных" : String(value);
}

function createTimestamp(): string {
  return new Date().toISOString();
}

function formatCoordinates(vessel: Vessel): string {
  return `${vessel.lat.toFixed(5)}, ${vessel.lon.toFixed(5)}`;
}

function formatSpeed(speedKnots: number | null): string {
  if (speedKnots === null) {
    return "Нет данных";
  }

  return `${Number(speedKnots.toFixed(1))} уз`;
}

function formatCourse(courseDeg: Vessel["courseDeg"]): string {
  return courseDeg === null ? "Нет данных" : `${Math.round(courseDeg) % 360}°`;
}

function formatTimestamp(timestamp: string | null): string {
  if (timestamp === null || timestamp === "") {
    return "Нет данных";
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "Нет данных";
  }

  return `${date.toISOString().slice(11, 19)} UTC`;
}

function formatSource(source: Vessel["source"] | null): string {
  if (source === "demo") {
    return "Демонстрационные данные";
  }

  if (source === "aisstream") {
    return "AISStream";
  }

  return "Нет данных";
}

function VesselCard({ vessel }: { vessel: Vessel }) {
  return (
    <section className="vessel-card" aria-label="Карточка судна">
      <h2>{formatUnknown(vessel.name)}</h2>
      <dl>
        <div>
          <dt>Идентификатор</dt>
          <dd>{formatUnknown(vessel.id)}</dd>
        </div>
        <div>
          <dt>Название</dt>
          <dd>{formatUnknown(vessel.name)}</dd>
        </div>
        <div>
          <dt>Координаты</dt>
          <dd>{formatCoordinates(vessel)}</dd>
        </div>
        <div>
          <dt>Скорость</dt>
          <dd>{formatSpeed(vessel.speedKnots)}</dd>
        </div>
        <div>
          <dt>Курс</dt>
          <dd>{formatCourse(vessel.courseDeg)}</dd>
        </div>
        <div>
          <dt>Время</dt>
          <dd>{formatTimestamp(vessel.timestamp)}</dd>
        </div>
        <div>
          <dt>Источник</dt>
          <dd>{formatSource(vessel.source)}</dd>
        </div>
      </dl>
    </section>
  );
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | undefined>(undefined);
  const leafletRef = useRef<typeof import("leaflet") | undefined>(undefined);
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const timerRef = useRef<number | undefined>(undefined);
  const routeIndexesRef = useRef(DEMO_VESSELS.map(() => 0));
  const initialVesselsRef = useRef<Vessel[]>(
    DEMO_VESSELS.map((config) => createInitialDemoVessel(config, createTimestamp())),
  );
  const vesselsRef = useRef(initialVesselsRef.current);
  const hasFittedLiveViewRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mode, setMode] = useState<ViewMode>("idle-demo");
  const [vessels, setVessels] = useState<Vessel[]>(initialVesselsRef.current);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const [successMeta, setSuccessMeta] = useState<SuccessMeta | null>(null);
  const [errorMeta, setErrorMeta] = useState<ErrorMeta | null>(null);
  const selectedVessel = vessels.find(({ id }) => id === selectedVesselId) ?? null;

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let invalidateSize: (() => void) | undefined;

    void import("leaflet").then((leaflet) => {
      if (disposed || !containerRef.current) {
        return;
      }

      const map = leaflet.map(containerRef.current, {
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        maxBounds: MAP_BOUNDS,
        zoomControl: false,
      });

      leaflet
        .tileLayer(MAP_TILE_URL, {
          attribution: MAP_ATTRIBUTION,
        })
        .addTo(map);

      mapRef.current = map;
      leafletRef.current = leaflet;
      setMapReady(true);

      invalidateSize = () => {
        map.invalidateSize({ animate: false });
      };

      window.addEventListener("resize", invalidateSize);
      resizeObserver = new ResizeObserver(invalidateSize);
      resizeObserver.observe(containerRef.current);
      invalidateSize();
    });

    return () => {
      disposed = true;
      stopDemoTimer(timerRef);
      resizeObserver?.disconnect();
      if (invalidateSize) {
        window.removeEventListener("resize", invalidateSize);
      }
      markersRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = undefined;
      leafletRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const leaflet = leafletRef.current;
    if (!mapReady || !map || !leaflet) {
      return;
    }

    const vesselIds = new Set(vessels.map(({ id }) => id));
    markersRef.current.forEach((marker, id) => {
      if (!vesselIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    vessels.forEach((vessel) => {
      const existingMarker = markersRef.current.get(vessel.id);
      if (existingMarker) {
        existingMarker.setLatLng([vessel.lat, vessel.lon]);
        existingMarker.setIcon(createVesselIcon(leaflet, vessel));
        return;
      }

      const marker = leaflet
        .marker([vessel.lat, vessel.lon], {
          icon: createVesselIcon(leaflet, vessel),
        })
        .on("click", () => {
          setSelectedVesselId(vessel.id);
        })
        .addTo(map);

      markersRef.current.set(vessel.id, marker);
    });
  }, [mapReady, vessels]);

  useEffect(() => {
    if (!mapReady || mode !== "idle-demo") {
      stopDemoTimer(timerRef);
      return;
    }

    timerRef.current = window.setInterval(() => {
      const timestamp = createTimestamp();
      const nextVessels = vesselsRef.current.map((vessel, index) => {
        const config = DEMO_VESSELS[index];
        const currentIndex = routeIndexesRef.current[index];
        const nextIndex = Math.min(currentIndex + 1, config.route.length - 1);

        if (nextIndex === currentIndex) {
          return vessel;
        }

        routeIndexesRef.current[index] = nextIndex;
        const previousPoint = config.route[currentIndex];
        const nextPoint = config.route[nextIndex];

        return {
          ...vessel,
          lat: nextPoint[0],
          lon: nextPoint[1],
          speedKnots: nextIndex === config.route.length - 1 ? 0 : config.speedKnots,
          courseDeg: calculateBearingDeg(previousPoint, nextPoint),
          timestamp,
        };
      });

      vesselsRef.current = nextVessels;
      setVessels(nextVessels);
    }, DEMO_TICK_MS);

    return () => {
      stopDemoTimer(timerRef);
    };
  }, [mapReady, mode]);

  const handleLoadRealPositions = async () => {
    stopDemoTimer(timerRef);
    setMode("loading");
    setSelectedVesselId(null);
    setSuccessMeta(null);
    setErrorMeta(null);
    vesselsRef.current = [];
    setVessels([]);

    try {
      const response = await fetch("/api/snapshot");
      const body = (await response.json()) as SnapshotResponse;

      if (!response.ok || !body.ok) {
        const message = body.ok ? "Внутренняя ошибка сервера" : body.error.message;
        const attemptedAt = body.ok ? null : body.attemptedAt;
        setErrorMeta({ message, attemptedAt });
        setMode("error");
        return;
      }

      const meta: SuccessMeta = {
        collectedAt: body.collectedAt,
        windowSeconds: body.windowSeconds,
        count: body.count,
        truncated: body.truncated,
        reason: body.reason,
      };
      vesselsRef.current = body.vessels;
      setVessels(body.vessels);
      setSuccessMeta(meta);
      setMode(body.count === 0 ? "empty" : "success");

      if (body.count > 0 && !hasFittedLiveViewRef.current) {
        mapRef.current?.setView(MAP_CENTER, MAP_ZOOM);
        hasFittedLiveViewRef.current = true;
      }
    } catch {
      setErrorMeta({
        message: "Внутренняя ошибка сервера",
        attemptedAt: null,
      });
      setMode("error");
    }
  };

  const successLabel = successMeta
    ? `AISStream · снимок за ${successMeta.windowSeconds} с · получен ${formatTimestamp(successMeta.collectedAt)} · судов: ${successMeta.count} · выборка неполная${successMeta.truncated ? " · остановлено на лимите 100" : ""}`
    : null;

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map" aria-label="Карта пролива Дувр" />
      <aside className="map-panel">
        <button
          type="button"
          className="load-button"
          disabled={mode === "loading"}
          onClick={handleLoadRealPositions}
        >
          Загрузить настоящие позиции
        </button>
        {mode === "idle-demo" ? (
          <p className="data-source">Демонстрационные данные</p>
        ) : null}
        {mode === "loading" ? <p className="data-source">Загрузка…</p> : null}
        {mode === "success" || mode === "empty" ? (
          <time className="data-source" dateTime={successMeta?.collectedAt}>
            {successLabel}
          </time>
        ) : null}
        {mode === "error" ? (
          <time className="data-source" dateTime={errorMeta?.attemptedAt ?? undefined}>
            Данных на карте нет
          </time>
        ) : null}
        {mode === "empty" ? (
          <p className="status-message">За время сбора позиции не получены</p>
        ) : null}
        {mode === "error" ? (
          <p className="status-message">Не удалось получить данные: {errorMeta?.message}</p>
        ) : null}
        {selectedVessel ? <VesselCard vessel={selectedVessel} /> : null}
      </aside>
    </div>
  );
}

function stopDemoTimer(timerRef: MutableRefObject<number | undefined>) {
  if (timerRef.current !== undefined) {
    window.clearInterval(timerRef.current);
    timerRef.current = undefined;
  }
}

function createVesselIcon(leaflet: typeof import("leaflet"), vessel: Vessel) {
  const iconType = vessel.courseDeg === null ? "neutral" : "course";
  const iconRotation = vessel.courseDeg ?? 0;

  return leaflet.divIcon({
    className: "vessel-icon",
    html: `<span data-vessel-id="${vessel.id}" data-icon="${iconType}" aria-label="${vessel.name ?? "Судно"}" style="--vessel-course: ${iconRotation}deg"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}
