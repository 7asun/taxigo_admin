# Fahrerschichtplanung — Read-Only Audit

**Date:** 2026-06-08  
**Scope:** `/dashboard/fahrerschichtplanung` (admin planning roster), `/driver/shift` (driver Schichtenzettel), shared types, Supabase access, and related docs.  
**Mode:** Read-only — no code or schema changes.

**Terminology (critical):** The admin page writes **`driver_day_plans`** (scheduled/planned days). The driver page writes **`shifts`** + **`shift_events`** (actual worked time). These are intentionally separate modules.

---

## 1. Popover & Status selector bug

### Current state

**Popover host:** Clicking a roster cell opens a single shared popover instance.

| Step | File | Lines | Behaviour |
|------|------|-------|-----------|
| Cell click | `src/features/driver-planning/components/roster-plan-cell.tsx` | 28–30 | `<button type="button" onClick={onClick}>` fires |
| Set edit target | `src/features/driver-planning/components/driver-roster-grid.tsx` | 228–232 | `setEditTarget({ driverId, planDate })` |
| Mount popover | `driver-roster-grid.tsx` | 281–293 | Conditional `{editTarget && <DayPlanEditPopover open … />}` |
| Popover shell | `src/features/driver-planning/components/day-plan-edit-popover.tsx` | 56–76 | Radix `Popover` + `PopoverAnchor` (virtual ref on active `<td>`) + `PopoverContent` |
| Form | `src/features/driver-planning/components/day-plan-edit-form.tsx` | 139–158 | Status field inside popover |

**Status control implementation:** shadcn/ui **`Select`** (Radix `@radix-ui/react-select`), not a native `<select>`.

```144:158:src/features/driver-planning/components/day-plan-edit-form.tsx
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as PlanStatus)}
          >
            <SelectTrigger id='dp-status'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PLAN_STATUSES) as PlanStatus[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {PLAN_STATUSES[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
```

Options come from `PLAN_STATUSES` in `src/features/driver-planning/types.ts` (lines 11–20). Default local state is `'working'` / **Arbeitstag** (```65:65:src/features/driver-planning/components/day-plan-edit-form.tsx```, reset in ```76:77:src/features/driver-planning/components/day-plan-edit-form.tsx```).

**Controlled binding:** The Select is correctly controlled (`value={status}`, `onValueChange` → `setStatus`). There is no missing `value` prop or wrong key mapping.

### Root cause

**Event propagation / portal dismiss — not a broken controlled binding.**

1. `SelectContent` renders through a **Portal** outside the popover DOM tree (`src/components/ui/select.tsx`, lines 69–93).
2. Radix `Popover` closes on **pointer-down outside** `PopoverContent`.
3. Clicking a `SelectItem` happens inside the portaled select dropdown, which Radix Popover treats as an **outside interaction**.
4. That fires `onOpenChange(false)` on the popover (`driver-roster-grid.tsx`, lines 284–286) → `setEditTarget(null)` → **`DayPlanEditPopover` and `DayPlanEditForm` unmount**.
5. Local `status` state is destroyed before the user can save; reopening the cell resets status via `useEffect` to `plan?.status ?? 'working'` (```76:83:src/features/driver-planning/components/day-plan-edit-form.tsx```).

**Why "Arbeitstag" appears to work:** It is the default for new cells (`'working'`) and for existing plans with `status = 'working'`. Saving without changing status never requires opening the Select dropdown, so the popover stays open through save. Any other status requires a dropdown click → popover dismiss → selection lost.

The vehicle `Select` (lines 186–201) has the same nesting issue.

Phase 2 moved edit UI from a **Sheet** (no parent dismiss conflict) to a **Popover** (```118:118:docs/plans/driver-planning-phase2-audit.md```). The popover file comment (```5:7:src/features/driver-planning/components/day-plan-edit-popover.tsx```) addresses z-index only, not outside-click containment.

**Exact code path on failed selection:**

```
RosterPlanCell.onClick
  → DriverRosterGrid.setEditTarget
  → DayPlanEditPopover (open=true)
  → DayPlanEditForm mounts, status='working'
  → User opens SelectTrigger
  → SelectContent portals to document.body
  → User clicks SelectItem (e.g. 'vacation')
  → [parallel] Select onValueChange may fire setStatus('vacation')
  → Popover onPointerDownOutside / dismiss
  → DriverRosterGrid.onOpenChange(false) → setEditTarget(null)
  → Form unmounts (state lost)
  → Re-open cell → useEffect resets status to 'working'
```

