/**
 * pdf-column-catalog.ts
 *
 * **Single source of truth** for every PDF table column (Hauptseite + Anhang). Keys are
 * persisted in `pdf_vorlagen` / `invoices.pdf_column_override` JSONB — never rename after release.
 *
 * **Consumers**
 * - **Renderer** (`pdf-column-layout.ts`, `InvoicePdfCoverBody`, `InvoicePdfAppendix`) —
 *   resolves cells via `dataField` / `valueSource`, formats via `format`.
 * - **Width calculator** (`calcColumnWidths`) — `defaultWidthPt` / `minWidthPt` (portrait usable
 *   width ≈ 515pt after margins; landscape appendix ≈ 770pt).
 * - **Pickers** (`vorlage-editor-panel`, `step-4-vorlage`, `ColumnPicker`) — `MAIN_GROUPED_COLUMNS`,
 *   `MAIN_FLAT_COLUMNS`, `APPENDIX_COLUMNS` derived from flags below.
 * - **Validator / types** — `VALID_COLUMN_KEYS` feeds Zod in `pdf-vorlage.types.ts`; `PdfColumnKey`
 *   is inferred from this array (do not maintain a parallel union).
 *
 * **Adding a column:** append one `PdfColumnDef` to `PDF_COLUMN_CATALOG`. Discovery and pickers
 * update automatically; no other file is required for registration.
 *
 * **Layout flags (main table only; appendix uses `APPENDIX_COLUMNS`)**
 * - **`flatOnly`** — field exists on `InvoiceLineItemRow` but not on grouped `InvoicePdfSummaryRow`
 *   (e.g. Fahrgast, Adressen). Offered only when `main_layout === 'flat'`.
 * - **`groupedOnly`** — meaningful only for grouped aggregates (`route_leistung`, `quantity` as
 *   trip count per route). Offered only when `main_layout === 'grouped'`.
 * - **`appendixOnly`** — omitted from main pickers (`MAIN_*` filters); still in appendix picker
 *   unless also `groupedOnly` (e.g. `trip_direction`, `driver_name`).
 *
 * **Netto / Brutto columns (Phase 6e bugfix)**
 * - **`net_price`:** `dataField` is intentionally empty. Display uses `valueSource: 'line_net_eur'`
 *   only: net is derived as `total_price / (1 + tax_rate)` because `price_resolution_snapshot.net`
 *   is missing for some pricing strategies.
 * - **`gross_price`:** reads **`total_price`** via `dataField` with **`format: 'currency'`** and
 *   **no** `valueSource` — the Bruttobetrag snapshot is authoritative.
 *
 * @see resolvePdfColumnProfile — does **not** filter columns by layout; compatibility is enforced
 *   at render time in `InvoicePdfCoverBody` (`mainTableKeys`).
 */

/**
 * When set, the PDF pipeline resolves the cell from this branch instead of `dataField` alone.
 * `line_gross_eur` remains in the union for backward compatibility; `gross_price` uses `dataField` only.
 */
export type PdfColumnValueSource =
  | 'line_net_eur'
  | 'line_gross_eur'
  | 'trip_direction_pdf'
  /** Grouped main row: Route / Leistung primary + secondary (InvoicePdfSummaryRow) */
  | 'grouped_route_leistung'
  /** Grouped main row: quantity with “x” suffix (e.g. 3x); line items use plain integer */
  | 'summary_quantity_x';

export interface PdfColumnDef {
  /** Machine key — stored in DB jsonb arrays, never rename after first release */
  key: string;
  /** German column header rendered in the PDF table */
  label: string;
  /** German label shown in the Vorlage editor column picker */
  uiLabel: string;
  /** One-line German description shown as tooltip in the column picker */
  description: string;
  /**
   * Dot-notation path into InvoiceLineItemRow (or nested snapshot objects).
   * Ignored for display when valueSource is set (Phase 6e uses valueSource first).
   */
  dataField: string;
  /** Default column width in PDF points for portrait A4 (usable = 515pt) */
  defaultWidthPt: number;
  /** Minimum column width — never shrink below this regardless of column count */
  minWidthPt: number;
  /** Text alignment in the PDF cell */
  align: 'left' | 'right' | 'center';
  /**
   * How the raw value is formatted in the PDF cell.
   * The renderer has a single switch on this field — no per-key formatting logic.
   */
  format:
    | 'date'
    | 'currency'
    | 'percent'
    | 'km'
    | 'integer'
    | 'text'
    | 'direction'
    /** DE address: street + optional second line (PLZ Ort) for PDF cells */
    | 'address_de';
  /** Optional resolver for computed snapshot-derived cells (see PdfColumnValueSource). */
  valueSource?: PdfColumnValueSource;
  /**
   * When true, this column is hidden in the main page column picker.
   * It still appears in the appendix picker unless groupedOnly excludes it.
   */
  appendixOnly?: boolean;
  /**
   * When true, column is only offered for main table when Vorlage main_layout is grouped
   * (e.g. aggregated quantity).
   */
  groupedOnly?: boolean;
  /**
   * When true, column is only offered for main table when Vorlage main_layout is flat
   * (per-trip fields).
   */
  flatOnly?: boolean;
}

