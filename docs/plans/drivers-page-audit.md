# Audit: `/dashboard/drivers` — Full Feature Inventory for Merge Planning

**Date:** 2026-05-20  
**Mode:** Read-only (no code changes)  
**Scope:** Driver-management feature vs user-management page, APIs, query keys, docs.

---

## 1. Drivers page — full feature inventory

**Route:** only [`src/app/dashboard/drivers/page.tsx`](../../src/app/dashboard/drivers/page.tsx) (no sub-routes under `src/app/dashboard/drivers/`).

### 1.1 Table columns (table view)

Defined in [`src/features/driver-management/components/drivers-table/columns.tsx`](../../src/features/driver-management/components/drivers-table/columns.tsx). Data is loaded in [`driver-table-listing.tsx`](../../src/features/driver-management/components/driver-table-listing.tsx) from **`accounts`** only (no `driver_profiles` join in the list query).

| Column (header) | `id` / accessor | Data source | Notes |
| --- | --- | --- | --- |
| Name | `name` / `accessorFn: getDisplayName` | **`accounts`** | Computed: `first_name` + `last_name` if either set, else `accounts.name` |
| E-Mail | `email` | **`accounts.email`** | Cached column, not live Auth |
| Rolle | `role` | **`accounts.role`** | Raw text, `capitalize` in cell |
| Telefon | `phone` | **`accounts.phone`** | |
| Status | `is_active` | **`accounts.is_active`** | “Aktiv” / “Inaktiv” (colored span) |
| (actions) | `actions` | — | [`CellAction`](../../src/features/driver-management/components/drivers-table/cell-action.tsx) |

**Not shown in the table:** any `driver_profiles` field (license, vehicle, address).

### 1.2 Filters and search

| Context | Mechanism | Details |
| --- | --- | --- |
| **Table view** | URL + server query | [`DriverTableListing`](../../src/features/driver-management/components/driver-table-listing.tsx): `page`, `perPage` via [`searchParamsCache`](../../src/lib/searchparams.ts); text search from `name` **or** `search` param; `.or()` on `name`, `first_name`, `last_name`, `email`; sort via `sort` + [`getSortingStateParser`](../../src/lib/parsers.ts), whitelist `SORTABLE_COLUMNS` including `company_id`. **No** `role` filter (query hard-codes `.eq('role', 'driver')`). **No** explicit `is_active` filter in listing — inactive drivers appear in the table. |
| **Table view** | Client (TanStack) | [`DriverTable`](../../src/features/driver-management/components/drivers-table/index.tsx) + [`DataTableToolbar`](../../src/components/ui/table/data-table-toolbar.tsx): column filters enabled for **Name**, **E-Mail**, **Rolle** (`enableColumnFilter: true` in column defs). These operate on the **current page** of rows (manual server pagination). |
| **Columns view** | Client | [`DriverListPanel`](../../src/features/driver-management/components/driver-list-panel.tsx): debounced search (250ms) passed to `driversService.getDrivers({ search, includeInactive: true, limit: 200 })`. |

**View toggle:** [`DriversViewToggle`](../../src/features/driver-management/components/drivers-view-toggle.tsx) — nuqs `view`: `columns` (default) vs `table` (`shallow: false`).

### 1.3 Row actions

From [`cell-action.tsx`](../../src/features/driver-management/components/drivers-table/cell-action.tsx):

| Action | Behavior | API / service |
| --- | --- | --- |
| **Bearbeiten** | Opens sheet via `useDriverFormStore.openForEdit(data)` | No direct HTTP call from cell; form submits `PATCH /api/drivers/[id]` (see §1.5) |
| **Deaktivieren** | `AlertModal` confirm | [`driversService.deactivateDriver(id)`](../../src/features/driver-management/api/drivers.service.ts) → `updateDriver` → **`accounts` only** (`is_active: false`). **Does not** call `PATCH /api/users/.../status` or Auth ban. |
| After deactivate | `router.refresh()` | RSC table refetch |

**No** per-row “view profile” route; **no** bulk actions.

### 1.4 Create driver flow

- **Entry:** [`DriverCreateButton`](../../src/features/driver-management/components/driver-create-button.tsx) (table view header only) or **Neuer Fahrer** in columns list ([`DriverListPanel`](../../src/features/driver-management/components/driver-list-panel.tsx) `onNew` → `driverId=new`).
- **Form:** [`DriverFormBody`](../../src/features/driver-management/components/driver-form-body.tsx) in [`DriverForm`](../../src/features/driver-management/components/driver-form.tsx) (sheet) or [`DriverDetailPanel`](../../src/features/driver-management/components/driver-detail-panel.tsx) (columns).

**Create mode fields** (all in form; submit via `fetch`):

