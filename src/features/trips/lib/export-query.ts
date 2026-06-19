/**
 * Shared CSV export filter parsing and Supabase query application.
 *
 * WHY extracted: preview and download routes previously duplicated payer/billing/date filters
 * with a local (incorrect) date-bound helper. One applier keeps export semantics aligned with
 * the trips list — especially KTS `no_kts + no_reha` AND semantics via `buildKtsTripFilterPlan`.
 */

import { z } from 'zod';

import {
  buildKtsTripFilterPlan,
  KTS_FILTER_VALUES,
  normalizeKtsFilterValues,
  type KtsFilterValue
} from '@/features/trips/lib/kts-filter';
import { getZonedDayBoundsIso } from '@/features/trips/lib/trip-business-date';
import {
  EXPORT_STATUS_FILTER_VALUES,
  type ExportAssigneeFilter,
  type ExportFilters,
  type ExportStatusFilterValue
} from '@/features/trips/types/csv-export.types';

/** Supabase select used by both export routes — keep joins identical for preview vs download. */
export const EXPORT_TRIPS_SELECT = `
  *,
  payer:payers!trips_payer_id_fkey(name),
  billing_variant:billing_variants!trips_billing_variant_id_fkey(name, billing_types!billing_variants_billing_type_id_fkey(name)),
  driver:accounts!trips_driver_id_fkey(name),
  fremdfirma:fremdfirmen!trips_fremdfirma_id_fkey(name)
`;

interface ChainableQuery {
  eq: (column: string, value: unknown) => ChainableQuery;
  in: (column: string, values: readonly unknown[]) => ChainableQuery;
  is: (column: string, value: null) => ChainableQuery;
  not: (column: string, operator: string, value: unknown) => ChainableQuery;
  or: (filters: string) => ChainableQuery;
}

const uuidSchema = z.string().uuid();

const exportAssigneeFilterSchema = z.union([
  z.object({
    type: z.literal('driver'),
    driverId: uuidSchema
  }),
  z.object({
    type: z.literal('fremdfirma'),
    fremdfirmaId: uuidSchema
  }),
  z.object({
    type: z.literal('unassigned')
  })
]);

