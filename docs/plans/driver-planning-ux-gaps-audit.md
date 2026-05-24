# Driver Planning UX Gaps Audit

Read-only audit of `/dashboard/fahrerschichtplanung`, retroactive entry paths, single-driver filtering, and `/dashboard/shift-reconciliations` merge feasibility. No code or schema changes.

**Scope files:** driver-planning feature, shift-reconciliations feature, driver-portal shift service, nav config, and related docs (May 2026).

---

## 1. Week navigation — current state + gaps

### How week navigation works today

The planning page is URL-driven via a `week` search param (Monday `YYYY-MM-DD` in Europe/Berlin).

| Layer | Behaviour | Citation |
|-------|-----------|----------|
| RSC default | If `week` is missing or shorter than 10 chars, snap today to Monday; otherwise snap the param to Monday | ```32:37:src/app/dashboard/fahrerschichtplanung/page.tsx``` |
| Client filters | `useQueryState('week')` with `parseAsString`; default from `snapYmdToWeekStart(getTodayYmd())` | ```44:46:src/features/driver-planning/components/driver-planning-filters.tsx``` |
| Prev / next | `addDays(weekStart, ±7)` then `setWeek(next)` + `router.refresh()` | ```48:58:src/features/driver-planning/components/driver-planning-filters.tsx``` |
| Date picker | `DatePicker` onSelect snaps selected day to week start, updates `week`, refreshes RSC | ```60:66:src/features/driver-planning/components/driver-planning-filters.tsx``` |
| Week label | `formatWeekRangeLabel(weekStart)` in toolbar | ```68:68:src/features/driver-planning/components/driver-planning-filters.tsx``` |
| Data fetch | RSC prefetches `getCompanyWeekPlan(weekStart)`; client hook `useCompanyWeekPlan(weekStart)` | ```39:40:src/app/dashboard/fahrerschichtplanung/page.tsx```, ```86:94:src/features/driver-planning/hooks/use-driver-week-plan.ts``` |
| Week bounds helper | `getWeekDateRange(weekStartYmd)` → Monday–Sunday YMD array | ```27:34:src/features/driver-planning/lib/week-dates.ts``` |

### Can admins navigate past or future weeks?

**Yes — there is no coded upper or lower bound.**

- Chevron handlers subtract/add 7 days indefinitely with no clamp (```48:58:src/features/driver-planning/components/driver-planning-filters.tsx```).
- `DatePicker` is used without `disabled`, `fromDate`, or `toDate` props (```87:92:src/features/driver-planning/components/driver-planning-filters.tsx```).
- `getCompanyWeekPlan` queries `driver_day_plans` for `plan_date` between week start and end with no date guard (```138:168:src/features/driver-planning/api/driver-planning.service.ts```).

Practical limit is UX only (how far the user clicks or picks in the calendar), not application logic.

### Is there a bound on `?week=`?

**No explicit min/max validation.**

- Page accepts any string ≥ 10 characters and passes it through `snapYmdToWeekStart` (```32:37:src/app/dashboard/fahrerschichtplanung/page.tsx```).
- Invalid calendar dates would fail inside `snapYmdToWeekStart` / `parseYmd` (```14:25:src/features/driver-planning/lib/week-dates.ts```) — not a business rule, but a parse error risk for malformed URLs.
- Docs describe `?week=` as optional, defaulting to current week (```15:15:docs/driver-planning.md```).

### Gaps

| Gap | Detail |
|-----|--------|
| No “today” shortcut | Filters only expose prev/next and date picker — no jump-to-current-week control (```74:103:src/features/driver-planning/components/driver-planning-filters.tsx```). |
| RSC / client sync | Week change calls `router.refresh()` to align RSC prefetch with client cache (```55:57:src/features/driver-planning/components/driver-planning-filters.tsx```) — arbitrary weeks work but depend on this refresh discipline. |
| Invalid URL handling | Malformed `week` values are not validated before snap; edge-case UX not documented. |

### What would be required for “free” navigation to any week?

**Functionally, it already exists.** Optional hardening only:

1. Document supported `?week=` format and invalid-URL behaviour (```15:15:docs/driver-planning.md```).
2. Optional “Heute” button and/or year-month quick jump in `DriverPlanningFilters`.
3. Optional explicit validation toast when `week` fails to parse instead of silent fallback to current week.