/** ValueSource for grouped Route/Leistung column — used by cover body for two-line cell. */
export const GROUPED_ROUTE_LEISTUNG_SOURCE: PdfColumnValueSource =
  'grouped_route_leistung';

export const PDF_COLUMN_CATALOG: PdfColumnDef[] = [
  {
    key: 'position',
    label: 'Pos.',
    uiLabel: 'Position (Nr.)',
    description: 'Laufende Positionsnummer der Zeile',
    dataField: 'position',
    defaultWidthPt: 28,
    minWidthPt: 24,
    align: 'center',
    format: 'integer'
  },
  {
    key: 'route_leistung',
    label: 'Route / Leistung',
    uiLabel: 'Route / Leistung',
    description:
      'Gruppierte Haupttabelle: Leistungstext (Hin-/Rückfahrt, Adressen)',
    dataField: 'descriptionPrimary',
    defaultWidthPt: 284,
    minWidthPt: 120,
    align: 'left',
    format: 'text',
    valueSource: 'grouped_route_leistung',
    groupedOnly: true
  },
  {
    key: 'trip_date',
    label: 'Datum',
    uiLabel: 'Fahrtdatum',
    description: 'Datum der Fahrt (TT.MM.JJJJ)',
    dataField: 'line_date',
    defaultWidthPt: 52,
    minWidthPt: 44,
    align: 'left',
    format: 'date',
    flatOnly: true
  },
  {
    key: 'client_name',
    label: 'Fahrgast',
    uiLabel: 'Fahrgastname',
    description: 'Vor- und Nachname des Fahrgastes',
    dataField: 'client_name',
    defaultWidthPt: 90,
    minWidthPt: 70,
    align: 'left',
    format: 'text',
    flatOnly: true
  },
  {
    key: 'billing_variant',
    label: 'Abrechnungsart',
    uiLabel: 'Abrechnungsart',
    description: 'Name der Abrechnungsvariante (z. B. Dialyse, Reha)',
    dataField: 'billing_variant_name',
    defaultWidthPt: 80,
    minWidthPt: 60,
    align: 'left',
    format: 'text',
    flatOnly: true
  },
  {
    key: 'description',
    label: 'Beschreibung',
    uiLabel: 'Beschreibungstext',
    description: 'Freitextbeschreibung der Fahrt',
    dataField: 'description',
    defaultWidthPt: 120,
    minWidthPt: 80,
    align: 'left',
    format: 'text',
    flatOnly: true
  },
  {
    key: 'pickup_address',
    label: 'Von',
    uiLabel: 'Abholadresse',
    description: 'Startadresse der Fahrt',
    dataField: 'pickup_address',
    defaultWidthPt: 110,
    minWidthPt: 80,
    align: 'left',
    format: 'address_de',
    flatOnly: true
  },
  {
    key: 'dropoff_address',
    label: 'Nach',
    uiLabel: 'Zieladresse',
    description: 'Zieladresse der Fahrt',
    dataField: 'dropoff_address',
    defaultWidthPt: 110,
    minWidthPt: 80,
    align: 'left',
    format: 'address_de',
    flatOnly: true
  },
  {
    key: 'distance_km',
    label: 'km',
    uiLabel: 'Fahrtstrecke (km)',
    description: 'Gefahrene Strecke in Kilometern',
    dataField: 'distance_km',
    defaultWidthPt: 40,
    minWidthPt: 32,
    align: 'right',
    format: 'km',
    flatOnly: true
  },
  {
    key: 'driver_name',
    label: 'Fahrer',
    uiLabel: 'Fahrername',
    description: 'Name des Fahrers zum Zeitpunkt der Fahrt',
    dataField: 'trip_meta_snapshot.driver_name',
    defaultWidthPt: 70,
    minWidthPt: 55,
    align: 'left',
    format: 'text',
    appendixOnly: true,
    flatOnly: true
  },
  {
    key: 'trip_direction',
    label: 'H/R',
    uiLabel: 'Hin- / Rückfahrt',
    description: 'Kennzeichnung Hin- oder Rückfahrt aus der Fahrt-Snapshot',
    dataField: 'trip_meta_snapshot',
    defaultWidthPt: 28,
    minWidthPt: 24,
    align: 'center',
    format: 'direction',
    valueSource: 'trip_direction_pdf',
    appendixOnly: true
  },
  {
    key: 'quantity',
    label: 'Menge',
    uiLabel: 'Menge',
    description:
      'In der gruppierten Tabelle: Anzahl Fahrten pro Route; in der Flachtabelle: Einheiten (meist 1)',
    dataField: 'quantity',
    defaultWidthPt: 36,
    minWidthPt: 28,
    align: 'right',
    format: 'integer',
    valueSource: 'summary_quantity_x',
    groupedOnly: true
  },
  {
    key: 'unit_price_net',
    label: 'EP Netto',
    uiLabel: 'Einzelpreis Netto',
    description: 'Nettopreis pro Einheit',
    dataField: 'unit_price',
    defaultWidthPt: 52,
    minWidthPt: 44,
    align: 'right',
    format: 'currency',
    flatOnly: true
  },
  {
    key: 'net_price',
    label: 'Netto',
    uiLabel: 'Gesamtpreis Netto',
    description:
      'Nettobetrag aus Brutto ÷ (1 + MwSt.-Satz) — nicht aus dem Preis-Snapshot, dort fehlt .net oft',
    dataField: '',
    defaultWidthPt: 55,
    minWidthPt: 44,
    align: 'right',
    format: 'currency',
    valueSource: 'line_net_eur'
  },
  {
    key: 'tax_rate',
    label: 'MwSt.',
    uiLabel: 'Mehrwertsteuersatz',
    description: 'Angewendeter Mehrwertsteuersatz (7% oder 19%)',
    dataField: 'tax_rate',
    defaultWidthPt: 36,
    minWidthPt: 28,
    align: 'right',
    format: 'percent'
  },
  {
    key: 'gross_price',
    label: 'Brutto',
    uiLabel: 'Gesamtpreis Brutto',
    description: 'Gesamter Bruttobetrag der Zeile (inkl. MwSt.)',
    dataField: 'total_price',
    defaultWidthPt: 58,
    minWidthPt: 48,
    align: 'right',
    format: 'currency'
  },
  {
    key: 'billing_type',
    label: 'Typ',
    uiLabel: 'Abrechnungstyp (Code)',
    description: 'Kurzcode der Abrechnungsvariante',
    dataField: 'billing_variant_code',
    defaultWidthPt: 40,
    minWidthPt: 32,
    align: 'center',
    format: 'text',
    flatOnly: true
  }
];

