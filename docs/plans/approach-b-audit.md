# Audit: Approach B Feasibility — Extend Driver Feature to Cover All Roles

**Date:** 2026-05-20  
**Mode:** Read-only (no code changes)  
**Scope:** Feasibility of unifying `/dashboard/users` into an extended `driver-management` feature per the planned Approach B context.

---

## 1. Listing query — removing the role filter

### 1.1 Exact queries with `.eq('role', 'driver')`

There are **two** independent listing queries (table RSC vs columns client service). Neither joins `driver_profiles`.

#### A. Table view (RSC) — `driver-table-listing.tsx`

```34:65:src/features/driver-management/components/driver-table-listing.tsx
  let query = supabase
    .from('accounts')
    .select(
      'id, name, first_name, last_name, email, role, phone, company_id, is_active',
      { count: 'exact' }
    )
    .eq('role', 'driver');

  if (search) {
    const term = `%${search}%`;
    query = query.or(
      `name.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`
    );
  }

  const parsed =
    getSortingStateParser().parseServerSide(sortParam ?? undefined) || [];
  const sorting = parsed.filter(
    (s: { id: string; desc: boolean }) =>
      s?.id && typeof s.id === 'string' && SORTABLE_COLUMNS.has(s.id)
  );
  if (sorting.length > 0) {
    sorting.forEach((sortRule: { id: string; desc: boolean }) => {
      query = query.order(sortRule.id, { ascending: !sortRule.desc });
    });
  } else {
    query = query.order('name', { ascending: true });
  }

  const from = (page - 1) * perPage;
  const to = from + perPage - 1;
  query = query.range(from, to);
```

**Chained on the same query:**

| Step | Source | Detail |
| --- | --- | --- |
| Base filter | Line 40 | `.eq('role', 'driver')` |
| Search | Lines 42–46 | `searchParamsCache` `name` or `search` → `.or()` ilike on `name`, `first_name`, `last_name`, `email` |
| Sort | Lines 49–61 | `sort` URL param via `getSortingStateParser()`; whitelist `SORTABLE_COLUMNS` (lines 15–24) |
| Pagination | Lines 63–65 | `page`, `perPage` from `searchParamsCache` → `.range(from, to)` |
| Count | Line 38 | `{ count: 'exact' }` |

**Not applied in table listing:** `is_active` filter, explicit `company_id` (tenant scoping relies on Supabase RLS).

#### B. Columns view (client) — `drivers.service.ts` `getDrivers()`

```33:58:src/features/driver-management/api/drivers.service.ts
    let query = supabase
      .from('accounts')
      .select(
        'id, name, first_name, last_name, email, role, phone, company_id, is_active',
        { count: 'exact' }
      )
      .eq('role', 'driver');

    if (!filters?.includeInactive) {
      query = query.eq('is_active', true);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.or(
        `name.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`
      );
    }

    query = query.order('name', { ascending: true });

    if (filters?.page && filters?.limit) {
      const from = (filters.page - 1) * filters.limit;
      const to = from + filters.limit - 1;
      query = query.range(from, to);
    }
```

**Chained:** role filter → optional `is_active` (default active-only unless `includeInactive: true`) → search `.or()` → `order('name')` → optional `range`.  
**Columns panel usage** (`driver-list-panel.tsx` lines 39–43): `includeInactive: true`, `limit: 200`, no `page` — so up to 200 rows, inactive included, no server sort param.

### 1.2 `driver_profiles` join in listing

**No.** Both listing paths select **`accounts` columns only**. Comment in `drivers.service.ts` lines 25–26 explicitly omits `driver_profiles` “to avoid RLS/join issues.”

Removing `.eq('role', 'driver')` does **not** change join behavior — there is no join to fail for admin rows without a profile row.

### 1.3 Return type

```17:20:src/features/driver-management/types.ts
export interface DriverWithProfile extends User {
  driver_profiles?: DriverProfile | DriverProfile[] | null;
}
```