### Recommendation

Fix at the **Popover boundary** (minimal diff):

1. On `PopoverContent`, add `onInteractOutside` / `onPointerDownOutside` that **`preventDefault()`** when the event target is inside `[data-slot="select-content"]` (or Radix select content wrapper).
2. Optionally set **`modal={false}`** on the Popover (same pattern as `DatePicker` in `src/components/ui/date-time-picker.tsx`, line 239) to reduce focus-trap side effects.
3. Apply the same guard to the vehicle Select.

**Alternative (higher UX cost):** Revert cell edit to a **Sheet** or **Dialog** for forms with nested Selects — proven in Phase 1 (`day-plan-edit-sheet.tsx`, removed in Phase 2).

**Do not:** Patch only `Select` z-index; that does not stop outside-click dismiss.

---

## 2. Break field (Pause)

### Current state

**Admin popover form (`DayPlanEditForm`):** **No Pause/Break field.**

Fields today:

| Field | Label (DE) | Control | Lines |
|-------|------------|---------|-------|
| Status | Status | shadcn Select | 142–158 |
| Planned start | Geplant Beginn | `<Input type="time">` | 163–170 (conditional) |
| Planned end | Geplant Ende | `<Input type="time">` | 172–179 (conditional) |
| Vehicle | Fahrzeug (optional) | shadcn Select | 184–201 |
| Notes | Notizen | Textarea (max 500) | 204–213 |
| Actions | Abbrechen / Speichern / Löschen | Buttons | 222–254 |

Time fields show only when `status ∈ PLAN_STATUSES_WITH_TIMES` (`working`, `overtime`, `half_day_vacation`, `training`) — ```74:74:src/features/driver-planning/components/day-plan-edit-form.tsx```, ```25:30:src/features/driver-planning/types.ts```.

**Driver form (`ShiftTimeForm`):** Full break support — `hasBreak` switch, multiple break slots (von/bis), live **Bezahlte Zeit** — `src/features/driver-portal/components/shift-time-form.tsx`, lines 367–479. Breaks persist as **`shift_events`** (`break_start` / `break_end`), not as columns on `shifts`.

### Schema: `driver_day_plans` (what the admin page writes)

Migration: `supabase/migrations/20260524120000_add_driver_day_plans.sql`

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | uuid | NO | PK, default `gen_random_uuid()` |
| `company_id` | uuid | NO | FK → `companies` |
| `driver_id` | uuid | NO | FK → `accounts` |
| `plan_date` | date | NO | Berlin calendar date |
| `status` | text | NO | CHECK — 8 plan statuses |
| `planned_start` | time | YES | Wall-clock start |
| `planned_end` | time | YES | Wall-clock end |
| `vehicle_id` | uuid | YES | FK → `vehicles` |
| `notes` | text | YES | |
| `created_by` | uuid | YES | FK → `accounts` |
| `created_at` | timestamptz | NO | default `now()` |
| `updated_at` | timestamptz | NO | app-maintained on upsert |

**No `pause_minutes`, `break_duration`, or break-related column.** Confirmed in generated types (`src/types/database.types.ts`, lines 521–535).

### Schema: `shifts` (what `/driver/shift` writes — for comparison)

From `src/types/database.types.ts` (lines 1299–1313) + migrations:

| Column | Type |
|--------|------|
| `id` | uuid |
| `company_id` | uuid \| null |
| `driver_id` | uuid \| null |
| `vehicle_id` | uuid \| null |
| `started_at` | timestamptz |
| `ended_at` | timestamptz \| null |
| `status` | text (`active` \| `on_break` \| `ended`) |
| `start_odometer` | number \| null |
| `end_odometer` | number \| null |
| `total_distance_km` | number \| null |
| `total_earnings` | number \| null |
| `created_at` | timestamptz \| null |

**No `pause_minutes` on `shifts` either.** Breaks live in **`shift_events`** with `event_type` `break_start` / `break_end` and optional `metadata.reason`.

### Gap

Admin planning cannot express planned break duration. Product must decide: is break a **planning** concern (`driver_day_plans`) or only an **actuals** concern (`shift_events`)?

### Recommendation

