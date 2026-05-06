# Price engine — rule config data audit (read-only)

**Read-only audit.** No application code changes.

**Goal:** Inspect what is **actually persisted** in `billing_pricing_rules` for this tenant, relate it to the pricing code (`resolve-trip-price.ts`, Zod schema, UI), and answer whether discrepancies are explained by **stored config** vs **engine logic**.

**Database:** Supabase project `etwluibddvljuhkxjkxs` (MCP `execute_sql`, read-only `SELECT`).

**Context:** Prior PDF/passenger audits referenced payer **RZO** (`cf18de74-a6b6-4f46-8d61-7862a65ea3ec`). Where the prompt says “affected payer”, this document uses **RZO** as the concrete example; the SQL below returns **all** active payer-scoped rules.

---

## Source files read (full)

- `src/features/invoices/lib/resolve-trip-price.ts` — `tieredNetTotal`, `tiered_km`, `fixed_below_threshold_then_km`.
- `src/features/invoices/lib/pricing-rule-config.schema.ts` — `tiered_km` vs `fixed_below_threshold_then_km` config shapes.
- `src/features/payers/components/pricing-rule-dialog/step2-rule-config.tsx` — UI for `tiers` / `km_tiers`, labels “€/km netto”, threshold + fixed price.
- `supabase/migrations/20260405100000_billing_pricing_rules.sql` — table definition for `billing_pricing_rules` (no seed data).

**Note:** No migration or seed in this repo **inserts** pricing rule rows; live config is tenant data in Supabase only.

---

## SQL executed (verbatim)

```sql
SELECT
  id,
  payer_id,
  strategy,
  config
FROM billing_pricing_rules
WHERE is_active = true
ORDER BY payer_id;
```

### Full query result

**Raw `SELECT` rows** (exactly as returned by `execute_sql`; `payer_name` added via second query):

| id | payer_id | payer_name | strategy | config |
|----|----------|------------|----------|--------|
| `84254770-6616-455b-8c89-e8a619a7859c` | `6e52a5d5-ffd4-4a75-a34d-60b054f83030` | ARZO | `tiered_km` | `{"tiers":[{"to_km":5,"from_km":0,"price_per_km":2.3},{"to_km":null,"from_km":5,"price_per_km":1.99}],"approach_fee_net":3.8}` |
| `4a4e4036-c461-49bf-9712-f07fd6bc2b4c` | `abbd2392-a67e-4a66-b278-82daecc794bd` | Pflegeheim Bloherfelde | `tiered_km` | `{"tiers":[{"to_km":5,"from_km":0,"price_per_km":3.1},{"to_km":null,"from_km":5,"price_per_km":2.8}],"approach_fee_net":5.6}` |
| `7b00cb57-21d8-418b-bf89-39baa6f068b4` | `aebdb66f-0ab0-4ea0-9e6b-b4037da86b64` | Selbstzahler | `tiered_km` | `{"tiers":[{"to_km":5,"from_km":0,"price_per_km":3.1},{"to_km":null,"from_km":5,"price_per_km":2.8}],"approach_fee_net":5.6}` |
| `e6aedcb2-ebae-47f1-b407-a52e5697a4bb` | `cf18de74-a6b6-4f46-8d61-7862a65ea3ec` | RZO | `tiered_km` | `{"tiers":[{"to_km":5,"from_km":0,"price_per_km":2.3},{"to_km":null,"from_km":5,"price_per_km":1.95}],"approach_fee_net":3.8}` |
| `8f7d5c7a-3e79-4f73-85be-64dcbc1b92e8` | `e4b3062b-8417-462f-9814-063f69f89bd5` | Eispert | `tiered_km` | `{"tiers":[{"to_km":5,"from_km":0,"price_per_km":3.1},{"to_km":null,"from_km":5,"price_per_km":2.8}],"approach_fee_net":5.6}` |

---

## 1) Exact `strategy` for the affected payer (RZO)

**Answer:** `tiered_km` — **not** `fixed_below_threshold_then_km`.

- Rule id: `e6aedcb2-ebae-47f1-b407-a52e5697a4bb`
- Payer: RZO (`cf18de74-a6b6-4f46-8d61-7862a65ea3ec`)