/** Union type of all valid column keys, auto-derived from the catalog. */
export type PdfColumnKey = (typeof PDF_COLUMN_CATALOG)[number]['key'];

export const PDF_COLUMN_MAP: Record<string, PdfColumnDef> = Object.fromEntries(
  PDF_COLUMN_CATALOG.map((col) => [col.key, col])
);

export const VALID_COLUMN_KEYS = PDF_COLUMN_CATALOG.map((c) => c.key) as [
  PdfColumnKey,
  ...PdfColumnKey[]
];

/** Legacy: all columns that may appear on the main page picker (non-appendix-only). */
export const MAIN_PAGE_COLUMNS = PDF_COLUMN_CATALOG.filter(
  (c) => !c.appendixOnly
);

/** Main table grouped layout — excludes flat-only columns. */
export const MAIN_GROUPED_COLUMNS = PDF_COLUMN_CATALOG.filter(
  (c) => !c.appendixOnly && !c.flatOnly
);

/** Main table flat layout — excludes grouped-only columns. */
export const MAIN_FLAT_COLUMNS = PDF_COLUMN_CATALOG.filter(
  (c) => !c.appendixOnly && !c.groupedOnly
);

/** Appendix picker: all columns except grouped-only (no route_leistung / quantity aggregates). */
export const APPENDIX_COLUMNS = PDF_COLUMN_CATALOG.filter(
  (c) => !c.groupedOnly
);

/** System fallback when no Vorlage applies — matches legacy 5-column grouped cover. */
export const SYSTEM_DEFAULT_MAIN_COLUMNS: PdfColumnKey[] = [
  'position',
  'route_leistung',
  'quantity',
  'tax_rate',
  'gross_price'
];

export const SYSTEM_DEFAULT_APPENDIX_COLUMNS: PdfColumnKey[] = [
  'position',
  'trip_date',
  'client_name',
  'pickup_address',
  'dropoff_address',
  'distance_km',
  'net_price'
];

/**
 * Appendix uses landscape A4 when column count exceeds this threshold
 * (strictly greater than).
 */
export const APPENDIX_LANDSCAPE_THRESHOLD = 7;
