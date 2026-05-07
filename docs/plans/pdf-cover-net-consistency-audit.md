# PDF cover NET consistency audit (read-only)

Scope: trace exactly how `InvoicePdfSummaryRow.transport_costs_net`, `approach_costs_net`, `total_price` (NET) and `total_costs_gross` are produced today (post-revert), for both **net-anchor** and **gross-anchor** lines. Identify the structural gap that causes the displayed NET to drift away from the resolver's authoritative net while the displayed GROSS continues to match the per-line stored `total_price`. No code changes.

---

## 0. Persist-side starting point: `insertLineItems`

`src/features/invoices/api/invoice-line-items.api.ts` (lines 728–767, post-revert state):

```ts
const frozen = frozenPriceResolutionForInsert(item);

let total_price: number;
if (isGrossAnchorClientPriceTag(frozen)) {
  total_price =
    frozen.gross! * item.quantity +
    (item.approach_fee_net ?? 0) * (1 + item.tax_rate);
} else {
  const transportNet =
    frozen.net !== null && frozen.net !== undefined
      ? frozen.net
      : (item.unit_price ?? 0) * item.quantity;
  // why: frozen.net is authoritative tiered (or fallback) transport net; unit × qty
  // loses precision when unit_price_net is a rounded per-km display rate.
  total_price =
    (transportNet + (item.approach_fee_net ?? 0)) * (1 + item.tax_rate);
}
```

Two anchor-aware branches at insert time. The unrounded float is then stored into:

```sql
-- supabase/migrations/20260331130000_create_invoice_line_items.sql
total_price           NUMERIC(10,2) NOT NULL,
```

Postgres `NUMERIC(10,2)` rounds to two decimals **half-away-from-zero** on insert. So the per-line stored `total_price` is always a 2-decimal number when the cover aggregator reads it back.

---

## 1. Net-anchor grouped line (Bienert 13× tiered_km, 7%)

Inputs per line: `frozen.net = 41.55`, `approach_fee_net = 3.80`, `tax_rate = 0.07`, `unit_price = 2.07`, `quantity = 20.1`.

### 1a. Per-line `insertLineItems` → DB

```text
transportNet = frozen.net                          = 41.55
total_price  = (41.55 + 3.80) × (1 + 0.07)
             = 45.35 × 1.07
             = 48.5245                              (JS float, unrounded)
DB store     = 48.52                                (NUMERIC(10,2), half-away-from-zero)
```

### 1b. Per-line `lineGrossEurForPdfLineItem` (`invoice-pdf-line-amounts.ts` 42–52)

```ts
const stored = item.total_price;                    // 48.52
if (typeof stored === 'number' && !Number.isNaN(stored)) {
  return Math.round(stored * 100) / 100;            // 48.52
}
```

Returns **48.52** (already on a cent boundary).

### 1c. Aggregator loop (`build-invoice-pdf-summary.ts` 230–241)

```ts
group.count                += 1;
group.total_price          += lineNetEurForPdfLineItem(item);   // unused for output
group.total_gross          += lineGrossEurForPdfLineItem(item); // 48.52
group.approach_costs_net   += item.approach_fee_net ?? 0;       // 3.80
```

After 13 lines:

```text
group.count               = 13
group.total_gross         = 13 × 48.52 = 630.76
group.approach_costs_net  = 13 × 3.80  = 49.40
group.total_price (acc)   = 13 × round(2.07 × 20.1 + 3.80) = 13 × 45.41 = 590.33   ← unused
```

### 1d. `summaryRowFromAgg` (`build-invoice-pdf-summary.ts` 151–181)

```ts
const totalGross   = Math.round(g.total_gross * 100) / 100;
const approachNet  = Math.round(g.approach_costs_net * 100) / 100;
// Derive net from gross anchor — do not use g.total_price ...
const totalNet     = Math.round((totalGross / (1 + g.tax_rate)) * 100) / 100;
const transportNet = Math.round((totalNet - approachNet) * 100) / 100;
```

Plugged in:

```text
totalGross    = round(630.76)                        = 630.76
approachNet   = round(49.40)                         = 49.40
totalNet      = round(630.76 / 1.07)
              = round(589.4953271…)                  = 589.50
transportNet  = round(589.50 - 49.40)                = 540.10
```

