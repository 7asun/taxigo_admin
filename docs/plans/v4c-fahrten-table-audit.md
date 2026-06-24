# v4c: Fahrten Table Datum + Zeit Columns — Read-Only Audit

**Date:** 2026-06-23  
**Scope:** `/dashboard/trips` (UI title **Fahrten**) — Datum/Zeit column behaviour, inline-edit reference (KTS-Fehler text), and v4c implementation prerequisites.  
**No code changes in this audit.**

---

## File Map

| # | Role | Path |
|---|------|------|
| 1 | Fahrten route page (RSC) | [`src/app/dashboard/trips/page.tsx`](../../src/app/dashboard/trips/page.tsx) — renders `TripsListingPage` inside `FahrtenPageShell` |
| 2 | Fahrten client shell + RSC refresh provider | [`src/app/dashboard/trips/fahrten-page-shell.tsx`](../../src/app/dashboard/trips/fahrten-page-shell.tsx) |
| 3 | Server data loader (list + kanban) | [`src/features/trips/components/trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) — `tripsListSelect` uses `*` (all row columns including `scheduled_at`, `requested_date`) |
| 4 | Table wrapper | [`src/features/trips/components/trips-tables/index.tsx`](../../src/features/trips/components/trips-tables/index.tsx) — `TripsTable` |
| 5 | **Column definitions (Datum + Zeit + KTS)** | [`src/features/trips/components/trips-tables/columns.tsx`](../../src/features/trips/components/trips-tables/columns.tsx) |
| 6 | Narrow-view cards (date/time display) | [`src/features/trips/components/trips-tables/trips-mobile-card-list.tsx`](../../src/features/trips/components/trips-tables/trips-mobile-card-list.tsx) |
| 7 | KTS inline cells (reference pattern) | [`src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx`](../../src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx) |
| 8 | Inline cells barrel | [`src/features/trips/components/trips-tables/inline-cells/index.ts`](../../src/features/trips/components/trips-tables/inline-cells/index.ts) |
| 9 | Single-field grid mutation wrapper | [`src/features/trips/hooks/use-trip-field-update.ts`](../../src/features/trips/hooks/use-trip-field-update.ts) |
| 10 | Core trip mutation + invalidation | [`src/features/trips/hooks/use-update-trip-mutation.ts`](../../src/features/trips/hooks/use-update-trip-mutation.ts) |
| 11 | Invalidation contract | [`src/features/trips/lib/invalidate-after-trip-save.ts`](../../src/features/trips/lib/invalidate-after-trip-save.ts) |
| 12 | Query keys | [`src/query/keys/trips.ts`](../../src/query/keys/trips.ts) |
| 13 | Row type | [`src/features/trips/types/trip-row.ts`](../../src/features/trips/types/trip-row.ts) — `TripRow = Trip & { payer: … }`; `Trip` = DB `trips` row |
| 14 | Berlin TZ time construction | [`src/features/trips/lib/trip-time.ts`](../../src/features/trips/lib/trip-time.ts) — `buildScheduledAt`, `buildScheduledAtOrNull`, `parseScheduledAt`, `parseScheduledAtOrFallback` |
| 15 | Detail sheet clear-time semantics | [`src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts`](../../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts) L262–278 |
| 16 | RSC list refresh after local writes | [`src/features/trips/providers/trips-rsc-refresh-provider.tsx`](../../src/features/trips/providers/trips-rsc-refresh-provider.tsx) + [`trips-realtime-sync.tsx`](../../src/features/trips/components/trips-realtime-sync.tsx) on Fahrten page |

**Route note:** There is no `src/app/.../fahrten/page.tsx`. The Fahrten UI lives at **`/dashboard/trips`** with page title “Fahrten” ([`page.tsx`](../../src/app/dashboard/trips/page.tsx) L12, L29).

---

## Q1–Q13 Findings

### DATUM COLUMN

#### Q1. What field(s) does the Datum cell currently read?

**`scheduled_at` only.** No `requested_date` fallback.

```88:114:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'scheduled_at',
    accessorKey: 'scheduled_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Datum' />
    ),
    cell: ({ cell }) => {
      const raw = cell.getValue<string>();
      if (raw == null || raw === '')
        return (
          <div className='flex justify-center px-1'>
            <span className='text-muted-foreground'>—</span>
          </div>
        );
      const date = new Date(raw);
      // ...
      return (
        <span className='font-medium'>
          {format(date, 'dd.MM.yyyy', { locale: de })}
        </span>
      );
    },
