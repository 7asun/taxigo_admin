/**
 * angebot-pdf-columns.ts
 *
 * Column definitions for the Angebot PDF line-items table (legacy catalog + dynamic schema widths).
 * Self-contained catalog — does not extend the invoice pdf-column-catalog.
 *
 * Portrait: invoice main table uses 499pt inner width (pdf-column-layout — after tableHeader paddingHorizontal 8×2).
 * Angebot uses ANGEBOT_PDF_AVAILABLE_WIDTH (515pt): the offer table follows the established Angebot layout and
 * styles.angebotPage padding (45+45) differs from how invoice rows inset their cells — verify pdf-styles
 * `angebotPage` / `tableHeader` when adjusting this constant.
 */

import type {
  AngebotColumnDef,
  AngebotColumnKey
} from '../../types/angebot.types';
import { resolveColumnLayout } from '../../lib/angebot-column-presets';

export interface AngebotPdfCatalogColumnDef {
  key: AngebotColumnKey;
  /** German column header rendered in the PDF table */
  label: string;
  /** Default column width in PDF points for portrait A4 */
  defaultWidthPt: number;
  /** Minimum column width — never shrink below this regardless of column count */
  minWidthPt: number;
  /** Text alignment in the PDF cell */
  align: 'left' | 'right' | 'center';
  /** How the raw value is formatted */
  format: 'integer' | 'text' | 'currency' | 'currency_per_km';
}

/*
 * Legacy fallback. Used by AngebotPdfDocument when table_schema_snapshot is null (pre-Phase-2a offers). Do not remove until all offers have a snapshot.
 */
export const ANGEBOT_COLUMN_CATALOG: AngebotPdfCatalogColumnDef[] = [
  {
    key: 'position',
    label: 'Pos.',
    defaultWidthPt: 28,
    minWidthPt: 24,
    align: 'center',
    format: 'integer'
  },
  {
    key: 'leistung',
    label: 'Leistung',
    defaultWidthPt: 220,
    minWidthPt: 100,
    align: 'left',
    format: 'text'
  },
  {
    key: 'anfahrtkosten',
    label: 'Anfahrtkosten',
    defaultWidthPt: 80,
    minWidthPt: 52,
    align: 'center',
    format: 'currency'
  },
  {
    key: 'price_first_5km',
    label: 'erste 5 km (je km)',
    defaultWidthPt: 80,
    minWidthPt: 52,
    align: 'center',
    format: 'currency_per_km'
  },
  {
    key: 'price_per_km_after_5',
    label: 'ab 5 km (je km)',
    defaultWidthPt: 80,
    minWidthPt: 52,
    align: 'center',
    format: 'currency_per_km'
  },
  {
    key: 'notes',
    label: 'Hinweis',
    defaultWidthPt: 120,
    minWidthPt: 80,
    align: 'left',
    format: 'text'
  }
];

export const ANGEBOT_COLUMN_MAP: Record<
  AngebotColumnKey,
  AngebotPdfCatalogColumnDef
> = Object.fromEntries(
  ANGEBOT_COLUMN_CATALOG.map((col) => [col.key, col])
) as Record<AngebotColumnKey, AngebotPdfCatalogColumnDef>;

/** Usable table width (pt) — same constant for calcAngebotColumnWidths, tests, and settings live preview. */
export const ANGEBOT_PDF_AVAILABLE_WIDTH = 515;

/**
 * Legacy width calc: distributes usable portrait width using catalog defaultWidthPt / minWidthPt.
 * Differs from {@link calcAngebotColumnWidths} (dynamic schema): invoice-style default scaling vs weight + minWidth redistribution.
 */
export function calcAngebotPdfCatalogColumnWidths(
  columnKeys: AngebotColumnKey[]
): Record<AngebotColumnKey, number> {
  const defs = columnKeys.map(
    (k) => ANGEBOT_COLUMN_MAP[k] ?? ANGEBOT_COLUMN_CATALOG[0]
  );

  const minTotal = defs.reduce((sum, d) => sum + d.minWidthPt, 0);
  const defaultTotal = defs.reduce((sum, d) => sum + d.defaultWidthPt, 0);
  const available = ANGEBOT_PDF_AVAILABLE_WIDTH;

  const result: Partial<Record<AngebotColumnKey, number>> = {};

  if (defaultTotal <= available) {
    defs.forEach((d) => {
      result[d.key] = d.defaultWidthPt;
    });
  } else if (minTotal <= available) {
    const extra = available - minTotal;
    const flexTotal = defaultTotal - minTotal;
    defs.forEach((d) => {
      const flex = d.defaultWidthPt - d.minWidthPt;
      result[d.key] =
        d.minWidthPt + (flexTotal > 0 ? (flex / flexTotal) * extra : 0);
    });
  } else {
    const equalWidth = Math.floor(available / defs.length);
    defs.forEach((d) => {
      result[d.key] = equalWidth;
    });
  }

  return result as Record<AngebotColumnKey, number>;
}

