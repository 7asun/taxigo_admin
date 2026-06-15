# Invoice Totals Helper — Audit

**Date:** 2026-06-15  
**Scope:** Read-only audit of how invoice totals (trips, km, money, tax) are computed today, and a design proposal for a unified `computeInvoiceTotalsFromSnapshots` helper.  
**Related:** [`invoice-km-behaviour.md`](../invoice-km-behaviour.md) · [`invoices-module.md`](../invoices-module.md) · [`manual-km-overrides.md`](../manual-km-overrides.md)

**Note:** The prompt referenced `src/features/invoices/lib/price-resolution/**`; that directory does not exist. Pricing resolution lives in `resolve-trip-price.ts`, `price-calculator.ts` (adapter), `frozenPriceResolutionForInsert` / `calculateInvoiceTotals` in `invoice-line-items.api.ts`, and `line-item-net-display.ts` (builder display).

---

## Executive summary

| Domain | SSOT today | Gaps |
|--------|-----------|------|
| **KM** | `compute-invoice-km.ts` (K1–K7) | No unified trip/money wrapper; excluded km not exposed |
| **Money (header)** | `calculateInvoiceTotals` (TS) + `replace_draft_invoice_line_items` RPC (draft save) | PDF **recomputes**; detail page reads **DB header**; create flow trusts client totals |
| **Trip counts** | **No SSOT** — semantics differ by surface | Grouped PDF = line count; flat = `quantity`; ad-hoc SQL often `SUM(quantity)` |
| **Tax breakdown** | `calculateInvoiceTotals().breakdown` | Only in builder + PDF cover; detail sidebar shows combined MwSt only |

**Recommendation:** Introduce `computeInvoiceTotalsFromSnapshots(lineItems)` that composes existing KM helpers + a persisted-row adapter around `calculateInvoiceTotals`, then refactor PDF cover, detail sidebar, and any exports to use it.

---

## 1. Map all current sources of “totals”

### 1.1 Database level

#### `invoices` header columns

| Column | Meaning | Stored when |
|--------|---------|-------------|
| `subtotal` | Nettobetrag (Σ net of included lines) | Create (client) · Draft save (RPC) · Storno (negated client) · Branch draft (copied, then RPC on save) |
| `tax_amount` | MwSt (derived: `total − subtotal`) | Same |
| `total` | Bruttobetrag | Same |

Schema: [`20260331120000_create_invoices.sql`](../supabase/migrations/20260331120000_create_invoices.sql).

There is **no** per-rate tax table on `invoices`. Tax split exists only in application code (`TaxBreakdown[]`).

#### `invoice_line_items` columns used for totals

| Column | Role in totals |
|--------|----------------|
| `quantity` | Multiplier for gross-anchor (`client_price_tag`) and per-km pricing; **not** always “1 trip” |
| `unit_price` | Net per unit (or per km); fallback when `price_resolution_snapshot.net` absent |
| `approach_fee_net` | Added to line net before VAT |
| `tax_rate` | Per-line rate (0, 0.07, 0.19); bucket key for VAT rounding |
| `total_price` | **Brutto** snapshot per line — authoritative for PDF gross columns |
| `price_resolution_snapshot` | JSONB: `net`, `gross`, `strategy_used`, `tax_rate` — authoritative for `calculateInvoiceTotals` |
| `billing_included` | Filter: only `true` rows count toward header totals |
| `is_cancelled_trip` | Included cancelled rows **do** count toward money totals; excluded from cover KM (`mainCoverLineItems`) |
| `effective_distance_km` / `distance_km` | KM only (via `computeInvoiceLineKm`) — **not** used by money RPC |
| `kts_override` | Forces €0 in PDF line amounts |

There are **no** `net_amount`, `tax_amount`, or `gross_amount` columns on line items. Net and tax are derived in application code / RPC from the fields above.

#### RPC / SQL that computes header totals

