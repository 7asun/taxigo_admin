# Payer Reporting KPI Audit

## Executive Recommendation

TaxiGo should build payer reporting now, but Phase 1 should be a **payer spend and operational behavior report**, not a broad SLA or collections scorecard. The current system already has strong trip, payer, billing family, billing variant, price, km, invoice, and period-comparison foundations. It does not yet prove enough reliable actual pickup/dropoff, denial, rejection, or payer-facing payment workflow data to expose on-time or deep collections claims.

If I were the staff engineer responsible for this module, I would approve Phase 1 with these KPI groups:

- Spend: total gross/net spend, average price per trip, average price per km, and month-over-month/previous-period deltas.
- Volume and mix: trip count, billing family share, billing variant share where populated, KTS/reha/wheelchair flags where relevant.
- Distance: total billed/routed km, average km per trip, km by billing family, and km data-quality warnings.
- Booking behavior: lead-time buckets from `trips.created_at` to `trips.scheduled_at`, but only for rows where both fields are present and `scheduled_at` was written through the current Berlin-time-safe paths.
- Data trust: unpriced trips, missing km, missing payer/billing classification, cancelled-trip exclusion, invoice snapshot caveats, and timezone caveats.

I would defer payer-facing on-time performance, days-to-invoice, days-to-payment, denials/rejections, correction rates outside KTS, and “total paid/open amount by payer” until the report uses invoice snapshots and payment state as a first-class read model rather than reusing the current global controlling AR KPIs.

Recommended UI shape: a separate `/dashboard/reports` area with a first report called **Kostenträgerbericht**. Start table-first with KPI cards and export, then add charts. Existing `/dashboard/controlling` should remain internal CFO analytics; payer reporting should be designed as a credible externalizable artifact with data-quality banners.

## Evidence Base

Primary evidence read for this audit:

- `package.json` and nearest lockfile `bun.lock` (`bun.lockb` does not exist in this repository).
- Generated Supabase types in `src/types/database.types.ts`.
- Reporting-relevant migrations under `supabase/migrations`, especially trip pricing, billing families/variants, invoice/line item, KTS, manual km, controlling RPCs, and invoice status migrations.
- No `supabase/functions/**` files were found, so there are no edge functions to audit in that path.
- Existing app surfaces in `src/app/dashboard/controlling/page.tsx`, `src/features/controlling/**`, `src/features/invoices/**`, `src/features/payers/**`, `src/features/trips/**`, `src/features/dashboard/**`, `src/lib/**`, and `src/types/**`.
- Existing docs and plans including `docs/controlling-module.md`, `docs/billing-families-variants.md`, `docs/invoices-module.md`, `docs/trips-date-filter.md`, `docs/urgency-indicator.md`, `docs/manual-km-overrides.md`, `docs/bank-reconciliation-module.md`, and related plan audits.
- Generated DB types are stale/incomplete for invoice reporting: migrations and app code prove `invoices` and `invoice_line_items`, but `src/types/database.types.ts` does not currently expose them under `Tables`. Treat invoice-report implementation as needing type regeneration/repair before coding.

## Current Domain Model

### Trips

