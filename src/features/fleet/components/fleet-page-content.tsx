'use client';

import dynamic from 'next/dynamic';
import type { FleetMapHandle } from '@/components/fleet/fleet-map';
import { Skeleton } from '@/components/ui/skeleton';
import { AddressAutocomplete } from '@/features/trips/components/address-autocomplete';
import { useFleetMap } from '@/lib/tracking/use-fleet-map';
import { cn } from '@/lib/utils';
import { useRef, useState } from 'react';

const FleetMap = dynamic(
  () => import('@/components/fleet/fleet-map').then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <Skeleton className='h-full min-h-[400px] w-full rounded-lg' />
    )
  }
);

export function FleetPageContent() {
  const { drivers, isLoading, error } = useFleetMap();
  const fleetMapRef = useRef<FleetMapHandle>(null);
  const [searchValue, setSearchValue] = useState('');
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);

  const onlineDrivers = drivers.filter((d) => d.is_online);

  const flyToMap = (lat: number, lng: number, zoom: number) => {
    fleetMapRef.current?.flyTo(lat, lng, zoom);
  };

  async function fetchAndDrawRoutes(destLat: number, destLng: number) {
    const online = drivers.filter((d) => d.is_online);
    if (!online.length) return;

    setIsLoadingRoutes(true);
    try {
      const res = await fetch('/api/fleet/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          drivers: online.map((d) => ({
            driver_id: d.driver_id,
            name: d.name,
            lat: d.lat,
            lng: d.lng
          })),
          destLat,
          destLng
        })
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        routes?: Parameters<FleetMapHandle['setRoutes']>[0];
      };
      fleetMapRef.current?.setRoutes(data.routes ?? []);
    } finally {
      setIsLoadingRoutes(false);
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4'>
      <div className='flex flex-col gap-3 px-1'>
        <div className='flex items-center justify-between gap-4'>
          <p className='text-muted-foreground shrink-0 text-sm'>
            Aktuelle Positionen Ihrer Fahrer —{' '}
            <span className='text-foreground font-medium'>
              {onlineDrivers.length} online
            </span>
          </p>
          <div className='relative z-[1000] w-72'>
            <AddressAutocomplete
              value={searchValue}
              onChange={(val) => {
                setSearchValue(typeof val === 'string' ? val : val.address);
              }}
              onSelectCallback={(result) => {
                if (result.lat != null && result.lng != null) {
                  setSearchValue(result.address);
                  fleetMapRef.current?.flyTo(result.lat, result.lng, 15);
                  fleetMapRef.current?.setSearchPin(
                    result.lat,
                    result.lng,
                    result.address
                  );
                  void fetchAndDrawRoutes(result.lat, result.lng);
                }
              }}
              placeholder='Adresse auf Karte suchen...'
              popoverClassName='z-[1001]'
            />
            {searchValue && (
              <button
                type='button'
                onClick={() => {
                  setSearchValue('');
                  fleetMapRef.current?.clearSearchPin();
                  fleetMapRef.current?.clearRoutes();
                }}
                className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 transition-colors'
                aria-label='Suche zurücksetzen'
              >
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                >
                  <path d='M18 6 6 18M6 6l12 12' />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {onlineDrivers.length === 0 ? (
            <span className='text-muted-foreground text-sm'>
              Keine Fahrer online
            </span>
          ) : (
            onlineDrivers.map((driver) => (
              <button
                key={driver.driver_id}
                type='button'
                onClick={() => flyToMap(driver.lat, driver.lng, 16)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-opacity hover:opacity-80',
                  driver.is_busy
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                )}
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    driver.is_busy ? 'bg-red-500' : 'bg-green-500'
                  )}
                />
                {driver.name}
              </button>
            ))
          )}
        </div>

        {error && <span className='text-destructive text-sm'>{error}</span>}
      </div>

      {isLoadingRoutes && (
        <span className='text-muted-foreground px-1 text-xs'>
          Routen werden berechnet…
        </span>
      )}

      <div className='min-h-0 flex-1'>
        {isLoading ? (
          <Skeleton className='h-full min-h-[400px] w-full rounded-lg' />
        ) : (
          <FleetMap ref={fleetMapRef} drivers={drivers} />
        )}
      </div>
    </div>
  );
}