Listing casts rows as `DriverWithProfile[]` but **`driver_profiles` is absent** on list rows (undefined). Admin rows are still valid: `DriverWithProfile` is `User` + optional profile; null/undefined profile is already allowed by the type.

### 1.4 Files to change if role filter is removed and a role URL param is added

| File | Change |
| --- | --- |
| `src/lib/searchparams.ts` | Add `role` (e.g. `parseAsString` or enum: absent = all, `admin`, `driver`). |
| `src/features/driver-management/components/driver-table-listing.tsx` | Remove line 40 hard-code; when `role` param set, `.eq('role', role)`; optionally `.eq('company_id', …)` if mirroring `GET /api/users` (RLS may suffice). |
| `src/features/driver-management/api/drivers.service.ts` | Same conditional `.eq('role', …)` in `getDrivers`; extend `GetDriversFilters` with `role?: 'admin' \| 'driver'`. |
| `src/features/driver-management/components/driver-list-panel.tsx` | Pass role filter into `getDrivers` (read from nuqs or props). |
| `src/features/driver-management/components/drivers-table/index.tsx` | Add toolbar **children** (or extend `DataTableToolbar`) for “Alle / Admins / Fahrer” — not via column `meta.variant` (driver columns lack `meta.variant`; see §5 note in drivers-page-audit). |
| `src/app/dashboard/drivers/page.tsx` (later `/dashboard/users`) | Ensure `searchParamsCache.parse` includes new `role` key. |
| `GET /api/users/route.ts` (if listing moves to API) | Accept `role`, `page`, `perPage`, `search`, `sort` query params. |

---

## 2. Column defs — admin rows with null `driver_profiles`

### 2.1 `driver_profiles` accessors in `columns.tsx`

**None.** Every column reads **`accounts`** fields only:

| Column `id` | Accessor / cell source |
| --- | --- |
| `name` | `getDisplayName(row.original)` — `first_name`, `last_name`, `name` |
| `email` | `row.original.email` (cast) |
| `role` | `row.original.role` |
| `phone` | `row.original.phone` |
| `is_active` | `row.original.is_active` |
| `actions` | `CellAction` with full row |

No `driver_profiles?.…` anywhere in `columns.tsx`.

### 2.2 Table vs form / detail

- **Table list view:** columns above only — safe for admins without profiles.
- **Edit form / detail:** `driver-form-body.tsx` reads `initialData.driver_profiles` (lines 137–171) when `mode === 'edit'`; `driver-detail-panel.tsx` loads via `getDriverById()` which attaches `driver_profiles` as array (may be empty `[]`).

### 2.3 Render errors today?

**Table:** No — no profile fields rendered.  
**Form:** Uses optional chaining / fallbacks (`p?.street ?? ''`, etc.). Empty profile for admin → empty strings, not a crash.  
**Risk is behavioral, not render:** saving an admin edit still POSTs profile fields to `PATCH /api/drivers/[id]` → `update_driver` RPC (see §8).

---

## 3. Form — create and edit for admin rows

### 3.1 Role-conditional fields in `driver-form-body.tsx`

**None.** All fields are always rendered for both create and edit:

- Create: email, password, first/last name, phone, **role** select (`driver` \| `admin`), license, vehicle, address block.
- Edit: read-only email, phone, role, license, vehicle, address — **no** `{role === 'driver' && …}` guards.

Default role: **`'driver'`** (lines 111, 181).

### 3.2 Recommended visibility when editing an admin

| Keep visible | Hide for `role === 'admin'` (driver-only) |
| --- | --- |
| Vorname, Nachname | Führerscheinnummer |
| E-Mail (read-only today) | Standard-Fahrzeug |
| Telefon | Adresse block (street, number, PLZ, city) |
| Rolle | — |

Credentials editing is **not** in this form today; planned via `EditCredentialsDialog` in `CellAction`.

### 3.3 Create admin today