| Entity / source | Key fields | Meaning | Nullability / reliability | KPI safe today |
|---|---|---|---|---|
| `trips` | `id`, `company_id`, `created_at`, `scheduled_at`, `requested_date`, `status` | Core operational fact row. `scheduled_at` is the appointment instant; `requested_date` supports date-only/unscheduled rows. | `company_id`, `created_at`, `scheduled_at`, payer and km fields can be null on legacy/import/draft rows. Controlling RPCs ignore rows with `scheduled_at IS NULL`. | Safe for scheduled-trip KPIs when filtered to non-cancelled, non-null `scheduled_at`; uncertain for unscheduled/date-only reporting unless explicitly included via `requested_date`. |
| `trips.status` | `pending`, `open`, `scheduled`, `assigned`, `in_progress`, `driving`, `completed`, `cancelled` | Trip lifecycle. App labels live in `src/lib/trip-status.ts`; `open`/`driving` are legacy aliases. | Not a DB enum in generated types; free-text check constraints may exist outside generated types. `completed` is under-represented per docs until driver app adoption grows. | Safe for cancelled exclusion and broad state grouping; uncertain for completion-rate quality claims. |
| `trips.scheduled_at` | timestamptz string | Scheduled pickup/dispatch appointment. | Current writes should use `buildScheduledAt`; legacy rows may have timezone drift from older Date construction. Null when date-only or unscheduled. | Safe for current-period bucketing with Berlin helpers; lead-time safe only with caveat. |
| `trips.requested_date` | `YYYY-MM-DD` string | Civil date for date-only unscheduled rows. | Nullable; no clock time. | Safe for “requested date exists” data-quality and date-only count; not safe for lead-time duration. |
| `trips.actual_pickup_at`, `actual_dropoff_at` | timestamptz strings | Actual operational timestamps. | Sparse; docs explicitly state no SLA/on-time metrics yet. | Block payer-facing on-time KPIs today. |
| `trips.created_at` | timestamptz string | Trip creation timestamp. | Nullable in generated types; server default likely present, but legacy uncertainty remains. | Safe for lead-time only where non-null and paired with safe `scheduled_at`. |
| `trips.payer_id` | FK to `payers` | Kostenträger for the trip. | Nullable for legacy/import gaps. | Safe when non-null; missing payer should be a data-quality warning. |
| `trips.billing_variant_id` | FK to `billing_variants` | Leaf billing Unterart. | Nullable. Docs mention historical sparsity; generated types also still include `billing_type_id`, while docs say legacy `billing_type_id` was dropped then later reintroduced as resolved family reference. | Safe for current rows; variant drill-down needs missing-rate warning. |
| `trips.billing_type_id` | FK to `billing_types` | Resolved billing family on trip, used by controlling RPC. | Conflicting history: `20260326120000` drops it, `20260418120000` re-adds it, docs say monthly invoice fetch should use variants. Must be treated as denormalized family field. | Safe for controlling-style family grouping if populated; cross-check against variant parent before payer-facing release. |
| `trips.payment_method` | text | Payment method style field, likely legacy/self-payer use. | No strong reporting semantics found. | Internal-only/uncertain. |
| `trips.no_invoice_required`, `no_invoice_source` | boolean/text | Exclude from invoicing by default for some billing variants/payers. | Current workflow-specific. | Safe as data-quality/exclusion indicator; not a revenue KPI alone. |
| `trips.driving_distance_km`, `driving_duration_seconds` | numeric/integer | Google Directions route metrics. | Null when geocoding/routing missing. | Safe with missing-km warning. |
| `trips.manual_distance_km` | numeric | Admin billing km override. | Nullable; never mutates route km. | Safe for billable km if formula uses `COALESCE(manual_distance_km, driving_distance_km)`. |
| `trips.net_price` | generated numeric | `COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0)`. | Unpriced trips surface as `0`, not null. | Safe only if `0` is treated as unpriced/unknown, not true zero revenue. |
| `trips.gross_price` | numeric | Gross trip price snapshot/writeback. | Nullable; added after initial price model. | Safe with missing-gross warning; controlling already sums it. |
| `trips.base_net_price`, `approach_fee_net` | numeric | Split transport net and approach fee net. | Nullable on legacy rows until backfill/writeback. | Safe for detailed spend only after completeness check. |
| `trips.manual_gross_price`, `manual_tax_rate` | numeric | Invoice/admin override fields. | Nullable; workflow-specific. | Internal audit fields, not payer headline KPIs. |
| `trips.kts_*`, `reha_schein` | booleans/status/amounts | KTS workflow, external invoice/import, Eigenanteil, Rückläufer, paid/abgerechnet states. | KTS-specific and partly imported from external invoices. | Safe for KTS subreport if scoped to KTS; not general payer reporting. |
| `trips.driver_id`, `vehicle_id`, `fremdfirma_*` | FKs/text/numeric | Assigned driver, vehicle, external company and cost. | `vehicle_id` largely unpopulated per docs; external company fields may be relevant internally. | Driver assignment safe internally; vehicle KPIs blocked; Fremdfirma cost internal-only. |

### Payers, Clients, Billing, Recipients

| Entity / source | Key fields | Meaning | Nullability / reliability | KPI safe today |
|---|---|---|---|---|
| `payers` | `id`, `company_id`, `name`, `number` | Institutional payer / Kostenträger. | `number` required in types; address fields exist in app/migrations but generated type appears incomplete. | Safe as reporting dimension. |
| `payers` flags | `manual_km_enabled`, `reha_schein_enabled`, `revision_invoices_enabled`, `kts_default`, `no_invoice_required_default`, `accepts_self_payment` | Per-payer workflow behavior. | Some generated type TODO comments indicate types may lag migrations. | Safe as configuration context, not outcome KPI. |
| `billing_types` | `payer_id`, `name`, `color`, `behavior_profile`, `rechnungsempfaenger_id`, `accepts_self_payment` | Abrechnungsfamilie under payer. | Names can change; IDs stable. Behavior JSON not ideal for reporting except explicit cascades. | Safe by ID/name snapshot if current catalog used; historical names need care. |
| `billing_variants` | `billing_type_id`, `name`, `code`, `kts_default`, `no_invoice_required_default`, `rechnungsempfaenger_id` | Unterart leaf used by trips and CSV matching. | Nullable on old trips. Code is stable intended hook but can be edited by admins. | Safe for current/future detail; historical missing-rate warning required. |
| `rechnungsempfaenger` | name/address/contact fields | Invoice recipient / cost-center-like recipient. | Can be attached at payer/family/variant/invoice snapshot levels. | Safe for invoice output, not necessarily payer KPI unless product defines cost-center reporting. |
| `clients` | `id`, `customer_number`, name/address, `price_tag`, `reference_fields`, `kts_patient_id` | Passenger/client. | Client may be null on named but unlinked trips. | Useful for internal drill-down; avoid payer-facing patient-level detail unless privacy-approved. |
| `client_price_tags`, `client_km_overrides` | `client_id`, `payer_id`, `billing_variant_id`, price/km | Per-client pricing and km overrides. | Active rows only; variant/payer scoped. | Good for explaining price/km data quality, not headline payer KPI. |

### Invoices, Line Items, Payments

