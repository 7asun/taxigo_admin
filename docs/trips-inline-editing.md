# Trips table — inline editing (KTS / Reha)

This document describes how editable cells work on the dashboard trips **list** view (`/dashboard/trips`), and how to extend the pattern safely.

## Folder layout

```
src/features/trips/types/
  trip-row.ts              # Shared TripRow type (Trip + payer embed); import from here, not kts-cells.tsx

src/features/trips/lib/
  trip-assignment-flags.ts # Pure flag helpers: hasKtsRehaOverlap — no React, no URL semantics

src/features/trips/components/trips-tables/
  columns.tsx              # Column definitions — imports cells only from ./inline-cells
  inline-cells/
    index.ts                             # Barrel — re-export domain groups
    kts-cells.tsx                        # KTS document / Fehler / Fehler-Text
    reha-cells.tsx                       # Reha-Schein (gated by payer)
    assignment-conflict-indicator.tsx    # Presentational overlap badge (KTS + Reha)
```

**Rule:** `columns.tsx` must import cell components **only** from `./inline-cells`, not from deep paths. That lets you split or merge `*-cells.tsx` files without churn in the column map.

## Data flow

- **RSC** [`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx) loads rows with `payer:payers(name, reha_schein_enabled)` (list + kanban).
- Row typing for the embed: [`TripListRow`](../src/features/trips/api/trips.service.ts) (`Trip` + payer shape).
- Cells call [`useTripFieldUpdate`](../src/features/trips/hooks/use-trip-field-update.ts) (single-field) or [`useUpdateTripMutation`](../src/features/trips/hooks/use-update-trip-mutation.ts) (multi-field), which hit `tripsService.updateTrip` and **invalidate** queries — **no optimistic** `setQueryData` merges.

## Single-field vs multi-field updates

| Situation | Use |
|-----------|-----|
| One column maps to one DB column | `useTripFieldUpdate` → `updateField(tripId, field, value)` |
| Turning off a “parent” flag must clear dependent fields in one write | `useUpdateTripMutation` + `mutate({ id, patch: { ... } })` + **short comment** at the call site explaining the cascade |

Examples of multi-field patches in `kts-cells.tsx`:

- **KTS off:** `kts_document_applies: false` plus `kts_fehler: false` and `kts_fehler_beschreibung: null`.
- **KTS-Fehler off:** `kts_fehler: false` plus `kts_fehler_beschreibung: null`.

## Current cells

| Column id | Component | Notes |
|-----------|-----------|--------|
| `kts_document_applies` | `KtsSwitchCell` + `AssignmentConflictIndicator` | Switch always present; amber triangle overlay when KTS and Reha-Schein are both active. |
| `kts_fehler` | `KtsFehlerSwitchCell` | `—` when `!kts_document_applies`. |
| `kts_fehler_beschreibung` | `KtsFehlerTextCell` | Debounced 400 ms; read-only display (tooltip + truncate) when KTS off or Fehler off. |
| `reha_schein` | `RehaScheinSwitchCell` | `—` when payer has no `reha_schein_enabled` (embed). Hidden by default; overlap indicator lives in KTS column for default visibility. |

**Price engine:** `kts_document_applies` is included in `shouldRecalculatePrice`; toggling KTS in the grid can trigger the same optional price recomputation as elsewhere.

## KTS/Reha overlap indicator

When `kts_document_applies = true` AND `reha_schein = true`, a small amber `AlertTriangle` icon appears in the top-right corner of the KTS cell as an absolutely positioned overlay. It carries `aria-label` and `sr-only` text: `"KTS und Reha-Schein gleichzeitig aktiv"`.

**Rule:** `hasKtsRehaOverlap(trip)` in [`src/features/trips/lib/trip-assignment-flags.ts`](../src/features/trips/lib/trip-assignment-flags.ts) is the single source of truth for the overlap condition. Never inline the boolean check in a cell or column definition.

**Design constraints:**
- `AssignmentConflictIndicator` renders `null` when there is no overlap — zero DOM output for the ~99 % of non-overlap rows.
- The indicator is `absolute` positioned inside a `relative` wrapper div added to the KTS column cell. It takes no space in the normal document flow; the KTS switch position and column width are identical on overlap and non-overlap rows.
- Amber is intentional: this is an informational signal, not an error. Destructive (red) is reserved for actual data errors.
- The indicator does NOT follow optimistic KTS/Reha toggles in real time; it updates after the next server refresh. Optimistic sync is deferred (see audit doc).
- Do NOT reuse `AssignmentConflictIndicator` outside the trips table without considering whether the same `relative` wrapper pattern applies.

## Payer embed

Reha inline editing **must not** infer eligibility from trip flags alone. The list/kanban query embeds `payers.reha_schein_enabled` so the grid matches **Neue Fahrt** and the trip **detail sheet** gate.

## How to add a new inline cell

1. Implement the component under `inline-cells/` (new file per domain group, or extend an existing `*-cells.tsx` if the fields cascade).
2. Export it from `inline-cells/index.ts`.
3. In `columns.tsx`, import from `./inline-cells` and swap **only** the relevant `cell` renderer — keep `id`, `header`, `meta`, filter flags, accessors, and column order unchanged unless the product asks for it.

## Deferred / out of scope

- Optimistic row updates in the table.
- Inline editing on **Kanban** cards (still uses staged pending store, not this hook pattern).
- Bulk edit shortcuts for KTS/Reha.

---

## Why this folder structure (decision record)

When Plan E was designed, three options were evaluated for
where to put inline cell components:

**Option A — One monolithic file (`inline-cells.tsx`)**
All cell components in one file. Feels tidy at 4 cells.
Rejected because: at 8–10 cells the file exceeds 500 lines.
Finding, editing, or debugging one cell means scrolling through
all others. Cognitive overhead grows with every addition.

**Option B — One file per cell component**
(`kts-switch-cell.tsx`, `kts-fehler-switch-cell.tsx`, etc.)
Maximum isolation. Rejected because: creates too many tiny files
for small, semantically related components. Navigation overhead
outweighs the isolation benefit at this scale.

**Option C — One file per feature group (chosen)**
(`kts-cells.tsx`, `reha-cells.tsx`, future: `billing-cells.tsx`)
KTS cells are semantically coupled — they cascade into each other
(KTS off clears KTS-Fehler; KTS-Fehler off clears description).
Grouping them in one file makes that relationship visible in the
code structure, not just in comments.

The barrel `index.ts` means `columns.tsx` never knows about the
internal grouping — it imports from `'./inline-cells'` and the
folder structure can evolve freely without touching columns.

**The rule for future additions:**

- Semantically related cells (fields that cascade or share a
  domain concept) → same `*-cells.tsx` file
- Unrelated domain → new `*-cells.tsx` file
- When unsure → new file (easier to merge later than to split)
