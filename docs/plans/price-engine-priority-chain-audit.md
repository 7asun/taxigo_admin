# Price engine — priority chain audit (`resolveTripPrice` / `resolveTripPricePure`)

Read-only. **`resolveTripPricePure` is the same function as `resolveTripPrice`** (import alias only; see `invoice-line-items.api.ts`, `price-calculator.ts`, `use-invoice-builder.ts`).

Source: `src/features/invoices/lib/resolve-trip-price.ts`.

The file header documents **P0–P5** (P5 = unresolved). Below, **P0–P4** match the user question; **P5** is included because it is the terminal branch.

---

## 1. Full priority chain — every branch in order

All branches are in **`resolveTripPrice`** (`lines 411–523`). **`trip.net_price` is never read** anywhere in this function (only declared on `TripPriceInput` as deprecated; see §4).

### P0 — Taxameter (`manual_gross_price`)

**Condition:**

```418:421:src/features/invoices/lib/resolve-trip-price.ts
  if (
    trip.manual_gross_price != null &&
    trip.manual_gross_price !== undefined
  ) {
```

**Returns:** A `PriceResolution` built from `resolution(...)` with `gross: trip.manual_gross_price`, `net: gross / (1 + taxRate)`, `strategy_used: 'manual_trip_price'`, `source: 'manual_gross_price'`, `unit_price_net: net`, `quantity: 1`, `note: 'Taxameter-Preis (Admin erfasst)'`, and **`approach_fee_net: 0`** (spread after `resolution` — Anfahrt already in gross).

```422:438:src/features/invoices/lib/resolve-trip-price.ts
    const gross = trip.manual_gross_price;
    const net = gross / (1 + taxRate);
    return {
      ...resolution(
        {
          net,
          gross,
          strategy_used: 'manual_trip_price',
          source: 'manual_gross_price',
          unit_price_net: net,
          quantity: 1,
          note: 'Taxameter-Preis (Admin erfasst)'
        },
        taxRate
      ),
      approach_fee_net: 0
    };
  }
```

---

### P1 — KTS (`kts_document_applies`)

**Condition:**

```441:442:src/features/invoices/lib/resolve-trip-price.ts
  // P1 — KTS hard override (no Anfahrtspreis on resolution)
  if (trip.kts_document_applies === true) {
```

**Returns:** Fixed zero line; **`approach_fee_net` not set** (omitted; callers treat as none).

```442:452:src/features/invoices/lib/resolve-trip-price.ts
    return {
      gross: 0,
      net: 0,
      tax_rate: taxRate,
      strategy_used: 'kts_override',
      source: 'kts_override',
      note: 'Abgerechnet über KTS — kein Rechnungsbetrag',
      unit_price_net: 0,
      quantity: 1
    };
  }
```

---

### P2 — Client price tag (gross)

**Condition:** After computing `tagGross` from `rule._price_gross` (when `rule.strategy === 'client_price_tag'`) or legacy `trip.client?.price_tag`:

```457:470:src/features/invoices/lib/resolve-trip-price.ts
  const syntheticGross =
    rule?.strategy === 'client_price_tag' &&
    typeof rule._price_gross === 'number' &&
    !Number.isNaN(rule._price_gross)
      ? rule._price_gross
      : null;
  const legacyTag = trip.client?.price_tag;
  const tagGross =
    syntheticGross !== null && syntheticGross > 0
      ? syntheticGross
      : legacyTag !== null && legacyTag !== undefined
        ? legacyTag
        : null;
  if (tagGross !== null && tagGross !== undefined) {
```

**Returns:** Tag as gross anchor; **no rule approach fee** (all-in negotiated gross). **`approach_fee_net` not set.**

```470:480:src/features/invoices/lib/resolve-trip-price.ts
    const net = tagGross / (1 + taxRate);
    return {
      gross: tagGross,
      net,
      tax_rate: taxRate,
      strategy_used: 'client_price_tag',
      source: 'client_price_tag',
      unit_price_net: net,
      quantity: 1
    };
  }
```

**Note:** `base_net_price` and `net_price` are **not** consulted at P2.

---

### P3 — Active billing rule (`executeStrategy`)

**Condition:**

```483:488:src/features/invoices/lib/resolve-trip-price.ts
  // P3 — catalog rule strategies (skipped when price_tag already won at P2).
  if (rule && rule.is_active) {
    const strategyResult = executeStrategy(rule, rule.strategy, trip, taxRate);
    if (strategyResult) {
      return withApproachFeeFromRule(strategyResult, rule);
    }
  }
```

**Returns:** Whatever **`executeStrategy`** returns, wrapped in **`withApproachFeeFromRule(strategyResult, rule)`**, which may set **`approach_fee_net`** from **`rule.config`** (`extractApproachFeeNet`), unless P0/P2-style paths inside strategies forbid it (see below).

**`executeStrategy` sub-branches that read `base_net_price` (still under P3, not P4):**

