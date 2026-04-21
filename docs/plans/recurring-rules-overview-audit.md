# Audit: Cross-Client Recurring Rules Overview

**Scope:** Read-only review of data layer, routing, UI patterns, docs, and Cursor plans relevant to recurring rules and a cross-client “Alle Regelfahrten” overview.

**Repository note (2026-04):** The overview page is implemented at **`/dashboard/regelfahrten`** (`src/app/dashboard/regelfahrten/page.tsx`), backed by **`getAllRules()`** in `src/features/trips/api/recurring-rules.server.ts`. The browser-facing **`recurringRulesService`** in `recurring-rules.service.ts` remains scoped per client. This document still answers the original questionnaire and records both the historical gap and the current implementation.

---

## 1. Data Layer

### 1.1 RecurringRule type and DB shape (Question 1)

In `src/features/trips/api/recurring-rules.service.ts`, `RecurringRule` is exported as:

`Database['public']['Tables']['recurring_rules']['Row']`

Concrete fields from `src/types/database.types.ts` (`recurring_rules.Row`):

| Field | Type | Nullable |
| --- | --- | --- |
| `id` | `string` | no |
| `client_id` | `string` | no |
| `rrule_string` | `string` | no |
| `pickup_address` | `string` | no |
| `dropoff_address` | `string` | no |
| `pickup_time` | `string` | no |
| `return_mode` | `string` | no |
| `return_trip` | `boolean` | no |
| `return_time` | `string \| null` | yes |
| `start_date` | `string` | no |
| `end_date` | `string \| null` | yes |
| `is_active` | `boolean` | no |
| `created_at` | `string` | no |
| `payer_id` | `string \| null` | yes |
| `billing_variant_id` | `string \| null` | yes |
| `kts_document_applies` | `boolean` | no |
| `kts_source` | `string \| null` | yes |
| `no_invoice_required` | `boolean` | no |
| `no_invoice_source` | `string \| null` | yes |
| `fremdfirma_id` | `string \| null` | yes |
| `fremdfirma_payment_mode` | `string \| null` | yes |
| `fremdfirma_cost` | `number \| null` | yes |

There is **no** `company_id` on the row; tenant isolation (if any) must come from related rows or RLS elsewhere.

### 1.2 RecurringRuleWithBillingEmbed (Question 2)

Defined in `recurring-rules.service.ts` as:

`RecurringRule & { billing_variant: { id, name, code, billing_type_id, billing_types: unknown } | null }`

It adds the **`billing_variant`** PostgREST embed (alias to `billing_variants` with nested `billing_types`). It does **not** include the client’s display name or a `clients` embed—only **`client_id`** on the base row.

`RecurringRulesList` (`src/features/clients/components/recurring-rules-list.tsx`) types its `rules` prop as `RecurringRuleWithBillingEmbed[]`, which matches `getClientRules()`.

### 1.3 RecurringRuleWithClientEmbed (cross-client overview)

Defined in `src/features/trips/api/recurring-rules.server.ts` as `RecurringRule` plus:

- `billing_variant`: same practical shape as the list embed, with `billing_types: { name, color } | null` typed for display.
- `clients`: `{ id, first_name, last_name } | null` — **client id and name fields** for the overview table and guest label.

### 1.4 Service methods — `recurringRulesService` (Question 3)

All methods use `createClient()` from `@/lib/supabase/client` (browser client).

| Method | Parameters | Return | Filters | Client name / join |
| --- | --- | --- | --- | --- |
| `getClientRules` | `clientId: string` | `Promise<RecurringRuleWithBillingEmbed[]>` | **Yes:** `.eq('client_id', clientId)`. No active or date-range filters in query. Ordered by `created_at` desc. | **Join:** `billing_variant:billing_variants(...)`. No `clients` embed. |
| `getRuleById` | `id: string` | `Promise<RecurringRule>` | By rule id only; `select('*')` — no embeds | No |
| `createRule` | `rule: InsertRecurringRule` | `Promise<RecurringRule>` | N/A (insert) | No |
| `updateRule` | `id: string`, `rule: UpdateRecurringRule` | `Promise<RecurringRule>` | N/A | No |
| `deleteRule` | `id: string` | `Promise<void>` | N/A | No |

