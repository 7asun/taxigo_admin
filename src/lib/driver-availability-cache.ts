import type { QueryClient } from '@tanstack/react-query';
import {
  companyWeekShiftsKeys,
  driverAvailabilityKeys
} from '@/query/keys/driver-availability';
import { snapYmdToWeekStart } from '@/features/driver-planning/lib/week-dates';

export function invalidateDriverAvailabilityCaches(
  queryClient: QueryClient,
  planDate?: string
): void {
  void queryClient.invalidateQueries({
    queryKey: driverAvailabilityKeys.root
  });
  if (planDate) {
    void queryClient.invalidateQueries({
      queryKey: driverAvailabilityKeys.driversDay(planDate)
    });
  } else {
    void queryClient.invalidateQueries({
      queryKey: ['drivers-availability']
    });
  }
}

export function invalidateCompanyWeekShifts(
  queryClient: QueryClient,
  planDate: string
): void {
  const week = snapYmdToWeekStart(planDate);
  void queryClient.invalidateQueries({
    queryKey: companyWeekShiftsKeys.week(week)
  });
}

export function invalidateShiftAndAvailabilityCaches(
  queryClient: QueryClient,
  planDate: string
): void {
  invalidateDriverAvailabilityCaches(queryClient, planDate);
  invalidateCompanyWeekShifts(queryClient, planDate);
}