**Implication:** There is **no** `fixed_price`, **no** `threshold_km`, and **no** `km_tiers` key in this row. The “flat fee for short trips” mental model maps to **`fixed_below_threshold_then_km`** in the product, but this tenant stored **pure `tiered_km`** with two per-km bands (0–5 km at €2.30/km and 5+ km at €1.95/km net) plus `approach_fee_net`.

---

## 2) Full `config` JSON for RZO; `fixed_price` / `threshold_km` / `km_tiers`

**Full `config` as stored:**

```json
{
  "tiers": [
    { "from_km": 0, "to_km": 5, "price_per_km": 2.3 },
    { "from_km": 5, "to_km": null, "price_per_km": 1.95 }
  ],
  "approach_fee_net": 3.8
}
```

| Field | Value |
|--------|--------|
| `fixed_price` | **Absent** (`tiered_km` schema has no such key — see `tieredKmConfigSchema` in `pricing-rule-config.schema.ts`) |
| `threshold_km` | **Absent** |
| `km_tiers` | **Absent** (only `fixed_below_threshold_then_km` uses `km_tiers`) |
| `tiers` | Two entries as above |
| `approach_fee_net` | `3.8` (net) |

**Compare ARZO** (same 2.30 / 5 km breakpoint, **different** tail rate): second tier `price_per_km` is **1.99**, not 1.95. If expectations were “RZO should match ARZO”, the **data** already differs by **€0.04/km** on the tail tier.

Schema reference — `tiered_km` only allows `tiers` + optional `approach_fee_net`:

```23:29:src/features/invoices/lib/pricing-rule-config.schema.ts
export const tieredKmConfigSchema = z
  .object({
    tiers: z.array(kmTierSchema).min(1)
  })
  .merge(approachFeeSchema)
  .strict();
```

---

## 3) `tieredNetTotal` when `pos = 0` and the first tier has `from_km > 0` — plus trace for **6 km** with **RZO’s** stored `tiers`

### Code reference

```177:197:src/features/invoices/lib/resolve-trip-price.ts
export function tieredNetTotal(distanceKm: number, tiers: KmTier[]): number {
  if (distanceKm <= 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.from_km - b.from_km);
  let pos = 0;
  let raw = 0;
  let guard = 0;
  while (pos < distanceKm - 1e-9 && guard < 1000) {
    guard += 1;
    const tier = sorted.find(
      (t) => pos + 1e-9 >= t.from_km && (t.to_km === null || pos < t.to_km)
    );
    if (!tier) break;
    const cap =
      tier.to_km === null ? distanceKm : Math.min(tier.to_km, distanceKm);
    if (cap <= pos) break;
    const km = cap - pos;
    raw += km * tier.price_per_km;
    pos = cap;
  }
  return roundMoneyOnce(raw);
}
```

### Hypothesis: first tier starts at `from_km > 0` (gap from 0)

At `pos = 0`, a tier with `from_km = 5` fails the test `pos + 1e-9 >= t.from_km`. **`sorted.find` returns `undefined`**, the loop hits `if (!tier) break`, and the function returns **`roundMoneyOnce(0)`** unless some other tier covers `pos = 0`.

So a misconfigured first tier (e.g. only `{ from_km: 5, to_km: null, … }` with nothing from 0) does **not** throw — it **silently under-prices to €0** transport net for any distance. That is a real foot-gun if bad JSON is saved.

### RZO stored config: **no gap** — trace for `distanceKm = 6`

Stored tiers (sorted): `[0,5)`, `[5,∞)`.

1. `pos = 0`, `raw = 0`. Find tier: first tier matches (`0 + ε ≥ 0`, `0 < 5`). `cap = min(5, 6) = 5`. `km = 5`. `raw += 5 × 2.3 = 11.5`. `pos = 5`.
2. `pos = 5 < 6`. Find tier: first tier fails `pos < to_km` (`5 < 5` false). Second tier matches (`5 + ε ≥ 5`, `to_km` null). `cap = 6`. `km = 1`. `raw += 1 × 1.95 = 1.95` → `raw = 13.45`. `pos = 6`.
3. Loop ends. `roundMoneyOnce(13.45) = 13.45`.

**No silent skip** for RZO’s real data: `pos` advances **5 → 6** contiguously.

---

## 4) `fixed_below_threshold_then_km` above threshold: does it add `c.fixed_price` to `totalNet`?

