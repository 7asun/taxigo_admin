# Controlling Module

Read-only CFO analytics at `/dashboard/controlling`. All trip aggregations run server-side via Supabase RPCs scoped to the authenticated admin's `company_id`.

## Scope

- Operational KPIs (trips, revenue, km, data-quality flags)
- Time-series and heatmap visualizations (Berlin timezone)
- Driver utilization (Auslastungsindex)
- Payer → billing_type → billing_variant breakdown
- Invoice receivables KPIs
- **Out of scope:** vehicle utilization, SLA/on-time metrics, margin analysis, drill-through sub-pages

## Berlin timezone

All calendar boundaries use:

```sql
(scheduled_at AT TIME ZONE 'Europe/Berlin')::date
```

Client-side period selection uses `todayYmdInBusinessTz()` and `buildControllingPeriod()` from [`controlling-utils.ts`](../src/features/controlling/lib/controlling-utils.ts), backed by [`trip-business-date.ts`](../src/features/trips/lib/trip-business-date.ts). See [`docs/plans/timezone-bug-audit-v2.md`](plans/timezone-bug-audit-v2.md) Part 5 Q12.

## RPC functions

Migration: [`supabase/migrations/20260530120000_controlling_rpcs.sql`](../supabase/migrations/20260530120000_controlling_rpcs.sql)

| RPC | Purpose |
|-----|---------|
| `get_controlling_operational(company, from, to)` | One row per Berlin day in range (zero-fill via `generate_series`) |
| `get_controlling_breakdown(company, from, to)` | Payer/billing/driver slices; `active_days` via `driver_active_days` CTE |
| `get_controlling_heatmap(company, from, to)` | 7×24 cells; `day_of_week` 0=Monday (ISODOW−1) |
| `get_controlling_invoice_kpis(company, from, to)` | Open/overdue/DSO/Fakturierungsgrad |
| `get_controlling_monthly_revenue(company, months=12)` | Fixed 12-month chart (independent of period picker) |

All RPCs are `SECURITY DEFINER` with `current_user_is_admin()` and `p_company_id = current_user_company_id()` guards. RPCs are used instead of client table scans to keep payloads small and guarantee consistent Berlin bucketing at scale.

### `active_days` (driver-level)

`get_controlling_breakdown` computes working days in a CTE:

```sql
driver_active_days AS (
  SELECT driver_id,
    COUNT(DISTINCT (scheduled_at AT TIME ZONE 'Europe/Berlin')::date) AS active_days
  ...
  GROUP BY driver_id
)
```

Every breakdown row for the same driver carries the same `active_days`, so **Auslastungsindex = total driver trips / total driver active days**, not days working for one payer.

## Payer hierarchy → UI

Catalog: **Kostenträger (payer)** → **Abrechnungsfamilie (billing_type)** → **Unterart (billing_variant)**. See [`billing-families-variants.md`](billing-families-variants.md).

`PayerBreakdown` builds an accordion tree from RPC 2 rows — no hardcoded catalog. Sparse `billing_variant_id` on historical trips shows payer-only or payer+type rows without expand buttons.

## Known limitations

- `vehicle_id` is largely unpopulated — no fleet KPIs
- `actual_pickup_at` sparse — no SLA/on-time metrics
- No driver cost data — no margin analysis
- `completed` trip status under-represented until driver app adoption grows
- ~63% of trips may lack `billing_variant_id` — variant drill-down is sparse on old data

## Deferred (Tier 3)

- Vehicle/fleet utilization
- SLA / on-time performance
- Driver cost / margin analysis
- Sub-page drill-through routes

## Developer setup

After pulling this migration, run:

```bash
supabase db push
```

Then regenerate types if needed: `supabase gen types typescript --local > src/types/database.types.ts`
