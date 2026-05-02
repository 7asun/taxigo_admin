# Step 3 display vs PDF brutto — audit

Read-only trace for the case: **Step 3 Bruttopreis input shows 13,67 €** while the **PDF shows 19,66 €** for the same trip (non–manual-override session). Context: 19,66 € at 7 % VAT implies ~18,37 € line net, matching the PDF Netto column.

**Files read:** [`line-item-net-display.ts`](src/features/invoices/lib/line-item-net-display.ts), [`invoice.types.ts`](src/features/invoices/types/invoice.types.ts) (`BuilderLineItem`), [`use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts), [`invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts), [`resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts) (contract for `gross` vs `approach_fee_net`), [`build-draft-invoice-detail-for-pdf.ts`](src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts), [`invoice-pdf-line-amounts.ts`](src/features/invoices/components/invoice-pdf/lib/invoice-pdf-line-amounts.ts), [`InvoicePdfDocument.tsx`](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) (`priceResolutionFromLineItem`).

**Builder load path (not `invoice_line_items`):** Trips are loaded with [`fetchTripsForBuilder`](src/features/invoices/api/invoice-line-items.api.ts) (`trips` table + joins). [`buildLineItemsFromTrips`](src/features/invoices/api/invoice-line-items.api.ts) calls `resolveTripPricePure(...)` and copies the result to `BuilderLineItem.price_resolution`; there is **no** direct map from `invoice_line_items.total_price` into the builder.

---

## 1. `lineItemGrossTotalForDisplay(item)` when not overridden

For `isManualOverride !== true` and `manualGrossTotal` null/undefined:

- The helper **does not** read `unit_price`, `quantity`, or `approach_fee_net`.
- It returns **`item.price_resolution.gross ?? null`** (second branch after the `manualGrossTotal` check).

Source:

```31:36:src/features/invoices/lib/line-item-net-display.ts
export function lineItemGrossTotalForDisplay(
  item: BuilderLineItem
): number | null {
  if (item.manualGrossTotal !== null && item.manualGrossTotal !== undefined)
    return item.manualGrossTotal;
  return item.price_resolution.gross ?? null;
}
```

---

## 2. `price_resolution.gross` for builder items (from trips, no session override)

**Provenance:** Each `BuilderLineItem` is built in [`buildLineItemsFromTrips`](src/features/invoices/api/invoice-line-items.api.ts): `price_resolution` is the return value of `resolveTripPricePure(...)`. Initial `manualGrossTotal` is always `null`; `isManualOverride` is `false`.

**Semantics (engine contract):** In [`resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts), the file-level pricing contract states explicitly that **`approach_fee_net` is never included in `priceResolution.gross`** (lines 73–77). For **net-anchor** strategies (`tiered_km`, `fixed_below_threshold_then_km`, rule strategies, `trip_price_fallback`, etc.), `resolution()` sets:

- `net` = **base transport net** (e.g. tiered km total net, or `base_net_price`),
- `gross` = `grossFromNet(net, taxRate)` = **VAT on that transport net only** (rounded once), **unless** a branch passes an explicit `gross` (e.g. P0 taxameter, P2 client tag).

`withApproachFeeFromRule` only adds **`approach_fee_net`** to the resolution; it does **not** add approach into `gross`.

So for a typical ruled trip with Anfahrt:

- **`price_resolution.gross` = brutto (incl. VAT) for the transport portion only**, not the full line including Anfahrt.
- **`price_resolution.net`** (and `unit_price_net` × `quantity` for tiered lines) = transport net only; line net including Anfahrt is `(unit_price × quantity + approach_fee_net)` in net terms.

**DB → builder mapping:** [`fetchTripsForBuilder`](src/features/invoices/api/invoice-line-items.api.ts) selects `net_price`, `base_net_price`, `approach_fee_net`, `manual_gross_price`, `driving_distance_km`, client `price_tag`, etc. **No column from `invoice_line_items` is read here.** `gross` on the item is **not** copied from a trips table “gross” column; it is **computed inside `resolveTripPrice`** from the cascade inputs above.

---

## 3. Net values assigned into `price_resolution.gross` or `manualGrossTotal` by mistake?

**`manualGrossTotal`:** [`buildLineItemsFromTrips`](src/features/invoices/api/invoice-line-items.api.ts) sets `manualGrossTotal: null` for every built row. It is only set later in the hook when the admin commits a gross override (`applyGrossOverride`). No loader assigns trip net into `manualGrossTotal`.

**`price_resolution.gross`:** Set only inside `resolveTripPrice` / `resolution()`:

- Net-anchor paths pass **transport `net`** into `resolution()`; `gross` is derived as **`roundMoneyOnce(net * (1 + taxRate))`** — that value is **gross incl. VAT of the transport net**, not a net figure. So it is not “net wrongly stored in gross” in the sense of mixing dimensions; it is **incomplete line gross** by design (excludes Anfahrt gross).

No inspected mapping assigns `unit_price`, `total_price` (N/A on builder), or `approach_fee_net` **into** the `gross` field as a literal bug; the discrepancy is **semantic**: `gross` is not the full-line brutto when `approach_fee_net` is non-zero.

---

