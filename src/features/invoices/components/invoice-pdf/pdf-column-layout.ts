/**
 * pdf-column-layout.ts
 *
 * **Pure utilities** for Phase 6e dynamic PDF columns: no React, no network, no mutation of inputs.
 * Shared by `InvoicePdfCoverBody` (main table) and `InvoicePdfAppendix` (flat line items).
 *
 * **Constraints**
 * - Import column metadata only via `PDF_COLUMN_MAP` / `PdfColumnDef` from `pdf-column-catalog.ts`.
 * - Formatting dispatches on `col.valueSource` (first) and `col.format` — **never** `switch (col.key)`;
 *   new behaviour requires a catalog `format` or `valueSource` variant.
 * - Table layout in @react-pdf also relies on `pdf-styles.ts` (`tableHeader` / `tableRow` use
 *   `width: '100%'`, `flexDirection: 'row'`) and per-cell `minWidth: 0`, `overflow: 'hidden'`,
 *   `flexWrap: 'nowrap'` in the section components (Phase 6e alignment bugfix).
 */

import { format, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

import { formatTaxRate } from '@/features/invoices/lib/tax-calculator';
import type { PdfColumnDef } from '@/features/invoices/lib/pdf-column-catalog';
import {
  GROUPED_ROUTE_LEISTUNG_SOURCE,
  PDF_COLUMN_MAP
} from '@/features/invoices/lib/pdf-column-catalog';
import type { InvoiceLineItemRow } from '@/features/invoices/types/invoice.types';
import {
  tripMetaDirectionPdfLabel,
  parseTripMetaSnapshot
} from '@/features/invoices/lib/trip-meta-snapshot';
import {
  formatInvoicePdfDate,
  formatInvoicePdfEur
} from '@/features/invoices/components/invoice-pdf/lib/invoice-pdf-format';
import type { InvoicePdfSummaryRow } from '@/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary';

const PORTRAIT_USABLE_PT = 515;
const LANDSCAPE_USABLE_PT = 770;

const EM_DASH = '—';

/**
 * Reads a value from a row using a dot-separated path (e.g. `trip_meta_snapshot.driver_name`).
 *
 * Each segment walks into `Record` values. If the current value is a **string**, it is treated as
 * stringified JSON: **`JSON.parse`** runs before continuing — this covers PostgREST returning JSONB
 * as text while TypeScript still types the field as an object.
 *
 * @example getNestedValue(lineItem, 'trip_meta_snapshot.driver_name')
 * @returns `null` if any segment is missing or parsing fails
 */
export function getNestedValue(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split('.').filter(Boolean);
  if (parts.length === 0) return null;

  let current: unknown = obj;
  for (const part of parts) {
    if (current == null) return null;
    if (typeof current === 'string') {
      try {
        const parsed: unknown = JSON.parse(current);
        current = parsed;
      } catch {
        return null;
      }
    }
    if (typeof current !== 'object' || Array.isArray(current)) return null;
    const v = (current as Record<string, unknown>)[part];
    current = v === undefined ? null : v;
  }
  return current ?? null;
}

function parseJsonbField<T>(
  raw: string | T | null | undefined
): T | null | undefined {
  if (raw == null) return raw as null | undefined;
  if (typeof raw !== 'string') return raw;
  try {
    const v: unknown = JSON.parse(raw);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return v as T;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalizes JSONB fields that PostgREST may return as **strings** even when `InvoiceLineItemRow`
 * types them as objects. Without this, `getNestedValue` and `parseTripMetaSnapshot` see a string
 * where they expect a record.
 *
 * **Call once per line item** before `renderCellValue` (cover flat mode + appendix), not inside a
 * per-cell loop — avoids repeated parse work and keeps the coerced row stable for the whole row.
 *
 * Coerces **`trip_meta_snapshot`** (driver, H/R) and **`price_resolution_snapshot`** (optional UI /
 * tooling); PDF net display uses `total_price` + `tax_rate`, but parsing keeps nested access consistent.
 */
export function coerceLineItemJsonbSnapshots(
  item: InvoiceLineItemRow
): InvoiceLineItemRow {
  return {
    ...item,
    trip_meta_snapshot: parseJsonbField(item.trip_meta_snapshot) as
      | InvoiceLineItemRow['trip_meta_snapshot']
      | undefined,
    price_resolution_snapshot: parseJsonbField(
      item.price_resolution_snapshot
    ) as InvoiceLineItemRow['price_resolution_snapshot']
  };
}

/**
 * Line net for PDF from Bruttobetrag snapshot + VAT rate on the row.
 *
 * price_resolution_snapshot.net is unreliable — it may be missing for some pricing
 * strategies. Derive net from total_price ÷ (1 + tax_rate); both are always on
 * InvoiceLineItemRow. tax_rate is normally 0.07 / 0.19; values > 1 are treated as
 * whole percent (e.g. 7 → 7%).
 */
function netEuroFromLineItemGross(item: InvoiceLineItemRow): number {
  const gross = item.total_price ?? 0;
  const tr = item.tax_rate ?? 0;
  const rate = tr > 1 ? tr / 100 : tr;
  if (rate <= -1) return Math.round(gross * 100) / 100;
  const net = gross / (1 + rate);
  return Math.round(net * 100) / 100;
}

function formatDateCell(raw: unknown, fallbackIso?: string): string {
  if ((raw == null || raw === '') && fallbackIso) {
    return formatDateCell(fallbackIso);
  }
  if (raw == null || raw === '') return EM_DASH;
  const s = String(raw);
  try {
    const iso = s.includes('T') ? s : `${s}T12:00:00`;
    return formatInvoicePdfDate(parseISO(iso).toISOString());
  } catch {
    try {
      return format(new Date(s), 'dd.MM.yyyy', { locale: de });
    } catch {
      return EM_DASH;
    }
  }
}

function formatCurrencyCell(raw: unknown): string {
  if (raw == null || raw === '') return EM_DASH;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return EM_DASH;
  return formatInvoicePdfEur(n);
}

function formatPercentCell(raw: unknown): string {
  if (raw == null || raw === '') return EM_DASH;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return EM_DASH;
  return formatTaxRate(n);
}

function formatKmCell(raw: unknown): string {
  if (raw == null || raw === '') return EM_DASH;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return EM_DASH;
  const rounded = Math.round(n * 100) / 100;
  return `${rounded.toString().replace('.', ',')} km`;
}

function formatIntegerCell(raw: unknown): string {
  if (raw == null || raw === '') return EM_DASH;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(n)) return EM_DASH;
  return String(Math.round(n));
}

function formatTextCell(raw: unknown): string {
  if (raw == null) return EM_DASH;
  const s = String(raw).trim();
  return s.length ? s : EM_DASH;
}

function splitAddressDe(raw: string | null | undefined): {
  street: string;
  cityLine: string | null;
} {
  if (!raw?.trim()) return { street: EM_DASH, cityLine: null };
  const trimmed = raw.trim();
  const zipRegex = /\b\d{5}\s/;
  const match = trimmed.match(zipRegex);
  if (match && match.index !== undefined) {
    let street = trimmed.slice(0, match.index).trim();
    const cityLine = trimmed.slice(match.index).trim();
    if (street.endsWith(',')) street = street.slice(0, -1).trim();
    return { street: street || EM_DASH, cityLine: cityLine || null };
  }
  return { street: trimmed, cityLine: null };
}

function formatAddressDeCell(raw: unknown): string {
  if (raw == null || raw === '') return EM_DASH;
  const { street, cityLine } = splitAddressDe(String(raw));
  if (cityLine) return `${street}\n${cityLine}`;
  return street;
}

function formatDirectionCell(item: InvoiceLineItemRow): string {
  const tripMeta = parseTripMetaSnapshot(item.trip_meta_snapshot);
  return tripMetaDirectionPdfLabel(tripMeta);
}

function rawForLineItem(item: InvoiceLineItemRow, col: PdfColumnDef): unknown {
  const vs = col.valueSource;
  if (vs === 'trip_direction_pdf') return null;
  if (vs === 'summary_quantity_x') return item.quantity;
  if (vs === 'grouped_route_leistung') {
    return item.description?.trim() || EM_DASH;
  }
  return getNestedValue(item, col.dataField);
}

export interface RenderCellValueOptions {
  /** When line_date is missing, use this ISO for date columns (appendix). */
  fallbackDateIso?: string;
}

/**
 * Formats a line-item cell for the PDF table; dispatches on format and valueSource only.
 *
 * @param item — invoice line row
 * @param col — catalog column definition
 * @param options — optional fallback date for appendix rows
 * @returns display string (never empty — uses em dash)
 */
/**
 * @param item — must already be passed through coerceLineItemJsonbSnapshots when
 *   snapshots may be JSON strings (cover body + appendix do this per row).
 */
export function renderCellValue(
  item: InvoiceLineItemRow,
  col: PdfColumnDef,
  options?: RenderCellValueOptions
): string {
  if (col.valueSource === 'trip_direction_pdf') {
    return formatDirectionCell(item) || EM_DASH;
  }
  if (col.valueSource === 'line_net_eur') {
    return formatInvoicePdfEur(netEuroFromLineItemGross(item));
  }

  const raw = rawForLineItem(item, col);

  switch (col.format) {
    case 'date':
      return formatDateCell(raw, options?.fallbackDateIso);
    case 'currency':
      return formatCurrencyCell(raw);
    case 'percent':
      return formatPercentCell(raw);
    case 'km':
      return formatKmCell(raw);
    case 'integer':
      return formatIntegerCell(raw);
    case 'text':
      return formatTextCell(raw);
    case 'direction':
      return formatDirectionCell(item) || EM_DASH;
    case 'address_de':
      return formatAddressDeCell(raw);
    default:
      return formatTextCell(raw);
  }
}

function rawForGroupedRow(
  row: InvoicePdfSummaryRow,
  col: PdfColumnDef
): unknown {
  const vs = col.valueSource;
  if (vs === 'summary_quantity_x') return row.quantity;
  if (vs === 'line_net_eur') {
    // `InvoicePdfSummaryRow.total_price` is aggregated line net (incl. Anfahrt), not gross.
    return row.total_price;
  }
  if (vs === 'grouped_route_leistung') return null;
  return getNestedValue(row, col.dataField);
}

/**
 * Formats one **grouped** `InvoicePdfSummaryRow` cell (aggregated routes — not a line item).
 *
 * Only columns that exist or aggregate on the summary row should reach here. **`InvoicePdfCoverBody`**
 * enforces this via `mainTableKeys` (drops `flatOnly` columns when `main_layout === 'grouped'`).
 * Route/Leistung uses two `Text` lines in the cover component (`getGroupedRouteLines`), not this helper.
 */
export function renderGroupedCellValue(
  row: InvoicePdfSummaryRow,
  col: PdfColumnDef
): string {
  if (col.valueSource === 'summary_quantity_x') {
    return `${row.quantity}x`;
  }
  if (col.valueSource === 'grouped_route_leistung') {
    return getGroupedRouteLines(row).primary;
  }

  const raw = rawForGroupedRow(row, col);

  switch (col.format) {
    case 'date':
      return formatDateCell(raw);
    case 'currency':
      return formatCurrencyCell(raw);
    case 'percent':
      return formatPercentCell(raw);
    case 'km':
      return formatKmCell(raw);
    case 'integer':
      return formatIntegerCell(raw);
    case 'text':
      return formatTextCell(raw);
    case 'direction':
      return EM_DASH;
    case 'address_de':
      return formatAddressDeCell(raw);
    default:
      return formatTextCell(raw);
  }
}

/**
 * Route/Leistung primary + secondary for grouped two-line PDF cell.
 */
export function getGroupedRouteLines(row: InvoicePdfSummaryRow): {
  primary: string;
  secondary: string | null;
} {
  const primary = row.descriptionPrimary?.trim() || EM_DASH;
  const sec = row.descriptionSecondary?.trim();
  return { primary, secondary: sec ? sec : null };
}

/**
 * True when the column should render as Route/Leistung (two Text lines) on grouped cover.
 */
export function isGroupedRouteLeistungColumn(col: PdfColumnDef): boolean {
  return col.valueSource === GROUPED_ROUTE_LEISTUNG_SOURCE;
}

/**
 * Proportional column widths for dynamic tables. Usable width ≈ **515pt** portrait (main page),
 * **770pt** landscape (appendix when many columns) — matches DIN-style margins used in `pdf-styles`.
 *
 * **Algorithm:** `scale = usable / sum(defaultWidthPt)`; each column
 * `Math.max(Math.round(defaultWidthPt * scale), minWidthPt)`.
 * Per-column **rounding** can make the sum slightly exceed `usable` in edge cases; acceptable for PDF.
 */
export function calcColumnWidths(
  columnKeys: string[],
  isLandscape: boolean
): Record<string, number> {
  const usable = isLandscape ? LANDSCAPE_USABLE_PT : PORTRAIT_USABLE_PT;
  const cols = columnKeys
    .map((k) => PDF_COLUMN_MAP[k])
    .filter(Boolean) as PdfColumnDef[];
  if (cols.length === 0) return {};

  const totalDefault = cols.reduce((sum, c) => sum + c.defaultWidthPt, 0);
  const scale = totalDefault > 0 ? usable / totalDefault : 1;
  const result: Record<string, number> = {};
  for (const col of cols) {
    result[col.key] = Math.max(
      Math.round(col.defaultWidthPt * scale),
      col.minWidthPt
    );
  }
  return result;
}
