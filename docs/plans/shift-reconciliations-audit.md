# Shift Reconciliations — Read-Only Audit

**Date:** 2026-06-08  
**Scope:** Schema, service, UI, trips linkage, `shifts` relationship, km tracking, and gaps for a combined admin workflow.  
**Rule:** No code changes — findings only.

**Primary sources read:**

- `supabase/migrations/20260428120000_shift_reconciliations.sql`
- Subsequent migrations referencing `shift_reconciliations` (grep): `20260502120000_get_shift_day_summaries.sql`, `20260502120002_billing_type_accepts_self_payment.sql` — **no `ALTER TABLE shift_reconciliations`**
- `src/features/shift-reconciliations/api/shift-reconciliations.service.ts`
- `src/features/shift-reconciliations/types.ts`
- `src/types/database.types.ts` (`shift_reconciliations`, `shifts`, `trips` blocks)
- `src/app/dashboard/shift-reconciliations/page.tsx`
- All files under `src/features/shift-reconciliations/components/` and `hooks/`
- `src/features/driver-planning/api/admin-shifts.service.ts`, `src/features/driver-planning/types.ts`
- `docs/shift-reconciliations.md`
- Related plan docs in `docs/plans/` (see § cross-references at end)

---

## 1. SCHEMA — `shift_reconciliations` table

### Current state

#### 1a. Columns (type, nullability, default, FK targets)

Defined in [`supabase/migrations/20260428120000_shift_reconciliations.sql`](../../supabase/migrations/20260428120000_shift_reconciliations.sql) **11–21**; mirrored in [`src/types/database.types.ts`](../../src/types/database.types.ts) **1237–1297**.

| Column | Type | Nullable | Default | FK / notes |
|--------|------|----------|---------|------------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK |
| `company_id` | `uuid` | NOT NULL | — | → `companies(id)` ON DELETE CASCADE |
| `driver_id` | `uuid` | NOT NULL | — | → `accounts(id)` ON DELETE CASCADE |
| `date` | `date` | NOT NULL | — | Business calendar day (YMD, not timestamptz) |
| `confirmed_by` | `uuid` | NOT NULL | — | → `accounts(id)` (admin who confirmed) |
| `confirmed_at` | `timestamptz` | NOT NULL | `now()` | Server timestamp of confirmation |
| `notes` | `text` | NULL | — | Optional dispatcher comment |
| `shift_id` | `uuid` | NULL | — | → `shifts(id)` ON DELETE SET NULL |

**Indexes:** `shift_reconciliations_company_id_idx`, `shift_reconciliations_driver_id_date_idx` — migration **43–44**.

**No subsequent migration alters this table.** Grep of `supabase/migrations/*.sql` for `shift_reconciliations` finds only the CREATE migration plus LEFT JOINs inside RPC replacements.

#### 1b. UNIQUE constraint

**Confirmed:** `UNIQUE (company_id, driver_id, date)` — migration **20**. One reconciliation row per tenant + driver + calendar day.

#### 1c. Status / confirmed column

**No dedicated `status` column.** Confirmation semantics:

- Row **exists** ⇒ day is reconciled.
- `confirmed_by` + `confirmed_at` are the audit trail (both NOT NULL on insert).
- UI derives “Bestätigt” / “Nicht geprüft” from presence of `confirmed_at` — e.g. [`shift-summary-bar.tsx`](../../src/features/shift-reconciliations/components/shift-summary-bar.tsx) **88–98**, [`shift-confirm-button.tsx`](../../src/features/shift-reconciliations/components/shift-confirm-button.tsx) **69–72**.

Allowed values: **not enumerated** — binary reconciled vs not (no `draft` / `rejected` / `Abgeschlossen` enum).

#### 1d. Km-related columns on `shift_reconciliations`

**None.** No `total_km`, `occupied_km`, `free_km`, odometer, or similar on this table.

#### 1e. `shift_id` FK

**Present, nullable.** `shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL` — migration **19–20**, **40–41**. Optional link when a `shifts` row exists for the driver in the business-day window.

#### 1f. Hour / time columns

**None on `shift_reconciliations`.** No `worked_hours`, `break_minutes`, `begin`, `end`, etc. Shift times live on `shifts` / `shift_events` (separate tables).

