---
name: kts abrechnung tab
overview: Implement the KTS Abrechnung tab, `ruecklaufer`/`bezahlt` statuses, group-level RPCs, UI, KPIs, mutations, and docs while preserving the existing Bearbeitung queue unchanged.
todos:
  - id: migrations-status-rpcs
    content: Add enum, grouping/count, transition, KPI, and import-v4 migrations with tenant guards and build gates.
    status: completed
  - id: status-types-service
    content: Regenerate/update database types, KTS status constants/badges, and service wrappers.
    status: completed
  - id: abrechnung-data-ui
    content: Add Abrechnung group types, RSC listing, filters, table, expand row, hooks, and KPIs.
    status: completed
  - id: wire-tabs
    content: Wire KTS header/page tab routing while preserving Bearbeitung default behavior.
    status: completed
  - id: docs-verify
    content: Update KTS architecture docs, create PR4.2 plan status doc, and run final verification gates.
    status: completed
isProject: false
---

# KTS Abrechnung Tab Plan

## Key Corrections From Read-Through

- Keep `kts_belegnummer` as the primary grouping key, but expose duplicate/import-batch signals because `docs/plans/kts-belegnummer-uniqueness-audit.md` proves no cross-import uniqueness guard exists.
- Restructure `get_kts_abrechnung_groups` as a CTE/subquery so aggregate `bool_or` / `bool_and` filters happen after grouping. The provided aggregate-in-`WHERE` shape is not valid SQL.
- Add tenant guards to all new `SECURITY DEFINER` RPCs, matching `get_kts_queue_kpis` and `apply_kts_invoice_import`: `current_user_is_admin()` and `p_company_id = current_user_company_id()`.
- Make the count RPC mirror the same search/status/date filters as the list RPC, so pagination is correct.
- Implement the `ruecklaufer` reimport path by changing `apply_kts_invoice_import` v4 to accept rows where `kts_status = 'ruecklaufer'`, not by clearing Belegnummer in a separate pre-step.

## Implementation Sequence

1. Add enum migration `supabase/migrations/20260619190000_kts_bezahlt_ruecklaufer.sql`.
   - Add `ruecklaufer` after `abgerechnet`, then `bezahlt` after `ruecklaufer`.
   - Update enum comment to document `ruecklaufer -> abgerechnet` via reimport and terminal `bezahlt`.
   - Run `bun run build` before continuing.

2. Add Abrechnung group/list/count RPC migration `supabase/migrations/20260619190100_kts_abrechnung_groups_rpc.sql`.
   - Return grouped rows by `kts_belegnummer` with amounts, date range, group status, import metadata, and duplicate/import-batch visibility such as `import_count` and `has_multiple_imports`.
   - Use a grouped CTE, then filter `group_status` in the outer query.
   - Include `imported_from` / `imported_to` parameters if the UI exposes import-date filters.
   - Add internal tenant authorization CTE/guard.
   - Run `bun run build`.

3. Add transition RPC migrations.
   - `supabase/migrations/20260619190200_kts_mark_bezahlt_rpc.sql`: atomically mark all `abgerechnet` trips for a Belegnummer as `bezahlt`; block if any `ruecklaufer` exists.
   - `supabase/migrations/20260619190300_kts_mark_ruecklaufer_rpc.sql`: mark `abgerechnet` trips for a Belegnummer as `ruecklaufer` with optional reason returned in JSON.
   - Add required migration `supabase/migrations/20260619190400_kts_mark_abgerechnet_rpc.sql` for `mark_belegnummer_abgerechnet`, because the UX keeps the manual "Zurück zu Abgerechnet" escape hatch on `ruecklaufer` rows.
   - `mark_belegnummer_abgerechnet` must only transition `ruecklaufer -> abgerechnet` for the matching company and Belegnummer; it must not mark trips paid or touch non-`ruecklaufer` rows.
   - Add auth guards and stable JSON result shapes.
   - Run `bun run build`.

4. Update the invoice import RPC for `ruecklaufer` reimport.
   - Create `supabase/migrations/20260619190500_kts_invoice_import_rpc_v4.sql` based on `20260610174000_kts_invoice_import_rpc_v3.sql`.
   - Preserve v3 patient-ID null-only behavior.
   - Change the trip update guard to allow `t.kts_belegnummer IS NULL OR t.kts_status = 'ruecklaufer'`.
   - Ensure the validation/stamped-count path also counts `ruecklaufer` rows correctly, not as skipped already-imported rows.
   - Run `bun run build`.

