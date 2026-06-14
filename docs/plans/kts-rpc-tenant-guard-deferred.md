# KTS-SEC-01 — RPC Tenant Guard

**Status:** RESOLVED — 2026-06-10  
**Resolved in:** migration `20260610125000_kts_rpc_tenant_guard.sql`

## Risk

`trip_kts_correction_summaries` was `SECURITY DEFINER` with no in-function tenant guard. A caller passing unvalidated `trip_ids` could receive `kts_corrections` rows belonging to other companies.

## Fix applied

Added `JOIN public.trips` + `trips.company_id = current_user_company_id()` guard inside both CTEs (`latest`, `counts`), using an `authorized` CTE pattern aligned with [`20260530120000_controlling_rpcs.sql`](../../supabase/migrations/20260530120000_controlling_rpcs.sql). The `p_trip_ids` filter (`kc.trip_id = ANY(p_trip_ids)`) is preserved additively.

Return shape and function attributes (`LANGUAGE sql`, `STABLE`, `SECURITY DEFINER`, `SET search_path = public`) are unchanged. Existing `GRANT EXECUTE` to `authenticated` remains valid.

## Gate

This fix was required before **PR2.1.1** (correction list badges) or any bulk caller. It has been applied. PRs may now wire up this RPC safely.

## Process note

Deferred security items in the KTS module must be tracked here (or a sibling `docs/plans/*-deferred.md`) with an ID and a row in [`docs/kts-architecture.md`](../kts-architecture.md) §7.3 — not only a comment in a migration plan.
