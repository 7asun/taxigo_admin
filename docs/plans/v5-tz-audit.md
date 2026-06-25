# v5 Pre-flight Audit: TZ Display + Constant Coverage

Date: 2026-06-24  
Scope: read-only audit — no code changes  
Roadmap items under review: **v5a** (display TZ fix), **v5b** (TZ constant consolidation)

---

## Executive summary

The codebase **already has a canonical business-TZ module** (`trip-business-date.ts` + `trip-time.ts`) used correctly on **write paths** and on **some read paths** (notably the Fahrten table date/time columns after v4c). However, display is **not uniform**: many UI surfaces still format `scheduled_at` with `date-fns` `format(new Date(iso), …)` or `toLocaleTimeString('de-DE', …)` **without** an explicit `Europe/Berlin` / `getTripsBusinessTimeZone()` conversion. Those calls use the **runtime local timezone** (browser OS TZ on client; UTC on Vercel SSR).

For the typical production user (German dispatcher, OS/browser set to `Europe/Berlin`), runtime-local formatting **matches Berlin wall clock** in most cases — consistent with “no TZ display issues reported.” The risk is **latent**: wrong display (or wrong draft prefill) when runtime TZ ≠ business TZ, or near **UTC midnight boundaries** where calendar date differs from Berlin civil day.

**Verdict**

| Item | Verdict |
|------|---------|
| v5a (display TZ fix) | **LATENT** — not a proven production bug; architectural inconsistency + edge-case risk |
| v5b (TZ constant consolidation) | **COSMETIC** — central accessor exists; only a few duplicate literals |

---

## Q1 — Named constant for `Europe/Berlin`?

**Yes — partially centralised.**

| Symbol | File | Line | Role |
|--------|------|------|------|
| `DEFAULT_TZ` (private) | `src/features/trips/lib/trip-business-date.ts` | 4 | Fallback string `'Europe/Berlin'` |
| `getTripsBusinessTimeZone()` (exported) | `src/features/trips/lib/trip-business-date.ts` | 10–17 | Public accessor; reads `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` or falls back to `DEFAULT_TZ` |
| `BERLIN_TZ` (private duplicate) | `src/features/invoices/lib/resolve-trip-price.ts` | 82 | Fallback when env unset (`getTripsBusinessTimeZone() \|\| BERLIN_TZ`) |

The string is **not** used as a literal everywhere. Most trip logic goes through `getTripsBusinessTimeZone()` + `@date-fns/tz`. Remaining **code literals** (see Q6): invoice PDF formatter and one invoices pricing fallback.

---

## Q2 — Every `scheduled_at` display (human-readable time or date)

Grouped by conversion strategy.

### A. Berlin-aware via `parseScheduledAt` / `parseScheduledAtOrFallback` (+ optional `ymdToPickerDate`)

| File | Line(s) | What is shown | TZ |
|------|---------|---------------|-----|
| `src/features/trips/components/trips-tables/columns.tsx` | 96–112 | Date column `dd.MM.yyyy` | `parseScheduledAtOrFallback` → ymd → `ymdToPickerDate` → **Berlin civil day** |
| `src/features/trips/components/trips-tables/inline-cells/scheduled-time-cell.tsx` | 104, 44 | Time input `HH:mm` | `parseScheduledAtOrFallback` → **`.hm` in business TZ** |
| `src/features/dashboard/components/pending-tours-widget.tsx` | 71–85 | Row form time default | `parseScheduledAtOrFallback` → `.hm` → **Berlin** |
| `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` | 129, 160, 214 | Dialog field prefill | `parseScheduledAt` → **Berlin ymd/hm** |
| `src/features/shift-reconciliations/components/shift-ist-zeit-row.tsx` | 61–66 | Ist-Zeit `HH:mm` inputs | `parseScheduledAtOrFallback` → `.hm` |
| `src/lib/driver-availability.server.ts` | 79–80 | Server HM extraction | `parseScheduledAtOrFallback` → `.hm` |
| `src/features/kts/components/kts-csv-import-dialog.tsx` | 60 | Transport date derivation | `parseScheduledAtOrFallback` → `.ymd` |
| `src/features/invoices/components/invoice-pdf/lib/invoice-pdf-format.ts` | 49–59 | PDF trip time `HH:mm` | `Intl.DateTimeFormat` with **`timeZone: 'Europe/Berlin'`** |

### B. Runtime-local via `date-fns` `format(new Date(scheduled_at), …)` (no `{ in: tz(...) }`)