- **If planning needs Pause:** Add `planned_break_minutes int` (or `planned_break_start` / `planned_break_end` time pair) to **`driver_day_plans`** via migration + extend `UpsertDayPlanPayload` and `DayPlanEditForm`. Keep separate from `shifts` break events.
- **If Pause is actuals-only:** Do not add to admin roster; instead expose read-only paid-time from `shifts`/`shift_events` overlay (deferred in `docs/driver-planning.md`, line 98).
- **Do not** conflate `driver_day_plans` upsert with `shiftsService.createManualShift` — service explicitly avoids writing shifts (`src/features/driver-planning/api/driver-planning.service.ts`, lines 4–5).

---

## 3. Multi-day selection (Mehrtagige Auswahl)

### Current state

**Admin roster date interaction:** **Single-day, single-cell click** — no range or multi-select.

| Mechanism | Implementation | File |
|-----------|----------------|------|
| Grid | Custom HTML `<table>` — drivers × 7 weekday columns | `driver-roster-grid.tsx` |
| Cell selection | One `(driverId, planDate)` in `editTarget` state | `driver-roster-grid.tsx`, lines 76, 228–232 |
| Week scope | `buildWeekPlanDates(weekStartYmd)` → 7 YMD strings Mon–So | `lib/week-dates.ts`, lines 25–31 |
| Week navigation | `DatePicker` + prev/next chevrons, URL `?week=` (nuqs) | `driver-planning-filters.tsx` |

**Calendar library:** The roster grid is **not** a calendar library — it is a sticky table with `date-fns` formatting. Week picking uses **`DatePicker`** → **`Calendar`** → **`react-day-picker`** (`DayPicker` in `src/components/ui/calendar.tsx`, line 4). That picker selects **one day** and snaps to Monday (`snapYmdToWeekStart` in filters, line 75).

**Range selection elsewhere (not wired to planning):** `DateRangePicker` in `date-time-picker.tsx` supports `DateRange` from `react-day-picker` (used in trips filters, invoices). **Not used** on Fahrerschichtplanung.

**Driver `/driver/shift`:** Single `date` input per form submission (`shift-time-form.tsx`, lines 331–346) — one shift per save, duplicate-day overwrite confirm only.

### Gap

No mechanism to select Mon–Fri for one driver, apply one status/times block, or bulk-create plans across a range.

### Recommendation

1. **Phase A:** Row action “Woche kopieren” or shift+click range on one driver row (client-side loop calling existing `upsertDayPlanAction`).
2. **Phase B:** Optional `DateRangePicker` in a bulk-edit dialog with preview of affected cells.
3. Reuse Berlin week helpers (`week-dates.ts`, `trip-business-date.ts`) — do not introduce local `Date` timezone bugs.
4. Keep single-cell popover for one-off edits after fixing §1.

---

## 4. Driver filter

### Current state

**No driver filter on Fahrerschichtplanung today.**

- URL state: **`week` only** (`driver-planning-filters.tsx`, lines 44–50; `docs/driver-planning.md`, line 15).
- Phase 2 **removed** Phase 1 `?driver=` Select (`docs/plans/driver-planning-phase2-audit.md`, line 13; `docs/plans/driver-planning-ux-gaps-audit.md`, §3).

**How drivers are loaded:**

| Layer | Method | File |
|-------|--------|------|
| RSC | `getPlanningDrivers()` | `fahrerschichtplanung/page.tsx`, line 30 |
| Service | Supabase server client | `driver-planning.service.ts`, lines 90–105 |
| Query | `accounts` where `role = 'driver'`, `is_active = true`, same `company_id` | lines 92–98 |
| Order | `.order('name')` | line 98 |

**Not React Query** for the driver list — fetched once per RSC render and passed as props to `DriverRosterGrid`.

**Returned shape:**

```typescript
type PlanningDriverListItem = { id: string; full_name: string };
```

(`types.ts`, line 45). `full_name` is derived from `name` or `first_name` + `last_name` (`driver-planning.service.ts`, lines 55–64, 101–104).

**Grid:** Maps **all** drivers as table rows (`driver-roster-grid.tsx`, lines 197–248).

### Gap

Large rosters (30–50 drivers) have no way to focus one driver without scanning the full table.

### Recommendation

Restore optional **`?driver=<uuid>`** via nuqs in `DriverPlanningFilters` (mirror `ShiftReconciliationFilters`). **Client-side filter** on the existing `drivers` prop — no new API query (`docs/plans/driver-planning-ux-gaps-audit.md`, §3). Optionally scroll/highlight the filtered row.

