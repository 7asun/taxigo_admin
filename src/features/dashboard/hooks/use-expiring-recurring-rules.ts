'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays } from 'date-fns';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { RecurringRule } from '@/features/trips/api/recurring-rules.service';
import {
  instantToYmdInBusinessTz,
  todayYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { recurringKeys } from '@/query/keys';

/** Days ahead of Berlin "today" to warn (today+1 … today+N). Not including today. */
export const EXPIRY_WARNING_DAYS = 3;

export type ExpiringRecurringRule = Pick<
  RecurringRule,
  'id' | 'end_date' | 'client_id'
> & {
  clients: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
};

export type ExpiringRulesBannerProps = {
  rules: ExpiringRecurringRule[];
  day1Ymd: string;
  day2Ymd: string;
  day3Ymd: string;
};

function berlinYmdPlusDays(todayYmd: string, days: number): string {
  return instantToYmdInBusinessTz(
    addDays(ymdToPickerDate(todayYmd), days).getTime()
  );
}

/**
 * Active rules whose `end_date` falls on Berlin today+1 … today+EXPIRY_WARNING_DAYS.
 * WHY Berlin helpers: `end_date` is a calendar string; device-local "tomorrow" can disagree
 * with dispatcher/cron semantics near midnight.
 * WHY `.in(end_date, [...])` not a range: we want exactly three urgency buckets, not
 * "any time in the next 3 days" from today (today itself is excluded — cron already ended).
 */
export async function fetchExpiringRecurringRules(
  day1Ymd: string,
  day2Ymd: string,
  day3Ymd: string
): Promise<ExpiringRecurringRule[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('recurring_rules')
    .select(
      `
      id,
      end_date,
      client_id,
      clients (
        id,
        first_name,
        last_name
      )
    `
    )
    .eq('is_active', true)
    .in('end_date', [day1Ymd, day2Ymd, day3Ymd])
    .order('end_date', { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as ExpiringRecurringRule[];
}

export function useExpiringRecurringRules() {
  const todayYmd = todayYmdInBusinessTz();
  const { day1Ymd, day2Ymd, day3Ymd } = useMemo(() => {
    return {
      day1Ymd: berlinYmdPlusDays(todayYmd, 1),
      day2Ymd: berlinYmdPlusDays(todayYmd, 2),
      day3Ymd: berlinYmdPlusDays(todayYmd, 3)
    };
  }, [todayYmd]);

  const query = useQuery({
    // WHY day3Ymd in key: window end scopes cache to the full 3-day banner window.
    queryKey: recurringKeys.expiring(day3Ymd),
    queryFn: () => fetchExpiringRecurringRules(day1Ymd, day2Ymd, day3Ymd),
    staleTime: 5 * 60_000
  });

  useEffect(() => {
    if (!query.error || query.data) return;
    toast.error(
      `Fehler beim Laden der ablaufenden Regelfahrten: ${(query.error as Error).message}`
    );
  }, [query.error, query.data]);

  return {
    rules: query.data ?? [],
    day1Ymd,
    day2Ymd,
    day3Ymd,
    isLoading: query.isLoading,
    isError: query.isError
  };
}