| Path | Function | Who computes `subtotal` / `tax_amount` / `total` |
|------|----------|---------------------------------------------------|
| **New invoice (create)** | `createInvoice` → `insertLineItems` | **Client** (`use-invoice-builder.ts` → `calculateInvoiceTotals`) — DB stores values as sent; **no server verification** |
| **Draft save (edit)** | `updateDraftInvoice` → `replace_draft_invoice_line_items` | **Server RPC** — faithful port of `calculateInvoiceTotals`; only `billing_included = true` rows |
| **Storno** | `create_storno_invoice` | **Client** passes negated original header totals; line money negated in payload |
| **Branch draft create** | `create_branch_draft_from_invoice` | **Copies** original positive header; lines verbatim |
| **Branch draft save** | Same as draft save | **RPC** recomputes from new line set |
| **Revenue dashboard** | `getInvoiceRevenueTotal` | `SUM(invoices.total)` where `status IN ('sent','paid')` — uses stored header, not line recompute |

RPC logic (draft save): [`20260529080000_draft_invoice_editing_foundation.sql`](../supabase/migrations/20260529080000_draft_invoice_editing_foundation.sql) lines 154–236.

**RPC money algorithm (mirrors TS):**

1. Filter `billing_included = TRUE`.
2. Per line, classify **gross-anchor** (`strategy_used = 'client_price_tag'` + `snap_gross`) vs **net-anchor** (everything else).
3. Gross-anchor: add `gross × qty + approach × (1 + rate)` to total; implied net to subtotal bucket.
4. Net-anchor: accumulate `COALESCE(snap_net, unit_price × qty) + approach` per `tax_rate` bucket.
5. VAT: `ROUND(bucket_net × rate, 2)` **once per bucket** (net-anchor only).
6. `total = ROUND(non_tag_subtotal + tax_non_tag + gross_fixed, 2)`.
7. `subtotal = ROUND(non_tag_subtotal + price_tag_net, 2)`.
8. `tax_amount = ROUND(total − subtotal, 2)`.

**Known deferred edge:** Admin manual gross override (`manualGrossTotal` / Taxameter) is **not** persisted as a flag. Hydrated override lines route through net-anchor in both RPC and TS — subtotal matches; `total`/`tax_amount` may differ by ≤1 ct in mixed-rate invoices ([`invoices-module.md`](../invoices-module.md) §1.6).

#### Controlling / analytics RPCs (live trips — not invoice snapshots)

[`20260530120000_controlling_rpcs.sql`](../supabase/migrations/20260530120000_controlling_rpcs.sql) aggregates **live `trips`** (`COUNT`, `SUM(driving_distance_km)`). These are operational dashboards, not invoice totals. Do not conflate with billed invoice stats.

---

### 1.2 Frontend / PDF level

#### Money (net / tax / gross)

| Location | Function / source | Filter | Snapshot vs live | Tax handling |
|----------|-------------------|--------|------------------|--------------|
| **Builder Step 3 footer** | `calculateInvoiceTotals` via `use-invoice-builder.ts` | `billingIncludedLineItems` + opted-in cancelled with `price_resolution` | Builder state (pre-snapshot) | Per-rate buckets; header `tax = total − subtotal` |
| **Builder Step 4/5 confirm** | Same `totals` passed as props | Same | Builder state | Read-only display |
| **PDF cover footer** | `calculateInvoiceTotals(lineItemsForCalc)` in `InvoicePdfDocument.tsx` | `billingIncludedLineItems` mapped from persisted rows | **Snapshots** (`invoice_line_items`) | `breakdown` per rate → MwSt rows |
| **PDF grouped cover table** | `build-invoice-pdf-summary.ts` | Caller passes `mainCoverLineItems` | Snapshots | Per-group net/gross via `transportNetEurForPdfLineItem` + `lineGrossEurForPdfLineItem`; **not** the same code path as header totals |
| **Detail page table footer** | `invoice.subtotal` / `invoice.tax_amount` / `invoice.total` | N/A (header) | **DB header** | Combined MwSt only |
| **Detail sidebar card** | Same DB header fields | N/A | DB header | Net + MwSt lines, no per-rate split |
| **Detail per-row “Betrag”** | `unit_price × quantity` (local helper) | **All rows** including excluded | Snapshots | **Transport net only** — omits Anfahrt; can disagree with `total_price` |
| **Payment QR** | `invoice.total` | N/A | DB header | — |
| **Revenue stat** | `getInvoiceRevenueTotal` | `sent`/`paid` | DB header | — |