---

## 5. Quick-create button (+ Button)

### Current state

**No global “create shift/plan” action** on the admin page.

| UI element | Location | Purpose |
|------------|----------|---------|
| Per-cell `IconPlus` | Empty roster cells | `roster-plan-cell.tsx`, lines 51–54 — opens same popover as filled cells |
| Page header | `PageContainer` | Title + description only — `fahrerschichtplanung/page.tsx`, lines 42–44 |
| Filters | Week navigation only | No create button |

Filled and empty cells share one code path: click → `setEditTarget` → popover (`driver-roster-grid.tsx`, lines 223–234).

**Driver page:** Collapsible **“Zeiterfassung / Neue Schicht erfassen”** card (`shift-time-form.tsx`, lines 296–315) — module-level create, not a floating FAB.

### Gap

Admin cannot create a plan without clicking a specific driver×day cell. No shortcut for “new plan for driver X on date Y” from a toolbar.

### Recommendation

Logical placements (lowest friction first):

1. **Toolbar next to week filters** — “Planung hinzufügen” opens a dialog: driver Select + date DatePicker + same `DayPlanEditForm` fields (avoids nested Select-in-Popover for status).
2. **Sticky row action** per driver — “+ Tag” opens date picker then popover/sheet.
3. Avoid a floating FAB unless mobile roster gets a dedicated layout (deferred in `docs/driver-planning.md`, line 104).

Reuse `DayPlanEditForm` body; only change shell (Dialog/Sheet) to sidestep §1 bug if toolbar uses Selects.

---

## 6. Comparison: `/driver/shift` vs admin Fahrerschichtplanung

### `/driver/shift` input fields (`ShiftTimeForm`)

| Field | DE label | Type | Lines |
|-------|----------|------|-------|
| Paid time display | Bezahlte Zeit | Calculated (read-only) | 319–328 |
| Date | Datum | `<Input type="date">` | 331–346 |
| Start | Beginn | `<Input type="time">` | 349–364 |
| Break toggle | Pause eingeben | Switch | 367–394 |
| Break slots | Pause von/bis (multiple) | Time inputs + append/remove | 397–479 |
| End | Ende | `<Input type="time">` | 482–497 |
| Submit | Schicht speichern | Button | 500–507 |

**Driver selection:** **Tied to authenticated user** — loads `accounts.id` + `company_id` from `supabase.auth.getUser()` (`shift-time-form.tsx`, lines 187–204). **No driver picker.**

**Persistence:** `shiftsService.createManualShift` → `shifts` + `shift_events` (`shifts.service.ts`, lines 168–236).

**Access:** Admins redirected away — `src/app/driver/layout.tsx` (role !== `'driver'` → `/dashboard/overview`) per `docs/plans/driver-planning-ux-gaps-audit.md`.

### Admin Fahrerschichtplanung fields (`DayPlanEditForm`)

| Field | Present on admin |
|-------|------------------|
| Status (8 plan types) | Yes |
| Geplant Beginn / Geplant Ende | Yes (conditional) |
| Fahrzeug | Yes (planned vehicle) |
| Notizen | Yes |
| Datum | Implicit from clicked column |
| Fahrer | Implicit from clicked row |
| Pause / breaks | **No** |
| Bezahlte Zeit | **No** |
| Beginn/Ende as actual worked time | **No** (planned times only) |
| Duplicate-day overwrite | **No** (upsert on `driver_day_plans` unique key) |

### Side-by-side summary

| Concern | Admin (`driver_day_plans`) | Driver (`shifts`) |
|---------|---------------------------|-------------------|
| Purpose | Schedule / HR planning | Actual time worked |
| Status enum | `working`, `vacation`, `sick`, … | `active`, `on_break`, `ended` |
| Breaks | Not supported | `shift_events` |
| Vehicle | Optional plan | Optional on shift row |
| Notes | Yes | No notes field on form |
| Who | Admin picks driver via grid row | Always self |

### Recommendation

Treat these as **complementary surfaces**, not duplicates:

- Document clearly in UI copy that admin popover = **Dienstplan**, not Schichtenzettel.
- For parity on **actuals**, add a separate admin path (server action + admin RLS on `shifts`) — not by overloading `DayPlanEditForm`.
- Optional roster overlay: `getActualShiftDatesForWeek` already exists (`driver-planning.service.ts`, lines 174–201) but is **not called** from Phase 2 UI.