**Answer:** **No.** Above threshold it **only** uses `tieredNetTotal(dist, c.km_tiers)`. The flat `fixed_price` applies **only** when `dist < c.threshold_km`.

Exact lines:

```320:349:src/features/invoices/lib/resolve-trip-price.ts
    case 'fixed_below_threshold_then_km': {
      if (dist === null || dist === undefined) return null;
      const c = cfg as FixedBelowThresholdThenKmConfig;
      // Below threshold: flat net regardless of km (quantity 1).
      if (dist < c.threshold_km) {
        const n = roundMoneyOnce(c.fixed_price);
        return resolution(
          {
            net: n,
            strategy_used: 'fixed_below_threshold_then_km',
            source: scope,
            unit_price_net: n,
            quantity: 1
          },
          taxRate
        );
      }
      // At/above threshold: full distance priced with km tiers (quantity = km).
      const totalNet = tieredNetTotal(dist, c.km_tiers);
      const unit = roundMoneyOnce(totalNet / dist);
      return resolution(
        {
          net: totalNet,
          strategy_used: 'fixed_below_threshold_then_km',
          source: scope,
          unit_price_net: unit,
          quantity: dist
        },
        taxRate
      );
    }
```

So if the business expectation was “above 5 km we still add the short-trip flat on top of km pricing”, **neither** `tiered_km` **nor** `fixed_below_threshold_then_km` implements that; you’d need a different strategy or config semantics.

---

## 5) `tieredNetTotal` for dist = 6, 13.5, 20.1 using **RZO’s** stored `tiers`

Tier definitions: \([0,5)\) @ €2.30/km; \([5,∞)\) @ €1.95/km. `to_km` is **exclusive** on the first segment (see schema comment: “exclusive upper bound”).

```14:20:src/features/invoices/lib/pricing-rule-config.schema.ts
export const kmTierSchema = z.object({
  // from_km: inclusive start of segment
  from_km: z.number().nonnegative(),
  // to_km: exclusive upper bound; null = unlimited tail
  to_km: z.number().nonnegative().nullable(),
  price_per_km: z.number().nonnegative()
});
```

| `dist` | Calculation | `raw` before round | `tieredNetTotal` (after `roundMoneyOnce`) |
|--------|-------------|--------------------|-------------------------------------------|
| **6** | `5×2.3 + 1×1.95` | 13.45 | **13.45** |
| **13.5** | `5×2.3 + 8.5×1.95` = 11.5 + 16.575 | 28.075 | **28.08** |
| **20.1** | `5×2.3 + 15.1×1.95` = 11.5 + 29.445 | 40.945 | **40.95** |

(`roundMoneyOnce` = `Math.round(raw * 100) / 100`.)

---

## Summary — data vs code

1. **All five active payer rules** in this database are **`tiered_km`** with a **two-band** `tiers` array (0–5 / 5+) and an `approach_fee_net`. **None** use `fixed_below_threshold_then_km`.
2. **RZO** uses tail rate **€1.95/km**, not **€1.99/km** (ARZO uses 1.99). Any spreadsheet that assumed 1.99 for RZO will **not** match production.
3. **Boundary shape** in DB is consistent with code: `from_km: 5` on the second tier aligns with `to_km: 5` on the first (half-open intervals). No gap for RZO.
4. **`fixed_price` is not “dropped”** for RZO — it **does not exist** in `tiered_km` config. Expecting a threshold flat fee requires **`fixed_below_threshold_then_km`** (and then note: above threshold, **`fixed_price` is still not added** per §4).
5. If outputs “don’t fit one formula”, first reconcile **strategy** (`tiered_km` vs fix+km) and **numeric tail rate** (1.95 vs 1.99) against the **stored JSON** above, before revisiting engine code.

---

## Senior recommendation

Re-run the same `SELECT` in **production** if this audit was meant for another environment. For **this** project (`etwluibddvljuhkxjkxs`), the discrepancy hypothesis “wrong `km_tiers` / gap at 5 km” is **not supported** for RZO: tiers are contiguous. The stronger findings are: **everyone is on `tiered_km`**, and **RZO’s second-band rate is 1.95, not 1.99**. If the product intent was “€11.50 minimum for the first 5 km then per-km,” that is **already** what `tiered_km` with `5 × 2.3` encodes — not a separate `fixed_price` field.
