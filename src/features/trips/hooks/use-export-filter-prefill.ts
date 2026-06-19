'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';

import { parseKtsFilterParam } from '@/features/trips/lib/kts-filter';
import {
  instantToYmdInBusinessTz,
  isYmdString,
  todayYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';
import { parseAssigneeParam } from '@/features/trips/lib/trip-assignee';
import {
  createDefaultExportFilters,
  EXPORT_STATUS_FILTER_VALUES,
  type ExportAssigneeFilter,
  type ExportFilters,
  type ExportStatusFilterValue
} from '@/features/trips/types/csv-export.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseUuidList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => UUID_RE.test(part));
}

function parseStatusList(raw: string | null): ExportStatusFilterValue[] {
  if (!raw || raw === 'all') return [];
  const allowed = new Set<string>(EXPORT_STATUS_FILTER_VALUES);
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part): part is ExportStatusFilterValue => allowed.has(part));
}

function parseAssigneeFromUrl(
  driverIdParam: string | null
): ExportAssigneeFilter | null {
  const parsed = parseAssigneeParam(driverIdParam);
  switch (parsed.kind) {
    case 'unassigned':
      return { type: 'unassigned' };
    case 'driver':
      return { type: 'driver', driverId: parsed.id };
    case 'fremdfirma':
      return { type: 'fremdfirma', fremdfirmaId: parsed.id };
    default:
      return null;
  }
}

/**
 * WHY: mirrors trips-listing.tsx date parsing so table-view export always reflects
 * the same date scope the user sees in the table.
 */
function parseDateRangeFromScheduledAt(scheduledAt: string | null): {
  dateFrom: string;
  dateTo: string;
} {
  const today = todayYmdInBusinessTz();

  if (!scheduledAt) {
    return { dateFrom: today, dateTo: today };
  }

  const parts = scheduledAt.split(',');
  if (parts.length === 2) {
    const fromMs = Number(parts[0]);
    const toMs = Number(parts[1]);
    if (!Number.isNaN(fromMs) && !Number.isNaN(toMs)) {
      return {
        dateFrom: instantToYmdInBusinessTz(fromMs),
        dateTo: instantToYmdInBusinessTz(toMs)
      };
    }
  }

  if (isYmdString(scheduledAt)) {
    return { dateFrom: scheduledAt, dateTo: scheduledAt };
  }

  const ts = Number(scheduledAt);
  if (!Number.isNaN(ts)) {
    const ymd = instantToYmdInBusinessTz(ts);
    return { dateFrom: ymd, dateTo: ymd };
  }

  return { dateFrom: today, dateTo: today };
}

/**
 * Reads current Fahrten list URL filters and maps them into ExportFilters defaults.
 * WHY: the list view already stores filter state in the URL — prefill avoids re-selecting filters.
 */
export function useExportFilterPrefill(): ExportFilters {
  const searchParams = useSearchParams();

  return useMemo(() => {
    const defaults = createDefaultExportFilters();
    const dateRange = parseDateRangeFromScheduledAt(
      searchParams.get('scheduled_at')
    );

    return {
      ...defaults,
      payerIds: parseUuidList(searchParams.get('payer_id')),
      billingVariantIds: parseUuidList(searchParams.get('billing_variant_id')),
      assigneeFilter: parseAssigneeFromUrl(searchParams.get('driver_id')),
      statusFilter: parseStatusList(searchParams.get('status')),
      ktsFilter: parseKtsFilterParam(searchParams.get('kts_filter')),
      dateFrom: dateRange.dateFrom ?? defaults.dateFrom,
      dateTo: dateRange.dateTo ?? defaults.dateTo
    };
  }, [searchParams]);
}