#### 1g. RLS — who can SELECT / INSERT / UPDATE / DELETE

Single policy `shift_reconciliations_company_admin` — migration **48–59**:

- **Operation:** `FOR ALL` (covers SELECT, INSERT, UPDATE, DELETE)
- **Role:** `authenticated`
- **USING / WITH CHECK:** `company_id = current_user_company_id() AND current_user_is_admin()`

Non-admin users and other companies: **no access**. No separate read-only policy for drivers.

### Gap for combined workflow

Schema stores **trip-reconciliation audit only** (who confirmed, when, optional notes, optional `shift_id`). It does **not** persist payroll actuals (Beginn/Ende/Pause), km totals, or a multi-state lifecycle (`Abgeschlossen` vs draft).

### Senior-level recommendation

Extend reconciliation **carefully** — either add nullable payroll/km columns on `shift_reconciliations` **or** treat `shifts` as the source of truth and add a explicit `status` enum on reconciliations (`open` | `completed`) once product defines reject/reopen rules. Avoid duplicating times on both tables without a single writer.

**PRODUCT DECISION REQUIRED:** Should “Abgeschlossen” be a new status distinct from today’s upsert-on-confirm, and can admins reopen or edit after confirm?

---

## 2. SERVICE LAYER

**File:** [`src/features/shift-reconciliations/api/shift-reconciliations.service.ts`](../../src/features/shift-reconciliations/api/shift-reconciliations.service.ts)  
**Client:** Server only — `createClient` from `@/lib/supabase/server` (**13**, **28–29**). Admin gate via local `requireAdminContext()` (**28–51**).

### Current state

#### 2a. Methods (signature + one-line description)

| Method | Signature | Description |
|--------|-----------|-------------|
| `getDrivers` | `(): Promise<DriverListItem[]>` | Lists active drivers in admin’s company for the selector (**70–85**). |
| `getTripsForShift` | `(driverId: string, date: string): Promise<ShiftTrip[]>` | Fetches `assigned` trips for driver+Berlin business day with payer/billing self-pay embeds (**124–186**). |
| `updateTripManualPrice` | `(tripId: string, manualGrossPrice: number \| null): Promise<void>` | Writes `trips.manual_gross_price` only; bypasses pricing engine (**191–212**). |
| `confirmShift` | `(params: ConfirmShiftParams): Promise<void>` where `ConfirmShiftParams = { driverId, date, notes? }` | Upserts `shift_reconciliations`; best-effort sets `shift_id` (**224–258**). |
| `getReconciliation` | `(driverId: string, date: string): Promise<ShiftReconciliationWithMeta \| null>` | Reads reconciliation row + confirmer display name (**263–296**). |
| `getShiftDaySummaries` | `(driverId: string): Promise<ShiftDaySummary[]>` | Calls RPC `get_shift_day_summaries` for list aggregates (**322–333**). |

**Exported types:** `DriverListItem`, `ConfirmShiftParams` (**65**, **214–218**).

**Server actions** in [`actions.ts`](../../src/features/shift-reconciliations/actions.ts) thin-delegate to the above — no extra logic.

#### 2b. How `confirmShift` works

1. Resolves Berlin day bounds via `getZonedDayBoundsIso(params.date)` (**229**).
2. **Reads** latest `shifts.id` for `(driver_id, company_id)` where `started_at` falls in `[startISO, endExclusiveISO)` (**230–239**). Errors swallowed → `shift_id = null` (**241–243**).
3. **Upserts** into `shift_reconciliations` with `company_id`, `driver_id`, `date`, `confirmed_by` (current admin), `confirmed_at` (now ISO), trimmed `notes`, `shift_id` (**245–256**).
4. Conflict target: `onConflict: 'company_id,driver_id,date'` — idempotent re-confirm overwrites `confirmed_by`, `confirmed_at`, `notes`, `shift_id`.

**Does not write** `trips`, `shifts`, or `shift_events`.

#### 2c. Reads from `shifts` / `shift_events`?

- **`shifts`:** Yes — `confirmShift` selects `id` only (**230–239**).
- **`shift_events`:** **No** reads in this service.

#### 2d. Writes to `shifts` / `shift_events`?

