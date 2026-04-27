# Shifts Table — Deep-Dive Audit (Read-Only)

Focus: what **`public.shifts`** is today, lifecycle, relationships, consumers, and whether it is a good home for **admin Schichtzettel reconciliation** metadata.

**Migrations that reference `shifts` (grep of `supabase/migrations/*.sql`):**

| File | Role |
|------|------|
| `20260320000000_fix_shifts_status_check.sql` | `shifts_status_check`, comments on `shifts` / `shift_events` |
| `20260319100000_add_shifts_shift_events_rls.sql` | RLS on `shifts` and `shift_events` |
| `20260319110000_fix_shift_events_event_type_check.sql` | `shift_events` event_type CHECK (no `shifts` table DDL) |
| `20260318130000_rename_users_to_accounts.sql` | Comment only: FKs “trips, **shifts**, etc.” — **line 3** |

The repo migrations **do not include** a `CREATE TABLE public.shifts` (table likely predates or lives outside the tracked set); **behaviour and comments** below come from the migrations above, **`src/types/database.types.ts`**, and **`src/features/driver-portal/`**.

---

## What is a "shift" in this system?

### 1. What is the lifecycle of a `shifts` row — who creates it, who updates it, and who reads it? Is it created by the admin, the driver, or the system automatically?

**Answer:** Rows are **created and updated by the driver** (via the **driver portal** and **`shiftsService`**). There is **no** application code that auto-creates a shift when a dispatcher assigns a trip. **Admins** have **RLS `SELECT` only** for company shifts (no insert/update in the policy set shown — see Q8).

**Real-time path:** `shiftsService.startShift` **INSERTs** a row with `status: 'active'` — `src/features/driver-portal/api/shifts.service.ts` **253–264**. The driver triggers this from **`ShiftStatusCard.handleStartShift`** — `src/features/driver-portal/components/startseite/shift-status-card.tsx` **165–176**. **Pause / resume / end** call `startBreak`, `endBreak`, `endShift` which **UPDATE** the row — `shifts.service.ts` **297–309**, **334–339**, **364–368**.

**Manual path (Schichtenzettel / Zeiterfassung):** `createManualShift` **INSERTs** a row with `status: 'ended'` immediately and appends `shift_events` — `shifts.service.ts` **186–196**, **201–234**. Submitted from **`ShiftTimeForm`** — `src/features/driver-portal/components/shift-time-form.tsx` **229–236**, **256–272** (with duplicate-day overwrite via **`deleteShift`** **220–221**).

**Readers:** the **same driver** (history, active shift) and, per RLS, **company admins** for **read** — `supabase/migrations/20260319100000_add_shifts_shift_events_rls.sql` **31–36** (`shifts_select_company_admin`).

**DB comment (intent):** “One row per **driver working day**” — `supabase/migrations/20260320000000_fix_shifts_status_check.sql` **27–32**.

---

### 2. What does `shifts.status` represent (`active`, `on_break`, `ended`)? Who transitions between these states and how (UI action, API call, automatic trigger)?

**Answer:** **`CHECK` constraint:** `status IN ('active', 'on_break', 'ended')` — `supabase/migrations/20260320000000_fix_shifts_status_check.sql` **18–21**. Constants in app: **`SHIFT_STATUSES`** — `src/features/driver-portal/types.ts` **22–27**.

| Value | Meaning (DB comment) | Transition |
|--------|----------------------|------------|
| `active` | Shift running | After **Schicht starten** (insert) or **Pause beenden** (update) — `shifts.service.ts` **260**, **366–368**; **`ShiftStatusCard`** / **`shift-status-card.tsx` **350–352** (doc) |
| `on_break` | Break | **Pause starten** — `shifts.service.ts` **334–339**; **`shift-status-card.tsx` **188–199** |
| `ended` | Completed | **Schicht beenden** — `endShift` **297–305**; **manual** insert already **`ended`** — **186–195** |

**Manual Schichtenzettel** rows: inserted **`ended`** only — **no** `active` / `on_break` transition — `supabase/migrations/20260320000000_fix_shifts_status_check.sql` **61–62**; `createManualShift` **192–194**.

