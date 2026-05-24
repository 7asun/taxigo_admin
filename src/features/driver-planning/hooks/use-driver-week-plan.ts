'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  deleteDayPlanAction,
  getCompanyWeekPlanAction,
  getDriverWeekPlanAction,
  upsertDayPlanAction
} from '../actions';
import { snapYmdToWeekStart } from '../lib/week-dates';
import type { DriverDayPlan, UpsertDayPlanPayload } from '../types';

const STALE_MS = 5 * 60 * 1000;

export const driverWeekPlanKeys = {
  week: (driverId: string, weekStartYmd: string) =>
    ['driver-week-plan', driverId, weekStartYmd] as const
};

export const companyWeekPlanKeys = {
  week: (weekStartYmd: string) => ['company-week-plan', weekStartYmd] as const
};

type UseDriverWeekPlanOpts = {
  initialData?: DriverDayPlan[];
};

export function useDriverWeekPlan(
  driverId: string | null,
  weekStartYmd: string | null,
  options?: UseDriverWeekPlanOpts
) {
  const enabled = Boolean(driverId && weekStartYmd);

  return useQuery<DriverDayPlan[]>({
    queryKey: driverWeekPlanKeys.week(driverId ?? '', weekStartYmd ?? ''),
    queryFn: () => getDriverWeekPlanAction(driverId!, weekStartYmd!),
    enabled,
    staleTime: STALE_MS,
    initialData: options?.initialData
  });
}

export function useCompanyWeekPlan(
  weekStartYmd: string | null,
  options?: UseDriverWeekPlanOpts
) {
  const enabled = weekStartYmd !== null;

  return useQuery<DriverDayPlan[]>({
    queryKey: companyWeekPlanKeys.week(weekStartYmd ?? ''),
    queryFn: () => getCompanyWeekPlanAction(weekStartYmd!),
    enabled,
    staleTime: STALE_MS,
    initialData: options?.initialData
  });
}

function invalidateWeekPlans(
  queryClient: ReturnType<typeof useQueryClient>,
  driverId: string,
  planDate: string
) {
  const week = snapYmdToWeekStart(planDate);
  void queryClient.invalidateQueries({
    queryKey: driverWeekPlanKeys.week(driverId, week)
  });
  void queryClient.invalidateQueries({
    queryKey: companyWeekPlanKeys.week(week)
  });
}

export function useUpsertDayPlan(driverId: string, _weekStartYmd: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpsertDayPlanPayload) => upsertDayPlanAction(payload),
    onSuccess: (_data, payload) => {
      toast.success('Planung gespeichert.');
      invalidateWeekPlans(queryClient, payload.driverId, payload.planDate);
    }
  });
}

type DeleteDayPlanVars = { planId: string; planDate: string };

export function useDeleteDayPlan(driverId: string, _weekStartYmd: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ planId }: DeleteDayPlanVars) => deleteDayPlanAction(planId),
    onSuccess: (_data, { planDate }) => {
      toast.success('Planung gelöscht.');
      invalidateWeekPlans(queryClient, driverId, planDate);
    }
  });
}