```

Row data includes `requested_date` via `select('*', …)` in [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) L97–102, but the Datum column never reads `row.original.requested_date`.

#### Q2. What does the cell render when `scheduled_at` is NULL and `requested_date` is set?

**Em dash (`—`)** — same as fully unscheduled rows. The column treats null/empty `scheduled_at` as “no date” and does not consult `requested_date`.

Contrast elsewhere in the same feature area:

```81:86:src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx
  if (trip.scheduled_at) {
    return format(new Date(trip.scheduled_at), 'PPp', { locale: de });
  }
  if (trip.requested_date) {
    return `${trip.requested_date} (ohne feste Uhrzeit)`;
  }
```

Detail sheet date draft uses `requested_date` when `scheduled_at` is absent ([`trip-detail-sheet.tsx`](../../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx) L538–539, L934–936).

#### Q3. Are `scheduled_at` and `requested_date` always the same calendar date in practice?

**No.** They diverge by design in several flows:

| Scenario | `scheduled_at` | `requested_date` | Source |
|----------|----------------|------------------|--------|
| Timeless / “Zeit offen” rule leg | `NULL` | Berlin YMD (e.g. today/tomorrow) | Cron generator, dashboard timeless widget filter |
| User sets first time on date-only trip | ISO from `buildScheduledAt` | **`NULL`** (cleared) | [`build-trip-details-patch.ts`](../../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts) L221–230 |
| Reschedule with clock time | ISO | **`NULL`** | [`trip-reschedule-dialog.tsx`](../../src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx) L75–78 |
| Reschedule “Zeitabsprache” (time empty) | **`NULL`** | YMD | Same L75–78 |
| User clears time in detail sheet | **`NULL`** | Preserved or derived from date picker / old instant | [`build-trip-details-patch.ts`](../../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts) L262–278 |
| Duplicate copy “nur Datum” | `NULL` | `targetDateYmd` | [`derive-duplicate-schedules.ts`](../../src/features/trips/lib/derive-duplicate-schedules.ts) tests |

Fahrten list filtering explicitly includes unscheduled rows by `requested_date` when `scheduled_at` is null ([`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) L231–299). Rows can appear in the table with `scheduled_at = NULL` and a populated `requested_date`.

---

### ZEIT COLUMN

#### Q4. What does the Zeit cell render when `scheduled_at` is NULL?

**Em dash (`—`)** in a muted, centered cell — identical guard to Datum.

```127:134:src/features/trips/components/trips-tables/columns.tsx
    cell: ({ cell, row }) => {
      const raw = cell.getValue<string>();
      if (raw == null || raw === '')
        return (
          <div className='flex justify-center px-1'>
            <span className='text-muted-foreground'>—</span>
          </div>
        );
```

Mobile cards use **“Keine Zeit”** for time and **`—`** for date when `scheduled_at` is absent ([`trips-mobile-card-list.tsx`](../../src/features/trips/components/trips-tables/trips-mobile-card-list.tsx) L74–80, L112–135).

#### Q5. Does any inline edit behaviour exist today for Zeit?

**No.** The Zeit column is read-only display: `format(date, 'HH:mm')` plus optional recurring `RepeatIcon` when `rule_id` is set ([`columns.tsx`](../../src/features/trips/components/trips-tables/columns.tsx) L143–158). No input, click handler, or mutation.

Other surfaces with `<input type="time">` (kanban card, detail sheet, widgets) are **outside** the Fahrten table columns.

