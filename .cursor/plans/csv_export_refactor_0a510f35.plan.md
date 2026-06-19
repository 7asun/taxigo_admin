---
name: csv export refactor
overview: Refactor CSV export around a shared column registry and typed filter contract, then wire multi-select export filters through preview and download without adding the deferred invoice/status projection work.
todos:
  - id: types-registry
    content: Add shared export filter types and column registry with net_price fix.
    status: completed
  - id: query-helper
    content: Create shared export query helper and route validation/parsing contract.
    status: completed
  - id: api-routes
    content: Update preview and export routes atomically to use shared filters and registry.
    status: completed
  - id: reference-options
    content: Add all-billing-variants reference query for export filter UI.
    status: completed
  - id: wizard-ui
    content: Replace payer/billing step with full export filter step and wire dialog state/prefill.
    status: completed
  - id: docs-verify
    content: Update docs, add why comments, run build and lint verification.
    status: completed
isProject: false
---

# CSV Export Refactor Plan

## Approach

Implement this as one focused refactor across the CSV export feature. The plan keeps the existing 4-step wizard shape, but replaces the first step with a broader `ExportFilterStep`, centralizes column metadata, and makes preview/download share one filter applier.

Key adjustment from the draft: `useBillingVariantsForPayerQuery(null)` is intentionally disabled today, so the refactor should add an explicit all-billing-variants reference query for the export filter UI when no payer is selected.

## Mandatory Pre-Read Before Implementation

Before writing any code, read every file in this list in full. Do not start editing from assumptions or partial snippets.

- `[src/features/trips/components/csv-export/csv-export-dialog.tsx](src/features/trips/components/csv-export/csv-export-dialog.tsx)`
- `[src/features/trips/components/csv-export/csv-export-constants.ts](src/features/trips/components/csv-export/csv-export-constants.ts)`
- `[src/features/trips/components/csv-export/column-selector-step.tsx](src/features/trips/components/csv-export/column-selector-step.tsx)`
- `[src/features/trips/components/csv-export/payer-billing-step.tsx](src/features/trips/components/csv-export/payer-billing-step.tsx)`
- `[src/features/trips/components/csv-export/date-range-step.tsx](src/features/trips/components/csv-export/date-range-step.tsx)`
- `[src/features/trips/components/csv-export/preview-step.tsx](src/features/trips/components/csv-export/preview-step.tsx)`
- `[src/features/trips/types/csv-export.types.ts](src/features/trips/types/csv-export.types.ts)`
- `[src/features/trips/hooks/use-trip-form-data.ts](src/features/trips/hooks/use-trip-form-data.ts)`
- `[src/features/trips/hooks/use-trip-reference-queries.ts](src/features/trips/hooks/use-trip-reference-queries.ts)`
- `[src/features/trips/api/trip-reference-data.ts](src/features/trips/api/trip-reference-data.ts)`
- `[src/features/trips/lib/kts-filter.ts](src/features/trips/lib/kts-filter.ts)`
- `[src/features/trips/lib/trip-business-date.ts](src/features/trips/lib/trip-business-date.ts)`
- `[src/app/api/trips/export/route.ts](src/app/api/trips/export/route.ts)`
- `[src/app/api/trips/export/preview/route.ts](src/app/api/trips/export/preview/route.ts)`
- `[src/lib/searchparams.ts](src/lib/searchparams.ts)`
- `[src/types/database.types.ts](src/types/database.types.ts)` — read at least the full `trips`, `billing_types`, `billing_variants`, `payers`, `accounts`, and `fremdfirmen` table sections.
- `[docs/plans/csv-export-audit.md](docs/plans/csv-export-audit.md)`

## Files To Change

