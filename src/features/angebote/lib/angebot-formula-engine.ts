import type {
  AngebotColumnDef,
  AngebotColumnRole
} from '../types/angebot.types';

/**
 * Angebot Formula Engine — pure TypeScript, zero React dependencies.
 * All functions are deterministic: same inputs always produce same outputs.
 * Do not import React, hooks, or component state into this file.
 * See docs/angebot-formula-engine.md for architecture and phase status.
 */

/**
 * A single row's data map: keys are AngebotColumnDef.id values.
 * Values are what the dispatcher entered (string from input) or null.
 */
export type RowData = Record<string, string | number | null>;

/**
 * Resolved numeric inputs extracted from a row, keyed by role.
 * null = the column for that role is absent or its value is unparseable.
 */
export type ResolvedRoleValues = Partial<
  Record<AngebotColumnRole, number | null>
>;

/**
 * Quote-level input mode.
 * 'net'  — dispatcher enters net prices; engine computes tax + gross (default).
 * 'gross' — dispatcher enters gross prices; engine interprets price inputs as gross
 *          and converts them to net-equivalents using tax_rate before computing.
 */
export type InputMode = 'net' | 'gross';

/**
 * Optional overrides for {@link computeRow}.
 */
export interface ComputeRowOptions {
  /**
   * Quote-level default MwSt percent (0–100). Applied only when the schema has **no**
   * `tax_rate` column and `resolveRoleValues` yields no finite `tax_rate` for the row.
   * If a `tax_rate` column exists, the column governs — empty/unparseable cells do **not**
   * fall back to this value (see `computeRow` guard before `effectiveTaxRatePercent`).
   * Per-row values including `0` always win — never overridden by this fallback.
   */
  fallbackTaxRate?: number | null;
}

/**
 * Effective VAT percent for tax/gross math after applying quote-level fallback.
 * WHY: keep precedence in one place — `resolveRoleValues` stays untouched per product rule.
 */
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

/**
 * Reserved keys written into item.data by computeRow on every update.
 * These are NOT column IDs — they are synthetic slots that always carry
 * the engine-computed net/tax/gross values regardless of whether those
 * role columns exist in the visible schema.
 *
 * WHY: the totals block must be schema-independent; `__` prefix makes collisions
 * with real column IDs extremely unlikely.
 */
export const SYNTHETIC_NET_KEY = '__net_amount__';
export const SYNTHETIC_TAX_KEY = '__tax_amount__';
export const SYNTHETIC_GROSS_KEY = '__gross_amount__';

/**
 * Extracts numeric values from a row by role.
 * For each role present in the column schema, reads data[col.id] and
 * parses it to a number. Unparseable or missing values become null.
 *
 * WHY: keep parsing isolated and deterministic so the engine is testable and
 * the builder never has to duplicate coercion rules across components.
 */
export function resolveRoleValues(
  row: RowData,
  columns: AngebotColumnDef[]
): ResolvedRoleValues {
  const result: ResolvedRoleValues = {};
  for (const col of columns) {
    if (!col.role) continue;
    const raw = row[col.id];
    if (raw === null || raw === undefined || raw === '') {
      result[col.role] = null;
    } else {
      const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
      result[col.role] = isFinite(n) ? n : null;
    }
  }
  return result;
}

/**
 * Computes net_amount from resolved role values.
 *
 * Formula:
 *   base       = (distance_km × unit_price) + flat_rate + surcharge
 *   net_amount = quantity present ? base × quantity : base
 *
 * flat_rate and surcharge are per-trip costs — they multiply with quantity.
 *
 * WHY: quotes must not show misleading zeros; without a unit price we cannot
 * compute a net amount, so we return null to render an empty computed cell.
 */
export function computeNetAmount(v: ResolvedRoleValues): number | null {
  // unit_price is the minimum required input — without it we cannot compute.
  if (v.unit_price === null || v.unit_price === undefined) return null;

  const distanceKm = v.distance_km ?? 0;
  const flatRate = v.flat_rate ?? 0;
  const surcharge = v.surcharge ?? 0;
  const quantity = v.quantity ?? null;

  const base = distanceKm * v.unit_price + flatRate + surcharge;
  return quantity !== null ? base * quantity : base;
}

