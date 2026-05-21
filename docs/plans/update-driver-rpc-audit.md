# Audit: `update_driver` RPC + `driver_profiles` — Migration Feasibility

**Date:** 2026-05-20  
**Mode:** Read-only (no code changes in this audit).  
**Goal:** Assess a Supabase migration that makes `update_driver()` **role-aware** so it **does not upsert `driver_profiles`** for `accounts.role = 'admin'`, and verify API tenant guard + safe deploy.

---

## Migration file inventory (grep: `update_driver`, `driver_profiles`, `SECURITY DEFINER`)

All matches under `supabase/migrations/`:

| File | Relevance to this audit |
| --- | --- |
| [`20260318000000_add_driver_extended_fields.sql`](../../supabase/migrations/20260318000000_add_driver_extended_fields.sql) | **`driver_profiles`:** adds address columns (`street`, `street_number`, `zip_code`, `city`, `lat`, `lng`). |
| [`20260318100000_add_users_driver_profiles_rls.sql`](../../supabase/migrations/20260318100000_add_users_driver_profiles_rls.sql) | **`driver_profiles` RLS** (initial policies on `users` + `driver_profiles`); **`SECURITY DEFINER`** helpers `current_user_company_id`, `current_user_is_admin`. |
| [`20260318110000_grant_users_driver_profiles.sql`](../../supabase/migrations/20260318110000_grant_users_driver_profiles.sql) | **Grants** on `driver_profiles` (and former `users`). |
| [`20260318120000_add_update_driver_function.sql`](../../supabase/migrations/20260318120000_add_update_driver_function.sql) | **First `update_driver()`** definition (on `users` table name). |
| [`20260318130000_rename_users_to_accounts.sql`](../../supabase/migrations/20260318130000_rename_users_to_accounts.sql) | **Canonical `update_driver()` today** (`accounts` + same profile upsert); **replaces `driver_profiles` RLS** to join `accounts`. |
| [`20260409170000_add_missing_rls.sql`](../../supabase/migrations/20260409170000_add_missing_rls.sql) | **`REVOKE EXECUTE` on `update_driver` from `anon`**; unrelated bulk RLS. |
| [`20260318000000...`](../../supabase/migrations/20260318000000_add_driver_extended_fields.sql) already listed | — |
| Other files matching **`SECURITY DEFINER` only** (no `update_driver` / `driver_profiles` changes) | [`20260402120000_company_assets_storage_rls.sql`](../../supabase/migrations/20260402120000_company_assets_storage_rls.sql), [`20260505180000_manual_km_overrides_foundation.sql`](../../supabase/migrations/20260505180000_manual_km_overrides_foundation.sql), [`20260411120000_storno_atomic_rpc.sql`](../../supabase/migrations/20260411120000_storno_atomic_rpc.sql), [`20260409180000_fix_rls_helper_recursion.sql`](../../supabase/migrations/20260409180000_fix_rls_helper_recursion.sql), [`20260401180000_invoices_invoice_line_items_rls.sql`](../../supabase/migrations/20260401180000_invoices_invoice_line_items_rls.sql), [`20260409150000_create_angebote.sql`](../../supabase/migrations/20260409150000_create_angebote.sql), [`20260409190000_fix_trip_assignments_rls_loop.sql`](../../supabase/migrations/20260409190000_fix_trip_assignments_rls_loop.sql), [`20260502120000_get_shift_day_summaries.sql`](../../supabase/migrations/20260502120000_get_shift_day_summaries.sql), [`20260502120001_add_cancel_trip_as_driver_rpc.sql`](../../supabase/migrations/20260502120001_add_cancel_trip_as_driver_rpc.sql), [`20260502120002_billing_type_accepts_self_payment.sql`](../../supabase/migrations/20260502120002_billing_type_accepts_self_payment.sql) — **out of scope** for `update_driver` / `driver_profiles` behavior. |

