# Tax Rate Audit

**Status:** Implemented (Step 3 override + write-back, 2026-06).

Read-only audit of MwSt handling across trips, invoices, and related surfaces.  
**Canonical resolver:** `src/features/invoices/lib/tax-calculator.ts` (`resolveTaxRate`, `TAX_RATES`, `DISTANCE_THRESHOLD_KM`).

---

## A. Trip Creation — tax_rate derivation

### 1. Where is `tax_rate` first assigned on trip create?

**Not** set in the form as a user field. **Not** derived in Postgres triggers or Edge Functions (no `supabase/functions` in repo).

**Flow:**

1. Create UI builds a `baseTrip` with `tax_rate: null` (and `gross_price: null`).
2. Before insert, the client spreads **`computeTripPrice(...)`** onto the payload.
3. `tripsService.createTrip` performs a direct Supabase `.insert(trip)` (browser client).

| Step | File | Function / lines | What happens |
|------|------|------------------|--------------|
| Placeholder on base row | `src/features/trips/components/create-trip/create-trip-form.tsx` | `handleSubmit` → `baseTrip` | L1337–1338: `gross_price: null`, `tax_rate: null` |
| First real assignment | `src/features/trips/lib/trip-price-engine.ts` | `computeTripPrice` | L229: `const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km)`; L270–272: returns `tax_rate: baseNetPrice !== null ? taxRate : null` |
| Rate logic | `src/features/invoices/lib/tax-calculator.ts` | `resolveTaxRate` | L52–66 |
| Spread into insert | `create-trip-form.tsx` | `handleSubmit` | e.g. L1374–1390 (anonymous), L1531–1549 (per passenger), L1441–1458 / L1618–1636 (return legs): `...computeTripPrice({ ... }, context)` |
| Persist | `src/features/trips/api/trips.service.ts` | `createTrip` | L88–97: `.insert(trip)` — no server-side price logic |

**Same pattern elsewhere:** bulk upload (`bulk-upload-dialog.tsx`), recurring cron (`src/app/api/cron/generate-recurring-trips/route.ts` ~L583/L650), duplicate API (`duplicate-trips.ts` + `/api/trips/duplicate`), `tripsService.updateTrip` when `shouldRecalculatePrice(patch)` (L114–134).

**Invoice write-back (not creation):** after `insertLineItems`, `use-invoice-builder.ts` L857–859 may `updateTrip` with `tax_rate: item.tax_rate` from the builder line (fire-and-forget).

---

### 2. Logic for 0.07 vs 0.19 — threshold and wheelchair

**Single rule today: driving distance only** (`trips.driving_distance_km` at compute time). No branch on `is_wheelchair`, billing variant, or passenger type.

From `tax-calculator.ts`:

```52:66:src/features/invoices/lib/tax-calculator.ts
export function resolveTaxRate(distanceKm: number | null): TaxRateResult {
  // ── Future extension point 1: vehicle type check would go here ──────────
  // ── Future extension point 2: billing_variant override would go here ────

  if (distanceKm === null || distanceKm === undefined) {
    return { rate: TAX_RATES.REDUCED, confidence: 'fallback' };
  }

  if (distanceKm >= DISTANCE_THRESHOLD_KM) {
    return { rate: TAX_RATES.STANDARD, confidence: 'exact' };
  }

  return { rate: TAX_RATES.REDUCED, confidence: 'exact' };
}
```

| Constant | Value | Meaning |
|----------|-------|---------|
| `TAX_RATES.REDUCED` | **0.07** | 7% (decimal fraction) |
| `TAX_RATES.STANDARD` | **0.19** | 19% |
| `DISTANCE_THRESHOLD_KM` | **50** | Standard rate when **distance ≥ 50**; reduced when **distance &lt; 50** |

**Threshold semantics:** `>= 50` → 19%; strictly below 50 → 7%. A trip at exactly 50 km is **19%**.

**Unknown distance:** `null` / `undefined` → **0.07** with `confidence: 'fallback'` (not 19%).

**Wheelchair:** `is_wheelchair` is captured on create (`create-trip-form.tsx` L1391, L1550, form field L85/L193) and stored on `trips`, but **`resolveTaxRate` does not read it**. Comments in `tax-calculator.ts` L14–16 explicitly reserve wheelchair / vehicle type as a future extension above the distance check.

