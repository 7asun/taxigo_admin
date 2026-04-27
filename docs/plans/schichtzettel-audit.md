no# Schichtzettel Reconciliation — Read-Only Audit

Audit date: 2026-04-27. Scope: current Supabase schema (migrations + generated `database.types.ts`), RLS, and app structure as present in the repo. The application router lives under **`src/app/`** (not a top-level `app/` folder).

**Docs folder:** The repository’s `docs/` tree contains **94** Markdown files (see glob of `docs/**/*`), including: **access** (`access-control.md`), **navigation** (`navigation.md`), **KTS** (`kts-architecture.md`), **trip status** (`trip-status-helper.md`), **Supabase** (`SUPABASE_INTEGRATION.md`), **query/RSC** (`server-state-query.md`, `trips-page-rsc-refresh.md`), **drivers** (`driver-system.md`, `driver-portal.md`), and many `plans/*` audit/plan documents. The **schema and RLS answers below** are taken from **Supabase migrations** and **`src/types/database.types.ts`** so they stay aligned with the database; app-structure answers are from **`src/app/`** and **`src/config/`**.

---

## Payers

### 1. What columns currently exist on the `payers` table? List all column names and types.

**Direct answer:** The canonical column set is the union of **`public.payers` in `src/types/database.types.ts`** and **follow-on migrations**; the **generated `Row` type for `payers` in `database.types.ts` is incomplete** (it omits several columns that migrations add and that the app selects — see `payers.service.ts`).

**Authoritative `Row` shape in the repo (partial — missing columns):** `id` (string), `company_id` (string), `created_at` (string), `kts_default` (boolean \| null), `name` (string), `no_invoice_required_default` (boolean \| null), `number` (string in types — **see Q1 note**), `rechnungsempfaenger_id` (string \| null).  
**Source:** `src/types/database.types.ts` lines **601–611** (`payers.Row`).

**Columns documented in migrations but missing from the snippet above (must be present in a fully migrated DB):**

| Column | SQL type (migration) | Source |
|--------|----------------------|--------|
| `street`, `street_number`, `zip_code`, `city`, `contact_person`, `email`, `phone` | `TEXT` (nullable) | `supabase/migrations/20260331100000_add_address_fields_to_payers.sql` **15–21** |
| `default_intro_block_id`, `default_outro_block_id` | `UUID` (FK, nullable) | `supabase/migrations/20260401190000_create_invoice_text_blocks.sql` **100–106** |
| `kts_default` | `boolean` default NULL | `supabase/migrations/20260403120000_kts_catalog_and_trips.sql` **4–5** |
| `no_invoice_required_default` | `boolean` default NULL | `supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql` **10–11** |
| `rechnungsempfaenger_id` | `uuid` (FK, nullable) | `supabase/migrations/20260405100002_catalog_recipient_fks.sql` **5–7** |
| `pdf_vorlage_id` | `uuid` (FK, nullable) | `supabase/migrations/20260408120001_pdf_vorlagen.sql` **76–78** |
| `number` | converted to **`INTEGER`**, `NOT NULL`, unique per `(company_id, number)` | `supabase/migrations/05-kundennummer-system.sql` **69–88**, **177–178** |

**App usage confirms extra columns exist at runtime:** e.g. `payers` select includes `kts_default`, `no_invoice_required_default`, `rechnungsempfaenger_id`, `pdf_vorlage_id` — `src/features/payers/api/payers.service.ts` **44–47**.

**Note on `number` type drift:** Migrations and comments describe **`payers.number` as `INTEGER`**. `src/types/database.types.ts` still types **`number` as `string`** on `payers.Row` (**line 609**), while `PayersService.createPayer` accepts `number: string` (**payers.service.ts** **59–72**). Treat generated types as **possibly stale** for this column.

---

### 2. Is there already any boolean or payment-type field on `payers`? If yes, what is it called and what does it represent?

**Direct answer:** On **`payers` itself** there is **no column named for “payment type”** (e.g. cash vs invoice). There **are** nullable booleans with related semantics:

- **`kts_default`** — “NULL = unset (inherit). TRUE/FALSE = default KTS applies…” — `supabase/migrations/20260403120000_kts_catalog_and_trips.sql` **5–8**.
- **`no_invoice_required_default`** — “TRUE = default keine Rechnung für Fahrten mit diesem Kostenträger. NULL = unset (vererben).” — `supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql` **10–14**.

**Types:** `kts_default`, `no_invoice_required_default` on `payers.Row` — `src/types/database.types.ts` **606–608**.

Payment/collection behaviour for trips is also expressed on **`trips`** (e.g. `no_invoice_required`, `payment_method`, `selbstzahler_collected_amount`, billing joins), not as a single “payment type” column on `payers`.

---

### 3. What RLS policies exist on the `payers` table? Are there insert/update policies for authenticated admin users?

**Direct answer:** RLS is **enabled** on `payers`. There is **one** policy, **`payers_company_admin`**, using **`FOR ALL`**, for role **`authenticated`**, with **`USING` / `WITH CHECK`** requiring **`current_user_is_admin()`** and **`company_id = current_user_company_id()`**.  
**`FOR ALL` includes `SELECT`, `INSERT`, `UPDATE`, and `DELETE`** for rows in the user’s company when the account is an admin.

**Source:** `supabase/migrations/20260409170000_add_missing_rls.sql` **72–84** (also **74** `ENABLE ROW LEVEL SECURITY`).

Helper definitions for `current_user_is_admin` / `current_user_company_id` — `supabase/migrations/20260409180000_fix_rls_helper_recursion.sql` **16–36**.

---

## Trips

### 4. What columns currently exist on the `trips` table? List all column names and types.

**Direct answer:** Use **`public.trips` `Row` in `src/types/database.types.ts`** as the **complete typed list** for the app (string types map to Postgres `text`/`timestamptz`/`uuid` as usual; numerics as `number`).

**Source:** `src/types/database.types.ts` **`trips` `Row` block** — lines **1161–1231** (and `Insert`/`Update` through **~1363**; note **`net_price` is not in `Insert`/`Update`** because it is generated — see Q8–Q9 and migration in Q4 note).

**Additional schema notes from migrations (same table):**

- **`base_net_price`**, **`approach_fee_net`** — `numeric(10,4)` — `supabase/migrations/20260424100000_add_trip_price_split.sql` **3–5**.
- **`manual_gross_price`** — `numeric(12,4)` nullable — `supabase/migrations/20260423100000_add_trip_manual_gross_price.sql` **1–2**.
- **`net_price`** — **dropped and re-added as a `GENERATED STORED` column** (read-only in app writes) — `supabase/migrations/20260425120000_net_price_generated.sql` **18–24**.
- **`gross_price`** — **`numeric`** added in price-schema migration — `supabase/migrations/20260418120000_trips-price-schema.sql` **8**, **17**.

**Trips RLS and policies** — see Q9; migration header summarises admin vs driver access — `supabase/migrations/20260409170000_add_missing_rls.sql` **13–14**.

---

### 5. How is the driver linked to a trip — is there a `driver_id` foreign key, or is it via another relation?

**Direct answer:** **Primary link:** `trips.driver_id` **FK → `public.accounts`**, relationship name `trips_driver_id_fkey` — `src/types/database.types.ts` **1401–1406**.

**Additional relation:** **`trip_assignments`** links trips to drivers (and has its own `driver_id`, `trip_id`, `status`) — `src/types/database.types.ts` **1118–1157**; RLS for assignments — `supabase/migrations/20260409190000_fix_trip_assignments_rls_loop.sql` (policies referenced in grep; file not fully quoted here).

**Driver RLS for trips** also allows access when a row exists in **`trip_assignments`** for `auth.uid()` — `supabase/migrations/20260409170000_add_missing_rls.sql` **44–51** (`trips_select_own_driver`).

---

### 6. How is the payer linked to a trip — is there a `payer_id` foreign key directly on `trips`, or via an intermediate table?

**Direct answer:** **Direct FK:** `trips.payer_id` → `payers.id` (`trips_payer_id_fkey`) — `src/types/database.types.ts` **1205**, **1422–1427**.

**Indirect context:** `billing_type_id` / `billing_variant_id` relate to the billing catalog (families/variants under payers) — same `trips` Row and Relationships block — **lines 1166–1167, 1214**, **1365–1371**.