**Note:** There is **no** `CREATE TABLE public.driver_profiles` in this repo’s migrations; the table predates or was created outside the tracked set. **Schema detail** for §2 is taken from generated [`src/types/database.types.ts`](../../src/types/database.types.ts) plus `ALTER TABLE` migrations above.

---

## 1. Current `update_driver` RPC — exact definition

### 1.1 Most recent definition (full SQL)

The **last migration that replaces the function body** is [`20260318130000_rename_users_to_accounts.sql`](../../supabase/migrations/20260318130000_rename_users_to_accounts.sql). No later migration calls `CREATE OR REPLACE FUNCTION public.update_driver`. Full text:

```sql
CREATE OR REPLACE FUNCTION public.update_driver(
  p_driver_id uuid,
  p_name text DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_license_number text DEFAULT NULL,
  p_default_vehicle_id uuid DEFAULT NULL,
  p_street text DEFAULT NULL,
  p_street_number text DEFAULT NULL,
  p_zip_code text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account jsonb;
  v_profiles jsonb;
BEGIN
  UPDATE accounts SET
    name = COALESCE(p_name, name),
    first_name = p_first_name,
    last_name = p_last_name,
    phone = p_phone,
    role = COALESCE(p_role, role)
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Driver not found: %', p_driver_id;
  END IF;

  UPDATE driver_profiles SET
    license_number = p_license_number,
    default_vehicle_id = p_default_vehicle_id,
    street = p_street,
    street_number = p_street_number,
    zip_code = p_zip_code,
    city = p_city,
    lat = p_lat,
    lng = p_lng
  WHERE user_id = p_driver_id;

  IF NOT FOUND THEN
    INSERT INTO driver_profiles (user_id, license_number, default_vehicle_id, street, street_number, zip_code, city, lat, lng)
    VALUES (p_driver_id, p_license_number, p_default_vehicle_id, p_street, p_street_number, p_zip_code, p_city, p_lat, p_lng);
  END IF;

  SELECT to_jsonb(a.*) INTO v_account FROM accounts a WHERE a.id = p_driver_id;
  SELECT COALESCE(jsonb_agg(p.*), '[]'::jsonb) INTO v_profiles FROM driver_profiles p WHERE p.user_id = p_driver_id;

  RETURN v_account || jsonb_build_object('driver_profiles', v_profiles);
END;
$$;
```

*(Lines 116–174 in that migration file.)*

The **original** introduction (still historically relevant) is [`20260318120000_add_update_driver_function.sql`](../../supabase/migrations/20260318120000_add_update_driver_function.sql) — same parameter list and **`UPDATE users` / `INSERT driver_profiles`** pattern, later retargeted to `accounts` in `20260318130000`.

### 1.2 Input parameters and types

| Parameter | Type |
| --- | --- |
| `p_driver_id` | `uuid` |
| `p_name` | `text` (default NULL) |
| `p_first_name` | `text` |
| `p_last_name` | `text` |
| `p_phone` | `text` |
| `p_role` | `text` |
| `p_license_number` | `text` |
| `p_default_vehicle_id` | `uuid` |
| `p_street`, `p_street_number`, `p_zip_code`, `p_city` | `text` |
| `p_lat`, `p_lng` | `double precision` |

### 1.3 Profile upsert behavior

- **Not** `INSERT ... ON CONFLICT`. Pattern is:
  1. **`UPDATE driver_profiles SET ... WHERE user_id = p_driver_id`**
  2. **`IF NOT FOUND THEN INSERT INTO driver_profiles (...)`** — plain `INSERT` of one row with the nine columns listed below.

**Columns written in both `UPDATE` and `INSERT`:**  
`license_number`, `default_vehicle_id`, `street`, `street_number`, `zip_code`, `city`, `lat`, `lng` (plus `user_id` on insert).

### 1.4 Role check before profile upsert?

**No.** The function updates `accounts.role` from `p_role` but **never branches** on role before touching `driver_profiles`.

### 1.5 Return value