---

### 3. How `net_price`, `gross_price`, and `tax_rate` are stored on `trips`

**Schema (migrations + generated types):**

| Column | Type | Writable? | Semantics |
|--------|------|-----------|-----------|
| `tax_rate` | `numeric` (nullable) | Yes | Decimal fraction, e.g. **0.07**, **0.19** — **not** 7 or 19 |
| `gross_price` | `numeric` (nullable) | Yes | Brutto snapshot at stamp time |
| `base_net_price` | `numeric(10,4)` (nullable) | Yes | Transport net only (excl. Anfahrt) |
| `approach_fee_net` | `numeric(10,4)` (nullable) | Yes | Anfahrt net |
| `net_price` | `numeric(10,4)` **GENERATED STORED** | **No** | `COALESCE(base_net_price,0) + COALESCE(approach_fee_net,0)` |

Sources: `supabase/migrations/20260418120000_trips-price-schema.sql`, `20260424100000_add_trip_price_split.sql`, `20260425120000_net_price_generated.sql`; comments in `src/types/database.types.ts` L1513–1518.

**Source of truth for amounts:**

- **Neither net nor gross is typed in by the dispatcher on create.** Both are **computed** by `computeTripPrice` → `resolveTripPrice` (pricing rules, KTS, client tag, taxameter, etc.).
- **Net anchor:** billing rules / stored base net → `base_net_price`; combined `net_price` is DB-generated.
- **Gross:** derived in `computeTripPrice` when base net exists:

```265:268:src/features/trips/lib/trip-price-engine.ts
  const totalGross =
    baseNetPrice !== null
      ? Math.round((baseNetPrice + approachFeeNet) * (1 + taxRate) * 100) / 100
      : null;
```

- **Taxameter (P0):** `manual_gross_price` is gross-in; net back-calculated inside `resolve-trip-price.ts` as `gross / (1 + taxRate)` (L420–422).

**If unresolved:** `computeTripPrice` returns all-null price fields including `tax_rate: null` (L220–225, L255).

**Display convention:** Fahrten table treats `tax_rate` as decimal for `Intl.NumberFormat` percent — `src/features/trips/components/trips-tables/columns.tsx` L47–48, L585–601.

---

### 4. Passenger / special trip fields on `trips` (relevant to tax)

There is **no** `passenger_type`, `trip_type`, or tax-specific flag beyond distance.

| Column | Used for tax? | Notes |
|--------|---------------|-------|
| `is_wheelchair` | **No** | `boolean`, default false — operational/UI only today |
| `billing_variant_id` | Indirect | Drives **price** via rules, not VAT % |
| `billing_type_id` | Indirect | Same |
| `kts_document_applies` | Price only | KTS → €0 net/gross; **tax_rate still set** to 7/19 from distance |
| `link_type` | No | e.g. `'return'` for Rückfahrt |
| `client_id` / `client_name` | Price only | Client price tag cascade |
| `manual_distance_km` | No at trip create | Used at **invoice** time via `resolveEffectiveDistanceKm` |
| `manual_gross_price` | Price (P0) | Taxameter gross; VAT still from `resolveTaxRate` on distance |
| `driving_distance_km` | **Yes** | Primary VAT input at trip stamp |
| `status`, `payer_id`, etc. | No | |

---

### 5. Triggers, RLS, computed columns on price fields

| Mechanism | Affects `tax_rate` / prices? |
|-----------|------------------------------|
| **`net_price` GENERATED column** | Yes — read-only combined net; writers must set `base_net_price` + `approach_fee_net` |
| **Triggers on `trips`** | **None** found that set `tax_rate`, `gross_price`, or `base_net_price` |
| **RLS** | Tenant access only; no price computation in policies (per project access-control docs) |

Postgres will **reject** direct writes to `net_price` after Phase 2 migration.

---

## B. Invoice Generation

### 6. How does the invoice get `tax_rate`?

**At line-item build time (wizard Step 3), not by copying `trips.tax_rate` blindly.**

`buildLineItemsFromTrips` (`invoice-line-items.api.ts` L579–714):