- Create `[src/features/trips/lib/export-columns.registry.ts](src/features/trips/lib/export-columns.registry.ts)` as the shared UI/API column registry.
- Create `[src/features/trips/lib/export-query.ts](src/features/trips/lib/export-query.ts)` for shared export filter parsing/query application.
- Create `[src/features/trips/hooks/use-export-filter-prefill.ts](src/features/trips/hooks/use-export-filter-prefill.ts)` for URL-based prefill.
- Modify `[src/features/trips/types/csv-export.types.ts](src/features/trips/types/csv-export.types.ts)` to define `ExportFilters`, status/filter token constants, and request shapes.
- Modify `[src/features/trips/api/trip-reference-data.ts](src/features/trips/api/trip-reference-data.ts)`, `[src/features/trips/hooks/use-trip-reference-queries.ts](src/features/trips/hooks/use-trip-reference-queries.ts)`, and `[src/query/keys/reference.ts](src/query/keys/reference.ts)` to add an all-billing-variants query for export UI.
- Rename `[src/features/trips/components/csv-export/payer-billing-step.tsx](src/features/trips/components/csv-export/payer-billing-step.tsx)` to `export-filter-step.tsx` and expand it.
- Modify `[src/features/trips/components/csv-export/csv-export-dialog.tsx](src/features/trips/components/csv-export/csv-export-dialog.tsx)`, `[src/features/trips/components/csv-export/column-selector-step.tsx](src/features/trips/components/csv-export/column-selector-step.tsx)`, and `[src/features/trips/components/csv-export/preview-step.tsx](src/features/trips/components/csv-export/preview-step.tsx)` to use the shared filters and registry.
- Modify `[src/app/api/trips/export/route.ts](src/app/api/trips/export/route.ts)` and `[src/app/api/trips/export/preview/route.ts](src/app/api/trips/export/preview/route.ts)` atomically.
- Update `[docs/plans/csv-export-audit.md](docs/plans/csv-export-audit.md)` and create `[docs/features/csv-export.md](docs/features/csv-export.md)`.

## Implementation Details

1. Add `ExportFilters` and constants in `csv-export.types.ts`:
   - `payerIds: string[]`, `billingVariantIds: string[]`, `assigneeFilter`, `statusFilter`, `ktsFilter`, `dateFrom`, `dateTo`.
   - Reuse the existing KTS token source from `kts-filter.ts` where practical, while re-exporting CSV export-facing types from `csv-export.types.ts` so export code has one import path.
   - Replace `billingTypeId` with `billingVariantIds` everywhere in export request/response contracts.

2. Create `export-columns.registry.ts`:
   - Define `TripExportRow` as `Database['public']['Tables']['trips']['Row']` plus joins for `payer`, `billing_variant`, `driver`, and `fremdfirma`.
   - Move all currently offered UI columns into `EXPORT_COLUMN_DEFS` with labels, categories, and accessors.
   - Fix the audit issue by using `net_price` and reading `trip.net_price`; do not carry forward the stale API-only `price` column.
   - Keep the file server-safe: no React, no browser APIs, no Supabase client.

3. Create `export-query.ts`:
   - Import `getZonedDayBoundsIso` from `trip-business-date.ts` rather than keeping the local API date-bound helper duplicated.
   - Apply `company_id` outside the helper in each route, then call `applyExportFilters(query, filters)`.
   - Implement date, payer, billing variant, assignee, status, and KTS filters explicitly.
   - For KTS, use `buildKtsTripFilterPlan()` so export semantics match the list view exactly.

4. Update API routes together:
   - `POST /api/trips/export` validates a body shaped like `{ filters, columns, includeHeaders }`.
   - Explicitly update the export route's Zod schema to the new nested body. Do not only update TypeScript types; runtime validation must accept `{ filters, columns, includeHeaders }`.
   - `GET /api/trips/export/preview` parses structured query params: `date_from`, `date_to`, `payer_ids`, `billing_variant_ids`, `assignee_type`, `assignee_id`, `status`, and `kts_filter`.
   - `assignee_type` accepts exactly `driver`, `fremdfirma`, or `unassigned`. For `driver` and `fremdfirma`, `assignee_id` is required and maps to the corresponding ID. For `unassigned`, `assignee_id` must be absent/ignored and the preview route must explicitly map it to `{ type: 'unassigned' }` so the query applies `.is('driver_id', null).is('fremdfirma_id', null)`.
   - Add a preview-route query-param Zod schema or equivalent explicit validation/normalization so invalid `assignee_type` / missing required `assignee_id` combinations fail clearly instead of being silently ignored.
   - Both routes select `*` plus joins for `payer`, `billing_variant.billing_types`, `driver`, and `fremdfirma`.
   - Both routes use the same `applyExportFilters` helper.
   - Export route imports `EXPORT_COLUMN_DEFS` and filters selected columns from that registry.