| Layer | Supports admin? |
| --- | --- |
| **API** `POST /api/drivers/create` | Yes — `role?: 'driver' \| 'admin'`; `driver_profiles` insert only when `role === 'driver'` (lines 116–136). |
| **UI** | Role select includes Admin (lines 416–418); default remains Fahrer. |
| **UX gap** | Copy says “Neuer Fahrer” / “Fahrer wurde erstellt”; license/vehicle/address still visible for admin create — confusing but functional. |

**To make “create admin” usable:** hide driver-only fields when `role === 'admin'` (watch `form.watch('role')`); adjust button labels; optionally split “Neuer Admin” vs “Neuer Fahrer” entry points; keep same POST endpoint.

---

## 4. CellAction — adding credentials edit

### 4.1 Current actions (exact list)

From `cell-action.tsx` dropdown (`DropdownMenuLabel` “Aktionen”):

1. **Bearbeiten** — `openForEdit(data)` via `useDriverFormStore` (lines 68–70). Shown always.
2. **Deaktivieren** — opens `AlertModal`, then `driversService.deactivateDriver(data.id)` (lines 71–77). **Only if** `data.is_active` (lines 71–78).

No reactivate action, no credentials action, no self-row guard.

### 4.2 `EditCredentialsDialog` reusability

**Props** (`edit-credentials-dialog.tsx` lines 29–33):

```typescript
export interface EditCredentialsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: CompanyUser | null;
}
```

**Dependencies:**

- `useUpdateCredentials()` from `@/features/user-management/api/users.service` (invalidates `userKeys.list()` only).
- Type `CompanyUser` from `@/features/user-management/types`.

**Self-contained UI:** Yes — dialog + form are isolated; no UsersTable dependency.

**Import into `cell-action.tsx`:** Feasible if row type supplies `{ id, email }` (and ideally live email). Map `DriverWithProfile` → `CompanyUser` shape at call site, or widen dialog prop to `{ id: string; email: string | null }`.

**Caveat:** Keeping the hook in `user-management/api/users.service.ts` ties driver feature to that module until hooks move to a shared `company-users` API module.

### 4.3 State conflicts

- **`useDriverFormStore`** (Zustand): separate concern — edit sheet vs credentials dialog; no conflict.
- **`window.__refreshDriverList`**: only used by columns list, not CellAction.
- **No React Query** on driver table today — credentials mutation should add `router.refresh()` for table RSC **and** optional list refresh for columns view.

---

## 5. Live Auth email in the driver listing

### 5.1 Current behavior

- **Table:** `accounts.email` from Supabase select (`driver-table-listing.tsx` line 37).
- **Columns list:** same via `drivers.service.ts` line 36.
- **`GET /api/users`:** loads all company `accounts` rows, then **per row** `auth.admin.getUserById` for live email (`route.ts` lines 38–55). **No** pagination, search, or sort query params.

### 5.2 Can `DriverTableListing` call `GET /api/users` as-is?

**Not without breaking table behavior:**

| Capability | `DriverTableListing` (today) | `GET /api/users` (today) |
| --- | --- | --- |
| Server pagination | `page`, `perPage`, `range` | Full list in one response |
| Server sort | `sort` URL → multiple `.order()` | Fixed `order('name')` |
| Server search | `name`/`search` → `.or()` ilike | None |
| Role filter (planned) | Would be `.eq('role', …)` | All roles in company |
| Live email | No | Yes |

Swapping to client-side `useUsers()` + TanStack manual pagination would **abandon RSC listing** and load **all users** into the browser — regression for large orgs.

### 5.3 Minimal change — lower risk for RSC architecture

**Recommend (a): extend server listing API**, not (b) full client React Query roster.

Concrete options (in order of fit):

1. **Extend `GET /api/users`** with query params: `page`, `perPage`, `search`, `sort`, `role` — implement DB query + **paginated** `getUserById` only for the current page (e.g. 10 Auth calls per page). Wire `DriverTableListing` to `fetch` this route in the RSC (or shared server helper).
2. **New** `GET /api/users/list` dedicated to TanStack URL contract — same implementation, keeps backward-compatible full list if needed.

