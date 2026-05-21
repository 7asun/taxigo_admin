import PageContainer from '@/components/layout/page-container';
import { DataTableSkeleton } from '@/components/ui/table/data-table-skeleton';
import DriverTableListing from '@/features/driver-management/components/driver-table-listing';
import { DriverCreateButton } from '@/features/driver-management/components/driver-create-button';
import { DriversColumnView } from '@/features/driver-management/components/drivers-column-view';
import { DriversViewToggle } from '@/features/driver-management/components/drivers-view-toggle';
import { DriverForm } from '@/features/driver-management/components/driver-form';
import { assertAdminOrRedirect } from '@/lib/api/require-admin';
import { searchParamsCache } from '@/lib/searchparams';
import { SearchParams } from 'nuqs/server';
import { Suspense } from 'react';

export const metadata = {
  title: 'Dashboard: Benutzerverwaltung',
  description: 'Alle Benutzer der Organisation verwalten.'
};

type PageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function Page(props: PageProps) {
  await assertAdminOrRedirect();

  const searchParams = await props.searchParams;
  searchParamsCache.parse(searchParams);

  const view = (searchParams.view as string) ?? 'columns';
  const isColumnView = view === 'columns';

  return (
    <PageContainer
      scrollable={false}
      pageTitle='Benutzerverwaltung'
      pageDescription='E-Mail und Passwort aus Supabase Auth, Konten sperren und entsperren.'
      pageHeaderAction={
        <div className='flex items-center gap-2'>
          {!isColumnView && <DriverCreateButton />}
          <DriversViewToggle />
        </div>
      }
    >
      {isColumnView ? (
        <DriversColumnView />
      ) : (
        <>
          <Suspense
            fallback={
              <DataTableSkeleton columnCount={5} rowCount={8} filterCount={0} />
            }
          >
            <DriverTableListing />
          </Suspense>
          <DriverForm />
        </>
      )}
    </PageContainer>
  );
}
