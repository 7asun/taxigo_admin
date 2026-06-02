# Repricing Branch + Gross Anchor Audit

**Status:** Implemented (Step 3 tax override + combined gross write-back, 2026-06).

Read-only audit of **price anchors** (`gross` vs `net` in `PriceResolution`) and **what lands on `trips.gross_price`** after invoice write-back vs what Step 3 / invoices show as Bruttobetrag.

Canonical resolver: `src/features/invoices/lib/resolve-trip-price.ts`  
Display helper: `src/features/invoices/lib/line-item-net-display.ts` → `lineItemGrossTotalForDisplay`  
Trip stamp: `src/features/trips/lib/trip-price-engine.ts` → `computeTripPrice`

---

## A. Price source → repricing branch map

### Contract (from code comments + types)

| Field | Meaning |
|-------|---------|
| `price_resolution.net` | **Transport net only** — excludes Anfahrt (`pricing.types.ts` L117–118; `resolve-trip-price.ts` L75–79) |
| `price_resolution.gross` | **Varies by priority** — see table below |
| `approach_fee_net` | Separate net Anfahrt; grossed up at line/invoice level, **not** in `gross` for P3 catalog rules |
| `lineItemGrossTotalForDisplay` | **Combined line Brutto** = `(transportNet + approach_fee_net) × (1 + tax_rate)` unless `manualGrossTotal` (`line-item-net-display.ts` L28–55) |
| `lineItemToInsertRow` `total_price` | Same combined formula for net-anchor lines (L896–901); client tag uses `gross × qty + approach × (1+rate)` (L891–894) |

There is **no** `price_resolution.source` value `billing_rule`. Catalog hits use **`payer` | `billing_type` | `variant`** (`ruleScopeSource`, L101–105).

---

### Question 1 — Every `price_resolution.source` from `buildLineItemsFromTrips`

All rows come from `resolveTripPricePure` in `buildLineItemsFromTrips` (`invoice-line-items.api.ts` L609–621). Possible **`source`** values (`pricing.types.ts` L21–29):

| `source` | How it is produced | Price anchor | Where anchor is set | Tax-rate-only change: gross fixed or net fixed? | Model hook branch |
|----------|-------------------|--------------|---------------------|-----------------------------------------------|-------------------|
| **`manual_gross_price`** | P0: `trip.manual_gross_price` → `gross = manual_gross_price`, `net = gross / (1 + taxRate)`, `approach_fee_net: 0` | **Gross (all-in)** | `resolve-trip-price.ts` L416–436 | **Gross fixed**, net floats: `net = gross / (1 + newRate)` | **Taxameter** (`applyKmOverride` L414–430) — but see §2: that branch today only updates `tax_rate`, not `net` |
| **`kts_override`** | P1: `gross: 0`, `net: 0` | N/A (€0) | L439–450 | Rate change irrelevant for amounts | Neither — no repricing |
| **`client_price_tag`** | P2: `gross = tagGross` (contract gross), `net = tagGross / (1 + taxRate)`, no Anfahrt on resolution | **Gross (all-in transport)** | L468–478 | **Gross fixed**, net floats | **Dedicated gross-anchor** (do **not** call `resolveTripPricePure` on km — same as tag semantics in `calculateInvoiceTotals`) |
| **`payer`** | P3: `executeStrategy` + `withApproachFeeFromRule`; `gross` from `grossFromNet(transportNet)` unless strategy sets explicit gross (e.g. time_based €0) | **Net (transport)** | `resolution()` L197–220; strategies L301–400 | **Net fixed** (transport + approach net), **gross floats**: re-run `resolveTripPricePure` or recompute `(net + approach) × (1 + rate)` | **Normal** path (L433–467) |
| **`billing_type`** | Same as `payer` | **Net (transport)** | Same | Same | **Normal** |
| **`variant`** | Same as `payer` | **Net (transport)** | Same | Same | **Normal** |
| **`trip_price`** | P4 `base_net_price` fallback **or** misnamed `client_price_tag` strategy without tag (`executeStrategy` L251–264) | **Net (transport)** | P4: L509–523; fallback: L254–262 | **Net fixed**, gross floats | **Normal** |
| **`unresolved`** | P5: `net`/`gross` null, may still have `approach_fee_net` from rule | Unpriced | L527–538 | N/A until priced | N/A |

**`strategy_used`** (tiered_km, manual_trip_price, etc.) is separate from **`source`**; repricing branch should follow **anchor (gross vs net)**, not strategy name.