---

### 7. What values does the `status` column on `trips` accept? Which status value represents an assigned (but not yet completed) trip?

**Direct answer (application contract):** The **`TripStatus` union and comments** in `src/lib/trip-status.ts` list values kept in sync with **`trips.status`**: `completed`, `assigned`, `scheduled`, `in_progress`, `driving`, `cancelled`, `pending`, `open` — **lines 31–39**, with semantics **20–30**.

**Filter options (admin UI)** for the Fahrten table align with: `pending`, `assigned`, `in_progress`, `completed`, `cancelled` — `src/features/trips/components/trips-tables/columns.tsx` **47–52**.

**Assigned but not completed:** The value **`assigned`** is documented as the dispatcher-assigned state — `src/lib/trip-status.ts` **22** (“dispatcher has assigned a driver (admin flow)”). The helper **`getStatusWhenDriverChanges`** sets **`pending` → `assigned`** when a driver is set — `src/features/trips/lib/trip-status.ts` **16–17**; see also `docs/trip-status-helper.md` **17–21**.

**Database enforcement:** No `CHECK` constraint on `public.trips.status` was found in the sampled migrations; **validity is primarily application-side** (plus any DB constraints not grep-matched in this audit).

---

### 8. Does `gross_price` exist on `trips`? What is its type (numeric, integer, text)?

**Direct answer:** **Yes.** PostgreSQL: **`numeric`** — `supabase/migrations/20260418120000_trips-price-schema.sql` **8**, **17**. **TypeScript:** `gross_price: number | null` on `trips.Row` — `src/types/database.types.ts` **1217–1218**.

---

### 9. What RLS policies exist on the `trips` table? Specifically: can an authenticated admin user update a single trip row (for the inline gross_price edit)?

**Direct answer:** **Policies (authenticated):**

| Policy | Operation | Key condition |
|--------|-----------|----------------|
| `trips_select_company_admin` | `SELECT` | `current_user_is_admin()` and `company_id = current_user_company_id()` | `20260409170000_add_missing_rls.sql` **16–20** |
| `trips_insert_company_admin` | `INSERT` | same + `WITH CHECK` | **22–27** |
| `trips_update_company_admin` | `UPDATE` | `USING` and `WITH CHECK` same as above | **28–37** |
| `trips_delete_company_admin` | `DELETE` | same `USING` | **38–42** |
| `trips_select_own_driver` | `SELECT` | `driver_id = auth.uid()` OR `trip_assignments` match | **44–51** |
| `trips_update_own_driver` | `UPDATE` | `driver_id = auth.uid()` (WITH CHECK enforces) | **53–56** (reaffirmed in `20260409180000_fix_rls_helper_recursion.sql` **42–55**) |

**Can an admin update one trip row?** **Yes**, under **`trips_update_company_admin`**, provided **`company_id` matches** the admin’s company and **`current_user_is_admin()`** is true — **16–36** in `20260409170000_add_missing_rls.sql`.

**Caveat for writes:** **`net_price` must not be written**; it is **generated** — `supabase/migrations/20260425120000_net_price_generated.sql` **18–24**, comments **26–28**. App pricing updates often go through **`tripsService.updateTrip`** which may recompute price fields — `src/features/trips/api/trips.service.ts` **62–100**.

---

## New table (shift confirmation / audit)

### 10. Does any table currently exist that tracks shift confirmations or any per-driver per-day audit record? If yes, describe it fully.

**Direct answer:** There is **no** table in **`src/types/database.types.ts`** named for “Schichtzettel reconciliation” or “shift **confirmation**” audit. The closest existing concepts are:

**`shifts` — one row per driver working shift (operational, not admin reconciliation).** Columns in types: `company_id`, `created_at`, `driver_id`, `end_odometer`, `ended_at`, `id`, `start_odometer`, `started_at`, `status`, `total_distance_km`, `total_earnings`, `vehicle_id` — `src/types/database.types.ts` **1051–1064**. **Status** allowed values: `'active' | 'on_break' | 'ended'` — `supabase/migrations/20260320000000_fix_shifts_status_check.sql` **18–21**. Comments describe manual “Schichtenzettel” entry — **28–32**, **61–62**.