1. `effectiveDistanceKm = resolveEffectiveDistanceKm({ manualDistanceKm, drivingDistanceKm, client km overrides, … })` (L588–595).
2. `const { rate: taxRate } = resolveTaxRate(effectiveDistanceKm)` (L597).
3. `resolveTripPricePure(..., taxRate, rule)` for amounts (L609–621).
4. Builder line gets `tax_rate: taxRate` (L665).

So invoice VAT follows **effective billed km**, which can differ from trip-row `tax_rate` if manual km was applied only in the builder (trip row updated on save via write-back).

**Persisted snapshot:** `insertLineItems` → `lineItemToInsertRow` stores `tax_rate` on `invoice_line_items` (immutable). Types: `invoice.types.ts` L144–145 — decimal **0.07 / 0.19**.

**PDF / totals:** `InvoicePdfDocument.tsx` uses persisted line items + `calculateInvoiceTotals` (L400+) — rates come from **frozen line rows**, not a live `resolveTaxRate` call at render time.

**Override paths in builder:** KM edit / restore calls `resolveTaxRate` again (`use-invoice-builder.ts` ~L410, L477, L609, L706). Manual unit net edits keep existing `item.tax_rate` (`applyManualUnitNetToResolution` L237).

**No pre-PDF validation** that line `tax_rate` must match `trips.tax_rate`; snapshots are authoritative once saved.

---

### 7. How tax is displayed on the invoice (grouping)

**Cover totals — grouped by rate (supports mixed 7% / 19% on one invoice):**

`calculateInvoiceTotals` (`invoice-line-items.api.ts` L771–873) accumulates net per rate into `byRateMerged`, then:

```860:865:src/features/invoices/api/invoice-line-items.api.ts
  const breakdown: TaxBreakdown[] = Object.entries(byRateMerged).map(
    ([rateStr, net]) => ({
      rate: parseFloat(rateStr),
      net: Math.round(net * 100) / 100,
      tax: Math.round(net * parseFloat(rateStr) * 100) / 100
    })
  );
```

`invoice-pdf-cover-body.tsx` L305–311 renders **one row per breakdown entry**: “zzgl. Umsatzsteuer {7 %|19 %}”.

**Main table layout modes** (`build-invoice-pdf-summary.ts`):

| `main_layout` | Grouping vs tax |
|---------------|-----------------|
| Default route grouping | Routes keyed by **address only** (L184–188); **first line’s `tax_rate` wins** per route group (L260, L277). Hinfahrt/Rückfahrt can share a route key; mixed rates in one route group are possible if addresses match but distances differ. |
| `grouped_by_billing_type` | Key = `{billing family label}__{tax_rate}` (L478–479) — **explicit split** so 7% and 19% never share one summary row (L431–435). |
| `single_row` | Uses `lineItems[0].tax_rate` for the single summary row (L383). |

**Per-trip appendix:** each line carries its own `tax_rate` column (catalog key `tax_rate` in `pdf-column-catalog.ts`).

**Wheelchair mixed rates:** legally possible today (different distances → different rates); PDF totals already support multiple `breakdown` rows. Route-grouped cover rows may **not** split by rate unless layout is `grouped_by_billing_type`.

---

### 8. `tax_rate = 0` (tax-exempt / 0%)

**Not a first-class product rate today.** `resolveTaxRate` only returns **0.07** or **0.19** (or fallback 0.07).

**Near-zero money, non-zero rate:**

- **KTS:** `resolve-trip-price.ts` L439–450 → `net: 0`, `gross: 0`, but `tax_rate: taxRate` still passed through (7% or 19% from distance). Invoice shows €0 lines; VAT lines may show 0 € tax if net buckets are 0.

**Rendering / math with zero rate:**

- `pdf-column-layout.ts` L123–128: `tr = item.tax_rate ?? 0`; if `rate <= -1` avoids division blow-up; **0% would yield `net === gross`**.
- `build-invoice-pdf-summary.ts` `buildInvoicePdfSingleRow` empty state uses `tax_rate: 0` (L364).
- `formatTaxRate(0)` → `"0 %"` (`tax-calculator.ts` L86–88).
- `calculateInvoiceTotals`: `byRateMerged[0]` would produce a **0% breakdown row** if any line had `tax_rate: 0` (no special-case filter).