**`RETURNS jsonb`:** `to_jsonb(accounts row)` merged with `jsonb_build_object('driver_profiles', v_profiles)` where `v_profiles` is `jsonb_agg` of all `driver_profiles` rows for `user_id = p_driver_id`, or `'[]'` if none.

---

## 2. `driver_profiles` table — exact schema (as represented in repo)

### 2.1 Columns (from generated types)

From [`src/types/database.types.ts`](../../src/types/database.types.ts) `Tables['driver_profiles']['Row']` (lines 517–531):

| Column | Type (TS) | Nullability in types |
| --- | --- | --- |
| `id` | `string` | non-null in `Row` |
| `user_id` | `string` | `string \| null` |
| `license_number` | `string` | `string \| null` |
| `default_vehicle_id` | `string` | `string \| null` |
| `notes` | `string` | `string \| null` |
| `created_at` | `string` | `string \| null` |
| `street`, `street_number`, `zip_code`, `city` | `string` | `string \| null` |
| `lat`, `lng` | `number` | `number \| null` |

**Migrations in repo** only **add** address columns ([`20260318000000_add_driver_extended_fields.sql`](../../supabase/migrations/20260318000000_add_driver_extended_fields.sql)); they do not define PK/FK/UNIQUE.

### 2.2 NOT NULL / defaults

**Cannot be fully asserted from repo alone** (no `CREATE TABLE` here). The generated `Row` type suggests **`id` is always present**; other fields are nullable in the type generator output.

### 2.3 Unique constraint on `user_id` / FK

From **`Relationships`** in the same types file:

- **`driver_profiles_user_id_fkey`:** `user_id` → `public.accounts.id`
- **`driver_profiles_default_vehicle_id_fkey`:** `default_vehicle_id` → `public.vehicles.id`

**No `unique` constraint** on `user_id` appears in TypeScript types. Application code ([`drivers.service.ts`](../../src/features/driver-management/api/drivers.service.ts) `getDriverById`) comments that multiple profile rows are possible and avoids a joined select for that reason — so **one-row-per-user is assumed by `update_driver`’s `UPDATE ... WHERE user_id` but not proven as a DB UNIQUE** from this repo.

### 2.4 Triggers on `driver_profiles`

**None found.** Repository search for `CREATE TRIGGER` + `driver_profiles` under `supabase/migrations/**/*.sql` returned **no** matches. (Other triggers exist e.g. on `clients` / `payers` in [`05-kundennummer-system.sql`](../../supabase/migrations/05-kundennummer-system.sql).)

---

## 3. Call sites — everything that invokes `update_driver`

| # | File | Line(s) | How invoked | Payload |
| --- | --- | --- | --- | --- |
| 1 | [`src/app/api/drivers/[id]/route.ts`](../../src/app/api/drivers/[id]/route.ts) | 70–85 | `serverSupabase.rpc('update_driver', { ... })` | All RPC args passed **every time**: `p_driver_id`, `p_name`, `p_first_name`, `p_last_name`, `p_phone`, `p_role`, **`p_license_number`**, **`p_default_vehicle_id`**, **`p_street`**, **`p_street_number`**, **`p_zip_code`**, **`p_city`**, **`p_lat`**, **`p_lng`** — each `body.field ?? null` from `UpdateDriverBody` (lines 68–84). **Profile-related params are always present** (as `null` or value), not omitted. |

**No other** `rpc('update_driver'` / `.rpc("update_driver"` hits in `src/`, `scripts/`, or SQL migrations **outside** the function definitions themselves.

---

## 4. `driver_profiles` direct writes (outside RPC)

| File | Line(s) | Operation |
| --- | --- | --- |
| [`src/app/api/drivers/create/route.ts`](../../src/app/api/drivers/create/route.ts) | 116–123 | **`INSERT`** into `driver_profiles` **only when `role === 'driver'`** (conditional block). |
| [`src/features/driver-management/api/drivers.service.ts`](../../src/features/driver-management/api/drivers.service.ts) | 91–93 | **`SELECT`** (read-only). |
| Same | 145–148, 161–164, 175–178 | **`SELECT` / `UPDATE` / `INSERT`** in `upsertDriverProfile`. |

