import PageContainer from '@/components/layout/page-container';
import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';
import TripsListingPage from '@/features/trips/components/trips-listing';
import { searchParamsCache } from '@/lib/searchparams';
import { SearchParams } from 'nuqs/server';
import { Suspense } from 'react';
import { TripsRealtimeSync } from '@/features/trips/components/trips-realtime-sync';
import { FahrtenPageShell } from './fahrten-page-shell';
import { TripsPageHeaderActions } from './trips-header-actions';

export const metadata = {
  title: 'Dashboard: Fahrten'
};

export const dynamic = 'force-dynamic';

type pageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Page(props: pageProps) {
  /** Ensure nuqs cache is tied to this navigation (Promise must be parsed here for RSC). */
  await searchParamsCache.parse(props.searchParams);

  return (
    <FahrtenPageShell>
      <PageContainer
        scrollable={false}
        pageTitle='Fahrten'
        pageDescription='Alle Fahrten auf einen Blick verwalten.'
        pageHeaderAction={<TripsPageHeaderActions />}
      >
        <Suspense
          fallback={
            <DataTableSkeleton columnCount={10} rowCount={10} filterCount={3} />
          }
        >
          <TripsListingPage searchParams={props.searchParams} />
        </Suspense>
        <TripsRealtimeSync />
      </PageContainer>
    </FahrtenPageShell>
  );
}