### 1.5 Server read — `getAllRules()` (Questions 3–4)

| Function | Parameters | Return | Filters | Client name / join |
| --- | --- | --- | --- | --- |
| `getAllRules` | none | `Promise<RecurringRuleWithClientEmbed[]>` | **No** `client_id` filter — all rows returned by PostgREST for the session. Ordered by `created_at` desc. | **Joins:** `billing_variant:billing_variants(...)`, `clients(id, first_name, last_name)` |

**Historical gap:** `recurringRulesService` never exposed an unscoped list. **Current:** `getAllRules()` fills the cross-client need on the server.

### 1.6 Cross-client query and RLS (Questions 4–5)

- **Application scope:** Unscoped reads are only in **`getAllRules()`** (server). The client service remains per-`client_id`.
- **RLS:** Searched `supabase/migrations/*.sql` for `recurring_rules` and for policies: migrations alter columns and constraints on `public.recurring_rules` but **do not** enable RLS or `CREATE POLICY` on that table. `20260409170000_add_missing_rls.sql` (referenced in `docs/access-control.md`) does **not** mention `recurring_rules`. The access-control doc’s RLS summary table also **does not** list `recurring_rules`.

**Conclusion:** From this repo alone, there is **no** evidence of RLS on `recurring_rules` that would block a cross-client `SELECT`. Production could still differ (manual SQL, untracked policies). **`docs/features/recurring-rules-overview.md`** notes verifying live DB behavior.

---

## 2. Routing & Page Structure

### 2.1 `src/app/dashboard/` tree (Step 1)

Files under `src/app/dashboard/` (complete file list from filesystem audit):

- `layout.tsx` — dashboard shell (admin guard, sidebar, header).
- `page.tsx` — redirects to `/dashboard/overview`.
- `abrechnung/page.tsx`, `abrechnung/angebot-vorlagen/page.tsx`, `abrechnung/preise/page.tsx`, `abrechnung/rechnungsempfaenger/page.tsx`, `abrechnung/vorlagen/page.tsx`
- `angebote/page.tsx`, `angebote/new/page.tsx`, `angebote/[id]/page.tsx`, `angebote/[id]/edit/page.tsx`
- `clients/page.tsx`, `clients/new/page.tsx`, `clients/[id]/page.tsx`
- `documentation/layout.tsx`, `documentation/page.tsx`, `documentation/[slug]/page.tsx`
- `drivers/page.tsx`
- `fremdfirmen/page.tsx`
- `invoices/page.tsx`, `invoices/new/page.tsx`, `invoices/example/page.tsx`, `invoices/[id]/page.tsx`, `invoices/[id]/preview/page.tsx`
- `overview/layout.tsx`, `overview/error.tsx`, parallel slots: `@area_stats/*`, `@bar_stats/*`, `@pie_stats/*`, `@sales/*` (each with `page.tsx`, `loading.tsx`, `error.tsx`, `default.tsx` as present)
- `payers/page.tsx`
- `rechnungsempfaenger/page.tsx`
- **`regelfahrten/page.tsx`** — Alle Regelfahrten overview.
- `settings/company/page.tsx`, `settings/invoice-templates/page.tsx`, `settings/pdf-vorlagen/page.tsx`, `settings/unzugeordnete-fahrten/page.tsx`
- `trips/page.tsx`, `trips/fahrten-page-shell.tsx`, `trips/trips-header-actions.tsx`, `trips/new/layout.tsx`, `trips/new/page.tsx`

### 2.2 Routes and page components (Question 6)