export const exportFiltersSchema = z.object({
  payerIds: z.array(uuidSchema).default([]),
  billingVariantIds: z.array(uuidSchema).default([]),
  assigneeFilter: exportAssigneeFilterSchema
    .nullable()
    .optional()
    .default(null),
  statusFilter: z.array(z.enum(EXPORT_STATUS_FILTER_VALUES)).default([]),
  ktsFilter: z.array(z.enum(KTS_FILTER_VALUES)).default([]),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const exportRequestSchema = z.object({
  filters: exportFiltersSchema,
  columns: z.array(z.string()).min(1, 'Mindestens eine Spalte auswählen'),
  includeHeaders: z.boolean().optional().default(true)
});

const assigneeTypeSchema = z.enum(['driver', 'fremdfirma', 'unassigned']);

function splitCsvParam(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseUuidList(values: string[]): string[] {
  return values.filter((v) => uuidSchema.safeParse(v).success);
}

function parseStatusFilter(values: string[]): ExportStatusFilterValue[] {
  const allowed = new Set<string>(EXPORT_STATUS_FILTER_VALUES);
  const seen = new Set<ExportStatusFilterValue>();
  const out: ExportStatusFilterValue[] = [];
  for (const value of values) {
    if (allowed.has(value) && !seen.has(value as ExportStatusFilterValue)) {
      const typed = value as ExportStatusFilterValue;
      seen.add(typed);
      out.push(typed);
    }
  }
  return out;
}

function parseAssigneeFromPreviewParams(
  assigneeType: string | null,
  assigneeId: string | null
): ExportAssigneeFilter | null {
  const parsedType = assigneeType
    ? assigneeTypeSchema.safeParse(assigneeType)
    : null;

  if (!parsedType?.success) {
    return null;
  }

  if (parsedType.data === 'unassigned') {
    if (assigneeId) {
      throw new Error(
        'assignee_id darf bei assignee_type=unassigned nicht gesetzt sein.'
      );
    }
    return { type: 'unassigned' };
  }

  if (!assigneeId || !uuidSchema.safeParse(assigneeId).success) {
    throw new Error(
      `assignee_id ist erforderlich bei assignee_type=${parsedType.data}.`
    );
  }

  if (parsedType.data === 'driver') {
    return { type: 'driver', driverId: assigneeId };
  }

  return { type: 'fremdfirma', fremdfirmaId: assigneeId };
}

/** Parse GET /api/trips/export/preview query params into ExportFilters. */
export function parseExportFiltersFromPreviewParams(
  searchParams: URLSearchParams
): ExportFilters {
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');

  if (!dateFrom || !dateTo) {
    throw new Error('date_from und date_to sind erforderlich.');
  }

  let assigneeFilter: ExportAssigneeFilter | null = null;
  const assigneeType = searchParams.get('assignee_type');
  const assigneeId = searchParams.get('assignee_id');

  if (assigneeType) {
    assigneeFilter = parseAssigneeFromPreviewParams(assigneeType, assigneeId);
  } else if (assigneeId) {
    throw new Error('assignee_id ohne assignee_type ist nicht erlaubt.');
  }

  const filters: ExportFilters = {
    payerIds: parseUuidList(splitCsvParam(searchParams.get('payer_ids'))),
    billingVariantIds: parseUuidList(
      splitCsvParam(searchParams.get('billing_variant_ids'))
    ),
    assigneeFilter,
    statusFilter: parseStatusFilter(splitCsvParam(searchParams.get('status'))),
    ktsFilter: normalizeKtsFilterValues(
      splitCsvParam(searchParams.get('kts_filter'))
    ),
    dateFrom,
    dateTo
  };

  const validated = exportFiltersSchema.safeParse(filters);
  if (!validated.success) {
    throw new Error(validated.error.issues.map((i) => i.message).join(', '));
  }

  return validated.data;
}

/** Serialize ExportFilters to preview-route query params. */
export function buildExportPreviewSearchParams(
  filters: ExportFilters
): URLSearchParams {
  const params = new URLSearchParams();
  params.set('date_from', filters.dateFrom);
  params.set('date_to', filters.dateTo);

  if (filters.payerIds.length > 0) {
    params.set('payer_ids', filters.payerIds.join(','));
  }
  if (filters.billingVariantIds.length > 0) {
    params.set('billing_variant_ids', filters.billingVariantIds.join(','));
  }
  if (filters.statusFilter.length > 0) {
    params.set('status', filters.statusFilter.join(','));
  }
  if (filters.ktsFilter.length > 0) {
    params.set('kts_filter', filters.ktsFilter.join(','));
  }

  if (filters.assigneeFilter) {
    if (filters.assigneeFilter.type === 'unassigned') {
      params.set('assignee_type', 'unassigned');
    } else if (filters.assigneeFilter.type === 'driver') {
      params.set('assignee_type', 'driver');
      params.set('assignee_id', filters.assigneeFilter.driverId);
    } else {
      params.set('assignee_type', 'fremdfirma');
      params.set('assignee_id', filters.assigneeFilter.fremdfirmaId);
    }
  }

  return params;
}

function applyKtsFilter(
  query: ChainableQuery,
  ktsFilter: readonly KtsFilterValue[]
): ChainableQuery {
  const ktsPlan = buildKtsTripFilterPlan(ktsFilter);

  if (ktsPlan.mode === 'single') {
    const t = ktsPlan.token;
    if (t === 'kts') {
      return query.eq('kts_document_applies', true) as ChainableQuery;
    }
    if (t === 'kts_fehler') {
      return query
        .eq('kts_document_applies', true)
        .eq('kts_fehler', true) as ChainableQuery;
    }
    if (t === 'no_kts') {
      return query.eq('kts_document_applies', false) as ChainableQuery;
    }
    if (t === 'no_reha') {
      return query.eq('reha_schein', false) as ChainableQuery;
    }
    if (t === 'reha') {
      return query.eq('reha_schein', true) as ChainableQuery;
    }
  } else if (ktsPlan.mode === 'missing-both') {
    return query
      .eq('kts_document_applies', false)
      .eq('reha_schein', false) as ChainableQuery;
  } else if (ktsPlan.mode === 'any-of') {
    const orParts: string[] = [];
    const remainingTokens = ktsPlan.includeMissingBoth
      ? ktsPlan.tokens.filter((t) => t !== 'no_kts' && t !== 'no_reha')
      : ktsPlan.tokens;

    for (const t of remainingTokens) {
      if (t === 'kts') orParts.push('kts_document_applies.eq.true');
      else if (t === 'kts_fehler') {
        orParts.push('and(kts_document_applies.eq.true,kts_fehler.eq.true)');
      } else if (t === 'no_kts') orParts.push('kts_document_applies.eq.false');
      else if (t === 'no_reha') orParts.push('reha_schein.eq.false');
      else if (t === 'reha') orParts.push('reha_schein.eq.true');
    }

    if (ktsPlan.includeMissingBoth) {
      orParts.push('and(kts_document_applies.eq.false,reha_schein.eq.false)');
    }

    if (orParts.length > 0) {
      return query.or(orParts.join(',')) as ChainableQuery;
    }
  }

  return query;
}

/**
 * Apply export filters to a trips query. Caller must scope `company_id` first.
 * Uses business-TZ day bounds from `trip-business-date.ts` (not runtime-local Date math).
 */
export function applyExportFilters<T>(query: T, filters: ExportFilters): T {
  const q = query as unknown as ChainableQuery;
  const { startISO: fromISO } = getZonedDayBoundsIso(filters.dateFrom);
  const { endExclusiveISO: toISO } = getZonedDayBoundsIso(filters.dateTo);

  let next = q.or(
    `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO}),and(scheduled_at.is.null,requested_date.gte.${filters.dateFrom},requested_date.lte.${filters.dateTo})`
  ) as ChainableQuery;

  if (filters.payerIds.length > 0) {
    next = next.in('payer_id', filters.payerIds) as ChainableQuery;
  }

  if (filters.billingVariantIds.length > 0) {
    next = next.in(
      'billing_variant_id',
      filters.billingVariantIds
    ) as ChainableQuery;
  }

  if (filters.assigneeFilter) {
    switch (filters.assigneeFilter.type) {
      case 'unassigned':
        next = next
          .is('driver_id', null)
          .is('fremdfirma_id', null) as ChainableQuery;
        break;
      case 'driver':
        next = next.eq(
          'driver_id',
          filters.assigneeFilter.driverId
        ) as ChainableQuery;
        break;
      case 'fremdfirma':
        next = next.eq(
          'fremdfirma_id',
          filters.assigneeFilter.fremdfirmaId
        ) as ChainableQuery;
        break;
    }
  }

  if (filters.statusFilter.length === 1) {
    next = next.eq('status', filters.statusFilter[0]!) as ChainableQuery;
  } else if (filters.statusFilter.length > 1) {
    next = next.in('status', filters.statusFilter) as ChainableQuery;
  }

  next = applyKtsFilter(next, filters.ktsFilter);

  return next as unknown as T;
}

export function validateExportDateRange(filters: ExportFilters): string | null {
  if (new Date(filters.dateFrom) > new Date(filters.dateTo)) {
    return 'Das Startdatum darf nicht nach dem Enddatum liegen.';
  }
  return null;
}
