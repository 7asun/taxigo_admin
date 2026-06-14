# PR3.3b — Single-row "Übergeben" action audit

**Date:** 2026-06-10  
**Scope:** Read-only audit before adding a per-row handover action in the KTS queue table.  
**Context:** PR3.3 shipped bulk handover (korrekt-only checkbox selection + `KtsHandoverBulkBar`). This audit answers where and how to add single-trip "Übergeben" without duplicating mutation logic.

**Files read:**

- `src/features/kts/components/kts-table/kts-actions-cell.tsx`
- `src/features/kts/components/kts-table/kts-columns.tsx`
- `src/features/kts/components/kts-table/kts-expand-row.tsx`
- `src/features/kts/components/kts-table/kts-data-table.tsx`
- `src/features/kts/components/kts-table/kts-handover-bulk-bar.tsx`
- `src/features/kts/components/kts-table/index.tsx` (for `enableRowSelection` wiring)
- `src/features/kts/hooks/use-kts-status.ts`
- `src/features/kts/kts.service.ts` (`createKtsHandover` + payload/error mapping)
- `src/components/icons.tsx`
- `src/hooks/use-data-table.ts` (line 304 — `enableRowSelection` coalesce)

---

## 1. korrekt actions cell — current state

When `kts_status = 'korrekt'`, `KtsActionsCell` renders **one secondary button only** — not empty, not a dash. There is **no primary button** and **no handover action**.

Exact branch (`kts-actions-cell.tsx` lines 135–145):

```tsx
  if (status === 'korrekt') {
    return (
      <ActionButtons
        disabled={anyPending}
        secondary={{
          label: 'Erneut öffnen',
          icon: AlertCircle,
          onClick: () => toggleExpand('fehler')
        }}
      />
    );
  }
```

`ActionButtons` only renders `primary` when the `primary` prop is provided (`kts-actions-cell.tsx` lines 172–174). For `korrekt`, only `secondary` is passed, so the cell shows a single ghost button **"Erneut öffnen"** (Lucide `AlertCircle`) that opens expand mode `'fehler'`.

`anyPending` tracks `checkedMutation`, `clearMutation`, and `receiveMutation` only — **not** handover (`kts-actions-cell.tsx` lines 50–53).

---

## 2. kts_status branch coverage

Evaluation order in `KtsActionsCell` is sequential `if` blocks; final fallthrough is `return null`.

| `kts_status` | Rendered UI | Notes |
| ------------ | ----------- | ----- |
| `'uebergeben'` | Muted dash | Early return: `<span className='text-muted-foreground text-xs'>—</span>` (lines 63–66) |
| `'ungeprueft'` | Two buttons | Primary **"Korrekt"** (`Check`) → `markKtsChecked`; secondary **"Fehler melden"** (`X`) → expand `'fehler'` (lines 69–87) |
| `'fehlerhaft'` | Two buttons | Primary **"An Aussteller senden"** (`Send`) → expand `'send'`; secondary **"Fehler aufheben"** (`RotateCcw`) → `clearKtsMistake` (lines 90–108) |
| `'in_korrektur'` | One primary button | **"Erhalten"** (`Check`) → `receiveKtsCorrection`; disabled when no open round id (lines 111–132) |
| `'korrekt'` | One secondary button | **"Erneut öffnen"** (`AlertCircle`) → expand `'fehler'`; no primary (lines 135–145) |
| `null` / other | `null` | Final `return null` (line 148) — empty actions cell |

`KtsExpandState` type is `{ id: string; mode: 'fehler' \| 'send' } | null` (`kts-actions-cell.tsx` line 29). No `'handover'` or `'korrekt'` expand mode exists today.

---

## 3. expand row — korrekt mode

**No.** `KtsExpandRow` only supports `'fehler'` and `'send'`.

Props type (`kts-expand-row.tsx` lines 26–30):

```tsx
export interface KtsExpandRowProps {
  trip: KtsTripRow;
  mode: 'fehler' | 'send';
  onClose: () => void;
}
```

Rendering branches on `mode === 'fehler'` vs else (send input) (`kts-expand-row.tsx` lines 185–211):

```tsx
        {mode === 'fehler' ? (
          <Textarea
            ...
          />
        ) : (
          <Input
            ...
          />
        )}
```

`handleConfirm` only handles `fehler` (mark fehlerhaft) or else send correction (`kts-expand-row.tsx` lines 126–141). There is no reference to `kts_status === 'korrekt'` or handover.

`kts-data-table.tsx` mounts expand row only when `expandedRow?.id === row.id`, passing `mode={expandedRow.mode}` (lines 134–141). Expand modes originate solely from `KtsActionsCell.toggleExpand('fehler' | 'send')`.

---

## 4. useCreateKtsHandoverMutation — current signature