| Path | `page.tsx` |
| --- | --- |
| `/dashboard` | `src/app/dashboard/page.tsx` (redirect) |
| `/dashboard/overview` | Parallel routes under `overview/@*/page.tsx` + `overview/layout.tsx` |
| `/dashboard/trips` | `src/app/dashboard/trips/page.tsx` |
| `/dashboard/trips/new` | `src/app/dashboard/trips/new/page.tsx` |
| `/dashboard/regelfahrten` | `src/app/dashboard/regelfahrten/page.tsx` |
| `/dashboard/clients` | `src/app/dashboard/clients/page.tsx` |
| `/dashboard/clients/new` | `src/app/dashboard/clients/new/page.tsx` |
| `/dashboard/clients/[id]` | `src/app/dashboard/clients/[id]/page.tsx` |
| `/dashboard/drivers` | `src/app/dashboard/drivers/page.tsx` |
| `/dashboard/payers` | `src/app/dashboard/payers/page.tsx` |
| `/dashboard/fremdfirmen` | `src/app/dashboard/fremdfirmen/page.tsx` |
| `/dashboard/rechnungsempfaenger` | `src/app/dashboard/rechnungsempfaenger/page.tsx` |
| `/dashboard/invoices` (+ nested) | `src/app/dashboard/invoices/...` |
| `/dashboard/angebote` (+ nested) | `src/app/dashboard/angebote/...` |
| `/dashboard/abrechnung` (+ nested) | `src/app/dashboard/abrechnung/...` |
| `/dashboard/documentation` (+ `[slug]`) | `src/app/dashboard/documentation/...` |
| `/dashboard/settings/...` | `src/app/dashboard/settings/...` |

**Where `RecurringRulesList` renders:** only inside client UI — `src/features/clients/components/client-form.tsx` and `src/features/clients/components/client-detail-panel.tsx`. It is **not** used on `/dashboard/regelfahrten` (that page uses `RecurringRulesOverview` + `DataTable`).

**`RecurringRuleSheet`:** imported only from `recurring-rules-list.tsx` (not directly from route files).

**Client edit route:** `src/app/dashboard/clients/[id]/page.tsx` loads the client and renders `ClientForm`.

### 2.3 Proposed / actual route (Question 7)

Implemented path: **`/dashboard/regelfahrten`** with German label **Regelfahrten** in `src/config/nav-config.ts`, consistent with **Fahrten**, **Fahrgäste**, and other German route titles. An English slug such as `/dashboard/recurring-rules` would be less aligned with the rest of the dashboard.

### 2.4 Navigation (Question 8)

- **Source of truth:** `src/config/nav-config.ts` exports `navItems: NavItem[]`.
- **Rendering:** `src/components/layout/app-sidebar.tsx` imports `navItems` and `useFilteredNavItems(navItems)` from `src/hooks/use-nav.ts`, then maps items to sidebar links (including collapsible groups).
- **Adding a top-level item:** append or insert a leaf entry in `navItems` (Regelfahrten is already added after Fahrten). Respect shortcut uniqueness (documented in `nav-config.ts`).

Main nav is **not** hardcoded only in the sidebar component; it is **config-driven** with client-side RBAC filtering.

---

## 3. UI Pattern & Component Inventory

### 3.1 Trips list pattern (Question 9)

- **Route:** `src/app/dashboard/trips/page.tsx` wraps `TripsListingPage` from `src/features/trips/components/trips-listing.tsx` in `Suspense` with `DataTableSkeleton`.
- **Data:** `TripsListingPage` (RSC) queries `trips` via server Supabase, applies filters from URL (`searchParamsCache`), computes `pageCount`, passes rows into **`TripsTable`**.
- **Table:** `TripsTable` (`src/features/trips/components/trips-tables/index.tsx`) uses **`useDataTable`** from `src/hooks/use-data-table.ts`, **`DataTable`** from `src/components/ui/table/data-table`, and **`DataTableToolbar`** from `src/components/ui/table/data-table-toolbar`. Props pattern: `data`, `columns`, `pageCount` derived from `totalItems` / `perPage`; `shallow: false`, `debounceMs`, `getRowId`.

**Regelfahrten parity:** `RecurringRulesOverview` uses the same **`useDataTable` + `DataTable` + `DataTableToolbar`** trio; the RSC page owns filter/sort/pagination slice and passes `totalDatasetCount`, `perPage`, `currentPage` so manual pagination state matches the server slice.

### 3.2 Client name linkability (Question 10)

- **Per-client card list:** `RecurringRulesList` does not show client name (context is a single client).
- **Cross-client overview:** Guest label comes from **`RecurringRuleWithClientEmbed.clients`** (and fallback `client_id` for linking), via `formatRecurringRuleGuestLabel` in `recurring-rules-columns.tsx`. **`getAllRules()`** must embed `clients` — already done in `recurring-rules.server.ts`.

### 3.3 Filters, sorting, search (Question 11)

