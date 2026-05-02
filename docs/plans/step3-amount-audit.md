# Step 3 amounts audit — footer totals vs display helper vs PDF

Read-only trace of how `subtotal` / `taxAmount` / `total`, `lineItemGrossTotalForDisplay`, `onApplyGrossOverride`, and the PDF preview relate. No code changes in this pass.

**Source files:** `src/features/invoices/hooks/use-invoice-builder.ts`, `src/features/invoices/components/invoice-builder/index.tsx`, `src/features/invoices/api/invoice-line-items.api.ts` (`calculateInvoiceTotals`), `src/features/invoices/lib/line-item-net-display.ts`, `src/features/invoices/types/invoice.types.ts` (`BuilderLineItem`), `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`, `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx`, `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts`.

---

## 1. Where `subtotal`, `taxAmount`, and `total` are computed before `<Step3LineItems>`

**Chain:**

1. `useInvoiceBuilder` holds `lineItems` in React state and computes:

   ```ts
   const totals = calculateInvoiceTotals(lineItems);
   ```

   (`src/features/invoices/hooks/use-invoice-builder.ts`, ~219–220.)

2. The hook returns `totals` as an object `{ subtotal, taxAmount, total, breakdown }` (only the first three are passed to Step 3).

3. `InvoiceBuilder` in `index.tsx` destructures `totals` from `useInvoiceBuilder` and passes:

   ```tsx
   subtotal={totals.subtotal}
   taxAmount={totals.taxAmount}
   total={totals.total}
   ```

   (`src/features/invoices/components/invoice-builder/index.tsx`, ~588–592.)

**Exact computation** is entirely inside `calculateInvoiceTotals` in `invoice-line-items.api.ts` (lines ~458–538):

- For each line, read `pr = item.price_resolution`, `rate = item.tax_rate`, `approach = item.approach_fee_net ?? 0`.

- **Gross-anchor branch** (`isGrossAnchorClientPriceTag(pr)` → `strategy_used === 'client_price_tag' && pr.gross != null`):

  - Contributes to `grossFixed`: `pr.gross * item.quantity + approach * (1 + rate)`.
  - Derives implied net for buckets: `lineNet = (pr.gross * qty) / (1 + rate) + approach`, accumulated into `priceTagNetTotal` and `byRateMerged`.

- **Net-anchor branch** (all other strategies):

  - `baseNet = item.unit_price !== null ? item.unit_price * item.quantity : 0`
  - `lineTotal = baseNet + approach`, accumulated into `nonTagSubtotal`, `byRateNonTag`, `byRateMerged`.

- VAT on net-anchor buckets: `taxNonTag = sum over rates of round(net * rate * 100) / 100`.

- **Header numbers:**

  - `total = round((nonTagSubtotal + taxNonTag + grossFixed) * 100) / 100`
  - `subtotal = round((nonTagSubtotal + priceTagNetTotal) * 100) / 100`
  - `taxAmount = round((total - subtotal) * 100) / 100`

---

## 2. Does that computation use `lineItemGrossTotalForDisplay`?

**No import/call**, but when `manualGrossTotal` is set the totals logic uses **that same numeric anchor** the helper would return.

It uses:

- **`price_resolution.gross`** only inside the **`client_price_tag`** gross-anchor branch (multiplied by `quantity`, plus grossed-up approach).
- Otherwise **`item.unit_price * item.quantity`** and **`item.approach_fee_net`** (net path).

When **`manualGrossTotal` is set** (Step 3 gross override committed), **`calculateInvoiceTotals` uses that field as the line brutto anchor** (same value `lineItemGrossTotalForDisplay` shows), not the net reverse-sum from `unit_price` / `approach_fee_net`. Otherwise behaviour is unchanged: `client_price_tag` uses `pr.gross`×qty + grossed approach; all other strategies use the net-anchor path.

---

## 3. What `lineItemGrossTotalForDisplay` returns (preferences)

From `src/features/invoices/lib/line-item-net-display.ts`:

1. If `item.manualGrossTotal !== null && item.manualGrossTotal !== undefined` → returns **`manualGrossTotal`** (admin override / stored gross intent on the builder line item).
2. Else → returns **`item.price_resolution.gross ?? null`**.

There is no separate “session-only” field beyond what is already on `BuilderLineItem`: **`manualGrossTotal` is the explicit override flag value**; when absent, display falls back to engine **`priceresolution.gross`**.

---

## 4. `onApplyGrossOverride` → state update vs footer totals

**Wiring:** `onApplyGrossOverride` on the page is **`applyGrossOverride`** from `useInvoiceBuilder`.

**Update:** `applyGrossOverride` calls `setLineItems((prev) => prev.map(...))`, patching the matching `position` with:

- `price_resolution` from `applyGrossOverrideToResolution(...)`
- `unit_price`, `approach_fee_net`, `approach_fee_gross`, `manualGrossTotal`, `manualApproachFeeGross`, `isManualOverride: true`, cleared `kts_override` / `price_source`, refreshed `warnings`

(`use-invoice-builder.ts`, ~146–172.)