| `rule.strategy` | Condition | Returns (before `withApproachFeeFromRule`) |
|-------------------|-----------|--------------------------------------------|
| `client_price_tag` | `trip.base_net_price != null` | `resolution` with `net` / `unit_price_net` = `base_net_price`, `strategy_used: 'trip_price_fallback'`, `source: 'trip_price'` |
| `client_km_override` | `trip.base_net_price != null` | Same shape as above |
| `manual_trip_price` | `trip.base_net_price == null` → `null`; else | `net` / `unit_price_net` = `base_net_price`, `strategy_used: 'manual_trip_price'` |
| `tiered_km` | `dist === null \|\| undefined` → `null`; else | `tieredNetTotal(dist, tiers)` as `net`, `unit_price_net = round(total/dist)`, `quantity = dist` |
| `fixed_below_threshold_then_km` | needs `dist`; below/above threshold branches | flat or tiered net per config |
| `time_based` | needs `sched`; inside/outside hours | net 0 or fixed fee |
| `no_price` | — | `null` |

Relevant excerpts for **`base_net_price` inside P3**:

```253:267:src/features/invoices/lib/resolve-trip-price.ts
    case 'client_price_tag': {
      // Misnamed strategy: if we got here, price_tag was absent — use stored transport net if present.
      if (trip.base_net_price != null) {
        return resolution(
          {
            net: trip.base_net_price,
            strategy_used: 'trip_price_fallback',
            source: 'trip_price',
            unit_price_net: trip.base_net_price,
            quantity: 1
          },
          taxRate
        );
      }
      return null;
    }
```

```285:298:src/features/invoices/lib/resolve-trip-price.ts
    case 'manual_trip_price': {
      // Explicit rule to invoice stored driver net price only.
      if (trip.base_net_price == null) return null;
      const n = trip.base_net_price;
      return resolution(
        {
          net: n,
          strategy_used: 'manual_trip_price',
          source: scope,
          unit_price_net: n,
          quantity: 1
        },
        taxRate
      );
    }
```

**`tiered_km` (does not read `base_net_price`):**

```303:318:src/features/invoices/lib/resolve-trip-price.ts
    case 'tiered_km': {
      // Distance required: cannot price km tiers without driving_distance_km.
      if (dist === null || dist === undefined) return null;
      const c = cfg as TieredKmConfig;
      const totalNet = tieredNetTotal(dist, c.tiers);
      const unit = roundMoneyOnce(totalNet / dist);
      return resolution(
        {
          net: totalNet,
          strategy_used: 'tiered_km',
          source: scope,
          unit_price_net: unit,
          quantity: dist
        },
        taxRate
      );
    }
```

---

### P4 — Fallback: stored transport net (`base_net_price` only)

**Condition:**

```491:508:src/features/invoices/lib/resolve-trip-price.ts
  // P4 — stored **transport** net when no rule produced an amount (or rule returned null).
  // `base_net_price` only: previously P4 read combined `net_price` and the rule’s approach
  // could be applied on top again (double-count). Phase 2 generated `trips.net_price` is combined only for readers.
  if (trip.base_net_price !== null && trip.base_net_price !== undefined) {
    const n = trip.base_net_price;
    return withApproachFeeFromRule(
      resolution(
        {
          net: n,
          strategy_used: 'trip_price_fallback',
          source: 'trip_price',
          unit_price_net: n,
          quantity: 1
        },
        taxRate
      ),
      rule
    );
  }
```

**Returns:** `net` and `unit_price_net` = **`base_net_price`** (transport net only). Then **`withApproachFeeFromRule(..., rule)`** may attach **`approach_fee_net`** from the **rule’s config**, not from any column on the trip row.

---

### P5 — Unresolved

**Condition:** P4’s `if` is false (no `base_net_price`).

**Returns:**

```511:523:src/features/invoices/lib/resolve-trip-price.ts
  // P5 — nothing left to price; builder shows missing_price until manual entry.
  return withApproachFeeFromRule(
    {
      gross: null,
      net: null,
      tax_rate: taxRate,
      strategy_used: 'no_price',
      source: 'unresolved',
      unit_price_net: null,
      quantity: 1
    },
    rule
  );
}
```

---

## 2. When is `base_net_price` used? P2 vs P3 vs P4

- **P2 (file-level)** does **not** use `base_net_price`; it uses **client price tag gross** only.
- **`base_net_price` appears in:**
  1. **P3** — inside `executeStrategy` for strategies `client_price_tag` (fallback when tag missing), `client_km_override`, and `manual_trip_price`.
  2. **P4** — when P3 did not return a resolution (no active rule, strategy returned `null`, or inactive rule).

**P4 exact condition:** `trip.base_net_price !== null && trip.base_net_price !== undefined`, **and** execution reached P4 (P3 did not return).

**Does P4 return `base_net_price` as transport net directly?** Yes: `net` and `unit_price_net` are set to **`n = trip.base_net_price`**.