Uses **browser/server local TZ**, not explicit Berlin.

| File | Line(s) | Format | Notes |
|------|---------|--------|-------|
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | 471, 481 | `HH:mm` time draft | Header time input prefill |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | 537, 935 | `yyyy-MM-dd` date draft | **Date-boundary risk** vs Berlin |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | 2415 | `HH:mm` “Erledigt” | `actual_*` timestamps, not `scheduled_at` |
| `src/features/trips/trip-detail-sheet/components/linked-partner-callout.tsx` | 56, 84, 127, 129 | `HH:mm`, `dd.MM.yyyy`, `PPP` | Partner leg schedule |
| `src/features/trips/components/kanban/kanban-trip-card.tsx` | 84, 98 | `HH:mm` | Kanban card time input |
| `src/features/trips/components/kanban/kanban-drag-preview.tsx` | 48, 89 | `HH:mm` | Drag overlay |
| `src/features/trips/components/trips-tables/trips-mobile-card-list.tsx` | 114, 132 | `HH:mm`, `dd.MM.yyyy` | Mobile list cards |
| `src/features/trips/components/pending-assignments/pending-assignment-item.tsx` | 48, 54 | `HH:mm` | Dispatch inbox time input |
| `src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx` | 77, 82 | `HH:mm`, `PPp` | Duplicate preview / leg HM |
| `src/features/trips/components/print-trip-groups-list.tsx` | 170, 457 | `HH:mm` | Print layout |
| `src/features/trips/lib/share-utils.ts` | 29 | `HH:mm` | WhatsApp/share copy |
| `src/features/trips/components/trips-overview-widget/trips-overview-widget-reassign-drawer.tsx` | 66 | `HH:mm` | Reassign drawer title |
| `src/features/dashboard/components/pending-tours-widget.tsx` | 279 | `EEE dd.MM. HH:mm` | Linked outbound badge |
| `src/features/overview/components/trip-row.tsx` | 36, 135 | `HH:mm`, `dd.MM.yy` | Overview list |
| `src/features/clients/components/passenger-search-overlay.tsx` | 322 | `dd.MM. HH:mm` | Passenger trip history row |

### C. Runtime-local via `toLocaleTimeString('de-DE', …)` (no `timeZone` option)

| File | Line(s) | Notes |
|------|---------|-------|
| `src/features/driver-portal/components/shared/driver-trip-card.tsx` | 63–68, 223 | Driver app trip time |
| `src/features/driver-portal/components/shift-history-row.tsx` | 33–38 | Shift start/end times |

### D. Not display — write/filter/API only (listed for completeness)

`build-trip-details-patch.ts`, `apply-time-to-scheduled.ts`, `use-pending-assignments.ts`, `driver-trips.service.ts` (queries), `urgency-indicator`, etc. use `scheduled_at` for logic, not formatted output.

---

## Q3 — Every `requested_date` display

`requested_date` is a **DATE** (`YYYY-MM-DD`), not a UTC instant. Display is mostly **string passthrough** or **local `Date` parsing**.

| File | Line(s) | Utility | TZ conversion? | Output |
|------|---------|---------|----------------|--------|
| `src/features/trips/components/trips-tables/columns.tsx` | 97–112 | `requested_date` as fallback ymd → `ymdToPickerDate` + `format` | **Yes** (via `ymdToPickerDate`) | `dd.MM.yyyy` Berlin civil |
| `src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx` | 84–85 | Raw string + suffix | No | `"2026-06-15 (ohne feste Uhrzeit)"` |
| `src/features/dashboard/components/timeless-rule-trips-widget.tsx` | 154 | `format(new Date(pair.requested_date), 'dd.MM.yyyy')` | **No** — parses DATE as UTC midnight | Usually OK in Berlin; fragile elsewhere |
| `src/features/dashboard/components/pending-tours-widget.tsx` | 313–315 | `format(new Date(trip.requested_date), 'dd.MM.')` | **No** | Badge “Termin: …” |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | 538–539, 936 | Used directly as `dateYmdDraft` / `currentDateYmd` | N/A (YMD string to DatePicker) | No formatting |
| `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` | 136–137, 167–169 | Set into date picker state | N/A | No formatting |

No dedicated `requested_date` formatter exists; the **correct pattern** is already in `columns.tsx` (`ymdToPickerDate`).

---

## Q4 — Dedicated display helper: `scheduled_at` → Berlin wall-clock string?

**No single formatted-string helper** (e.g. `formatScheduledAtHm(iso)`).

