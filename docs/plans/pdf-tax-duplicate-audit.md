# PDF Tax Summary Duplicate Lines Audit

**Date:** 2026-06-02  
**Scope:** Read-only audit of duplicate `zzgl. Umsatzsteuer X %` rows in the invoice PDF totals block, and the reported `Summe Nettobeträge` vs `Bruttobetrag` confusion on a large grouped (RZO) invoice.  
**No code changes.**

**Files read:**

- `src/features/invoices/api/invoice-line-items.api.ts` — `calculateInvoiceTotals` (full function)
- `src/features/invoices/types/invoice.types.ts` — `TaxBreakdown`, `TotalsLineShape`
- `src/features/invoices/api/__tests__/calculate-invoice-totals.test.ts` (full file)
- `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` — totals wiring
- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` — totals UI (full file)
- `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` — draft preview totals call
- `src/features/invoices/hooks/use-invoice-builder.ts` — builder `calculateInvoiceTotals` usage
- `src/features/invoices/lib/tax-calculator.ts` — `TAX_RATES`, `formatTaxRate`
- `src/features/invoices/lib/pdf-column-catalog.ts` — grouped net/brutto column definitions
- `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts` — grouped row amounts (partial)

---

## A. Tax Bucket Data — calculateInvoiceTotals

### Return shape (mixed 0% / 7% / 19%)

`calculateInvoiceTotals` returns a **single flat object** — not two parallel tax structures:

```ts
{
  subtotal: number;      // sum of net (net-anchor + implied net from gross-anchor)
  taxAmount: number;     // total − subtotal (header VAT)
  total: number;         // brutto
  breakdown: TaxBreakdown[];  // one entry per distinct tax_rate key
}
```

`TaxBreakdown` (`invoice.types.ts`):

```ts
interface TaxBreakdown {
  rate: number;  // e.g. 0.07
  net: number;   // bucket net (rounded to cents)
  tax: number;   // round(net × rate, 2) per bucket
}
```

### Internal bucketing (one merged map, not two arrays)

Inside the function:

| Variable | Purpose |
|----------|---------|
| `byRateMerged` | **Single** `Record<number, number>` — net per `item.tax_rate`; feeds `breakdown` |
| `byRateNonTag` | Net-anchor lines only — used **only** to compute header `taxNonTag` (VAT once per bucket) |
| `priceTagNetTotal` | Implied net from gross-anchor / manual-gross lines — adds to `subtotal` only |
| `grossFixed` | Gross-anchor brutto — adds to `total` directly |

**Net-anchor path** (`else` branch): accumulates into `byRateNonTag[rate]` and **`byRateMerged[rate]`** (same net amount).  
**Gross-anchor path** (`isGrossAnchorClientPriceTag` or `manualGrossTotal`): implied net `lineNet` goes into **`byRateMerged[rate]`** only (not `byRateNonTag`).  
There is **no** second breakdown array and **no** concatenation of “old” vs “new” bucket lists.

`breakdown` is built **once**:

```ts
const breakdown: TaxBreakdown[] = Object.entries(byRateMerged).map(
  ([rateStr, net]) => ({
    rate: parseFloat(rateStr),
    net: Math.round(net * 100) / 100,
    tax: Math.round(net * parseFloat(rateStr) * 100) / 100
  })
);
```

For a clean mixed invoice (one line each at `TAX_RATES.ZERO`, `REDUCED`, `STANDARD`), this yields **exactly three** buckets.

### TAX_RATES.ZERO / this session

- `TAX_RATES.ZERO` was added in `tax-calculator.ts` for Step 3 UI and tests; **`calculateInvoiceTotals` was not given a separate 0% code path**.
- Bucketing still keys on `item.tax_rate` as-is. A 0% line creates one bucket with `tax: 0`.
- No `groupBy`/`filter` merge of legacy vs new arrays — only the loops above.

### Test assertions (mixed 0/7/19%)

`calculate-invoice-totals.test.ts` → `describe('calculateInvoiceTotals — zero VAT rate')`:

- **`mixed 0% / 7% / 19% → three buckets sum to total`** asserts `totals.breakdown.toHaveLength(3)` and that `sumNet + sumTax === total`.
- It does **not** assert five buckets; it would **fail** if the function returned five entries for three distinct canonical rates.

**Conclusion for clean data:** duplication is **unlikely** to originate from `calculateInvoiceTotals` when every line shares exactly one of `{0, 0.07, 0.19}`.

### Plausible data-layer duplication (production)

`byRateMerged` uses **`item.tax_rate` as object key without normalization**. In JavaScript, `0.07` and `0.07000000000000001` are **different keys** → `Object.entries` emits **two buckets** that both display as **`7 %`** via `formatTaxRate` (`Math.round(rate * 100)`). Same risk for `0.19` vs float drift, and for `0` vs `-0`.

This session did not introduce that pattern; it predates 0% work. Adding 0% increases the chance of a visible **`zzgl. Umsatzsteuer 0 %`** row (correct, not a duplicate of 7/19) but does not by itself double 7% or 19%.

---

## B. PDF Rendering

### Tax rows (`zzgl. Umsatzsteuer …`)

**File:** `invoice-pdf-cover-body.tsx` (totals block ~292–321).

| Question | Answer |
|----------|--------|
| Variable mapped | **`breakdown`** prop — `{ rate: number; tax: number }[]` |
| `.map()` count | **Once:** `{breakdown.map((b) => (...))}` |
| Second list | **None** — no `vatLines`, `taxLines`, `taxBreakdown`, or hardcoded 7%/19% rows |
| Filter | **None** — buckets with `tax === 0` still render (e.g. 0% line → “zzgl. Umsatzsteuer 0 %” with `0,00 €`) |

React key: `key={b.rate}` — duplicate **numeric** rates in the array would collide; duplicate **near-equal** rates (different keys, same rounded label) produce **two rows** with the same visible percentage.

### Props for the totals block (`InvoicePdfCoverBody`)

```ts
subtotal: number;
total: number;
breakdown: { rate: number; tax: number }[];
```

Passed from `InvoicePdfDocument.tsx`:

```ts
const { subtotal, total, breakdown } = calculateInvoiceTotals(lineItemsForCalc);
// ...
<InvoicePdfCoverBody
  subtotal={subtotal}
  total={total}
  breakdown={breakdown}
  ...