No new service query is required — `getCompanyWeekPlan(weekStartYmd)` already accepts any Monday YMD (```138:168:src/features/driver-planning/api/driver-planning.service.ts```).

---

## 2. Retroactive shift entry — current path + gaps

### Terminology (critical)

The codebase separates **plans** (`driver_day_plans`) from **actuals** (`shifts`):

> “Separate from shifts (actual worked time). This module never writes to shifts.”  
> ```4:4:src/features/driver-planning/api/driver-planning.service.ts```

> “Admin-entered driver schedule plan … Separate from shifts (actuals).”  
> ```36:37:supabase/migrations/20260524120000_add_driver_day_plans.sql```

Retroactive **plan** entry and retroactive **shift actual** entry are different workflows.

### Current paths

#### A) Admin records a **plan** for a past day (Dienstplan)

1. Navigate to `/dashboard/fahrerschichtplanung?week=<Monday-of-that-week>` (week nav has no past bound — §1).
2. Click a roster cell → `DayPlanEditPopover` → `DayPlanEditForm` → `useUpsertDayPlan` (```186:201:src/features/driver-planning/components/driver-roster-grid.tsx```, ```221:258:src/features/driver-planning/api/driver-planning.service.ts```).
3. `upsertDayPlan` accepts any `planDate: string` with no past/future check (```221:248:src/features/driver-planning/api/driver-planning.service.ts```).

This path is **already available** for arbitrary past weeks if the admin navigates there.

#### B) Admin records a **worked shift** (actual start/end in `shifts`)

| Step | Who | Path |
|------|-----|------|
| Driver self-service | Driver | `/driver/shift` → `ShiftTimeForm` → `shiftsService.createManualShift` (```168:168:src/features/driver-portal/api/shifts.service.ts```, ```331:342:src/features/driver-portal/components/shift-time-form.tsx```) |
| Admin | **Blocked** | Driver layout redirects non-drivers to dashboard (```37:39:src/app/driver/layout.tsx```) |

There is **no admin UI or service** in the planning module to create or edit `shifts` rows.

#### C) Admin reconciles trips / confirms Schichtzettel

Separate route `/dashboard/shift-reconciliations` — reads trips, optionally reads `shifts` for `shift_id` linkage, writes `shift_reconciliations` and trip `manual_gross_price` on confirm (```225:256:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```). Does **not** create shifts.

### Does `/driver/shift` allow admin access?

**No.**

```37:39:src/app/driver/layout.tsx
  if (account.role !== 'driver') {
    redirect('/dashboard/overview');
  }
```

Admins are redirected before any driver-portal shift UI loads.

### Does `driver_day_plans` upsert accept any past date?

**Yes, at service and schema level.**

- Service: no date validation beyond admin context + payload shape (```221:248:src/features/driver-planning/api/driver-planning.service.ts```).
- Schema: `plan_date date NOT NULL` with UNIQUE `(company_id, driver_id, plan_date)` — no CHECK restricting past/future (```12:22:supabase/migrations/20260524120000_add_driver_day_plans.sql```).
- RLS: admin-only `FOR ALL` on own company (```50:64:supabase/migrations/20260524120000_add_driver_day_plans.sql```) — no date predicate.

### Service-level or RLS constraints on retroactive **plans**?

**None found.** Admin can upsert/delete plans for any `plan_date` the roster cell exposes.

### Gaps for seamless retroactive entry from the admin roster

| Need | Current state | Gap |
|------|---------------|-----|
| Retroactive **plan** | Works via week nav + cell popover | Admin must know to change week; no “go to date” on a driver row |
| Retroactive **shift actual** | Driver-only `/driver/shift` | No admin create/edit shift path; roster never writes `shifts` (```4:4:src/features/driver-planning/api/driver-planning.service.ts```) |
| Plan vs actual visibility | `getActualShiftDatesForWeek` exists (```171:218:src/features/driver-planning/api/driver-planning.service.ts```) but Phase 2 roster does not call it | Docs: Ist overlay deferred (```98:98:docs/driver-planning.md```) |
| Reconciliation from roster | Separate nav route | No link from roster cell to Schichtzettel detail for same `(driver_id, date)` |
| Driver forgot to log | Driver must use portal, or admin sets **plan** only | Admin cannot backfill `shifts` / `shift_events` from dashboard |

**Minimum additions for seamless admin retroactive shift (actuals):**

