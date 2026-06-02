# Wheelchair Gross-Anchor — Runtime Audit

**Date:** 2026-06-02  
**Scope:** Read-only trace of `applyTaxRateOverride` from Step 3 tax `<Select>` through `patchLineItemForTaxRateOverride`, to explain why wheelchair trips may still appear to change gross at runtime despite `item.is_wheelchair` in `isGrossAnchorTaxReprice`.  
**No code changes.**

**Files read:**

- `src/features/invoices/lib/apply-tax-rate-override.ts` (full)
- `src/features/invoices/hooks/use-invoice-builder.ts` (full; focus `applyTaxRateOverride` and post-patch effects)
- `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` (tax `Select` handler)
- `src/features/invoices/components/invoice-builder/index.tsx` (prop wiring)
- `src/features/invoices/lib/line-item-net-display.ts` (`lineItemGrossTotalForDisplay`)
- `src/features/invoices/lib/resolve-trip-price.ts` (rounding contract: `price_resolution.gross` vs Anfahrt)

---

## 1. `isGrossAnchorTaxReprice` — exact condition (current code)

From `apply-tax-rate-override.ts` lines 24–31:

```ts
function isGrossAnchorTaxReprice(item: BuilderLineItem): boolean {
  const src = item.price_resolution.source;
  return (
    src === 'manual_gross_price' ||
    src === 'client_price_tag' ||
    item.isManualOverride === true ||
    item.is_wheelchair === true
  );
}
```

All four clauses are active in the repo as of this audit.

---

## 2. `applyTaxRateOverride` in `use-invoice-builder.ts`

### Exact function body

```ts
const applyTaxRateOverride = useCallback(
  (position: number, newRate: number) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.position !== position) return item;
        const patched = patchLineItemForTaxRateOverride(item, newRate);
        return { ...patched, warnings: validateLineItem(patched) };
      })
    );
  },
  []
);
```

(lines 546–556)

### Answers

| Question | Finding |
|----------|---------|
| Calls `patchLineItemForTaxRateOverride` directly? | **Yes** — single call per matching position. |
| Rebuilds via `resolveTripPricePure` independently? | **No** — not in the hook. `resolveTripPricePure` runs only inside `patchLineItemForTaxRateOverride` on the **net-anchor** branch when `item.resolved_rule` is set. |
| Anything after the patch that overwrites? | **No** `useEffect`, debounce, or React Query refetch tied to tax `Select`. Only `validateLineItem(patched)` merges warnings onto the patched item. |

### Related state paths (not triggered by tax Select)

- **`applyKmOverride`** / **`resetKmOverride`** — reprice via `resolveTripPricePure` + `resolveTaxRate(km)`; only on KM edit/reset, not on tax change.
- **`tripsQuery`** — `setLineItems(buildLineItemsFromTrips(...))` on Step 2 submit; disabled in edit mode; `refetchOnWindowFocus: false` so focus does not wipe Step 3 edits.
- **Edit hydration `useEffect`** — seeds `lineItems` once (`hasHydratedRef`); waits for `editWheelchairQuery` before seeding so `is_wheelchair` is applied; does not re-run after tax override.
- **`applyGrossOverride` / `resetLineItemOverride`** — separate handlers; unrelated to tax Select.

### `is_wheelchair` population

| Mode | Source |
|------|--------|
| Create (Step 2 → trips fetch) | `buildLineItemsFromTrips`: `is_wheelchair: trip.is_wheelchair ?? false` (`fetchTripsForBuilder` selects `is_wheelchair`). |
| Edit (hydration) | `mapLineItemRowToBuilderLineItem` defaults `is_wheelchair: false`, then overlay `wheelchairFlags[trip_id]` from `fetchTripWheelchairFlags`. Hydration blocked until wheelchair query finishes when trip IDs exist. |

If the icon shows but gross still “moves,” `is_wheelchair` is likely **true** at patch time; the failure is probably **not** “flag never set.”

---

## 3. Step 3 tax `<Select>` `onValueChange`

From `step-3-line-items.tsx` lines 757–764:

```tsx
<Select
  value={String(item.tax_rate)}
  onValueChange={(val) =>
    onApplyTaxRateOverride(
      item.position,
      parseFloat(val)
    )
  }
  disabled={isOptedOut}
>
```

Wired in `index.tsx` as `onApplyTaxRateOverride={applyTaxRateOverride}` (hook export).

**It calls `onApplyTaxRateOverride(position, rate)` — not a different handler.**

---

## 4. Type of `newRate` from the Select

| Stage | Type |
|-------|------|
| shadcn `onValueChange` | `string` (`val`) |
| Passed to hook | **`number`** — `parseFloat(val)` |
| `patchLineItemForTaxRateOverride` | **`number`** (`newRate: number`) |

`SelectItem` values are `String(TAX_RATES.ZERO)`, `String(TAX_RATES.REDUCED)`, `String(TAX_RATES.STANDARD)` → `"0"`, `"0.07"`, `"0.19"`.  
`parseFloat` yields `0`, `0.07`, `0.19`.

