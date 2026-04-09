---
name: Driver access control
overview: Implement proxy + dashboard guards, shared API helpers (`requireAdmin`, `requireSession`), cron secret, a new Supabase RLS migration (with driver trip read/update aligned to `trips.driver_id`), and client nav filtering—while preserving admin behavior and fixing null-role edge cases.
todos:
  - id: proxy-dashboard-guards
    content: "Layer 1: Extend src/proxy.ts with accounts.role fetch and redirects"
    status: pending
  - id: dashboard-layout-guard
    content: "Layer 2: Server role guard in src/app/dashboard/layout.tsx (null-safe)"
    status: pending
  - id: api-require-admin-session
    content: "Layer 3: Add require-admin.ts + require-session.ts; wire all listed API routes + cron CRON_SECRET"
    status: pending
  - id: rls-migration
    content: "Layer 4: Add 20260409170000_add_missing_rls.sql (trips driver_id + update_own_driver; admin policies; policy replacements)"
    status: pending
  - id: use-nav-role
    content: "Layer 5: Role-aware useFilteredNav.ts (empty nav for drivers)"
    status: pending
  - id: env-cron-doc
    content: Add CRON_SECRET to env template / docs if file exists
    status: pending
  - id: verify-build
    content: Run bun run build
    status: pending
isProject: false
---

# Driver role access control (5 layers)

## Layer 1 — [src/proxy.ts](src/proxy.ts)

- After `supabase.auth.getUser()`, when `user` is set, query `accounts` for `role` (same cookie-bound `createServerClient` pattern already used).
- Apply redirects exactly as specified:
  - `/dashboard*` + `user` + `userRole === 'driver'` → `/driver/shift`
  - `/driver*` + `user` + `userRole !== 'driver'` → `/dashboard/overview`
  - `/auth*` + `user` → `/driver/shift` if driver else `/dashboard/overview`
- **Edge case:** Only treat as driver when `userRole === 'driver'` (not `null`). Missing `accounts` row leaves `userRole` null → driver-only routes still redirect non-drivers away; dashboard is handled in Layer 2.

## Layer 2 — [src/app/dashboard/layout.tsx](src/app/dashboard/layout.tsx)

- Import `createClient` from `@/lib/supabase/server` and `redirect` from `next/navigation`.
- `getUser()` → if no user, `redirect('/auth/sign-in')`.
- Load `accounts.role` for `user.id`.
- **Safer than spec alone:** if no account or `role` is null/empty, `redirect('/auth/sign-in')` (avoids sending broken users to `/driver/shift`).
- If `role !== 'admin'`, `redirect('/driver/shift')`.
- Keeps existing layout UI unchanged below the guard.

## Layer 3 — API helpers and route wiring

### New files

- **[src/lib/api/require-admin.ts](src/lib/api/require-admin.ts)** — Implement `requireAdmin()` as specified; extend slightly: if `role !== 'admin'` **or** `company_id` is null, return **403** JSON (admin APIs need a tenant). Return type: `companyId: string` (narrowed after check).
- **[src/lib/api/require-session.ts](src/lib/api/require-session.ts)** — `requireSession()`: `createClient()` + `getUser()`; if no user return 401 `NextResponse.json`; else return `{ user, supabase }` (or `{ user }` only) so metrics handlers can reuse one client.

### Apply `requireAdmin()` first in handlers

Use the pattern `const auth = await requireAdmin(); if ('error' in auth) return auth.error` then use `auth.companyId` (and `auth.userId` where useful):

- [src/app/api/drivers/create/route.ts](src/app/api/drivers/create/route.ts) — Remove redundant `getUser` + `accounts` fetch for authorization; keep service-role flow; use `auth.companyId` for `companyId`.
- [src/app/api/drivers/[id]/route.ts](src/app/api/drivers/[id]/route.ts)
- [src/app/api/trips/bulk-delete/route.ts](src/app/api/trips/bulk-delete/route.ts)
- [src/app/api/trips/duplicate/route.ts](src/app/api/trips/duplicate/route.ts)
- [src/app/api/trips/export/route.ts](src/app/api/trips/export/route.ts)
- [src/app/api/trips/export/preview/route.ts](src/app/api/trips/export/preview/route.ts)
- [src/app/api/trips/driving-metrics/route.ts](src/app/api/trips/driving-metrics/route.ts)