**`shift_events` — event log for a shift** (`event_type`, `shift_id`, `timestamp`, `lat`, `lng`, `metadata`, etc.) — `src/types/database.types.ts` **1013–1021**; RLS in `supabase/migrations/20260319100000_add_shifts_shift_events_rls.sql`.

**`rides` — can reference `shift_id`** — `src/types/database.types.ts` **915–936** and FK to `shifts` **997–1002**.

**Conclusion:** These support **shift lifecycle / earnings / portal flows**, not an **admin “reconcile Schichtzettel vs trips” signed-off audit** table. No such table appears in the generated **`Tables`** list in `database.types.ts`.

---

## App structure

### 11. What is the exact folder structure under `app/`? List all route folders (one level deep is enough).

**Direct answer:** The Next.js App Router in this project is under **`src/app/`** (not `app/` at repo root). **Top-level entries:**

- `about/`
- `api/`
- `auth/`
- `dashboard/`
- `driver/`
- `privacy-policy/`
- `terms-of-service/`
- plus root files: `favicon.ico`, `global-error.tsx`, `layout.tsx`, `not-found.tsx`, `page.tsx`

**Source:** `ls` on `src/app` (filesystem), 2026-04-27.

---

### 12. Where is the main navigation defined? What are the current nav items and their routes?

**Direct answer:** Main nav is **`export const navItems`** in **`src/config/nav-config.ts`**.

| Top-level | `url` | Sub-items (title → url) |
|-----------|--------|-------------------------|
| Dashboard | `/dashboard/overview` | — |
| Fahrten | `/dashboard/trips` | — |
| Regelfahrten | `/dashboard/regelfahrten` | — |
| Abrechnung | `#` | Rechnungen → `/dashboard/invoices`; Angebote → `/dashboard/angebote`; Rechnungsempfänger → `/dashboard/abrechnung/rechnungsempfaenger`; Preisregeln → `/dashboard/abrechnung/preise`; Vorlagen → `/dashboard/abrechnung/vorlagen`; Angebotsvorlagen → `/dashboard/abrechnung/angebot-vorlagen` |
| Account | `#` | Fahrgäste → `/dashboard/clients`; Fahrer → `/dashboard/drivers`; Kostenträger → `/dashboard/payers`; Fremdfirmen → `/dashboard/fremdfirmen` |
| Einstellungen | `#` | Unternehmen → `/dashboard/settings/company`; Unzugeordnete Fahrten → `/dashboard/settings/unzugeordnete-fahrten` |
| Dokumentation | `/dashboard/documentation` | — |

**Source:** `src/config/nav-config.ts` **25–149**.

---

### 13. Is there an existing driver list or driver detail page? If yes, what is its route?

**Direct answer:** **Driver list (admin):** **`/dashboard/drivers`** — `src/config/nav-config.ts` **102–105**; page **`src/app/dashboard/drivers/page.tsx`** (title “Fahrer”, table or column view).

**Driver detail page:** **No** dedicated `[id]` route under `src/app/dashboard/drivers/` was found in the app tree (only `page.tsx` at `dashboard/drivers`).

**Driver (non-admin) area:** `src/app/driver/` includes e.g. **`driver/startseite`**, **`driver/touren`**, **`driver/shift`** (files from glob) — separate from the admin driver management page.

---

### 14. What is the existing pattern for a data-fetching page — does the codebase use React Query (`useQuery`) directly in page components, or via custom hooks in a `hooks/` folder, or server components with direct Supabase calls?

**Direct answer:** **Patterns are mixed by surface:**

- **Fahrten list / Kanban:** **Async Server Component** fetches with **`createClient()` from `@/lib/supabase/server`** in **`src/features/trips/components/trips-listing.tsx`** (e.g. **43–100** `supabase.from('trips').select(...)`). Parent page: **`src/app/dashboard/trips/page.tsx`** wraps it in `Suspense` — **25–40**.

- **Trip detail (sheet):** **TanStack Query** — `useQuery` / `tripKeys` — documented in **`docs/server-state-query.md`**, implementation under **`src/features/trips/hooks/`** and **`trip-detail-sheet/`** (per doc **8–10**, **24–26**).

