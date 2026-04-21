// PDF layout constants — single source of truth for all spatial decisions.
// Units: pt (points). A4: 595 × 842pt. mm→pt: 72/25.4 ≈ 2.835pt per mm.
// Both invoice and quote PDF components must import from here.
// DIN 5008 Form B values live in PDF_DIN5008 (Brief mode).

export const PDF_PAGE = {
  width: 595, // A4
  height: 842, // A4
  marginLeft: 45, // current value. DIN 5008 ideal: 71pt (25mm) — defer to Brief mode
  marginRight: 45, // current value. DIN 5008 ideal: 57pt (20mm) — defer to Brief mode
  marginTop: 57,
  marginBottom: 100, // reserved for fixed footer + page number line
  marginLandscape: 36 // landscape appendix pages
} as const;

export const PDF_ZONES = {
  // Header / Briefkopf
  headerRowMarginBottom: 2,
  brandStackMarginBottom: 12,
  recipientBlockMarginTop: 4,

  // Subject margin variants
  subjectMarginTopWithReferenceBar: 6, // DIN 5008 body start is tighter when a reference bar already separates header from subject
  subjectMarginTopDefault: 8, // cover body internal fallback — overridden by InvoicePdfDocument conditional
  subjectMarginTopOffer: 12, // offer has no reference bar concept — uses fixed 12pt separation from header

  // Subject / Body spacing
  subjectMarginBottom: 16, // Betreff → Anrede
  salutationMarginBottom: 8, // Anrede → body text
  bodyMarginBottom: 16, // body text / intro prose → table
  outroMarginTop: 16, // table → outro prose
  closingMarginTop: 12, // outro → closing line

  // Table
  tableHeaderPaddingV: 6,
  tableHeaderPaddingH: 8,
  tableRowPaddingV: 5,
  tableRowPaddingH: 8,
  tableCellPaddingRight: 4,
  columnWidthFloor: 20, // minimum flex column width before layout warning

  // Footer
  footerBottom: 28,
  footerPaddingTop: 8,
  footerPageNumberTop: 818, // A4 842pt − 24pt reserved = 818pt

  // Invoice cover body inline values
  totalsSectionMarginTop: 8, // margin above totals block
  paymentParaMarginBottom: 4, // payment paragraph bottom spacing
  paymentParaMarginTop: 2, // payment paragraph top spacing
  paymentFirstRowMarginTop: 0 // first payment detail row override
} as const;

export const PDF_DIN5008 = {
  // DIN 5008 Form B — all values in pt, converted from mm at 72pt/25.4mm (2.8346pt/mm).
  // Source: KOMA-Script scrlttr2 toaddrvpos/toaddrwidth/toaddrheight defaults + DIN 5008:2020-03.
  // Do not hardcode mm values elsewhere — always reference this object.

  // Address window (Anschriftfeld) — DIN 5008 Form B
  addressWindowTop: 127.56, // 45mm — window starts here from page top
  addressWindowLeft: 56.69, // 20mm — from page left edge
  addressWindowWidth: 240.94, // 85mm — full window width
  addressWindowHeight: 127.56, // 45mm — full window height (incl. Rücksendeangabe zone)
  // Fold and hole marks (left margin, short horizontal lines)
  fold1: 297.64, // 105mm — Falzmarke 1
  lochmarke: 420.91, // 148.5mm — Lochmarke (hole punch guide)
  fold2: 595.28, // 210mm — Falzmarke 2
  foldMarkX: 5, // distance from physical page left edge
  foldMarkWidth: 10, // 3.5mm — mark length
  foldMarkStroke: 0.5 // line thickness in pt
} as const;

export const PDF_RENDER_MODES = ['digital', 'brief'] as const;
export type PdfRenderMode = (typeof PDF_RENDER_MODES)[number];

// mm to pt conversion utility — used for DIN 5008 calculations
export const mmToPt = (mm: number): number => Math.round(mm * 2.835);