**`POST /api/drivers/create`:** does **not** use `update_driver`; it uses the **service-role client** to `insert` into `accounts` and optionally `driver_profiles` (see lines 96–136).

**`upsertDriverProfile`:** **no call sites** in the codebase besides its definition (only a **stale comment** in [`driver-form.tsx`](../../src/features/driver-management/components/driver-form.tsx) line 8 references it). Live edit path is **`PATCH /api/drivers/[id]`** → RPC only.

**SQL migrations:** `INSERT INTO driver_profiles` appears **only inside** the bodies of `update_driver` in [`20260318120000_add_update_driver_function.sql`](../../supabase/migrations/20260318120000_add_update_driver_function.sql) and [`20260318130000_rename_users_to_accounts.sql`](../../supabase/migrations/20260318130000_rename_users_to_accounts.sql), not as standalone data migrations.

---

## 5. Existing admin accounts with `driver_profiles` rows

### 5.1 Migrations / seeds that would bulk-create profiles for admins

- **No** `INSERT INTO driver_profiles ...` data migration found except **inside `update_driver` definitions**.
- **[`supabase/config.toml`](../../supabase/config.toml)** references `sql_paths = ["./seed.sql"]` (line 65), but **`seed.sql` is not present** in the workspace search — **no seed data audited here**.
- **[`POST /api/drivers/create`](../../src/app/api/drivers/create/route.ts)** explicitly **skips** `driver_profiles` insert when `role !== 'driver'` (lines 116–136).

### 5.2 Could production already have admins with profiles?

**Yes, plausibly**, for reasons **outside** the create-route guarantee:

1. **`update_driver` today** runs the profile `UPDATE`/`INSERT` block for **every** account ID, including admins — saving an admin via the dashboard can **create** an empty or partial profile row ([`approach-b-audit.md`](approach-b-audit.md) §8).
2. **Role changes** (driver → admin) are not audited here in SQL; an admin might still have a **legacy** profile row.
3. **Historical data** or manual DB edits are always possible.

**Conclusion for migration planning:** A **one-time cleanup** `DELETE FROM driver_profiles WHERE user_id IN (SELECT id FROM accounts WHERE role = 'admin')` may be **desirable** but must be **validated** (e.g. admins who should keep a profile for business reasons — product says they should not). Safer: **audit row counts in staging** before destructive cleanup.

---

## 6. Migration infrastructure

### 6.1 File naming

- **Primary pattern:** `YYYYMMDDHHMMSS_snake_description.sql` (e.g. `20260318130000_rename_users_to_accounts.sql`).
- **Exception:** [`05-kundennummer-system.sql`](../../supabase/migrations/05-kundennummer-system.sql) (prefix `05-`, not a full timestamp).

### 6.2 Apply command

Not pinned in a repo script beyond Supabase CLI conventions. Typical workflows: **`supabase db push`** (linked remote) or **`supabase migration up`** / **`supabase db reset`** locally. This audit did not run the CLI.

### 6.3 Tracking / README

- **No** `supabase/migrations/README` found.
- Applied migrations are tracked by Supabase/Postgres (**`supabase_migrations.schema_migrations`** on environments) — not duplicated as a file in this repo.

### 6.4 Local vs remote

[`supabase/config.toml`](../../supabase/config.toml): `project_id = "taxigo_admin"` (local project name), local API port `54321`, DB port `54322`, **`major_version = 17`**. This describes **local CLI dev**; **remote project ref** is not stored in the committed `config.toml` (linking is usually via `supabase link` / dashboard).

### 6.5 Post-migration: regenerate types

[`package.json`](../../package.json) script (line 20):

```json
"db:types": "npx supabase gen types typescript --local > src/types/database.types.ts"
```

**If the RPC signature stays the same** (only body changes), **`gen types` may not change `Functions` for `update_driver`** — see §9 (function **not** currently in generated `Functions`). If you **add/change parameters or overloads**, regenerate to keep TS in sync.