5. Regenerate/update database types and status layer.
   - Update `src/types/database.types.ts` so `kts_status` and `Constants.public.Enums.kts_status` include `ruecklaufer` and `bezahlt`.
   - Update `src/lib/kts-status.ts` with badge variants, labels, dots, value order, and exported constants.
   - Update `src/features/kts/kts.service.ts` with named constants and service wrappers for the new RPCs.
   - Extend the terminal/no-action guard in `src/features/kts/components/kts-table/kts-actions-cell.tsx` for `ruecklaufer` and `bezahlt`.
   - Run `bun run build` and `bun test`.

6. Add Abrechnung types and data fetchers.
   - Create `src/features/kts/types/kts-abrechnung-group.ts` for group rows and `AbrechnungGroupStatus`.
   - Create hooks for group mutations and expand-row trip loading:
     - `src/features/kts/hooks/use-kts-abrechnung-mutations.ts`
     - `src/features/kts/hooks/use-abrechnung-trips-by-belegnummer.ts`
   - Use separate query keys for Abrechnung groups/trips/KPIs and invalidate them with `tripKeys.all` and `ktsKpiKey` where appropriate.
   - Run `bun run build`.

7. Add the Abrechnung RSC and filters.
   - Create `src/features/kts/components/kts-abrechnung-listing-page.tsx` parallel to `kts-listing-page.tsx`.
   - Create `src/features/kts/components/kts-abrechnung-filters-bar.tsx` for Belegnummer search, Abrechnung-only status filters, import-date filters, and count display.
   - Before adding `imported_from` and `imported_to` to `src/lib/searchparams.ts`, search `src/lib/searchparams.ts` and the app for existing equivalent names or consumers.
   - Add `imported_from` and `imported_to` only after confirming no existing params cover the same scope and no other page reads those keys.
   - After adding them, search the app again and confirm the only consumers are the new Abrechnung filter/listing path, so no unrelated RSC query can accidentally pick them up.
   - Do not reuse `KtsFiltersBar`, because it has the Bearbeitung-only `ungeprueft` default.
   - Run `bun run build`.

8. Add the Abrechnung table as a separate table family.
   - Create `src/features/kts/components/kts-abrechnung-table/index.tsx`.
   - Create `kts-abrechnung-columns.tsx`, `kts-abrechnung-data-table.tsx`, and `kts-abrechnung-expand-row.tsx` in that folder.
   - Keep `KtsDataTable` unchanged because it is constrained to `KtsTripRow`.
   - Show group columns: expand, Belegnummer, trip count, Betrag, Eigenanteil, imported date/source, status, and duplicate/import warning if `has_multiple_imports` is true.
   - Expand row shows individual trips, import metadata, and actions for `abgerechnet`, `ruecklaufer`, and `bezahlt`.
   - Run `bun run build`.

9. Add Abrechnung KPIs.
   - Create `supabase/migrations/20260619190600_kts_abrechnung_kpis_rpc.sql` with tenant guard.
   - Create `src/features/kts/hooks/use-kts-abrechnung-kpis.ts`.
   - Create `src/features/kts/components/kts-abrechnung-kpi-section.tsx`.
   - Return totals for Belege, invoiced amount, paid amount, and open actionable groups.
   - Run `bun run build`.

10. Wire tabs into the existing page without changing Bearbeitung behavior.
   - Update `src/app/dashboard/kts/kts-header.tsx` to render Bearbeitung/Abrechnung tab controls using `view`, treating legacy `list` as Bearbeitung.
   - Swap KPI section by active tab: existing `KtsKpiSection` for Bearbeitung and new `KtsAbrechnungKpiSection` for Abrechnung.
   - Update `src/app/dashboard/kts/page.tsx` to choose `KtsListingPage` or `KtsAbrechnungListingPage` based on `view`.
   - Gate the existing `KtsFiltersBar` default effect so it does not set `kts_status=ungeprueft` on `view=abrechnung`.
   - Keep `TripsRealtimeSync` mounted for both tabs.
   - Run `bun run build` and `bun test`.

11. Documentation and final plan status.
   - Update `docs/kts-architecture.md` with new statuses, transitions, RPCs, Abrechnung tab architecture, and deferred Phase 2 bank CSV reconciliation.
   - Create `docs/plans/kts-pr4.2-abrechnung-tab.md` listing all completed steps and created/modified files.
   - Add inline `why` comments to each new code path, focused on invariants such as Belegnummer grouping, tenant guards, reimport semantics, and Bearbeitung-tab isolation.
   - Run final `bun run build`, `bun test`, and targeted lint diagnostics for edited files.

## Invariants To Preserve

- `/dashboard/kts` without `?view=` continues to render the existing Bearbeitung queue.
- Existing `KtsTable`, `KtsDataTable`, current queue filters, row actions, and bulk handover behavior are not refactored.
- No bank CSV reconciliation UI, import history browser, mobile-specific optimization, or optimistic updates are included.
- All new `SECURITY DEFINER` functions enforce tenant isolation internally.
- Belegnummer grouping exposes cross-import ambiguity rather than silently hiding it.