**(b) Client-only `useUsers()`** is higher risk: memory, stale pagination, loss of server-side sort/search unless API is extended anyway.

**Columns view:** `driversService.getDrivers` would need the same live-email merge (call paginated API or a “list slice” endpoint) — cannot rely on cached `accounts.email` after Approach B goal #8.

---

## 6. Query key and cache strategy

### 6.1 After retiring `UsersTable`

| Mutation | Today invalidates | Should invalidate (unified roster) |
| --- | --- | --- |
| `useUpdateStatus` | `userKeys.list()`, `referenceKeys.drivers()` | **`referenceKeys.drivers()`** (trip pickers — still `role=driver`, `is_active=true`) **plus** roster list key **plus** `router.refresh()` for RSC table |
| `useUpdateCredentials` | `userKeys.list()` only | Roster list key + `router.refresh()` (email column) |

**Roster key recommendation:** Keep `userKeys.list()` as the canonical company roster key (already documented in `src/query/keys/users.ts` and `src/query/README.md`), optionally extend to `userKeys.list({ page, search, role })` if the API becomes parametric. Alternatively rename to `companyUsersKeys` when retiring `user-management` folder — not required for correctness.

**Driver feature does not register** a React Query key for the table or columns list today.

### 6.2 `DriverListPanel` and `window.__refreshDriverList`

**Still present** (`driver-list-panel.tsx` lines 69–74):

```typescript
(window as any).__refreshDriverList = () => fetchDrivers(debouncedSearch);
```

`DriverDetailPanel` calls it after create (lines 67–68). **`CellAction` does not** — table uses `router.refresh()` only after deactivate.

**For Approach B:** Yes — replace hack as part of the plan if columns view stays:

- Move list fetch to React Query with `userKeys.list()` / parametric variant, **or**
- Call the same refresh callback via a small Zustand/context “roster invalidation” bus, **or**
- Use `router.refresh()` if columns data is lifted to RSC (larger refactor).

Status/credentials mutations from `CellAction` must refresh **both** table (RSC) and columns (today: manual refetch).

---

## 7. Rename and redirect

### 7.1 Current drivers page path

**`src/app/dashboard/drivers/page.tsx`** — sole route file under `src/app/dashboard/drivers/`.

### 7.2 Hardcoded `/dashboard/drivers` (application code)

| File | Line(s) | Notes |
| --- | --- | --- |
| `src/config/nav-config.ts` | 103 | Nav item “Fahrer” |
| `src/features/driver-management/components/driver-table-listing.tsx` | 6 | Comment |
| `src/features/driver-management/components/drivers-table/columns.tsx` | 5 | Comment |
| `src/features/driver-management/components/drivers-table/index.tsx` | 5 | Comment |
| `src/features/driver-management/components/drivers-column-view.tsx` | 7 | Comment |
| `src/hooks/use-column-navigation.ts` | 52 | **Example** in JSDoc only |

**Not found in:** `src/**/*.tsx` hrefs, `Link` components, or middleware redirects (only nav-config is a runtime route target).

Docs/plans (`docs/plans/*.md`, `docs/driver-system.md`, `implementation-suggestions/*`) also reference the path — update when renaming.

### 7.3 Tests

**No** e2e or unit test files referencing `/dashboard/drivers` (search under `**/*.{test,spec,e2e}*` returned no matches).

---

## 8. Risk assessment

### Top 3 regression risks (severity order)

| Rank | Risk | Why | File:line |
| --- | --- | --- | --- |
| **1** | **Deactivate without Auth ban** | Driver “Deaktivieren” sets `is_active: false` only; user can still sign in. Users page uses ban + rollback. Unifying UI without fixing this leaves security/ops inconsistency. | `cell-action.tsx` **35–38** (`deactivateDriver`); contrast `users/[id]/status/route.ts` **78–107** |
| **2** | **`update_driver` creates `driver_profiles` for admins** | RPC `UPDATE driver_profiles` + `INSERT` if missing runs for **every** PATCH, regardless of `accounts.role`. Editing/saving an admin with empty license/address can **create** a profile row. | `supabase/migrations/20260318130000_rename_users_to_accounts.sql` **153–167**; triggered from `driver-form-body.tsx` **244–261** |
| **3** | **Stale email in table/columns** | List uses `accounts.email`; credentials PATCH updates Auth + cache but roster won’t show new email until refetch strategy includes live Auth or cache sync. | `driver-table-listing.tsx` **37**; `GET /api/users` merge **40–43** vs driver list |

