import PageContainer from '@/components/layout/page-container';
import { DriverPlanningFilters } from '@/features/driver-planning/components/driver-planning-filters';
import { DriverRosterGrid } from '@/features/driver-planning/components/driver-roster-grid';
import {
  getCompanyWeekPlan,
  getPlanningDrivers
} from '@/features/driver-planning/api/driver-planning.service';
import { snapYmdToWeekStart } from '@/features/driver-planning/lib/week-dates';
import { todayYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard: Fahrerschichtplanung'
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function FahrerschichtplanungPage({
  searchParams
}: PageProps) {
  const sp = await searchParams;
  const drivers = await getPlanningDrivers();

  const weekParam = firstParam(sp.week);
  const defaultWeekYmd = snapYmdToWeekStart(todayYmdInBusinessTz());
  const weekStartYmd =
    weekParam && weekParam.length >= 10
      ? snapYmdToWeekStart(weekParam)
      : defaultWeekYmd;

  const initialPlans = await getCompanyWeekPlan(weekStartYmd);

  return (
    <PageContainer
      pageTitle='Fahrerschichtplanung'
      pageDescription='Wochenplanung aller Fahrer — Status und Zeiten verwalten.'
    >
      <div className='space-y-6'>
        <DriverPlanningFilters
          defaultWeekYmd={defaultWeekYmd}
          drivers={drivers}
        />
        <DriverRosterGrid
          drivers={drivers}
          initialWeekStartYmd={weekStartYmd}
          initialPlans={initialPlans}
        />
      </div>
    </PageContainer>
  );
}
