# v4c Implementation — Fahrten Datum + Zeit Columns

Date: 2026-06-24  
Status: **DONE**

## Summary

v4c closes the Fahrten table audit gaps for **Datum** and **Zeit**:

1. **Datum fallback** — shows `requested_date` when `scheduled_at` is null (date-only / timeless rows).
2. **Inline Zeit** — new `ScheduledTimeCell` with debounced + blur/Enter save via shared `useInlineFieldDraft`.
3. **Shared hook** — `KtsFehlerTextCell` migrated to `useInlineFieldDraft` (1500ms debounce preserved).
4. **v4b compatibility** — time writes use `useUpdateTripMutation` + `refreshTripsPage()`; widget invalidation via mutation `onSettled` (`includePlanningWidgets: 'auto'`).

## Files changed

| File | Change |
|------|--------|
| `src/features/trips/components/trips-tables/inline-cells/use-inline-field-draft.ts` | **New** — mutation-agnostic draft + debounce + flush with `draftRef` |
| `src/features/trips/components/trips-tables/inline-cells/scheduled-time-cell.tsx` | **New** — inline time editor, `persistTime` mirrors detail sheet contract |
| `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` | Migrated `KtsFehlerTextCell` to shared hook |
| `src/features/trips/components/trips-tables/columns.tsx` | Datum `ymdToPickerDate` fallback; Zeit → `ScheduledTimeCell` |
| `src/features/trips/components/trips-tables/inline-cells/index.ts` | Barrel exports |

## Time write contract (`ScheduledTimeCell.persistTime`)

- **Set time:** `buildScheduledAt(ymd, hm)` where `ymd` = scheduled day or `requested_date`.
- **First-time on date-only row:** patch includes `requested_date: null` (same as detail sheet).
- **Clear time:** `scheduled_at: null`, preserve `requested_date` from existing scheduled day or `requested_date`.
- **Display:** `parseScheduledAtOrFallback(trip.scheduled_at)?.hm` — not `format(new Date(...))`.

## Manual verification

See plan manual test cases 1–7 in `.cursor/plans/v4c_fahrten_table_columns_c2a77961.plan.md`.

Test 6 (KTS regression) is the Step 2 checkpoint before additive Steps 3–5.

## Out of scope (deferred)

- Mobile card parity
- DriverSelectCell invalidation alignment
- v5a display TZ cleanup