**Null trip `tax_rate`:** Fahrten table shows “—” (`columns.tsx` L592–597). Unpriced trips should not reach finalized invoices without warnings (`validateLineItems`).

---

### 9. What triggers invoice generation?

**Manual / user-driven only** — no automatic invoice on trip status change.

| Entry | Location |
|-------|----------|
| New invoice wizard | `/dashboard/invoices/new` → `InvoiceBuilder` → `use-invoice-builder.ts` `createMutation` → `createInvoice` + `insertLineItems` (L832–845) |
| Draft edit save | `/dashboard/invoices/[id]/edit` → `updateDraftInvoice` + `replace_draft_invoice_line_items` RPC |
| PDF download / preview | `invoice-detail/index.tsx`, `invoice-pdf-preview.tsx`, builder `use-invoice-builder-pdf-preview.tsx` — **render only**, no creation |
| Storno | `storno.ts` → `create_storno_invoice` — negates existing lines (copies `tax_rate`) |

Cron `generate-recurring-trips` **creates trips**, not invoices.

---

## C. Full codebase usage map

Legend: **Rate** = calls or depends on `resolveTaxRate` / distance rule; **Store** = reads/writes `tax_rate` column; **Display** = UI/PDF only.

### Canonical & trip pricing

| File | Role |
|------|------|
| `src/features/invoices/lib/tax-calculator.ts` | **SSOT:** `TAX_RATES`, `DISTANCE_THRESHOLD_KM`, `resolveTaxRate`, `calculateTaxAmount`, `formatTaxRate` |
| `src/features/trips/lib/trip-price-engine.ts` | **Rate** on create/edit: `computeTripPrice` → `resolveTaxRate(driving_distance_km)`; writes `tax_rate`, `gross_price`, `base_net_price`, `approach_fee_net` |
| `src/features/invoices/lib/resolve-trip-price.ts` | Uses `taxRate` arg for gross/net math; documents `× (1 + tax_rate)` contract |
| `src/features/invoices/lib/price-calculator.ts` | Adapter wrapping `resolveTripPrice` with `taxRate` param |
| `src/lib/pricing/normalize-rule-config.ts` | Converts gross rule config to net using `taxRate` divisor |

### Trip write paths

| File | Role |
|------|------|
| `src/features/trips/components/create-trip/create-trip-form.tsx` | **Store** via `computeTripPrice` on submit |
| `src/features/trips/api/trips.service.ts` | **Store** insert/update; recalc on pricing-relevant patch |
| `src/features/trips/components/bulk-upload-dialog.tsx` | **Store** `computeTripPrice` per row |
| `src/features/trips/lib/duplicate-trips.ts` | **Store** fresh `computeTripPrice` (never inherit source `tax_rate`) |
| `src/app/api/cron/generate-recurring-trips/route.ts` | **Store** service-role trip materialization + `computeTripPrice` |
| `src/features/trips/trip-reschedule/api/reschedule.actions.ts` | **Store** recalc on reschedule patch |

### Invoice builder & persistence

| File | Role |
|------|------|
| `src/features/invoices/api/invoice-line-items.api.ts` | **Rate** in `buildLineItemsFromTrips`, `buildCancelledTripBillingState`; **Store** `insertLineItems`; **`calculateInvoiceTotals`** by rate bucket |
| `src/features/invoices/hooks/use-invoice-builder.ts` | **Rate** on KM changes; **Store** create/update + trip write-back `tax_rate` |
| `src/features/invoices/utils/map-line-item-row-to-builder-line-item.ts` | **Store** round-trip mapper preserves `tax_rate` |
| `src/features/invoices/lib/storno.ts` | **Store** copies `tax_rate` to storno lines |
| `src/features/invoices/lib/line-item-net-display.ts` | **Display** gross from net + `tax_rate` |
| `src/features/invoices/types/invoice.types.ts` | Types: line `tax_rate` 0.07/0.19; `TaxBreakdown` |

### PDF