| Entity / source | Key fields | Meaning | Nullability / reliability | KPI safe today |
|---|---|---|---|---|
| `invoices` | `id`, `company_id`, `invoice_number`, `payer_id`, `mode`, `period_from`, `period_to` | Invoice header. | Generated types appear incomplete for full invoice table, but migrations and APIs prove fields. | Safe for invoice-snapshot reporting. |
| `invoices.status` | `draft`, `sent`, `paid`, `cancelled`, `corrected` | Invoice lifecycle. | Drafts are mutable; sent/paid immutable except Storno/correction flow. | Safe if draft/final states are separated. |
| `invoices.created_at`, `sent_at`, `paid_at`, `cancelled_at` | timestamps | Creation, sent, paid, cancellation lifecycle. | `paid_at` populated by manual/bank reconciliation status update; sent may be null on old rows. | Safe with null filters; days-to-payment feasible with caveats. |
| `invoices.subtotal`, `tax_amount`, `total` | numeric | Net, tax, gross invoice totals. | Snapshot at invoice creation/finalization. Draft totals may change. | Safe for final invoice reporting when `status IN ('sent','paid')`; drafts internal-only. |
| `invoices.billing_type_id`, `billing_variant_id` | optional scope | Header scope for some modes. | Docs state monthly multi-family/multi-variant filters are fetch-only and not persisted. | Not safe as only source for billing mix; use line items/trips. |
| `invoice_line_items` | `invoice_id`, `trip_id`, `line_date`, `description`, `client_name`, addresses | Frozen invoice detail. | Legal snapshot; manual rows have no `trip_id`. | Best source for issued payer-facing financial reports. |
| `invoice_line_items.distance_km`, `effective_distance_km`, `original_distance_km` | numeric | Routing km, billable km, original route km snapshots. | Nullable on legacy/missing route rows. | Best source for billed km after invoice; live trips for pre-invoice forecast. |
| `invoice_line_items.unit_price`, `quantity`, `total_price`, `approach_fee_net`, `tax_rate` | numeric | Line pricing snapshot. | `total_price` is net line amount; gross derived with tax. | Safe for issued revenue mix. |
| `invoice_line_items.billing_variant_code`, `billing_variant_name`, `billing_type_name` | text snapshots | Billing classification at invoice time. | Snapshot names only; no IDs in line-item base schema. | Safe for issued document grouping by label, less safe for ID-stable longitudinal analysis. |
| `invoice_line_items.billing_included`, `billing_exclusion_reason`, `is_cancelled_trip`, `cancelled_billing_reason` | booleans/text | Excluded lines and opted-in cancelled billing. | Newer columns; legacy rows default included. | Safe for invoice-quality warnings and cancelled-billed metrics. |
| Bank reconciliation | `useUpdateInvoiceStatus(... paidAt)` and docs | Marks sent invoices paid from CSV import. | No separate payment table found; payment event detail is compressed into invoice status/paid_at. | Basic paid/open KPIs feasible; payment audit trail/partial payments blocked. |

## KPI Feasibility Matrix

Legend: **Now** = feasible with current schema/services. **Minor backend** = needs a payer-report RPC/view/read model, but no broad redesign. **Blocked** = data not reliable enough or missing workflow.