| Pattern | Where | Mechanism |
| --- | --- | --- |
| Text search | Fahrten | URL-driven filters in `TripsListingPage` / `searchParamsCache`; `TripsFiltersBar`; trip columns with search |
| Column sorting | Fahrten, Regelfahrten | `getSortingStateParser` + allowed column id `Set`; URL `sort` param; Regelfahrten uses `RECURRING_RULES_SORT_COLUMN_IDS` from `src/features/recurring-rules/lib/recurring-rules-sort-column-ids.ts` (separate from `'use client'` columns so RSC gets a real `Set`) |
| Pagination | Both | `page`, `perPage` via table URL state; RSC applies slice for Regelfahrten |
| Active/inactive | Fahrten | `status` and other filters on trips |
| Active/inactive (rules) | Regelfahrten | **`is_active`** column is **sortable** and shown as badges; **no** dedicated toolbar filter (`enableColumnFilter` not set on that column). Could reuse `DataTableToolbar` column `meta` + filter variant later. |

Reference plan for unifying table filtering: `.cursor/plans/unified-table-filtering_40fc9587.plan.md`.

### 3.4 Edit flow entry point (Question 12)

- **Existing:** `RecurringRuleSheet` (overlay) and `RecurringRulePanel` (Miller column with `ruleId`) live on the **client** detail flow; both use `RecurringRuleFormBody` and `recurringRulesService` mutations.
- **Overview today:** Read-only navigation: **Fahrgast** column links to **`/dashboard/clients/{id}`** (`recurring-rules-columns.tsx`). Users edit rules from the client screen (matches product copy in `docs/features/recurring-rules-overview.md`).

**Recommendation:** Keep **deep link to client** as the primary edit path for consistency with billing reference data (`useTripFormData`) and a single place for create/edit. Optional enhancement: add **`?ruleId=`** (or `?rule=new`) when the Miller **ClientDetailPanel** + `RecurringRulePanel` flow is the active UX, so the overview opens the right column—only if that orchestration is already stable for direct links.

---

## 4. Docs & Existing Plans

### 4.1 Documentation in `docs/` (Question 13)

Relevant files (non-exhaustive; grep for recurring / client / cron):

| Path | Topic |
| --- | --- |
| `docs/plans/recurring-rules-overview-audit.md` | This audit |
| `docs/features/recurring-rules-overview.md` | Implemented overview feature |
| `docs/clients.md` | Clients module |
| `docs/client-price-tags.md` | Client pricing |
| `docs/trip-client-linking.md` | Trip–client linking |
| `docs/billing-families-variants.md` | `recurring_rules` billing FKs, list UI reference |
| `docs/kts-architecture.md` | KTS + recurring / cron mentions |
| `docs/trip-linking-and-cancellation.md` | Recurring cron, exceptions |
| `docs/trip-detail-sheet-editing.md` | Recurring scope dialog |
| `docs/trip-reschedule-v1.md` | Non-recurring reschedule; recurring notes |
| `docs/trips-rueckfahrt-detail-sheet.md` | Rückfahrt vs recurring |
| `docs/trips-duplicate.md` | Duplicates vs `recurring_rules` |
| `docs/no-invoice-required.md` | Mirror on `recurring_rules` |
| `docs/fremdfirma.md` | Mirror on `recurring_rules` |
| `docs/driving-metrics-api.md` | Cron / materialization |
| `docs/address-autocomplete.md` | Recurring rule addresses |
| `docs/access-control.md` | Cron `generate-recurring-trips`, RLS overview |
| `docs/panel-layout-system.md` | Recurring rule panel / form body |

### 4.2 `.cursor/plans/` — pending / in-progress touching recurring, clients, or trips (Question 14)

Workspace: `taxigo_admin/.cursor/plans/`. Plans use YAML `todos[].status: pending` (no top-level plan status). The following include **pending** todos and mention **recurring rules**, **clients**, or **trips** (or tightly related tables):