/**
 * Computes all derived column values for a single row.
 * Returns a partial RowData patch — only the keys for computed-role columns
 * are included. Callers merge this patch into the existing row data.
 *
 * WHY: callers own persistence; returning a patch prevents accidental mutation
 * and keeps the engine usable in UI, PDF, and server-side pipelines later.
 */
export function computeRow(
  row: RowData,
  columns: AngebotColumnDef[],
  inputMode: InputMode = 'net',
  options?: ComputeRowOptions
): RowData {
  const v = resolveRoleValues(row, columns);
  const patch: RowData = {};

  // WHY: fallbackTaxRate must only apply when the schema has no tax_rate column
  // at all. If the admin added a tax_rate column, that column governs — even if
  // the dispatcher left the cell empty. Passing null suppresses the fallback
  // without changing effectiveTaxRatePercent's own logic.
  const schemaHasTaxRateColumn = columns.some((c) => c.role === 'tax_rate');
  const resolvedFallback = schemaHasTaxRateColumn
    ? null
    : (options?.fallbackTaxRate ?? null);

  const effectiveTax = effectiveTaxRatePercent(v, resolvedFallback);

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
    netAmount === null ? null : netAmount * (1 + (effectiveTax ?? 0) / 100);

  for (const col of columns) {
    switch (col.role) {
      case 'net_amount':
        patch[col.id] = netAmount;
        break;
      case 'tax_amount': {
        patch[col.id] = taxAmount;
        break;
      }
      case 'gross_amount': {
        patch[col.id] = grossAmount;
        break;
      }
      default:
        // Input role or no role — do not touch.
        break;
    }
  }

  // Always write synthetic totals keys regardless of schema columns —
  // so totals can be computed even when role columns are not visible.
  patch[SYNTHETIC_NET_KEY] = netAmount;
  patch[SYNTHETIC_TAX_KEY] = taxAmount;
  patch[SYNTHETIC_GROSS_KEY] = grossAmount;

  return patch;
}

const COMPUTED_ROLES = new Set<AngebotColumnRole>([
  'net_amount',
  'tax_amount',
  'gross_amount'
]);

/**
 * Returns true if this column's value is derived by the engine
 * and must not be manually edited by the dispatcher.
 *
 * WHY: this is the single point of truth for read-only enforcement so the UI
 * never hardcodes role strings in multiple places.
 */
export function isComputedColumn(col: AngebotColumnDef): boolean {
  return (
    col.role !== null && col.role !== undefined && COMPUTED_ROLES.has(col.role)
  );
}

/**
 * Sums net_amount, tax_amount, and gross_amount across all rows
 * for the Angebot PDF totals block.
 * Returns null for any total if no rows have a value for that role
 * (i.e. the Vorlage has no column with that role).
 * Only called when show_totals_block is true.
 *
 * WHY: the PDF totals block is opt-in and must stay stable even when
 * templates omit computed columns; returning null cleanly suppresses rows.
 */
export function computeAngebotTotals(
  rows: RowData[],
  columns: AngebotColumnDef[]
): {
  netTotal: number | null;
  taxTotal: number | null;
  grossTotal: number | null;
} {
  const sumKey = (key: string): number | null => {
    const values = rows
      .map((r) => r[key])
      .filter((v): v is number => typeof v === 'number' && isFinite(v));
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  };

  // Prefer synthetic keys (always present after Phase 4b).
  // Fall back to role-column IDs for backwards compatibility with
  // rows that were saved before Phase 4b.
  const netCol = columns.find((c) => c.role === 'net_amount');
  const taxCol = columns.find((c) => c.role === 'tax_amount');
  const grossCol = columns.find((c) => c.role === 'gross_amount');

  return {
    netTotal: sumKey(SYNTHETIC_NET_KEY) ?? (netCol ? sumKey(netCol.id) : null),
    taxTotal: sumKey(SYNTHETIC_TAX_KEY) ?? (taxCol ? sumKey(taxCol.id) : null),
    grossTotal:
      sumKey(SYNTHETIC_GROSS_KEY) ?? (grossCol ? sumKey(grossCol.id) : null)
  };
}
