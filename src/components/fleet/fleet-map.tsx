'use client';

/**
 * Leaflet fleet map — client-only (no SSR).
 *
 * Why DivIcon: coloured pin with driver initial (grey / green / red)
 * for offline / free / busy; busy state updates via trips realtime, not GPS.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { DriverPosition } from '@/lib/tracking/use-fleet-map';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const OLDENBURG_CENTER: L.LatLngExpression = [53.1435, 8.2146];
const OLDENBURG_ZOOM = 13;

const ROUTE_COLORS = [
  '#6366f1',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316'
];

export interface DriverRoute {
  driver_id: string;
  name: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  polylinePoints: Array<{ lat: number; lng: number }>;
}

export interface FleetMapHandle {
  flyTo: (lat: number, lng: number, zoom?: number) => void;
  setSearchPin: (lat: number, lng: number, label: string) => void;
  clearSearchPin: () => void;
  setRoutes: (routes: DriverRoute[]) => void;
  clearRoutes: () => void;
}

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

const FleetMapInner = forwardRef<FleetMapHandle, FleetMapProps>(
  ({ drivers }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<L.Map | null>(null);
    const markersRef = useRef<Map<string, L.Marker>>(new Map());
    const searchMarkerRef = useRef<L.Marker | null>(null);
    const searchDestRef = useRef<{ lat: number; lng: number } | null>(null);
    const routeLayersRef = useRef<Array<L.Polyline | L.Marker>>([]);
    // Why: re-fitting on every position tick interrupts manual panning.
    // Only re-fit when the set of online drivers changes structurally.
    const prevOnlineCountRef = useRef<number>(-1);

    useImperativeHandle(ref, () => ({
      flyTo: (lat, lng, zoom = 15) => {
        mapRef.current?.flyTo([lat, lng], zoom, {
          animate: true,
          duration: 0.8
        });
      },
      setSearchPin: (lat, lng, label) => {
        if (!mapRef.current) return;

        if (searchMarkerRef.current) {
          searchMarkerRef.current.remove();
          searchMarkerRef.current = null;
        }

        const icon = L.divIcon({
          html: `
      <svg xmlns="http://www.w3.org/2000/svg"
           width="28" height="36" viewBox="0 0 28 36">
        <path d="M14 0C6.27 0 0 6.27 0 14c0 9.33 14 22 14 22S28 23.33 28 14C28 6.27 21.73 0 14 0z"
              fill="#6366f1"/>
        <circle cx="14" cy="14" r="6" fill="white"/>
      </svg>`,
          className: '',
          iconSize: [28, 36],
          iconAnchor: [14, 36],
          popupAnchor: [0, -36]
        });

        const marker = L.marker([lat, lng], { icon })
          .addTo(mapRef.current)
          .bindPopup(label, { autoClose: false })
          .openPopup();

        searchMarkerRef.current = marker;
        searchDestRef.current = { lat, lng };
      },
      clearSearchPin: () => {
        if (searchMarkerRef.current) {
          searchMarkerRef.current.remove();
          searchMarkerRef.current = null;
        }
        searchDestRef.current = null;
      },
      clearRoutes: () => {
        routeLayersRef.current.forEach((layer) => layer.remove());
        routeLayersRef.current = [];
      },
      setRoutes: (routes) => {
        if (!mapRef.current) return;

        routeLayersRef.current.forEach((layer) => layer.remove());
        routeLayersRef.current = [];

        routes.forEach((route, index) => {
          if (!route.polylinePoints.length) return;

          const color = ROUTE_COLORS[index % ROUTE_COLORS.length];
          const map = mapRef.current!;

          const polyline = L.polyline(
            route.polylinePoints.map((p) => [p.lat, p.lng] as L.LatLngTuple),
            {
              color,
              weight: 4,
              opacity: 0.75
            }
          ).addTo(map);
          routeLayersRef.current.push(polyline);

          if (route.durationSeconds != null) {
            const points = route.polylinePoints;
            const labelIndex = Math.max(0, Math.floor(points.length * 0.85));
            const labelPoint = points[labelIndex];
            const minutes = Math.round(route.durationSeconds / 60);
            const km =
              route.distanceMeters != null
                ? (route.distanceMeters / 1000).toFixed(1)
                : null;
            const labelHtml = `
  <div style="
    background: white;
    color: #111827;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    padding: 6px 10px;
    border-radius: 8px;
    border: 2px solid ${color};
    box-shadow: 0 2px 8px rgba(0,0,0,0.18);
    transform: translate(-50%, -100%);
    white-space: nowrap;
    display: inline-block;
    line-height: 1.5;
    pointer-events: none;
  ">
    <div style="
      color: ${color};
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1px;
    ">${route.name}</div>
    <div style="
      font-size: 13px;
      font-weight: 600;
      color: #111827;
    ">${minutes} Min.${km != null ? ` · ${km} km` : ''}</div>
  </div>`;
            const label = L.marker([labelPoint.lat, labelPoint.lng], {
              icon: L.divIcon({
                html: labelHtml,
                className: '',
                iconAnchor: [0, 0]
              }),
              interactive: false,
              zIndexOffset: -100
            }).addTo(map);
            routeLayersRef.current.push(label);
          }
        });

        const boundsPoints: L.LatLngExpression[] = [];
        if (searchDestRef.current) {
          boundsPoints.push([
            searchDestRef.current.lat,
            searchDestRef.current.lng
          ]);
        }
        for (const route of routes) {
          if (!route.polylinePoints.length || route.durationSeconds == null) {
            continue;
          }
          const points = route.polylinePoints;
          const labelIndex = Math.max(0, Math.floor(points.length * 0.85));
          const lp = points[labelIndex];
          boundsPoints.push([lp.lat, lp.lng]);
        }
        if (boundsPoints.length >= 2) {
          mapRef.current.fitBounds(L.latLngBounds(boundsPoints), {
            padding: [48, 48],
            maxZoom: 15,
            animate: true,
            duration: 0.8
          });
        }
      }
    }));

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
        searchMarkerRef.current?.remove();
        searchMarkerRef.current = null;
        searchDestRef.current = null;
        routeLayersRef.current.forEach((layer) => layer.remove());
        routeLayersRef.current = [];
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
        className='isolate h-full min-h-[400px] w-full rounded-lg border'
        aria-label='Flottenkarte'
      />
    );
  }
);

FleetMapInner.displayName = 'FleetMap';

export default FleetMapInner;