**No.** All writes target `shift_reconciliations` (confirm) or `trips.manual_gross_price` (price override).

#### 2e. Hour or km logic in service?

**None.** No duration, break, or distance calculations.

#### 2f. Supabase client

**Server client only** (`@/lib/supabase/server`). Documented at file top (**1–10**). Browser never calls this module directly; UI uses server actions.

### Gap for combined workflow

Service is **Schichtzettel trip + confirm** scoped. No API to read/write shift actuals, km, or payroll completion state. No integration with `admin-shifts.service.ts`.

### Senior-level recommendation

Add a **single orchestration entry point** (e.g. `completeShiftReconciliation`) that validates trips + shift actuals + km in one transaction, or keep services separate but expose a composed server action for the unified page. Reuse `getAdminShiftForDriverDate` for read path before extending write path.

---

## 3. CURRENT UI

**Route:** `/dashboard/shift-reconciliations` — [`page.tsx`](../../src/app/dashboard/shift-reconciliations/page.tsx)  
**Nav:** Account section, adjacent to Fahrerschichtplanung — [`nav-config.ts`](../../src/config/nav-config.ts) **116–125** (separate URLs, no cross-links in code).

### Current state

#### 3a. Page layout

**Three URL states** (documented in [`shift-reconciliation-page-client.tsx`](../../src/features/shift-reconciliations/components/shift-reconciliation-page-client.tsx) **3–7**, [`docs/shift-reconciliations.md`](../../docs/shift-reconciliations.md) **33–37**):

| State | URL | View |
|-------|-----|------|
| A | no `driver` | Prompt: “Bitte einen Fahrer auswählen.” (**85–88**) |
| B | `?driver=<id>` | Month-grouped day list (`ShiftDayList`) |
| C | `?driver=<id>&date=YYYY-MM-DD&mode=detail` | Full-page detail (`ShiftDetailPanel`) |

**List row** ([`shift-day-list.tsx`](../../src/features/shift-reconciliations/components/shift-day-list.tsx) **99–166**):

- Day heading (e.g. `Mo, 3. Jun`)
- Fahrten gesamt, Selbstzahler sum + count, Rechnung count
- Badge: ✓ Bestätigt (with confirmer tooltip) or Nicht geprüft
- Amber dot if `unconfigured_count > 0`
- Expand inline → embeds `ShiftDetailPanel`

**Detail view** ([`shift-detail-panel.tsx`](../../src/features/shift-reconciliations/components/shift-detail-panel.tsx) **44–66**):

- `ShiftSummaryBar` — trip counts, Selbstzahler total, Rechnung count, confirmation badge (**65–100** in summary bar)
- `ShiftTripsTable` — per-trip table (**127–257** in table)
- `ShiftConfirmButton` — confirm dialog with optional notes

**Trip table columns:** Zeit, Abholung → Ziel, Kostenträger, Betrag (editable `manual_gross_price`), Zahlungsart — **130–137**.

**Actions available today:**

| Action | Present? | Where |
|--------|----------|-------|
| Confirm shift | Yes | `ShiftConfirmButton` — disabled when `alreadyConfirmed` (**69–72**) |
| Edit trip amount | Yes | Inline Betrag edit → `updateTripManualPrice` |
| Reject | **No** | — |
| Delete reconciliation | **No** | No service/UI method |
| Edit reconciliation notes after confirm | **No** | Notes only at confirm time |

Confirm success: clears `date` / `mode` URL params or collapses list row (**104–107**, **173–176**).

#### 3b. Worked hours (Beginn, Ende, Pause) or km UI?

**Not present** on the reconciliation page. No fields for shift times or any km values in any component under `shift-reconciliations/components/`.

Phase 4 **Ist-Zeit** entry lives on **Fahrerschichtplanung** (`admin-shift-entry-form.tsx` / day-plan popover) — separate route, not embedded here.

#### 3c. How admin reaches a specific reconciliation

1. Sidebar → **Schichtzettel-Abgleich**
2. Select **Fahrer** (required)
3. Either:
   - Pick **Datum** in filter → `mode=detail` full page (**61–71** in filters), or
   - Click a **day row** in the list → inline expand (**59–63**, **167–178** in day list)

**No** deep link from roster grid, trip board, or driver profile in current code.

