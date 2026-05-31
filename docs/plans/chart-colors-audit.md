# Chart color tokens audit — `--chart-1` … `--chart-5`

Read-only audit of chart design tokens across all themes. No code was changed.

**Files reviewed**

- `src/styles/themes/*.css` (6 theme files)
- `src/styles/theme.css`, `src/styles/globals.css`
- `src/components/themes/theme.config.ts`, `src/components/themes/active-theme.tsx`
- Grep of `src/` for `--chart-1` … `--chart-5` usage

**Hue classification rule used below**

| Label | OKLCH criterion |
|---|---|
| **Has hue** | Chroma ≥ 0.10 — clearly distinguishable color |
| **Low chroma** | 0.05 ≤ chroma < 0.10 — tinted but near-grey |
| **Neutral** | Chroma < 0.05 (incl. chroma = 0) — grey/black/white ramp |

---

## 1. Active theme

| Question | Answer |
|---|---|
| Default theme | **`vercel`** — `DEFAULT_THEME = 'vercel'` in `src/components/themes/theme.config.ts` |
| How applied | `ActiveThemeProvider` sets `data-theme="{activeTheme}"` on `<html>`. Cookie `active_theme` persists user choice; falls back to `initialTheme \|\| DEFAULT_THEME`. |
| Dark mode | `@custom-variant dark (&:is(.dark *))` in `globals.css`. Each theme defines a `[data-theme='…'].dark` block that overrides tokens. |
| Total themes | **6** — `claude`, `neobrutualism`, `supabase`, `vercel`, `mono`, `notebook` (listed in `THEMES` in `theme.config.ts`) |

There is no `tailwind.config.ts`; tokens live in per-theme CSS imported via `src/styles/theme.css`.

---

## 2. Chart token values — all themes

### vercel (default)

| Token | Light value | Dark value | Light hue | Dark hue |
|---|---|---|---|---|
| `--chart-1` | `oklch(0.81 0.17 75.35)` | `oklch(0.81 0.17 75.35)` | Has hue (warm/orange) | Has hue |
| `--chart-2` | `oklch(0.55 0.22 264.53)` | `oklch(0.58 0.21 260.84)` | Has hue (blue/violet) | Has hue |
| `--chart-3` | `oklch(0.72 0 0)` | `oklch(0.56 0 0)` | Neutral | Neutral |
| `--chart-4` | `oklch(0.92 0 0)` | `oklch(0.44 0 0)` | Neutral | Neutral |
| `--chart-5` | `oklch(0.56 0 0)` | `oklch(0.92 0 0)` | Neutral | Neutral |

### claude

| Token | Light value | Dark value | Light hue | Dark hue |
|---|---|---|---|---|
| `--chart-1` | `oklch(0.5583 0.1276 42.9956)` | `oklch(0.5583 0.1276 42.9956)` | Has hue | Has hue |
| `--chart-2` | `oklch(0.6898 0.1581 290.4107)` | `oklch(0.6898 0.1581 290.4107)` | Has hue | Has hue |
| `--chart-3` | `oklch(0.8816 0.0276 93.128)` | `oklch(0.213 0.0078 95.4245)` | Low chroma | Neutral |
| `--chart-4` | `oklch(0.8822 0.0403 298.1792)` | `oklch(0.3074 0.0516 289.323)` | Low chroma | Low chroma |
| `--chart-5` | `oklch(0.5608 0.1348 42.0584)` | `oklch(0.5608 0.1348 42.0584)` | Has hue | Has hue |

### neobrutualism

| Token | Light value | Dark value | Light hue | Dark hue |
|---|---|---|---|---|
| `--chart-1` | `oklch(0.6489 0.237 26.9728)` | `oklch(0.7044 0.1872 23.1858)` | Has hue | Has hue |
| `--chart-2` | `oklch(0.968 0.211 109.7692)` | `oklch(0.9691 0.2005 109.6228)` | Has hue | Has hue |
| `--chart-3` | `oklch(0.5635 0.2408 260.8178)` | `oklch(0.6755 0.1765 252.2592)` | Has hue | Has hue |
| `--chart-4` | `oklch(0.7323 0.2492 142.4953)` | `oklch(0.7395 0.2268 142.8504)` | Has hue | Has hue |
| `--chart-5` | `oklch(0.5931 0.2726 328.3634)` | `oklch(0.6131 0.2458 328.0714)` | Has hue | Has hue |

### supabase

