'use client';

/**
 * Leaflet fleet map — client-only (no SSR).
 *
 * Why DivIcon: coloured pin with driver initial (grey / green / red)
 * for offline / free / busy; busy state updates via trips realtime, not GPS.
 */

import { useEffect, useRef } from 'react';
import type { DriverPosition } from '@/lib/tracking/use-fleet-map';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const OLDENBURG_CENTER: L.LatLngExpression = [53.1435, 8.2146];
const OLDENBURG_ZOOM = 13;

// Why: DivIcon allows inline SVG pin with dynamic fill and driver initial
function createDriverIcon(
  isOnline: boolean,
  isBusy: boolean,
  name: string
): L.DivIcon {
  const color = !isOnline ? '#9ca3af' : isBusy ? '#ef4444' : '#22c55e';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="36" height="44" viewBox="0 0 36 44">
      <circle cx="18" cy="18" r="16"
              fill="${color}" stroke="white" stroke-width="2.5"/>
      <text x="18" y="23"
            text-anchor="middle"
            font-family="-apple-system, BlinkMacSystemFont, sans-serif"
            font-size="15"
            font-weight="700"
            fill="white">${initial}</text>
      <polygon points="12,32 18,43 24,32"
               fill="${color}" stroke="white" stroke-width="1.5"
               stroke-linejoin="round"/>
    </svg>`;

  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 43],
    popupAnchor: [0, -44]
  });
}

function formatLastSeenTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function popupHtml(driver: DriverPosition): string {
  const statusLine = driver.is_busy ? '🔴 Tour aktiv' : '🟢 Frei';
  const speed = driver.speed_kmh != null ? `${driver.speed_kmh} km/h` : '—';
  return `<strong>${driver.name}</strong><br/>${statusLine}<br/>${speed}<br/>Zuletzt: ${formatLastSeenTime(driver.updated_at)}`;
}

export type FleetMapProps = {
  drivers: DriverPosition[];
};

export default function FleetMap({ drivers }: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  // Why: re-fitting on every position tick interrupts manual panning.
  // Only re-fit when the set of online drivers changes structurally.
  const prevOnlineCountRef = useRef<number>(-1);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView(
      OLDENBURG_CENTER,
      OLDENBURG_ZOOM
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      prevOnlineCountRef.current = -1;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const driver of drivers) {
      seen.add(driver.driver_id);
      const latLng: L.LatLngExpression = [driver.lat, driver.lng];
      const icon = createDriverIcon(
        driver.is_online,
        driver.is_busy,
        driver.name
      );
      const existing = markers.get(driver.driver_id);

      if (existing) {
        existing.setLatLng(latLng);
        existing.setIcon(icon);
        existing.setPopupContent(popupHtml(driver));
      } else {
        const marker = L.marker(latLng, { icon })
          .addTo(map)
          .bindPopup(popupHtml(driver));
        markers.set(driver.driver_id, marker);
      }
    }

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        map.removeLayer(marker);
        markers.delete(id);
      }
    }

    const onlineDrivers = drivers.filter((d) => d.is_online);
    if (onlineDrivers.length !== prevOnlineCountRef.current) {
      prevOnlineCountRef.current = onlineDrivers.length;
      if (onlineDrivers.length > 0) {
        const bounds = L.latLngBounds(
          onlineDrivers.map((d) => [d.lat, d.lng] as L.LatLngTuple)
        );
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
      } else {
        map.setView(OLDENBURG_CENTER, OLDENBURG_ZOOM);
      }
    }
  }, [drivers]);

  return (
    <div
      ref={containerRef}
      className='h-full min-h-[400px] w-full rounded-lg border'
      aria-label='Flottenkarte'
    />
  );
}