1. Admin-authorized shift upsert service (or reuse driver logic server-side with `requireAdminContext`).
2. UI entry point from roster cell or reconciliation panel (times + breaks).
3. Optional: show plan vs actual indicator using existing `getActualShiftDatesForWeek`.

---

## 3. Single-driver filter — current state + options

### Current state

**No single-driver filter on the Phase 2 roster.**

- URL state: only `week` (```44:46:src/features/driver-planning/components/driver-planning-filters.tsx```).
- Docs: “Phase 2 roster shows all active drivers (no `?driver=` select)” (```15:15:docs/driver-planning.md```).
- Page always loads full company week plan (```39:40:src/app/dashboard/fahrerschichtplanung/page.tsx```).
- Grid maps **all** `drivers` from `CompanyWeekPlan` (```132:132:src/features/driver-planning/components/driver-roster-grid.tsx```).

Phase 1 had a driver `<Select>`; it was removed in Phase 2 (see ```15:15:docs/driver-planning.md``` and phase-2 audit references).

`ShiftReconciliationFilters` still provides a driver `<Select>` + optional date — a reusable pattern (```17:17:src/features/shift-reconciliations/components/shift-reconciliation-filters.tsx```, docs ```43:43:docs/shift-reconciliations.md```).

### Minimal addition

| Piece | Change |
|-------|--------|
| URL | Restore optional `?driver=<uuid>` via nuqs in `DriverPlanningFilters` (mirror reconciliation filters) |
| Component | Filter `drivers` (and optionally scroll/highlight row) in `DriverRosterGrid` before `.map()` |
| Query | **No new service query** — `getCompanyWeekPlan` already returns all drivers + plans for the week (```138:168:src/features/driver-planning/api/driver-planning.service.ts```) |

Client-side filter on the fetched `CompanyWeekPlan.drivers` array is sufficient and matches the current cache model (`companyWeekPlanKeys.byWeek(weekStart)` — ```19:22:src/features/driver-planning/hooks/use-driver-week-plan.ts```).

### Client-side vs new query

| Approach | Verdict |
|----------|---------|
| Client-side filter on `CompanyWeekPlan` | **Preferred** — same payload, no cache fragmentation, instant toggle |
| New `getDriverWeekPlan`-only fetch when filtered | Redundant network call; would need dual cache keys and complicate mutation invalidation (mutations already invalidate both `driverWeekPlanKeys` and `companyWeekPlanKeys` — ```24:31:src/features/driver-planning/hooks/use-driver-week-plan.ts```) |

---

## 4. Shift-reconciliations — current state

### What `/dashboard/shift-reconciliations` shows

Admin **Schichtzettel-Abgleich**: per-driver day summaries, expandable day rows, trip table with manual gross price editing, and shift confirmation.

| UI state | Condition | Citation |
|----------|-----------|----------|
| **A** — empty | No driver selected | ```36:38:src/features/shift-reconciliations/components/shift-reconciliation-page-client.tsx``` |
| **B** — day list | Driver selected, no `date` | ```40:48:src/features/shift-reconciliations/components/shift-reconciliation-page-client.tsx``` |
| **C** — detail | Driver + `date` | ```50:58:src/features/shift-reconciliations/components/shift-reconciliation-page-client.tsx``` |

RSC prefetches drivers; if `driver` set, summaries; if `driver` + `date`, trip bundle (```26:54:src/app/dashboard/shift-reconciliations/page.tsx```).

URL params: `driver`, `date`, `mode` (```17:17:docs/shift-reconciliations.md```).

### Data model

| Table / RPC | Read / Write | Role |
|-------------|--------------|------|
| `accounts` | Read | Driver list, confirmer display name |
| RPC `get_shift_day_summaries` | Read | Per-day aggregates for list (```56:75:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```) |
| `trips` | Read + Write (`manual_gross_price`) | Assigned trips for business day (```77:223:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```) |
| `shift_reconciliations` | Read + Upsert on confirm | Confirmation record (```225:256:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```) |
| `shifts` | Read (optional) | Resolve `shift_id` when confirming (```225:243:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```) |
| `payers` | Read (via trips) | `accepts_self_payment` warnings (```docs/shift-reconciliations.md```) |

**Primary key structure — `shift_reconciliations`:**