**Important:** PDF cover money is **recomputed** from line snapshots; detail page money is **read from the header**. They should match for draft-saved invoices but can diverge on legacy create-only rows or the manual-gross ≤1 ct edge.

#### Trip counts

| Location | What is counted | Filter | Notes |
|----------|----------------|--------|-------|
| **Grouped PDF `trip_count` column** | `InvoicePdfSummaryRow.quantity` = **number of line items** in group (`count += 1`) | `mainCoverLineItems` | Explicitly **not** `SUM(quantity)` — see `build-invoice-pdf-summary.ts` L40–41 |
| **Flat PDF `quantity` column** | Per-line `invoice_line_items.quantity` | `mainCoverLineItems` | Can be km for per-km pricing |
| **`single_row` layout** | Line-item count across all main cover items | `mainCoverLineItems` | One summary row |
| **Builder Step 4 confirm** | `buildConfirmationDisplayRows().length` | Included normal + priced cancelled | Matches totals slice |
| **Builder Step 3 panel header** | `lineItems.length` | **All** rows including excluded | Different from confirm count |
| **Detail line items table** | One row per `invoice_line_items` position | **All** rows | No inclusion filter |
| **Ad-hoc SQL audits** | Often `COUNT(*)` or `SUM(quantity)` | Varies | `SUM(quantity)` ≠ trip count when per-km lines exist |

#### KM

| Location | Function | Filter | Snapshot vs live |
|----------|----------|--------|------------------|
| **PDF cover Gesamtstrecke** | `computeInvoiceCoverKm().normalBilledKm` | Included normal only (inside helper) | Snapshots |
| **PDF cover stornierte km** | `computeInvoiceCoverKm().cancelledBilledKm` | Included cancelled only | Snapshots; toggle-gated |
| **PDF grouped `total_km` column** | `computeInvoiceLineKm` per line, summed in group | `mainCoverLineItems` | Snapshots; null if any line null |
| **Detail KM summary** | `computeInvoiceCoverKm` | Full array | Snapshots; always shown |
| **Detail per-row km** | `computeInvoiceLineKm` | All rows | Snapshots |
| **Builder Step 3** | `effective_distance_km` (editable) + routing `distance_km` | Live builder state | **Live** until save |

KM has a clear SSOT: [`compute-invoice-km.ts`](../../src/features/invoices/lib/compute-invoice-km.ts).

---

## 2. Intended inclusion / tax rules

### 2.1 Trip counts — intended semantics

| Concept | Intended meaning | Included in money? | Included in cover KM? |
|---------|------------------|--------------------|-----------------------|
| **Normal included trip** | One `invoice_line_items` row, `billing_included = true`, `is_cancelled_trip ≠ true` | Yes | Yes (`normalBilledKm`) |
| **Excluded trip** | `billing_included = false` | No | No (K4) |
| **Cancelled-but-billed** | `billing_included = true`, `is_cancelled_trip = true` | Yes | Separate bucket (`cancelledBilledKm`); not in Gesamtstrecke |
| **Passive cancelled (€0)** | Not inserted as billed lines; appendix only | No | No |

**“Anzahl Fahrten” on grouped PDF cover** = **count of included normal line items** in the group (or billing-type group), **not** `SUM(quantity)`.

**`quantity` on a line** = billing units (often 1; for per-km pricing = distance km). Must not be used as trip count without labelling.

**Confirmation / totals slice** = included normal lines + opted-in cancelled trips with pricing (`buildConfirmationDisplayRows`).

### 2.2 KM buckets

Already documented in K1–K7 ([`invoice-km-behaviour.md`](../invoice-km-behaviour.md)):

| Bucket | Filter | Field |
|--------|--------|-------|
| Normal billed km | `billing_included` + not cancelled | `effective_distance_km ?? distance_km` |
| Cancelled billed km | `billing_included` + cancelled | Same |
| Excluded km | `billing_included = false` | Same fields, **audit only** — not in any billed bucket today |

### 2.3 Price and tax

#### Per line item (at insert / snapshot)

