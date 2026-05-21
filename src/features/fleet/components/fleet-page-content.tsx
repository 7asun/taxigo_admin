'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { useFleetMap } from '@/lib/tracking/use-fleet-map';

const FleetMap = dynamic(() => import('@/components/fleet/fleet-map'), {
  ssr: false,
  loading: () => <Skeleton className='h-full min-h-[400px] w-full rounded-lg' />
});

export function FleetPageContent() {
  const { drivers, isLoading, error } = useFleetMap();
  const onlineCount = drivers.filter((d) => d.is_online).length;

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4'>
      <div className='flex items-center justify-between gap-2 px-1'>
        <span className='bg-muted rounded-full px-3 py-1 text-sm font-medium'>
          {onlineCount} Fahrer online
        </span>
        {error && <span className='text-destructive text-sm'>{error}</span>}
      </div>
      <div className='min-h-0 flex-1'>
        {isLoading ? (
          <Skeleton className='h-full min-h-[400px] w-full rounded-lg' />
        ) : (
          <FleetMap drivers={drivers} />
        )}
      </div>
    </div>
  );
}
