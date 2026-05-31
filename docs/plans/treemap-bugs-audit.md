# Treemap bugs audit — PayerBillingTreemap

Read-only audit of `PayerBillingTreemap.tsx`, `aggregatePayerTreemap`, design tokens, and Nivo color integration. No code was changed.

**Files reviewed**

- `src/features/controlling/components/PayerBillingTreemap.tsx`
- `src/features/controlling/lib/controlling-utils.ts` (`aggregatePayerTreemap`)
- `src/features/controlling/types/controlling.types.ts` (`ControllingPayerTreemapItem`)
- `src/styles/globals.css`, `src/styles/theme.css`, `src/styles/themes/*.css`
- `node_modules/@nivo/treemap/dist/types/types.d.ts` (v0.99.0)
- `node_modules/@nivo/colors/dist/types/scales/ordinalColorScale.d.ts` (v0.99.0)

---

## 1. Click bug — "Ohne Typ" on empty payers

### 1a. What creates a billing type entry in `aggregatePayerTreemap`?

There is **no upfront filter** on `billing_type_id` or `revenue_net` during accumulation. Every breakdown row is processed in the `for (const row of rows)` loop.

Billing bucket key and name:

```348:358:src/features/controlling/lib/controlling-utils.ts
    const billingKey = row.billing_type_id ?? '__untyped__';
    const existing = payer.billingTypes.get(billingKey);
    if (existing) {
      existing.revenue_net += row.revenue_net;
      existing.trip_count += row.trip_count;
    } else {
      payer.billingTypes.set(billingKey, {
        billing_type_name: row.billing_type_name ?? 'Ohne Typ',
        revenue_net: row.revenue_net,
        trip_count: row.trip_count
      });
    }
```

**Answer:** A row with `billing_type_id = null` **and** `revenue_net > 0` **does** create an `'Ohne Typ'` entry (key `'__untyped__'`, name from `row.billing_type_name ?? 'Ohne Typ'`). Null `billing_type_id` is not excluded; it is folded into the synthetic untyped bucket.

The only post-aggregation filter on billing types is:

```371:371:src/features/controlling/lib/controlling-utils.ts
        .filter((bt) => bt.revenue_net !== 0);
```

Payers are kept when `total_revenue_net > 0` (sum of non-zero billing buckets).

### 1b. Payer with ONLY null `billing_type_id` rows

Assume all rows for that payer have `billing_type_id = null` and at least one row has `revenue_net !== 0`.

| Question | Answer |
|---|---|
| `billing_types.length` | **`=== 1`** (not 0) |
| `'Ohne Typ'` included? | **Yes** — single entry with `billing_type_id: '__untyped__'`, `billing_type_name: 'Ohne Typ'` |

If every row for that payer has `revenue_net === 0`, the billing type is filtered out, `billing_types.length === 0`, and the payer is dropped entirely by `.filter((payer) => payer.total_revenue_net > 0)`.

### 1c. Drill-down guard in `handlePayerClick`

```93:99:src/features/controlling/components/PayerBillingTreemap.tsx
  function handlePayerClick(node: { data: TreemapDatum; isLeaf: boolean }) {
    if (!node.isLeaf) return;
    const payerId = node.data.payerId;
    if (!payerId) return;
    const payer = payerMix.find((p) => p.payer_id === payerId);
    if (payer && payer.billing_types.length > 0) setSelectedPayer(payer);
  }
```

Full condition that allows drill-down: **`payer && payer.billing_types.length > 0`**

(Preceded by leaf / `payerId` guards.)

### 1d. `hasBillingTypes` in `allPayersTreemapData`

```75:75:src/features/controlling/components/PayerBillingTreemap.tsx
        hasBillingTypes: payer.billing_types.length > 0
```

Exact expression: **`payer.billing_types.length > 0`**

Used by `PayerTreemapTooltip` to show *"Keine Abrechnungsarten im Zeitraum"* when false.

### 1e. Conclusion

The guard condition is **syntactically correct** but **semantically wrong** for the intended UX.

- It does **not** fail because `billing_types.length` is 0 for untyped-only payers with revenue.
- It **succeeds** (allows drill-down) because the synthetic `'Ohne Typ'` bucket makes `billing_types.length === 1`.
- Result: clicking a payer with no configured billing types opens level 2 with a **single "Ohne Typ" tile** — a useless drill-down that contradicts the card copy (*"Aufschlüsselung nach Abrechnungsfamilie"*).
- Tooltip inconsistency: for untyped-only payers, `hasBillingTypes` is `true`, so the tooltip **does not** show *"Keine Abrechnungsarten im Zeitraum"* even though there are no real Abrechnungsarten.

**Root cause:** `'__untyped__'` entries are counted the same as real `billing_type_id` values in both the click guard and `hasBillingTypes`.

---

## 2. Color system — Nivo vs design tokens

### 2a. Are `--chart-1` … `--chart-5` defined?

**Yes.** They are **not** in `globals.css`. They live in per-theme files under `src/styles/themes/`, imported via `src/styles/theme.css`.

There is **no `tailwind.config.ts`**. Tailwind v4 uses `@theme inline` blocks inside theme CSS; chart tokens are mirrored as `--color-chart-1` … `--color-chart-5` (e.g. in `vercel.css`).

**Default theme (`vercel`) — exact values**

