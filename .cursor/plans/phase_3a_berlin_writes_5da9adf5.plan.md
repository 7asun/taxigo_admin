---
name: Phase 3A Berlin writes
overview: Migrate dispatcher-facing `scheduled_at` writes on trip create (outbound via `departure-schedule`, return leg in create form, linked return insert chain) to `buildScheduledAt` / `buildScheduledAtOrNull`, align `build-return-trip-insert` with ISO from callers, add temporary smoke route then docs + verification file. No Phase 3B paths (edit sheet, kanban, pending, bulk CSV, duplicate dialog).
todos:
  - id: audit-table
    content: Run grep; paste Step 1 audit table into notes / PR description
    status: completed
  - id: departure-schedule
    content: Refactor combineDepartureForTripInsert to buildScheduledAt + TripTimeError; why comments
    status: completed
  - id: build-gate-2
    content: bun run build after departure-schedule
    status: completed
  - id: return-insert-chain
    content: "build-return-trip-insert + create-linked-return + create-return-trip-dialog: ISO string from buildScheduledAt"
    status: completed
  - id: build-gate-3
    content: bun run build after return chain
    status: completed
  - id: create-form-return
    content: "create-trip-form.tsx return leg: buildScheduledAt + TripTimeError handling if needed"
    status: completed
  - id: build-gate-4
    content: bun run build after create-trip-form
    status: completed
  - id: tests-build
    content: bun test then bun run build
    status: completed
  - id: debug-smoke
    content: Add phase3a-create-check route, curl, delete route, final build
    status: completed
  - id: docs
    content: Update trips-date-filter.md, trip-time-utility-audit.md; add phase-3a-verification.md; inline why comments
    status: completed
isProject: false
---

# Phase 3A — Berlin-correct `scheduled_at` (dispatcher create flow)

## Path correction

- Primary create form: `[src/features/trips/components/create-trip/create-trip-form.tsx](src/features/trips/components/create-trip/create-trip-form.tsx)` (not `components/create-trip-form.tsx`).
- Canonical time API: `[src/features/trips/lib/trip-time.ts](src/features/trips/lib/trip-time.ts)` (`buildScheduledAt`, `buildScheduledAtOrNull`, `TripTimeError`).
- Business TZ: only via `getTripsBusinessTimeZone()` from `[src/features/trips/lib/trip-business-date.ts](src/features/trips/lib/trip-business-date.ts)` (already used inside `buildScheduledAt`; no literal `Europe/Berlin` in new code).

## Step 1 — Caller audit (complete before edits)

Run the user’s grep on `src/features/trips/**` (and optionally narrow to `departure-schedule` imports). Representative classification:


| File                                                                                                                                                                                                                | Line(s)                                       | Pattern                                           | Write vs read                                                   | Phase                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `[departure-schedule.ts](src/features/trips/lib/departure-schedule.ts)`                                                                                                                                             | 45–58                                         | `new Date(y,m,d,h,m).toISOString()`               | **Write** `scheduled_at`                                        | **3A**                                    |
| `[create-trip-form.tsx](src/features/trips/components/create-trip/create-trip-form.tsx)`                                                                                                                            | 1219–1225                                     | `combineDepartureForTripInsert`                   | **Write** (delegates; fixed via lib)                            | **3A** (indirect)                         |
| Same                                                                                                                                                                                                                | 1237–1251                                     | `new Date(...).toISOString()` return leg          | **Write** `returnScheduledAt`                                   | **3A**                                    |
| `[build-return-trip-insert.ts](src/features/trips/lib/build-return-trip-insert.ts)`                                                                                                                                 | 107                                           | `params.scheduledAt.toISOString()`                | **Write**                                                       | **3A** (must change contract or encoding) |
| `[create-linked-return.ts](src/features/trips/lib/create-linked-return.ts)`                                                                                                                                         | 46–47                                         | passes `Date` into insert builder                 | **Write** plumbing                                              | **3A**                                    |
| `[create-return-trip-dialog.tsx](src/features/trips/components/return-trip/create-return-trip-dialog.tsx)`                                                                                                          | 139–140                                       | passes `Date` from `DateTimePicker`               | **Write** plumbing                                              | **3A**                                    |
| `[duplicate-trip-schedule.ts](src/features/trips/lib/duplicate-trip-schedule.ts)`                                                                                                                                   | `combineYmdAndHmToIsoString`, `toISOString`   | Zoned date-fns (`tz(getTripsBusinessTimeZone())`) | Duplicate flow / not `departure-schedule`                       | **3B / later** per user                   |
| `[duplicate-trips-dialog.tsx](src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx)`                                                                                                               | combineYmd imports                            | Duplicate UX                                      | **Deferred**                                                    |                                           |
| `[build-trip-details-patch.ts](src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts)`, `[apply-time-to-scheduled.ts](src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts)`          | `toISOString` / local `Date`                  | Edit path                                         | **3B**                                                          |                                           |
| `[use-pending-assignments.ts](src/features/trips/components/pending-assignments/use-pending-assignments.ts)`, `[kanban-trip-card.tsx](src/features/trips/components/kanban/kanban-trip-card.tsx)`, reschedule files | various                                       | Mutations                                         | **3B**                                                          |                                           |
| `[create-trip-draft.ts](src/features/trips/lib/create-trip-draft.ts)`                                                                                                                                               | `formatLocalYmd` import                       | Draft / display                                   | **Skip** (no `scheduled_at` write)                              |                                           |
| `[duplicate-trip-schedule.ts](src/features/trips/lib/duplicate-trip-schedule.ts)`                                                                                                                                   | `parseYmdToLocalDate` from departure-schedule | Parse helper for duplicate math                   | **Skip** for 3A (no change unless removing import breaks types) |                                           |
| `trip-time.ts`                                                                                                                                                                                                      | `toISOString`                                 | Internal UTC emission                             | **Skip**                                                        |                                           |
| Other `toISOString` hits (filters, print ranges, `updatedAt`, etc.)                                                                                                                                                 | —                                             | Non–`scheduled_at` create                         | **Skip**                                                        |                                           |


**Conclusion — files to modify for 3A:**

1. `[departure-schedule.ts](src/features/trips/lib/departure-schedule.ts)` — `combineDepartureForTripInsert`
2. `[create-trip-form.tsx](src/features/trips/components/create-trip/create-trip-form.tsx)` — return-leg ISO only (outbound covered by (1)); add **minimal** `TripTimeError` handling if `combineDepartureForTripInsert` starts throwing on bad clock (see below)
3. `[build-return-trip-insert.ts](src/features/trips/lib/build-return-trip-insert.ts)` — stop using `Date#toISOString()` for storage
4. `[create-linked-return.ts](src/features/trips/lib/create-linked-return.ts)` — options shape / pass-through
5. `[create-return-trip-dialog.tsx](src/features/trips/components/return-trip/create-return-trip-dialog.tsx)` — build Berlin ISO on submit

**Do not touch** `parseYmdToLocalDate` / `formatLocalYmd` contracts unless a compile error forces a tiny re-export adjustment (prefer leaving them for other callers).

## Step 2 — `departure-schedule.ts`

- In `combineDepartureForTripInsert`, when `timePart` is non-empty, replace the `new Date(..., hours, minutes)` + `toISOString()` block with `**buildScheduledAt(ymd, timePart)`** (after trim); rely on `buildScheduledAt`’s HM normalization (supports `HH:mm:ss`).
- Keep `**requested_date**` as today: the trimmed `ymd` string (unchanged contract).
- Keep `**scheduled_at: null**` when `ymd` empty or `timePart` empty.
- **Invalid clock / ymd:** user asks to **throw `TripTimeError`** (align with `buildScheduledAt`) instead of silently returning `scheduled_at: null` for bad `hours`/`minutes` parsing. **Risk:** `[create-trip-form.tsx](src/features/trips/components/create-trip/create-trip-form.tsx)` submit path must `**try/catch`** `TripTimeError` and surface `toast.error` (or existing error UX) so Zod edge cases do not become an unhandled rejection.
- Add a short **why** comment (browser-local `Date` + `toISOString()` mis-encodes dispatcher intent outside Berlin; `buildScheduledAt` pins wall time to `getTripsBusinessTimeZone()`).