### Metrics routes — `requireSession()`

- [src/app/api/trips/metrics/route.ts](src/app/api/trips/metrics/route.ts)
- [src/app/api/trips/groups/metrics/route.ts](src/app/api/trips/groups/metrics/route.ts)

### Cron — `CRON_SECRET`

- [src/app/api/cron/generate-recurring-trips/route.ts](src/app/api/cron/generate-recurring-trips/route.ts): change handler to `GET(request: NextRequest)` (or `Request`), read `request.headers.get('x-cron-secret')`, compare to `process.env.CRON_SECRET`; mismatch → 403. If `CRON_SECRET` is unset in production, treat as forbidden (fail closed) to avoid accidental open cron.
- Document variable: add `CRON_SECRET=` to [env.example.txt](env.example.txt) if the file exists in the repo after check; otherwise add a short comment in the cron route only is insufficient — prefer updating project env template if present.

## Layer 4 — RLS migration

Create **[supabase/migrations/20260409170000_add_missing_rls.sql](supabase/migrations/20260409170000_add_missing_rls.sql)**:

- Use `**public.current_user_is_admin()`** and `**public.current_user_company_id()`** (qualified names, consistent with existing migrations).
- `**trips**`
  - `ENABLE ROW LEVEL SECURITY`
  - Admin policies: SELECT / INSERT / UPDATE / DELETE as in the spec (company-scoped admin).
  - **Driver policy (required for “driver app untouched”):** the portal uses `**trips.driver_id`** and **UPDATE** for start/complete/cancel ([driver-trips.service.ts](src/features/driver-portal/api/driver-trips.service.ts)). Implement:
    - `**trips_select_own_driver`**: `USING (driver_id = auth.uid() OR EXISTS (SELECT 1 FROM public.trip_assignments ta WHERE ta.trip_id = trips.id AND ta.driver_id = auth.uid()))`
    - `**trips_update_own_driver`**: `FOR UPDATE` with `USING` / `WITH CHECK` `**driver_id = auth.uid()**` so drivers cannot reassign rows via UPDATE.
- `**clients**`, `**payers**`, `**company_profiles**`: admin-only `FOR ALL` policies as spec.
- **Tighten company-scoped tables** (drop old policies, add single admin policy each): `invoice_text_blocks`, `billing_pricing_rules`, `rechnungsempfaenger`, `fremdfirmen`, `pdf_vorlagen` — match exact policy names from existing migrations for `DROP POLICY IF EXISTS`.

**Explicitly out of scope per instructions:** no changes to invoices, invoice_line_items, shifts, accounts, driver_profiles policies.

**Follow-up for you:** run `supabase db push` (or your usual apply path) after merge; configure `CRON_SECRET` and Vercel cron header `x-cron-secret`.

## Layer 5 — [src/hooks/use-nav.ts](src/hooks/use-nav.ts)

- `NavItem` has no `key` field today ([src/types/index.ts](src/types/index.ts)); dashboard [nav-config](src/config/nav-config.ts) only lists `/dashboard/...` URLs (no `/driver/startseite` entries).
- Implement **defense in depth**: client-side fetch of `accounts.role` for the session user (Supabase browser client + `useEffect`/`useState`, or reuse TanStack Query if there is an existing pattern — prefer minimal new surface).
  - If `**role === 'driver'`**: return `**[]`** (empty sidebar/KBar nav — no fake dashboard items). Optionally append one item `{ title: 'Fahrerbereich', url: '/driver/shift', ... }` if you want a visible escape hatch (plan default: **empty** to match “hide admin nav”).
  - If `**admin`** (or non-driver): return full list unchanged (including nested `items`).
- Recursively filter nested `items` if you ever tag subtrees; for current config, top-level filter is enough.

## Verification

- `bun run build`
- Manual: driver login → `/driver/shift`; paste `/dashboard/invoices` → `/driver/shift`; API 403 for driver on guarded routes; admin smoke-test dashboard trips/invoices.

```mermaid
flowchart LR
  subgraph edge [Proxy]
    A[getUser]
    B[accounts.role]
    C{route}
  end
  A --> B --> C
  C -->|driver + dashboard| D[/driver/shift]
  C -->|non-driver + /driver| E[/dashboard/overview]
```