State changes are **driver UI → `shiftsService` → Postgrest**; **no** DB trigger for status transitions was found in the listed migrations.

---

### 3. Is a `shifts` row always tied to exactly one driver + one calendar day? Or can a shift span multiple days, or can a driver have multiple shifts per day?

**Answer:** **Driver:** every row has **`driver_id`** (FK to `accounts`) — `src/types/database.types.ts` **1055**, **1102–1107**; inserts always set `driver_id` — `shifts.service.ts` **189**, **256**.

**Calendar day (product / duplicate logic):** **`getShiftForDriverByDate`** filters `started_at` between **UTC day bounds** for a given `YYYY-MM-DD` — `shifts.service.ts` **123–139**. **`ShiftTimeForm`** blocks duplicate day unless user confirms **overwrite** — `shift-time-form.tsx` **262–271**, **220–222**. So **at most one stored shift per driver per local-form date** in the manual flow after overwrite. The **DB** does not enforce a unique `(driver_id, date)` constraint in the files reviewed.

**“One row per driver working day”** is the **documented** intent — `20260320000000_fix_shifts_status_check.sql` **27–28** — but a driver could in theory have **multiple** shifts across **different** real-time start/end sessions on different days, or edge cases (e.g. long **started_at**–**ended_at** span) not prevented by a simple grep of migrations.

**Multi-day span:** not forbidden by the `CHECK` on `status` alone; **manual** form ties start/end to **one `date` string** — `createManualShift` **179–184** (same `params.date` for start/end). Real-time **end** sets **`ended_at: now`** on end action — `shifts.service.ts` **288**, **300–301**.

---

### 4. Is `shifts.total_earnings` already calculated from trips? If yes, how — is it a generated column, a trigger, or computed in application code? What does it include?

**Answer:** **Not populated in application code** in this repo. **`shiftsService`** never reads or writes **`total_earnings`** (search of `shifts.service.ts`).

**Database documentation:** “Total earnings (€) for this shift, **summed from associated rides**. NULL until calculated.” — `supabase/migrations/20260320000000_fix_shifts_status_check.sql` **87–89**. **`total_distance_km`** is similarly “Derived from end_odometer - start_odometer, **or from summing rides**” — **82–85**.

**TypeScript:** `total_earnings: number | null` on `shifts` Row — `src/types/database.types.ts` **1062–1063**, **1076–1077**. **No** generated-column migration for `shifts` appears in the grep’d migrations. **No** `src/**` query uses **`from('rides')`**.

**Conclusion:** **Intended** to relate to **`rides`**, but **no** implemented backfill/sum was found in **TS**; values stay **NULL** unless set elsewhere (SQL job, Studio, or future code).

---

## Relationship between shifts and trips

### 5. Is there a direct FK between `trips` and `shifts`? Or are they only linked indirectly (e.g. via `driver_id` + date range)?

**Answer:** **Product contract in code:** **`trips.shift_id`** is written when the driver starts a tour — `src/features/driver-portal/api/driver-trips.service.ts` **127–131**, **152–158** (best-effort second `update`).

**Generated types note:** the **`trips` `Row` block** in `src/types/database.types.ts` (**lines 1160–1231** in the current file) **does not list `shift_id`**, so the **checked-in** types may be **stale** relative to runtime. **`DriverTrip`** explicitly includes **`shift_id`** — `src/features/driver-portal/types/trips.types.ts` **52–53**.

**Indirect link** always possible: same **`driver_id`** on trip and shift, plus time overlap, without using **`trips.shift_id`**.

**Direct FK in DB:** not present in the migrations under `supabase/migrations` (no `ALTER TABLE trips ADD ... shift_id` in grep results for this repo).

---

### 6. Does the `rides` table bridge `shifts` and `trips`? If yes, describe the full relationship.

**Answer:** **`rides`** has **`shift_id` → `shifts.id`** — `src/types/database.types.ts` **933**, **997–1002** (`rides_shift_id_fkey`). **`rides`** is a **separate** entity from **`trips`** in the type graph (own `rides` table with `fare_amount`, `status`, etc. — **915–936**). **This codebase does not query `rides` in `src/**`** (grep found **no** `from('rides')`).