#### Q6. What field does the Zeit cell read?

**`scheduled_at` only** (column `accessorKey: 'scheduled_at'`, id `'time'`). Time is derived at render time via `new Date(raw)` + `format(…, 'HH:mm')`. There is **no separate time-only DB field** on `trips`.

---

### INLINE EDIT PATTERN (KTS-Fehler reference)

The audit brief asks for “KTS-Fehler inline text edit”. The table has **two** KTS-Fehler columns:

| Column | Component | Edit type |
|--------|-----------|-----------|
| KTS-Fehler | `KtsFehlerSwitchCell` | Boolean `Switch` |
| KTS-Fehler (Text) | `KtsFehlerTextCell` | Text `<input>` |

**Q7–Q9 below focus on `KtsFehlerTextCell`** as the inline text reference (closest to a future Zeit cell).

#### Q7. Component name and path

- **`KtsFehlerTextCell`**
- [`src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx`](../../src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx) L255–323
- Wired from [`columns.tsx`](../../src/features/trips/components/trips-tables/columns.tsx) L552–560

#### Q8. Full interaction flow (`KtsFehlerTextCell`)

| Step | Behaviour |
|------|-----------|
| **Visibility** | If KTS off or KTS-Fehler switch off: read-only `—` or truncated tooltip text (L282–303). If both on: always shows editable `<input>` (L306–322) — **not** click-to-enter-edit. |
| **Edit trigger** | Input is visible immediately when eligible; focus by clicking the field. |
| **Input type** | Plain text `<input>` (L307–321), not `type="time"`. |
| **Save trigger** | **`onChange` → debounced persist (1500 ms)** via `useDebouncedCallback` (L270–277). No explicit blur handler; no Enter key handler. |
| **Mutation** | `useTripFieldUpdate().updateField(trip.id, 'kts_fehler_beschreibung', value)` (L256, L276) → [`use-trip-field-update.ts`](../../src/features/trips/hooks/use-trip-field-update.ts) → **`useUpdateTripMutation`** with patch `{ kts_fehler_beschreibung }`. |
| **Invalidation** | **`useUpdateTripMutation.onSettled`** → `invalidateAfterTripSave(queryClient, { tripIds: [id], patch, includePlanningWidgets: 'auto', includeTripList: true })` ([`use-update-trip-mutation.ts`](../../src/features/trips/hooks/use-update-trip-mutation.ts) L43–51). KTS fields are **not** in `PLANNING_WIDGET_PATCH_KEYS`, so `'auto'` does **not** bust widget roots for this save. |
| **RSC list refresh** | Cell does **not** call `refreshTripsPage()`. Fahrten table data is RSC; updates appear via **`TripsRealtimeSync`** debounced `refreshTripsPage()` on `trips` UPDATE ([`trips-realtime-sync.tsx`](../../src/features/trips/components/trips-realtime-sync.tsx) L28–44), mounted on [`page.tsx`](../../src/app/dashboard/trips/page.tsx) L40. |

**KTS-Fehler switch** (for completeness): `KtsFehlerSwitchCell` uses `useUpdateKtsMutation()` → `onSettled` invalidates only `tripKeys.detail(id)` + `tripKeys.all` ([`use-update-kts-mutation.ts`](../../src/features/kts/hooks/use-update-kts-mutation.ts) L40–43) — not `invalidateAfterTripSave`.

#### Q9. Reusable component or inlined?

**Standalone exported component** in `kts-cells.tsx`, re-exported via [`inline-cells/index.ts`](../../src/features/trips/components/trips-tables/inline-cells/index.ts). Column definition only mounts `<KtsFehlerTextCell trip={row.original} />`.

**Adaptation for Zeit:**

- **Pattern** (controlled draft + debounced/on-blur save + `useTripFieldUpdate` / `useUpdateTripMutation`) is reusable in spirit.
- **Not a drop-in reuse:** input type, gating logic (KTS active), and patch shape differ. Zeit needs `buildScheduledAt`, optional `requested_date` clearing, and planning-widget invalidation.
- **Minimum change:** Add new `ScheduledTimeCell` (or similar) in `inline-cells/`, export from barrel, swap Zeit column `cell` in `columns.tsx`. Extraction of a generic “debounced inline input” helper is optional, not required.

