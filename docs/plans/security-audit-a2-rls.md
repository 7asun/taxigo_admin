# Security Audit A2 — RLS Completeness & Correctness

**Audit date:** 2026-06-17  
**Scope (read-only):** All `supabase/migrations/*.sql` (118 files), `src/types/database.types.ts`, `supabase/config.toml`, `docs/access-control.md`, `docs/plans/rbac-audit.md` (Tables without RLS section).

**Methodology:** Table names are taken from `database.types.ts` → `public.Tables` (31 tables). For each table, repo migrations were searched for `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and `CREATE POLICY`. Tables created before this migration set may have RLS enabled only in the Supabase dashboard (called out where relevant).

**Note:** Several production tables have RLS in migrations but are **absent from generated types** (e.g. `invoices`, `angebote`, `letters`, `pdf_vorlagen`, `company_profiles`). They are mentioned in Q1 footnotes but are outside the `database.types.ts` inventory.

---

## Executive summary

| Metric | Count |
| --- | --- |
| Tables in `database.types.ts` | **31** |
| **Full repo coverage** (ENABLE RLS + ≥1 policy) | **21** (**67.7%**) |
| **Policies only** (no `ENABLE` in repo) | **1** (`trip_assignments`) |
| **No RLS in repo** (no ENABLE, no policies) | **9** (**29.0%**) |

**Overall risk level: High** — nearly one-third of typed tables lack any RLS definition in tracked migrations. The highest-impact gaps are **`billing_types` / `billing_variants`** (financial catalog, `billing_variants` explicitly `GRANT`ed to `authenticated` without RLS), **`recurring_rules` / `recurring_rule_exceptions`** (scheduling + billing mirror data, indirect tenant via `client_id`), **`route_metrics_cache`** (company-scoped cache, writable via session client in driving-metrics flow), and **`trip_assignments`** (admin policies exist but **`ENABLE ROW LEVEL SECURITY` never appears in repo**).

Secondary risks: **duplicate permissive policies** (OR semantics) on core tables (`trips`, `accounts`, `shifts`, `client_price_tags`); **`update_driver()` SECURITY DEFINER** without in-function tenant guard (relies on API-layer check); **KTS tables** scoped to any company member (not admin-only); **`accounts` GRANT to `anon`** in rename migration.

Prior audit alignment: `docs/plans/rbac-audit.md` lines 216–225 listed the same gap tables; this audit confirms and extends with policy-level findings.

---

## Q1 — Complete table inventory vs. RLS status

| Table | RLS enabled in repo | Policies in repo | Notes |
| --- | --- | --- | --- |
| `accounts` | **Yes** (as `users`, then rename) | **Yes** | `ENABLE` on `users` (`20260318100000_add_users_driver_profiles_rls.sql:31`); policies recreated on rename (`20260318130000_rename_users_to_accounts.sql:45-58`). |
| `billing_pricing_rules` | **Yes** | **Yes** | `20260405100000_billing_pricing_rules.sql:77`; admin `FOR ALL` tightened in `20260409170000_add_missing_rls.sql:148-157`. |
| `billing_types` | **No** | **No** | Pre-existing table; migration comments defer RLS to dashboard (`20260326120000_billing_families_and_variants.sql:10-11`). |
| `billing_variants` | **No** | **No** | Created `20260326120000_billing_families_and_variants.sql:40-50`; `GRANT SELECT, INSERT, UPDATE, DELETE … TO authenticated` (`:162`) **without RLS**. |
| `clients` | **Yes** | **Yes** | `20260409170000_add_missing_rls.sql:60-70`. |
| `client_km_overrides` | **Yes** | **Yes** | `20260505180000_manual_km_overrides_foundation.sql:87-99`. |
| `client_price_tags` | **Yes** | **Yes** | `20260412140000_client_price_tags.sql:34-36`; widened read policy `20260412150000_fix_cpt_rls.sql:5-18`. |
| `companies` | **Yes** | **Yes** | `20260409170000_add_missing_rls.sql:116-126`. |
| `driver_day_plans` | **Yes** | **Yes** | `20260524120000_add_driver_day_plans.sql:48-61`. |
| `driver_documents` | **No** | **No** | Present in types only; no migration references. |
| `driver_profiles` | **Yes** | **Yes** | `20260318100000_add_users_driver_profiles_rls.sql:72-141`; policies updated on accounts rename (`20260318130000_rename_users_to_accounts.sql:67-109`). |
| `fremdfirmen` | **Yes** | **Yes** | `20260404103000_no_invoice_fremdfirma_recurring.sql:110-132`; superseded by single admin policy `20260409170000_add_missing_rls.sql:176-185`. |
| `kts_corrections` | **Yes** | **Yes** | `20260610120000_kts_corrections.sql:35-62`. |
| `kts_external_invoices` | **Yes** | **Yes** | `20260610171000_kts_external_invoices.sql:53-71`. |
| `kts_handovers` | **Yes** | **Yes** | `20260610160000_kts_handovers.sql:31-49`. |
| `live_locations` | **Yes** | **Yes** | `20260520120000_live_locations.sql:46-66`. |
| `notifications` | **No** | **No** | Present in types only; no migration references. |
| `payers` | **Yes** | **Yes** | `20260409170000_add_missing_rls.sql:74-84`. |
| `rechnungsempfaenger` | **Yes** | **Yes** | `20260405100001_rechnungsempfaenger.sql:47-69`; tightened `20260409170000_add_missing_rls.sql:162-171`. |
| `recurring_rule_exceptions` | **No** | **No** | Child of `recurring_rules`; no RLS migration. |
| `recurring_rules` | **No** | **No** | Altered in many migrations; no `ENABLE` / `CREATE POLICY` in repo. |
| `rides` | **No** | **No** | Legacy shift-era table in types; no RLS migration. |
| `route_metrics_cache` | **No** | **No** | Table only `20260417100000_route-metrics-cache.sql:6-17`; no RLS / GRANT lines. |
| `shift_events` | **Yes** | **Yes** | `20260319100000_add_shifts_shift_events_rls.sql:42-75`; admin insert/delete `20260608130000_admin_shift_entry.sql:103-127`. |
| `shift_reconciliations` | **Yes** | **Yes** | `20260428120000_shift_reconciliations.sql:46-59`. |
| `shifts` | **Yes** | **Yes** | `20260319100000_add_shifts_shift_events_rls.sql:8-37`; admin insert/update/delete `20260608130000_admin_shift_entry.sql:66-101`. |
| `trip_assignments` | **No** | **Yes** | Policies `20260409190000_fix_trip_assignments_rls_loop.sql:40-70`; **no `ENABLE ROW LEVEL SECURITY` in any repo migration**. |
| `trip_presets` | **Yes** | **Yes** | `20260514150000_trip_presets.sql:44-60`. |
| `trip_price_backfill_audit` | **No** | **No** | Temp audit table `20260513220000_trip_price_backfill_audit.sql:4-37`; documented as droppable. |
| `trips` | **Yes** | **Yes** | `20260409170000_add_missing_rls.sql:15-56`; driver policies recreated `20260409180000_fix_rls_helper_recursion.sql:39-55`. |
| `vehicles` | **Yes** | **Yes** | `20260409170000_add_missing_rls.sql:102-112`. |

**Footnote — tables with RLS in migrations but not in `database.types.ts`:** `invoices`, `invoice_line_items`, `angebote`, `angebot_line_items`, `angebot_vorlagen`, `letters`, `pdf_vorlagen`, `invoice_text_blocks`, `company_profiles` all have `ENABLE` + policies in repo (representative: `20260401180000_invoices_invoice_line_items_rls.sql:9-66`, `20260409150000_create_angebote.sql:68-138`).

---

## Q2 — Missing RLS tables (exposure analysis)

### `billing_types` / `billing_variants`

| Aspect | Finding |
| --- | --- |
| **Data sensitivity** | Financial catalog: Abrechnungsfamilien / Unterarten, linked to `payers`, `trips`, `recurring_rules`, pricing rules. |
| **Data API exposure** | `billing_variants` has explicit `GRANT … TO authenticated, service_role` (`20260326120000_billing_families_and_variants.sql:162`). `billing_types` is exposed via PostgREST on `public` schema (`supabase/config.toml:12-13`). No `SECURITY DEFINER` wrapper. |
| **Realistic abuse** | Any authenticated user (including drivers) with default table grants can **read and mutate all tenants'** billing catalog rows unless dashboard RLS exists outside repo. Cross-tenant insert: set `payer_id` / `billing_type_id` to another company's UUID. |

### `recurring_rules` / `recurring_rule_exceptions`

| Aspect | Finding |
| --- | --- |
| **Data sensitivity** | Company scheduling templates: addresses, RRULE, payer/billing/KTS/fremdfirma mirrors (`database.types.ts:893-1010`). |
| **Data API exposure** | Direct table access; cron uses service role (`docs/access-control.md:50`). Admin UI uses session client. |
| **Realistic abuse** | Cross-tenant read/write of all recurrence rules; supply another company's `client_id` on insert (FK may succeed if `clients` row visible or FK not enforced at app layer). Exceptions inherit parent exposure. |

### `route_metrics_cache`

| Aspect | Finding |
| --- | --- |
| **Data sensitivity** | Per-company driving distance/duration cache (`20260417100000_route-metrics-cache.sql:6-17`). |
| **Data API exposure** | Written by `resolveDrivingMetricsWithCache` via session supabase (`src/lib/google-directions.ts:346-362`); table has no RLS in repo. |
| **Realistic abuse** | Read/write cache rows for any `company_id`; pollute or exfiltrate route data across tenants. |

### `trip_assignments`

| Aspect | Finding |
| --- | --- |
| **Data sensitivity** | Driver↔trip assignment junction. |
| **Data API exposure** | Policies defined (`20260409190000_fix_trip_assignments_rls_loop.sql:40-70`) but **RLS enablement not in repo**. If RLS disabled in production, policies are ignored. |
| **Realistic abuse** | Full CRUD on all assignments; breaks driver trip visibility model; enables cross-tenant assignment manipulation. |

### `trip_price_backfill_audit`

| Aspect | Finding |
| --- | --- |
| **Data sensitivity** | Temporary pricing audit (`20260513220000_trip_price_backfill_audit.sql:4-37`); `company_id` + trip price snapshots. |
| **Data API exposure** | Direct table; likely service-role backfill only in practice. |
| **Realistic abuse** | Read financial snapshots for all companies if grants exist. Low severity if table dropped after backfill (as commented `:39-41`). |

### `driver_documents`, `notifications`, `rides`

| Aspect | Finding |
| --- | --- |
| **Data sensitivity** | `driver_documents`: files/metadata per driver; `notifications`: per-user messages; `rides`: legacy fare/shift data. |
| **Data API exposure** | In types; no repo migrations — likely legacy dashboard tables. |
| **Realistic abuse** | If tables exist in production with default `authenticated` grants and no RLS: **full read/write across tenants**. Verify in production `pg_tables` / `pg_policies`. |

---

## Q3 — Policy correctness: tenant isolation

### Tables with sound admin + `company_id` patterns

Most admin-only tables use `current_user_is_admin() AND company_id = current_user_company_id()` on both `USING` and `WITH CHECK` (template: `clients` `20260409170000_add_missing_rls.sql:61-70`, `payers` `:75-84`, `vehicles` `:103-112`).

Child tables scope via parent FK + company check (good pattern):

- `invoice_line_items` → `invoices.company_id` (`20260401180000_invoices_invoice_line_items_rls.sql:46-66`)
- `angebot_line_items` → `angebote.company_id` (`20260409150000_create_angebote.sql:105-138`)
- `trip_assignments` → `trip_company_id(trip_id)` (`20260409190000_fix_trip_assignments_rls_loop.sql:40-70`)

### Flags — missing, partial, or `auth.uid()`-only

| Table / policy | Issue | Reference |
| --- | --- | --- |
| **`trips` driver policies** | `trips_select_own_driver` / `trips_update_own_driver` use **`driver_id = auth.uid()` only** — no `company_id` check. Safe only if `driver_id` is never set cross-tenant. | `20260409180000_fix_rls_helper_recursion.sql:42-55` |
| **`accounts` admin update** | `accounts_update_company_admin` has **`USING` only** — no `WITH CHECK` to prevent changing `company_id` on update. | `20260318130000_rename_users_to_accounts.sql:56-58` |
| **`accounts` anon grant** | `GRANT SELECT, UPDATE ON public.accounts TO anon` — unusual; anon JWT could touch accounts if policies allow. | `20260318130000_rename_users_to_accounts.sql:112-113` |
| **`client_price_tags_read`** | Any authenticated user with matching `company_id` can **SELECT** (drivers included) — intentional widen per comment. | `20260412150000_fix_cpt_rls.sql:16-18` |
| **`kts_corrections` / `kts_handovers` / `kts_external_invoices`** | Tenant via `(SELECT company_id FROM accounts WHERE id = auth.uid())` — **not admin-gated**; drivers in same company can SELECT/INSERT (and UPDATE on corrections). | e.g. `20260610120000_kts_corrections.sql:37-62` |
| **`invoice_line_items`** | **No UPDATE/DELETE policies** in repo — mutations only via `replace_draft_invoice_line_items` SECURITY DEFINER (`20260529080000_draft_invoice_editing_foundation.sql:57-100`). By design. | `20260401180000_invoices_invoice_line_items_rls.sql:46-66` |
| **`invoices`** | **No DELETE policy** in repo migrations — delete may be blocked or rely on service role. | `20260401180000_invoices_invoice_line_items_rls.sql:17-40` |
| **`update_driver()` RPC** | **No in-function `company_id` check** — updates any `p_driver_id`. Tenant guard must be enforced by caller (API does: `src/app/api/drivers/[id]/route.ts:50-66`). | `20260521224017_make_update_driver_role_aware.sql:41-47` |

---

## Q4 — Driver vs. admin access

### Driver-scoped tables (expected own-row access)

| Table | Driver SELECT | Driver WRITE | Cross-driver risk |
| --- | --- | --- | --- |
| `trips` | Own `driver_id` or `trip_assignments` (`20260409180000_fix_rls_helper_recursion.sql:42-50`) | UPDATE own `driver_id` only (`:52-55`); cancel via `cancel_trip_as_driver` RPC (`20260502120001_add_cancel_trip_as_driver_rpc.sql:29-43`) | **Possible** if another company's trip has `driver_id = auth.uid()` (data bug) — no company filter on driver policies. |
| `shifts` / `shift_events` | Own `driver_id` (`20260319100000_add_shifts_shift_events_rls.sql:11-27`, `:45-65`) | Own rows only | Low if `driver_id` integrity holds. |
| `live_locations` | `FOR ALL` own `driver_id`; INSERT requires `company_id = current_user_company_id()` (`20260520120000_live_locations.sql:53-59`) | Own row only | Low. |
| `driver_profiles` | Own `user_id` (`20260318130000_rename_users_to_accounts.sql:77-78`) | UPDATE own (`:107-109`) | Low. |
| `accounts` | Own row (`:45-46`) | UPDATE own (`:52-54`) | Drivers cannot read other drivers' accounts (no admin policy for drivers). |

### Admin-only tables (drivers should have no access)

Drivers **should not** reach: `clients`, `payers`, `invoices`, `vehicles`, `driver_day_plans`, etc. — all gated with `current_user_is_admin()` (e.g. `clients` `20260409170000_add_missing_rls.sql:61-70`).

**Gap:** Tables **without RLS** (`billing_types`, `billing_variants`, `recurring_rules`, …) — drivers have the same PostgREST access as admins if grants allow.

### `client_price_tags`

Drivers can **SELECT** all tags in their company (`20260412150000_fix_cpt_rls.sql:16-18`) — not other drivers' personal data, but company pricing metadata.

---

## Q5 — Duplicate and conflicting policies

PostgreSQL **PERMISSIVE** policies OR together. Multiple policies per command widen access if any policy is looser.

### Tables with >1 policy per command type

| Table | Command | Policies | Assessment |
| --- | --- | --- | --- |
| **`trips`** | SELECT | `trips_select_company_admin` + `trips_select_own_driver` | **Intentional** — admin company OR assigned driver (`20260409170000_add_missing_rls.sql:16-52`, `20260409180000_fix_rls_helper_recursion.sql:42-50`). |
| **`trips`** | UPDATE | `trips_update_company_admin` + `trips_update_own_driver` | **Intentional** — split admin vs driver (`:28-37`, `:52-55`). |
| **`accounts`** | SELECT | `accounts_select_own` + `accounts_select_company_admin` | **Intentional** — self OR admin roster (`20260318130000_rename_users_to_accounts.sql:45-50`). |
| **`accounts`** | UPDATE | `accounts_update_own` + `accounts_update_company_admin` | **Intentional** (`:52-58`). |
| **`driver_profiles`** | SELECT / UPDATE | admin + own policies | **Intentional** (`:67-109`). |
| **`shifts`** | SELECT | `shifts_select_own` + `shifts_select_company_admin` | **Intentional** (`20260319100000_add_shifts_shift_events_rls.sql:11-37`). |
| **`shifts`** | INSERT | `shifts_insert_own` + `shifts_insert_company_admin` | **Intentional** — driver self + admin on behalf (`:16-21`, `20260608130000_admin_shift_entry.sql:66-79`). |
| **`shifts`** | UPDATE / DELETE | driver own + admin (`:21-27`, `20260608130000_admin_shift_entry.sql:81-101`) | **Intentional**. |
| **`shift_events`** | SELECT | own + admin company | **Intentional** (`20260319100000_add_shifts_shift_events_rls.sql:45-75`). |
| **`live_locations`** | SELECT | `live_locations_driver_all` (FOR ALL includes SELECT) + `live_locations_admin_select` | **Intentional** — driver own + admin read company (`20260520120000_live_locations.sql:53-66`). |
| **`client_price_tags`** | SELECT | `client_price_tags_admin` (FOR ALL) + `client_price_tags_read` | **Broader than admin-only** — any company member can SELECT (`20260412150000_fix_cpt_rls.sql:5-18`). |

### Historical 42P17 incident (duplicate dashboard + repo policies)

Documented in `docs/access-control.md:90-146`: old dashboard policies ("Allow tenants only", etc.) **OR**'d with new migrations, causing recursion and unexpected access. Repo fix: `DROP POLICY IF EXISTS` + `trip_company_id()` helper (`20260409190000_fix_trip_assignments_rls_loop.sql:19-70`).

**Operational rule:** Before adding policies, query `pg_policy` in production (`docs/access-control.md:170-174`).

### Superseded duplicate policy sets (resolved in repo)

`20260409170000_add_missing_rls.sql` drops per-operation policies on catalog tables and replaces with single `*_admin FOR ALL` (e.g. `invoice_text_blocks` `:130-143`, `fremdfirmen` `:172-185`). Earlier per-command policies in `20260405100001_rechnungsempfaenger.sql`, `20260404103000_no_invoice_fremdfirma_recurring.sql`, `20260408120001_pdf_vorlagen.sql` are explicitly dropped in `:130-189`.

---

## Q6 — SECURITY DEFINER functions

| Function | Migration | Internal auth check | Callable by | Tenant binding on params |
| --- | --- | --- | --- | --- |
| `current_user_company_id()` | `20260409180000_fix_rls_helper_recursion.sql:16-25` | Reads `accounts` for `auth.uid()` | RLS internals | N/A |
| `current_user_is_admin()` | `:27-36` | Same | RLS internals | N/A |
| `trip_company_id(uuid)` | `20260409190000_fix_trip_assignments_rls_loop.sql:19-28` | None (reads trip row with `row_security off`) | `GRANT … TO authenticated` (`:33`) | Param is `trip_id` — used only in policy expressions |
| `update_driver(...)` | `20260521224017_make_update_driver_role_aware.sql:13-98` | **None** | authenticated (via API) | **`p_driver_id` not tenant-checked in function** |
| `cancel_trip_as_driver(uuid, text)` | `20260502120001_add_cancel_trip_as_driver_rpc.sql:6-45` | `driver_id = auth.uid()` (`:29-31`) | authenticated (`:49`) | Trip ownership via driver_id |
| `create_storno_invoice(...)` | `20260411120000_storno_atomic_rpc.sql:27-64` | `current_user_is_admin()` + `p_company_id = current_user_company_id()` | authenticated | Yes |
| `replace_draft_invoice_line_items(uuid, jsonb)` | `20260529080000_draft_invoice_editing_foundation.sql:57-93` | Admin + invoice `company_id` match | authenticated (`:253`) | Yes |
| `create_branch_draft_from_invoice(...)` | `20260605120200_create_branch_draft_rpc.sql:10-30` | Admin + company match | authenticated | Yes |
| `invoice_numbers_max_for_prefix(text)` | `20260401180000_invoices_invoice_line_items_rls.sql:71-80` | `current_user_is_admin()` only | authenticated (`:93`) | Prefix is global across tenants (documented `:68-70`) |
| `angebot_numbers_max_for_prefix(text)` | `20260409150000_create_angebote.sql:159+` | `current_user_is_admin()` | authenticated | Global prefix (same pattern as invoices) |
| `get_controlling_*` (5 functions) | `20260530120000_controlling_rpcs.sql` | `authorized` CTE: admin + `p_company_id = current_user_company_id()` (`:49-52` pattern) | authenticated | Yes |
| `get_shift_day_summaries(...)` | `20260502120000_get_shift_day_summaries.sql:21+` | `p_company_id` in WHERE (comment `:69`) | authenticated | Param must match caller's company (app responsibility) |
| `billing_type_accepts_self_payment(...)` | `20260502120002_billing_type_accepts_self_payment.sql:31+` | `p_company_id` in WHERE | authenticated | Param-scoped |
| `resolve_client_id_by_name(uuid, text)` | `20260412120000_backfill_trip_client_ids.sql:26-50` | **SECURITY INVOKER** — uses RLS on `clients` | authenticated (`:56`) | `p_company_id` filter in query (`:38-40`) |
| `trip_ids_matching_invoice_effective_status(text)` | `20260411140000_trip_ids_matching_invoice_effective_status.sql:5-62` | **SECURITY INVOKER** | authenticated (`:67`) | Relies on `trips` + `invoices` RLS |
| `trip_kts_correction_summaries(uuid[])` | `20260610125000_kts_rpc_tenant_guard.sql:4-57` | `current_user_company_id()` + JOIN `trips` (`:23-37`) | authenticated | Trip IDs must belong to caller company |
| `create_kts_handover(uuid, uuid[])` | `20260610160000_kts_handovers.sql:66-125` | Admin + company (`:81-84`) | authenticated (`:134`) | Yes |
| `apply_kts_invoice_import(...)` | `20260610172000_kts_invoice_import_rpc.sql:4-75` | Admin + company (`:22-25`) | authenticated | Per-row `trip_id` company check (`:67-70`) |
| `user_can_access_company_storage_folder(text)` | `20260402120000_company_assets_storage_rls.sql:15-30` | `accounts.company_id::text = p_folder` | authenticated | Storage path segment |
| Account sync triggers | `20260524151222_harden_account_triggers.sql:9-55` | Trigger context | N/A | N/A |

**High-risk DEFINER calls without in-function tenant guard:** `update_driver()` — must keep API tenant guard (`docs/access-control.md:80`). **`trip_company_id()`** granted to all authenticated users — leaks `company_id` for any known `trip_id` (low sensitivity, but cross-tenant metadata).

---

## Q7 — Views

**No `CREATE VIEW` statements** found in `supabase/migrations/` (grep across all 118 files).

Views are not used as an RLS bypass vector in this repo. PostgREST exposes tables and RPCs on `public` (`supabase/config.toml:12-13`).

---

## Q8 — Indirect scoping (`recurring_rules`, `billing_types`, `billing_variants`)

### `recurring_rules` (via `client_id` → `clients.company_id`)

| Question | Finding |
| --- | --- |
| **FK chain in policies?** | **No policies in repo** — chain is not enforced at RLS layer. |
| **Cross-tenant `client_id` attack?** | Without RLS: authenticated user could insert/update rules pointing at another company's `client_id` if FK insert succeeds (FK only checks `clients.id` exists, not caller's tenant). |
| **Parent delete** | `recurring_rules_client_id_fkey` → `clients` (`database.types.ts:990-994`). Typical ON DELETE behavior depends on DB constraint (not defined in repo migrations reviewed); orphaned rules or CASCADE must be verified in production. Exceptions table references `rule_id` (`recurring_rule_exceptions`). |

### `billing_types` (via `payer_id` → `payers.company_id`)

| Question | Finding |
| --- | --- |
| **FK chain in policies?** | **No RLS in repo.** |
| **Cross-tenant attack?** | Insert `billing_types` with another company's `payer_id` — row is scoped to wrong tenant at catalog level; all trips/rules referencing that type leak across tenants. |
| **Parent delete** | `ON DELETE CASCADE` from payers (`20260326120000_billing_families_and_variants.sql:22-23` comment). |

### `billing_variants` (via `billing_type_id` → `billing_types` → `payers`)

| Question | Finding |
| --- | --- |
| **FK chain in policies?** | **No RLS**; explicit **GRANT to authenticated** (`20260326120000_billing_families_and_variants.sql:162`). |
| **Cross-tenant attack?** | Same as billing_types — supply foreign keys from another tenant's catalog. |
| **Parent delete** | `ON DELETE CASCADE` from `billing_types` (`:42`, `:59`). |

**`trips.billing_variant_id` and `recurring_rules.billing_variant_id`** inherit the same risk: wrong variant ID pulls another tenant's billing configuration into operational data.

---

## Migration backlog (risk-ranked)

| Severity | Table | Recommended pattern | One-line action |
| --- | --- | --- | --- |
| **Critical** | `billing_variants` | Admin `FOR ALL` + `EXISTS (billing_types → payers.company_id = current_user_company_id())` OR denormalize `company_id` | Add `ENABLE RLS` + admin policies; revoke broad grants; mirror `clients_company_admin` (`20260409170000_add_missing_rls.sql:61-70`). |
| **Critical** | `billing_types` | Admin `FOR ALL` via `payer_id IN (SELECT id FROM payers WHERE company_id = current_user_company_id())` | Same as above; drop dashboard-only policies if any. |
| **Critical** | `recurring_rules` | Admin `FOR ALL` via `EXISTS (SELECT 1 FROM clients c WHERE c.id = client_id AND c.company_id = current_user_company_id())` | Add `ENABLE RLS` + policies on INSERT/UPDATE `WITH CHECK` for `client_id` tenant. |
| **Critical** | `trip_assignments` | Already has policies — add `ALTER TABLE … ENABLE ROW LEVEL SECURITY` | `20260409190000_fix_trip_assignments_rls_loop.sql:40-70` + enable line. |
| **High** | `recurring_rule_exceptions` | Scope via `rule_id` → `recurring_rules` join to `clients.company_id` | Child policies after parent rules migration. |
| **High** | `route_metrics_cache` | `company_id = current_user_company_id()` on ALL; admin write, optional read for authenticated company | Match `live_locations` company check (`20260520120000_live_locations.sql:57-58`). |
| **High** | `update_driver()` | Add `EXISTS (accounts WHERE id = p_driver_id AND company_id = current_user_company_id())` at start | Defense in depth beyond API (`20260521224017_make_update_driver_role_aware.sql`). |
| **Medium** | `kts_corrections`, `kts_handovers`, `kts_external_invoices` | Restrict INSERT/UPDATE to `current_user_is_admin()` if product is admin-only | Tighten `20260610120000_kts_corrections.sql:46-62` pattern. |
| **Medium** | `accounts` | Remove `GRANT … TO anon`; add `WITH CHECK` on `accounts_update_company_admin` | `20260318130000_rename_users_to_accounts.sql:56-58`, `:112-113`. |
| **Medium** | `trips` driver policies | Add `company_id = current_user_company_id()` to driver SELECT/UPDATE | `20260409180000_fix_rls_helper_recursion.sql:42-55`. |
| **Low** | `trip_price_backfill_audit` | Admin-only or service-role only; drop table post-backfill | `20260513220000_trip_price_backfill_audit.sql`. |
| **Low** | `driver_documents`, `notifications`, `rides` | Verify existence in prod; add RLS or drop legacy tables | Types-only; no repo migrations. |
| **Low** | `invoices` | Add explicit DELETE policy if app needs it | `20260401180000_invoices_invoice_line_items_rls.sql` stops at UPDATE. |

---

## Files reviewed (index)

| Area | Paths |
| --- | --- |
| Migrations | `supabase/migrations/*.sql` (118 files) |
| Types | `src/types/database.types.ts` |
| Config | `supabase/config.toml` |
| Docs | `docs/access-control.md`, `docs/plans/rbac-audit.md` |
| App cross-ref | `src/lib/google-directions.ts`, `src/app/api/drivers/[id]/route.ts` |

**No application or migration code was modified** during this audit except creation of this document.