---

## 7. RLS on `driver_profiles`

### 7.1 Effective policies (post-rename migration)

After [`20260318130000_rename_users_to_accounts.sql`](../../supabase/migrations/20260318130000_rename_users_to_accounts.sql), policies are:

**`driver_profiles_select_company_admin`**

```sql
CREATE POLICY "driver_profiles_select_company_admin" ON public.driver_profiles
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = driver_profiles.user_id AND a.company_id = public.current_user_company_id()
    )
  );
```

**`driver_profiles_select_own`**

```sql
CREATE POLICY "driver_profiles_select_own" ON public.driver_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
```

**`driver_profiles_insert_company_admin`**

```sql
CREATE POLICY "driver_profiles_insert_company_admin" ON public.driver_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = driver_profiles.user_id AND a.company_id = public.current_user_company_id()
    )
  );
```

**`driver_profiles_update_company_admin`**

```sql
CREATE POLICY "driver_profiles_update_company_admin" ON public.driver_profiles
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = driver_profiles.user_id AND a.company_id = public.current_user_company_id()
    )
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = driver_profiles.user_id AND a.company_id = public.current_user_company_id()
    )
  );
```

**`driver_profiles_update_own`**

```sql
CREATE POLICY "driver_profiles_update_own" ON public.driver_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
```

*(Earlier [`20260318100000_add_users_driver_profiles_rls.sql`](../../supabase/migrations/20260318100000_add_users_driver_profiles_rls.sql) used `public.users` in `EXISTS`; superseded by the above.)*

### 7.2 Service role and RLS

**Yes — service role bypasses RLS** (standard Supabase/Postgres behavior). [`docs/access-control.md`](../../docs/access-control.md) documents privileged clients (Layer 3–4).

### 7.3 Does `update_driver` bypass RLS when writing profiles?

**Yes.** The function is **`SECURITY DEFINER`** with `SET search_path = public`; it runs with the **owner’s** privileges and **is not subject to session RLS** for `INSERT`/`UPDATE` on `driver_profiles` the way a plain `authenticated` role would be. That is why **API-layer tenant guard + later RPC role guard** matter ([`docs/access-control.md`](../../docs/access-control.md) step 4).

---

## 8. Cross-tenant IDOR fix — verify presence

**Present** in [`src/app/api/drivers/[id]/route.ts`](../../src/app/api/drivers/[id]/route.ts):

```50:66:src/app/api/drivers/[id]/route.ts
    // Tenant guard: update_driver() is SECURITY DEFINER and bypasses RLS — without this,
    // any tenant admin could mutate another company's accounts (see user-management audit).
    const { data: targetAccount, error: targetError } = await serverSupabase
      .from('accounts')
      .select('company_id')
      .eq('id', id)
      .maybeSingle();

    if (targetError) {
      return NextResponse.json({ error: targetError.message }, { status: 500 });
    }
    if (!targetAccount) {
      return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
    }
    if (targetAccount.company_id !== auth.companyId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
```

[`docs/access-control.md`](../../docs/access-control.md) line 36 also lists this route with the same tenant-guard expectation.

---

## 9. TypeScript RPC types

### 9.1 `update_driver` in `database.types.ts`

**Not present.** [`src/types/database.types.ts`](../../src/types/database.types.ts) `public.Functions` (starting ~line 1824) lists e.g. `cancel_trip_as_driver`, `create_storno_invoice`, `get_shift_day_summaries`, etc., but **no `update_driver` entry**.

Call sites use **untyped** `.rpc('update_driver', { ... })` in the PATCH handler.

### 9.2 After migration: need `supabase gen types`?

- **If only the function body changes** (same name + argument list): **no TypeScript signature update required** for `update_driver` specifically, since it is **already absent** from `Functions`.
- **If you change arguments or return type**: run **`bun run db:types`** (or the `npx supabase gen types ...` command from [`package.json`](../../package.json)) against **local or linked** DB after applying the migration, then commit the diff.