---

### TIME INPUT SPECIFICS

#### Q10. Constructing `scheduled_at` from date + HH:mm

**Shared utilities exist — use them; do not invent new TZ math.**

| Utility | Path | Use |
|---------|------|-----|
| **`buildScheduledAt(ymd, hm)`** | [`trip-time.ts`](../../src/features/trips/lib/trip-time.ts) L86–130 | Required when both date and time are known |
| **`buildScheduledAtOrNull(ymd, hm)`** | L141–153 | Optional time; returns `null` if ymd or hm empty |
| **`parseScheduledAt(iso)`** | L163–180 | Read Berlin `{ ymd, hm }` from existing `scheduled_at` |
| **`parseScheduledAtOrFallback(iso)`** | L189–198 | Safe read for display |

**Date source priority for v4c Zeit save (recommended, aligned with widgets + detail sheet):**

```typescript
const ymd =
  parseScheduledAtOrFallback(trip.scheduled_at)?.ymd ??
  trip.requested_date ??
  null; // block save if still null — no calendar day to attach time to
const scheduled_at = buildScheduledAt(ymd, hm);
```

When transitioning from date-only to timed, detail sheet also sets **`requested_date: null`** ([`build-trip-details-patch.ts`](../../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts) L226–230). v4c should mirror that in the patch `{ scheduled_at, requested_date: null }` when first assigning time from a `requested_date`-only row.

#### Q11. Clearing Zeit (empty save)

**Detail sheet behaviour (authoritative):** sets **`scheduled_at: null`** and **preserves** `requested_date` (priority: date picker → existing `requested_date` → Berlin YMD of former `scheduled_at`).

```262:278:src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts
  if (
    trip.scheduled_at &&
    !input.timeDraft.trim() &&
    !('scheduled_at' in patch)
  ) {
    patch.scheduled_at = null;
    patch.requested_date =
      input.dateYmdDraft ||
      trip.requested_date ||
      instantToYmdInBusinessTz(new Date(trip.scheduled_at).getTime());
  }
```

**Recommendation for v4c:** Match detail sheet — **clear → `scheduled_at: null`**, keep or set `requested_date` so the trip stays on the correct calendar day. Do **not** use `00:00` as a sentinel. Block save only when setting time without any resolvable YMD (both `scheduled_at` and `requested_date` null).

---

### COMPATIBILITY

#### Q12. Does `PLANNING_WIDGET_PATCH_KEYS` include `scheduled_at`?

**Yes.**

```9:18:src/features/trips/lib/invalidate-after-trip-save.ts
export const PLANNING_WIDGET_PATCH_KEYS = [
  'scheduled_at',
  'requested_date',
  'status',
  'driver_id',
  'fremdfirma_id',
  'rule_id',
  'linked_trip_id',
  'link_type'
] as const satisfies readonly (keyof UpdateTrip)[];
```

A patch containing `scheduled_at` (or `requested_date`) with `includePlanningWidgets: 'auto'` will bust `tripKeys.unplannedRoot` and `tripKeys.timelessRuleTripsRoot`.

#### Q13. Which mutation hook for Zeit inline edit?

**`useUpdateTripMutation`** (directly or via **`useTripFieldUpdate`** for a single-field API).

| Hook | Why / why not |
|------|----------------|
| **`useUpdateTripMutation`** | Correct for `scheduled_at` writes; `onSettled` already calls `invalidateAfterTripSave` with `'auto'` + patch → widgets + list detail caches. |
| **`useTripFieldUpdate`** | Thin wrapper over the same mutation — acceptable if patch is built as `{ scheduled_at, requested_date? }` via a custom save function (not limited to one DB column when clearing/requesting date). |
| **`useUpdateKtsMutation`** | KTS-only — wrong domain. |
| Raw Supabase in cell | Avoid — bypasses invalidation contract (cf. legacy `DriverSelectCell`). |