### 1e. Final `InvoicePdfSummaryRow` for the group

| Field | Value | Source |
|---|---|---|
| `transport_costs_net` | **540.10** | `round(totalNet − approachNet)` (back-derived from gross) |
| `approach_costs_net`  | **49.40**  | `round(Σ approach_fee_net)` (column sum) |
| `total_price` (NET)   | **589.50** | `round(totalGross / (1 + tax_rate))` (back-derived from gross) |
| `total_costs_gross`   | **630.76** | `round(Σ lineGrossEurForPdfLineItem)` (sum of stored cent-rounded line gross) |

**Internal round-trip check:** `540.10 + 49.40 = 589.50` ✓; `Math.round(589.50 × 1.07 × 100) / 100 = 630.76` ✓ (in JS — strict half-up math gives 630.77, but `630.765` lands at the float boundary `63076.49999…` so `Math.round → 63076 → 630.76`). The row is internally self-consistent.

**External parity check (vs. `calculateInvoiceTotals`, header total):** header path sums `frozen.net + approach` per line, then taxes once per rate bucket:

```text
header subtotal = 13 × (41.55 + 3.80) = 589.55
header VAT      = round(589.55 × 0.07) = round(41.2685) = 41.27
header total    = round(589.55 + 41.27) = 630.82
```

So the cover row's `transport_costs_net` (**540.10**) is 5 cents below the resolver's authoritative transport sum (`13 × 41.55 = 540.15`), `total_price` NET (**589.50**) is 5 cents below the header net (`589.55`), and `total_costs_gross` (**630.76**) is 6 cents below the header gross (`630.82`). The cover **is consistent within itself** but **inconsistent with `calculateInvoiceTotals`** — the value of every NET-side field on the summary row is the back-derivation of an under-rounded gross.

---

## 2. Where does `total_price` (the NET field on the summary row) come from?

It is **not** read directly from any stored column. It is **derived from the accumulated gross** by reverse-dividing by `(1 + tax_rate)`. Three identical occurrences post-revert:

```163:163:src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts
  const totalNet = Math.round((totalGross / (1 + g.tax_rate)) * 100) / 100;
```

```336:336:src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts
  const totalNet = Math.round((totalGross / (1 + tax_rate)) * 100) / 100;
```

```449:449:src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts
      const totalNet = Math.round((totalGross / (1 + g.tax_rate)) * 100) / 100;
```

The accumulator `g.total_price` (which **does** sum a per-line net via `lineNetEurForPdfLineItem` = `unit × qty + approach`) is **never written to the output row** — it is dead state for output purposes. The output `total_price` is exclusively the gross-back-derivation above.

---

## 3. Gross-anchor line (`client_price_tag`, fixed gross 50.00€, approach 0, 7%)

### 3a. Per-line `insertLineItems` (gross-anchor branch)

```text
total_price = frozen.gross × quantity + (approach_fee_net ?? 0) × (1 + tax_rate)
            = 50.00 × 1 + 0 × 1.07
            = 50.00
DB store    = 50.00
```

### 3b. Per-line `lineGrossEurForPdfLineItem`

Returns **50.00** (`Math.round(50.00 × 100) / 100`).

### 3c. Aggregator loop (1 line in this group)

```text
group.count              = 1
group.total_gross        = 50.00
group.approach_costs_net = 0
```

### 3d. `summaryRowFromAgg` — same formula as net-anchor

```text
totalGross    = round(50.00)                    = 50.00
approachNet   = round(0)                        = 0
totalNet      = round(50.00 / 1.07)
              = round(46.7289719…)              = 46.73
transportNet  = round(46.73 - 0)                = 46.73
```

### 3e. Final summary-row fields

| Field | Value | Source |
|---|---|---|
| `transport_costs_net` | **46.73** | `round(totalNet − approachNet)` |
| `approach_costs_net`  | **0.00**  | `round(Σ approach_fee_net)` |
| `total_price` (NET)   | **46.73** | `round(totalGross / (1 + tax_rate))` |
| `total_costs_gross`   | **50.00** | `round(Σ lineGrossEurForPdfLineItem)` |