**Trip ↔ shift in the app** is **`trips.shift_id`** (see Q5 and **`driver-trips.service.ts` **152–158**), **not** a join through `rides`.

---

### 7. When a dispatcher assigns trips to a driver, does a `shifts` row get created automatically? Or are shifts managed separately from trip assignment?

**Answer:** **No automatic creation** from dispatcher assignment. Shifts are **only** created from **driver** actions (`startShift`, `createManualShift`) in **`shifts.service.ts`**. **Trip assignment** is the **admin/dispatch** domain; **`driver_trip` start** only **links** an existing active shift to a trip when the driver starts the tour.

---

## Who uses shifts — admin or driver?

### 8. Is the `shifts` table read or written by the admin dashboard (any file under `src/app/dashboard/`)? Or is it exclusively used in the driver portal (`src/app/driver/`)?

**Answer:** **No** `shifts` / `shiftsService` / `.from('shifts')` usage under **`src/app/dashboard/`** (grep: **0** matches). **All** application usage found is under **`src/features/driver-portal/`** (and the **`driver` app** routes that render those components). **RLS** allows **admins to SELECT** company shifts — `20260319100000_add_shifts_shift_events_rls.sql` **31–36** — but there is **no** dashboard page wired to that in the search performed.

**Admin vs driver write access (doc):** `docs/access-control.md` **52**: drivers **“Full CRUD own”** on `shifts` / `shift_events`, admins **“SELECT in company”** (matches policies: no admin `INSERT/UPDATE/DELETE` on `shifts` in **`20260319100000_...sql`**).

---

### 9. Is there any existing admin-facing UI that shows shift data? If yes, describe it and point to the file.

**Answer:** **Not in the admin dashboard** — no component under **`src/app/dashboard/`** or **`src/features/`** outside **`driver-portal`** was found that queries **`shifts`**.

**Driver-facing UI** for shift data: **`/driver/startseite`** (**`ShiftStatusCard`**) — `src/app/driver/startseite/page.tsx` **10** + **`startseite/startseite-page-content.tsx`** (referenced from **`docs/driver-portal.md` **16–18**); **`/driver/shift`** (**`ShiftTimeForm`**, **`ShiftHistoryList`**) — `src/app/driver/shift/page.tsx` **7–14**, **`driver-shift-page-content.tsx` **17–20**.

---

### 10. Is `shifts.total_earnings` or any shift summary currently shown to the admin anywhere?

**Answer:** **No** admin UI references **`total_earnings`**. **Driver** shift history shows **worked duration** derived from **`started_at` / `ended_at` / `shift_events`**, not **`total_earnings`** — `src/features/driver-portal/components/shift-history-row.tsx` **41–65**, **108–110** (uses **`computeWorkedMinutes`**, no `total_earnings` field).

---

## Can we extend shifts for reconciliation?

### 11. If we added columns `reconciled_by uuid`, `reconciled_at timestamptz`, and `reconciliation_notes text` to `shifts` — would that conflict with any existing query, type, or UI that selects all columns from `shifts`? List every `select('*')` or equivalent on `shifts`.

**Answer:** **Extra columns are safe for PostgREST** (they return on `*`). **TypeScript** would need **regenerated** or extended **`Database['public']['Tables']['shifts']`** — `src/features/driver-portal/types.ts` **42** (`Shift` = `shifts` Row). **UI** that spreads the row does not obviously **reject** unknown keys, but any **export** of full row to JSON is rare.

**Explicit `select('*')` (and equivalent “all columns”) on `shifts` in `shifts.service.ts`:**