## 4. Where the PDF gets per-line brutto (vs Step 3 helper)

The PDF **does not** call `lineItemGrossTotalForDisplay`.

**Builder preview:** [`buildDraftInvoiceDetailForPdf`](src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts) maps each `BuilderLineItem` to a draft `InvoiceLineItemRow` via `builderItemToDraftLineItem`. For non–`client_price_tag` frozen resolutions, **`total_price`** is:

```51:53:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
  const total_price = isGrossAnchorClientPriceTag(frozen)
    ? frozen.gross! * q + approach * (1 + item.tax_rate)
    : Math.round((u * q + approach) * (1 + item.tax_rate) * 100) / 100;
```

So preview line brutto = **full line** (transport net × qty + approach net) × (1 + tax), rounded — i.e. the **19,66 €** class of value.

**Rendered PDF amounts:** [`lineGrossEurForPdfLineItem`](src/features/invoices/components/invoice-pdf/lib/invoice-pdf-line-amounts.ts) uses **`item.total_price`** when present (preferred), else falls back to `lineNetEurForPdfLineItem(...) * (1 + tax_rate)`.

**Issued invoices:** Same helper reads persisted `invoice_line_items.total_price` (written by `insertLineItems` using the same full-line brutto logic for non–client_price_tag rows).

`InvoicePdfDocument.priceResolutionFromLineItem` can synthesize a resolution from snapshot + columns; the **Brutto column path in summary builders** is driven by stored **`total_price`** / `lineGrossEurForPdfLineItem`, not by `price_resolution.gross` alone.

---

## 5. `calculateInvoiceTotals` for non-overridden, non–`client_price_tag` lines

For lines **without** `manualGrossTotal` and **not** `isGrossAnchorClientPriceTag(pr)`:

- It uses the **net-anchor branch**:  
  `baseNet = item.unit_price * item.quantity` (null `unit_price` → 0),  
  `lineTotal = baseNet + (item.approach_fee_net ?? 0)`.

It does **not** read `InvoiceLineItemRow.total_price` (builder items are `BuilderLineItem`, which has no `total_price`). It does **not** use `price_resolution.gross` on this path.

**Meaning of `unit_price`:** On `BuilderLineItem`, `unit_price` is **`price_resolution.unit_price_net`** — **net** per unit (per trip or per km). With `approach_fee_net`, the summed **net** is the **full line net** (transport + Anfahrt). VAT is applied via per–tax-rate buckets. That matches the same economic total as the PDF’s `(u×q + approach)×(1+rate)` for a single-rate line.

So for this trip, that path uses **netto** components, not the transport-only `price_resolution.gross`.

---

## 6. Footer totals on the left panel vs per-row input

- **Per-row Bruttopreis** in Step 3 is driven by **`lineItemGrossTotalForDisplay` → `price_resolution.gross`**, which — for net-anchor + Anfahrt — is **transport-only gross**, so it can show **13,67 €** while the true line brutto is **19,66 €**.
- **Footer** (`subtotal`, `taxAmount`, `total`) uses **`calculateInvoiceTotals(lineItems)`**, which on the net-anchor path sums **`unit_price×quantity + approach_fee_net`** and VAT buckets — i.e. **full line**, consistent with the PDF header/totals logic.

So **only the per-row Bruttopreis display is wrong** for this shape of line; the **footer should align with the PDF** (same full-line basis), not with the misleading per-row input.

---

## Senior-level hypothesis (root cause)

**Root cause:** [`lineItemGrossTotalForDisplay`](src/features/invoices/lib/line-item-net-display.ts) treats **`price_resolution.gross` as the full line brutto** for all engine-priced items (comment: “engine already includes approach_fee_net in the gross total”). That contradicts the **documented engine contract** in [`resolve-trip-price.ts`](src/features/invoices/lib/resolve-trip-price.ts): **`gross` excludes Anfahrt; Anfahrt is only in `approach_fee_net` and must be grossed up separately** for line totals.

Step 3 therefore shows **VAT-inclusive transport only** in the Bruttopreis field when `approach_fee_net` is set, while the PDF (and footer totals) use **full line brutto** via `(transport net + approach net) × (1 + VAT)`.

**Not** a Supabase mis-mapping of net into `gross`; **not** PDF using a different trip — it is **inconsistent interpretation of `price_resolution.gross`** between the Step 3 brutto column helper and the line-total formulas used elsewhere.

A principled fix (out of scope for this audit-only task) would align `lineItemGrossTotalForDisplay` with the same full-line brutto definition as `builderItemToDraftLineItem` / `lineGrossEurForPdfLineItem` for net-anchor rows with approach, **without** breaking `client_price_tag` / taxameter semantics — and update the misleading comment in `line-item-net-display.ts`.

---

## Resolution

Fixed `lineItemGrossTotalForDisplay` to compute full-line brutto from net fields — `Math.round((unit_price × quantity + approach_fee_net) × (1 + tax_rate) × 100) / 100`, matching [`builderItemToDraftLineItem`](src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts) for non–manual rows. `price_resolution.gross` (transport-only when Anfahrt is separate) is no longer used as the display anchor. `manualGrossTotal` and null `unit_price` behaviour are unchanged.