**Arguments:** `{ tripIds: string[] }` only — **not** a single `tripId` string.

**companyId:** Resolved **inside** the hook via `fetchKtsCompanyId()` — caller does **not** supply it.

Exact `mutationFn` (`use-kts-status.ts` lines 142–157):

```tsx
export function useCreateKtsHandoverMutation() {
  const { onKtsBatchWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: async ({ tripIds }: { tripIds: string[] }) => {
      const companyId = await fetchKtsCompanyId();
      if (!companyId) {
        throw new Error('Unternehmen konnte nicht ermittelt werden.');
      }
      const supabase = createClient();
      return createKtsHandover(supabase, { companyId, tripIds });
    },
    onSuccess: async (_data, { tripIds }) => {
      await onKtsBatchWriteSuccess(tripIds);
    }
  });
}
```

Service layer expects batch array (`kts.service.ts`):

```tsx
export interface CreateKtsHandoverPayload {
  companyId: string;
  tripIds: string[];
}

export async function createKtsHandover(
  supabase: SupabaseClient,
  payload: CreateKtsHandoverPayload
): Promise<{ handoverId: string }> {
  if (payload.tripIds.length === 0) {
    throw new Error('Es muss mindestens ein KTS-Beleg ausgewählt sein.');
  }
  // ... rpc('create_kts_handover', { p_company_id, p_trip_ids })
}
```

Single-trip handover can call `mutateAsync({ tripIds: [trip.id] })` without hook changes — RPC accepts a one-element array.

---

## 5. Checkbox gating — current implementation

### Column cell + header (`kts-columns.tsx`)

Header (lines 35–59):

```tsx
      header: ({ table }) => {
        const korrektRows = table.getRowModel().rows.filter(
          (r) => r.original.kts_status === KTS_STATUS_KORREKT
        );
        const allKorrektSelected =
          korrektRows.length > 0 &&
          korrektRows.every((r) => r.getIsSelected());
        const someKorrektSelected = korrektRows.some((r) => r.getIsSelected());

        return (
          <Checkbox
            checked={
              allKorrektSelected ||
              (someKorrektSelected && !allKorrektSelected && 'indeterminate')
            }
            disabled={korrektRows.length === 0}
            onCheckedChange={(value) => {
              const select = !!value;
              for (const row of korrektRows) {
                row.toggleSelected(select);
              }
            }}
            aria-label='Alle auswählen'
          />
        );
      },
```

Cell (lines 61–70):

```tsx
      cell: ({ row }) => {
        const isKorrekt = row.original.kts_status === KTS_STATUS_KORREKT;
        return (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!isKorrekt}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label='Zeile auswählen'
          />
        );
      },
```

Uses `KTS_STATUS_KORREKT` constant from `kts.service.ts` (import line 22).

### `enableRowSelection` callback

Passed via **`useDataTable`** in `kts-table/index.tsx` (lines 29–37):

```tsx
  const { table } = useDataTable({
    data,
    columns,
    pageCount,
    shallow: false,
    debounceMs: 500,
    getRowId: (row) => row.id,
    enableRowSelection: (row) => row.original.kts_status === 'korrekt'
  });
```

`use-data-table.ts` forwards it with coalesce (line 304):

```tsx
    enableRowSelection: tableProps.enableRowSelection ?? true,
```

**Dual gating:** column UI disables non-korrekt checkboxes **and** TanStack `enableRowSelection` prevents programmatic selection of ineligible rows.

---

## 6. Bulk bar — companyId source

**The bulk bar does not obtain `companyId` at all.**

It only calls the mutation with trip IDs (`kts-handover-bulk-bar.tsx` lines 26–27, 55–60):

```tsx
export function KtsHandoverBulkBar({ table }: KtsHandoverBulkBarProps) {
  const handoverMutation = useCreateKtsHandoverMutation();
  ...
  await handoverMutation.mutateAsync({ tripIds: korrektTripIds });
```

No prop, no local hook, no session lookup in this component. `companyId` is resolved inside `useCreateKtsHandoverMutation` → `fetchKtsCompanyId()` from `src/features/kts/lib/fetch-kts-company-id.ts`.

Props interface is `{ table: TanstackTable<KtsTripRow> }` only (lines 22–24).

---

## 7. Icon availability (`icons.tsx`)

Scanned `src/components/icons.tsx` exports on `Icons` object and Tabler imports.

| Requested | `Icons` export | Status |
| --------- | -------------- | ------ |
| Check | `check` → `IconCheck` | **Exists** (line 83) |
| PackageCheck | — | **Does not exist** |
| ArrowRight | `arrowRight` → `IconArrowRight` | **Exists** (line 75) |
| Upload | — | **Does not exist** |
| Handshake | — | **Does not exist** |
| Send | — | **Does not exist** on `Icons` |
| ArrowUpRight | — | **Does not exist** |
| Forward | — | **Does not exist** |