| Category | KPI | Business meaning | Formula / logic | Required fields | Feasibility | Caveats | Audience |
|---|---|---|---|---|---|---|---|
| Billing mix | Trips by billing family | How payer demand splits by Abrechnungsfamilie | Count non-cancelled trips grouped by `billing_type_id` or variant parent | `trips.payer_id`, `billing_type_id`, `status` | Now | Missing family rows must be shown as unknown | Both |
| Billing mix | Trips by billing variant | Unterart distribution | Count by `billing_variant_id` | `trips.billing_variant_id` | Now | Historical sparsity; warn | Both |
| Billing mix | Billing family share | Percentage of trips per family | family trips / payer trips | same | Now | Exclude cancelled from denominator | Both |
| Billing mix | Billing variant share | Percentage of trips per Unterart | variant trips / payer trips | same | Now | Variant missing-rate may distort | Both |
| Billing mix | Spend by billing family | Cost distribution by family | Sum gross/net by family | trip price fields or line snapshots | Minor backend | Prefer invoice lines for issued payer-facing spend | Both |
| Billing mix | Spend by billing variant | Cost distribution by Unterart | Sum gross/net by variant | trip or line fields | Minor backend | Current line snapshots lack variant ID, but have code/name | Both |
| Billing mix | Payer x billing family matrix | Compare institutional payer mix | group by payer and family | `payer_id`, `billing_type_id`, prices/km | Now via controlling, better via RPC | Current controlling is internal | Internal now, payer later |
| Billing mix | KTS share | Share requiring KTS docs | `kts_document_applies=true` / trips | `trips.kts_document_applies` | Now | KTS default cascade changed over time | Both if payer cares |
| Billing mix | No-invoice-required share | Share excluded by configuration | count `no_invoice_required=true` | trip flag | Now | Internal workflow, explain carefully | Internal |
| Revenue and amount | Total spend gross | Payer gross cost for period | Sum `gross_price` on trips or invoice `total`/line gross | prices/status | Now | For payer-facing, prefer final invoices | Both |
| Revenue and amount | Total revenue net | TaxiGo net revenue | Sum `net_price` or line `total_price` | net fields | Now | Net is internal/accounting; gross usually payer-facing | Internal/both |
| Revenue and amount | Average price/trip | Cost intensity | Sum amount / trip count | amount + count | Now | Exclude unpriced and cancelled or show both variants | Both |
| Revenue and amount | Average price/km | Cost efficiency | Sum amount / sum km | amount + km | Now | Missing km can bias; require warning | Both |
| Revenue and amount | Approach fee share | Share from Anfahrt | Sum `approach_fee_net` / net | trip split or line split | Minor backend | Nullable legacy; net-only unless grossed up | Internal, maybe payer |
| Revenue and amount | Transport revenue | Fare excluding approach | Sum `base_net_price` | trips | Now with caveat | Legacy nulls | Internal |
| Revenue and amount | Unpriced trip count/share | Data completeness | count `net_price=0` / trips | `net_price`, status | Now | Generated zero means unknown or true zero; inspect KTS/no-invoice | Internal, trust banner |
| Revenue and amount | Manual override amount/share | Pricing intervention | count/sum where `manual_gross_price` or manual tax/km set | manual fields | Now | Internal audit only | Internal |
| Revenue and amount | KTS imported amount | External KTS invoice amount | Sum `kts_invoice_amount`, `kts_eigenanteil` | KTS fields | Now | KTS-specific, not same as app invoice totals | Both for KTS reports |
| Distance and utilization | Total km | Transport volume | Sum `COALESCE(manual_distance_km, driving_distance_km)` | km fields | Now | Billing vs routed km distinction | Both |
| Distance and utilization | Average km/trip | Trip length profile | total km / trip count | km fields | Now | Missing km warning | Both |
| Distance and utilization | Km by billing family | Resource use by category | Sum km by family | km + billing | Now | Same sparsity caveats | Both |
| Distance and utilization | Km by payer | Concentration of distance | Sum km by payer | km + payer | Now | Null km | Both |
| Distance and utilization | Trips per active day | Operational intensity | trips / distinct scheduled Berlin days | `scheduled_at` | Now | Existing active_days is driver-level, not payer-level | Internal/both if recalculated per payer |
| Distance and utilization | Wheelchair trip share | Accessibility demand | wheelchair trips / trips | `is_wheelchair` | Now | Flag quality depends on create flow | Both |
| Distance and utilization | Fremdfirma share/cost | Outsourced operations | count/sum `fremdfirma_id`, `fremdfirma_cost` | Fremdfirma fields | Now | Internal cost data | Internal |
| Lead time | Avg lead time | Booking advance notice | avg(`scheduled_at - created_at`) | both timestamps | Minor backend | Exclude nulls; timezone caveats | Both with warning |
| Lead time | Median lead time | Typical booking behavior | percentile_cont | both timestamps | Minor backend | Needs SQL/RPC | Both |
| Lead time | Lead-time buckets | Urgent vs planned mix | bucket hours between created and scheduled | both timestamps | Minor backend | Current app has urgency-to-now, not created-to-pickup | Both |
| Lead time | Same-hour requests | Very urgent demand | lead time < 1 hour | both timestamps | Minor backend | Scheduled_at legacy drift risk | Both |
| Lead time | Same-day requests | Operational pressure | same Berlin date and lead < 24h | both timestamps | Minor backend | Requires Berlin date comparison | Both |
| Lead time | Planned share | Planned operations | lead time > 24h / total valid lead rows | both timestamps | Minor backend | Null denominator shown | Both |
| Lead time | Lead time by billing family | Which services are urgent | bucket by billing family | timestamps + billing | Minor backend | Needs enough rows | Both |
| Time performance | On-time pickup rate | SLA adherence | actual pickup within threshold of scheduled | `actual_pickup_at`, `scheduled_at` | Blocked | Actual pickup sparse | Both later |
| Time performance | Average pickup delay | Delay minutes | avg(actual - scheduled) | same | Blocked | Sparse and workflow adoption | Internal later |
| Time performance | Completion duration | Trip duration | `actual_dropoff_at - actual_pickup_at` | actual timestamps | Blocked | Sparse | Internal later |
| Time performance | Dispatch urgency currently open | Trips due soon/overdue now | urgency windows vs now | `scheduled_at`, `status` | Now | Live ops metric, not period report | Internal |
| Outcome quality | Cancelled trip rate | Service failure/cancellation burden | cancelled / all trips | `status` | Now | Cause quality depends on notes | Both with caveat |
| Outcome quality | No-show rate | Passenger/provider no-show | no dedicated field | missing | Blocked | Could be encoded in notes but not reliable | Blocked |
| Outcome quality | Cancellation reason mix | Why trips cancel | categorize `canceled_reason_notes` | notes | Minor/backend + taxonomy | Free text today | Internal |
| Outcome quality | Completed trip share | Operational completion | completed / non-cancelled | status | Now with caveat | Driver adoption under-represents completed | Internal |
| Outcome quality | Missing assignment share | Dispatch risk | `driver_id IS NULL` / trips | driver_id | Now | Some future trips intentionally unassigned | Internal |
| Invoice quality | Invoicing rate | Trips invoiced / period trips | line items with included rows / period trips | `invoice_line_items`, `trips` | Now via controlling | Current function global, not payer-scoped | Internal, payer later |
| Invoice quality | Draft invoice count | Work in progress | count status draft | invoices | Now | Drafts not payer-facing | Internal |
| Invoice quality | Sent/open invoices | Receivables open | count/sum `status='sent'` | invoices | Now | Current controlling not payer-scoped | Internal; payer with RPC |
| Invoice quality | Paid invoices | Settled billed amount | count/sum `status='paid'` | invoices | Now | No separate payment rows | Both with caveat |
| Invoice quality | Overdue amount | Open past due | sent and due date < now | invoices | Now | Due date uses created/sent fallback | Internal, payer maybe |
| Invoice quality | Days sales outstanding | Days to payment | avg(`paid_at - sent_at`) | invoices | Now | Global controlling only; ignores unpaid | Internal |
| Invoice quality | Days to invoice | Billing latency after service | invoice created - last line service date | invoice + line items | Minor backend | Need line aggregate per invoice | Both/internal |
| Invoice quality | Correction/storno rate | Billing rework | corrected/cancelled/storno invoice count | invoice status/FKs | Now | Interpret carefully: legal flow not payer denial | Internal |
| Invoice quality | Excluded trip share | Trips intentionally not billed | line `billing_included=false` | line items | Now | Only after invoicing | Internal/trust |
| Payer relationship | Revenue concentration | Dependency risk | payer revenue / total revenue | payer + amount | Now | Internal strategic | Internal |
| Payer relationship | Top payer share | Concentration | max payer revenue / total | same | Now | Internal | Internal |
| Payer relationship | Payer growth | Current vs prior period | delta by payer | periods | Now in controlling for net | For payer report use selected payer only | Both |
| Payer relationship | Mix concentration | Dominance of one billing family | max family share | billing mix | Now | Useful payer narrative | Both |
| Payer relationship | Client concentration | Spend concentrated in few patients | top client share | client_id + amount | Minor backend | Privacy concerns | Internal only |
| Trends | MoM spend delta | Budget trend | current month amount vs previous month | amount + periods | Now/minor | Need payer-scoped reusable compare | Both |
| Trends | WoW trip delta | Demand shift | current week trips vs previous | trip counts | Now/minor | Existing generic previous period can reuse | Both |
| Trends | Km delta | Utilization trend | current km vs prior | km | Now/minor | Missing km changes can distort | Both |
| Trends | Mix delta | Service category shift | current share - prior share | billing mix | Minor backend | Need stable category IDs | Both |
| Trends | Urgency mix delta | Booking behavior trend | bucket shares vs prior | lead buckets | Minor backend | Requires lead-time read model | Both |
| Data quality | Missing price share | Trust warning | unpriced / trips | price fields | Now | Block spend-per-trip if high | Both as warning |
| Data quality | Missing km share | Trust warning | km null / trips | km fields | Now | Block €/km if high | Both |
| Data quality | Missing payer share | Trust warning | payer null / trips | payer | Now | Block payer-specific report if selected payer not affected? | Internal |
| Data quality | Missing billing variant share | Trust warning | variant null / trips | billing | Now | Warn on variant mix | Both |
| Data quality | Legacy timezone risk count | Rows before time migration / suspicious offsets | created window or audit queries | timestamps | Minor backend | No explicit migration marker | Internal |
| Data quality | Cancelled included/excluded clarity | Avoid mixed denominators | cancelled counts separate | status | Now | Always show denominator definition | Both |