| Lines | Pattern |
|-------|---------|
| **37–44** | `.select('*')` — `getActiveShift` |
| **65–74** | `.select(\`*, shift_events (...)\`)` — `getShiftsWithEvents` |
| **101–104** | `.select('*')` — `getShiftsForDriver` |
| **131–133** | `.select('*')` — `getShiftForDriverByDate` |
| **196–197** | `.insert({...}).select().single()` — `createManualShift` (returns full row) |
| **253–264** | `.insert({...}).select().single()` — `startShift` |
| **297–305** | `.update({...}).select().single()` — `endShift` |
| **335–339** | `.update({...}).select().single()` — `startBreak` |
| **365–368** | `.update({...}).select().single()` — `endBreak` |

**Risk:** new nullable columns are **inert** for existing clients; **non-null** without defaults would break **insert** payloads that omit them — not applicable to the proposed nullable reconciliation fields if defined nullable.

**RLS note:** if **`reconciled_by`** is written **only by admin**, the current RLS has **no** `UPDATE` policy for admins on **`shifts`** — **`20260319100000_...sql`** only **`shifts_select_company_admin`**. Storing admin-written reconciliation on **`shifts`** would require **new policies** (or a **server/service-role** path), which is a **policy** conflict rather than a **select-*** conflict.

---

### 12. Is `shifts` the right semantic owner of "an admin has checked the Schichtzettel for this driver on this day"? Or does the existing `shifts` concept belong to the driver's operational domain (start/stop/break) in a way that makes reconciliation feel like a foreign concern?

**Answer:** In this codebase, **`shifts` is solidly the driver’s operational / time-recording object**: created by the **driver** (real-time or manual Schichtenzettel), updated by the **driver**, with **admin read-only** access and **no** admin UI. The **Schichtenzettel** name in the **UI** refers to **driver** manual time entry — `src/app/driver/shift/page.tsx` **3–4**, **`docs/driver-portal.md` **19**, **88–89**.

**Admin “Schichtzettel reconciliation”** (dispatcher reviewing **trips** / cash vs invoice for a **date**) targets **accounting and trips**, not the same lifecycle as **clock-in/out**. A shift row may also **not exist** for a day when the driver only runs tours without using the shift tracker; reconciliation might still be required. Those facts argue that **reconciliation is a separate concern** from **`shifts` as implemented**.

---

## Extend vs. Separate — Senior Recommendation

**Prefer a separate table (e.g. `schichtzettel_confirmations` or `driver_shift_reconciliations`)** with **`driver_id`**, **`shift_date` (or `business_date`)**, **`reconciled_by`**, **`reconciled_at`**, **`notes`**, and optionally **`company_id`**, rather than adding reconciliation columns to **`shifts`**.

**Reasons:** (1) **`shifts` is driver-owned in practice** (CRUD for drivers, admin SELECT only per **`20260319100000_add_shifts_shift_events_rls.sql`** and **`docs/access-control.md` **47–52**), so **admin** reconciliation metadata does not map cleanly to RLS and ownership. (2) Reconciliation is **per dispatcher workflow on trips for a day**, while **`shifts`** is ** time tracking** that may be **absent** or **duplicated** relative to the business day you reconcile — see **`shifts` comment** one row per “driver working day” **vs** manual duplicate handling in **`shift-time-form.tsx` **262–271**. (3) **`total_earnings` on `shifts` is not computed in app** and **`rides` is unused in TS**; tying finance reconciliation to **`shifts` would mix a dormant earnings column with a new admin process. A **narrow table** linking **`company_id` + `driver_id` + date + admin audit** keeps the driver’s shift model **stable** and avoids widening **`select('*')` rows in `shifts.service.ts` **35–48** with fields drivers must never set.

**If you must attach to a shift:** only when the product **guarantees** a 1:1 between “reconciled day” and a **`shifts` row** *and* you add **admin UPDATE** policies or **RPC**; still evaluate **separate table** first for clearer semantics and fewer side effects on **`driver-portal`**.

---

## Plan Status

**2026-04-28 (implemented).** Reconciliation is stored in **`shift_reconciliations`** (not on `shifts`); `confirmShift` in `shift-reconciliations.service.ts` only **links** `shift_id` when a `shifts` row exists in the business-day window—otherwise the row is `null` and confirmation still succeeds. See `docs/shift-reconciliations.md`.

---

*End of audit document.*
