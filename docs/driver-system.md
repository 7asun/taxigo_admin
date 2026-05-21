# Driver Role & Shift System

> See [access-control.md](access-control.md) for the full role-based access control architecture.


This document describes the driver (Fahrer) subsystem: admin management, mobile shift tracking, and related architecture.

> **Note:** App user profiles are stored in `public.accounts` (renamed from `users`). See [accounts-table.md](accounts-table.md) for details.

---

## Overview

- **Admin (company roster)**: Create accounts, set passwords, assign roles (driver/admin), edit details, credentials, deactivate/reactivate. Located under Account → Benutzer at `/dashboard/users`.
- **Driver app**: Mobile-first shift tracker at `/driver/shift` — Start / Pause / End shift.
- **Auth**: Role-based redirect after sign-in — drivers → `/driver/shift`, admins → `/dashboard/overview`.

---

## Database Tables

| Table             | Purpose                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `accounts`        | User profiles with `role` (`driver` \| `admin`), `company_id`, `is_active`. Renamed from `users` to avoid confusion with `auth.users`. |
| `driver_profiles` | Driver-specific data: `license_number`, `default_vehicle_id`, address fields. **Only `role = 'driver'` accounts** should have rows; admins do not. |
| `shifts`          | Shift records: `driver_id`, `vehicle_id`, `started_at`, `ended_at`, `status`                                                           |
| `shift_events`    | Event log: `shift_id`, `event_type`, `lat`, `lng`, `metadata`, `timestamp`                                                             |
| `vehicles`        | Company vehicles for shift assignment                                                                                                  |
| `live_locations`  | Latest GPS per driver (1:1) — **implemented:** `/driver/tracking` upserts ~5 s; admin `/dashboard/fleet` map via `postgres_changes` |

### Standardized Values

- **shifts.status**: `active` \| `on_break` \| `ended`
- **shift_events.event_type**: `shift_start` \| `break_start` \| `break_end` \| `shift_end`

Defined in `src/features/drivers/types.ts`.

---

## Admin: Company roster (Benutzerverwaltung)

- **Route**: `/dashboard/users` (canonical)
- **Redirect**: `/dashboard/drivers` → `/dashboard/users` (bookmarks preserved)
- **Nav**: Account → Benutzer
- **Feature code**: `src/features/driver-management/`
- **Features**:
  - **Table view**: all company accounts (drivers + admins), role filter, live Auth email, sort/search/pagination via `GET /api/users?page&perPage`
  - **Column view**: drivers only (`role: 'driver'` in list panel) — intentional
  - Create: email, password, name, phone, role, license_number, default_vehicle (driver fields hidden for admin role)
  - Edit: name, phone, role; driver profile fields when `role = 'driver'`
  - Credentials: `EditCredentialsDialog` in `src/features/driver-management/components/`
  - Deactivate / reactivate: `PATCH /api/users/[id]/status` (ban + `is_active`) via `user-actions.service.ts`

### API

- `POST /api/drivers/create` — Creates auth user + `accounts` row + `driver_profiles` (for `role = 'driver'` only). Uses `SUPABASE_SERVICE_ROLE_KEY`. Requires authenticated admin with `company_id`.
- `PATCH /api/drivers/[id]` — Updates account + profile via `public.update_driver()` RPC (`SECURITY DEFINER`). Tenant guard: target `accounts.company_id` must match caller. See [access-control.md](access-control.md).

### `update_driver()` RPC (role-aware)

As of migration [`20260521224017_make_update_driver_role_aware.sql`](../supabase/migrations/20260521224017_make_update_driver_role_aware.sql):

- After updating `accounts`, the function reads **effective `role`** and **skips** the `driver_profiles` upsert block when `role = 'admin'`.
- Drivers still get `UPDATE` + conditional `INSERT` on `driver_profiles` (same JSON return shape: account + `driver_profiles` array).
- The migration runs a **one-time `DELETE`** of all `driver_profiles` rows whose `user_id` points at an admin account (orphan cleanup at deploy time).

**Profile rows after deploy (not handled by this migration):**

- The migration’s one-time `DELETE` removes **all existing** orphan `driver_profiles` rows tied to **`accounts.role = 'admin'` at deploy time**.
- **`driver→admin` profile row staleness applies only after the migration deploys:** the RPC stops **creating/updating** profiles for admins but **does not** `DELETE` a row that belonged to someone who **was already a driver** and is then promoted to admin via `update_driver`.
- **New orphans after deploy** arise only through that promotion path (or other out-of-band writers). Removing those rows belongs to **Approach B** (form gating / unified roster — see [approach-b-audit.md](plans/approach-b-audit.md)), not this RPC migration.

**Deferred:** `UNIQUE (user_id)` on `driver_profiles` — requires deduplication analysis first; see [update-driver-rpc-audit.md](plans/update-driver-rpc-audit.md) §10.

---

## Driver App

- **Route**: `/driver/shift`
- **Layout**: Mobile-first, no sidebar, safe-area aware
- **Shift states**: idle → active → on_break → active → ended

### Shift Tracker

- **Idle**: "Schicht starten" + optional vehicle selector
- **Active**: Elapsed timer, "Pause", "Schicht beenden"
- **On break**: Break timer, "Pause beenden"
- **Ended**: Total duration summary

Each action writes to `shift_events` and updates `shifts.status`. Optional GPS via `navigator.geolocation`.

---

## Route Protection

- **Proxy** (`src/proxy.ts`): Protects `/driver/*` and `/dashboard/*` — redirects unauthenticated users to `/auth/sign-in`.
- **Driver layout**: Redirects non-drivers (e.g. admins) to `/dashboard/overview`.

---

## Time Tracking Improvements (Suggestions)

1. **GPS at every event** — Already supported; ensures audit trail.
2. **Odometer input** — Add `start_odometer` / `end_odometer` when starting/ending shift.
3. **Structured break reasons** — Store in `shift_events.metadata`: `{ reason: 'Mittagspause' | 'Kurzpause' | 'Tanken' | 'Sonstige' }`.
4. **Shift history** — Show last 7 days below the tracker.
5. **live_locations** — Implemented in Phase 1 via dedicated tracking page; shift events still store point-in-time GPS on `shift_events` only.

---

## File Structure

Drivers are split into two features by audience. See [feature-folder-structure.md](feature-folder-structure.md).

```
src/
├── app/
│   ├── api/drivers/create/route.ts
│   ├── dashboard/drivers/page.tsx
│   └── driver/
│       ├── layout.tsx
│       ├── page.tsx
│       └── shift/page.tsx
├── features/
│   ├── driver-management/     # Admin: /dashboard/drivers
│   │   ├── api/drivers.service.ts
│   │   ├── components/       # driver-form, drivers-column-view, drivers-table, etc.
│   │   ├── stores/use-driver-form-store.ts
│   │   └── types.ts
│   └── driver-portal/         # Driver: /driver/*
│       ├── api/shifts.service.ts
│       ├── components/       # driver-header, shift-tracker
│       └── types.ts
└── proxy.ts  # Route protection for /driver and /dashboard
```
