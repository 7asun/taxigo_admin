---
name: KTS-SEC-01 RPC guard
overview: Harden trip_kts_correction_summaries with in-function tenant isolation (JOIN trips + current_user_company_id). DB + docs only. Closes KTS-SEC-01 before PR2.1.1.
todos:
  - id: migration
    content: Create 20260610125000_kts_rpc_tenant_guard.sql (CREATE OR REPLACE RPC)
    status: completed
  - id: deferred-doc
    content: docs/plans/kts-rpc-tenant-guard-deferred.md — mark RESOLVED (created)
    status: completed
  - id: architecture
    content: Add §7.3 to docs/kts-architecture.md with KTS-SEC-01 RESOLVED
    status: completed
  - id: verify
    content: bun run build && bun test
    status: completed
isProject: false
---

# KTS-SEC-01 — RPC tenant guard

**Status:** Docs tracking created; migration + architecture §7.3 pending agent-mode execution.

## Migration (ready to apply)

**File:** `supabase/migrations/20260610125000_kts_rpc_tenant_guard.sql`

```sql
-- KTS-SEC-01: Harden trip_kts_correction_summaries with in-function tenant guard.
-- See docs/plans/kts-rpc-tenant-guard-deferred.md.

CREATE OR REPLACE FUNCTION public.trip_kts_correction_summaries(
  p_trip_ids uuid[]
)
RETURNS TABLE (
  trip_id            uuid,
  correction_count   bigint,
  latest_sent_to     text,
  latest_sent_at     timestamptz,
  latest_received_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- KTS-SEC-01: tenant guard added post-PR2. SECURITY DEFINER
  -- bypasses RLS on kts_corrections; we enforce isolation here
  -- by joining trips and filtering on the caller's company_id.
  -- This mirrors the pattern in controlling_rpcs.sql.
  WITH authorized AS (
    SELECT public.current_user_company_id() AS company_id
    WHERE public.current_user_company_id() IS NOT NULL
  ),
  latest AS (
    SELECT DISTINCT ON (kc.trip_id)
      kc.trip_id,
      kc.sent_to     AS latest_sent_to,
      kc.sent_at     AS latest_sent_at,
      kc.received_at AS latest_received_at
    FROM public.kts_corrections kc
    JOIN public.trips t ON t.id = kc.trip_id
    WHERE kc.trip_id = ANY(p_trip_ids)
      AND t.company_id = (SELECT company_id FROM authorized)
      AND EXISTS (SELECT 1 FROM authorized)
    ORDER BY kc.trip_id, kc.created_at DESC
  ),
  counts AS (
    SELECT kc.trip_id, COUNT(*) AS correction_count
    FROM public.kts_corrections kc
    JOIN public.trips t ON t.id = kc.trip_id
    WHERE kc.trip_id = ANY(p_trip_ids)
      AND t.company_id = (SELECT company_id FROM authorized)
      AND EXISTS (SELECT 1 FROM authorized)
    GROUP BY kc.trip_id
  )
  SELECT
    l.trip_id,
    c.correction_count,
    l.latest_sent_to,
    l.latest_sent_at,
    l.latest_received_at
  FROM latest l
  JOIN counts c ON c.trip_id = l.trip_id;
$$;
```

No GRANT/REVOKE — existing grants remain.

### Design note: `EXISTS (SELECT 1 FROM authorized)` in both CTEs

`AND EXISTS (SELECT 1 FROM authorized)` appears in both `latest` and `counts`. It is **slightly redundant**: when `current_user_company_id()` is `NULL`, the `authorized` CTE is empty and `t.company_id = (SELECT company_id FROM authorized)` already evaluates false for every row.

**Keep both guards anyway.** The explicit `EXISTS` matches the controlling RPC pattern in `20260530120000_controlling_rpcs.sql` (`WHERE EXISTS (SELECT 1 FROM authorized)`). Consistency with the established pattern matters more than micro-optimisation here — do not remove it during implementation or review.

## Architecture patch

Insert after §7.2 roadmap table in `docs/kts-architecture.md`:

```markdown
## 7.3 Deferred / security backlog

**Why:** `SECURITY DEFINER` RPCs in this project intentionally bypass RLS for aggregation performance; tenant isolation must be enforced **inside the function** (e.g. `current_user_company_id()` + `JOIN trips`), not assumed from caller-supplied UUIDs.

| ID | Item | Status | Reference |
| -- | ---- | ------ | --------- |
| **KTS-SEC-01** | `trip_kts_correction_summaries` — in-function tenant guard (`JOIN trips` + `company_id`) | **RESOLVED** (2026-06-10) | [`docs/plans/kts-rpc-tenant-guard-deferred.md`](plans/kts-rpc-tenant-guard-deferred.md); migration `20260610125000_kts_rpc_tenant_guard.sql` |
```

## Completed

- [`docs/plans/kts-rpc-tenant-guard-deferred.md`](docs/plans/kts-rpc-tenant-guard-deferred.md) — KTS-SEC-01 marked RESOLVED

## Verification

```bash
bun run build && bun test
```

Postgres (local):

```sql
SELECT prosrc FROM pg_proc WHERE proname = 'trip_kts_correction_summaries';
SELECT * FROM public.trip_kts_correction_summaries(ARRAY[]::uuid[]);
```
