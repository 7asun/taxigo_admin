---
name: Trips composite indexes
overview: Add a single new migration that creates five composite indexes on `public.trips` leading with `company_id`, matching RLS tenancy and the trips list filters/sorts. No application or migration edits beyond that file.
todos:
  - id: add-migration
    content: Add supabase/migrations/20260514130000_trips_performance_indexes.sql with exact 5-index SQL only
    status: completed
  - id: build
    content: Run bun run build and confirm success
    status: completed
isProject: false
---

# Add missing composite indexes on `public.trips`

## Read-only audit: existing indexes on `public.trips`

Scan of all `CREATE INDEX` statements in [`supabase/migrations/`](supabase/migrations/) that target `public.trips` yields **exactly three** (no `company_id` composites today):

| Index name | Columns | Migration file |
|------------|---------|----------------|
| `trips_billing_variant_id_idx` | `billing_variant_id` | [`20260326120000_billing_families_and_variants.sql`](supabase/migrations/20260326120000_billing_families_and_variants.sql) |
| `idx_trips_fremdfirma_id` | `fremdfirma_id` | [`20260404103000_no_invoice_fremdfirma_recurring.sql`](supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql) |
| `idx_trips_billing_type_id` | `billing_type_id` | [`20260418120000_trips-price-schema.sql`](supabase/migrations/20260418120000_trips-price-schema.sql) |

This matches your expectations for `billing_variant_id`, `fremdfirma_id`, and `billing_type_id`; nothing else indexes `public.trips` in the migration tree.

## Alignment with list query and URL filters

**Main query** ([`src/features/trips/components/trips-listing.tsx`](src/features/trips/components/trips-listing.tsx) ~87–249): `from('trips').select(...)` with filters on `status`, `driver_id` (including `is null` for unassigned), `payer_id`, `billing_variant_id`, invoice-driven `id` in/not-in, text `or`/ilike on addresses, and date logic on `scheduled_at` and `requested_date` (including `scheduled_at IS NULL` branches). Default ordering when no explicit sort: `order('scheduled_at', { ascending: true })`; user-chosen sorts go through `TRIPS_SORT_MAP`.

**Nuqs shape** ([`src/lib/searchparams.ts`](src/lib/searchparams.ts)): trip-relevant keys are `status`, `driver_id`, `payer_id`, `billing_variant_id`, `invoice_status`, `scheduled_at`, `sort`, `view` (plus `search`, `page`, `perPage`). The new indexes cover the high-selectivity filters that pair naturally with **per-company** scans (`status`, `driver_id`, `payer_id`) and the two date columns used in the calendar/filter branches (`scheduled_at`, `requested_date`). `billing_variant_id` already has a single-column index; `invoice_status` resolves to id lists, not a direct column filter.

RLS on [`public.trips`](supabase/migrations/20260409170000_add_missing_rls.sql) is company-scoped, so leading indexes with `company_id` match the typical planner pattern after policy qualification.

## Implementation (single file, exact content)

1. **Create** [`supabase/migrations/20260514130000_trips_performance_indexes.sql`](supabase/migrations/20260514130000_trips_performance_indexes.sql) with **only** the SQL you specified (five `CREATE INDEX IF NOT EXISTS` statements, verbatim — no extra comments beyond what you included, if you want literal byte-for-byte match use your block exactly as given).

2. **Do not** modify any existing migration or any file under `src/`.

3. **Build gate:** run `bun run build` and ensure it passes (migration addition should not affect TypeScript build, but this confirms the repo stays green).

## Note (non-blocking)

Default list sort uses `scheduled_at` **ascending**; the new index is `(company_id, scheduled_at DESC NULLS LAST)`. Postgres can often satisfy ascending order via backward index scan when the plan uses this index; if EXPLAIN shows a mismatch in production, a follow-up could add an ASC variant — out of scope here since the SQL is fixed by your spec.