---

## 10. Senior recommendation

### 10.1 In-place `CREATE OR REPLACE` vs drop/recreate

**Prefer `CREATE OR REPLACE FUNCTION`** with the **same parameter list** as today. That preserves **`GRANT` / `REVOKE` bindings** on the existing signature (see [`20260409170000_add_missing_rls.sql`](../../supabase/migrations/20260409170000_add_missing_rls.sql) revoke on the 14-arg form). **Drop + create** is only needed if you **rename parameters, change types, or introduce overloads** that are awkward to migrate.

### 10.2 Orphan `driver_profiles` for admins

- **Likely some exist** if admins were ever edited via `PATCH /api/drivers/[id]` or were demoted/promoted with rows left behind.
- **Cleanup** is **not strictly required** for the RPC fix to deploy, but **recommended** after analytics: optional migration `DELETE ... USING accounts WHERE accounts.id = driver_profiles.user_id AND accounts.role = 'admin'` (with staging verification). Watch for **admins who were drivers** and might still “look” like they need a profile in some UI — product rule should be explicit.

### 10.3 Safest deployment sequence

**Recommended: (a) deploy DB migration first**, then no API change is **required** if the RPC signature is unchanged.

- **RPC first:** Stops **new** admin profile rows from being created on save; **existing** orphan rows remain until cleanup.
- **API-first without RPC:** Would still allow **`INSERT` into `driver_profiles` for admins** on every PATCH until the DB ships — **worse**.

**Single atomic “migration + API”** is unnecessary unless the API starts **omitting** profile fields and you rely on that for behavior — today the API always sends nulls anyway (§3).

**Implementation detail:** Wrap the profile block with the **effective role after the `accounts` `UPDATE`** (read `role` from `accounts` for `p_driver_id`, or compare `COALESCE(p_role, role)` in PL/pgSQL). That way **promoting to admin** in the same call stops profile writes, and **demoting to driver** can still allow profile upsert on subsequent logic (depending on how you structure the `IF`).

### 10.4 Other risks the plan author should know

| Risk | Detail |
| --- | --- |
| **Driver → admin → driver** | Skipping all profile writes when `role = 'admin'` is correct; when **demoting** back to `driver`, ensure a profile can be **created again** (RPC branch must run for `role = 'driver'`). |
| **Multiple `driver_profiles` per `user_id`** | `UPDATE ... WHERE user_id` may touch **multiple rows**; `IF NOT FOUND` then **inserts a second row**. Long-term, enforce **`UNIQUE (user_id)`** if the product assumes one profile — out of scope for this audit but relevant to data health. |
| **`json_agg` return shape** | After skipping profile upsert for admins, `driver_profiles` in JSON may be `[]` or legacy rows until cleanup — clients should already tolerate arrays (`DriverFormBody` uses first element). |
| **EXECUTE privileges** | [`20260409170000_add_missing_rls.sql`](../../supabase/migrations/20260409170000_add_missing_rls.sql) revoked **`anon`**; **`authenticated`** still matters for direct RPC from Supabase client — PATCH route uses session user, consistent with that. |

---

## Context cross-reference

- [`docs/plans/approach-b-audit.md`](approach-b-audit.md) §8 / §9 — **`update_driver` creating profiles for admins** and sequencing with unified roster work.
- [`docs/access-control.md`](../../docs/access-control.md) — Layer 3–4, tenant guard expectation for `SECURITY DEFINER` RPCs.

---

## Plan Status

**Applied:** `20260521224017_make_update_driver_role_aware.sql`

**Production pre-flight counts (run before db push):**

- Admin accounts with `driver_profiles` rows: **0** (no orphans — DELETE was no-op)
- Driver accounts with `driver_profiles` rows: **2** (baseline)

**Post-deploy verification (production):**

- `prosrc` contains `v_effective_role`: ✅
- Admin/profile join count: **0** ✅
- Driver profile count: **2** ✅

**Plan A:** ✅ Complete — 2026-05-21