**Gate:** `bun run build`.

## Step 3 — `build-return-trip-insert.ts` + callers

Current API takes `scheduledAt: Date` and does `toISOString()` — that preserves wrong instants if the `Date` was built in a non-Berlin browser.

**Recommended shape (minimal semantics change):**

- Change `BuildReturnTripInsertParams` to carry `**scheduledAtIso: string`** (UTC ISO already produced by `buildScheduledAt`).
- `[create-linked-return.ts](src/features/trips/lib/create-linked-return.ts)`: `CreateLinkedReturnOptions.scheduledAt` → `scheduledAtIso` (or keep name `scheduledAt` but type `string` — pick one and use consistently).
- `[create-return-trip-dialog.tsx](src/features/trips/components/return-trip/create-return-trip-dialog.tsx)`: in `handleSubmit`, derive **civil** `ymd` + `hm` from the `DateTimePicker` value using the **same calendar convention** as the picker already uses (local `getFullYear` / `getMonth` / `getDate` + `HH:mm` from `format(..., 'HH:mm')`, matching how `[DateTimePicker](src/components/ui/date-time-picker.tsx)` composes `Date` from day + time). Then `scheduledAtIso = buildScheduledAt(ymd, hm)` so wall time is interpreted in **business TZ**, matching outbound `departure_date` + `departure_time` semantics.
- `buildReturnTripInsert`: set `scheduled_at: params.scheduledAtIso` (only line touching storage).

**Gate:** `bun run build`.

## Step 4 — `create-trip-form.tsx` return leg

- Replace the IIFE at **~1237–1251** (`new Date(date.getFullYear(), …).toISOString()`) with `**buildScheduledAt(formatLocalYmd(values.return_date!), values.return_time!)`** (schema guarantees both when `return_mode === 'exact'`).
- Optional: if `TripTimeError` is possible, mirror the same try/catch pattern as outbound.

**Gate:** `bun run build`.

## Step 5 — Tests + build

- `bun test` — expect **79+** passes, zero failures; if anything fails, **report before fixing** (user rule).
- `bun run build` — exit 0.

## Step 6 — Temporary debug route (delete before merge)

- Add `[src/app/api/debug/phase3a-create-check/route.ts](src/app/api/debug/phase3a-create-check/route.ts)`: compare `buildScheduledAt('2026-06-15','10:00')` and `('2026-06-15','23:30')` to Phase 1 golden ISO strings; call `**combineDepartureForTripInsert`** with the same ymd/hm and assert equality; return JSON `{ goldenCEST, goldenLateNight, departureScheduleAligned, allPassed }` as specified.
- `bun run dev` + `curl -s http://localhost:3000/api/debug/phase3a-create-check`, capture JSON.
- **Delete** the route; `**bun run build`** again.

## Step 7 — Documentation (mandatory)

1. `[docs/trips-date-filter.md](docs/trips-date-filter.md)` — new subsection **Phase 3A**: table rows for `combineDepartureForTripInsert`, create-form return leg, `build-return-trip-insert` + linked-return dialog chain.
2. `[docs/plans/trip-time-utility-audit.md](docs/plans/trip-time-utility-audit.md)` — set status line to **Phase 3A complete** (keep Phase 3B backlog as-is).
3. **New** `[docs/plans/phase-3a-verification.md](docs/plans/phase-3a-verification.md)` — paste smoke JSON + pass/fail summary.
4. **Inline comments** on every changed write path: **why** browser-local encoding was wrong for production (non-Berlin dispatchers / SSR), not a restatement of *what* the code does.

## Risks / notes

- `**TripTimeError` vs silent null:** outbound create behaviour tightens on malformed time strings; mitigate with try/catch + toast in the submit handler.
- `**DateTimePicker` + linked return:** still stores `Date` in React state; Phase 3A only fixes the **final persisted ISO** via `buildScheduledAt` from civil ymd/hm extracted from that `Date` (same practical contract as calendar pickers elsewhere). A future improvement could split ymd/hm state like `DatePicker` + time input — **out of scope** unless you explicitly want UI refactors.
- **Bulk CSV / duplicate / edit paths:** explicitly out of scope for this phase.