**After Step 3 gross override** (`applyGrossOverrideToResolution`, L549–575): `gross` = **combined** `grossTotal` (transport + Anfahrt brutto in one number); `net` = transport net only. Treat as **gross-anchor** for tax-rate changes (split transport/approach like override math), even if `source` is still `manual_gross_price` or catalog scope.

---

### Question 2 — `manual_gross_price` (Taxameter) specifically

**Is `price_resolution.gross` final Brutto including Anfahrt?**  
**Yes.** P0 comment and implementation: meter reading is **all-in**; `approach_fee_net: 0` (L415–416, L435).

**When KM is overridden on a taxameter line (`applyKmOverride` taxameter branch, L414–430):**

| Field | Changes? |
|-------|----------|
| `price_resolution.gross` | **No** — not repriced |
| `price_resolution.net` | **No** — not recalculated from new rate |
| `tax_rate` | **Yes** — `newTaxRate` from `resolveTaxRate(km)` |
| `approach_fee_net` | Stays **0** (taxameter) |
| `approach_fee_gross` | `round(approachNet × (1 + newTaxRate))` — with `approachNet` typically **0**, stays **null/0** (L421–424) |

So on taxameter + KM override, **only the rate field changes** in resolution; gross/net amounts in the snapshot are stale until the user edits Brutto or you add explicit `net = gross / (1 + rate)` on tax-rate change.

**Display note:** `lineItemGrossTotalForDisplay` does **not** use `price_resolution.gross` for non-override lines; it uses `(price_resolution.net + approach) × (1 + tax_rate)` (L45–54). If `net` is stale after taxameter KM path, the **Bruttopreis column can drift** from the true all-in gross until `manualGrossTotal` is set.

---

### Question 3 — Rule-based / client tag / trip price

**`client_price_tag`:**  
- `gross` = negotiated **all-in** gross (tag); **no** `approach_fee_net` on resolution (P2, L453–478).  
- Not the same as catalog tiered lines.

**`payer` / `billing_type` / `variant` (catalog rules):**  
- `price_resolution.gross` = **`grossFromNet(transportNet, taxRate)`** only — **transport brutto**, excludes Anfahrt (`resolve-trip-price.ts` L197–220, L75–79).  
- `approach_fee_net` attached separately via `withApproachFeeFromRule` (L126–133, L498–501).

**Relationship for net-anchor lines (invoice line, display, insert):**

```
line Brutto (display / invoice_line_items.total_price)
  = (price_resolution.net + (approach_fee_net ?? 0)) × (1 + tax_rate)
```

**Not** stored as a single `gross` on the resolution for catalog rules.  
`computeTripPrice` on the **trip row** uses the **same combined formula** for `trips.gross_price` (see §B).

**`trip_price` (P4):** Same as catalog net-anchor: transport `net` in resolution + optional `approach_fee_net`.

---

## B. Write-back gross: trip row vs invoice line

### Question 4 — What `computeTripPrice` stores in `trips.gross_price`

**Combined gross (transport + Anfahrt), not transport-only.**

```263:275:src/features/trips/lib/trip-price-engine.ts
  const baseNetPrice = resolution.net;
  const approachFeeNet = resolution.approach_fee_net ?? 0;
  const totalGross =
    baseNetPrice !== null
      ? Math.round((baseNetPrice + approachFeeNet) * (1 + taxRate) * 100) / 100
      : null;

  return {
    gross_price: totalGross,
    tax_rate: baseNetPrice !== null ? taxRate : null,
    base_net_price: baseNetPrice,
    approach_fee_net: approachFeeNet
  };
```

Also documented in-file L257–262: P0 taxameter puts full lump in `resolution.net` with `approach_fee_net = 0`, so `(base + approach) × (1+r)` still equals all-in gross.

`shouldRecalculatePrice` / `resolveTripForPricing`: write-back fields (`tax_rate`, `gross_price`, `base_net_price`, `approach_fee_net`, `manual_gross_price`, `manual_distance_km`) are **not** in `PRICING_RELEVANT_FIELDS` — patch values are persisted **without** re-running this formula.

---

### Question 5 — Write-back block vs `price_resolution.gross`

```857:868:src/features/invoices/hooks/use-invoice-builder.ts
            return tripsService.updateTrip(item.trip_id!, {
              gross_price: item.manualGrossTotal ?? item.price_resolution.gross,
              tax_rate: item.tax_rate,
              base_net_price: baseNet,
              approach_fee_net: approachNet,
              ...(item.isManualOverride && item.manualGrossTotal !== null
                ? { manual_gross_price: item.manualGrossTotal }
                : {}),
              ...(item.isManualKmOverride && item.manualDistanceKm != null
                ? { manual_distance_km: item.manualDistanceKm }
                : {})
            });
```

