# Left panel “Netto (Fahrt)” source audit (read-only)

Scope: where Step 3 (“Positionen”) left panel gets the value shown next to **Netto (Fahrt)**, and what `buildLineItemsFromTrips` puts on `BuilderLineItem` for net transport. No code changes.

---

## 1. Component and exact formula

The only UI string **“Netto (Fahrt)”** in the invoice builder Step 3 lives in:

`src/features/invoices/components/invoice-builder/step-3-line-items.tsx`

It appears inside the **expanded** row breakdown (collapsible left panel), when the row is expanded (`expanded === true`). The value rendered is **`transportNet`**, not a raw field from `BuilderLineItem`:

```847:850:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                              const transportNet =
                                (g - approachGross) / (1 + rate);
                              const approachNet = approachGross / (1 + rate);
                              const totalNet = transportNet + approachNet;
```

Where (same block, lines 830–841):

- **`g`** — line gross: when not editing, `lineItemGrossTotalForDisplay(item) ?? 0` (or parsed from the gross input while editing).
- **`approachGross`** — `item.approach_fee_gross ?? 0` (or parsed while editing).
- **`rate`** — `item.tax_rate`.

So **“Netto (Fahrt)” does not read `unit_price`, `trips.base_net_price`, `price_resolution_snapshot`, or `price_resolution.net` directly.** It is **algebraically back-derived** from:

```text
Netto (Fahrt) = ( Bruttozeile − Anfahrt brutto ) / (1 + MwSt-Satz)
```

with **`Bruttozeile`** coming from `lineItemGrossTotalForDisplay` in `src/features/invoices/lib/line-item-net-display.ts`.

---

## 2. What `buildLineItemsFromTrips` puts on `BuilderLineItem` (relevant to net transport display)

`src/features/invoices/api/invoice-line-items.api.ts` — `buildLineItemsFromTrips` (lines 450–582):

| Field | Source | Role for UI |
|-------|--------|-------------|
| `unit_price` | `priceResolution.unit_price_net` from `resolveTripPricePure` | **Per-km (or per-unit) display net**, e.g. `2.07` for tiered km — **not** the full transport line net (41.55). |
| `quantity` | `priceResolution.quantity` | For tiered km, equals billed km (e.g. `20.1`). |
| `price_resolution` | Full `PriceResolution` object returned by `resolveTripPricePure` | Holds **`net`** = authoritative transport-only net from the resolver (e.g. `tieredNetTotal`), **`unit_price_net`**, **`approach_fee_net`**, strategy, etc. |
| `approach_fee_net` | `priceResolution.approach_fee_net ?? null` | Net approach. |
| `approach_fee_gross` | `Math.round(approach_fee_net * (1 + taxRate) * 100) / 100` | **Brutto** approach shown in the breakdown denominator. |
| `_totalPrice` | Rounded line net `transport + approach` (discarded before `validateLineItems`) | Not used by Step 3 UI. |

**`trips.base_net_price`** is only passed **into** `resolveTripPricePure` as part of the trip payload; it is **not** copied onto `BuilderLineItem` as a top-level field. Whatever appears in the UI flows from **`price_resolution`** and the gross helpers, not from `base_net_price` on the row.

---

## 3. `price_resolution_snapshot.net` on `BuilderLineItem`?

**No.** `BuilderLineItem` carries an in-memory **`price_resolution: PriceResolution`** (see `src/features/invoices/types/invoice.types.ts`). The JSONB field **`price_resolution_snapshot`** exists on **`InvoiceLineItemRow`** (persisted rows after `insertLineItems`), not on the builder type.

For a freshly built line from trips, the **equivalent** of “snapshot net” is:

```text
item.price_resolution.net
```

Populated from the same resolver output assigned in `buildLineItemsFromTrips` at `price_resolution: priceResolution`.

---

## 4. Tiered 20.1 km example: 41.54 vs 41.55?

Assume resolver output as in the Bienert-style case: **`price_resolution.net = 41.55`**, **`unit_price_net = 2.07`**, **`quantity = 20.1`**, **`approach_fee_net = 3.80`**, **`tax_rate = 0.07`**.

### 4a. Authoritative transport net on the builder

**`item.price_resolution.net` = `41.55`** (unchanged by the `insertLineItems` fix — that function persists to DB; the builder still holds the resolver object).

### 4b. What feeds the left-panel formula

`lineItemGrossTotalForDisplay` (net-anchor path) uses transport net from **`price_resolution.net`** when set, then **rounds the full line gross to cents**:

```42:52:src/features/invoices/lib/line-item-net-display.ts
  const transportNet =
    item.price_resolution.net !== null &&
    item.price_resolution.net !== undefined
      ? item.price_resolution.net
      : item.unit_price * q;
  return (
    Math.round((transportNet + approach) * (1 + item.tax_rate) * 100) / 100
  );
```

So:

```text
ungrossed line = (41.55 + 3.80) × 1.07 = 48.5245
g = round(48.5245 × 100) / 100 = 48.52
```

`insertLineItems` (net-anchor) writes **`(frozen.net + approach) × (1 + tax)`** as an unrounded float, then Postgres **`NUMERIC(10,2)`** stores **48.52** — the Step 3 gross helper matches that cent rounding for display.

**Approach brutto** on the builder:

```text
approach_fee_gross = round(3.80 × 1.07 × 100) / 100 = round(406.6) / 100 = 4.07
```

### 4c. Left panel “Netto (Fahrt)”

```text
transportNet = (g − approachGross) / (1 + rate)
             = (48.52 − 4.07) / 1.07
             = 44.45 / 1.07
             = 41.542056…
```

So the breakdown line shows **about `41.54` €** when formatted to cents — **not** `41.55` €. The one-cent drift is because **`g` is already cent-rounded** before the division strips VAT and approach; the panel does not read `price_resolution.net` for this label.

**`unit_price` alone** is `2.07` (per km); **`2.07 × 20.1 = 41.607`**, which is also **not** what “Netto (Fahrt)” shows — the panel never uses that product for this row.

---

## 5. Direct answers (prompt checklist)

| Question | Answer |
|----------|--------|
| What exact field does the left panel read for “Netto (Fahrt)”? | **None directly.** It computes `(lineItemGrossTotalForDisplay(item) − approach_fee_gross) / (1 + tax_rate)`. `lineItemGrossTotalForDisplay` **internally** uses `price_resolution.net` for transport when building **`g`**, but the displayed “Netto (Fahrt)” is **not** `price_resolution.net` — it is **back-derived from rounded line gross minus rounded approach gross**. |
| Value for 20.1 km tiered after `insertLineItems` fix? | **`price_resolution.net` remains `41.55`.** The **left-panel “Netto (Fahrt)”** tracks **`~41.54`** (`41.542056…`) because **`g`** is cent-rounded **`48.52`**. `insertLineItems` does not change Step 3 in-session objects. |
| Is `price_resolution_snapshot.net` on `BuilderLineItem`? | **No** — use **`price_resolution.net`**. Snapshot is for persisted `InvoiceLineItemRow` after insert. |

---

## 6. Note for product / a future fix

If “Netto (Fahrt)” should always match the resolver’s transport net (`41.55`), the breakdown should **read `item.price_resolution.net` when present** (same authority as `lineItemNetAmountForDisplay` for `quantity > 1` and as `lineItemGrossTotalForDisplay`’s transport input), instead of reverse-engineering from **`g`** after cent rounding. Today the formula is **arithmetically consistent with the displayed brutto cell** (`g`), but **not** identical to **`price_resolution.net`** when `g` was rounded from a fractional-cent gross.