/**
 * Weight + minWidth based widths for dynamic templates.
 * Deviates from invoice `calcColumnWidths` / {@link calcAngebotPdfCatalogColumnWidths}: those scale catalog defaults;
 * this uses proportional weights with minWidth floors plus overflow / spare redistribution.
 */
export function calcAngebotColumnWidths(
  columns: AngebotColumnDef[]
): Record<string, number> {
  const minFloor = 20;
  const available = ANGEBOT_PDF_AVAILABLE_WIDTH;

  if (columns.length === 0) return {};

  // Step 1: Resolve layout spec for each column via resolveColumnLayout
  const specs = columns.map((col) => ({ col, spec: resolveColumnLayout(col) }));

  const widths: Record<string, number> = {};

  // Step 2: Sum all fixed-width columns → fixedTotal
  const fixedCols = specs.filter((x) => x.spec.width.mode === 'fixed');
  const fixedTotal = fixedCols.reduce(
    (sum, x) => sum + (x.spec.width.mode === 'fixed' ? x.spec.width.pt : 0),
    0
  );

  // Step 3: remaining = ANGEBOT_PDF_AVAILABLE_WIDTH (515) − fixedTotal
  let remaining = available - fixedTotal;

  // Step 4: If remaining <= 0 → warn to console, return fixed widths only (clamped to minFloor 20pt each, scaled proportionally)
  if (remaining <= 0) {
    console.warn(
      '[calcAngebotColumnWidths] Fixed columns exceed available width; scaling fixed widths.'
    );
    const rawFixed = fixedCols.map((x) => ({
      id: x.col.id,
      pt: Math.max(
        minFloor,
        x.spec.width.mode === 'fixed' ? x.spec.width.pt : 0
      )
    }));
    const sumFixed = rawFixed.reduce((s, x) => s + x.pt, 0);
    const scale = sumFixed > 0 ? available / sumFixed : 1;
    rawFixed.forEach((x) => {
      widths[x.id] = Math.max(minFloor, x.pt * scale);
    });
    // Ensure exact sum === available (floating remainder).
    const sum = Object.values(widths).reduce((s, v) => s + v, 0);
    const delta = available - sum;
    if (Math.abs(delta) > 0.001) {
      const widest = rawFixed.reduce(
        (acc, x) => (widths[x.id] > widths[acc] ? x.id : acc),
        rawFixed[0]?.id ?? ''
      );
      if (widest)
        widths[widest] = Math.max(minFloor, (widths[widest] ?? 0) + delta);
    }
    return widths;
  }

  fixedCols.forEach((x) => {
    if (x.spec.width.mode === 'fixed') widths[x.col.id] = x.spec.width.pt;
  });

  const fillCols = specs.filter((x) => x.spec.width.mode === 'fill');
  const autoCols = specs.filter((x) => x.spec.width.mode === 'auto');

  // Step 5: Fill columns (mode: 'fill') → split remaining equally among all fill columns
  if (fillCols.length > 0) {
    const share = remaining / fillCols.length;
    fillCols.forEach((x) => {
      widths[x.col.id] = share;
    });
    remaining -= share * fillCols.length;
  }

  // Step 6: Auto columns (mode: 'auto') → split remaining-after-fill proportionally by flex value
  if (autoCols.length > 0) {
    const flexTotal = autoCols.reduce(
      (sum, x) => sum + (x.spec.width.mode === 'auto' ? x.spec.width.flex : 0),
      0
    );
    const safeFlexTotal = flexTotal > 0 ? flexTotal : autoCols.length;
    autoCols.forEach((x) => {
      const flex = x.spec.width.mode === 'auto' ? x.spec.width.flex : 1;
      widths[x.col.id] = (flex / safeFlexTotal) * remaining;
    });
    remaining = 0;
  }

  // Step 7: Floating point remainder → add to the widest fill column; if no fill column, add to widest auto column; if neither, add to widest fixed column
  const sumAll = Object.values(widths).reduce((s, v) => s + v, 0);
  const remainder = available - sumAll;
  if (Math.abs(remainder) > 0.001) {
    const prefer =
      fillCols.length > 0
        ? fillCols
        : autoCols.length > 0
          ? autoCols
          : fixedCols;
    if (prefer.length > 0) {
      const widestId = prefer.reduce((acc, x) => {
        const id = x.col.id;
        return (widths[id] ?? 0) > (widths[acc] ?? 0) ? id : acc;
      }, prefer[0]!.col.id);
      widths[widestId] = Math.max(
        minFloor,
        (widths[widestId] ?? 0) + remainder
      );
    }
  }

  // Step 8: Return map of colId → resolved pt width; every value is a positive number; sum === 515
  for (const c of columns) {
    widths[c.id] = Math.max(minFloor, widths[c.id] ?? minFloor);
  }
  return widths;
}
