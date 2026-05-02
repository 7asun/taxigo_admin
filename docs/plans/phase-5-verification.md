# Phase 5 verification — Berlin calendar reads + CI

## Scope (shipped)

| Site | File | Change |
|------|------|--------|
| Display helper | `src/features/trips/lib/trip-time.ts` | `parseScheduledAtOrFallback` after `parseScheduledAt` |
| Recurring delete cutoff | `src/features/trips/api/recurring-rules.service.ts` | `todayYmdInBusinessTz()` instead of UTC `toISOString().split('T')[0]` |
| Dispatch inbox “Heute” | `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | `todayStr` + `computedTripDate` Berlin ymd |
| Assignment row date label input | `src/features/trips/components/pending-assignments/pending-assignment-item.tsx` | `parseScheduledAtOrFallback` |
| Upcoming trips windows | `src/features/trips/hooks/use-upcoming-trips.ts` | `getZonedDayBoundsIso` + `zonedDayEndInclusiveIso` for `.lte`; week via `startOfWeek`/`endOfWeek` `{ in: tz(...) }` |
| Pending tours default date | `src/features/dashboard/components/pending-tours-widget.tsx` | `parseScheduledAtOrFallback` |
| CI | `.github/workflows/ci.yml` | `bun run lint:trips-scheduled-at` after install |

## Grep audit (Section 1.4 class — post-fix)

Previously risky UTC-slice / local-day sites in this phase are migrated; deferred items remain in **`docs/plans/trip-time-utility-audit.md`** Post–Phase 5.

## Commands (run after implementation)

```bash
bun test
bun run build
bun run lint:trips-scheduled-at
```

Record results below after each release candidate run.

### `bun test`

**88 pass**, **0 fail**, 9 test files (includes new `parseScheduledAtOrFallback` cases in `trip-time.test.ts`).

### `bun run build`

**next build** completed successfully (TypeScript + static generation); exit code **0**.

### `bun run lint:trips-scheduled-at`

**eslint** with `.eslintrc.trips-time-guard.json` on `src/features/trips` + `src/app/api`; exit code **0**, **max-warnings 0**.

## CI step (diff reference)

New workflow (no prior `.github/workflows/*` in repo):

```yaml
      - name: Lint trips scheduled_at guard
        run: bun run lint:trips-scheduled-at
```

Full file: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — job `quality` runs `checkout`, `setup-bun`, `bun install --frozen-lockfile`, lint guard, `bun test`, `bun run build`.
