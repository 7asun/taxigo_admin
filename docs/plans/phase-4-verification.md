# Phase 4 verification — bulk CSV + ESLint guard + AGENTS invariant

## Step 1 — Bulk upload audit (before → after)

| Item | Location | Before | After |
|------|----------|--------|-------|
| German date parse | `parseGermanDateOnly` ~284–295 | `new Date(year, month-1, day, 0,0,0,0)` | **`parseGermanDateToYmd`** — padded `ymd` + `isYmdString` + `buildScheduledAt(ymd,'12:00')` calendar probe (no browser-local `Date` for the label) |
| `requested_date` source | `toLocalISODate` + `parseDateAndTime` | Local `Date` → `YYYY-MM-DD` | **`requestedDate`** = same **`ymd`** string as business calendar |
| Time + wall clock | `parseDateAndTime` ~338–342 | `new Date(dateOnly)` + **`setHours`** → `Date` | **`buildScheduledAt(ymd, \`${hours}:${minutes}\`)`** → UTC ISO string |
| Persist | `builtTrip` ~979–981 | `scheduled_at.toISOString()` | **`scheduled_at`** = ISO string from **`buildScheduledAt`** (no `.toISOString()` on `Date`) |
| Invalid clock | — | Treated like missing time (`NaN` check on `Date`) | **`TripTimeError`** → **`timeParseError`** + **`issues.push`** `invalid_datetime` with Uhrzeit message |

## ESLint

Commands (expect **exit 0**, **0** warnings from the new rule after allow-lists):

```bash
bun run lint:trips-scheduled-at
```

Equivalent:

```bash
eslint --no-eslintrc -c .eslintrc.trips-time-guard.json "src/features/trips" "src/app/api" --max-warnings 0
```

**Rule:** `.eslintrc.trips-time-guard.json` → `overrides` → `no-restricted-syntax` **warn** on:

1. `new Date(…, ≥3 args).toISOString()` (chained `CallExpression`).
2. `new Date(…).setHours(...)` (object is `NewExpression` `Date`, `arguments.length >= 1`).
3. `new Date(…).setMinutes(...)` (same).

**Excluded files:** `src/features/trips/lib/trip-time.ts`, `src/features/trips/lib/duplicate-trip-schedule.ts`, `src/features/trips/lib/__tests__/**/*`.

**Note:** Root [`.eslintrc.json`](../.eslintrc.json) is unchanged for `next/core-web-vitals`. ESLint 8.48 + `eslint-config-next@16` can throw a circular JSON error when validating the merged legacy config via the CLI; the **guard** uses a **standalone** config (`--no-eslintrc -c …`) so CI can enforce the trip-time patterns reliably.

**Follow-up:** One invalid inline disable in [`create-trip-form.tsx`](../src/features/trips/components/create-trip/create-trip-form.tsx) (`react-hooks-exhaustive-deps` → `react-hooks/exhaustive-deps`) was corrected so the guard run does not fail on “rule not found” for that comment.

**Message (verbatim):**  
`Use buildScheduledAt(ymd, hm) from trip-time.ts to construct trips.scheduled_at. Direct Date construction encodes browser timezone, not Europe/Berlin. See docs/trips-date-filter.md.`

## Tests and build

```bash
bun test
bun run build
```

Local run (post-merge): **`bun test`** — **85 pass**, 0 fail; **`bun run build`** — exit 0.

## AGENTS.md

The **Trips time system** section was inserted **verbatim** before **Notes for AI Agents** (invariant + `getZonedDayBoundsIso` + link to `docs/trips-date-filter.md`).

## Docs touched

- [`docs/trips-date-filter.md`](../trips-date-filter.md) — Phase 4 subsection.
- [`docs/plans/trip-time-utility-audit.md`](./trip-time-utility-audit.md) — Phase 4 status; bulk upload row shipped; Post–Phase 4 gaps.