**Additional requirement:** After save, call **`refreshTripsPage()`** from `useTripsRscRefresh()` (or rely on realtime with known ~450 ms delay). Prefer explicit `refreshTripsPage()` in the Zeit cell for snappy RSC list updates, matching `DriverSelectCell` ([`driver-select-cell.tsx`](../../src/features/trips/components/trips-tables/driver-select-cell.tsx) L115).

---

## Senior Recommendation (A–D)

### A. KTS-Fehler pattern reuse for Zeit

**Not directly reusable as a component; the pattern is reusable.**

- Copy the **structure**: client cell component → local draft state → save via **`useUpdateTripMutation`** (or wrapper) → optional **`refreshTripsPage()`**.
- Do **not** copy debounce-only-on-change for time: prefer **`onBlur`** and/or **Enter** for `<input type="time">` (kanban uses debounced change — [`kanban-trip-card.tsx`](../../src/features/trips/components/kanban/kanban-trip-card.tsx) L212–220; table UX should feel immediate on commit).
- **Minimum files:** new `inline-cells/scheduled-time-cell.tsx` (or `time-cell.tsx`), one line change in `columns.tsx` Zeit column, barrel export.

### B. Datum fallback risk (`requested_date` when `scheduled_at` null)

**Low regression risk if implemented carefully.**

- **Positive:** Fixes visible gap — timeless and date-only rows currently show `—` in Datum despite having `requested_date` and appearing in date-filtered lists.
- **Display rule:** Format `requested_date` as `dd.MM.yyyy` (parse YMD string — **do not** use `new Date(requested_date)` without Berlin helpers; YMD is civil date, not UTC midnight).
- **Priority:** When both exist, prefer **`scheduled_at`** Berlin YMD (via `parseScheduledAtOrFallback`) over `requested_date` — they can diverge after partial edits.
- **Edge case:** After first time assignment, `requested_date` becomes null; Datum should follow `scheduled_at` only — no change from today for fully timed rows.

### C. Zeit inline edit edge cases (must handle in v4c plan)

| Edge case | Handling |
|-----------|----------|
| **Timezone** | Always `buildScheduledAt` / `parseScheduledAt` from [`trip-time.ts`](../../src/features/trips/lib/trip-time.ts) — never `format(new Date(scheduled_at))` for **writes** (v5a display fix is separate). |
| **No calendar day** | Both `scheduled_at` and `requested_date` null → disable input or toast; cannot attach time. |
| **First time on date-only row** | Patch `{ scheduled_at, requested_date: null }` per detail sheet. |
| **Clear time** | `{ scheduled_at: null, requested_date: preservedYmd }` per detail sheet. |
| **Partial / invalid HH:mm** | `buildScheduledAt` throws `TripTimeError` — surface toast, revert draft. |
| **Recurring `rule_id`** | Display-only `RepeatIcon` today; decide if inline edit is allowed (detail sheet allows time on rule legs via `build-trip-details-patch`). No technical block, but product may want guard. |
| **Group trips (`group_id`)** | Driver cell updates whole group; Zeit edit should **only update the single row** unless product says otherwise. |
| **RSC staleness** | Call `refreshTripsPage()` after successful save; mutation `'auto'` invalidation alone does not re-fetch RSC table props instantly. |
| **Mobile list** | [`trips-mobile-card-list.tsx`](../../src/features/trips/components/trips-tables/trips-mobile-card-list.tsx) duplicates date/time display — decide parity in v4c or defer. |
| **Sort** | Sort key remains `scheduled_at` ([`trips-sort-map`](../../src/features/trips/trips-sort-map.ts)); null-time rows sort relative to timed rows — unchanged. |

### D. Estimated file touch count for v4c