| Field | Required | API |
| --- | --- | --- |
| `email` | Yes | `POST /api/drivers/create` |
| `password` | Yes | same |
| `first_name` / `last_name` / `name` | Display name required (refine) | same |
| `phone` | No | same |
| `role` | No (default `driver`) | same — can be `driver` or `admin` |
| `license_number`, `default_vehicle_id` | No | same (creates `driver_profiles` when `role === 'driver'`) |
| Address block (`street`, `street_number`, `zip_code`, `city`, `lat`, `lng`) | No | **Not sent on create** — create JSON only includes fields listed in `driver-form-body.tsx` create branch; address is **edit-only** in the same form component |

**API:** [`POST /api/drivers/create`](../../src/app/api/drivers/create/route.ts) — `auth.admin.createUser`, insert `accounts`, optional `driver_profiles`.

### 1.5 Edit driver flow

- **Submit:** [`DriverFormBody`](../../src/features/driver-management/components/driver-form-body.tsx) `PATCH /api/drivers/${id}` with body: `name`, `first_name`, `last_name`, `phone`, `role`, `license_number`, `default_vehicle_id`, address fields, `lat`, `lng`. **Email is not sent** (read-only in edit UI).

**API:** [`PATCH /api/drivers/[id]`](../../src/app/api/drivers/[id]/route.ts) — `update_driver` RPC (updates `accounts` + `driver_profiles`).

**Read-only in UI:** `email` ([`driver-form-body.tsx`](../../src/features/driver-management/components/driver-form-body.tsx) `readOnly` + `bg-muted`).

**Note:** [`driver-form.tsx`](../../src/features/driver-management/components/driver-form.tsx) header comment says edit uses `driversService.updateDriver + upsertDriverProfile`; **actual implementation** is the **PATCH API** only (comment is stale).

### 1.6 `driver_profiles` data on the drivers page

**List/table:** **No** — query selects only `accounts` columns.

**Create:** `license_number`, `default_vehicle_id` sent to create API.

**Edit / detail:** [`getDriverById`](../../src/features/driver-management/api/drivers.service.ts) loads `accounts.*` + `driver_profiles` (`select('*')`). [`DriverFormBody`](../../src/features/driver-management/components/driver-form-body.tsx) binds profile fields: **license_number**, **default_vehicle_id**, **street**, **street_number**, **zip_code**, **city**, **lat**, **lng**.

**Not exposed in UI** from `driver_profiles` (per `database.types.ts` / schema): e.g. **`notes`**, **`created_at`**, **`id`** (profile row id).

### 1.7 Bulk actions

**None** — no bulk delete, export, or multi-select on `/dashboard/drivers`.

### 1.8 Detail / drill-down

**No separate route** (e.g. `/dashboard/drivers/[id]`).

**Columns view** ([`DriversColumnView`](../../src/features/driver-management/components/drivers-column-view.tsx)): Miller columns with [`DriverListPanel`](../../src/features/driver-management/components/driver-list-panel.tsx) + [`DriverDetailPanel`](../../src/features/driver-management/components/driver-detail-panel.tsx). Selection via URL key `driverId` ([`useColumnNavigation`](../../src/hooks/use-column-navigation.ts) with `COLUMN_KEYS = ['driverId']`). Detail shows the same **DriverFormBody** (create/edit) — full profile + address + license + vehicle, not a read-only profile page.

---

## 2. Users page — current state

**Page:** [`src/app/dashboard/users/page.tsx`](../../src/app/dashboard/users/page.tsx) — [`UsersTable`](../../src/features/user-management/components/users-table.tsx).

### 2.1 Columns

Data from **`GET /api/users`** ([`src/app/api/users/route.ts`](../../src/app/api/users/route.ts)): `accounts` row fields merged with **live** email from `auth.admin.getUserById`. Type [`CompanyUser`](../../src/features/user-management/types.ts).

| Column | Data source |
| --- | --- |
| Name | Computed: `last_name, first_name` if present, else `accounts.name` |
| E-Mail | **`auth.users` (via Admin API)** — not `accounts.email` |
| Rolle | **`accounts.role`** → badge “Admin” / “Fahrer” |
| Status | **`accounts.is_active`** → badge “Aktiv” / “Inaktiv” |
| Aktionen | — |

**Not shown:** `phone`, `company_id`, `created_at` (API returns `phone`, `created_at` but UI omits them).

### 2.2 Row actions

| Action | Mutation / API |
| --- | --- |
| Zugangsdaten bearbeiten | [`useUpdateCredentials`](../../src/features/user-management/api/users.service.ts) → `PATCH /api/users/[id]/credentials` |
| Deaktivieren / Reaktivieren (hidden for self) | [`useUpdateStatus`](../../src/features/user-management/api/users.service.ts) → `PATCH /api/users/[id]/status` ( **`is_active` + Auth ban/unban** ) |

