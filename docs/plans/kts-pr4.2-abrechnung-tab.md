# KTS PR4.2 Abrechnung Tab — implementation status

**Completed:** 2026-06-19

## Summary

PR4.2 Phase 1 ships the **Abrechnung** tab on `/dashboard/kts`, terminal `bezahlt` / workflow `ruecklaufer` statuses, group-level RPCs, manual payment transitions, and CSV reimport for ruecklaufer resolution. The existing **Bearbeitung** queue is unchanged when `view` is absent or `list`.

**Deferred:** bank CSV bulk reconciliation (PR5), import history browser, mobile layout, optimistic UI.

## Migrations (applied in repo)

| File | Purpose |
| ---- | ------- |
| `20260619190000_kts_bezahlt_ruecklaufer.sql` | Enum `ruecklaufer`, `bezahlt` |
| `20260619190100_kts_abrechnung_groups_rpc.sql` | `get_kts_abrechnung_groups`, `get_kts_abrechnung_groups_count` |
| `20260619190200_kts_mark_bezahlt_rpc.sql` | `mark_belegnummer_bezahlt` |
| `20260619190250_kts_ruecklaufer_reason.sql` | `trips.kts_ruecklaufer_reason` column |
| `20260619190300_kts_mark_ruecklaufer_rpc.sql` | `mark_belegnummer_ruecklaufer` (persists reason) |
| `20260619190400_kts_mark_abgerechnet_rpc.sql` | `mark_belegnummer_abgerechnet` (required escape hatch) |
| `20260619190500_kts_invoice_import_rpc_v4.sql` | `apply_kts_invoice_import` — ruecklaufer reimport |
| `20260619190600_kts_abrechnung_kpis_rpc.sql` | `get_kts_abrechnung_kpis` |

## New files

- `src/features/kts/types/kts-abrechnung-group.ts`
- `src/features/kts/hooks/use-kts-abrechnung-kpis.ts`
- `src/features/kts/hooks/use-kts-abrechnung-mutations.ts`
- `src/features/kts/hooks/use-abrechnung-trips-by-belegnummer.ts`
- `src/features/kts/components/kts-abrechnung-kpi-section.tsx`
- `src/features/kts/components/kts-abrechnung-filters-bar.tsx`
- `src/features/kts/components/kts-abrechnung-listing-page.tsx`
- `src/features/kts/components/kts-abrechnung-table/index.tsx`
- `src/features/kts/components/kts-abrechnung-table/kts-abrechnung-columns.tsx`
- `src/features/kts/components/kts-abrechnung-table/kts-abrechnung-data-table.tsx`
- `src/features/kts/components/kts-abrechnung-table/kts-abrechnung-expand-row.tsx`

## Modified files

- `src/types/database.types.ts` — enum + RPC types
- `src/lib/kts-status.ts` — badges, labels, Abrechnung filter constants
- `src/lib/searchparams.ts` — `imported_from`, `imported_to` (Abrechnung-only consumers verified)
- `src/features/kts/kts.service.ts` — status constants, Abrechnung fetchers + mark RPC wrappers
- `src/features/kts/components/kts-table/kts-actions-cell.tsx` — terminal guard extended
- `src/features/kts/components/kts-filters-bar.tsx` — gate ungeprueft default off Abrechnung tab
- `src/app/dashboard/kts/page.tsx` — tab-aware listing swap
- `src/app/dashboard/kts/kts-header.tsx` — tab switcher + KPI swap
- `docs/kts-architecture.md` — §3.8 Abrechnung tab + roadmap update

## Verification gates

- `bun run build` — pass
- `bun test` — 358 pass

## Key invariants

1. `/dashboard/kts` without `?view=` renders Bearbeitung only.
2. Belegnummer grouping exposes `has_multiple_imports` — no silent cross-import dedupe.
3. All new RPCs enforce tenant guards internally.
4. `mark_belegnummer_abgerechnet` only transitions `ruecklaufer → abgerechnet`.
5. `imported_from` / `imported_to` are consumed only by Abrechnung filter/listing paths.