### Hidden dependencies

| Dependency | Impact |
| --- | --- |
| **`update_driver` RPC name and behavior** | Driver-centric; always upserts profile (§8 risk #2). |
| **Two listing code paths** | Table RSC vs `driversService` — must stay in sync for role filter, email, inactive rules. |
| **`referenceKeys.drivers()`** | Stays driver-only for trips (`fetchActiveDrivers` — `trip-reference-data.ts` **19–21**); admins must not appear there — OK, but status changes must still invalidate this key. |
| **Miller `driverId` URL** | Renaming route to `/dashboard/users` should keep or redirect `?driverId=` for column view bookmarks. |
| **Copy/i18n** | Page title “Fahrer”, “Neuer Fahrer”, toasts — misleading for unified roster. |
| **Self-deactivation** | Users table blocks self (`status/route.ts` **41–45**); `CellAction` does not. |
| **Column toolbar filters** | `enableColumnFilter: true` without `meta.variant` → no faceted/text filters in toolbar (`data-table-toolbar.tsx` **83**); search is server-side via `name`/`search` URL only. Role filter needs explicit toolbar control. |
| **N+1 Auth on live email** | Acceptable per page (10–50 rows); dangerous if someone wires full list without pagination. |

---

## 9. Senior recommendation

### 9.1 One phase or two?

**Split into two phases** for production safety:

| Phase | Scope |
| --- | --- |
| **Phase 1 — Behavior parity** | Unify deactivate → `PATCH /api/users/[id]/status`; add live email to **server** list API + wire table/columns; remove `role=driver` hard-code + role toolbar; add credentials + reactivate in `CellAction`; hide driver-only form fields for admins; self-deactivation guard. |
| **Phase 2 — Route/product cleanup** | Move page to `/dashboard/users`; redirect `/dashboard/drivers`; remove “Fahrer” nav; retire `src/features/user-management/` (move hooks/dialog/types into `driver-management` or `src/features/company-users`); replace `__refreshDriverList`; rename types/copy (`DriverWithProfile` → `CompanyUser` alias). |

Phase 1 can ship on `/dashboard/drivers` to limit route churn; Phase 2 is mostly navigation and deletion.

**Feasible in one plan document**, but **not** one risky big-bang deploy.

### 9.2 Highest-risk change and sequencing

**Highest risk:** **Deactivate semantics** (ban vs flag-only) — affects login security and trip assignment expectations.

**Sequence to minimize regression:**

1. Switch `CellAction` (and any other deactivate path) to `useUpdateStatus` / `PATCH /api/users/[id]/status` **before** expanding the roster to admins (same behavior for drivers, correct for admins).
2. Extend `GET /api/users` (or list helper) with pagination/search/sort/role + live email; point `DriverTableListing` at it.
3. Remove `.eq('role', 'driver')` + add role toolbar filter.
4. Guard admin form fields + fix `update_driver` / PATCH to skip profile upsert when `role = 'admin'` (DB or API — not in original plan but **required** given RPC behavior).
5. Add credentials dialog + reactivate action.
6. Route/nav rename and retire user-management UI.

### 9.3 Harder than the plan may assume

1. **`update_driver` auto-inserts `driver_profiles`** — plan item “handle null profile” is not enough; **saving** admin edits can create profiles unless RPC/API is gated.
2. **Two architectures for list data** (RSC table vs client columns) — live email and invalidation must be implemented twice or unified.
3. **`GET /api/users` is not drop-in** — needs query-param contract before table migration.
4. **`__refreshDriverList` global** — mutations from table view won’t refresh columns view without shared invalidation.
5. **Form always sends profile fields** — even with hidden UI, submit payload may need role-aware omission.

### 9.4 Recommended implementation step order

1. **Policy:** Document that roster deactivate = `PATCH /api/users/[id]/status` (ban + `is_active`).
2. **`CellAction`:** Replace `driversService.deactivateDriver` with `useUpdateStatus`; add reactivate; block self; invalidate `referenceKeys.drivers()` + `router.refresh()`.
3. **API:** Extend `GET /api/users` with `page`, `perPage`, `search`, `sort`, `role`; merge Auth email for **page rows only**.
4. **`DriverTableListing`:** Fetch from extended API (server-side); remove direct Supabase duplicate query.
5. **`drivers.service.getDrivers`:** Align filters (role, inactive policy) or delegate to same API for columns view.
6. **Role toolbar:** nuqs `role` + “Alle / Admins / Fahrer” in `DriverTable` header.
7. **`driver-form-body`:** Conditional driver-only sections; role-aware PATCH body; consider RPC fix for admin.
8. **`CellAction`:** `EditCredentialsDialog` + mapper; extend `useUpdateCredentials` invalidation (roster + `router.refresh()`).
9. **Replace `__refreshDriverList`** with Query invalidation or shared refetch.
10. **Route/nav:** `/dashboard/users` page hosts feature; redirect `/dashboard/drivers`; remove duplicate nav entries.
11. **Delete** `UsersTable`, `users.page` thin wrapper, move shared hooks/types; keep API routes.
12. **Copy pass:** titles, toasts, “Neuer Fahrer” → “Neuer Benutzer” / split buttons.

---

## Reference index

| Area | Path |
| --- | --- |
| Listing (RSC) | `src/features/driver-management/components/driver-table-listing.tsx` |
| Listing (client) | `src/features/driver-management/api/drivers.service.ts` |
| Types | `src/features/driver-management/types.ts` |
| Columns / actions | `src/features/driver-management/components/drivers-table/columns.tsx`, `cell-action.tsx` |
| Form | `src/features/driver-management/components/driver-form-body.tsx` |
| Users API | `src/app/api/users/route.ts`, `[id]/credentials/route.ts`, `[id]/status/route.ts` |
| Credentials UI | `src/features/driver-management/components/edit-credentials-dialog.tsx` |
| Query keys | `src/query/keys/users.ts`, `reference.ts` |
| Prior inventory | `docs/plans/drivers-page-audit.md` |
| RPC | `supabase/migrations/20260318130000_rename_users_to_accounts.sql` (`update_driver`) |

---

## Plan Status

**Plan A (role-aware `update_driver`):** ✅ Complete — 2026-05-21. See [update-driver-rpc-audit.md](update-driver-rpc-audit.md).

**Plan B Phase 1 (unified roster data layer on `/dashboard/drivers`):** ✅ Complete — 2026-05-21.

- Paginated `GET /api/users` with live email; `DriverTableListing` via cookie-forwarded RSC fetch
- Role toolbar (Alle / Fahrer / Admins); admin form field gating
- `CellAction`: credentials, ban-aware status, reactivate, self-guard
- Column view refresh callback; `deactivateDriver` deprecated then removed in Phase 2

**Plan B Phase 2 (route merge, nav, retire user-management UI):** ✅ Complete — 2026-05-21.

| Check | Done |
| --- | --- |
| `/dashboard/users` hosts full `driver-management` roster | ✅ |
| `/dashboard/drivers` permanent redirect | ✅ |
| Nav: “Fahrer” removed; “Benutzer” only | ✅ |
| `EditCredentialsDialog` + `user-actions.service.ts` in driver-management | ✅ |
| `UsersTable` deleted; `user-management` bridges retained | ✅ |
| Docs: `user-management.md`, `driver-system.md`, this file | ✅ |

**Deferred (post–Phase 2):** copy pass (“Neuer Benutzer”), delete `user-management` bridges, column view all-roles + live email.