Where `baseNet = item.price_resolution.net`, `approachNet = item.approach_fee_net ?? 0`.

| Write-back field | Typical content |
|------------------|-----------------|
| `gross_price` | `manualGrossTotal` **or** `price_resolution.gross` |
| `base_net_price` | Transport net (`price_resolution.net`) |
| `approach_fee_net` | Separate Anfahrt net |

**Is `price_resolution.gross` transport-only or combined?**

| Line type | `price_resolution.gross` |
|-----------|---------------------------|
| Catalog (`payer` / `billing_type` / `variant` / `trip_price` net path) | **Transport-only** (`grossFromNet`) |
| `client_price_tag` | **All-in transport gross** (no separate Anfahrt) |
| `manual_gross_price` | **All-in** (taxameter) |
| After `applyGrossOverride` | **Combined** (`gross: grossTotal`, L569) |

**Combined Brutto for Step 3 / invoice** — `lineItemGrossTotalForDisplay` (`line-item-net-display.ts` L34–55):

```typescript
// Simplified
manualGrossTotal ?? round((transportNet + approach_fee_net) * (1 + tax_rate))
// transportNet = price_resolution.net ?? unit_price * quantity
```

**Insert row** uses the same combined logic (`lineItemToInsertRow` L896–901).

**Mismatch vs `computeTripPrice`:**

| Path | `trips.gross_price` after stamp / correct write-back | Current write-back `gross_price` |
|------|------------------------------------------------------|----------------------------------|
| Rule line **with** `approach_fee_net > 0`, no manual override | `(net + approach) × (1 + rate)` | **`price_resolution.gross`** = transport brutto only → **under-stated** |
| Rule line, no approach | `net × (1 + rate)` | May match `price_resolution.gross` |
| `manualGrossTotal` / taxameter override | Full line brutto | **`manualGrossTotal`** → correct |
| `client_price_tag` | Tag gross (+ 0 approach) | **`price_resolution.gross`** → usually correct |
| Taxameter DB, no builder override | All-in | **`price_resolution.gross`** all-in → correct |

Hook comment L847–848 correctly says resolution net is transport-only and Anfahrt is separate — but **`gross_price` assignment ignores that** and uses transport `gross` anyway.

---

### Question 6 — Trip detail sheet vs invoice Bruttobetrag

Trip detail shows **`trip.gross_price`** on the badge (`trip-detail-sheet.tsx` L1318–1327), with breakdown in `TripPriceTooltip` (`base_net_price`, `approach_fee_net`, generated `net_price`, `tax_rate`, **`gross_price`**).

| Scenario | Invoice line Brutto | `trip.gross_price` after write-back | Match? |
|----------|---------------------|-------------------------------------|--------|
| Tiered km + Anfahrt, engine-priced | `lineItemGrossTotalForDisplay` = combined | Transport-only `price_resolution.gross` | **No** — trip badge **lower** by ≈ `approach_fee_net × (1 + rate)` |
| Same trip after `computeTripPrice` only (no invoice) | N/A | Combined `(base + approach) × (1+r)` | Trip row internally consistent |
| User `manualGrossTotal` | Full line | `manualGrossTotal` | **Yes** |
| Taxameter (`manual_gross_price`) | Display uses stale `net` formula unless override; DB gross all-in | `price_resolution.gross` all-in if no override | **Often yes** for write-back; **display** can still drift on KM+rate-only edits |
| `client_price_tag` | Tag gross | Tag in `price_resolution.gross` | **Yes** (no approach) |

Tooltip **Brutto** line uses `grossPrice` prop (= `trip.gross_price`). **MwSt** in tooltip uses `net_price × tax_rate` (generated combined net). If `gross_price` is transport-only but `net_price` includes approach, tooltip **net + tax ≠ displayed brutto** — inconsistent breakdown.

---

## C. Gap assessment

**Yes — a systematic mismatch exists** for the common case:

**Net-anchor catalog lines with `approach_fee_net > 0`**, saved through the invoice builder **without** `manualGrossTotal`.

- **Invoice / Step 3 Bruttobetrag:** `(transportNet + approachNet) × (1 + tax_rate)`  
- **Write-back `gross_price`:** `price_resolution.gross` ≈ `transportNet × (1 + tax_rate)` only  
- **`computeTripPrice` on trips:** combined gross (correct total)