**Closest canonical helpers** (structured, not pre-formatted):

| Helper | File | Line(s) | Returns | Used for display by |
|--------|------|---------|---------|---------------------|
| `parseScheduledAt(iso)` | `src/features/trips/lib/trip-time.ts` | 163–179 | `{ ymd, hm }` in business TZ | Reschedule dialog, kanban save path (ymd), build patches |
| `parseScheduledAtOrFallback(iso)` | `src/features/trips/lib/trip-time.ts` | 189–197 | Same or `null` | **ScheduledTimeCell**, Fahrten date column, pending-tours widget, shift rows, KTS import |
| `formatInvoicePdfTime(iso)` | `src/features/invoices/components/invoice-pdf/lib/invoice-pdf-format.ts` | 49–59 | `HH:mm` string | Invoice PDF only |

**How display is produced today:** mix of (1) `parseScheduledAtOrFallback(…).hm` into `<input type="time">`, (2) `format(new Date(iso), 'HH:mm')` without TZ, (3) invoice PDF `Intl` with explicit Berlin.

---

## Q5 — `instantToYmdInBusinessTz`: display or write-path?

**Primarily write-path / calendar logic**, not HH:mm display formatting.

| File | Line | Use |
|------|------|-----|
| `src/features/trips/lib/trip-business-date.ts` | 25–31 | Definition — instant → Berlin `YYYY-MM-DD` |
| `src/features/trips/lib/trip-business-date.ts` | 34–35 | `todayYmdInBusinessTz()` |
| `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` | 278 | Derive `requested_date` when clearing time |
| Bulk upload, duplicate schedule, recurring generator, etc. | various | Insert/update payload construction |

It does **not** produce user-visible time strings. For display of timed trips, use **`parseScheduledAt(OrFallback)`** (ymd + hm) or **`ymdToPickerDate`** (date-only civil day).

---

## Q6 — Grep `src/` for `'Europe/Berlin'`

**Total: 15 occurrences** (3 code literals, 1 UI label, 11 comments/docstrings in tests or modules)

| # | File | Line | Kind |
|---|------|------|------|
| 1 | `src/features/trips/lib/trip-business-date.ts` | 4 | **Code** — `const DEFAULT_TZ = 'Europe/Berlin'` |
| 2 | `src/features/invoices/lib/resolve-trip-price.ts` | 12 | Comment |
| 3 | `src/features/invoices/lib/resolve-trip-price.ts` | 82 | **Code** — `const BERLIN_TZ = 'Europe/Berlin'` |
| 4 | `src/features/invoices/components/invoice-pdf/lib/invoice-pdf-format.ts` | 49 | Comment |
| 5 | `src/features/invoices/components/invoice-pdf/lib/invoice-pdf-format.ts` | 54 | **Code** — `timeZone: 'Europe/Berlin'` |
| 6 | `src/features/payers/components/pricing-rule-dialog/step2-rule-config.tsx` | 382 | UI label text |
| 7 | `src/features/driver-portal/api/driver-trips.service.ts` | 92 | Comment |
| 8 | `src/features/trips/lib/derive-duplicate-schedules.ts` | 47 | Comment |
| 9 | `src/features/controlling/lib/controlling-utils.ts` | 5 | Comment |
| 10 | `src/features/driver-planning/api/driver-planning.service.ts` | 63 | Comment |
| 11 | `src/features/driver-planning/lib/week-dates.ts` | 9 | Comment |
| 12 | `src/features/trips/lib/departure-schedule.ts` | 42 | Comment |
| 13 | `src/features/trips/lib/__tests__/trip-time.test.ts` | 59 | Comment |
| 14 | `src/features/trips/lib/__tests__/trip-time.test.ts` | 70 | Comment |
| 15 | `src/features/trips/lib/__tests__/recurring-trip-schedule.test.ts` | 5 | Comment |
| 16 | `src/features/trips/hooks/use-upcoming-trips.ts` | 40 | Comment |

*(Grep also hits line 40 in `use-upcoming-trips.ts` — 15 unique files, 16 lines if counting both test comment lines separately; **3 executable literals**.)*

---

## Q7 — `Intl.DateTimeFormat` / `toLocaleString` with `timeZone: 'Europe/Berlin'`

**Only one callsite specifies Berlin explicitly:**

| File | Line | API |
|------|------|-----|
| `src/features/invoices/components/invoice-pdf/lib/invoice-pdf-format.ts` | 53–58 | `Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })` |

