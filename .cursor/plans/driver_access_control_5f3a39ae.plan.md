---
name: Driver access control
overview: Implement proxy + dashboard guards, shared API helpers (`requireAdmin`, `requireSession`), cron secret, a new Supabase RLS migration (trips, clients, payers, company_profiles, vehicles, companies, tightened catalog tables, `update_driver` anon revoke), client nav filtering, and docs/access-control.md with cross-links.
todos:
  - id: proxy-dashboard-guards
    content: "Layer 1: Extend src/proxy.ts with accounts.role fetch and redirects"
    status: completed
  - id: dashboard-layout-guard
    content: "Layer 2: Server role guard in src/app/dashboard/layout.tsx (null-safe)"
    status: completed
  - id: api-require-admin-session
    content: "Layer 3: Add require-admin.ts + require-session.ts; wire all listed API routes + cron CRON_SECRET"
    status: completed
  - id: rls-migration
    content: "Layer 4: Add 20260409170000_add_missing_rls.sql (trips, clients, payers, company_profiles, vehicles, companies, policy replacements, REVOKE update_driver FROM anon)"
    status: completed
  - id: use-nav-role
    content: "Layer 5: Role-aware use-nav.ts (empty nav for drivers)"
    status: completed
  - id: docs-access-control
    content: Add docs/access-control.md + cross-references in existing docs
    status: completed
  - id: env-cron-doc
    content: Add CRON_SECRET to env template (env.example.txt) + doc
    status: completed
  - id: verify-build
    content: Run bun run build
    status: completed
isProject: false
---

# Driver role access control (5 layers)

## Layer 1 — [src/proxy.ts](src/proxy.ts)

- After `supabase.auth.getUser()`, when `user` is set **and** the path is `/dashboard`, `/driver`, or `/auth`, query `accounts` for `role` (avoid extra DB round-trips on unrelated `/api` traffic).
- Redirects:
  - `/dashboard`* + `user` + `userRole === 'driver'` → `/driver/shift`
  - `/driver`* + `user` + `userRole !== 'driver'` → `/dashboard/overview`
  - `/auth`* + `user` → `/driver/shift` if driver else `/dashboard/overview`
- **Edge case:** Only treat as driver when `userRole === 'driver'`. Missing `accounts` row → `userRole` null; dashboard handled in Layer 2.

## Layer 2 — [src/app/dashboard/layout.tsx](src/app/dashboard/layout.tsx)

- `getUser()` → no user → `redirect('/auth/sign-in')`.
- Load `accounts.role`; no account / null role → `redirect('/auth/sign-in')`.
- `role !== 'admin'` → `redirect('/driver/shift')`.

## Layer 3 — API helpers and route wiring

- [src/lib/api/require-admin.ts](src/lib/api/require-admin.ts) — `requireAdmin()`; 403 if not admin or missing `company_id`.
- [src/lib/api/require-session.ts](src/lib/api/require-session.ts) — `requireSession()` for metrics routes.
- Apply `requireAdmin()` to: drivers create, drivers PATCH, trips bulk-delete, duplicate, export, export/preview, driving-metrics.
- Cron: `GET(request)` + `x-cron-secret` vs `CRON_SECRET` (fail closed if unset).

## Layer 4 — RLS migration [supabase/migrations/20260409170000_add_missing_rls.sql](supabase/migrations/20260409170000_add_missing_rls.sql)

- **trips:** Admin company-scoped CRUD; driver **SELECT** via `driver_id = auth.uid()` OR `trip_assignments`; driver **UPDATE** own `driver_id = auth.uid()` (preserves driver portal).
- **clients**, **payers**, **company_profiles:** admin-only `FOR ALL`.
- **vehicles:** `ENABLE ROW LEVEL SECURITY` + admin-only `FOR ALL` (`company_id = current_user_company_id()`).
- **companies:** `ENABLE ROW LEVEL SECURITY` + admin-only `FOR ALL` (`id = current_user_company_id()`).
- Tighten: `invoice_text_blocks`, `billing_pricing_rules`, `rechnungsempfaenger`, `fremdfirmen`, `pdf_vorlagen` (drop old policies, admin-only).
- **Do not** alter invoices, invoice_line_items, shifts, accounts, driver_profiles policies.
- `**update_driver`:** `REVOKE EXECUTE ... FROM anon` (keep `authenticated` only).

## Layer 5 — [src/hooks/use-nav.ts](src/hooks/use-nav.ts)

- Client fetch `accounts.role`; if `driver`, return `[]`; else return full `navItems`.

## Docs

- New [docs/access-control.md](docs/access-control.md) (canonical architecture).
- Add cross-reference blockquote to existing docs that mention drivers, RLS, API routes, or auth (see implementation).

## Verification

- `bun run build`
- `supabase db push` (operator)
- Manual checks: driver vs dashboard redirects; API 403; cron header