| File | Relevance |
| --- | --- |
| `refine-client-recurring-trip-behavior_71404970.plan.md` | Recurring rules, client UI, cron, dashboard widgets — **all todos pending** |
| `kts_document_workflow.plan.md` | KTS + recurring CSV/cron — pending todos |
| `unified-table-filtering_40fc9587.plan.md` | Trips table / shared filtering — pending |
| `billing_families_variants_98fd187b.plan.md` | `trips`, billing variants — pending |
| `driver_access_control_5f3a39ae.plan.md` | Trips RLS, clients — pending |
| `kanban_reliability_fixes_53407cfc.plan.md` | Trips board — pending (if present) |
| `trip_client_id_enrichment_f1339445.plan.md` | Trips — check if still pending |

Many other plans also have `status: pending` on todos but are unrelated (PDF, Angebote, etc.). For a full list of pending todo lines, ripgrep: `status: pending` under `.cursor/plans/`.

---

## 5. Senior Recommendation

### A. Minimum data layer changes (historical vs current)

**Originally:** Extend reads with a company-safe, unscoped `SELECT` and a **`clients`** embed (or join) for display; keep mutations on `recurringRulesService` or add server actions as needed.

**As implemented:** **`getAllRules()`** in `recurring-rules.server.ts` provides the unscoped read with **`billing_variant`** + **`clients`** embeds without changing `recurring-rules.service.ts`.

**Still recommended:** Confirm **tenant scoping** in production: if `recurring_rules` has no RLS, rely on Supabase session / API boundaries or add explicit **`company_id`** filtering once the schema supports it. Add **RLS** for `recurring_rules` aligned with `clients`/`trips` if security reviews require it.

### B. Page and component architecture

The current split is sound:

- **RSC page** loads all rules once, applies guest text filter, sort, and pagination slice from URL (same manual-table contract as Fahrten).
- **Client feature module** `src/features/recurring-rules/` holds columns, overview shell, and sort-id `Set` isolated from `'use client'` column modules for RSC safety.
- **Edit/create** stays on **client detail** so `RecurringRuleSheet` / `RecurringRulePanel` keep a single source of truth with `useTripFormData` and billing UX.

### C. Risks and complexity

1. **RLS gap on `recurring_rules`:** If policies are missing in production, data exposure depends entirely on who can authenticate as admin and on PostgREST defaults. Track explicitly in security review.
2. **Performance:** Loading **all** rules into the RSC for filter/sort works until row counts grow large; then move filtering/sorting to SQL or a materialized view and keep URL state as the contract.
3. **Company isolation:** Base `RecurringRule` row has no `company_id`; `getAllRules()` trusts the database session. Verify joins do not leak other tenants if RLS on related tables is asymmetric.
4. **UX gap:** Overview has **guest text search** and **sort**; **active-only** toolbar filter and inline edit are not implemented—product can add `nuqs` param + RSC filter and/or sheet from row later.
5. **Type/bundle hygiene:** If client code ever imports server modules accidentally, extract shared **`import type`**-only types per `docs/features/recurring-rules-overview.md`.

---

## Files read (audit trail)

- `src/features/trips/api/recurring-rules.service.ts`, `recurring-rules.server.ts`
- `src/features/trips/hooks/use-trip-form-data.ts`
- `src/features/trips/types/trip-form-reference.types.ts`
- `src/features/trips/lib/recurring-return-mode.ts`, `format-billing-display-label.ts`
- `src/features/clients/lib/build-recurring-rule-payload.ts`
- `src/features/clients/components/recurring-rule-billing-fields.tsx`, `recurring-rule-form-body.tsx` (structure + key exports), `recurring-rules-list.tsx`, `recurring-rule-sheet.tsx`, `recurring-rule-panel.tsx` (partial + docblock)
- `src/features/recurring-rules/components/recurring-rules-columns.tsx`, `recurring-rules-overview.tsx`
- `src/app/dashboard/regelfahrten/page.tsx`, `trips/page.tsx`, `clients/[id]/page.tsx`, `layout.tsx`, `page.tsx`
- `src/config/nav-config.ts`, `src/components/layout/app-sidebar.tsx`
- `src/features/trips/components/trips-listing.tsx`, `trips-tables/index.tsx`
- `src/types/database.types.ts` (excerpt `recurring_rules`)
- `supabase/migrations` (grep `recurring_rules`, `20260409170000_add_missing_rls.sql`)
- `docs/access-control.md`, `docs/features/recurring-rules-overview.md`, plus grep across `docs/*.md`
- `.cursor/plans/*.plan.md` (grep recurring / pending)
