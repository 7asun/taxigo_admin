# Stacked bar tooltip & hover audit — PayerBillingTreemap

Read-only audit of the **Balken** tab stacked bar in `PayerBillingTreemap.tsx`, compared with `PayerComparisonChart.tsx`, `DriverRevenueChart.tsx`, and `src/components/ui/chart.tsx`. No code was changed.

**Files reviewed**

- `src/features/controlling/components/PayerBillingTreemap.tsx` (lines 302–345)
- `src/features/controlling/components/PayerComparisonChart.tsx`
- `src/features/controlling/components/DriverRevenueChart.tsx`
- `src/components/ui/chart.tsx`

---

## 1. Tooltip — all billing types visible on hover

### 1a. Props passed to `ChartTooltipContent` (stacked bar)

In `PayerBillingTreemap.tsx`, `ChartTooltip` wraps `ChartTooltipContent` like this:

```tsx
<ChartTooltip
  content={
    <ChartTooltipContent
      formatter={(value, name) => [
        <span key='value' className='tabular-nums'>
          {formatEuro(Number(value))}
        </span>,
        stackedChartConfig[name as string]?.label ?? name
      ]}
    />
  }
/>
```

**Explicitly set on `ChartTooltipContent`:**

| Prop | Value |
|---|---|
| `formatter` | `(value, name) => [formattedEuroSpan, billingTypeLabel]` |

**Not set** (therefore defaults apply):

| Prop | Default |
|---|---|
| `indicator` | `'dot'` |
| `hideLabel` | `false` |
| `hideIndicator` | `false` |
| `hideZero` | *(prop does not exist)* |
| `label`, `labelFormatter`, `labelClassName`, `color`, `nameKey`, `labelKey`, `className` | unset |

**On `ChartTooltip` itself:** only `content` is set. No `cursor`, `filterNull`, or other props.

**On `Bar` components:** `key`, `dataKey`, `stackId`, `fill`, `radius` only. No `activeBar`, no `cursor`.

---

### 1b. Does `ChartTooltipContent` accept `hideZero`?

**No.** `chart.tsx` does not define or destructure a `hideZero` prop (or any similarly named zero-suppression prop).

Declared props on `ChartTooltipContent`:

```108:128:src/components/ui/chart.tsx
function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey
}: ...
```

**Behaviour:** every item in the Recharts `payload` array is rendered via `payload.map(...)` with no zero-value filtering:

```183:183:src/components/ui/chart.tsx
        {payload.map((item, index) => {
```

For a **stacked** bar, Recharts includes **one payload entry per `<Bar>` series** for the hovered x-axis category — including segments where `value === 0`. That is why all billing types appear in the tooltip even when most are zero for that payer.

---

### 1c. Custom `formatter` / `filter` for hiding zero entries

**No `filter` prop** exists on `ChartTooltipContent`.

**`formatter` is supported.** When present, it replaces the default row layout for each payload item, but **does not skip rows** — the map still iterates the full payload.

Exact call site in `chart.tsx`:

```196:197:src/components/ui/chart.tsx
              {formatter && item?.value !== undefined && item.name ? (
                formatter(item.value, item.name, item, index, item.payload)
```

Effective signature (inherited from Recharts `Tooltip` props plus local usage):

```ts
formatter?: (
  value: number | string,
  name: string,
  item: PayloadItem,
  index: number,
  payload: object
) => React.ReactNode;
```

Returning `null` from `formatter` would still leave the outer wrapper `<div>` for that index (empty row / spacing). **`formatter` alone cannot cleanly suppress zero rows.**

**Practical filter pattern:** pass a filtered `payload` into `ChartTooltipContent` from the Recharts `content` render prop:

```tsx
content={(props) => (
  <ChartTooltipContent
    {...props}
    payload={props.payload?.filter((p) => Number(p.value) !== 0)}
    ...
  />
)}
```

This is not a built-in prop — it relies on overriding the `payload` forwarded from Recharts.

---

### 1d. Reference charts — why their tooltips look clean

**PayerComparisonChart**

```122:125:src/features/controlling/components/PayerComparisonChart.tsx
            <ChartTooltip
              cursor={{ fill: 'var(--primary)', opacity: 0.05 }}
              content={<ChartTooltipContent indicator='dashed' />}
            />
```

**DriverRevenueChart**

```125:128:src/features/controlling/components/DriverRevenueChart.tsx
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator='dashed' />}
            />
```

Shared traits:

| Aspect | Reference charts | Stacked bar |
|---|---|---|
| `indicator` | `'dashed'` | default `'dot'` |
| `formatter` | **none** — default layout | custom tuple formatter |
| Series count | **2** fixed keys (`current`, `previous`) | **N** keys (all billing types globally) |
| Zero rows | At most 2 entries; often both non-zero | Many zero segments per payer |

Reference charts look clean mainly because they have **two series**, not because `ChartTooltipContent` filters zeros. The stacked bar exposes **every billing type id** as a separate `<Bar>`; Recharts puts all of them in the tooltip payload on hover.