**Related exports already used in KTS UI:**

- `Icons.post` → `IconFileText` — bulk bar handover button (line 64)
- `Icons.close`, `Icons.spinner` — bulk bar clear / pending

**Note:** `kts-actions-cell.tsx` imports Lucide icons directly (`Check`, `Send`, `X`, etc.) — not via `Icons`. A single-row button could follow either pattern: `Icons.post` / `Icons.arrowRight` for registry consistency with bulk bar, or Lucide direct like existing action buttons.

---

## 8. Senior recommendation

### Where to place single-row "Übergeben"

**Inline in `kts-actions-cell.tsx` for `status === 'korrekt'`** — add a **primary** `ActionButtons` entry alongside existing secondary "Erneut öffnen".

Rationale from current shape:

- Every other workflow transition that does not need free text is **one-click in the actions cell** (`Korrekt`, `Erhalten`, `Fehler aufheben`).
- Expand row is reserved for **text input** (`fehler` description, `send` recipient) — handover needs no input, only confirm.
- Bulk bar already uses `AlertDialog` for batch confirm; single-row can use the same pattern locally (small dialog) or match other one-click mutations (`markKtsChecked`) if product accepts no confirm for single trip.

**Recommended layout for `korrekt` branch:**

```tsx
primary:   { label: 'Übergeben', icon: Icons.post or ArrowRight, onClick → confirm → mutate }
secondary: { label: 'Erneut öffnen', ... existing ... }
```

Do **not** add a new expand mode `'handover'` unless product later requires notes on handover — would expand `KtsExpandState`, `KtsExpandRow`, and `kts-data-table.tsx` for no current requirement.

### Checkbox column — keep, remove, or opt-in?

**Keep as-is (recommended).** Bulk and single-row serve different workflows:

| Path | Use case |
| ---- | -------- |
| Checkbox + bulk bar | End-of-day batch: select many korrekt rows on current page → one RPC |
| Actions cell "Übergeben" | Ad-hoc: hand over one trip while reviewing the row |

Removing checkboxes saves one column but loses batch efficiency. Making checkboxes opt-in globally adds complexity with little gain — gating is already korrekt-only.

Optional polish (not required for PR3.3b): hide checkbox column on viewports where bulk is unused — out of scope unless product asks.

### Minimum change to wire single-trip handover

1. **`kts-actions-cell.tsx` only** (plus optional tiny confirm helper):
   - Import `useCreateKtsHandoverMutation`.
   - Add `handoverMutation.isPending` to `anyPending`.
   - In `korrekt` branch, add `primary` button calling `handoverMutation.mutateAsync({ tripIds: [trip.id] })`.
   - Success: `toast.success` (match bulk bar copy for `length === 1`).
   - Error: inline in `AlertDialog` (match PR3.3 locked UX) **or** reuse bulk bar's dialog pattern in a shared `KtsHandoverConfirmDialog` — avoid duplicating RPC/service logic, not necessarily dialog JSX.

2. **No hook or service changes required** — `{ tripIds: [tripId] }` is valid today.

3. **Optional extract (DRY dialog only):** shared confirm component used by bulk bar + actions cell — mutation stays in `useCreateKtsHandoverMutation`.

### Risks

| Risk | Mitigation |
| ---- | ---------- |
| Duplicate confirm UX (bulk dialog vs row dialog) | Extract shared `AlertDialog` wrapper; keep one mutation hook |
| Row + bulk pending race | Include `handoverMutation.isPending` in `anyPending`; disable both paths while pending |
| "Erneut öffnen" vs "Übergeben" mis-click | Primary/default styling on Übergeben; secondary ghost on Erneut öffnen (matches ungeprueft pattern) |
| No confirm on single click | Product choice: one-click like `Korrekt` vs confirm like bulk — recommend **confirm** for irreversible handover |
| Row disappears after handover | Default filter `ungeprueft` — expected; same as bulk |
| `mapCreateKtsHandoverError` missing row-count message | Migration adds `updated % but expected %` — add German mapping when wiring UI |

---

## Summary table

| Question | Answer |
| -------- | ------ |
| korrekt cell today | One secondary button "Erneut öffnen" only |
| Expand korrekt mode | No — only `fehler` \| `send` |
| Mutation args | `{ tripIds: string[] }`; companyId internal |
| Single trip call | `mutateAsync({ tripIds: [trip.id] })` |
| Checkbox gating | Column disable + `enableRowSelection` in `index.tsx` |
| Bulk bar companyId | Not used in component; hook resolves it |
| Best icon | `Icons.post` (bulk parity) or `Icons.arrowRight` |
| Min change | Primary button in `kts-actions-cell.tsx` korrekt branch |

*Audit only — no application code changed.*