**Round-trip:** `round(46.73 × 1.07) = round(50.0011) = 50.00` ✓. The gross anchor is exact (it was the negotiated tag), and the back-derived net is the only sane choice (it matches what the resolver's `unit_price_net` would have been: `round(50 / 1.07) = 46.73`). **For gross-anchor lines, back-derivation is correct — this is the contract.**

---

## 4. Is there an anchor-aware branch for the summary row's NET field?

**No.** All three aggregator output paths funnel net-anchor and gross-anchor lines through the **same gross-back-derivation formula**:

- `summaryRowFromAgg` (line 163): `totalNet = round(totalGross / (1 + tax_rate))`
- `buildInvoicePdfSingleRow` (line 336): same
- `buildInvoicePdfGroupedByBillingType.map(...)` (line 449): same

There is no `if (isGrossAnchor) {…} else {…}` discriminator. The persist path **does** branch (`insertLineItems` line 751: `if (isGrossAnchorClientPriceTag(frozen))`), but the cover-summary path does not.

> **This is the gap.** The display contract documented in the file-level JSDoc is *"For `client_price_tag` lines the gross is the pricing anchor; displayed net on summary rows is therefore back-derived from the accumulated gross"*. That contract is correct — for gross-anchor lines. The aggregator silently applies the same back-derivation to **net-anchor** lines, where the authoritative source is the resolver's `frozen.net + approach_fee_net`, not the cent-rounded sum of stored grosses divided back. The result: a 5–6¢ gap between the cover NET column and `calculateInvoiceTotals` for `tiered_km` and other strategies whose per-line `total_price` ends mid-cent (`48.5245 → 48.52`).

---

## 5. Correct NET display value for the 13-trip group, given `gross = 630.76€`

**Constraint stated:** `transport_net + approach_net = total_net` AND `round(total_net × 1.07) = gross` AND `gross = 630.76`.

Taking gross **fixed** at 630.76 (sum of per-line stored gross), the only `total_net` at 2-decimal resolution that round-trips to 630.76 in JavaScript is:

```text
total_net = round(630.76 / 1.07 × 100) / 100
          = round(589.4953271… × 100) / 100
          = 589.50
```

Verification (JS `Math.round`): `Math.round(589.50 × 1.07 × 100) / 100 = 630.76` ✓ (mathematically `589.50 × 1.07 = 630.765`, but JS-float represents it as `63076.49999…` so `Math.round` floors to `63076 → 630.76`; banker's rounding would also yield `630.76` since `.76` is even — strict half-up math would give `630.77`).

Decomposition into displayed sub-components:

```text
approach_net  = Σ approach_fee_net = 13 × 3.80 = 49.40            (column truth)
transport_net = total_net − approach_net = 589.50 − 49.40 = 540.10  (back-derived)
```

> **Caveat — these are not the resolver's transport net.** The resolver's `frozen.net` per line is **41.55**, so `Σ frozen.net = 13 × 41.55 = 540.15`. The displayed `transport_costs_net = 540.10` is **5 ¢ below the authoritative transport net** because it is forced to satisfy `transport + approach = round(630.76 / 1.07)` rather than carrying the resolver value through. With the constraint `gross = 630.76` fixed, **there is no 2-decimal `total_net` that simultaneously equals `Σ frozen.net + Σ approach (= 589.55)` AND satisfies `round(× 1.07) = 630.76`** — the system is over-determined. One of the two has to give. The current code chooses to give up resolver fidelity in favor of within-row round-trip.

---

## 6. Smallest change that makes the NET column arithmetically consistent for net-anchor lines, without breaking gross-anchor lines

The current contract collapses both anchors into a single "back-derive net from gross" path. Restoring per-anchor correctness requires the cover aggregator to **branch by anchor**, exactly like `insertLineItems` already does at write time. There are two viable shapes; both keep gross-anchor untouched.

### Option A — Net-first for net-anchor lines (gross follows from net)

For each line, accumulate `frozen.net` into `Σ_transport_net` (with `unit_price × quantity` fallback when snapshot missing) and `approach_fee_net` into `Σ_approach`. Apply VAT once on the group total:

```text
transport_costs_net = round(Σ_transport_net)
approach_costs_net  = round(Σ_approach)
total_price (net)   = round(transport_costs_net + approach_costs_net)
total_costs_gross   = round((Σ_transport_net + Σ_approach) × (1 + tax_rate))   ← unrounded inputs
```

For Bienert: 540.15 / 49.40 / 589.55 / **630.82** — equals `calculateInvoiceTotals(...).total` exactly. Restores resolver fidelity. **Changes the displayed gross** from 630.76 → 630.82 (matches header).

### Option B — Anchor-aware split: net-first NET, but keep stored-gross GROSS

If the displayed gross **must** stay at the sum of per-line stored grosses (e.g. 630.76 for Bienert), then the only way to keep the NET column truthful is to drop the within-row round-trip invariant:

```text
transport_costs_net = round(Σ frozen.net)                        ← from snapshot
approach_costs_net  = round(Σ approach_fee_net)                  ← column truth
total_price (net)   = round(transport_costs_net + approach_costs_net)
total_costs_gross   = round(Σ lineGrossEurForPdfLineItem)        ← unchanged
```

For Bienert: 540.15 / 49.40 / 589.55 / 630.76. Now `round(589.55 × 1.07) = 630.82 ≠ 630.76`, so within-row round-trip fails by 6¢. This option exposes the rounding discipline gap to the reader instead of hiding it inside a back-derivation. Generally **not** what users want on an invoice cover.

### Recommendation

**Option A**, applied only to the net-anchor branch via a per-line discriminator (e.g. `frozen.net !== null` derived from `price_resolution_snapshot`, or absence of `client_price_tag` strategy). Gross-anchor lines keep the current "sum stored gross, back-derive net" path because for them the gross **is** the authoritative anchor and back-derivation matches the resolver's `unit_price_net = round(gross / (1 + tax))`. The `summaryRowFromAgg` / `buildInvoicePdfSingleRow` / `buildInvoicePdfGroupedByBillingType` outputs would then carry both:

- Net-anchor groups: `total_costs_gross = round((Σ frozen.net + Σ approach) × (1 + tax))`, `transport_costs_net = round(Σ frozen.net)`.
- Gross-anchor groups: unchanged.

This is the **same shape `calculateInvoiceTotals` already uses** for header totals (line 671–681): per-line `frozen.net + approach` accumulated, VAT applied once per rate bucket. Bringing the cover aggregator into that shape — for net-anchor lines only — closes the gap with zero impact on gross-anchor `client_price_tag` rows.

If one anchor-aware branch is too invasive, a smaller intermediate step is to **expose the resolver's transport net on the row directly** (e.g. set `transport_costs_net` from `Σ price_resolution_snapshot.net` while keeping the rest of the back-derivation), but this surfaces a row-internal mismatch (`transport + approach ≠ total_net`) and is strictly worse than Option A.

---

## Summary

| Question | Answer |
|---|---|
| Net-anchor formula trace (Bienert 13×) | `transport_costs_net = 540.10`, `approach_costs_net = 49.40`, `total_price (NET) = 589.50`, `total_costs_gross = 630.76`. All NET-side fields back-derived from the gross sum 630.76 / 1.07. |
| Source of summary `total_price` (NET) | Back-derived from gross: `Math.round((totalGross / (1 + tax_rate)) * 100) / 100` (line 163, 336, 449). Never read from a stored NET column. |
| Gross-anchor formula trace (50€ tag, 0 approach, 7%) | `transport_costs_net = 46.73`, `approach_costs_net = 0`, `total_price (NET) = 46.73`, `total_costs_gross = 50.00`. Same back-derivation; correct here because gross is the authoritative anchor. |
| Anchor-aware branch in cover NET path? | **No.** All three aggregators apply gross-back-derivation regardless of anchor. **This is the gap.** |
| Required `total_net` for `gross = 630.76` constraint | `total_net = 589.50` (current display); `transport_net = 540.10`, `approach_net = 49.40`. Internally consistent, but **5–6 ¢ below resolver / header** because the stored cent-rounded gross sum is itself 6 ¢ below `(Σ frozen.net + Σ approach) × 1.07`. |
| Smallest correctness fix | Reintroduce an **anchor-aware branch in the cover aggregator** (mirroring `insertLineItems`): net-anchor groups → `total_costs_gross = round((Σ frozen.net + Σ approach) × (1 + tax))` and `transport_costs_net = round(Σ frozen.net)`; gross-anchor groups unchanged. Aligns the cover with `calculateInvoiceTotals` and keeps `client_price_tag` rendering identical. |