/>
```

No second tax prop. Draft builder preview uses the same `InvoicePdfDocument` → same recompute path (not stored header `tax_amount` alone).

### Historical rendering (pre–0% session)

`invoice-pdf-cover-body.tsx` has used the **same single `breakdown.map`** since early invoice PDF work (`fee4c34` / current tree). There was **no** separate fixed 7% + 19% block.

This session **did not** add a parallel PDF path for 0%; 0% appears only if `breakdown` contains `rate: 0`.

### Call chain

1. **`InvoicePdfDocument`** — maps `invoice.line_items` → `lineItemsForCalc`, calls `calculateInvoiceTotals`, passes `subtotal` / `total` / `breakdown` to cover body.
2. **`use-invoice-builder.ts`** — `calculateInvoiceTotals` on included builder rows (footer); PDF preview goes through `InvoicePdfDocument`, not a duplicate totals renderer.
3. **`build-draft-invoice-detail-for-pdf.ts`** — calls `calculateInvoiceTotals` for draft `subtotal` / `tax_amount` / `total` on the fake `InvoiceDetail`; **does not** pass `breakdown` (PDF recomputes breakdown in `InvoicePdfDocument`).

**Note:** `InvoicePdfDocument` passes **all** `invoice.line_items` into `calculateInvoiceTotals` (no `billing_included` filter in that call). That can skew totals vs builder footer but does not split one rate into two breakdown rows.

---

## C. Summe Nettobeträge discrepancy

### What the footer uses

| Line | Source | Meaning |
|------|--------|---------|
| **Summe Nettobeträge** | `subtotal` from `calculateInvoiceTotals` | `nonTagSubtotal + priceTagNetTotal` — **net** |
| **zzgl. Umsatzsteuer X %** | `breakdown[].tax` | VAT per rate bucket |
| **Bruttobetrag (Zahlungsbetrag)** | `total` | **Gross** payment amount |

So the footer label **Summe Nettobeträge** is wired to **net**, not gross. If the user sees **11.044,47 €** on that line and **12.869,23 €** on **Bruttobetrag**, that is **consistent** with VAT on top (~1.824,76 € total tax), not “0% effective tax.”

### Why net and gross can “look the same” in the table

Grouped cover rows (`build-invoice-pdf-summary`) expose:

- **`total_price` / `total_net` / `Gesamt netto`** — aggregated **net** (`InvoicePdfSummaryRow.total_price`).
- **`total_gross` / `Gesamt brutto`** — `total_costs_gross` (sum of persisted line `total_price` brutto).

Catalog quirk: column key **`gross_price`** is labeled **“Brutto”** but uses `dataField: 'total_price'`, which on **grouped** summary rows resolves to **net** (`pdf-column-catalog.ts` comments + `rawForGroupedRow`). If the RZO Vorlage shows **`gross_price`** instead of **`total_gross`**, summing the main table can match **Summe Nettobeträge** while **Bruttobetrag** stays higher — **misleading column**, not wrong footer math.

Separate known issue: cover grouped **net** columns can drift a few cents from header `subtotal` for tiered_km (see `docs/plans/pdf-cover-net-consistency-audit.md`); that is rounding/aggregation, not swapping net and gross in the totals block.

**Verdict:** Treat **Summe Nettobeträge = subtotal (net)** as **correct** in code. The reported “identical 11.044,47 €” is likely **table column choice / labeling**, not `subtotal` populated with `total` (gross).

---

## D. Root cause (Cursor's conclusion)

For **duplicate `zzgl. Umsatzsteuer` lines with the same percentage**, the most likely origin is the **data layer**: `calculateInvoiceTotals` builds `breakdown` from `Object.entries(byRateMerged)` keyed by raw `item.tax_rate` floats, which can produce **multiple buckets that `formatTaxRate` renders identically**; the PDF then renders that array **once** in `invoice-pdf-cover-body.tsx` with no second tax list.

For **clean canonical rates**, tests prove **three buckets** for 0/7/19% — so a **five-line** PDF with three true rates points to **float/key fragmentation** or **duplicate rate values in persisted lines**, not a second `.map()` in the PDF.

---

## E. Fix recommendation

1. **`src/features/invoices/api/invoice-line-items.api.ts` (`calculateInvoiceTotals`)** — Normalize `item.tax_rate` to a canonical bucket key (e.g. `TAX_RATES.ZERO | REDUCED | STANDARD` or round to 2 decimal places) before `byRateMerged[rate] += …`, so `breakdown` has at most one row per displayed MwSt-%.

2. **`src/features/invoices/api/__tests__/calculate-invoice-totals.test.ts`** — Add a regression test: two lines with `tax_rate` `0.07` and `0.070000000000001` must merge to **one** 7% bucket.

3. **`invoice-pdf-cover-body.tsx` (optional hardening)** — After (1), optionally skip rendering rows where `b.tax === 0` if product should hide “zzgl. Umsatzsteuer 0 %”; cosmetic only, does not fix duplicate 7%/19%.

4. **`Summe Nettobeträge confusion (separate)** — Audit the RZO PDF Vorlage: ensure grouped layout uses column **`total_gross`** for brutto display, not **`gross_price`**; document in Vorlagen UX if needed (`pdf-column-catalog.ts`).

5. **`InvoicePdfDocument.tsx` (separate totals accuracy)** — Filter `lineItemsForCalc` to `billing_included !== false` before `calculateInvoiceTotals` so PDF footer matches builder exclusion rules.