### 2.3 Missing on users page vs drivers page

| Drivers have | Users lack |
| --- | --- |
| **Create** user (`POST /api/drivers/create`) | No create flow |
| **Miller columns** + list/detail layout | Single full-width table only |
| **Table vs columns** view toggle | No view modes |
| **TanStack Table** + pagination + column filters + `DataTableToolbar` / `DataTableViewOptions` | Plain shadcn `Table`, no pagination (full list in one response) |
| **Edit profile:** name, phone, role, license, vehicle, address via `PATCH /api/drivers/[id]` | No profile edit |
| **Telefon** column | Not displayed (data available from API) |
| **Cached** `accounts.email` in table | Live Auth email only |
| **Deactivate** without Auth ban | Users page uses **ban** + `is_active` |
| **Dropdown** row actions (`CellAction`) | Icon buttons + credentials dialog |
| **Server-driven** search/sort/pagination for table view | Client `useQuery` only |

---

## 3. Data model delta

### 3.1 Fields on drivers but not meaningful for “admin-only” rows

**Table `driver_profiles`** (all columns are driver-specific; typically **no row** or unused for `role = 'admin'`):

- `id`, `user_id`, `created_at`, `license_number`, `default_vehicle_id`, `notes`
- Address: `street`, `street_number`, `zip_code`, `city`, `lat`, `lng`

**`accounts`:** same columns for driver and admin per [`docs/accounts-table.md`](../accounts-table.md); no driver-only columns on `accounts` beyond **semantic** use (e.g. admins rarely have `driver_profiles`).

### 3.2 Unified table: empty / N/A for admin rows

If you add driver-only columns: **Führerschein**, **Standard-Fahrzeug**, **Adresse** (from `driver_profiles`) would be **empty or “—”** for admins (unless legacy data has a profile row).

### 3.3 Driver-only actions

- **Assign vehicle / license / driver address** — meaningless for admins who do not drive.
- **“Deaktivieren” for trip assignment”** wording in drivers modal refers to **trip assignment**; for admins the same flag still affects **login** only on users page if unified with ban semantics.

Product features like **Schicht**, **Touren**, **live_locations** are **not** actions on `/dashboard/drivers`; they live in **driver-portal**. No conflict for “admin row” on a merged **admin** roster page unless you add deep links to driver-only apps.

---

## 4. Create flow

### 4.1 Current gap

- **Drivers:** full create via `POST /api/drivers/create` (supports `role: 'admin'` in API body today).
- **Users:** no UI create ([`docs/user-management.md`](../user-management.md) deferred).

### 4.2 Merged page: one form vs two

| Approach | Create admin | Create driver |
| --- | --- | --- |
| **Single form + role** | Same as today: `email`, `password`, names, `role: 'admin'` — **omit** `driver_profiles` insert (already how API behaves for admin) | `role: 'driver'` + optional `license_number`, `default_vehicle_id` |
| **Separate entry points** | “Neuer Admin” — minimal fields | “Neuer Fahrer” — existing **DriverFormBody** create branch + optional profile fields |

**Recommendation for clarity:** keep **one POST** (`/api/drivers/create` or renamed `/api/users`) but **two UX paths** (tabs or buttons) so driver create keeps license/vehicle defaults without exposing them for admin-only creates.

### 4.3 “Create admin” vs “create driver” fields

| Field | Admin | Driver |
| --- | --- | --- |
| email, password | Yes | Yes |
| name / first / last | Yes | Yes |
| phone | Optional | Optional |
| role | `admin` | `driver` |
| license_number, default_vehicle_id | No | Optional |
| Address block | Not on create today | Edit only today; could add later |

---

## 5. Component reuse assessment

### 5.1 Reuse with little or no change

- [`DataTableSkeleton`](../../src/components/ui/table/data-table-skeleton.tsx) — already used by both.
- [`PageContainer`](../../src/components/layout/page-container.tsx).
- **Patterns:** `DriverFormBody` field blocks could be **composed** into a larger page (still driver-management-owned).

### 5.2 Extend or wrap

- [`DriverTable`](../../src/features/driver-management/components/drivers-table/index.tsx) / [`columns.tsx`](../../src/features/driver-management/components/drivers-table/columns.tsx) — tightly coupled to `DriverWithProfile`, `role === 'driver'` listing, and **cached** email; merged view would need **new column defs** or conditional columns for Auth email + admin rows.
- [`CellAction`](../../src/features/driver-management/components/drivers-table/cell-action.tsx) — tied to deactivate **without** ban; would need alignment with [`useUpdateStatus`](../../src/features/user-management/api/users.service.ts) or shared policy.
- [`EditCredentialsDialog`](../../src/features/user-management/components/edit-credentials-dialog.tsx) — could be reused from driver edit if email/password editing moves here.