**Footer:** `totals = calculateInvoiceTotals(lineItems)` runs on the same render cycle as `lineItems` after that state update. So **yes — footer totals are derived from the same `lineItems` state** that `applyGrossOverride` mutates (not a parallel store).

---

## 5. Deferred `onBlur` commit — when it might **not** fire / not apply

**Chain (as implemented):** `onBlur` → `blurIfThisRow(position)` → `handleBlur(snap)` → `setTimeout(() => commitEdit(snap), 0)` → `onApplyGrossOverride` inside `commitEdit` when `!isNaN(gross)`.

**Reasons the override might not run:**

1. **`handleFocus` clears the timer.** Every Bruttopreis and Anfahrt `<Input>` calls `handleFocus()` on focus, which does `clearTimeout(commitTimerRef.current)`. That is intentional for **moving focus between the two fields on the same row** (comment at ~199–202). The same global `handleFocus` means: **if the user blurs row A’s field and the next focused control is row B’s gross or approach input, row B’s `onFocus` clears the timer scheduled by row A’s blur — so row A’s deferred commit never runs** and unsaved typing on row A is dropped (until the user focuses row A again).

2. **Invalid gross:** `commitEdit` only calls `onApplyGrossOverride` when `!isNaN(gross)` after `parseFloat`. Empty or non-numeric input → no override call (state stays as before; editing UI still clears in `commitEdit`).

3. **Escape:** `cancelEdit` clears the timer and drops editing state without committing.

4. **Clicking outside** (button, chevron, background) **does not** call `handleFocus` on those inputs, so the `setTimeout(0)` normally runs and commits — **not** inherently blocked by “clicking onto another button or row” *unless* that target is another price/approach field that triggers `handleFocus`.

---

## 6. PDF preview vs footer `total`

- **No Zustand slice** for builder line items: source of truth is **`lineItems` React state** in `useInvoiceBuilder`.

- **`InvoiceBuilder`** passes the **same `lineItems` array** into both:
  - `<Step3LineItems … total={totals.total} />` where `totals = calculateInvoiceTotals(lineItems)` in the hook, and
  - `useInvoiceBuilderPdfPreview({ lineItems, … })` (`index.tsx`, ~353–368).

- **`buildDraftInvoiceDetailForPdf`** recomputes header amounts with **`const { subtotal, taxAmount, total } = calculateInvoiceTotals(lineItems)`** again (`build-draft-invoice-detail-for-pdf.ts`, ~124–125) and sets `subtotal`, `tax_amount`, `total` on the draft row.

So the PDF **uses the same function and the same `lineItems` input** as the hook’s footer; it is **not** a separate selector or store. **Practical difference:** the preview document is updated via **`usePDF` + `setTimeout` debounce (600 ms, or 0 ms after column reorder)** (`use-invoice-builder-pdf-preview.tsx`, ~236–256), so the **on-screen PDF can lag** the footer by up to that delay, but the underlying totals logic matches.

---

## Summary table

| Question | Short answer |
|----------|----------------|
| Totals computation | `calculateInvoiceTotals(lineItems)` in hook; props from `totals` in `index.tsx`. |
| Uses `lineItemGrossTotalForDisplay`? | No direct call; when `manualGrossTotal` is set, totals use that anchor (same value the helper shows). Otherwise `pr.gross`×qty for `client_price_tag`, else net path. |
| Display helper preference | `manualGrossTotal` if set, else `price_resolution.gross`. |
| Override vs footer | `setLineItems` → same `lineItems` as `calculateInvoiceTotals`. |
| Blur commit gaps | Same-row Bruttopreis ↔ Anfahrt defers commit; cross-row focus no longer clears row A’s timer. NaN gross skips override; Escape cancels. |
| PDF vs footer | Same `lineItems` + same `calculateInvoiceTotals`; PDF refresh debounced. |

---

## Resolution

- **Bug 1 — footer vs manual brutto:** `calculateInvoiceTotals` takes a dedicated branch when `manualGrossTotal` is set: the line’s invoice brutto uses that value (all-in), with implied net `manualGrossTotal / (1 + tax_rate)` fed into the same buckets as other gross-anchored lines. This matches `lineItemGrossTotalForDisplay` and avoids cent drift from reverse-derived `unit_price` / `approach_fee_net` on the old net-anchor path.
- **Bug 2 — blur commit:** Step 3 `handleFocus(focusedPosition)` only clears the deferred `commitEdit` timer when focus stays on the **same** row (`editingRef.current?.position === focusedPosition`), so moving focus to another row’s price field no longer cancels row A’s pending commit.

### Known Follow-Up: `insertLineItems` persisted `total_price` drift

`insertLineItems` computes `total_price` for each line using the net reverse-formula (not `manualGrossTotal`). After the Bug 1 fix, the in-memory footer total and the PDF are correct, but the persisted `total_price` column on overridden rows may drift by ±0.01 € from `manualGrossTotal` due to floating-point rounding in the reverse-calculation.

This does not affect the invoice document. It will matter if `total_price` is ever queried directly from the DB for reporting or aggregation.

Fixing this requires updating `insertLineItems` to use `manualGrossTotal` as `total_price` when set — deferred to a separate task.