Other `Intl.DateTimeFormat` / `toLocaleString` usages in `src/` are for **currency, numbers, or dates without trip schedule TZ** (`src/lib/format.ts`, chart labels, invoice amounts, etc.).

**`toLocaleTimeString('de-DE', …)` without `timeZone`** (runtime local):

- `src/features/driver-portal/components/shared/driver-trip-card.tsx` — 65–68  
- `src/features/driver-portal/components/shift-history-row.tsx` — 35–38  
- `src/features/driver-portal/api/driver-trips.service.ts` — 184–190 (cancellation note timestamp)

---

## Q8 — Formatting calls with **no** timezone (TZ bug candidates)

All use **runtime local** interpretation of UTC ISO (or UTC-parsed DATE):

### `scheduled_at` → time/date string

See **Q2 section B** (15 files, ~20 lines). Highest-impact admin surfaces:

1. **Trip detail sheet** — time + date draft init (`trip-detail-sheet.tsx` 471–481, 537, 935)  
2. **Kanban** — card + drag preview (`kanban-trip-card.tsx`, `kanban-drag-preview.tsx`)  
3. **Mobile Fahrten list** — (`trips-mobile-card-list.tsx` 114, 132)  
4. **Widgets** — pending tours linked time, overview reassign drawer  
5. **Linked partner callout** — detail sheet sub-component  
6. **Print / share / overview / passenger search** — secondary surfaces  

### `requested_date` → date string without `ymdToPickerDate`

- `timeless-rule-trips-widget.tsx` — 154  
- `pending-tours-widget.tsx` — 313–315  

### `duplicate-trips-dialog.tsx` — `hmFromLegOnYmd` L77

`format(new Date(iso), 'HH:mm')` after schedule math — should use business TZ for consistency.

---

## Q9 — Evidence: UTC display vs Berlin?

| Observation | Evidence |
|-------------|----------|
| **Not systematically UTC-labelled** | UI shows wall-clock times users expect in Germany; no “UTC” suffix or +00 offset in trip UI. |
| **Not guaranteed Berlin either** | Most displays use runtime local TZ, not `getTripsBusinessTimeZone()`. |
| **Correct Berlin path exists and is used on primary table** | v4c Fahrten **Datum** + **Zeit** columns (`columns.tsx`, `scheduled-time-cell.tsx`) use `parseScheduledAtOrFallback` + `ymdToPickerDate`. |
| **When runtime TZ = Europe/Berlin** | `format(new Date(iso), 'HH:mm')` ≡ Berlin wall clock → **matches production experience**. |
| **When runtime TZ ≠ Berlin** | Detail sheet, kanban, mobile cards, driver portal can show **wrong hm and/or wrong calendar date**. |
| **Date-boundary bug independent of user TZ** | `trip-detail-sheet.tsx` 537, 935: `format(new Date(scheduled_at), 'yyyy-MM-dd')` uses **UTC calendar components** via date-fns, not Berlin ymd — can prefill **wrong date** for trips whose UTC day ≠ Berlin day (e.g. late evening UTC = next Berlin day). |

**Conclusion:** No evidence that the app **intentionally** displays UTC to users. Evidence of **inconsistent** TZ handling: hardened paths (Fahrten table, writes, filters) vs legacy `format(new Date(…))` paths. Production silence suggests typical users hit the “works” branch; edge cases remain **latent**.

---

## Q10 — Constant usage pattern

**Mix, leaning centralised for trip domain logic:**

- **Central:** `getTripsBusinessTimeZone()` + `@date-fns/tz` in `trip-business-date.ts`, `trip-time.ts`, filters, cron-adjacent code, duplicate schedule, driver planning week math, controlling.  
- **Duplicate constants:** `BERLIN_TZ` in `resolve-trip-price.ts`; literal in `invoice-pdf-format.ts`.  
- **Comments:** many files mention “Europe/Berlin” in docstrings without importing the constant.  
- **Display code:** largely **does not import** either constant — uses runtime local formatting instead.

---

## Senior recommendation

### A. v5a (display TZ fix) — real, latent, or already handled?

**LATENT risk, not a confirmed production defect.**

- **Already handled** on the main Fahrten table date/time columns (v4c) and on all **write** paths (`buildScheduledAt`, `parseScheduledAt`, `getZonedDayBoundsIso`).  
- **Not handled** on trip detail sheet drafts, kanban, mobile list, several widgets, print/share, driver portal — all rely on runtime local TZ.  
- Explains lack of user reports (German admins, Berlin OS TZ) while leaving **correctness gaps** for SSR/UTC, remote staff, and **Berlin midnight boundary** date prefills in the detail sheet.