**The string-coercion bug (`grossFixed / (1 + "0.07")` → NaN) does not occur on this path** — arithmetic uses a real number.

Edge case: invalid `val` → `parseFloat` → `NaN` → `isManualTaxRateOverride` and divisions become `NaN`; would look broken, not “net-anchor drift.” Not observed for the three fixed Select options.

---

## 5. `newRate` in `apply-tax-rate-override.ts`

```ts
export function patchLineItemForTaxRateOverride(
  item: BuilderLineItem,
  newRate: number
): BuilderLineItem {
```

No `parseFloat` / `Number()` inside the pure function — conversion happens only in the UI layer.

Inside gross-anchor (non–manual-override) branch:

```ts
const grossFixed = pr.gross as number;
const transportNet = grossFixed / (1 + newRate);
```

Uses numeric `newRate` throughout.

---

## D. Runtime conclusion — why gross may still appear to change

The hook and Select wiring are **correct**: `parseFloat` → `patchLineItemForTaxRateOverride` → `setLineItems`, no follow-up overwrite.

The likely runtime gap is a **contract mismatch between gross-anchor math and Step 3 display**, not a bypass of `is_wheelchair`:

### A. `price_resolution.gross` is transport-only for tiered / payer rules

`resolve-trip-price.ts` documents:

> `approach_fee_net` … is NEVER included in `priceResolution.gross`.

For `tiered_km` / `payer` source, `gross` is `grossFromNet(transportNet)` — **transport brutto only**, not line brutto incl. Anfahrt.

Wheelchair gross-anchor branch (lines 79–87) fixes:

```ts
const grossFixed = pr.gross as number;  // transport gross
const transportNet = grossFixed / (1 + newRate);
```

So `price_resolution.gross` stays at the **transport** gross; `net` is recomputed from that.

### B. Bruttopreis column ignores `price_resolution.gross`

`lineItemGrossTotalForDisplay` (`line-item-net-display.ts`):

- Does **not** use `price_resolution.gross` for normal lines.
- Recomputes display brutto as `(transportNet + approach) × (1 + tax_rate)` from `price_resolution.net` + `approach_fee_net`.

After a tax change on a wheelchair tiered line:

| Field | Behaviour |
|-------|-----------|
| `price_resolution.gross` | Fixed (transport gross) — gross-anchor **does** run |
| `price_resolution.net` | Changes (transport net ÷ (1 + newRate)) |
| **Bruttopreis input** | Changes — full-line gross from net + approach × (1 + rate) |

That matches “gross changes when I change MwSt” in the UI even when `is_wheelchair === true` and the patch took the gross-anchor branch.

Example shape (7% → 19%, transport gross ~40 €, Anfahrt net > 0): fixed transport `pr.gross` vs display ~46,88 € full line — user expectation in the wheelchair fix spec was **full-line** 46,88 € fixed; anchor currently holds **transport** gross only.

### C. Other checks (lower probability)

| Check | Result |
|-------|--------|
| `is_wheelchair` false at patch | Unlikely if wheelchair icon visible; create + edit paths set flag. |
| `pr.gross` null | Would yield `NaN` net/gross; line would look broken, not smoothly repriced. |
| Net-anchor taken (`resolved_rule` repricing) | Only if `isGrossAnchorTaxReprice` false — e.g. `is_wheelchair` false or KTS. |
| String `newRate` | Ruled out — `parseFloat` in Select handler. |

---

## E. Fix recommendation (for a follow-up change — not applied here)

1. **`apply-tax-rate-override.ts` (wheelchair gross-anchor branch)** — Anchor on **full-line display gross**, not transport-only `pr.gross`, e.g. derive fixed gross from `lineItemGrossTotalForDisplay(item)` (or equivalent: `(net + approach) × (1 + item.tax_rate)` before rate change) and split back to transport net + approach for `price_resolution` fields. Align with user table (46,88 € fixed at all rates).

2. **Optional: shared helper** — One function for “line gross SSOT” used by both tax override and `lineItemGrossTotalForDisplay` to avoid drift.

3. **Test** — Extend wheelchair test to assert **display gross** (via `lineItemGrossTotalForDisplay(patched)`) stays 46.88, not only `price_resolution.gross`.

4. **No change needed** — `use-invoice-builder.ts` `applyTaxRateOverride`, Step 3 `parseFloat`, or Select wiring for the reported symptom.

---

## F. Question checklist (audit prompt)

| # | Answer |
|---|--------|
| 1 | Condition pasted in §1; includes `item.is_wheelchair === true`. |
| 2 | Hook calls `patchLineItemForTaxRateOverride` only; no post-patch overwrite. |
| 3 | `onApplyTaxRateOverride(item.position, parseFloat(val))`. |
| 4 | `number` at patch boundary; not raw string. |
| 5 | Parameter typed `number`; no conversion inside pure function. |