#### 3d. Filters

| Filter | Present? |
|--------|----------|
| Driver | Yes — required select (**35–57** filters) |
| Date | Optional — picker; sets detail mode (**59–72**) |
| Date range | **No** |
| Status (confirmed / open) | **No** — only visual badges on list rows |
| Week | **No** |

List data: **all days** that have ≥1 `assigned` trip for the driver (RPC groups by Berlin date) — no pagination filter.

#### 3e. Connection to Fahrerschichtplanung

**None in code today.**

- Separate nav items (**116–125** nav-config)
- No shared components between `driver-planning/` and `shift-reconciliations/`
- No URL params linking plan grid → reconciliation detail
- Phase 4 admin shift entry does not create or open a reconciliation record

### Gap for combined workflow

Admin must use **two pages** for one paper Schichtzettel: plan/roster for Ist-Zeit, reconciliation for trips + confirm. No unified “driver X, date Y” workspace.

### Senior-level recommendation

Build a **single detail shell** (driver + date in URL) with tabs or sections: Trips | Ist-Zeit | Km | Abschluss. Reuse `ShiftDetailPanel` trip table and `AdminShiftEntryForm` as child panels; add deep link from Fahrerschichtplanung day cell (“Abgleich öffnen”).

---

## 4. TRIPS / FAHRTEN

### Current state

#### 4a. Association with reconciliation

**No FK from `trips` to `shift_reconciliations`.**

Association is **logical**, by shared keys:

- `trips.driver_id` + Berlin calendar date of `trips.scheduled_at`
- Matches `shift_reconciliations.driver_id` + `shift_reconciliations.date`

See `getTripsForShift` filters (**151–156** in service) and RPC join (**67–70** in `20260502120002_billing_type_accepts_self_payment.sql`).

#### 4b. Trip data stored / shown

**Queried for reconciliation** ([`getTripsForShift`](../../src/features/shift-reconciliations/api/shift-reconciliations.service.ts) **133–149**):

- `scheduled_at`, `pickup_address`, `dropoff_address`
- `gross_price`, `manual_gross_price`
- Payer name + `accepts_self_payment` (and billing_type tier)

**On `trips` row generally** ([`database.types.ts`](../../src/types/database.types.ts) **1462+**): includes `driving_distance_km`, `driving_duration_seconds`, addresses, pricing fields, status, etc.

**Not loaded or displayed** in reconciliation UI: distance, duration, revenue net, trip status beyond the hard-coded `assigned` filter.

#### 4c. Can admin edit individual trip values during reconciliation?

**Partially:**

- **Yes:** `manual_gross_price` (Betrag) — inline edit + clear override ([`shift-trips-table.tsx`](../../src/features/shift-reconciliations/components/shift-trips-table.tsx) **79–107**, **214–246**)
- **No:** distance, times, addresses, payer, or other trip fields from this screen

#### 4d. Typical trip count per shift

**Not defined in codebase.** RPC returns `total_trips` per day but no docs or constants describe a typical range.

**PRODUCT DECISION REQUIRED / unknown** — confirm with operations (paper Schichtzettel volume).

### Gap for combined workflow

Trip verification is **price- and payer-centric** only; km per trip and non-`assigned` trips are out of scope today.

### Senior-level recommendation

If paper journal includes per-trip km, decide whether overrides belong on `trips.driving_distance_km`, a new `manual_distance_km`, or reconciliation-only snapshots (see [`docs/plans/manual-km-audit.md`](manual-km-audit.md)). Expand status filter only after product defines which trip states belong on Schichtzettel — [`docs/shift-reconciliations.md`](../../docs/shift-reconciliations.md) **49–50**.

---

## 5. RELATIONSHIP TO `shifts` TABLE

### Current state

#### 5a. When reconciliation row is created — link to `shifts`?

**On confirm only** (not on page load or trip edit). `confirmShift`:

1. Looks up one `shifts` row (latest `started_at` in day window)
2. Stores its `id` in `shift_reconciliations.shift_id` or `NULL`

No automatic reconciliation row when a shift is created.

#### 5b. Phase 4 admin shift (`admin-shifts.service.ts`) → reconciliation?

**Does not auto-create** `shift_reconciliations`.

