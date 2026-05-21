# Panel & table view audit — email display and `/dashboard/users` 500

**Date:** 2026-05-21  
**Mode:** Read-only (no code changes)

**Sources read:**

- `src/features/driver-management/components/driver-list-panel.tsx`
- `src/features/driver-management/components/driver-detail-panel.tsx`
- `src/features/driver-management/components/drivers-column-view.tsx`
- `src/features/driver-management/api/drivers.service.ts`
- `src/app/dashboard/users/page.tsx`
- `src/app/api/users/route.ts`
- `src/features/driver-management/components/driver-form-body.tsx` (rendered inside detail panel)
- Terminal: `terminals/3.txt` (`bun run dev` active)

---

## 1. Visible fields in `driver-detail-panel.tsx`

`DriverDetailPanel` does **not** render read-only field rows itself. It renders:

| UI element | Label / text | Data source |
|------------|--------------|-------------|
| `PanelHeader` title | Display name | **Computed** from `accounts.first_name` + `accounts.last_name`, else `accounts.name` (`getDisplayName(driver)`) |
| `PanelHeader` description | `Neuen Fahrer anlegen` (create) / `Fahrer bearbeiten` (edit) | Static copy |
| `PanelHeader` close | — | Calls `onClose` prop |
| `PanelHeader` action button | `Anlegen` (create) / `Aktualisieren` (edit) | Calls `formRef.current?.submit()` → `DriverFormBody` submit |
| `PanelBody` | Loading spinner or **`DriverFormBody`** | See below |

**Data load for edit:** `driversService.getDriverById(driverId)` → `accounts` (`select('*')`) + `driver_profiles` (`select('*')`).

### Fields inside `DriverFormBody` (what the user actually sees)

#### Create mode (`driverId === 'new'`)

| Label | Form field | Persisted / source |
|-------|------------|-------------------|
| E-Mail | `email` | `POST /api/drivers/create` → Auth + `accounts` |
| Passwort | `password` | `POST /api/drivers/create` → Auth only |
| Vorname | `first_name` | `accounts.first_name` |
| Nachname | `last_name` | `accounts.last_name` |
| Telefon | `phone` | `accounts.phone` |
| Rolle | `role` | `accounts.role` (`driver` \| `admin`) |
| Führerscheinnummer (optional) | `license_number` | `driver_profiles.license_number` (if role ≠ admin) |
| Standard-Fahrzeug (optional) | `default_vehicle_id` | `driver_profiles.default_vehicle_id` + `vehicles` lookup |
| Adresse (optional) — Straße | `street` | `driver_profiles.street` |
| Hausnummer | `street_number` | `driver_profiles.street_number` |
| PLZ | `zip_code` | `driver_profiles.zip_code` |
| Stadt | `city` | `driver_profiles.city` |
| (hidden) | `lat`, `lng` | `driver_profiles.lat`, `driver_profiles.lng` via `AddressAutocomplete` |

#### Edit mode

Same as create **except**:

- **No** password field.
- **E-Mail** shown as **read-only** input (`readOnly`, `bg-muted`) — value from `accounts.email` on `initialData` (cached column, **not** live Auth merge).
- Driver-only blocks hidden when `role === 'admin'` (license, vehicle, entire address section).

**Submit (edit):** `PATCH /api/drivers/[id]` with account + profile fields (`driver-form-body.tsx` `onSubmit`).

---

## 2. Does the detail panel show email?

**In the panel chrome (header):** **No** — only display name, description, close, and save.

**Inside the embedded form:**

| Mode | Email visible? | Source |
|------|----------------|--------|
| **Create** | Yes — editable | User input → create API |
| **Edit** | Yes — **read-only** field labeled “E-Mail” | **`accounts.email`** from `getDriverById` (`select('*')` on `accounts`) — cached/stale vs live Auth |

**Logical placement if adding a read-only Auth email line in the panel (not in form):**

- Under `PanelHeader` **description**, or
- First row above the form grid in `PanelBody`, before `DriverFormBody` — mirrors table column “E-Mail” and list subtitle pattern.

**Related — list panel (`driver-list-panel.tsx`):** Subtitle shows `(driver.email ?? driver.role)` — that `email` comes from **`driversService.getDrivers`** SQL select including **`accounts.email`** (not live Auth).

---

## 3. Action buttons in `driver-detail-panel.tsx`

| Control | Present? | What it calls |
|---------|----------|----------------|
| Close (`PanelHeader` `onClose`) | Yes | Parent `nav.clearAll()` via `DriversColumnView` |
| **Anlegen** / **Aktualisieren** | Yes | `formRef.current?.submit()` → `DriverFormBody.handleSubmit` → create: `POST /api/drivers/create`; edit: `PATCH /api/drivers/[id]` |
| **Edit** (separate) | No | Form is inline edit |
| **Deactivate / reactivate** | No | Not in column detail panel |
| **Zugangsdaten / credentials** | No | Not in column detail panel |

