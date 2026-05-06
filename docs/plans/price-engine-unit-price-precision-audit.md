# Price engine — unit price × quantity precision audit

Read-only. **Problem:** For `tiered_km` (and similar per-km strategies), `unit_price_net = roundMoneyOnce(totalNet / dist)` and `quantity = dist`, so **`unit_price_net * quantity` can differ from `totalNet`** (`priceResolution.net`). Net-anchored line gross is currently built from **`unit_price × quantity + approach`**, which amplifies the error after VAT.

---

## 1. What is `priceResolution.net` per strategy? (Transport-only vs includes Anfahrt)

**Contract in types** (`PriceResolution`):

```112:126:src/features/invoices/types/pricing.types.ts
  /** Base transport net only — excludes Anfahrtspreis. */
  net: number | null;
  ...
  /**
   * Flat Anfahrtspreis (net) in addition to base transport. Omitted when none applies.
   * Not included in `net` / `gross`. Line total net = `net` + `(approach_fee_net ?? 0)` at persistence.
   */
  approach_fee_net?: number | null;
```

**Implementation:** `withApproachFeeFromRule` only **adds** `approach_fee_net` to the object; it does **not** change `net`. So for any path that goes through `executeStrategy` + `withApproachFeeFromRule`, **`net` is transport-only**.

| `strategy_used` (typical) | Source / notes | `net` semantics | Includes approach? |
|---------------------------|----------------|-----------------|-------------------|
| **`tiered_km`** | `executeStrategy` | `tieredNetTotal(dist, tiers)` — total transport net | **No** — approach on `approach_fee_net` |
| **`fixed_below_threshold_then_km`** | flat or tiered branch | Transport net only | **No** |
| **`time_based`** | inside / outside hours | Scheduled fee as transport net | **No** |
| **`client_price_tag`** (P2) | `resolveTripPrice` early return | `tagGross / (1 + tax)` — negotiated **all-in** gross tag in net form | **No separate approach** — tag is all-in; `approach_fee_net` omitted |
| **`manual_trip_price`** (P0 taxameter) | `manual_gross_price` branch | `gross / (1 + tax)` — **full taxameter** in net terms | **`approach_fee_net: 0`** — meter is all-in; no separate Anfahrt line |
| **`trip_price_fallback`** | P4 or `executeStrategy` fallbacks using stored base | `trip.base_net_price` (transport net) | **No** — approach via rule if any |
| **`manual_trip_price`** (rule strategy) | `executeStrategy` when rule is `manual_trip_price` | `base_net_price` | **No** — approach via `withApproachFeeFromRule` |
| **`kts_override`** | P1 | `0` | **No** |
| **`no_price`** | P5 | `null` | N/A |

**Important nuance — P0 taxameter:** Semantically, **`net` is the entire meter reading in net terms** (all-in, including any Anfahrt that was in the gross meter). The engine sets **`approach_fee_net: 0`** so nothing is added twice. So `net` is **not** “transport-only” in the business sense for P0, but **`net + approach_fee_net` is still the correct decomposition** for the line formula because approach is zero.

**Important nuance — P2 `client_price_tag`:** `net` is all-in for the **tag**; **`insertLineItems` / totals use the gross-anchor path** (see §2), not `unit × qty` for transport.

**Conclusion for Option B:** For every **net-anchored** strategy where **`approach_fee_net` is billed separately**, **`priceResolution.net` is exactly the transport net** that must be grossed with VAT **before** adding grossed approach. For **P0**, **`net` is the full line net** and **`approach_fee_net === 0`**, so using **`net` instead of `unit × qty`** still yields the correct line total. **No strategy stores approach inside `net` while also setting a positive `approach_fee_net`** in a way that would double-count if the line used `net + approach`.

---

## 2. Does `buildLineItemsFromTrips` compute line `total_price`?

**No.** `buildLineItemsFromTrips` only builds **`BuilderLineItem`** fields; it does **not** set `total_price` (that happens at persistence). It **does** stash a private helper on the mapped row:

```561:564:src/features/invoices/api/invoice-line-items.api.ts
      _totalPrice:
        unitPrice !== null && unitPrice !== undefined
          ? Math.round(unitPrice * quantity * 100) / 100
          : null
```

That `_totalPrice` is stripped before `validateLineItems` and is **not** the persisted invoice column.

**Where net-anchored line gross is actually computed:** **`insertLineItems`**, **`calculateInvoiceTotals`**, draft PDF helper, and display helpers.

### Exact lines: persisted `total_price` (`insertLineItems`)