- **3-tier Supabase standard** (service → hook → view) is documented in **`docs/SUPABASE_INTEGRATION.md`**, with hooks in **`src/features/.../hooks/`** **44–50**.

- **Kostenträger reference data:** `usePayers` / `useDriversQuery` etc. — e.g. **`src/features/payers/hooks/use-payers.ts`**, **`src/features/trips/hooks/use-trip-reference-queries.ts`**.

**Conclusion:** **List pages** often use **RSC + server Supabase**; **interactive panes and detail views** use **React Query and hooks**; after mutations, **`router.refresh()`** may sync RSC data — see **`docs/server-state-query.md` **22–26**.

---

### 15. Is there an existing inline-edit pattern in the codebase (any table cell or field that can be edited in place)? If yes, point to the file where it is implemented — we want to reuse that pattern exactly.

**Direct answer:** **Closest match for “data table cell that updates a trip in place”:** **`DriverSelectCell`** — `src/features/trips/components/trips-tables/driver-select-cell.tsx` (uses **`Select`**, local loading state, **`getStatusWhenDriverChanges`**, `createClient` **`.from('trips').update`**, and **`useTripsRscRefresh`**) — **1–100+**.

**Note:** The **`gross_price`** column in the Fahrten table is **display-only** (formatted currency, no edit control) — `src/features/trips/components/trips-tables/columns.tsx` **281–293**.

**Other inline / in-row editing (different domains):** invoice builder **gross/approach** inline edit — **`src/features/invoices/components/invoice-builder/step-3-line-items.tsx`** (e.g. `beginEditing` / `commitEdit` / blur handling) **~179–270**; **client price tags** list toggles to input — **`src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx` **~430–460**.

**Recommendation for “reuse exactly” for trip row price:** There is **no** existing **inline `gross_price` cell** on the trips table; the **driver** cell pattern in **`driver-select-cell.tsx`** is the closest table-level precedent.

---

## Senior recommendation

- **`database.types.ts` vs migrations:** `payers` in generated types is **missing columns** the app and migrations use (`street`, `pdf_vorlage_id`, etc.) and may **mis-type** `payers.number` (integer in DB, string in types). **Regenerate** Supabase types after implementation work, or **narrow types** in feature code to avoid silent drift.
- **Writing trip prices:** **`net_price` is read-only in SQL**; **`tripsService.updateTrip`** may **recompute** pricing when `shouldRecalculatePrice` is true — coordinate Schichtzettel “override” with **manual_gross_price** / engine rules in **`src/features/trips/lib/trip-price-engine.ts`** and **trips.service.ts** to avoid double intent.
- **Status semantics:** **`assigned` vs `scheduled`** and legacy **`open` / `driving`** exist in `TripStatus` — filter and reconciliation queries should **document which status set** means “on this shift” for the product (see **`src/lib/trip-status.ts` **20–30**).
- **RLS is sufficient for admin update** on trips in-company; **new confirmation table** will need its own **RLS** mirroring `payers` / `trips` company admin patterns — **`20260409170000_add_missing_rls.sql` **72–84**, **16–37**.
- **Naming / collision:** **`shifts`** and **`shift_events`** already mean **operational driver shifts**. A reconciliation feature may need a **distinct name** (e.g. `shift_reconciliations` or `driver_shift_closeouts`) to avoid overloading `shifts.status` or the driver portal’s Schichtenzettel flow — see migration comments in **`20260320000000_fix_shifts_status_check.sql` **28–32**, **56–62**.
- **Nav / IA:** A new admin screen fits naturally under **Account** (next to Fahrer) or a new top-level item — see **`src/config/nav-config.ts`**.

---

## Plan Status

**2026-04-28 (implemented).** The admin **Schichtzettel-Abgleich** feature is in production code: migration `payers.accepts_self_payment` + `shift_reconciliations` with RLS, `src/features/shift-reconciliations/` (service, server `actions`, hooks, UI), RSC page `src/app/dashboard/shift-reconciliations/page.tsx`, navigation under Account, and payer tri-state for `accepts_self_payment` in the Kostenträger sheet. See `docs/shift-reconciliations.md`.

---

*End of audit document.*
