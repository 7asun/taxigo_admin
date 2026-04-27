import PageContainer from '@/components/layout/page-container';
import { ShiftReconciliationPageClient } from '@/features/shift-reconciliations/components/shift-reconciliation-page-client';
import {
  getDrivers,
  getReconciliation,
  getShiftDaySummaries,
  getTripsForShift
} from '@/features/shift-reconciliations/api/shift-reconciliations.service';

/**
 * URL-driven state (`driver`, `date`) is parsed here so the client shell can receive
 * server-fetched `initialBundle` and avoid a redundant client round-trip on first paint
 * (nuqs is hydrated from the same query string as this read).
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard: Schichtzettel-Abgleich'
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function Page({ searchParams }: PageProps) {
  const sp = await searchParams;
  const driverId = firstParam(sp.driver);
  const dateYmd = firstParam(sp.date);
  const viewMode = firstParam(sp.mode);
  const isDetailFromPicker =
    viewMode === 'detail' &&
    Boolean(driverId && dateYmd && dateYmd.length >= 10);

  const drivers = await getDrivers();

  let initialBundle = null;
  let initialSummaries = null;

  if (isDetailFromPicker) {
    const [trips, reconciliation] = await Promise.all([
      getTripsForShift(driverId!, dateYmd!),
      getReconciliation(driverId!, dateYmd!)
    ]);
    initialBundle = {
      driverId: driverId!,
      dateYmd: dateYmd!,
      trips,
      reconciliation
    };
  } else if (driverId) {
    const summaries = await getShiftDaySummaries(driverId);
    initialSummaries = { driverId, summaries };
  }

  return (
    <PageContainer
      pageTitle='Schichtzettel-Abgleich'
      pageDescription='Fahrten pro Fahrer und Tag prüfen, Beträge anpassen (manueller Brutto) und die Schicht bestätigen.'
    >
      <ShiftReconciliationPageClient
        drivers={drivers}
        initialBundle={initialBundle}
        initialSummaries={initialSummaries}
      />
    </PageContainer>
  );
}