**Practical size:**  
Δ ≈ **`approach_fee_net × (1 + tax_rate)`** (rounded to cents).  
Example: Anfahrt net €3.80, 7% → invoice line +€4.07 brutto; write-back `gross_price` misses that €4.07 on the trip badge.

**When mismatch is absent or small:**

- No approach fee on rule  
- `client_price_tag` / taxameter all-in gross  
- `isManualOverride` → `manualGrossTotal` drives write-back  
- KTS €0 lines (immaterial)

**Secondary issue (taxameter + KM/rate edit):** Taxameter `applyKmOverride` updates `tax_rate` but not `net`/`gross` in resolution; `lineItemGrossTotalForDisplay` can show wrong Brutto vs fixed meter gross.

**Fix direction (write-back):** Set

```typescript
gross_price: lineItemGrossTotalForDisplay(item) ?? item.manualGrossTotal ?? item.price_resolution.gross
```

(or equivalent `(item.price_resolution.net! + (item.approach_fee_net ?? 0)) * (1 + item.tax_rate)` rounded), and keep `base_net_price` / `approach_fee_net` as today. Aligns trip row with `computeTripPrice` and invoice line.

---

## D. Senior recommendation

### `applyTaxRateOverride` — branch per anchor (not per `source` string)

| Anchor class | Sources / condition | Behavior |
|--------------|---------------------|----------|
| **Gross-anchor** | `manual_gross_price`; `client_price_tag`; `isManualOverride` / `manualGrossTotal`; post-`applyGrossOverride` (combined `resolution.gross`) | Keep **transport (+ approach) gross** fixed; set `tax_rate`; recompute **`net = gross / (1+r)`** per component (use `applyGrossOverrideToResolution` split if combined gross and separate approach gross known). **Do not** call full `resolveTripPricePure` on km. Model: taxameter path **plus** mandatory net refresh. |
| **Net-anchor** | `payer`, `billing_type`, `variant`, `trip_price` with priced `resolution.net` | **Normal** path: `resolveTripPricePure(tripInput, newRate, resolved_rule)` with same `effective_distance_km`; refresh `unit_price`, `approach_fee_net`, `approach_fee_gross`, `price_resolution`. Gross floats: `(net + approach) × (1+r)`. |
| **€0** | `kts_override` | Update `tax_rate` only. |
| **Unpriced** | `unresolved` / null net | No-op or warn. |

**Do not** use taxameter KM branch as-is for tax-only changes — it leaves **`net` stale**; use taxameter **intent** (fixed gross) with explicit net recalculation.

### Write-back gross — fix required

**Yes.** Replace:

```typescript
gross_price: item.manualGrossTotal ?? item.price_resolution.gross
```

with the **same combined anchor as display/insert**, e.g. `lineItemGrossTotalForDisplay(item)` (guard nulls), with fallback chain:

1. `manualGrossTotal` (session override)  
2. Combined formula from `net` + `approach_fee_net` + `tax_rate`  
3. `price_resolution.gross` only when it is known all-in (`manual_gross_price`, `client_price_tag`)

Keep writing **`base_net_price`** and **`approach_fee_net`** separately so `trips.net_price` (generated) and `TripPriceTooltip` stay coherent with **`gross_price`**.

Optional: after write-back, spot-check `trip.gross_price ≈ lineItemGrossTotalForDisplay` in tests for tiered_km + approach fixture.

### Order of work

1. Fix write-back gross anchor (low risk, high value for trip detail vs invoice).  
2. Implement `applyTaxRateOverride` with gross vs net table above.  
3. Fix taxameter KM/rate path to refresh `net` when gross is fixed (display + future tax override).

---

## File reference

| File | Relevant sections |
|------|-------------------|
| `resolve-trip-price.ts` | P0–P5 cascade, `resolution()`, `applyGrossOverrideToResolution` |
| `trip-price-engine.ts` | `computeTripPrice` L263–275, `shouldRecalculatePrice` |
| `use-invoice-builder.ts` | `applyKmOverride` L404–469, write-back L851–869 / L963–981 |
| `invoice-line-items.api.ts` | `buildLineItemsFromTrips` L651–704, `lineItemToInsertRow` L885–902 |
| `line-item-net-display.ts` | `lineItemGrossTotalForDisplay` |
| `price-calculator.ts` | Thin adapter — no anchor logic |