## Billing-Type Reporting Depth

Billing segmentation currently has three layers:

- `payers`: Kostenträger.
- `billing_types`: Abrechnungsfamilie, one or more per payer.
- `billing_variants`: Unterart, child of billing family, selected by trips via `trips.billing_variant_id`.

There are competing historical fields:

- `trips.billing_variant_id` is the current leaf FK and the strongest source for new trip classification.
- `trips.billing_type_id` was dropped in `20260326120000_billing_families_and_variants.sql`, then reintroduced in `20260418120000_trips-price-schema.sql` as a direct family reference. Existing controlling RPCs group on `t.billing_type_id` and `t.billing_variant_id`.
- Invoice builder monthly filters intentionally use variant IDs resolved from selected family IDs; `invoices.billing_type_id` is not a reliable persisted source for multi-family invoice scope.
- `invoice_line_items` snapshot billing labels (`billing_type_name`, `billing_variant_name`, `billing_variant_code`) but not stable IDs in the base schema.

Can a trip change billing type over time? Yes, admin edit flows can update payer/billing fields before invoicing. Historical reporting over live trips is therefore “current trip state” reporting. Issued invoice reporting is stable because line items snapshot billing names/code at invoice time.

Reliability today:

- Revenue per billing type: safe internally from `get_controlling_breakdown`; payer-facing should prefer invoice line snapshots for issued spend or add a report RPC that uses current trip fields for operational period reports.
- Km per billing type: safe with missing-km warning via `COALESCE(manual_distance_km, driving_distance_km)`.
- Trip count per billing type: safe if null family/variant is shown as “Unbekannt” and not dropped.
- Percentage share per billing type: safe only after denominator definition is explicit: non-cancelled scheduled trips, valid lead-time rows, or issued invoice lines.
- Payer + billing type cross-breakdowns are essential. A payer report without this cross-tab misses the strongest value: explaining what the payer is buying.

## Lead-Time and Booking Behavior

Lead time can be calculated as `scheduled_at - created_at` for rows where both timestamps are non-null. The current codebase does not appear to have a dedicated lead-time KPI; urgency logic is based on `scheduled_at` versus `now`, which is a live dispatch indicator, not booking behavior.