| Token | Light value | Dark value | Light hue | Dark hue |
|---|---|---|---|---|
| `--chart-1` | `oklch(0.8348 0.1302 160.908)` | `oklch(0.8003 0.1821 151.711)` | Has hue | Has hue |
| `--chart-2` | `oklch(0.6231 0.188 259.8145)` | `oklch(0.7137 0.1434 254.624)` | Has hue | Has hue |
| `--chart-3` | `oklch(0.6056 0.2189 292.7172)` | `oklch(0.709 0.1592 293.5412)` | Has hue | Has hue |
| `--chart-4` | `oklch(0.7686 0.1647 70.0804)` | `oklch(0.8369 0.1644 84.4286)` | Has hue | Has hue |
| `--chart-5` | `oklch(0.6959 0.1491 162.4796)` | `oklch(0.7845 0.1325 181.912)` | Has hue | Has hue |

### mono

| Token | Light value | Dark value | Light hue | Dark hue |
|---|---|---|---|---|
| `--chart-1` | `oklch(0.5555 0 0)` | `oklch(0.5555 0 0)` | Neutral | Neutral |
| `--chart-2` | `oklch(0.5555 0 0)` | `oklch(0.5555 0 0)` | Neutral | Neutral |
| `--chart-3` | `oklch(0.5555 0 0)` | `oklch(0.5555 0 0)` | Neutral | Neutral |
| `--chart-4` | `oklch(0.5555 0 0)` | `oklch(0.5555 0 0)` | Neutral | Neutral |
| `--chart-5` | `oklch(0.5555 0 0)` | `oklch(0.5555 0 0)` | Neutral | Neutral |

All five slots are **identical grey** in both modes (intentional mono aesthetic).

### notebook

| Token | Light value | Dark value | Light hue | Dark hue |
|---|---|---|---|---|
| `--chart-1` | `oklch(0.3211 0 0)` | `oklch(0.9521 0 0)` | Neutral | Neutral |
| `--chart-2` | `oklch(0.4495 0 0)` | `oklch(0.8576 0 0)` | Neutral | Neutral |
| `--chart-3` | `oklch(0.5693 0 0)` | `oklch(0.7572 0 0)` | Neutral | Neutral |
| `--chart-4` | `oklch(0.683 0 0)` | `oklch(0.6534 0 0)` | Neutral | Neutral |
| `--chart-5` | `oklch(0.7921 0 0)` | `oklch(0.5452 0 0)` | Neutral | Neutral |

Greyscale **lightness ramp** only — distinguishable by L, not hue (intentional notebook aesthetic).

---

## 3. Gap analysis

### Neutral / grey tokens in **dark mode**

| Theme | Neutral tokens (dark) |
|---|---|
| **vercel** | `--chart-3`, `--chart-4`, `--chart-5` (chroma 0) |
| **claude** | `--chart-3` (chroma 0.0078); `--chart-4` low chroma (0.0516) |
| **mono** | All five (identical grey) |
| **notebook** | All five (greyscale ramp) |
| **neobrutualism** | None |
| **supabase** | None |

### Neutral / grey tokens in **light mode**

| Theme | Neutral / low-chroma tokens (light) |
|---|---|
| **vercel** | `--chart-3`, `--chart-4`, `--chart-5` (chroma 0) |
| **claude** | `--chart-3`, `--chart-4` (low chroma); `--chart-5` has hue |
| **mono** | All five |
| **notebook** | All five |
| **neobrutualism** | None |
| **supabase** | None |

### Distinct hue slots in **default theme (vercel) dark mode**

| Mode | Tokens with clear hue (chroma ≥ 0.10) | Count |
|---|---|---|
| Light | `--chart-1`, `--chart-2` | **2 / 5** |
| Dark | `--chart-1`, `--chart-2` | **2 / 5** |

`--chart-3` / `--chart-4` / `--chart-5` are neutral greys at different lightnesses — they do **not** provide categorical color differentiation.

---

## 4. Existing usage

### Components referencing `var(--chart-1)` … `var(--chart-5)`

| File | Tokens used | Pattern |
|---|---|---|
| `src/features/controlling/components/DriverRevenueChart.tsx` | `--chart-1`, `--chart-2` | ChartConfig + legend swatches |
| `src/features/controlling/components/PayerComparisonChart.tsx` | `--chart-1`, `--chart-2` | ChartConfig + legend swatches |
| `src/features/controlling/components/RadialBreakdownChart.tsx` | `--chart-1` … `--chart-5` (dynamic) | `var(--chart-${index + 1})` per segment |
| `src/features/controlling/components/WheelchairStats.tsx` | `--chart-1` … `--chart-5` (dynamic) | `var(--chart-${index + 1})` per segment |
| `src/features/controlling/components/PayerBillingTreemap.tsx` | `--chart-1`, `--chart-2` only | Slots 3+ use explicit OKLCH (workaround) |
| `src/features/overview/components/bar-graph.tsx` | `--chart-2` | Peak bar highlight |
| `src/features/dashboard/lib/payer-utils.ts` | `--chart-2` … `--chart-5` | Fallback palette after primary variants |

