"use client";

import { useEffect, useRef, useState } from "react";

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
  const markersRef = useRef<Map<string, import("leaflet").Marker>>(new Map());
  const initialVesselsRef = useRef<Vessel[]>(
    DEMO_VESSELS.map((config) => createInitialDemoVessel(config, createTimestamp())),
  );
  const vesselsRef = useRef(initialVesselsRef.current);
  const [vessels, setVessels] = useState<Vessel[]>(initialVesselsRef.current);
  const [selectedVesselId, setSelectedVesselId] = useState<string | null>(null);
  const selectedVessel = vessels.find(({ id }) => id === selectedVesselId) ?? null;

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let invalidateSize: (() => void) | undefined;
    let timer: number | undefined;
    const routeIndexes = DEMO_VESSELS.map(() => 0);

    void import("leaflet").then((leaflet) => {
      if (disposed || !containerRef.current) {
        return;
      }

      map = leaflet.map(containerRef.current, {
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

      initialVesselsRef.current.forEach((vessel) => {
        const marker = leaflet
          .marker([vessel.lat, vessel.lon], {
            icon: createVesselIcon(leaflet, vessel),
          })
          .on("click", () => {
            setSelectedVesselId(vessel.id);
          })
          .addTo(map!);

        markersRef.current.set(vessel.id, marker);
      });

      const startedAt = createTimestamp();
      const startedVessels = initialVesselsRef.current.map((vessel) => ({
        ...vessel,
        timestamp: startedAt,
      }));
      initialVesselsRef.current = startedVessels;
      vesselsRef.current = startedVessels;
      setVessels(startedVessels);

      timer = window.setInterval(() => {
        const timestamp = createTimestamp();

        const nextVessels = vesselsRef.current.map((vessel, index) => {
          const config = DEMO_VESSELS[index];
          const currentIndex = routeIndexes[index];
          const nextIndex = Math.min(currentIndex + 1, config.route.length - 1);

          if (nextIndex === currentIndex) {
            return vessel;
          }

          routeIndexes[index] = nextIndex;
          const previousPoint = config.route[currentIndex];
          const nextPoint = config.route[nextIndex];
          const nextVessel: Vessel = {
            ...vessel,
            lat: nextPoint[0],
            lon: nextPoint[1],
            speedKnots: nextIndex === config.route.length - 1 ? 0 : config.speedKnots,
            courseDeg: calculateBearingDeg(previousPoint, nextPoint),
            timestamp,
          };
          const marker = markersRef.current.get(vessel.id);

          marker?.setLatLng([nextVessel.lat, nextVessel.lon]);
          marker?.setIcon(createVesselIcon(leaflet, nextVessel));
          return nextVessel;
        });

        vesselsRef.current = nextVessels;
        setVessels(nextVessels);
      }, DEMO_TICK_MS);

      invalidateSize = () => {
        map?.invalidateSize({ animate: false });
      };

      window.addEventListener("resize", invalidateSize);
      resizeObserver = new ResizeObserver(invalidateSize);
      resizeObserver.observe(containerRef.current);
      invalidateSize();
    });

    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
      markersRef.current.clear();
      resizeObserver?.disconnect();
      if (invalidateSize) {
        window.removeEventListener("resize", invalidateSize);
      }
      map?.remove();
    };
  }, []);

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map" aria-label="Карта пролива Дувр" />
      <aside className="map-panel">
        <div className="button-placeholder" aria-hidden="true" />
        <p className="data-source">Демонстрационные данные</p>
        {selectedVessel ? <VesselCard vessel={selectedVessel} /> : null}
      </aside>
    </div>
  );
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