Feasibility:

- Trip created to pickup time: feasible with minor backend work.
- Same-hour requests: feasible with minor backend work.
- `<1h`, `1-6h`, `6-24h`, `>24h`, custom buckets: feasible with minor backend work.
- Urgent vs planned share: feasible with minor backend work.
- Payer-specific booking behavior: feasible with payer-scoped grouping.
- Period-over-period changes: feasible by reusing `buildPreviousControllingPeriod`.

Timezone safety:

- Current scheduled writes have a strong invariant: persisted `trips.scheduled_at` must be created by `buildScheduledAt()` or `buildScheduledAtOrNull()` in `src/features/trips/lib/trip-time.ts`, using the business timezone (`Europe/Berlin` default).
- Read day boundaries use `getZonedDayBoundsIso()` in `src/features/trips/lib/trip-business-date.ts`.
- Controlling SQL buckets `scheduled_at` with `(scheduled_at AT TIME ZONE 'Europe/Berlin')::date`.
- Known risk: legacy rows may predate the timezone cleanup and could encode browser/server local time. Lead-time duration in hours is less sensitive than calendar-day grouping, but wrong persisted `scheduled_at` still shifts bucket assignment.

Recommendation: Phase 1 may include lead-time buckets only with a data-quality note: “calculated for trips with creation timestamp and scheduled pickup time.” Do not report lead time for `scheduled_at IS NULL` date-only rows.

## Tiered Payer-Value KPI Proposal

### Tier 1: Must-Have First Release

- Total spend gross and net for selected payer/period.
- Trip count, cancelled count, and non-cancelled trip count.
- Spend by billing family and trip count by billing family.
- Km by billing family, total km, average km/trip.
- Average price/trip and average price/km.
- Billing family percentage share.
- Previous-period change for spend, trips, km, and average price/trip.
- Lead-time distribution for valid rows: `<1h`, `1-6h`, `6-24h`, `>24h`.
- Data-quality banner: missing price, missing km, missing billing classification, cancelled excluded, unscheduled/date-only excluded from lead-time.

### Tier 2: Strong Value-Add After Core Stabilizes

- Billing variant detail with missing-variant warning.
- Spend/km/trip matrix: billing family x month.
- KTS/reha/wheelchair service mix where enabled for the payer.
- Days to invoice from latest service date to invoice `created_at`.
- Invoice status summary by payer: draft/sent/paid/corrected, open amount, overdue amount.
- Exportable payer scorecard PDF/CSV.
- Comparison to previous month and previous same-length period.

### Tier 3: Only If Data Quality Supports It

- On-time pickup rate and average delay.
- No-show rate.
- Denial/rejection rate outside KTS Rückläufer.
- Partial payment / collection workflow metrics.
- Vehicle utilization by payer.
- Patient/client concentration for payer-facing reports.
- Margin or profitability by payer after driver/vehicle cost model exists.

## Payer Scorecard Possibility

Supported today:

- Total billed: invoices `total` by payer/status or line-item sums.
- Total paid: invoices `status='paid'` and `paid_at`.
- Open amount: invoices `status='sent'`.
- Overdue amount: `sent` invoices where due date is before `now()`.
- Trend vs previous month: available with existing period utilities and payer filters.
- Billing mix concentration: available from trip or line item groupings.
- Operational behavior profile: lead-time buckets, cancellation share, km/trip, billing mix.

Partially supported:

- Average days to invoice: needs a read model joining invoices to line items and calculating latest/average `line_date`.
- Average days to payment: possible where `sent_at` and `paid_at` are present, but no partial payment table.
- Correction/revision: possible from `corrected`, `cancelled`, `cancels_invoice_id`, `replaces_invoice_id`; interpretation is “internal correction flow,” not payer denial.
- KTS rejection/return: possible from `kts_status='ruecklaufer'` and `kts_ruecklaufer_reason`, but only for KTS.

Minimum additions for a credible scorecard:

- A payer-scoped reporting RPC or SQL view that returns current and previous period metrics consistently.
- A line-item based issued-spend read model for payer-facing numbers.
- Optional payment event table only if partial payments, bank reference, or audit-grade collection history becomes required.
- Optional cancellation/no-show reason taxonomy if outcome quality will be payer-facing.

## Comparison Logic

Existing reusable comparison infrastructure:

- `src/features/controlling/lib/controlling-utils.ts` builds Berlin-safe periods and previous periods.
- `buildPreviousControllingPeriod()` shifts the selected inclusive day range backward by the same number of days.
- `useControllingData()` already fetches current and previous operational and breakdown data.
- `PayerComparisonChart` compares current vs previous revenue by `payer_id`.
- `KpiCards`, `WheelchairStats`, and other controlling components consume current/previous query pairs.

Month-over-month and week-over-week are not a standalone generic reporting service yet, but the primitives exist. Payer/billing breakdowns can be generated for both periods because `get_controlling_breakdown` accepts `p_date_from`/`p_date_to`. A payer report should reuse the period math, but likely needs a new report-specific RPC that:

- accepts `payer_id` nullable or required,
- returns both current and previous in one call or stable parallel calls,
- computes billing mix, spend, km, lead-time buckets, and data-quality counts with the same filters.

## Reporting Architecture Options

Recommended technical shape:

- Phase 1: separate `/dashboard/reports` page with a `Kostenträgerbericht` report.
- Use a reusable reporting service/hook layer rather than embedding logic in chart components.
- Table-first with KPI cards and CSV/PDF export; charts second.
- Use trip-operational metrics for current operational behavior and invoice-line metrics for issued financial truth.
- Keep `/dashboard/controlling` as internal CFO analytics; do not overload it with payer-facing semantics.

Phase 1 architecture:

- `src/features/reports/payer-reporting/` with `api`, `hooks`, `components`, `lib`, and `types`.
- One Supabase RPC or SQL view candidate: `get_payer_report_kpis(p_company_id, p_payer_id, p_date_from, p_date_to, p_compare_from, p_compare_to)`.
- Output sections: KPI cards, billing mix table, lead-time buckets, trend table, data-quality banner, export payload.

Later phases:

- Payer drill-down page from `payers` details.
- Export-first PDF scorecard.
- Chart-first overview once formulas are accepted.
- Separate issued-invoice scorecard once invoice snapshot read model is built.

## Data Quality and Trust Layer

| Risk | Severity | Affected KPIs | Recommendation |
|---|---:|---|---|
| Missing prices represented as `net_price = 0` | High | spend, averages, €/km | Warn; exclude from averages or show priced-trip denominator. |
| Conflicting revenue definitions: live trips vs issued invoice snapshots | High | total spend, billing mix spend | For payer-facing issued reports, use invoice lines/invoices; for operational forecast, label as trip-current. |
| Null km values | High | total km, avg km, €/km | Warn; block €/km if missing share exceeds chosen threshold. |
| Manual km vs routed km | Medium | km, €/km | Use billed km formula and label it; optionally show routed km separately. |
| `billing_type_id` history and variant sparsity | High | billing mix | Use variant parent where possible; show missing classification rate. |
| Timezone legacy rows | Medium | period bucketing, lead time | Use Berlin helpers/RPCs; warn for legacy periods if needed. |
| `actual_pickup_at` sparse | High | on-time KPIs | Block SLA/on-time KPIs. |
| Cancelled trips mixed into core metrics | High | counts, spend, averages | Default exclude from core spend; show cancelled separately. |
| Draft vs sent/paid invoices | High | billed/paid/open amounts | Payer-facing financials should use sent/paid; drafts internal-only. |
| Invoice header scope not preserving multi-family filters | Medium | invoice billing mix | Use line items, not invoice header `billing_type_id`. |
| No separate payment table | Medium | collection quality | Basic status KPIs only; block partial-payment analytics. |
| Accountant-system-as-master ambiguity | Medium | paid/open correctness | Treat TaxiGo invoice status as app state unless accounting integration is defined. |
| KTS external invoice fields differ from TaxiGo invoices | Medium | KTS spend/status | Keep KTS KPIs in separate module/section. |
| Client/patient-level privacy | High | concentration, drilldown | Internal-only unless privacy/legal approval. |
| Stale generated invoice types | Medium | implementation safety | Regenerate/fix `src/types/database.types.ts` before adding invoice-report code. |
| Existing invoice-builder date range uses raw UTC suffix | Medium | payer invoice/trip fetch reuse | Do not copy `period_to + 'T23:59:59.999Z'`; payer report RPCs should accept Berlin YMD and use DB-side Berlin bounds. |

## Strongest Deliverable Recommendation

Ship first:

- Payer selector, period selector, and previous-period comparison.
- KPI cards: gross spend, trip count, total km, avg price/trip, avg price/km, lead-time planned share.
- Billing family distribution: spend, trips, km, share, delta.
- Lead-time buckets: `<1h`, `1-6h`, `6-24h`, `>24h`.
- Month-over-month / previous-period table.
- Data-quality banner and downloadable CSV.

Intentionally defer:

- On-time pickup/delay.
- No-show.
- Denial/rejection except KTS Rückläufer in KTS-specific context.
- Full collection scorecard until payment semantics are stronger.
- Vehicle utilization and profitability.

Safe to expose to payers later:

- Gross spend, trip count, km, average price/km, billing mix, lead-time distribution, cancellation rate with careful definitions, and data-quality notes.

Internal-only for now:

- Net revenue, Fremdfirma cost, unassigned trip share, manual overrides, draft invoices, correction/revision workflow, client concentration, and unpriced trip remediation.

Commercial value:

- Gives institutional payers budget transparency.
- Turns TaxiGo from “transport vendor” into a reporting partner.
- Supports contract conversations with evidence: urgency burden, service mix, km trends, and cost drivers.
- Creates a defensible export/reporting module without overclaiming SLA data.

## Suggested Output Model

Recommended report payload shape:

```ts
interface PayerReportOutput {
  period: { from: string; to: string; label: string };
  previousPeriod: { from: string; to: string; label: string };
  payer: { id: string; name: string; number: string | null };
  kpis: {
    grossSpend: Metric;
    netSpendInternal: Metric;
    tripCount: Metric;
    totalKm: Metric;
    avgPricePerTrip: Metric;
    avgPricePerKm: Metric;
    plannedShare: Metric;
  };
  billingMix: BillingMixRow[];
  leadTimeBuckets: LeadTimeBucket[];
  trendRows: TrendRow[];
  payerBillingMatrix?: PayerBillingMatrixRow[];
  invoiceSummary?: InvoiceSummary;
  dataQuality: DataQualityWarning[];
}
```

