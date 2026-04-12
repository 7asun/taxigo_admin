# Access Control

## Roles

Two roles exist in `public.accounts.role`: `admin` and `driver`.

There is no separate dispatcher role — dispatchers use the `admin` role.

## Defense-in-depth: 5 layers

| Layer | File | What it does |
| --- | --- | --- |
| 1 | `src/proxy.ts` | Middleware: reads `accounts.role`, redirects drivers away from `/dashboard`, admins away from `/driver` |
| 2 | `src/app/dashboard/layout.tsx` | Server layout guard: blocks non-admin from rendering any dashboard page |
| 3 | `src/lib/api/require-admin.ts` | API helper: returns 403 for any non-admin calling admin API routes |
| 4 | `supabase/migrations/20260409170000_add_missing_rls.sql` | Database: RLS policies ensure data never leaks even if layers 1–3 fail |
| 5 | `src/hooks/use-nav.ts` | UI: drivers see empty nav (no dashboard menu items) |

## Route ownership

| Route prefix | Intended role | Guard |
| --- | --- | --- |
| `/dashboard/*` | `admin` only | Layer 1 + Layer 2 |
| `/driver/*` | `driver` only | Layer 1 + `src/app/driver/layout.tsx` |
| `/auth/*` | unauthenticated | Proxy redirects authenticated users by role |

## API route protection

All mutating/sensitive API routes require `admin` role via `requireAdmin()`:

- `POST /api/drivers/create` — creates users, requires admin
- `PATCH /api/drivers/[id]` — modifies driver data, requires admin
- `POST /api/trips/bulk-delete` — destructive, requires admin
- `POST /api/trips/duplicate` — requires admin
- `POST /api/trips/export` + `GET /api/trips/export/preview` — exports PII, requires admin
- `POST /api/trips/driving-metrics` — requires admin

Metrics routes require any authenticated session (`requireSession()`):

- `GET /api/trips/metrics`
- `GET /api/trips/groups/metrics`

Cron route (`GET /api/cron/generate-recurring-trips`) requires `Authorization: Bearer <CRON_SECRET>` (Vercel Cron’s format when `CRON_SECRET` is set in the project). As a fallback for manual calls, the same value may be sent in the `x-cron-secret` header. If `CRON_SECRET` is unset, the handler returns 403 (fail closed). The handler also requires `SUPABASE_SERVICE_ROLE_KEY` for database writes.

## RLS policy summary

| Table | Driver access | Admin access |
| --- | --- | --- |
| `trips` | SELECT/UPDATE own trips (`driver_id = auth.uid()` or `trip_assignments`); see migration | Full CRUD, company-scoped |
| `accounts` | SELECT/UPDATE own row | SELECT/UPDATE accounts in same company |
| `driver_profiles` | SELECT/UPDATE own | Full CRUD in company |
| `shifts` / `shift_events` | Full CRUD own | SELECT in company |
| `invoices` / `invoice_line_items` | none | Full CRUD, company-scoped |
| `angebote` / `angebot_line_items` | none | Full CRUD, company-scoped |
| `clients` / `payers` | none | Full CRUD, company-scoped |
| `company_profiles` / `companies` | none | Full CRUD, company-scoped |
| `vehicles` | none | Full CRUD, company-scoped |
| `billing_pricing_rules` | none | Full CRUD, company-scoped |
| `client_price_tags` | none | Full CRUD, company-scoped |
| `rechnungsempfaenger` | none | Full CRUD, company-scoped |
| `fremdfirmen` | none | Full CRUD, company-scoped |
| `pdf_vorlagen` | none | Full CRUD, company-scoped |
| `invoice_text_blocks` | none | Full CRUD, company-scoped |

## Adding a new admin-only API route