```732:737:src/features/invoices/api/invoice-line-items.api.ts
    const total_price = isGrossAnchorClientPriceTag(frozen)
      ? frozen.gross! * item.quantity +
        (item.approach_fee_net ?? 0) * (1 + item.tax_rate)
      : ((item.unit_price ?? 0) * item.quantity +
          (item.approach_fee_net ?? 0)) *
        (1 + item.tax_rate);
```

- **Gross-anchor** (`client_price_tag` with `gross`): uses **`frozen.gross × quantity`** (+ grossed approach). **Does not** use `unit_price × quantity` for transport.
- **Net-anchor (everything else, including `tiered_km`, P0, P4, KTS):** uses **`(item.unit_price × item.quantity + approach_fee_net) × (1 + tax_rate)`** — this is where **`unit × qty ≠ price_resolution.net`** bites.

### Exact lines: `calculateInvoiceTotals` net-anchor bucket

```656:664:src/features/invoices/api/invoice-line-items.api.ts
    } else {
      // Net-anchor path (all strategies except client_price_tag):
      const baseNet =
        item.unit_price !== null ? item.unit_price * item.quantity : 0;
      const lineTotal = baseNet + approach;
      nonTagSubtotal += lineTotal;
```

Same structural bug for **subtotal / tax buckets** as for **`insertLineItems`**.

### Draft PDF mirror

```55:57:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
  const total_price = isGrossAnchorClientPriceTag(frozen)
    ? frozen.gross! * q + approach * (1 + item.tax_rate)
    : Math.round((u * q + approach) * (1 + item.tax_rate) * 100) / 100;
```

### Display: Bruttopreis column

```40:46:src/features/invoices/lib/line-item-net-display.ts
  const q = item.quantity;
  const approach = item.approach_fee_net ?? 0;
  // why: same formula as builder PDF draft — `price_resolution.gross` omits Anfahrt gross.
  return (
    Math.round((item.unit_price * q + approach) * (1 + item.tax_rate) * 100) /
    100
  );
```

**Contrast — line net display already prefers `price_resolution.net` for `quantity > 1`:**

```15:21:src/features/invoices/lib/line-item-net-display.ts
  if (item.quantity > 1) {
    const n = item.price_resolution.net;
    if (n !== null && n !== undefined) {
      return Math.round(n * 100) / 100;
    }
    return Math.round(item.unit_price * item.quantity * 100) / 100;
  }
```

So the UI **already acknowledges** that **`unit_price × quantity`** is not authoritative for line net when **`net`** is present.

---

## 3. Is Option B safe?

**Option B (proposed):** For **net-anchored** line totals, use **`priceResolution.net`** (transport net, or full net when approach is 0) **instead of** `unit_price_net × quantity` when computing **`(transportNet + approach_fee_net) × (1 + tax_rate)`**.

**Given the code:**

- **`net` never includes `approach_fee_net`** for strategies that also set `approach_fee_net` (approach is always additive in persistence math).
- **P0** sets **`approach_fee_net: 0`**; **`net`** is the full meter net — replacing `unit × qty` with **`net`** is equivalent when **`quantity === 1`** and **`unit_price_net === net`** (as P0 sets), and avoids hypothetical drift if those ever diverged.
- **P2 `client_price_tag`** uses the **gross-anchor** branch — Option B does **not** replace that path.
- **`kts_override`:** `net === 0`, `quantity === 1` — safe.

**Caveat — use the frozen resolution, not a stale `unit_price`:**  
`frozenPriceResolutionForInsert` calls **`applyManualUnitNetToResolution`** when the user edits **`unit_price`** in Step 3; that function **recomputes `net` as `round(unitNet × qty)`**:

```236:249:src/features/invoices/api/invoice-line-items.api.ts
  const netTotal = Math.round(unitNet * qty * 100) / 100;
  ...
  return {
    ...item.price_resolution,
    unit_price_net: unitNet,
    net: netTotal,
```

So **`frozen.net`** stays **consistent with intentional manual edits**. Option B should use **`frozen`’s** `net` (after `frozenPriceResolutionForInsert`) in **`insertLineItems`**, not only the pre-edit `price_resolution`.

**Risk if someone only changed `item.unit_price` without going through `frozenPriceResolutionForInsert`:** Low — insert already uses **`frozen`** for anchor detection; aligning transport net with **`frozen.net`** is stricter, not looser.

**Verdict:** **Option B is safe** for all net-anchored strategies **if** implementation uses **`frozen.net`** (with fallback to `unit × qty` when `net` is `null`, e.g. unresolved `no_price`).

---

## 4. Is Option A necessary?

**Option A** would add e.g. `net_total_override` on `PriceResolution`.