Admin shift entry creates/updates **`shifts` + `shift_events`** with `entered_by` ([`admin-shifts.service.ts`](../../src/features/driver-planning/api/admin-shifts.service.ts) — `createAdminShiftForDriver`, `getAdminShiftForDriverDate`). Reconciliation appears only after admin uses **Schicht bestätigen** on the reconciliation page; then `confirmShift` may attach `shift_id` if the shift row exists in the same Berlin day window.

Admin can complete Ist-Zeit on Fahrerschichtplanung and never open Schichtzettel-Abgleich — **independent workflows**.

#### 5c. Risk: shift without reconciliation / reconciliation without shift

| Scenario | Possible? | Notes |
|----------|-----------|-------|
| Shift exists, no reconciliation | **Yes** | Expected until admin confirms; common |
| Reconciliation exists, no shift | **Yes** | By design — `shift_id` nullable; migration comment **40–41** |
| Reconciliation with wrong/missing `shift_id` | **Possible** | Lookup uses latest shift by `started_at` in window; multiple shifts same day (post Phase 4 unique index: at most one per driver+Berlin date on `shifts`) |
| Admin shift (`entered_by`) not linked | **Possible** if confirm ran before shift existed | Re-confirm would refresh `shift_id` (upsert), but UI blocks re-confirm when `alreadyConfirmed` (**69–72** confirm button) |

**List view blind spot:** Days with a shift but **zero** `assigned` trips do not appear in `get_shift_day_summaries` (RPC groups from `trips` only — **46–57** in `20260502120000_get_shift_day_summaries.sql`).

### Gap for combined workflow

Two silos: payroll actuals on `shifts`, trip sign-off on `shift_reconciliations`, linked only at confirm time and not shown in UI. Days with shift but no assigned trips are invisible in reconciliation list.

### Senior-level recommendation

Unified page should **load both** `getAdminShiftForDriverDate` and trip bundle for the same `(driverId, date)`. Consider RPC or view that **FULL OUTER JOINs** shift days and trip days so admins see “shift entered, 0 trips” and “trips, no shift times”.

**PRODUCT DECISION REQUIRED:** Is confirmation allowed when Ist-Zeit is missing? Today: yes.

---

## 6. KM TRACKING — CURRENT STATE

### Current state

#### 6a. Km data in schema

**On `shift_reconciliations`:** none (§1d).

**On `shifts`** ([`database.types.ts`](../../src/types/database.types.ts) **1304–1311**):

| Column | Purpose (migration comments) |
|--------|----------------------------|
| `start_odometer` | Optional km at shift start — `20260320000000_fix_shifts_status_check.sql` **74–76** |
| `end_odometer` | Optional km at shift end — **78–80** |
| `total_distance_km` | Derived (odometer delta or sum of rides) — **82–85** |

**On `trips`:** `driving_distance_km` (Google routing / metrics pipeline) — **1494** in types.

**Not in schema:** `occupied_km`, `free_km`, or reconciliation-level km columns.

#### 6b. UI for km entry or display

| Area | Km UI? |
|------|--------|
| Schichtzettel-Abgleich | **No** |
| Fahrerschichtplanung / admin shift entry | **No** — Phase 4 writes times only; grep shows no odometer in `driver-planning/` |
| Driver portal shift forms | **No** km fields in components (grep); `shifts.service.ts` accepts `startOdometer` / `endOdometer` params (**261**, **302**) but UI does not expose them |
| Invoice builder | Displays `distance_km` from trips — unrelated to reconciliation |

#### 6c. Paper Schichtzettel km contents

**Partially documented:**

- DB comments describe **start/end odometer** and **total_distance_km** on shifts (operational mileage).
- **`occupied_km` / `free_km` (shift-level)** — **not referenced** anywhere in migrations, types, or `docs/shift-reconciliations.md`.

**PRODUCT DECISION REQUIRED:** Confirm with product owner which km fields appear on the paper Schichtzettel (Gesamt-km, Besetzt-km, Leer-km, Tachometer readings, per-trip km, etc.).

### Gap for combined workflow

Step 4 (log total / occupied / free km at shift level) has **no storage and no UI** in the reconciliation or admin-shift flows.

### Senior-level recommendation