**Recommendation:** Do not treat as urgent firefighting. If pursued, scope as **consistency pass**: adopt `parseScheduledAtOrFallback` / thin `formatScheduledAtHm(iso)` wrapper everywhere Q2-B lists, starting with detail sheet + kanban.

### B. v5b (TZ constant consolidation) — needed?

**Low priority / COSMETIC.**

- Canonical accessor **`getTripsBusinessTimeZone()`** already exists.  
- Only **3 executable literals** (`DEFAULT_TZ`, `BERLIN_TZ`, invoice PDF).  
- Consolidation effort: **small** (~2 files to align on shared export; optional re-export from `trip-business-date.ts`).  
- Does **not** fix display bugs by itself — display code doesn’t use the constant today.

### C. Roadmap disposition

| Item | Suggestion |
|------|------------|
| **v5a** | **Downgrade** to targeted housekeeping / “display consistency” — merge with v4c pattern rollout, not a standalone crisis. Optional small plan: detail sheet + kanban + mobile list. |
| **v5b** | **Close as non-issue** or fold into any v5a PR as a one-line import cleanup (`invoice-pdf-format.ts`, `resolve-trip-price.ts`). |

### D. TZ risks not on the roadmap

1. **Trip detail sheet date prefill** (`format(new Date(scheduled_at), 'yyyy-MM-dd')`) — Berlin vs UTC **calendar day mismatch**; can cause wrong date in picker even when time looks correct.  
2. **Driver portal** `toLocaleTimeString` without `timeZone` — drivers on misconfigured devices see wrong pickup times.  
3. **Split brain maintenance** — new surfaces may copy `format(new Date(…))` instead of `parseScheduledAtOrFallback`, reintroducing bugs the Fahrten table already fixed.  
4. **`requested_date` via `new Date(ymd)`** in widgets — low severity for Berlin users; should use `ymdToPickerDate` for parity with `columns.tsx`.  
5. **No shared display formatter** — teams must discover `parseScheduledAtOrFallback` by convention; a exported `formatTripScheduledHm(iso)` would reduce drift.

---

## Verdict (final)

| Roadmap item | Verdict |
|--------------|---------|
| **v5a** display TZ fix | **LATENT** |
| **v5b** TZ constant consolidation | **COSMETIC** (optional housekeeping) |

---

## Suggested next step (if planning v5a)

1. Add `formatScheduledAtHm(iso: string \| null): string` (and optionally `formatScheduledAtYmd`) in `trip-time.ts`, delegating to `parseScheduledAtOrFallback`.  
2. Replace Q2-B callsites (priority: `trip-detail-sheet.tsx`, kanban, `trips-mobile-card-list.tsx`).  
3. Fix detail sheet **date** draft to use `parseScheduledAtOrFallback(…).ymd`, not `format(…, 'yyyy-MM-dd')`.  
4. Align driver portal `formatTime` with same helper or explicit `timeZone: getTripsBusinessTimeZone()`.  
5. Widget `requested_date` badges → `ymdToPickerDate` + `format`.

No code changes in this audit step.

---

## v5a-1 Pre-Plan Findings

Date: 2026-06-24  
Scope: detail sheet date draft + driver portal time display (read-only pre-plan)  
Files read in full (target sections): `trip-detail-sheet.tsx`, `driver-trip-card.tsx`, `shift-history-row.tsx`, `trip-time.ts` L163–200

---

### Q1 — `trip-detail-sheet.tsx` date draft initialisation

#### a) Full initialisation logic at L537 and L935

**L536–542** (inside a `useEffect` that runs when `trip` identity / KTS fields change):

```typescript
if (trip.scheduled_at) {
  setDateYmdDraft(format(new Date(trip.scheduled_at), 'yyyy-MM-dd'));
} else if (trip.requested_date) {
  setDateYmdDraft(trip.requested_date);
} else {
  setDateYmdDraft('');
}
```

**L934–936** (derived each render for dirty baseline):

```typescript
const currentDateYmd = trip?.scheduled_at
  ? format(new Date(trip.scheduled_at), 'yyyy-MM-dd')
  : (trip?.requested_date ?? '');
```

Both `scheduled_at` branches use **`format(new Date(scheduled_at), 'yyyy-MM-dd')` directly** — no `parseScheduledAtOrFallback`, no `{ in: tz(...) }`. There is **no try/catch** around the format call. The only guard is the **`if (trip.scheduled_at)`** conditional before formatting.