---

## 7. Supabase RLS / permissions

### `driver_day_plans` (admin planning writes)

Policy **`admin_all_own_company`** — `supabase/migrations/20260524120000_add_driver_day_plans.sql`, lines 50–61:

- **FOR ALL** (SELECT, INSERT, UPDATE, DELETE)
- **USING / WITH CHECK:** `company_id = current_user_company_id() AND current_user_is_admin()`
- **Drivers:** no policy — no access in Phase 1

**Admin upsert on behalf of a driver:** **Allowed.** Payload sets `driver_id` from the clicked roster row (`driver-planning.service.ts`, lines 232–250). Service gate: `requireAdminContext()` checks `accounts.role === 'admin'` (lines 30–52).

### `shifts` / `shift_events` (actual worked time)

Migration: `supabase/migrations/20260319100000_add_shifts_shift_events_rls.sql`

| Role | shifts SELECT | shifts INSERT | shifts UPDATE | shifts DELETE |
|------|---------------|---------------|---------------|---------------|
| Driver (`driver_id = auth.uid()`) | Own | Own | Own | Own |
| Admin | Company (`shifts_select_company_admin`) | **None** | **None** | **None** |

**shift_events:** Drivers insert/delete own; admins **SELECT only** (lines 74–84). **No admin INSERT** policy.

**Admin inserting/updating shifts for a driver:** **Blocked by RLS** with the current policy set. Even a new admin UI calling `shiftsService.createManualShift` from the dashboard would fail unless run as the driver or policies are extended.

**Admin auth role:** Clerk/Supabase session → `accounts.role = 'admin'` + `company_id` set (`requireAdminContext` in `driver-planning.service.ts`). Not a Postgres superuser — standard `authenticated` JWT with RLS.

### Recommendation

| Action | Feasibility today | Needed for admin backfill |
|--------|-------------------|---------------------------|
| Upsert `driver_day_plans` for any driver | Yes | Nothing |
| Create/edit `shifts` for a driver | No | New policies e.g. `shifts_insert_company_admin` / `shifts_update_company_admin` with `WITH CHECK (company_id = current_user_company_id() AND current_user_is_admin())`; mirror for `shift_events` |
| Audit trail | Partial (`created_by` on plans) | Add `created_by` / admin metadata on shift writes if admins gain write access |

Implement admin shift writes in a **server-only service** with `requireAdminContext()` — never expose driver JWT bypass on the client.

---

## Files reviewed

| Area | Paths |
|------|-------|
| Admin route | `src/app/dashboard/fahrerschichtplanung/page.tsx` |
| Driver route | `src/app/driver/shift/page.tsx` |
| Planning feature | `src/features/driver-planning/**` |
| Driver portal | `src/features/driver-portal/components/driver-shift-page-content.tsx`, `shift-time-form.tsx`, `api/shifts.service.ts`, `types.ts` |
| UI primitives | `src/components/ui/select.tsx`, `popover.tsx`, `date-time-picker.tsx`, `calendar.tsx` |
| Schema / RLS | `supabase/migrations/20260524120000_add_driver_day_plans.sql`, `20260319100000_add_shifts_shift_events_rls.sql`, `src/types/database.types.ts` |
| Docs | `docs/driver-planning.md`, `docs/driver-portal.md`, `docs/plans/driver-planning-phase2-audit.md`, `docs/plans/driver-planning-ux-gaps-audit.md`, `docs/plans/schichtzettel-shifts-audit.md` |

---

## Priority summary

| Priority | Item | Effort |
|----------|------|--------|
| **P0** | Fix Popover + nested Select dismiss (§1) | Small — `onInteractOutside` guard or Sheet fallback |
| **P1** | Restore `?driver=` filter (§4) | Small |
| **P1** | Clarify plan vs Schicht in UI copy (§6) | Small |
| **P2** | Planned break field on `driver_day_plans` if product requires (§2) | Medium — migration + form |
| **P2** | Multi-day bulk plan (§3) | Medium |
| **P3** | Admin toolbar quick-create (§5) | Medium |
| **P3** | Admin shift actuals + RLS (§7) | Large — policies + service + UI |

---

*Audit completed from codebase state 2026-06-08. No code or schema changes.*