Model km on **`shifts`** (extend columns if paper form needs occupied/free) or on **`shift_reconciliations`** if km is admin-verified separately from driver portal capture. Do not infer occupied/free from trip `driving_distance_km` without explicit product rules (return legs, empty runs).

---

## 7. GAPS FOR THE COMBINED WORKFLOW

Target workflow:

1. Admin opens reconciliation for driver X on date Y  
2. Verifies all trips are correct  
3. Confirms actual Beginn, Ende, Pause (from shifts or enters them)  
4. Logs km data (total, occupied, free — shift level)  
5. Marks reconciliation as fully **Abgeschlossen**  
6. Feeds monthly **Monatsübersicht** / payroll summary  

### Step-by-step assessment

| Step | Status | Evidence |
|------|--------|----------|
| **1. Open reconciliation (driver X, date Y)** | **Partially supported** | Driver + date via list expand or date picker + `mode=detail` (**filters**, **day-list**). No link from Fahrerschichtplanung; days without assigned trips absent from list. |
| **2. Verify trips** | **Partially supported** | Trip table + Selbstzahler/Rechnung badges + manual gross edit. Only `status = 'assigned'` (**constants.ts** **2**, service **153**). No per-trip km/time edit; missing trip states excluded. |
| **3. Beginn, Ende, Pause** | **Missing on reconciliation page** | Stored in `shifts` / `shift_events`; editable via Phase 4 on **Fahrerschichtplanung** only. Reconciliation service does not read or display shift times. |
| **4. Log km (total, occupied, free)** | **Missing** | No schema fields for occupied/free; odometer on `shifts` unused in admin UI; reconciliation has no km. |
| **5. Mark Abgeschlossen** | **Partially supported** | “Schicht bestätigen” upserts reconciliation (**confirmShift**). No `Abgeschlossen` enum; no reject; UI prevents second confirm but DB upsert could overwrite if called directly. Not a gated checklist (trips + times + km). |
| **6. Monatsübersicht / payroll summary** | **Missing** | No feature tying `shift_reconciliations` + shift actuals + km into a monthly payroll export. Controlling RPCs (`get_controlling_*`) aggregate trips/revenue/km separately — **not** wired to reconciliation completion. Docs mention payroll export as **deferred** (`driver-planning` Phase 4 ships Ist-Zeit entry only). |

### Senior-level recommendation (combined page)

1. **Single route** — e.g. `/dashboard/shift-reconciliations?driver=&date=&mode=detail` enhanced, or new `/dashboard/schicht-abschluss` — compose existing panels rather than rewriting trip logic.  
2. **Read model** — parallel fetch: `getTripsForShift`, `getReconciliation`, `getAdminShiftForDriverDate` (add km fields when schema exists).  
3. **Write model** — one “Abschließen” action that: validates required sections → upserts shift actuals (if edited) → upserts reconciliation with optional `status = completed` → invalidates list RPC.  
4. **Monthly roll-up** — new RPC or materialized view: per driver/month, sum reconciled days, paid hours from `shift_events`, km from `shifts`, Selbstzahler totals from trips; export CSV for payroll.  
5. **Do not** conflate `confirmShift` today with payroll closure until product defines prerequisites (all trips assigned? Ist-Zeit required? km required?).

**PRODUCT DECISION REQUIRED (summary):**

- Required fields before “Abgeschlossen”  
- Reopen / amend after confirm  
- Paper Schichtzettel km field list (occupied/free vs odometer only)  
- Whether Monatsübersicht is reconciliation-driven or shift-driven  
- Include non-`assigned` trips on Schichtzettel  

---

## Cross-references in `docs/plans/`

Files referencing `shift_reconciliations` (non-exhaustive):  
`admin-shift-entry-audit.md`, `driver-planning-module-audit.md`, `driver-planning-ux-gaps-audit.md`, `schichtzettel-audit.md`, `schichtzettel-shifts-audit.md`, `schichtzettel_reconciliation_62d52044.plan.md`, `reporting-audit.md`, `rbac-audit.md`, `timezone-bug-audit-v2.md`, `driver-planning-upsert-fetch-audit.md`.

**Canonical product doc:** [`docs/shift-reconciliations.md`](../../docs/shift-reconciliations.md)