### 5.3 Rewritten / new glue

- [`UsersTable`](../../src/features/user-management/components/users-table.tsx) — simple HTML table; a merged TanStack setup would likely **replace** it rather than merge line-by-line.
- **RSC listing** (`DriverTableListing`) vs **client** `useUsers` — architectural choice; unification implies either moving drivers to client query or users to RSC.

### 5.4 Shared table primitive

- **Drivers (table view):** [`DataTable`](../../src/components/ui/table/data-table.tsx) + [`useDataTable`](../../src/hooks/use-data-table.ts).
- **Users:** [`Table`](../../src/components/ui/table.tsx) primitives only — **not** the same `DataTable` wrapper.

---

## 6. Route and query key conflicts

### 6.1 Key strings

| Key factory | Tuple |
| --- | --- |
| `userKeys.list()` | `['users', 'list']` — [`src/query/keys/users.ts`](../../src/query/keys/users.ts) |
| `referenceKeys.drivers()` | `['reference', 'drivers']` — [`src/query/keys/reference.ts`](../../src/query/keys/reference.ts) |

**No shared prefix** — `invalidateQueries` on one does **not** hit the other by accident.

### 6.2 Driver page and React Query

**`/dashboard/drivers` does not use** `userKeys` or `useUsers`. List data:

- **Table:** RSC + `router.refresh()` after mutations.
- **Columns:** `driversService.getDrivers` + `window.__refreshDriverList` hack.

**`useUpdateStatus` on users** invalidates `userKeys.list()` **and** `referenceKeys.drivers()` so **trip filters / Kanban driver pickers** refresh when `is_active` or ban changes — **does not** auto-refresh the Fahrer RSC table (still relies on navigation or manual refresh unless you add invalidation listeners).

**Merging pages:** if driver list moves to React Query with `referenceKeys.drivers()` or a new key, align invalidation across **credentials**, **status**, and **driver profile PATCH** so one source of truth updates all pickers + roster.

---

## 7. Senior recommendation

### 7.1 Semantic inconsistency (must resolve in any merge)

- **Fahrer “Deaktivieren”:** `accounts.is_active` only — user may **still sign in** unless separately banned.
- **Benutzer status toggle:** `is_active` **+** GoTrue **ban**.

A merged experience should **pick one policy** (almost certainly **ban + flag** everywhere) or admins will see divergent behavior between tabs.

### 7.2 Approach comparison

| Approach | Duplication | Regression risk | Notes |
| --- | --- | --- | --- |
| **A — Tabs** | Two feature modules + tab shell; some duplicate concepts (two tables) | **Low** — driver code paths untouched | Users tab = current `UsersTable`; Fahrer tab = embed existing column or table view. Still two nav entries unless one is removed. |
| **B — Unified table + role filter** | **Lowest** long-term | **Highest** — pagination, filters, deactivate semantics, `driver_profiles` columns, RSC vs client | Single module; hide driver columns for admins; unify deactivate to ban. |
| **C — Redirect** | Nav can show one item; **no** duplicate page logic in React | **Lowest** — `driver-management` unchanged | e.g. `/dashboard/drivers` → `/dashboard/users?tab=drivers` + query drives which subtree renders. **Minimal new code:** router + tab state. |

### 7.3 Recommendation

**Prefer C (redirect + query-driven tab)** or **A (explicit tabs on `/dashboard/users`)** for **fast merge with least regression**: keep [`driver-management`](../../src/features/driver-management/) behavior and tests stable, centralize entry in **Benutzerverwaltung**, and align **deactivate** with **`PATCH /api/users/[id]/status`** when you are ready (separate small change on `CellAction` / `deactivateDriver`).

Choose **B** only as a **second-phase** consolidation after ban semantics and data loading are unified; it minimizes duplication but touches the most surface area (TanStack + RSC + forms + API).

---

## Reference index

| Area | Paths |
| --- | --- |
| Drivers app route | `src/app/dashboard/drivers/page.tsx` |
| Driver feature | `src/features/driver-management/**` |
| Driver APIs | `src/app/api/drivers/create/route.ts`, `src/app/api/drivers/[id]/route.ts` |
| Users app route | `src/app/dashboard/users/page.tsx` |
| Users feature | `src/features/user-management/**` |
| Users APIs | `src/app/api/users/route.ts`, `.../credentials/route.ts`, `.../status/route.ts` |
| Query keys | `src/query/keys/users.ts`, `reference.ts`, `index.ts` |
| Nav | `src/config/nav-config.ts` |
| Docs | `docs/driver-system.md`, `docs/user-management.md`, `docs/accounts-table.md` |