The custom `formatter` in the stacked bar also bypasses the default label/value layout (indicator + `itemConfig.label` from `stackedChartConfig`), which differs visually from the reference charts.

---

## 2. Darkened background on hover

### 2a. `cursor` on stacked bar `BarChart` / `Bar`

| Location | `cursor` prop |
|---|---|
| `BarChart` | **not set** |
| Each `Bar` | **not set** |
| `ChartTooltip` | **not set** |

With no `cursor` on `ChartTooltip`, Recharts uses its **default** tooltip cursor: a rectangle behind the hovered bar group.

Additionally, `ChartContainer` applies global CSS that styles that rectangle:

```58:58:src/components/ui/chart.tsx
"... [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted ..."
```

So the hover highlight is the **default Recharts cursor filled with `muted`** — a visible grey/darkened band across the chart height. This is stronger and less subtle than the reference charts.

No `activeBar` prop is set on any `Bar` in the stacked bar chart.

---

### 2b. How reference charts handle the cursor

The `cursor` prop belongs on **`ChartTooltip`** (Recharts `Tooltip`), not on `BarChart` or individual `Bar` components.

**PayerComparisonChart** — subtle highlight (recommended match for grouped/stacked bars):

```tsx
cursor={{ fill: 'var(--primary)', opacity: 0.05 }}
```

**DriverRevenueChart** — disabled entirely:

```tsx
cursor={false}
```

Both patterns are valid. For a payer revenue bar chart, **PayerComparisonChart’s subtle primary fill** is the closer visual match to “correct” Controlling dashboard behaviour.

---

### 2c. `CartesianGrid` comparison

**Stacked bar (`PayerBillingTreemap`):**

```tsx
<CartesianGrid vertical={false} />
```

No `strokeDasharray`, no `opacity`, no `margin` on `BarChart`.

**PayerComparisonChart:**

```tsx
<BarChart data={chartData} margin={{ left: 12, right: 12 }}>
  <CartesianGrid vertical={false} strokeDasharray='3 3' opacity={0.3} />
```

**DriverRevenueChart:** no `CartesianGrid` at all.

The grid difference is minor for the reported issues; the tooltip cursor is the main hover-background concern.

---

## 3. Senior recommendation

### Issue A — Zero billing types shown in tooltip

**Root cause:** stacked chart defines one `<Bar>` per global billing type; Recharts tooltip payload includes all series; `ChartTooltipContent` has no `hideZero` and does not filter the payload.

**Exact fix — filter payload + align with reference tooltip style:**

```tsx
<ChartTooltip
  cursor={{ fill: 'var(--primary)', opacity: 0.05 }}
  content={(props) => (
    <ChartTooltipContent
      {...props}
      indicator='dashed'
      payload={props.payload?.filter((p) => Number(p.value) !== 0)}
      formatter={(value) => (
        <span className='tabular-nums'>{formatEuro(Number(value))}</span>
      )}
    />
  )}
/>
```

Notes:

- **`payload={...filter(...)}`** is the correct mechanism — there is no `hideZero` prop.
- Drop the `[value, name]` tuple `formatter`; use a single-value `formatter` and let `ChartTooltipContent` resolve labels from `stackedChartConfig` via `nameKey` / default `item.name` → config lookup (same as reference charts).
- Optionally add `nameKey='dataKey'` if config keys are billing type ids and payload names do not match.

If euro formatting in the default branch (`toLocaleString()`) is unacceptable, keep a simple `formatter` that only formats the value; still filter `payload` first.

---

### Issue B — Darkened background on hover

**Root cause:** `ChartTooltip` has no `cursor` prop → Recharts default rectangle + `ChartContainer` `fill-muted` styling → heavy grey overlay.

**Exact fix — match `PayerComparisonChart`:**

```tsx
<ChartTooltip
  cursor={{ fill: 'var(--primary)', opacity: 0.05 }}
  content={...}
/>
```

**Alternative** (if any hover band is unwanted): `cursor={false}` as in `DriverRevenueChart`.

Do **not** set `cursor` on `BarChart` or `Bar` — it has no effect there.

---

## Summary

| Issue | Current state | Recommended prop change |
|---|---|---|
| All billing types in tooltip | Full stacked payload rendered; no zero filter | `content={(props) => <ChartTooltipContent {...props} payload={props.payload?.filter(p => Number(p.value) !== 0)} indicator='dashed' ... />}` |
| Dark grey hover band | Default Recharts cursor + `fill-muted` CSS | `cursor={{ fill: 'var(--primary)', opacity: 0.05 }}` on `ChartTooltip` |
| Tooltip styling vs references | Custom tuple `formatter`, default `indicator='dot'` | `indicator='dashed'`; simplify `formatter`; filter `payload` |

No `hideZero` prop exists in this codebase’s `ChartTooltipContent`. Filtering `payload` before passing it to `ChartTooltipContent` is the minimal, correct fix.