| Field | Meaning |
|-------|---------|
| `price_resolution_snapshot.net` | Authoritative transport net (tiered / resolver) |
| `price_resolution_snapshot.gross` | Authoritative transport gross for `client_price_tag` |
| `approach_fee_net` | Net Anfahrt, added before VAT |
| `total_price` | Persisted **Brutto** = f(transport net, approach, tax_rate) |
| `tax_rate` | Per line (0 / 7% / 19%) |

**Line gross formula (insert):**

- Gross-anchor: `gross × quantity + approach × (1 + rate)`
- Net-anchor: `(transportNet + approach) × (1 + rate)` where `transportNet = snapshot.net ?? unit_price × quantity`

#### Header totals

- **Only `billing_included = true` rows** (includes opted-in cancelled).
- **Tax:** Group net by `tax_rate`, round VAT once per bucket (net-anchor). Gross-anchor lines contribute fixed gross to total.
- **`tax_amount` = `total − subtotal`** (not Σ line VAT) so Netto + MwSt = Brutto.

#### One true rule (target contract)

> Given `invoice_line_items[]` snapshots:
>
> 1. **Trips:** Count rows by inclusion class; “Anzahl Fahrten” = count of included normal rows (not Σ quantity).
> 2. **KM:** `computeInvoiceKmBuckets` — normal / cancelled / (optional) excluded audit.
> 3. **Money:** `calculateInvoiceTotals` on included rows mapped to `TotalsLineShape` — per-rate net/tax/gross + header totals.
> 4. Never read live `trips` for any of the above after invoice exists.

---

## 3. Inconsistencies and duplication

### 3.1 Trip counts — multiple definitions

| # | Location | Method | Risk |
|---|----------|--------|------|
| A | `buildInvoicePdfGroupedByBillingType` | `count += 1` | Correct for “Anzahl Fahrten” |
| B | Flat PDF `quantity` column | `item.quantity` | Shows billing units, not trips |
| C | Detail table | Lists all positions | No “included only” count shown |
| D | Step 3 `lineItems.length` | All rows | Includes excluded — confuses vs totals |
| E | SQL `SUM(quantity)` | Sums km-units | **Wrong** for trip count on per-km invoices |

### 3.2 KM — largely consistent

`compute-invoice-km.ts` is SSOT. Duplication risk is low if K7 is respected.

**Gap:** No `excludedKm` audit aggregate anywhere (could be added to unified helper).

### 3.3 Money — divergences

| # | Issue | Surfaces |
|---|-------|----------|
| M1 | **PDF recomputes** header; **detail reads DB** | PDF cover vs detail footer |
| M2 | **Create** trusts client totals; **draft save** uses RPC | Potential drift on create-only invoices if client bug |
| M3 | **Detail per-row** uses `unit_price × quantity` (transport net, no Anfahrt) | Detail table vs `total_price` / PDF appendix |
| M4 | **Detail table includes excluded rows** with amounts; footer is included-only totals | User confusion (see branch-draft audit) |
| M5 | **Grouped PDF net** uses `transportNetEurForPdfLineItem`; **`lineNetEurForPdfLineItem`** still used in one accumulator field | Internal to `build-invoice-pdf-summary.ts`; display net is correct |
| M6 | **Manual gross override** not persisted → RPC/TS net-anchor path | ≤1 ct tax drift (documented deferred) |
| M7 | **`calculateInvoiceTotals`** expects builder shape; PDF maps persisted rows manually in `InvoicePdfDocument.tsx` | Duplicated adapter logic |

### 3.4 Marked duplications

| Concept | Implementations |
|---------|-----------------|
| Header money totals | `calculateInvoiceTotals` (TS) · `replace_draft_invoice_line_items` (SQL) · stored `invoices.*` |
| Included-row filter | `billing-inclusion.ts` · RPC `billing_included = TRUE` · inline filters in builder |
| Per-line gross | `lineItemToInsertRow` · `build-draft-invoice-detail-for-pdf.ts` · `lineGrossEurForPdfLineItem` |
| Per-line net (display) | `line-item-net-display.ts` · `transportNetEurForPdfLineItem` · detail `unit_price × qty` |
| KM | **Single** `compute-invoice-km.ts` ✓ |

---

## 4. Design: `computeInvoiceTotalsFromSnapshots`

### 4.1 Proposed API