#### b) Imports from `trip-time.ts`

**`parseScheduledAtOrFallback` is not imported.**

Current import from `trip-time.ts` (L32):

```typescript
import { TripTimeError } from '@/features/trips/lib/trip-time';
```

No imports from `trip-business-date.ts` in this file. TZ-aware logic elsewhere in the sheet stack uses `parseScheduledAt` / `buildScheduledAt` inside **`apply-time-to-scheduled.ts`** and **`build-trip-details-patch.ts`**, not in the sheet component itself.

#### c) Is `scheduled_at` guaranteed non-null at these sites?

**Guarded by conditional — not assumed always present.**

| Site | Guard |
|------|-------|
| L536–537 | `if (trip.scheduled_at)` — only formats when non-null |
| L538–539 | `else if (trip.requested_date)` — date-only trips |
| L934–935 | Ternary: `trip?.scheduled_at ? … : (trip?.requested_date ?? '')` |

When `scheduled_at` is null, both paths fall through to **`requested_date`** (string YMD) or `''`.

#### d) Write-back vs display-only — full data flow

**Write-back.** `dateYmdDraft` is **not display-only**.

| Step | File | Line(s) | Role |
|------|------|---------|------|
| Picker binding | `trip-detail-sheet.tsx` | 1181–1182 | `<DatePicker value={dateYmdDraft} onChange={setDateYmdDraft} />` |
| Dirty baseline | `trip-detail-sheet.tsx` | 979 | `dateYmdDraft !== currentDateYmd` → `detailsDirty` |
| Save input | `trip-detail-sheet.tsx` | 1041–1042 | Passed to `buildTripDetailsPatch({ dateYmdDraft, currentDateYmd, timeDraft, … })` |
| Patch logic | `build-trip-details-patch.ts` | 214–233 | If `dateYmdDraft !== currentDateYmd`: `buildScheduledAt(dateYmdDraft, timeDraft)` or sets `requested_date = dateYmdDraft` |
| Clear time path | `build-trip-details-patch.ts` | 275–278 | `requested_date = input.dateYmdDraft \|\| …` |

**Changing TZ derivation at L537/L935 affects both what the dispatcher sees and what can be saved** when they change the date or save with a dirty date field.

**Mitigating factor:** time-only edits on an unchanged date use **`parseScheduledAt(trip.scheduled_at).ymd`** inside `build-trip-details-patch.ts` L255 — Berlin-correct — so a wrong prefilled date does **not** corrupt time-only saves *as long as* the user does not touch the date picker and `dateYmdDraft === currentDateYmd` (both wrong but equal).

**Additional note:** the date-init `useEffect` (L484–554) **does not list `trip.scheduled_at` or `trip.requested_date` in its dependency array** (L547–554). If schedule fields update on the same `trip.id` (refetch, inline table edit), **`dateYmdDraft` may not re-sync** until trip id or listed KTS fields change. Separate from TZ but relevant to v5a-1 testing.

#### e) Fallback to `requested_date`?

**Yes — at both sites, when `scheduled_at` is absent.**

- Init effect L538–539: `setDateYmdDraft(trip.requested_date)`  
- `currentDateYmd` L936: `(trip?.requested_date ?? '')`  

When **`scheduled_at` is present**, there is **no** fallback to `requested_date` for the date string — only the UTC-local `format(new Date(scheduled_at), 'yyyy-MM-dd')` path runs.

---

### Q2 — Driver portal components

#### a) Exact `toLocaleTimeString` calls

**`driver-trip-card.tsx` L63–68:**

```typescript
function formatTime(isoString: string | null): string {
  if (!isoString) return '--:--';
  return new Date(isoString).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}
```

**`shift-history-row.tsx` L33–38:**

```typescript
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}
```

Neither call passes **`timeZone`**. Locale is `'de-DE'` only.

#### b) Source values

| File | Call site | Source |
|------|-----------|--------|
| `driver-trip-card.tsx` | L223 | `formatTime(trip.scheduled_at)` — **`scheduled_at` UTC ISO** from `DriverTrip` |
| `shift-history-row.tsx` | L111–112 | `formatTime(shift.started_at)`, `formatTime(shift.ended_at)` — **shift timestamps**, not trip schedule |
| `shift-history-row.tsx` | L93–94 | Break events: `formatTime(breakStart)`, `formatTime(ev.timestamp)` |

No pre-formatted time strings — always ISO → `Date` → locale format.

