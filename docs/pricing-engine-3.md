# Pricing engine — rounding contract (Spec C)

See also [pricing-engine.md](pricing-engine.md) for the full Spec C overview.

## Rounding contract

The engine uses two anchoring strategies. Every pricing path belongs to exactly one.

### Gross-anchor (P1 — `client_price_tag`)

The client contract specifies a gross (incl. VAT) price. The gross value is immutable and must propagate without modification to `invoices.total`.

| Step | Rule |
| --- | --- |
| `resolveTripPrice` ([`resolve-trip-price.ts`](../src/features/invoices/lib/resolve-trip-price.ts)) | `unit_price_net = tag / (1 + taxRate)` — **no** `roundMoneyOnce` |
| `insertLineItems` ([`invoice-line-items.api.ts`](../src/features/invoices/api/invoice-line-items.api.ts)) | `total_price = price_resolution.gross × quantity + approach_fee_net × (1 + rate)` when `isGrossAnchorClientPriceTag(frozen)` |
| `calculateInvoiceTotals` ([`invoice-line-items.api.ts`](../src/features/invoices/api/invoice-line-items.api.ts)) | `grossFixed += gross × quantity + approach_fee_net × (1 + rate)` — never re-derives transport gross from rounded net |
| Final `total` (same file) | `round(nonTagSubtotal + nonTagTax + grossFixed)` |
| PDF render ([`build-invoice-pdf-summary.ts`](../src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts)) | `displayed_net = round(totalGross / (1 + tax_rate))` — back-derived; **never** `SUM(unit_price × quantity)` on the summary row |

Example — 13 trips × €32.60 gross @ 7% VAT:

```
Step 1 — resolution (P1, gross anchor):
  unit_price_net  = 32.60 / 1.07           = 30.467289...  (stored unrounded on new invoices)
  gross           = 32.60                   (immutable anchor)

Step 2 — invoice total (calculateInvoiceTotals):
  grossFixed      = 32.60 × 13             = 423.80
  total           = round(423.80)          = 423.80  ✅

Step 3 — PDF display (back-derivation):
  totalGross      = SUM(line total_price)  = 423.80  (from invoice_line_items; see lineGrossEurForPdfLineItem)
  displayed_net   = round(423.80 / 1.07)   = 396.07  ✅

❌ Wrong (pre-fix unit net accumulation on summary):
  SUM(round(unit_price_net) × qty) = 13 × 30.47 = 396.11
  invoice total from that net path:  round(396.11 × 1.07) = 423.84
```

#### Why back-derivation is used at render time

Even after the resolver fix, `invoice_line_items.unit_price` on invoices created **before** the fix contains the pre-rounded value (`round(tag / (1 + rate))`). Those rows are immutable under normal operations — they are not recomputed without voiding or replacing the invoice.

Summing stored `unit_price × quantity` across *N* lines therefore accumulates drift:

```
13 × round(32.60 / 1.07)  =  13 × 30.47  =  396.11   ← wrong
round(423.80 / 1.07)      =  396.07                   ← correct
```

The PDF layer derives the **displayed net** from the **gross anchor** at render time, not from the stored unit net:

```
displayed_net = round(totalGross / (1 + tax_rate))
```

- **`totalGross`** is accumulated via **`lineGrossEurForPdfLineItem`** ([`invoice-pdf-line-amounts.ts`](../src/features/invoices/components/invoice-pdf/lib/invoice-pdf-line-amounts.ts)), which reads **`invoice_line_items.total_price`** (stored line gross).
- For **`client_price_tag`** lines, **`total_price`** was written by **`insertLineItems`** as **`gross × quantity`** (plus grossed-up approach) — including on pre-fix invoices where **`unit_price_net`** was still rounded in the resolver. The **gross** column is therefore the reliable anchor across invoice generations.

This aligns with **§14 UStG**: the legally binding amount on a German invoice is the **Bruttobetrag** (Zahlungsbetrag). The displayed net is a **derived** figure from that gross, not an independently fixed audit total. Industry practice (DATEV, Lexoffice, Sevdesk) uses the same back-derivation pattern for gross-anchored line items.

**Affected render paths** (all in [`build-invoice-pdf-summary.ts`](../src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts)):

| Function | Display field | Rule |
| --- | --- | --- |
| `summaryRowFromAgg` | `InvoicePdfSummaryRow.total_price` | `round(totalGross / (1 + tax_rate))` where `totalGross` comes from aggregator `g.total_gross` |
| `buildInvoicePdfSingleRow` | same | Gross accumulated in-loop via `lineGrossEurForPdfLineItem`; net derived after loop |
| `buildInvoicePdfGroupedByBillingType` | same | Same pattern per billing-type / tax-rate group |

**`lineNetEurForPdfLineItem`** is **not** used to set the summary row’s displayed net. It remains in the route- and billing-type **aggregation loops** only to populate **`g.total_price`** on the internal aggregator struct (currently unused for the final `InvoicePdfSummaryRow.total_price`; retained for possible future per-line net breakdowns or debugging).

**Invariant (grouped / single-row summary rows):**  
On each `InvoicePdfSummaryRow`, `total_price + round(total_price × tax_rate) ≈ total_costs_gross` within **±0.01 €** under standard cent rounding (back-derived net plus VAT rounds to accumulated line gross).

**Footer net (`Summe Nettobeträge`):**  
[`InvoicePdfDocument.tsx`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) (lines 275–303) builds `lineItemsForCalc` from persisted `invoice.line_items` and passes **`subtotal`** from **`calculateInvoiceTotals(lineItemsForCalc)`** into [`InvoicePdfCoverBody`](../src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx) — it does **not** sum `InvoicePdfSummaryRow.total_price`. Footer totals therefore follow the same **`calculateInvoiceTotals`** rules as `invoices.subtotal` / header storage, while grouped table **net** cells use the back-derived `InvoicePdfSummaryRow.total_price` for display alignment with **`total_costs_gross`** on those rows.

### Net-anchor (P2–P4 and all billing rules)

The billing rule, km rate, or trip price defines a net amount. VAT is added on top.

| Step | Rule |
| --- | --- |
| `resolveTripPrice` | `unit_price_net` rounded with `roundMoneyOnce` at resolution time |
| `tieredNetTotal` | One `roundMoneyOnce` on the trip total — **never per segment** |
| `calculateInvoiceTotals` | Accumulate net into `byRate` buckets; `round(bucketNet × rate)` once per rate |
| Final `total` | `round(subtotal + taxAmount)` |

### `approach_fee_net`

Always net-anchored, regardless of the base transport strategy. Stored as net, grossed up with `× (1 + tax_rate)` in `insertLineItems` and `calculateInvoiceTotals`. Never included in `price_resolution.gross`.