- Surrogate PK: `id uuid` (inferred from upsert returning `id` — ```255:255:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```).
- Business uniqueness: upsert `onConflict: 'company_id,driver_id,date'` (```254:255:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```).
- Docs: “UNIQUE (company_id, driver_id, date)” (```20:20:docs/shift-reconciliations.md```).

**Not in scope of writes:** `driver_day_plans`, shift creation.

### Relationship to `driver_day_plans`

**No foreign key and no service join today.**

- Plans: table `driver_day_plans`, date column `plan_date` (```12:12:supabase/migrations/20260524120000_add_driver_day_plans.sql```).
- Reconciliations: table `shift_reconciliations`, date column `date` (```254:255:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```).
- Logical join only: `(company_id, driver_id, calendar_date)` — docs cross-reference planning status on reconciliation list as future work (```329:329:docs/plans/driver-planning-module-audit.md```).

### Relationship to `shifts` (actuals)

- **Optional link:** `confirmShift` looks up a shift for `(driver_id, date)` and stores `shift_id` on the reconciliation row when found (```225:243:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```).
- Reconciliation does **not** require a shift row to confirm; it aggregates trips and records admin confirmation.
- Shift types live in driver-portal (```41:42:src/features/driver-portal/types.ts```); reconciliation service reads `shifts` read-only for linkage.

### Admin workflow (step by step)

1. Open **Schichtzettel-Abgleich** from nav (```113:117:src/config/nav-config.ts```) → `/dashboard/shift-reconciliations`.
2. Select a **driver** in `ShiftReconciliationFilters` → URL `?driver=<uuid>` → day list loads (`ShiftDayList`, RPC summaries) (```40:48:src/features/shift-reconciliations/components/shift-reconciliation-page-client.tsx```).
3. **Expand a day row** or pick a **date** in the date picker → URL gains `?date=YYYY-MM-DD` → detail panel (`ShiftDetailPanel`) with trips (```50:58:src/features/shift-reconciliations/components/shift-reconciliation-page-client.tsx```).
4. Edit **manual gross prices** on trips (auto-save via server action — ```223:223:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```).
5. **Confirm shift** → upsert `shift_reconciliations`, optional `shift_id` (```225:256:src/features/shift-reconciliations/api/shift-reconciliations.service.ts```).
6. Use **back** / clear date to return to day list without losing driver context (```5:5:src/features/shift-reconciliations/components/shift-reconciliation-filters.tsx```, ```43:43:docs/shift-reconciliations.md```).

### Nav entry

Under **Account** group, after Fahrerschichtplanung:

```113:117:src/config/nav-config.ts
      {
        title: 'Schichtzettel-Abgleich',
        url: '/dashboard/shift-reconciliations',
        icon: 'shiftReconciliation',
        shortcut: ['s', 'z']
      },
```

---

## 5. Merge feasibility assessment

### Could reconciliations embed in `/dashboard/fahrerschichtplanung`?

**Yes, technically feasible** as a panel, drawer, or secondary column reusing existing shift-reconciliation components and hooks. Both modules:

- Share admin auth boundary (`requireAdminContext` — ```5:5:src/features/driver-planning/api/driver-planning.service.ts```, ```5:6:src/features/shift-reconciliations/actions.ts```).
- Key off **driver + calendar date** (plan: `plan_date`; reconciliation: `date`).
- Use nuqs URL state and TanStack Query with distinct key prefixes (`company-week-plan` vs `shift-reconciliation-*` — ```19:22:src/features/driver-planning/hooks/use-driver-week-plan.ts```, ```5:5:src/features/shift-reconciliations/lib/constants.ts```).

### Shared keys for roster cell → reconciliation

| Key | Planning | Reconciliation |
|-----|----------|----------------|
| `driver_id` | Row key in roster (```132:132:src/features/driver-planning/components/driver-roster-grid.tsx```) | `?driver=` filter |
| Date | Column `plan_date` YMD (```27:34:src/features/driver-planning/lib/week-dates.ts```) | `?date=` |
| `company_id` | Implicit via RLS / admin context | Same |

No DB FK — embedding uses composite `(driverId, dateYmd)` navigation only.

### What breaks if standalone route is removed?

