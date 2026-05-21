'use client';

/**
 * Leaflet fleet map — client-only (no SSR).
 *
 * Why icon URLs are overridden: Next.js asset pipeline breaks Leaflet default
 * marker image paths bundled with the package.
 */

import { useEffect, useRef } from 'react';
import type { DriverPosition } from '@/lib/tracking/use-fleet-map';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
});

const OLDENBURG_CENTER: L.LatLngExpression = [53.1435, 8.2146];
const OLDENBURG_ZOOM = 13;

const onlineIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const offlineIcon = new L.Icon({
  iconUrl:
    'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

function formatLastSeen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

function popupHtml(driver: DriverPosition): string {
  const speed = driver.speed_kmh != null ? `${driver.speed_kmh} km/h` : '—';
  return `<strong>${driver.name}</strong><br/>${speed}<br/>Zuletzt: ${formatLastSeen(driver.updated_at)}`;
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
      const icon = driver.is_online ? onlineIcon : offlineIcon;
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
