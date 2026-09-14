"use client";

import { useEffect, useRef, useState } from "react";

import {
  DEMO_VESSEL,
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
  const [selectedVessel, setSelectedVessel] = useState<Vessel | null>(null);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let invalidateSize: (() => void) | undefined;

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

      const iconType = DEMO_VESSEL.courseDeg === null ? "neutral" : "course";
      const iconRotation = DEMO_VESSEL.courseDeg ?? 0;
      const vesselIcon = leaflet.divIcon({
        className: "vessel-icon",
        html: `<span data-vessel-id="${DEMO_VESSEL.id}" data-icon="${iconType}" aria-label="${DEMO_VESSEL.name ?? "Судно"}" style="--vessel-course: ${iconRotation}deg"></span>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      leaflet
        .marker([DEMO_VESSEL.lat, DEMO_VESSEL.lon], {
          icon: vesselIcon,
        })
        .on("click", () => {
          setSelectedVessel(DEMO_VESSEL);
        })
        .addTo(map);

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