| File | Role |
|------|------|
| `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` | Totals `breakdown` from `calculateInvoiceTotals` |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | **Display** per-rate VAT rows |
| `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts` | Summary rows; billing-type grouping includes `tax_rate` in key |
| `src/features/invoices/components/invoice-pdf/lib/invoice-pdf-line-amounts.ts` | Line gross/net using `item.tax_rate` |
| `src/features/invoices/components/invoice-pdf/pdf-column-layout.ts` | Legacy net from gross ÷ `(1+rate)`; handles `rate > 1` as whole percent |
| `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` | Draft preview totals/lines |
| `src/features/invoices/lib/pdf-column-catalog.ts` | Column def `tax_rate` |
| `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` | **Display** `formatTaxRate(item.tax_rate)` |
| `src/features/invoices/components/invoice-pdf/example/example-invoice-reha-zentrum.ts` | Fixture-only inline `< 50 ? 0.07 : 0.19` (duplicates rule) |

### Trips UI / reporting

| File | Role |
|------|------|
| `src/features/trips/components/trips-tables/columns.tsx` | **Display** MwSt column |
| `src/features/trips/components/ansichten-sheet.tsx` / `ansichten-dropdown.tsx` | Column visibility `tax_rate` |
| `src/features/trips/trips-sort-map.ts` | Sort key `tax_rate` |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` | **Display** `taxRate={trip.tax_rate}` in price tooltip |
| `src/features/dashboard/lib/stats-utils.ts` | Revenue sum uses **`net_price` only** — no tax-rate split |
| `supabase/migrations/20260530120000_controlling_rpcs.sql` | **Aggregate** `revenue_net` / `revenue_gross` — **no `tax_rate` dimension** |
| `supabase/migrations/20260530130000_controlling_breakdown_add_gross.sql` | Payer/driver breakdown — net/gross sums, not by VAT % |

### Angebote (separate product — percent 0–100, not trip decimals)

| File | Role |
|------|------|
| `supabase/migrations/20260519103000_angebot_default_tax_rate.sql` | `angebote.default_tax_rate` optional **percent** |
| `src/features/angebote/lib/angebot-formula-engine.ts` | Row/column `tax_rate` as **percent**; not `resolveTaxRate` |
| `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` | Quote PDF totals |

### Tests & scripts

| File | Role |
|------|------|
| `src/features/trips/lib/__tests__/trip-price-engine.test.ts` | Asserts 0.07 / 0.19 on distance |
| `src/features/invoices/api/__tests__/calculate-invoice-totals.test.ts` | Multi-rate totals |
| `src/features/invoices/lib/__tests__/resolve-trip-price.test.ts` | Price + taxRate param |
| `scripts/backfill-trip-prices-*.ts` | Replay `computeTripPrice` / audit `tax_rate` |

### SQL schema comments (documentation only)

| Migration | Notes |
|-----------|-------|
| `20260331130000_create_invoice_line_items.sql` | Documents &lt;50 / ≥50 rule; points to `tax-calculator.ts` |
| `20260418120000_trips-price-schema.sql` | `tax_rate` examples 0.07 / 0.19 |

### Docs (existing audits — not runtime)

`docs/invoices-module.md`, `docs/price-calculation-engine.md`, `docs/plans/effective-tax-rate-audit.md` (Angebote), `docs/plans/global-tax-rate-audit.md`, plus various `docs/plans/*-audit.md` references.

### Hardcoded `0.07` / `0.19` outside `tax-calculator.ts` (should stay in sync)

- `example-invoice-reha-zentrum.ts` L7–9 (fixture)
- Test files (explicit expected rates)
- Migration **comments** only
- Theme CSS files (`claude.css`, etc.) — **unrelated** color tokens, false positives in ripgrep

**AGENTS.md / invoice README:** instruct agents not to hardcode 0.07/0.19 outside `tax-calculator.ts`.

---

## D. Risk surface — adding 0% wheelchair (or any third rate)

| Area | Risk |
|------|------|
| **`resolveTaxRate` only returns 0.07/0.19** | Wheelchair 0% requires extending this function (and tests); otherwise wheelchair trips keep 7/19% everywhere. |
| **Trip vs invoice divergence** | Invoices recompute rate from **effective km** at build time; trips stamp at create from **routing km**. Changing wheelchair logic must be applied in **both** `computeTripPrice` and `buildLineItemsFromTrips` (same `resolveTaxRate` if parameterized with trip flags). |
| **`invoice_line_items.tax_rate` NOT NULL** | 0 is valid numeric; ensure builder never omits rate on priced lines. |
| **`calculateInvoiceTotals` / RPC draft replace** | Uses `Record<number, …>` keyed by rate — **0% should work** as an extra bucket; verify rounding: `tax = round(net × 0) = 0`. |
| **PDF route grouping** | Address-only groups can **hide** mixed rates on cover summary rows (one `tax_rate` per group). Prefer `grouped_by_billing_type` or extend route key to include rate for wheelchair-heavy payers. |
| **KTS + 0%** | Today KTS zeroes money but keeps 7/19% on row; 0% wheelchair is a different legal case — avoid conflating with `kts_override` pricing. |
| **`normalizeRuleConfigToNet`** | `divisor = 1 + taxRate` — **0% is safe**; negative rates would be pathological. |
| **`pdf-column-layout` `tr > 1`** | Interprets as whole percent — **do not store wheelchair as `0` vs `0.0` inconsistently**; stay with decimal fractions like 0.07. |
| **Controlling / dashboard** | No VAT% revenue split today; CFO views won’t show 0% bucket until reports key on `tax_rate`. |
| **Trip list percent formatter** | `TAX_DE_PERCENT.format(0)` → “0%” — OK. |
| **Backfill scripts** | Re-running `computeTripPrice` would rewrite historical `tax_rate` if rules change — plan migration/backfill consciously. |
| **Angebote module** | Separate percent model — do not confuse with trip `resolveTaxRate`. |

---

## E. Senior recommendation

**Extend the tax model in one place, with a trip-aware resolver signature, and thread the same function through trip stamp and invoice build.**

1. **Expand `resolveTaxRate` in `tax-calculator.ts`** to accept a small context object, e.g. `{ distanceKm, isWheelchair?: boolean }`, evaluated **before** distance (per file’s own “extension point 1” comment). Add `TAX_RATES.ZERO = 0` (or named `WHEELCHAIR_EXEMPT`) and document legal basis beside §12 Personenbeförderung.
2. **Do not branch on `is_wheelchair` in UI or PDF** — call the resolver from:
   - `computeTripPrice` (pass `is_wheelchair` from trip input — extend `ComputeTripPriceInput`),
   - `buildLineItemsFromTrips` / `buildCancelledTripBillingState` (pass trip flag; keep `effectiveDistanceKm` for pricing km),
   - `use-invoice-builder` KM recalc paths (pass wheelchair from trip row).
3. **Keep decimal fractions everywhere** (0, 0.07, 0.19) on `trips` and `invoice_line_items`; never store 7/19/0 as whole percents on those tables.
4. **Tests:** extend `trip-price-engine.test.ts` and `calculate-invoice-totals.test.ts` with wheelchair + short/long distance matrix; one PDF snapshot test for mixed 0% + 7% breakdown rows.
5. **PDF product choice:** if one invoice mixes 0% wheelchair and 7% standard trips, set payer PDF default to `grouped_by_billing_type` **or** add `tax_rate` to route group keys — route-only grouping is the main footgun.
6. **Reporting (optional follow-up):** add controlling slice `revenue_by_tax_rate` only if finance needs it; not required for correctness.
7. **Avoid** a parallel `trips.wheelchair_tax_rate` column — `tax_rate` already snapshots the applicable rate; invoice immutability stays on `invoice_line_items.tax_rate`.

This minimizes diff size, honors existing “all MwSt logic lives here” architecture, and keeps trip list, builder, PDF totals, and write-back aligned.

---

## Related documentation

- [`docs/invoices-module.md`](../invoices-module.md) — snapshot pattern, builder, totals
- [`docs/price-calculation-engine.md`](../price-calculation-engine.md) — trip price engine write paths
- [`docs/trips-date-filter.md`](../trips-date-filter.md) — time invariants (orthogonal to VAT)
- Migration comments in `20260331130000_create_invoice_line_items.sql` — historical rule text
