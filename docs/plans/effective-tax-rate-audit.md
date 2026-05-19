# Effective tax rate audit (`effectiveTaxRatePercent` / `computeRow`)

> **Note:** Sections 1–4 capture the engine as audited originally (including `effectiveTaxRatePercent` semantics). **Fallback suppression when a `tax_rate` column exists** is implemented in `computeRow` — see **Resolution** at the end.

Source of truth as of this audit: `src/features/angebote/lib/angebot-formula-engine.ts`, `src/features/angebote/lib/angebot-formula-engine.test.ts`.

---

## 1. Exact signature and body of `effectiveTaxRatePercent` (or equivalent)

**Parameters:** `v: ResolvedRoleValues`, `fallbackTaxRate: number | null | undefined`.

**Fallback condition:** After reading `r = v.tax_rate`, the function returns `fallbackTaxRate` only when `r` is **not** a finite number — i.e. when `r` is `null`, `undefined`, non-finite, or (implicitly) missing from `v` such that `v.tax_rate` is `undefined`. If `fallbackTaxRate` is also nullish or non-finite, it returns `undefined`.

Verbatim from the engine:

```typescript
function effectiveTaxRatePercent(
  v: ResolvedRoleValues,
  fallbackTaxRate: number | null | undefined
): number | undefined {
  const r = v.tax_rate;
  if (r !== null && r !== undefined && isFinite(r)) return r;
  if (
    fallbackTaxRate !== null &&
    fallbackTaxRate !== undefined &&
    isFinite(fallbackTaxRate)
  ) {
    return fallbackTaxRate;
  }
  return undefined;
}
```

---

## 2. Where it is called inside `computeRow`

`computeRow` resolves role values, then assigns `effectiveTax = effectiveTaxRatePercent(v, options?.fallbackTaxRate)`. That value flows into gross-mode conversion (`taxRate` / `effectiveTax`), then into `taxAmount` and `grossAmount`.

Verbatim excerpt (`computeRow`: from `effectiveTax` through `grossAmount`):

```typescript
  const effectiveTax = effectiveTaxRatePercent(v, options?.fallbackTaxRate);

  const taxRate = effectiveTax;
  const canConvertGrossInputs =
    inputMode === 'gross' &&
    taxRate !== null &&
    taxRate !== undefined &&
    isFinite(taxRate) &&
    taxRate >= 0;

  const divisor = canConvertGrossInputs ? 1 + taxRate / 100 : null;
  const convertedV =
    canConvertGrossInputs && divisor
      ? {
          ...v,
          // WHY: only prices are tax-inclusive; distance and quantity are units, never converted.
          unit_price:
            v.unit_price != null ? v.unit_price / divisor : v.unit_price,
          flat_rate: v.flat_rate != null ? v.flat_rate / divisor : v.flat_rate,
          surcharge: v.surcharge != null ? v.surcharge / divisor : v.surcharge
        }
      : v;

  // In gross mode, persist converted net-equivalent price inputs back into the row
  // so the UI/PDF reflect the values the engine actually computed from.
  // Hard rule: only write when role exists and converted value is non-null.
  if (canConvertGrossInputs) {
    for (const col of columns) {
      switch (col.role) {
        case 'unit_price':
          if (convertedV.unit_price != null)
            patch[col.id] = convertedV.unit_price;
          break;
        case 'flat_rate':
          if (convertedV.flat_rate != null)
            patch[col.id] = convertedV.flat_rate;
          break;
        case 'surcharge':
          if (convertedV.surcharge != null)
            patch[col.id] = convertedV.surcharge;
          break;
        default:
          break;
      }
    }
  }

  const netAmount = computeNetAmount(convertedV);
  const taxAmount =
    netAmount === null || effectiveTax === undefined
      ? null
      : netAmount * (effectiveTax / 100);
  const grossAmount =
    netAmount === null
      ? null
      : netAmount * (1 + (effectiveTax ?? 0) / 100);
```

**Usage summary:** `taxAmount` is `null` when `netAmount` is `null` **or** when `effectiveTax === undefined` (no row rate and no usable fallback). Otherwise `taxAmount = netAmount * (effectiveTax / 100)`. `grossAmount` uses `(effectiveTax ?? 0) / 100` when `netAmount` is finite, so a missing effective rate yields gross equal to net (tax treated as 0% for that multiplication path).

---

## 3. Does `effectiveTaxRatePercent` receive `columns` (the schema)?

**No.** It only receives `v` (`ResolvedRoleValues`) and `fallbackTaxRate`. It has **no** direct schema argument.

**Scenario A vs B:**

- **`resolveRoleValues`** is schema-aware: it only writes `tax_rate` onto `v` when a column with `role === 'tax_rate'` exists; empty/null/`''` cells become `null` for that role.
- **Scenario A** (tax_rate column exists, cell empty): `v.tax_rate === null` → `effectiveTaxRatePercent` does **not** return `r`; it may use the fallback if finite.
- **Scenario B** (no tax_rate column): `v.tax_rate` is typically **`undefined`** (key absent on the partial record) → same branch: no finite `r`, fallback may apply.

So **`effectiveTaxRatePercent` itself cannot distinguish A from B** — it only sees the resolved `v.tax_rate`. In both A and B the outcome is “no finite per-row rate,” so behavior coincides unless callers rely on other signals elsewhere.

---

## 4. Current test coverage for the fallback

There is **no** nested `describe('fallbackTaxRate')` block in `angebot-formula-engine.test.ts`. The file ends with a multi-line comment (`WHY: documents precedence…`) followed by two **`it`** cases that exercise `options.fallbackTaxRate`:

1. **`computeRow — fallbackTaxRate when schema has no tax_rate column`** — passes `{ fallbackTaxRate: 10 }` with columns **without** `tax_rate`; asserts synthetic net/tax/gross (**scenario B**).
2. **`computeRow — per-row tax_rate beats fallbackTaxRate`** — schema **with** `tax_rate`, row has `tax: 7` and a higher fallback; asserts synthetic tax/gross use **7%**, not the fallback (precedence / “win” case, not empty cell).

**Scenario A** (tax_rate column present, cell empty/null, fallback supplied) is **not** covered by a dedicated test that asserts fallback-backed tax/gross. Related gross-mode test **`missing tax_rate: conversion is skipped`** uses `tax: null` with a tax_rate column but does **not** pass `fallbackTaxRate`.

---

## Gap (historical — pre-2026-05-19 fix)

Previously, `effectiveTaxRatePercent` alone could not distinguish scenario A from B; the fallback fired whenever `v.tax_rate` was non-finite, including when a `tax_rate` column existed but the cell was empty. Scenario A was not covered by a dedicated `fallbackTaxRate` test.

---

## Resolution

- **Status:** Resolved (2026-05-19).
- **Fix:** `schemaHasTaxRateColumn` guard in `computeRow` before the `effectiveTaxRatePercent` call — pass `resolvedFallback === null` when `columns.some((c) => c.role === 'tax_rate')`, otherwise pass `options?.fallbackTaxRate ?? null`.
- **Tests:** `computeRow — fallbackTaxRate ignored when tax_rate column exists but cell empty` (scenario A) and `computeRow — fallbackTaxRate still applies when no tax_rate column (scenario B)` confirm behaviour after the guard.