1. Import `requireAdmin` from `@/lib/api/require-admin`
2. Add as first line in handler: `const auth = await requireAdmin(); if ('error' in auth) return auth.error`
3. Use `auth.companyId` for all tenant-scoped queries
4. Update the table above in this doc

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `CRON_SECRET` | Yes (production) | Sent by Vercel Cron as `Authorization: Bearer …`; also accepted as `x-cron-secret` for manual runs |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (cron) | Required for the recurring-trips cron to insert trips (RLS bypass) |

## RLS design rules — lessons from the 2026-04-09 incident

### What happened

The `20260409170000_add_missing_rls.sql` migration added new RLS policies to
`trips` and other tables, but did **not** drop the old manually-created
dashboard policies (`"Allow tenants only"`, `"tenant select trips"`, etc.)
that already existed in production. PostgreSQL treats all PERMISSIVE policies
as OR — so both sets fired simultaneously.

The new `trips_select_own_driver` policy included:

```sql
EXISTS (SELECT 1 FROM public.trip_assignments ta
  WHERE ta.trip_id = trips.id AND ta.driver_id = auth.uid())
```

At the same time, `trip_assignments` had admin policies that contained:

```sql
EXISTS (SELECT 1 FROM trips t
  WHERE t.id = trip_assignments.trip_id AND t.company_id = ...)
```

This created a **bidirectional RLS loop**:

```text
query trips
→ trips_select_own_driver → SELECT from trip_assignments
→ trip_assignments_select_admin → SELECT from trips
→ trips_select_own_driver → SELECT from trip_assignments
→ ♾️ PostgreSQL error 42P17
```

A separate loop also existed earlier: `current_user_is_admin()` and
`current_user_company_id()` both queried `public.accounts`, which had its own
RLS policies that called the same helpers → `accounts → accounts` recursion.
This was fixed in `20260409180000_fix_rls_helper_recursion.sql` by adding
`SET row_security = off` to both helper functions.

### The fix

`20260409190000_fix_trip_assignments_rls_loop.sql` introduced a third helper:

```sql
CREATE OR REPLACE FUNCTION public.trip_company_id(p_trip_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public SET row_security = off AS $$
  SELECT company_id FROM public.trips WHERE id = p_trip_id;
$$;
```

All `trip_assignments` admin policies now use
`public.trip_company_id(trip_id) = public.current_user_company_id()`
instead of a raw `EXISTS (... FROM trips ...)`. Because `trip_company_id()`
runs with `row_security = off`, it reads `trips.company_id` directly without
re-entering trips RLS — breaking the cycle.

### Rules: how to write RLS policies safely in this codebase

**Rule 1 — Never write a raw cross-table subquery in a policy.**
If a policy on table A needs data from table B, and table B has RLS that
references table A, you will get 42P17. Always use a SECURITY DEFINER helper
with `SET row_security = off` for the cross-table read.

**Rule 2 — When adding new policies to a table, always drop the old ones first.**
PostgreSQL applies ALL PERMISSIVE policies simultaneously (OR logic). Leaving
old policies alongside new ones causes double-evaluation, unexpected access
grants, and can create new recursion paths through the old policy expressions.
Every migration that adds policies must include explicit `DROP POLICY IF EXISTS`
for any policy it supersedes.

**Rule 3 — SECURITY DEFINER helpers must always include both:**

- `SET search_path = public` — prevents search_path hijacking
- `SET row_security = off` — prevents RLS re-evaluation inside the function

All three existing helpers follow this pattern:
`current_user_is_admin()`, `current_user_company_id()`, `trip_company_id()`.

**Rule 4 — Before adding policies to any table, check pg_policy.**
Run `SELECT polname FROM pg_policy WHERE polrelid = 'public.<table>'::regclass`
in the Supabase SQL editor and verify which policies already exist in production.
The repo migrations are not always the full picture — some policies were created
manually in the Supabase dashboard before this migration set existed.

**Rule 5 — Test after every migration, not just at the end.**
After each migration: run `SELECT id FROM public.trips LIMIT 1` as an
authenticated user in the SQL editor. A 42P17 error means a new loop was
introduced and must be fixed before the next migration runs.
