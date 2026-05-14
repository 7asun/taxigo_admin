---
name: Invoice status RPC hardening
overview: Skip adding a duplicate RPC migration (the function already exists with correct effective-status semantics). Harden `resolveInvoiceStatusTripFilter` by throwing on missing RPC instead of running the paginated full-table fallback; remove now-dead helper code and unused imports; verify build.
todos:
  - id: harden-resolver
    content: Replace RPC-missing fallback with throw; remove dead helpers/imports in resolve-invoice-status-trip-filter.ts
    status: completed
  - id: build
    content: Run bun run build and confirm success
    status: completed
isProject: false
---

# Invoice status filter: verify RPC + remove silent fallback

## Part 1 — Migration

**Skip creating** [`supabase/migrations/20260514140000_trip_invoice_status_rpc.sql`](supabase/migrations/20260514140000_trip_invoice_status_rpc.sql).

The RPC is already defined in [`supabase/migrations/20260411140000_trip_ids_matching_invoice_effective_status.sql`](supabase/migrations/20260411140000_trip_ids_matching_invoice_effective_status.sql):

- Name: `public.trip_ids_matching_invoice_effective_status(p_effective text)` returning `SETOF uuid`
- Implements **effective** Rechnungsstatus (paid &gt; sent &gt; draft &gt; uninvoiced; cancelled/corrected ignored), aligned with the badge — not a naive `invoices.status = p_effective` join. That matches how [`resolveInvoiceStatusTripFilter`](src/features/trips/lib/resolve-invoice-status-trip-filter.ts) passes `effective` values from the URL filter.
- Uses **`SECURITY INVOKER`** and `SET search_path = public` (not `SECURITY DEFINER`). Tenancy relies on caller RLS on `trips` / `invoice_line_items` / `invoices` rather than an explicit `company_id = current_user_company_id()` predicate in the function body — consistent with "skip Part 1 if already correctly defined."

**Do not** replace this with the Part 1 template from your message: that would change filter semantics and duplicate the function.

## Part 2 — Application code (single file)

**File:** [`src/features/trips/lib/resolve-invoice-status-trip-filter.ts`](src/features/trips/lib/resolve-invoice-status-trip-filter.ts)

1. In `resolveInvoiceStatusTripFilter`, after `if (!isTripInvoiceStatusRpcMissingError(rpcError)) { throw toQueryError(rpcError); }`, **replace** `return buildInvoiceStatusTripFilterFallback(supabase, effective);` with the explicit `throw new Error(...)` you specified (comment + message).

2. **Remove dead code** only reachable from the removed fallback:
   - `normalizeEmbeddedInvoiceStatus`
   - `buildInvoiceStatusTripFilterFallback`
   - Unused imports from [`./effective-trip-invoice-status`](src/features/trips/lib/effective-trip-invoice-status.ts): keep `EffectiveTripInvoiceStatus`; drop `resolveEffectiveTripInvoiceStatus`, `InvoiceStatusLite`, `TripInvoiceLineForStatus` if no longer referenced.

3. **Leave unchanged:** `isTripInvoiceStatusRpcMissingError`, successful RPC branch (`return { kind: 'in', tripIds: ids ?? [] }`), and non-PGRST202 error path.

**Trips listing:** No edits to [`src/features/trips/components/trips-listing.tsx`](src/features/trips/components/trips-listing.tsx). [`skipTripsQuery`](src/features/trips/components/trips-listing.tsx) (`invoiceTripFilter?.kind === 'in' && tripIds.length === 0`) and consumption of `in` / `not_in` filters stay as-is.

## Build gate

Run `bun run build` and ensure it passes.