| File | Change |
|------|--------|
| `inline-cells/scheduled-time-cell.tsx` (new) | Zeit inline editor |
| `inline-cells/index.ts` | Export |
| `columns.tsx` | Datum fallback + Zeit cell component |
| `trips-mobile-card-list.tsx` | (Optional) Datum/`requested_date` + inline time parity |
| `docs/plans/v4c-*.md` or implementation note | Plan / contract |

**Total: 3–4 code files** (5 if mobile parity included). No migration. No cron changes.

---

## Open Questions for the Human

1. **Mobile parity:** Should narrow-view cards get the same Datum fallback and editable Zeit in v4c, or desktop table only?
2. **Recurring rule rows:** Allow inline Zeit edit on `rule_id` legs in the table, or read-only with link to detail sheet?
3. **Datum column scope:** v4c spec mentions Datum fallback — confirm priority order: `scheduled_at` (Berlin YMD) → `requested_date` → `—`.
4. **Save UX for time input:** Debounced (KTS text style) vs blur/Enter (kanban style) — product preference?
5. **DriverSelectCell invalidation debt:** Fahrer column still uses raw Supabase + `refreshTripsPage()` only (no `invalidateAfterTripSave`). Out of v4c scope, but Zeit should not copy that pattern.

---

## Verbatim Reference — Current Datum + Zeit Columns

```87:166:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'scheduled_at',
    accessorKey: 'scheduled_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Datum' />
    ),
    cell: ({ cell }) => {
      const raw = cell.getValue<string>();
      if (raw == null || raw === '')
        return (
          <div className='flex justify-center px-1'>
            <span className='text-muted-foreground'>—</span>
          </div>
        );
      const date = new Date(raw);
      if (Number.isNaN(date.getTime()) || date.getTime() <= 0) {
        return (
          <div className='flex justify-center px-1'>
            <span className='text-muted-foreground'>—</span>
          </div>
        );
      }
      return (
        <span className='font-medium'>
          {format(date, 'dd.MM.yyyy', { locale: de })}
        </span>
      );
    },
    // ...
  },
  {
    id: 'time',
    accessorKey: 'scheduled_at',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Zeit' />
    ),
    cell: ({ cell, row }) => {
      const raw = cell.getValue<string>();
      if (raw == null || raw === '')
        return (
          <div className='flex justify-center px-1'>
            <span className='text-muted-foreground'>—</span>
          </div>
        );
      // ... format HH:mm + UrgencyIndicator + RepeatIcon
    },
```

## Verbatim Reference — KTS-Fehler Text Cell Save Path

```255:277:src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx
export function KtsFehlerTextCell({ trip }: { trip: TripRow }) {
  const { updateField, isPending } = useTripFieldUpdate();
  // ...
  const debouncedPersist = useDebouncedCallback((raw: string) => {
    const { kts_fehler_beschreibung } = normalizeKtsPatch({
      kts_fehler_beschreibung: raw.trim() || null
    });
    updateField(trip.id, 'kts_fehler_beschreibung', kts_fehler_beschreibung);
  }, 1500);
```

## Verbatim Reference — Row Data Shape (list query)

```97:102:src/features/trips/components/trips-listing.tsx
    const tripsListSelect = `
    *,
    payer:payers(name, reha_schein_enabled),
    billing_variant:billing_variants(name, code, billing_types(name, color)),
    ${ASSIGNEE_JOIN_FRAGMENT}
  `;
```

Each list row is a full `trips` row: **`scheduled_at: string | null`**, **`requested_date: string | null`**, plus embeds. No separate time field.

---

## v4c Resolution

Date: 2026-06-24  
Status: **CLOSED**

All audit findings addressed. See [v4c-implementation.md](./v4c-implementation.md).

- **Datum:** `parseScheduledAtOrFallback(scheduled_at)?.ymd ?? requested_date` formatted via `ymdToPickerDate`.
- **Zeit:** `ScheduledTimeCell` with `useInlineFieldDraft`, `useUpdateTripMutation`, `refreshTripsPage()`.
- **KTS regression:** `KtsFehlerTextCell` on shared hook; debounce unchanged at 1500ms.