```typescript
// src/features/invoices/lib/compute-invoice-totals.ts (proposed)

import type { InvoiceLineItemRow } from '../types/invoice.types';

export type InvoiceTotals = {
  trips: {
    /** Included normal rows (billing_included, not cancelled). */
    normalIncludedCount: number;
    /** Included cancelled rows (billing_included + is_cancelled_trip). */
    cancelledIncludedCount: number;
    /** Excluded rows (billing_included = false). */
    excludedCount: number;
    /**
     * Sum of quantity on included rows (normal + cancelled).
     * Billing units — may be km for per-km lines. NOT “Anzahl Fahrten”.
     */
    totalQuantityIncluded: number;
  };
  km: {
    normalBilledKm: number | null;
    cancelledBilledKm: number | null;
    /** Audit only — sum of billed km on excluded rows. */
    excludedKm: number | null;
  };
  money: {
    perTaxRate: Array<{
      taxRate: number;
      net: number;
      tax: number;
      gross: number;
    }>;
    totalNet: number;
    totalTax: number;
    totalGross: number;
  };
};

export function computeInvoiceTotalsFromSnapshots(
  lineItems: InvoiceLineItemRow[]
): InvoiceTotals;
```

### 4.2 Implementation sketch

**Snapshots only** — input is `InvoiceLineItemRow[]` from `invoice_line_items`. No `trips` joins.

| Output | Source |
|--------|--------|
| `trips.*` | Filter with `isBillingIncludedRow` + `is_cancelled_trip`; counts = `rows.length`; `totalQuantityIncluded` = `Σ quantity` on included rows |
| `km.*` | `computeInvoiceKmBuckets` for normal/cancelled; add `excludedKm` via same `computeInvoiceLineKm` on `!isBillingIncludedRow` rows |
| `money.*` | Map included rows → `TotalsLineShape` (reuse `priceResolutionFromLineItem` pattern from `InvoicePdfDocument.tsx`) → `calculateInvoiceTotals` → map `breakdown` to `perTaxRate` with `gross = net + tax` |

**Internal adapter** (extract from `InvoicePdfDocument.tsx` L376–411):

```typescript
function lineItemRowToTotalsShape(row: InvoiceLineItemRow): TotalsLineShape {
  return {
    price_resolution: priceResolutionFromLineItem(row),
    tax_rate: row.tax_rate,
    quantity: row.quantity,
    approach_fee_net: row.approach_fee_net ?? null,
    unit_price: row.unit_price,
    manualGrossTotal: null // not reconstructable from snapshot — deferred D1
  };
}
```

### 4.3 Future consumers

| Consumer | Today | After refactor |
|----------|-------|----------------|
| `InvoicePdfDocument.tsx` cover footer | Inline `calculateInvoiceTotals` + manual map | `computeInvoiceTotalsFromSnapshots(invoice.line_items).money` |
| `invoice-detail/index.tsx` sidebar | `invoice.subtotal/tax/total` | Show helper totals + optional “stored header” diff warning in dev |
| Detail KM summary | `computeInvoiceCoverKm` | `computeInvoiceTotalsFromSnapshots(...).km` |
| Grouped PDF labels | `trip_count` = group `quantity` field | Document that `quantity` on summary row = `trips.normalIncludedCount` per group (group builders already use line count) |
| Export / controlling | Ad-hoc SQL | Call helper in TS export pipelines |
| Integrity tests | Partial round-trip tests | Assert `helper.money` ≈ `invoices.subtotal/tax/total` for saved drafts |

**Keep separate (for now):**

- `build-invoice-pdf-summary.ts` — per-group **display** columns (route/billing-type breakdown). It should **not** re-derive header totals; optionally assert group gross sums ⊆ `money.totalGross`.
- Builder live preview — continues to use builder state + `calculateInvoiceTotals` until save.

---

## 5. Invariants the helper must enforce