#### c) Existing TZ helper imports?

**None.** Neither file imports `getTripsBusinessTimeZone`, `trip-business-date.ts`, or `trip-time.ts`.

`shift-history-row.tsx` also defines **`formatDate(iso)`** (L25–30) using `d.getDate()` / `getMonth()` / `getFullYear()` — runtime-local calendar, no Berlin helper.

#### d) SSR vs client-only

**Both components are client-only.**

| File | Evidence |
|------|----------|
| `driver-trip-card.tsx` | L1: `'use client'` |
| `shift-history-row.tsx` | L1: `'use client'` |

Parents are also client orchestrators: `touren-page-content.tsx` L1 `'use client'`, `todays-trips-list.tsx`, `shift-history-list.tsx`.

**Implication:** `toLocaleTimeString` runs in the **driver’s browser**, not on Vercel UTC SSR. UTC runtime TZ is **not a production risk today** for these components. Residual risk = **device OS timezone ≠ `Europe/Berlin`** (misconfigured phone, travel abroad).

---

### `trip-time.ts` — return shape (Q4 confirm)

**L163–179 `parseScheduledAt`:** returns `{ ymd: string; hm: string }` where:

- `ymd` = `'yyyy-MM-dd'` in `getTripsBusinessTimeZone()` (via `@date-fns/tz`)  
- `hm` = `'HH:mm'` in same zone  

**L189–197 `parseScheduledAtOrFallback`:** same shape or **`null`** when iso is null/undefined/invalid.

---

### Senior recommendation

#### A. Detail sheet date draft — one-liner or surgery?

**Not a single one-liner — coordinated small change (still surgical).**

Minimum fix requires **two matching edits** in the same file:

1. **L537** — init `dateYmdDraft` from `parseScheduledAtOrFallback(trip.scheduled_at)?.ymd`  
2. **L934–935** — `currentDateYmd` must use the **same** derivation  

If only L537 is fixed, `dateYmdDraft` (Berlin) ≠ `currentDateYmd` (UTC-local) → **`detailsDirty` true on open** (L979) without user edits.

Also add import: extend L32 to include `parseScheduledAtOrFallback`.

**Write-path impact:** Low for “open and save unchanged” (both baselines move together). **High for display correctness** vs Fahrten table (v4c). Date-change saves use `dateYmdDraft` → `buildScheduledAt` — wrong prefill could persist wrong calendar day if user saves after opening.

**Real-world frequency (UTC day ≠ Berlin day):** For `Europe/Berlin`, mismatch occurs when UTC calendar date differs from Berlin civil date — roughly **22:00–24:00 UTC** (CEST) / **23:00–01:00 UTC** (CET), i.e. **~00:00–02:00 Berlin wall clock**. Typical scheduled medical transport is daytime; **low frequency** but **non-zero** (early-morning dialysis, late discharge). More visible bug: **detail sheet date disagrees with Fahrten Datum column** for those rows even in Berlin browser (because Fahrten uses `parseScheduledAtOrFallback` + `ymdToPickerDate`, sheet uses UTC `format` for ymd).

**Verdict:** Safe surgical fix if **L537 + L935 + import** land together; optionally fix **time draft L471/481** in same PR for hm consistency (see C).

#### B. Driver portal — real risk or theoretical?

**Mostly theoretical in production today.**

- Client-only → browser TZ applies.  
- German drivers with DE locale + Berlin OS TZ → **matches business TZ**.  
- Risk materialises only with **wrong device timezone** or **non-German TZ travel**.

**Minimal safe fix:** Replace local `formatTime` with `parseScheduledAtOrFallback(iso)?.hm ?? '--:--'` (works for any ISO instant, not just trips). Alternative: `toLocaleTimeString('de-DE', { timeZone: getTripsBusinessTimeZone(), hour: '2-digit', minute: '2-digit' })`.

For **`shift-history-row.tsx`**, same helper fixes shift start/end/break times; optionally replace **`formatDate`** with Berlin ymd from `parseScheduledAtOrFallback(iso)?.ymd` + display format for date row consistency.

#### C. Other callsites in these files (missed by main audit)

**`trip-detail-sheet.tsx` (same file — include in v5a-1 or immediate follow-up):**