| Risk | Detail |
|------|--------|
| Nav + shortcut | Entry at ```113:117:src/config/nav-config.ts``` and `['s','z']` shortcut |
| Bookmarks / shared links | URLs with `/dashboard/shift-reconciliations?driver=&date=` |
| Docs / plans | Multiple doc references (```43:43:docs/shift-reconciliations.md```, ```111:111:docs/driver-planning.md```) |
| kbar / external | **No** kbar or other `src/` deep links found beyond `nav-config.ts` (grep of `src/`) |
| Payer sheet copy | Mentions “Schichtzettel-Abgleich” in help text only (```617:617:src/features/payers/components/payer-details-sheet.tsx```) — not a route dependency |

Recommend **redirect** from old URL during transition if route is removed.

### URL / param conflicts

| Module | Params |
|--------|--------|
| Planning | `week` |
| Reconciliation | `driver`, `date`, `mode` |

No collision on `week` vs `date`. If both live on one page, combined URL `?week=&driver=&date=` is workable; `mode` may need namespacing if planning adds edit modes later.

### Minimal embedding approach (preserves full reconciliation功能)

**Recommended: drawer or right-side panel** opened from roster cell (or row actions) with `(driverId, planDate)`:

1. Keep `ShiftDetailPanel`, trip table, confirm mutation unchanged — mount inside drawer.
2. Pass `initialBundle` from optional RSC prefetch when `driver`+`date` present (pattern from ```26:54:src/app/dashboard/shift-reconciliations/page.tsx```).
3. Day-list-only reconciliation view could be a second tab (“Abgleich”) when `?driver=` set without `date`, reusing `ShiftDayList`.
4. **Keep standalone route** initially with shared client shell — lowest regression risk.

Less ideal: expanded table row — trip table + confirm UX is wide; drawer matches existing sheet/popover patterns in planning (```186:201:src/features/driver-planning/components/driver-roster-grid.tsx```).

---

## 6. Additional gaps (admin workflow)

Beyond week nav, retroactive entry, and single-driver filter:

| Check | Finding | Citation |
|-------|---------|----------|
| **a) Full month at a glance** | **No** — single ISO week roster only (7 columns + footer) | ```109:127:src/features/driver-planning/components/driver-roster-grid.tsx``` |
| **b) Search / sort on driver list** | **No search.** Sort fixed: `getPlanningDrivers` orders by `first_name`, `last_name` ascending | ```98:98:src/features/driver-planning/api/driver-planning.service.ts```, grid uses server order (```132:132:src/features/driver-planning/components/driver-roster-grid.tsx```) |
| **c) Plan vs actual on roster** | **No Ist overlay in Phase 2.** Service helper exists; docs list as deferred | ```171:218:src/features/driver-planning/api/driver-planning.service.ts```, ```98:98:docs/driver-planning.md``` |
| **d) Edit actual shift times (past day ≠ plan)** | **No admin path.** Planning popover edits `planned_start` / `planned_end` on `driver_day_plans` only (```221:248:src/features/driver-planning/api/driver-planning.service.ts```). Actuals: driver `/driver/shift` only (```37:39:src/app/driver/layout.tsx```) |
| **e) Print / export** | **No** — explicitly deferred in docs | ```95:104:docs/driver-planning.md``` |

### Other obvious gaps

| Gap | Detail |
|-----|--------|
| Vehicle / notes in roster | Popover supports `vehicle_id` and `notes` (form fields) but cells show status + times only — no at-a-glance vehicle column |
| Bulk operations | No copy-week, template, or multi-cell edit |
| Driver inactive handling | `getPlanningDrivers` filters `is_active = true` (```95:97:src/features/driver-planning/api/driver-planning.service.ts```) — no toggle for inactive drivers |
| Reconciliation plan hint | Module audit: show planned status on reconciliation day list — not implemented (```329:329:docs/plans/driver-planning-module-audit.md```) |
| Column coverage only | Footer “Besetzt” counts working plans per day — no reconciliation or trip totals on planning page (```176:183:src/features/driver-planning/components/driver-roster-grid.tsx```) |

---

## 7. Technical risks of proposed improvements

### Free week navigation

| Risk | Severity | Notes |
|------|----------|-------|
| nuqs desync | Low | Week changes already call `router.refresh()` (```55:57:src/features/driver-planning/components/driver-planning-filters.tsx```) |
| RSC prefetch mismatch | Medium | Must keep client `weekStart` and RSC `getCompanyWeekPlan(weekStart)` aligned — same pattern as shift-reconciliations page (```26:54:src/app/dashboard/shift-reconciliations/page.tsx```) |
| Query cache stale week | Low | `companyWeekPlanKeys.byWeek(weekStart)` isolates weeks (```19:22:src/features/driver-planning/hooks/use-driver-week-plan.ts```); unbounded weeks = unbounded cache entries over time (memory, not correctness) |
| Invalid `?week=` | Low | Fallback to current week only when param missing/short; garbage ≥10 chars may throw in date parse (```32:37:src/app/dashboard/fahrerschichtplanung/page.tsx```, ```14:25:src/features/driver-planning/lib/week-dates.ts```) |