5. Add all-billing-variants reference query:
   - Add `fetchBillingVariants()` or `fetchAllBillingVariants()` in `trip-reference-data.ts`.
   - Add `referenceKeys.billingVariantsAll()` and `useBillingVariantsQuery()`.
   - Keep `useBillingVariantsForPayerQuery()` unchanged for existing forms/list filters.

6. Replace the first wizard step:
   - Rename the component to `ExportFilterStep`.
   - Render payer single-select, billing variant multi-select, assignee select with drivers/Fremdfirmen, status checkbox group, and KTS/Reha checkbox group.
   - Billing variant loading rule: when `filters.payerIds.length === 1`, call `useBillingVariantsForPayerQuery(filters.payerIds[0])`; when `filters.payerIds.length === 0` or `filters.payerIds.length > 1`, call `useBillingVariantsQuery()` for all variants.
   - Keep the payer UI single-select for now, but keep `payerIds: string[]` in `ExportFilters` so URL prefill and the API can represent the list-view multi-payer shape. The single-select UI writes either `[]` or `[payerId]`; prefilled multi-payer URLs can still be preserved and will trigger all-variant loading.
   - Keep selected values in a single `ExportFilters` object via `onFiltersChange`.

7. Wire the dialog:
   - Replace `payerId`, `billingTypeId`, `dateFrom`, and `dateTo` state with one `filters: ExportFilters` state.
   - Merge `useExportFilterPrefill()` over default filters when the dialog opens.
   - Keep `selectedColumns`, preview state, and export state separate.
   - Build preview URL params from `filters` using the structured param contract.
   - Preview URL serialization rules:
     - `payer_ids`, `billing_variant_ids`, `status`, and `kts_filter` are comma-separated lists when non-empty.
     - `assigneeFilter: { type: 'driver', driverId }` serializes as `assignee_type=driver&assignee_id=<driverId>`.
     - `assigneeFilter: { type: 'fremdfirma', fremdfirmaId }` serializes as `assignee_type=fremdfirma&assignee_id=<fremdfirmaId>`.
     - `assigneeFilter: { type: 'unassigned' }` serializes as `assignee_type=unassigned` with no `assignee_id`.
     - `assigneeFilter: null` omits both assignee params.
   - Send `{ filters, columns: selectedColumns, includeHeaders: true }` to the export route.
   - Update filename generation from the first selected payer/variant labels.

8. Wire column consumers:
   - Update `ColumnSelectorStep` and `PreviewStep` to import `EXPORT_COLUMN_DEFS` from the registry.
   - Leave the date range and column selector UI structure unchanged.
   - Remove `EXPORT_COLUMNS` from `csv-export-constants.ts`; keep category labels/order if still useful, or move category metadata into the registry module.

9. Document and verify:
   - Add a “Plan Executed” section to `csv-export-audit.md` with date and deviations.
   - Create `docs/features/csv-export.md` covering registry, filters, query helper, wizard structure, and deferred items.
   - Add targeted “why” comments in the new registry, query helper, prefill hook, dialog state replacement, and API route wiring.
   - Run `bun run build` after each major phase, then `ReadLints` on changed files.

## Verification Gates

- `bun run build` after types/registry/helper are introduced.
- `bun run build` after API routes are wired.
- `bun run build` after UI wiring is complete.
- `ReadLints` for all changed TS/TSX files.

## Deferred

- SELECT projection optimization.
- Invoice status export filter.
- Adding newly discovered missing DB columns beyond the currently offered selector columns.
- One-click “export exactly current table view” beyond URL prefill.