| Line(s) | Issue |
|---------|-------|
| 471, 481 | Time draft init: `format(new Date(trip.scheduled_at), 'HH:mm')` — runtime local hm; **`applyTimeToScheduledDate`** (L987) uses Berlin for dirty check → possible **false dirty** or wrong hm for non-Berlin browsers |
| 2415 | `format(new Date(time), 'HH:mm')` — **`actual_pickup_at` / dropoff** completion stamp, not `scheduled_at`; lower priority |
| L547–554 | Date init effect **missing `trip.scheduled_at` / `trip.requested_date` deps** — stale draft after schedule update |

**`driver-trip-card.tsx`:** only L63–68 / L223 for trip time — no other schedule formatters.

**`shift-history-row.tsx`:** L25–30 `formatDate` (local calendar); L33–38 `formatTime`; all shift-related, not in main audit’s trip list but **in scope for driver portal TZ consistency**.

**Not in these files:** `linked-partner-callout.tsx` — defer to v5a-2.

#### D. Overall — surgical two-file fix or hidden complexity?

**Honest assessment: small, bounded PR — not a one-liner, not major surgery.**

| Surface | Files | Effort | Complexity |
|---------|-------|--------|------------|
| Detail sheet date | 1 file, 2 logic sites + import | ~10 lines | Must keep `dateYmdDraft` and `currentDateYmd` in sync; test date-only + timed + midnight-edge ISO |
| Driver portal | 2 files, 1 helper each | ~15 lines | Trivial; shift row adds optional `formatDate` |
| Recommended same PR | Detail sheet **time draft** L471/481 | +4 lines | Avoid hm/date split-brain in one surface |

**Hidden complexity (do not ignore):**

1. **`currentDateYmd` must change with init** — partial fix worse than none.  
2. **Time draft still wrong** if only date is fixed — recommend v5a-1 includes hm or documents v5a-1b.  
3. **Effect deps** on date init — consider adding `trip.scheduled_at` / `trip.requested_date` while touching L484–554 (behaviour change; needs explicit test).  
4. **Not two files only** if shift history included — **three files** (`trip-detail-sheet.tsx`, `driver-trip-card.tsx`, `shift-history-row.tsx`).

**Does not warrant a broad v5a plan yet** — no refactor of `build-trip-details-patch` needed (already Berlin-correct on writes). Kanban/mobile/print remain out of scope for v5a-1.

---

### Verdict per surface

| Surface | Verdict |
|---------|---------|
| **Detail sheet date draft** | **SURGERY NEEDED** (minimal — 2 coordinated sites + import; not a literal one-liner) |
| **Driver portal display** | **THEORETICAL** (client-only; real only if device TZ ≠ Berlin) |

---

### Suggested v5a-1 plan sketch (no code)

1. **`trip-detail-sheet.tsx`:** Import `parseScheduledAtOrFallback`; replace L537 and L934–935 `scheduled_at` branches; replace L471/481 time draft with `.hm`; consider effect deps for schedule fields.  
2. **`driver-trip-card.tsx`:** `formatTime` → `parseScheduledAtOrFallback(iso)?.hm ?? '--:--'`.  
3. **`shift-history-row.tsx`:** Same for `formatTime`; optional Berlin ymd for `formatDate`.  
4. **Manual test:** Trip with `scheduled_at` near Berlin midnight / UTC day boundary; compare sheet date vs Fahrten Datum column; driver card time vs sheet time; save unchanged + date-change + time-only.

No code changes in this audit step.

---

## v5a-1 Resolution

Date: 2026-06-25  
Status: **CLOSED**

- Gap 1 (detail sheet date + time draft): **FIXED** — `parseScheduledAtOrFallback` for ymd/hm in `trip-detail-sheet.tsx`
- Gap 2 (driver portal `formatTime`): **FIXED** — `driver-trip-card.tsx`, `shift-history-row.tsx`
- v5a-2 (remaining legacy surfaces): **DEFERRED**

See [v5a-implementation.md](./v5a-implementation.md).

### Effect deps note

The date-init useEffect dep array (L559–566) does not include `trip.scheduled_at` / `trip.requested_date`. This is the master re-initialisation effect (~20 fields). Adding schedule deps would reset all drafts on every schedule update — wrong for optimistic editing. Accepted as a known design constraint. See [v5a-implementation.md](./v5a-implementation.md) for full rationale. No action required.

### Effect deps note

The date-init useEffect dep array (L559–566) does not include `trip.scheduled_at` / `trip.requested_date`. This is the master re-initialisation effect (~20 fields). Adding schedule deps would reset all drafts on every schedule update — wrong for optimistic editing. Accepted as a known design constraint. See [v5a-implementation.md](./v5a-implementation.md) for full rationale. No action required.