**Where those actions exist instead:** Table view `CellAction` — dropdown with Bearbeiten (`useDriverFormStore.openForEdit`), Zugangsdaten (`EditCredentialsDialog` + `useUpdateCredentials`), Deaktivieren/Reaktivieren (`useUpdateStatus` → `PATCH /api/users/[id]/status`).

**Pattern for adding credentials in column view:** Mirror `cell-action.tsx` — local `useState` for dialog open, map row to `CompanyUser`, `EditCredentialsDialog` + hooks from `user-actions.service.ts`; optional `router.refresh()` is already in hook `onSuccess` (table RSC only).

**List panel actions:** `PanelList` `onNew` → `onNewDriver` → sets `driverId=new` in URL; search via `onSearchChange`; row select → `onSelectDriver(id)`.

---

## 4. Server error for table view (`/dashboard/users?view=table`)

### Terminal log search

Searched all Cursor terminal logs under `terminals/*.txt`:

| Query | Result |
|-------|--------|
| `view=table` | **No matches** |
| `GET /dashboard/users` | Matches in `3.txt` only |
| `Konten konnten` / `Failed to parse URL` / `driver-table-listing` | **No matches** in terminals |

**Conclusion:** There is **no logged request** with the exact query string `?view=table` in the captured dev-server output. The 500s logged for `/dashboard/users` use other params (e.g. `driverId=…`).

### Full error from logs (closest `/dashboard/users` 500)

From **`terminals/3.txt`** (`bun run dev`), immediately before:

```text
GET /dashboard/users?driverId=a1ef892c-fa2d-446c-934c-6f7b06a9ea4e 500 in 353ms (compile: 117ms, proxy.ts: 223ms, render: 13ms)
```

**Primary error (users page compile / render):**

```text
Error: ENOENT: no such file or directory, open '/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/.next/dev/server/app/dashboard/users/page/build-manifest.json'
    at ignore-listed frames {
  errno: -2,
  code: 'ENOENT',
  syscall: 'open',
  path: '/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/.next/dev/server/app/dashboard/users/page/build-manifest.json'
}
```

**Follow-on / document shell errors (same request window):**

```text
⨯ Error: Cannot find module '../chunks/ssr/[turbopack]_runtime.js'
Require stack:
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/.next/dev/server/pages/_document.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/server/require.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/server/load-components.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/build/utils.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/build/swc/options.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/build/swc/index.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/build/next-config-ts/transpile-config.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/server/config.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/server/next.js
- /Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/node_modules/next/dist/server/lib/start-server.js
    at Object.<anonymous> (.next/dev/server/pages/_document.js:1:7) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [Array]
}
```

```text
Error: ENOENT: no such file or directory, open '/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/.next/dev/routes-manifest.json'
    at ignore-listed frames {
  errno: -2,
  code: 'ENOENT',
  syscall: 'open',
  path: '/Users/husseinal-rammahi/Desktop/dies-das/taxigo_admin/.next/dev/routes-manifest.json'
}
```

| Field | Value |
|-------|--------|
| **HTTP** | `500` on `GET /dashboard/users?...` |
| **Message** | `ENOENT: no such file or directory, open '.../dashboard/users/page/build-manifest.json'` |
| **File in stack** | Next.js internal (`ignore-listed frames`) — failure opening build manifest under `.next/dev/server/app/dashboard/users/page/` |
| **Application line** | **Not reached** — failure occurs during Next dev compile/render of `users/page`, before `DriverTableListing` runs |

**Interpretation:** The captured 500 is consistent with a **corrupted or incomplete `.next/dev` cache** (Turbopack), not a logged runtime error inside `driver-table-listing.tsx`. Same terminal session shows identical `ENOENT` / `MODULE_NOT_FOUND` patterns for `/dashboard/fleet` and `/dashboard/drivers`.

### Table-view code path (if page render succeeds)

When `view=table`, [`users/page.tsx`](../../src/app/dashboard/users/page.tsx) renders `<DriverTableListing />`, which does:

```ts
// driver-table-listing.tsx:35
const res = await fetch(`/api/users?${params}`, { ... });
// driver-table-listing.tsx:54 — on failure
throw new Error(`Konten konnten nicht geladen werden: ${msg}`);
```

**Not observed in current terminal logs.** In Node, a relative `fetch('/api/users?...')` fails with `fetch() URL is invalid` (no base URL). If that occurs in RSC, the thrown error would surface from **`driver-table-listing.tsx` line 54** (re-throw after failed `fetch`), not from a line inside `route.ts`.

**To capture a table-specific trace:** Reproduce with a clean `.next` (`rm -rf .next && bun run dev`), sign in as admin, open `/dashboard/users?view=table`, and copy the new server log line for that exact URL.

---

## Cross-reference: page routing

| `view` param | `users/page.tsx` renders |
|--------------|---------------------------|
| `columns` (default) | `DriversColumnView` → list + detail panels |
| `table` | `Suspense` → `DriverTableListing` + `DriverForm` sheet |

Table data API: paginated `GET /api/users` with live `email` on each `data[]` row ([`credentials-audit.md`](credentials-audit.md)).