Recommended UI sections:

- KPI cards: immediate executive summary.
- Billing type distribution: payer value and cost driver explanation.
- Payer trend chart: period-over-period change.
- Lead-time buckets: operational behavior profile.
- Revenue/km/trip count table: exportable, auditable detail.
- Month-over-month change table: commercial narrative.
- Data quality banner: credibility and trust.
- Optional export schema: CSV first, PDF later.

## Appendix: Candidate Formulas and Field Mappings

### Core Filters

- Scheduled trip period: `(trips.scheduled_at AT TIME ZONE 'Europe/Berlin')::date BETWEEN date_from AND date_to`.
- Core trips: `status <> 'cancelled' AND scheduled_at IS NOT NULL`.
- Billable trip km: `COALESCE(manual_distance_km, driving_distance_km)`.
- Live trip net: `trips.net_price`.
- Live trip gross: `trips.gross_price`.
- Unpriced trip: `status <> 'cancelled' AND (net_price IS NULL OR net_price = 0)`.
- Issued invoice rows: invoices where `status IN ('sent','paid')`, joined to `invoice_line_items`.
- Included invoice lines: `COALESCE(invoice_line_items.billing_included, true) = true`.

### Candidate Formulas

- Total gross spend (live): `SUM(gross_price) FILTER (WHERE status <> 'cancelled')`.
- Total net revenue (live): `SUM(net_price) FILTER (WHERE status <> 'cancelled' AND net_price > 0)`.
- Total issued gross spend: `SUM(invoices.total) WHERE status IN ('sent','paid')`.
- Line issued net spend: `SUM(invoice_line_items.total_price) WHERE included`.
- Approx line issued gross: sum line net plus tax by line, or use invoice header `total` for invoice-level gross.
- Trip count: `COUNT(*) FILTER (WHERE status <> 'cancelled')`.
- Cancellation rate: `cancelled_count / (cancelled_count + non_cancelled_count)`.
- Total km: `SUM(COALESCE(manual_distance_km, driving_distance_km))`.
- Avg price/trip: `SUM(amount) / COUNT(non_cancelled trips)`.
- Avg price/km: `SUM(amount) / SUM(km)`.
- Billing share: `group_trip_count / payer_trip_count`.
- Lead time hours: `EXTRACT(EPOCH FROM (scheduled_at - created_at)) / 3600`.
- Lead bucket:
  - `<1h`: lead hours >= 0 and < 1
  - `1-6h`: >= 1 and < 6
  - `6-24h`: >= 6 and < 24
  - `>24h`: >= 24
- Previous-period delta: `(current - previous) / NULLIF(previous, 0)`.
- Days to invoice: `invoice.created_at - MAX(invoice_line_items.line_date)` per invoice.
- Days to payment: `paid_at - sent_at`.
- Open amount: `SUM(total) WHERE status='sent'`.
- Overdue amount: `SUM(total) WHERE status='sent' AND COALESCE(sent_at, created_at) + payment_due_days < now()`.

### Ambiguous Fields Requiring Founder/Product Decision

- Should payer-facing spend use live trip writeback fields or issued invoice snapshots?
- Should gross or net be the headline payer amount? Recommendation: gross payer-facing, net internal.
- Should cancelled trips be excluded, shown separately, or included with cancellation fee when opted in?
- Should KTS external invoice amounts be merged with TaxiGo invoices or shown as a separate KTS reconciliation section?
- What threshold makes a KPI “too incomplete” to display: 5%, 10%, or custom per KPI?
- Is client/patient concentration allowed in payer-facing reports?
- Is `payment_method` meaningful for modern payer reporting or legacy only?
- Is `billing_type_id` on trips authoritative, or should report logic always derive family from `billing_variant_id` when present?

### Missing Enums / Reference Data

- No DB enum for `trips.status` in generated types.
- No typed enum for invoice status in DB generated types.
- No cancellation reason taxonomy.
- No no-show field.
- No payment event table for partial payments or bank references.
- No explicit payer SLA thresholds.
- No persisted marker for legacy timezone-risk rows.

### Read Model / RPC Candidates

- `get_payer_report_trip_kpis(company_id, payer_id, date_from, date_to)` for live operational trip facts.
- `get_payer_report_invoice_kpis(company_id, payer_id, date_from, date_to)` for issued invoice facts.
- `get_payer_report_compare(company_id, payer_id, current_from, current_to, previous_from, previous_to)` to return current and previous in one stable payload.
- `payer_report_line_items_v` view for invoice-line snapshot reporting; keep it internal or use `security_invoker=true` if exposed through Supabase.
- `payer_report_data_quality_v` for reusable missing price/km/billing/time warnings.

### Implementation Caveats From Existing App Paths

- Prefer `src/features/controlling` over `/dashboard/overview` patterns. Overview components still include client-side full-trip aggregation and runtime-local date handling that are not appropriate for payer reporting.
- Do not reuse invoice-builder trip date filtering as-is for reporting. It currently fetches with raw UTC end-of-day strings, while payer reporting should follow the controlling/trips-list Berlin business-date contract.
- Before implementation, regenerate or repair Supabase generated types so `invoices` and `invoice_line_items` are type-safe. The current app works around this in places, but a reporting module should not add more untyped invoice access.

