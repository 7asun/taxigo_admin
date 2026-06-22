import PageContainer from '@/components/layout/page-container';
import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';
import KtsAbrechnungListingPage from '@/features/kts/components/kts-abrechnung-listing-page';
import KtsListingPage from '@/features/kts/components/kts-listing-page';
import { TripsRealtimeSync } from '@/features/trips/components/trips-realtime-sync';
import { searchParamsCache } from '@/lib/searchparams';
import type { SearchParams } from 'nuqs/server';
import { Suspense } from 'react';
import { KtsHeader } from './kts-header';
import { KtsPageShell } from './kts-page-shell';

export const metadata = {
  title: 'Dashboard: KTS'
};

export const dynamic = 'force-dynamic';

type KtsPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function KtsPage({ searchParams }: KtsPageProps) {
  await searchParamsCache.parse(searchParams);
  const view = searchParamsCache.get('view');
  const isAbrechnung = view === 'abrechnung';

  return (
    <KtsPageShell>
      <PageContainer scrollable={false}>
        <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-hidden'>
          <KtsHeader />
          <Suspense
            fallback={
              <DataTableSkeleton
                columnCount={isAbrechnung ? 7 : 6}
                rowCount={10}
                filterCount={isAbrechnung ? 3 : 2}
              />
            }
          >
            {isAbrechnung ? (
              <KtsAbrechnungListingPage searchParams={searchParams} />
            ) : (
              <KtsListingPage searchParams={searchParams} />
            )}
          </Suspense>
        </div>
        <TripsRealtimeSync />
      </PageContainer>
    </KtsPageShell>
  );
}