| Token | Light (`[data-theme='vercel']`) | Dark (`[data-theme='vercel'].dark`) |
|---|---|---|
| `--chart-1` | `oklch(0.81 0.17 75.35)` | `oklch(0.81 0.17 75.35)` |
| `--chart-2` | `oklch(0.55 0.22 264.53)` | `oklch(0.58 0.21 260.84)` |
| `--chart-3` | `oklch(0.72 0 0)` | `oklch(0.56 0 0)` |
| `--chart-4` | `oklch(0.92 0 0)` | `oklch(0.44 0 0)` |
| `--chart-5` | `oklch(0.56 0 0)` | `oklch(0.92 0 0)` |

Values differ per theme (`claude`, `neobrutualism`, `supabase`, `mono`, `notebook`). The active theme is selected on `<html data-theme="…">` (default: `vercel` in `theme.config.ts`).

### 2b. Current Nivo `colors` prop

Both treemap instances use:

```tsx
colors={{ scheme: 'nivo' }}
```

Locations: level-1 payer treemap (line 192) and level-2 billing-type treemap (line 173) in `PayerBillingTreemap.tsx`.

This is Nivo’s built-in categorical palette, **not** `category10`.

### 2c. Visual consistency with the rest of the dashboard

**No — not consistent.**

Other Controlling charts use design tokens:

- `DriverRevenueChart`, `PayerComparisonChart`: `var(--chart-1)`, `var(--chart-2)` in chart config and legend swatches
- `RadialBreakdownChart`, `WheelchairStats`: `var(--chart-${index + 1})`

The treemap uses Nivo’s fixed orange/teal/red `nivo` scheme. Hues and saturation do not match the OKLCH `--chart-*` palette and do not track theme or dark-mode token updates.

### 2d. Passing `--chart-1` … `--chart-5` into Nivo

`ResponsiveTreeMap` declares:

```112:112:node_modules/@nivo/treemap/dist/types/types.d.ts
    colors: OrdinalColorScaleConfig<ComputedNodeWithoutStyles<Datum>>;
```

From `@nivo/colors` v0.99.0, `OrdinalColorScaleConfig` accepts:

| Form | Type |
|---|---|
| Static color | `string` |
| **Custom function** | `(d: Datum) => string` |
| Scheme object | `{ scheme: ColorSchemeId; size?: number }` |
| Custom array | `string[]` |
| Datum property | `{ datum: string }` |

**Confirmed:** a function `(node) => string` is valid on `ResponsiveTreeMap` in `@nivo/treemap` v0.99.0. The datum type is `ComputedNodeWithoutStyles<Datum>` (includes `id`, `path`, `value`, etc.; no guaranteed numeric `index`).

**Caveat:** `borderColor={{ from: 'color', modifiers: [['darker', 0.3]] }}` derives border colors from the node fill via Nivo’s color math. If `colors` returns `var(--chart-1)`, modifiers may not behave as reliably as with resolved hex/oklch strings. Worth verifying after any change.

### 2e. Existing utility for `getComputedStyle`?

**No.** Grep across `src/` found no `getComputedStyle` or `--chart` resolution helper.

Charts elsewhere pass `var(--chart-N)` directly in JSX/Recharts config (CSS handles theme/dark mode). For Nivo, the same `var(--chart-N)` approach in a `colors` callback is the lightest path and avoids JS resolution unless modifiers break.

---

## 3. Senior recommendation — minimal fixes

### Click bug

**Prefer fixing the guard (and `hasBillingTypes`), not `aggregatePayerTreemap`.**

| Approach | Rationale |
|---|---|
| **Recommended: click guard + tooltip** | Minimal, localized. Keep `'Ohne Typ'` in aggregation so level 2 stays correct when a payer has **both** real types and untyped revenue. |
| Not recommended: strip `'Ohne Typ'` in aggregator | Would hide untyped revenue in mixed payers or require duplicate logic for level 2. |

**Minimal condition** (same semantics for click and tooltip):

```ts
const hasRealBillingTypes = payer.billing_types.some(
  (bt) => bt.billing_type_id !== '__untyped__'
);
```

- `handlePayerClick`: `if (payer && hasRealBillingTypes) setSelectedPayer(payer);`
- `allPayersTreemapData`: `hasBillingTypes: hasRealBillingTypes` (or inline the same `.some(...)`)

Optional: extract a one-liner helper in `controlling-utils.ts` if both sites should stay in sync — still smaller than changing aggregation output shape.

### Color fix

**Replace** `colors={{ scheme: 'nivo' }}` **with a function that cycles design tokens:**

```tsx
const CHART_COLOR_VARS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
] as const;

// Stable index from node id (e.g. hash or sorted sibling index)
colors={(node) =>
  CHART_COLOR_VARS[
    Math.abs(hashString(String(node.id))) % CHART_COLOR_VARS.length
  ]
}
```

If `var(...)` breaks `borderColor` `darker` modifiers, resolve once on mount + theme change:

```ts
getComputedStyle(document.documentElement)
  .getPropertyValue('--chart-1')
  .trim();
```

No existing util — add a small hook (e.g. `useChartColors()`) only if `var()` proves insufficient; inline `getComputedStyle` in the component is acceptable for a first fix.

Apply the **same `colors` prop** on both level-1 and level-2 treemaps for consistency with `DriverRevenueChart`, `PayerComparisonChart`, and `RadialBreakdownChart`.

---

## Summary

| Bug | Root cause | Minimal fix |
|---|---|---|
| Click / "Ohne Typ" drill-down | `billing_types.length > 0` treats synthetic `'__untyped__'` as a real Abrechnungsart | Guard with `.some(bt => bt.billing_type_id !== '__untyped__')` in click handler and `hasBillingTypes` |
| Colors | `colors={{ scheme: 'nivo' }}` ignores `--chart-*` tokens | `colors={(node) => 'var(--chart-N)'}` (cycle by node id); fall back to `getComputedStyle` if border modifiers fail |