| ID | Invariant | Enforced today? |
|----|-----------|-----------------|
| T1 | `invoices.subtotal/tax_amount/total` = helper `totalNet/totalTax/totalGross` on included rows (±0 for draft-saved; ≤1 ct manual-gross edge) | **Partial** — draft RPC yes; create client-only; PDF recalculates independently |
| T2 | All user-facing “Gesamt km” derived from `compute-invoice-km.ts` | **Yes** (K7) |
| T3 | “Anzahl Fahrten” on grouped cover = line count of included normal rows, not Σ quantity | **Yes** in PDF builders; **not** documented in SQL audits |
| T4 | No totals from live `trips` after invoice exists | **Yes** for invoice surfaces; controlling RPCs are separate |
| T5 | Excluded rows do not affect money or billed KM buckets | **Yes** in RPC + `calculateInvoiceTotals` |
| T6 | Opted-in cancelled rows affect money but not `normalBilledKm` | **Yes** |
| T7 | Per-rate tax breakdown sums to header (display; header tax is `total − subtotal`) | **Yes** in `calculateInvoiceTotals` |
| T8 | Detail per-row amounts consistent with snapshots | **No** — uses `unit_price × quantity`, omits Anfahrt, shows excluded rows |

---

## 6. Recommendations

### 6.1 Introduce the helper

Add `computeInvoiceTotalsFromSnapshots(lineItems)` in `src/features/invoices/lib/compute-invoice-totals.ts`:

- Compose `billing-inclusion.ts` + `compute-invoice-km.ts` + `calculateInvoiceTotals` (via persisted-row adapter).
- Unit tests: fixed fixture of `InvoiceLineItemRow[]` asserting trips/km/money buckets, including excluded + cancelled rows.
- Optional integrity test: compare to `invoices` header for real invoice IDs (draft-saved).

### 6.2 Refactor consumers (follow-up PRs)

1. **PDF cover footer** — use helper money output instead of inline mapping.
2. **Detail sidebar** — show helper totals; add per-rate MwSt from `perTaxRate`; consider trip count summary (`normalIncludedCount`, `excludedCount`).
3. **Detail table** — badge excluded rows; per-row amount should use `total_price` gross or snapshot-aware net helper, not raw `unit_price × quantity`.

### 6.3 Open design questions

| Question | Options |
|----------|---------|
| **Expose excluded km in UI?** | (a) Audit-only in helper, hidden by default; (b) Show in detail KM block as third line “Ausgeschlossene Strecken (nicht abgerechnet)” |
| **Detail footer: helper vs DB header?** | (a) Trust DB for issued invoices (legal snapshot); (b) Always show helper and flag drift; (c) DB for issued, helper for draft |
| **Persist `is_manual_gross_override`?** | Fixes D1 edge; enables RPC + helper parity for Taxameter lines |
| **Server-side verify on create?** | RPC or trigger to recompute header on insert — would close M2 |
| **Group PDF `quantity` column label** | Rename UI label to “Anzahl Fahrten (eingeschlossen)” to prevent confusion with per-km `quantity` on flat rows |

### 6.4 Label improvement (low effort, high clarity)

From [`invoice-branch-after-edit-audit.md`](invoice-branch-after-edit-audit.md): grouped “Nach Abrechnungsart” rows aggregate **included** lines only. Adding helper text — e.g. “Anzahl Fahrten (nur eingeschlossene)” on the `trip_count` column — would prevent the “50 vs 51” class of misreadings without changing billing semantics.

---

## Appendix A — File reference map

| File | Totals role |
|------|-------------|
| `invoice-line-items.api.ts` | `calculateInvoiceTotals`, `lineItemToInsertRow`, `frozenPriceResolutionForInsert` |
| `invoices.api.ts` | `createInvoice` (client totals), `updateDraftInvoice` (RPC), `getInvoiceRevenueTotal` |
| `billing-inclusion.ts` | Inclusion filters (SSOT) |
| `compute-invoice-km.ts` | KM buckets (SSOT) |
| `build-invoice-pdf-summary.ts` | Per-group km/money for cover table |
| `invoice-pdf-line-amounts.ts` | Per-line net/gross for PDF |
| `line-item-net-display.ts` | Builder Step 3 display gross/net |
| `InvoicePdfDocument.tsx` | Cover: KM + money recompute |
| `invoice-detail/index.tsx` | DB header + KM helper + weak per-row net |
| `use-invoice-builder.ts` | Builder totals from live state |
| `build-confirmation-display-rows.ts` | Confirm table slice |
| `replace_draft_invoice_line_items` (SQL) | Authoritative draft header recompute |

---

*Audit completed 2026-06-15. No code changes made.*