### Retroactive entry (past `plan_date`)

| Risk | Severity | Notes |
|------|----------|-------|
| RLS | None for plans | Admin-only policy, no date predicate (```50:64:supabase/migrations/20260524120000_add_driver_day_plans.sql```) |
| Business logic | Low | Upsert has no “no past edits” rule (```221:248:src/features/driver-planning/api/driver-planning.service.ts```) |
| Confusion plan vs shift | **High (product)** | Admin may think popover backfills worked time; it only writes plans (```4:4:src/features/driver-planning/api/driver-planning.service.ts```) |
| Admin shift backfill | **High (engineering)** | Would need new admin shift write path + audit; driver RLS on `shifts` may block admin inserts — not audited in this doc (no migration read for `shifts` RLS) |

### Single-driver filter

| Approach | Risk |
|----------|------|
| Client-side filter | **Safer** — single `CompanyWeekPlan` cache entry per week; mutations invalidate whole week (```24:31:src/features/driver-planning/hooks/use-driver-week-plan.ts```) |
| New per-driver fetch | Higher — dual caches, easy to show stale row hours if invalidation incomplete |

### Reconciliation merge

| Risk | Detail |
|------|--------|
| Feature coupling | Phase 1 rule: planning must not import shift-reconciliation internals without clear boundary — merge violates strict isolation (```docs/driver-planning.md``` architecture notes) |
| Shared URL state | Combining `week`, `driver`, `date` on one page increases nuqs complexity and back-navigation edge cases |
| Query key collision | **Low** — prefixes differ (`company-week-plan` vs `shift-reconciliations`) |
| Bundle size | Importing full reconciliation UI into planning page increases client JS for all roster visits |
| RSC prefetch | Detail bundle prefetch is conditional on `driver`+`date` (```39:54:src/app/dashboard/shift-reconciliations/page.tsx```) — planning RSC would need parallel conditional logic |
| Regression | Removing standalone route breaks nav shortcut and bookmarks (```113:117:src/config/nav-config.ts```) |

---

## 8. Senior recommendation — next improvement priorities

Ordered by admin pain vs implementation cost:

| Priority | Item | Rationale |
|----------|------|-----------|
| **P1** | **Plan vs actual indicator on roster** | `getActualShiftDatesForWeek` already exists (```171:218:src/features/driver-planning/api/driver-planning.service.ts```); closes the biggest visibility gap without new schema (```98:98:docs/driver-planning.md```). |
| **P1** | **Single-driver filter (`?driver=`)** | Minimal nuqs + client filter; reuses reconciliation filter pattern (```17:17:src/features/shift-reconciliations/components/shift-reconciliation-filters.tsx```). |
| **P2** | **Roster cell → reconciliation drawer** | Shared `(driver_id, date)` key; embed `ShiftDetailPanel` without removing standalone route yet; add redirect-safe deep link. |
| **P2** | **“Heute” week shortcut + invalid week handling** | Cheap UX win; free week nav already works (§1). |
| **P3** | **Admin retroactive shift actuals** | Requires new admin shift write API and clear separation from plan popover — highest engineering + RLS scope; until then, document that popover = plan only. |
| **P3** | **Merge / retire standalone Schichtzettel route** | Only after drawer parity proven; keep ```113:117:src/config/nav-config.ts``` or alias URL. |
| **P4** | **Month view, export, bulk edit** | Deferred in docs (```95:104:docs/driver-planning.md```); larger scope. |

**Summary:** Week navigation to arbitrary past/future weeks **already works** with no coded bounds. Retroactive **plan** entry works when the admin navigates to the right week; retroactive **shift actuals** have **no admin path**. Single-driver filter is a small client-side addition. Reconciliation merge is feasible via drawer + shared `(driver_id, date)` with low query collision risk but non-trivial coupling and nav/bookmark migration work.

---

*Audit completed from codebase state May 2026. No code or schema changes.*