**Does P4 add `approach_fee_net` from the rule?** It does **not** read **`trips.approach_fee_net`**. It calls **`withApproachFeeFromRule(resolution(...), rule)`**, which sets **`approach_fee_net`** only from **`extractApproachFeeNet(rule)`** (parsed `rule.config.approach_fee_net`). So the rule still participates for Anfahrt on P4, but the **trip row’s** stored approach column is unused here.

**Does the `base_net_price` path bypass the km-rule?**

- **P4:** Yes — no `tiered_km` math; transport net is the stored base.
- **P3** `client_price_tag` / `client_km_override` / `manual_trip_price` branches: they use **`base_net_price`** as the transport net and **do not** run tiered km in those cases; **`withApproachFeeFromRule` still runs** after P3, so rule approach can attach.

---

## 3. When is `net_price` (trip row) used?

**It is not used in `resolveTripPrice`.** The input type includes `net_price` for API compatibility, with a deprecation comment:

```82:90:src/features/invoices/lib/resolve-trip-price.ts
export interface TripPriceInput {
  kts_document_applies: boolean;
  /** @deprecated for P3/P4 — prefer `base_net_price`. */
  net_price: number | null;
  /**
   * Transport net only (excludes Anfahrt). P3 strategies and P4 use this; do not pass combined `net_price` here
   * or `withApproachFeeFromRule` can double-count approach on top of a combined stored total.
   */
  base_net_price: number | null;
```

There is **no** `if (trip.net_price ...)` branch. So **`net_price` never triggers a priority and never bypasses the km-rule** — it is ignored by this resolver.

---

## 4. Example: stored `base_net_price = 39.69`, `approach_fee_net = 3.8` on the trip row

**Important:** **`resolveTripPrice` never reads `trip.approach_fee_net`**. The **3.8** on the row is irrelevant to this function; only **rule config** supplies `approach_fee_net` on the resolution (via `withApproachFeeFromRule`).

**Which level fires** depends on earlier priorities and P3:

| Situation | Fires | `PriceResolution.net` (transport) | `approach_fee_net` on resolution |
|-----------|--------|-----------------------------------|-----------------------------------|
| `manual_gross_price` set | **P0** | derived from gross ÷ (1+tax) | **0** |
| `kts_document_applies` | **P1** | 0 | (omitted) |
| Client tag gross present | **P2** | tag / (1+tax) | (omitted) |
| Active rule, `tiered_km`, `driving_distance_km` present | **P3** | **`tieredNetTotal(dist, tiers)`** — generally **≠ 39.69** | from **rule** `approach_fee_net` if configured |
| Active rule but `executeStrategy` returns `null` (e.g. tiered_km but **no** distance), and `base_net_price` set | **P4** | **39.69** | from **rule** config if present (could be 3.8 if rule says so — not read from trip row) |
| No P0–P3 result, `base_net_price` set | **P4** | **39.69** | same as above |

So **39.69** appears as **`net`** only when **P4** (or a P3 branch that explicitly copies `base_net_price`) wins — **not** when **P3 `tiered_km`** succeeds with a different computed total.

---

## 5. Can `tiered_km` run while `base_net_price` is non-null?

**Yes.** Order is P0 → P1 → P2 → **P3** → P4. **`base_net_price` does not short-circuit P3.**

**Condition sketch:**

1. `manual_gross_price` missing or nullish (P0 false).
2. `kts_document_applies !== true` (P1 false).
3. No client tag gross (P2 false).
4. `rule && rule.is_active`, `rule.strategy === 'tiered_km'`, `trip.driving_distance_km` is **not** `null`/`undefined`, config parses, **`tieredNetTotal` runs**.
5. Then **`return withApproachFeeFromRule(strategyResult, rule)`** — P4 is **never evaluated** even if `base_net_price` is 39.69 on the row.

**Concrete shape:** ARZO-style active **`tiered_km`** rule + trip with **effective** `driving_distance_km` set + **no** P0/P1/P2 + **`base_net_price` populated** (e.g. from an old snapshot) → engine still prices by **km tiers** in P3; the stored base is **not** used for `net` in that run.

---

## 6. `withApproachFeeFromRule` (reference)

```128:135:src/features/invoices/lib/resolve-trip-price.ts
function withApproachFeeFromRule(
  base: PriceResolution,
  rule: BillingPricingRuleLike | null
): PriceResolution {
  const fee = extractApproachFeeNet(rule);
  if (fee === undefined) return base;
  return { ...base, approach_fee_net: fee };
}
```

`extractApproachFeeNet` reads **`rule.config`** via `parseConfigForStrategy`; invalid/missing → **`approach_fee_net` omitted** on the object.

---

## Summary

| Topic | Finding |
|--------|---------|
| Alias | `resolveTripPricePure` ≡ `resolveTripPrice` |
| `net_price` on trip | **Unused** in the resolver |
| `base_net_price` | P3 (selected strategies) + **P4 fallback**; transport net only |
| P4 + rule | **Adds** rule-config **Anfahrt** via `withApproachFeeFromRule`; does **not** read trip `approach_fee_net` |
| `tiered_km` + non-null `base_net_price` | **Yes** — P3 runs first; tiered result wins over P4 |
