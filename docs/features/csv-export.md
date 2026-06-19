# CSV Export

Feature overview for the Fahrten CSV export wizard, shared column registry, and filter contract.

## Architecture

| Module | Role |
|--------|------|
| `src/features/trips/lib/export-columns.registry.ts` | Single column registry (`EXPORT_COLUMN_DEFS`) with labels, categories, and CSV accessors |
| `src/features/trips/lib/export-query.ts` | `ExportFilters` Zod schemas, preview param parsing/serialization, `applyExportFilters()` |
| `src/features/trips/types/csv-export.types.ts` | Typed `ExportFilters`, assignee/status/KTS filter shapes |
| `src/features/trips/hooks/use-export-filter-prefill.ts` | Maps current Fahrten URL params into export wizard defaults |
| `src/app/api/trips/export/route.ts` | POST download — `{ filters, columns, includeHeaders }` |
| `src/app/api/trips/export/preview/route.ts` | GET count + flattened sample rows |

Both API routes scope `company_id` outside `applyExportFilters`, then share the same filter applier and select fragment (`EXPORT_TRIPS_SELECT`).

## Wizard steps

1. **Export-Filter** (`export-filter-step.tsx`) — payer (single-select UI → `payerIds[]`), billing variants (multi-select), assignee, status, KTS/Reha
2. **Date range** — unchanged UI; writes `filters.dateFrom` / `filters.dateTo`
3. **Column selector** — reads `EXPORT_COLUMN_DEFS` via `csv-export-constants.ts` re-export
4. **Preview** — calls preview API with structured query params; sample rows are flattened through registry accessors

Opening the dialog merges `useExportFilterPrefill()` over `createDefaultExportFilters()`.

## Filter contract

```typescript
interface ExportFilters {
  payerIds: string[];
  billingVariantIds: string[];
  assigneeFilter: ExportAssigneeFilter | null;
  statusFilter: ExportStatusFilterValue[];
  ktsFilter: KtsFilterValue[];
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
}
```

### Billing variant loading (export filter step)

- `payerIds.length === 1` → `useBillingVariantsForPayerQuery(payerIds[0])`
- otherwise → `useBillingVariantsQuery()` (all variants)

### Preview query params

| Param | Maps to |
|-------|---------|
| `date_from`, `date_to` | required date range |
| `payer_ids` | comma-separated UUIDs |
| `billing_variant_ids` | comma-separated UUIDs |
| `status` | comma-separated status values |
| `kts_filter` | comma-separated KTS tokens |
| `assignee_type` | `driver` \| `fremdfirma` \| `unassigned` |
| `assignee_id` | required for `driver`/`fremdfirma`; must be absent for `unassigned` |

POST body shape:

```json
{
  "filters": { "...": "ExportFilters" },
  "columns": ["id", "scheduled_date"],
  "includeHeaders": true
}
```

KTS filter semantics match the trips list via `buildKtsTripFilterPlan()` (including `no_kts + no_reha` AND case).

Date bounds use `getZonedDayBoundsIso()` from `trip-business-date.ts` (Europe/Berlin), not runtime-local `Date` math.

## Column registry

- Uses `net_price` (DB generated column) — not the stale API-only `price` key
- Joined display columns: `payer_name`, `billing_variant_name`, `billing_family_name`, `driver_name`
- Server-safe: no React or Supabase client imports

## Deferred (not in this refactor)

- SELECT projection optimization (still fetches `*` + joins)
- Invoice status export filter
- Additional DB columns beyond current selector whitelist
- One-click “export exactly current table view” beyond URL prefill

See also: [`docs/plans/csv-export-audit.md`](../plans/csv-export-audit.md)