Theme CSS files map `--color-chart-N: var(--chart-N)` in each theme’s `@theme inline` block (Tailwind v4).

### Components relying on `--chart-3/4/5` having distinct hues

| Component | Risk on vercel dark today |
|---|---|
| **RadialBreakdownChart** | **Broken** for 3+ segments — segments 3–5 render as indistinguishable greys |
| **WheelchairStats** | **Broken** for 3+ categories — same grey collapse |
| **payer-utils** (`getPayerDistribution`, `getBillingTypeDistribution`, `getBillingVariantDistribution`) | **Broken** when palette index reaches `--chart-3/4/5` — grey segments |
| **DriverRevenueChart / PayerComparisonChart** | **OK** — only use `--chart-1` and `--chart-2` |
| **PayerBillingTreemap** | **Mitigated in code** — explicit OKLCH palette bypasses neutral tokens |
| **bar-graph (overview)** | **OK** — only `--chart-2` |

On **neobrutualism** and **supabase**, multi-segment charts work correctly. On **mono** and **notebook**, charts rely on grey ramps by design (different L, not hue). On **claude** dark, segment 3 is near-black neutral — also problematic for small charts.

---

## 5. Senior recommendation

### Default theme (`vercel`) — minimal fix

**Replace hues in existing neutral slots** (`--chart-3`, `--chart-4`, `--chart-5`). Do **not** add `--chart-6` / `--chart-7` unless the design system is extended project-wide — shadcn convention and all current components assume five slots.

Keep `--chart-1` and `--chart-2` unchanged (already strong warm + cool anchors).

Suggested values — perceptually balanced, evenly spaced hues avoiding overlap with chart-1 (~75°) and chart-2 (~261°):

| Token | Light (`[data-theme='vercel']`) | Dark (`[data-theme='vercel'].dark`) | Hue role |
|---|---|---|---|
| `--chart-1` | *(unchanged)* `oklch(0.81 0.17 75.35)` | *(unchanged)* `oklch(0.81 0.17 75.35)` | Warm orange |
| `--chart-2` | *(unchanged)* `oklch(0.55 0.22 264.53)` | *(unchanged)* `oklch(0.58 0.21 260.84)` | Blue |
| `--chart-3` | `oklch(0.55 0.18 142)` | `oklch(0.65 0.18 142)` | Green |
| `--chart-4` | `oklch(0.55 0.18 30)` | `oklch(0.65 0.18 30)` | Red-orange |
| `--chart-5` | `oklch(0.55 0.16 300)` | `oklch(0.65 0.16 300)` | Violet |

Rationale:

- Light mode L ≈ **0.55** — readable on white/light card backgrounds without washing out.
- Dark mode L ≈ **0.65** — readable on black/`oklch(0.14)` card surfaces without clipping to white.
- Chroma **0.16–0.18** — matches existing chart-1/2 saturation band.
- Hues at **142°, 30°, 300°** — roughly 120° apart from existing anchors, five distinct families.

**Scope:** one file change — `src/styles/themes/vercel.css` (light + dark blocks). No component changes required; `RadialBreakdownChart`, `WheelchairStats`, and `payer-utils` would inherit fixed tokens automatically.

### Optional follow-ups (out of scope for minimal fix)

| Item | Recommendation |
|---|---|
| **PayerBillingTreemap** | After vercel token fix, consider reverting explicit OKLCH slots 3–7 to `var(--chart-3)` … `var(--chart-5)` for theme consistency — or keep extended 7-slot palette if >5 categories are common. |
| **claude dark `--chart-3`** | Replace `oklch(0.213 0.0078 …)` with a chromatic green/teal at L ~0.55. |
| **mono / notebook** | Leave as-is — grayscale is intentional; document that multi-hue charts will not differentiate by color on these themes. |
| **New tokens `--chart-6+`** | Only if product needs >5 categorical colors **and** Tailwind `@theme` + ChartConfig patterns are updated everywhere. Replacing neutral slots is lower risk. |

### Decision summary

| Question | Answer |
|---|---|
| Add `--chart-6/7` or fix existing slots? | **Fix `--chart-3/4/5` in vercel** (and optionally claude dark chart-3). Keeps shadcn five-token contract. |
| Minimal token additions? | **Zero new tokens** — assign hues to three existing neutral slots in `vercel.css`. |
| Expected outcome | **5 distinct hue slots** in vercel light and dark; multi-segment Controlling charts work without per-component OKLCH workarounds. |