**Assessment:** **`net` already is** the authoritative rounded transport total from **`tieredNetTotal`** (and analogous paths). Adding a parallel field would **duplicate** `net` for the tiered-km case and increase schema / snapshot surface without clarifying semantics.

Option A is **only** attractive if you explicitly want to keep **`net`** meaning something different from “line transport net for billing” — the current type comment and **`trip-price-engine`** already treat **`resolution.net`** as that transport total.

**Opinion:** **Option A is not necessary** if Option B uses **`PriceResolution.net`** (and keeps **`applyManualUnitNetToResolution`** / **`applyGrossOverrideToResolution`** as the writers that keep **`net`** in sync).

---

## 5. Senior recommendation

**Ship Option B** (no new field):

1. **Single source of transport net:** For net-anchored lines, treat **`frozen.net`** (from `frozenPriceResolutionForInsert`) as the transport net to gross up, then add **`approach_fee_net`** and apply **`× (1 + tax_rate)`** with your existing rounding policy — **do not** reconstruct transport net from **`unit_price × quantity`** when **`frozen.net != null`**.
2. **Apply consistently** in **`insertLineItems`**, **`calculateInvoiceTotals`**, **`build-draft-invoice-detail-for-pdf.ts`**, and **`lineItemGrossTotalForDisplay`** so persisted totals, header totals, PDF preview, and column display agree.
3. **Align comments** in `resolve-trip-price.ts` that still describe **`insertLineItems`** as relying on **`unit × qty`** once this is fixed.

**Why not Option A:** Redundant with **`net`**; more migration and mental overhead.

**Optional follow-up (outside this audit):** **`invoice-pdf-line-amounts.ts`** `lineNetEurForPdfLineItem` uses **`unit_price × quantity`**; **`lineGrossEurForPdfLineItem`** prefers stored **`total_price`**. After fixing inserts, new rows are consistent; old rows may still have **`total_price`** that reflected the old formula — whether to backfill or read **`price_resolution_snapshot.net`** for net is a product decision.

**Trip table snapshot:** **`trip-price-engine.ts`** already uses **`resolution.net + approach`** for **`gross_price`** — it does **not** use **`unit × qty`**. The bug is **localized to invoice line assembly / totals / display**, not the trip repricing path.

---

## 6. Other call sites: `unit_price_net × quantity` for money totals

| Location | What it does |
|----------|----------------|
| **`invoice-line-items.api.ts`** — `insertLineItems` | **Persisted `total_price`** (net-anchor branch) — **needs Option B** |
| **`invoice-line-items.api.ts`** — `calculateInvoiceTotals` | **Header subtotal / tax buckets** — **needs Option B** |
| **`invoice-line-items.api.ts`** — `buildLineItemsFromTrips` | `_totalPrice` helper only (discarded) — low impact but inconsistent |
| **`build-draft-invoice-detail-for-pdf.ts`** | Draft line **`total_price`** — **needs Option B** |
| **`line-item-net-display.ts`** — `lineItemGrossTotalForDisplay` | **Bruttopreis** column — **needs Option B** (net column already uses `net` when `qty > 1`) |
| **`invoice-pdf-line-amounts.ts`** — `lineNetEurForPdfLineItem` | PDF helpers use **`unit × qty + approach`**; gross prefers **`total_price`** |
| **`price-calculator.ts`** — legacy `PriceResult.totalPrice` | `Math.round(unit * qty * 100) / 100` — **same rounding issue** for per-km trips |
| **`use-invoice-builder.ts`** | Re-runs **`resolveTripPricePure`** on KM change; updates **`unit_price`** / **`quantity`** from resolution — does not multiply for persisted total (insert does) |

**Import graph:** **`price-calculator.ts`** is not imported elsewhere under **`src/`** (only docs reference it). It is still a **footgun** if reused.

**Tests to update:** `src/features/invoices/api/__tests__/calculate-invoice-totals.test.ts` (uses `unit_price * quantity` in mocks — should assert parity with **`price_resolution.net`** where relevant); `line-item-net-display` tests.

---

## Summary table

| Question | Answer |
|----------|--------|
| Is `net` transport-only where approach applies? | **Yes** (and P0 / P2 are special-cased: P0 has approach 0; P2 is gross-anchor path). |
| Does `buildLineItemsFromTrips` set `total_price`? | **No** — see **`insertLineItems`** / **`calculateInvoiceTotals`** / PDF helpers. |
| Option B safe? | **Yes**, using **`frozen.net`** with null fallback. |
| Option A needed? | **No** — **`net` is already the right field.** |
| Recommendation | **Option B** everywhere net-anchor totals are derived from **`unit × qty`**. |
