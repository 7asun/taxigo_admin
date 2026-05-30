# Invoice PDF Subcomponent Audit

Audit of [`InvoicePdfDocument.tsx`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) and its composition tree. Cross-referenced with [`build-draft-invoice-detail-for-pdf.ts`](../src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts), [`docs/invoices-module.md`](../invoices-module.md) (PDF Layout System + Phase 5/5b), and invoice type definitions under [`src/features/invoices/types/`](../src/features/invoices/types/).

**Date:** 2026-05-30  
**Scope:** Read-only analysis — no code changes.

---

## 1. File size and logical sections

**Line count:** **704 lines** (`wc -l`; 705 including EOF newline).

The root component is an **orchestrator**: ~260 lines of data preparation (lines 188–441) plus JSX that composes one cover `Page` and one or more appendix `Page`s inside a single `<Document>`.

### Rendered sections (with approximate line ranges in `InvoicePdfDocument.tsx`)

| # | Section | Lines (approx.) | Page | Notes |
|---|---------|-----------------|------|-------|
| — | Module init (hyphenation callback) | 76–78 | — | Side effect at import; not visual |
| — | `priceResolutionFromLineItem` helper | 127–175 | — | Pure transform for totals calc |
| — | Data preparation (recipient, salutation, line-item filters, totals, summary rows) | 188–441 | — | No JSX; runs on every render |
| 1 | **Document metadata** (`title`, `author`) | 444–451 | — | Storno vs normal title |
| 2 | **Cover page shell** (`<Page size="A4">`) | 452–568 | Cover | |
| 2a | Draft watermark (`ENTWURF`) | 453 | Cover | Gated by `showDraftWatermark` |
| 2b | **Brief mode DIN chrome** (Falzmarke 1, Lochmarke, Falzmarke 2) | 456–487 | Cover | Inline `<View>` + inline styles; `renderMode === 'brief'` only |
| 2c | **Brief mode address window** (`InvoicePdfRecipientBlock` in absolute container) | 489–504 | Cover | `renderMode === 'brief'` only |
| 2d | **Cover header** — digital (`InvoicePdfCoverHeader`) or brief (`InvoicePdfCoverHeaderBrief`) | 509–537 | Cover | Logo/branding, sender line, recipient, Rechnungsdaten meta grid |
| 2e | **Reference bar** (Bezugszeichen) | 539–541 | Cover | `InvoicePdfReferenceBar`; snapshot-driven |
| 2f | **Cover body** (`InvoicePdfCoverBody`) | 543–565 | Cover | Subject, intro, Haupttabelle, totals, payment/QR, outro — see §2 |
| 2g | **Footer** (`InvoicePdfFooter`) | 567 | Cover | Fixed footer; company profile + notes |
| 3 | **Fahrtendetails appendix** | 570–635 | Appendix | One page per billing-type group **or** single combined page |
| 3a | Draft watermark (appendix) | 598 / 624 | Appendix | Repeated per appendix page |
| 3b | Trip detail table (`InvoicePdfAppendix`) | 599–608 / 625–631 | Appendix | Dynamic columns from `columnProfile` |
| 3c | Footer (appendix) | 610 / 633 | Appendix | Same `InvoicePdfFooter` |
| 4 | **Passive cancelled trips appendix** (“Stornierte Fahrten”, €0 list) | 643–672 | Appendix 2 | Own `Page`; gated by profile + rows |
| 5 | **Excluded trips appendix** (“Ausgeschlossene Fahrten”) | 679–701 | Appendix 3 | Own `Page`; gated by profile + rows |

### Sub-sections inside `InvoicePdfCoverBody` (already extracted, lines 148–405 of `invoice-pdf-cover-body.tsx`)

| Sub-section | Cover-body lines |
|-------------|------------------|
| Subject + salutation + intro | 148–155 |
| Main line items table (Haupttabelle) | 157–290 |
| Totals block (net, VAT breakdown, gross) | 292–322 |
| Payment instructions + IBAN details + **QR block** | 324–390 |
| Outro + closing | 392–404 |

Per [`docs/invoices-module.md`](../invoices-module.md): cover = header + optional reference bar + body; appendices = Fahrtendetails (all billing-included rows), optional passive Stornierte, optional Ausgeschlossene — each with shared footer and optional draft watermark.

---

## 2. Extracted sub-components vs inline JSX

### Already extracted (separate files)

| Component | File | Used for |
|-----------|------|----------|
| `InvoicePdfCoverHeader` | `invoice-pdf-cover-header.tsx` | Digital mode header (+ exports `InvoicePdfBrandingBlock`, `InvoicePdfMetaGrid`, `InvoicePdfRecipientBlock`) |
| `InvoicePdfCoverHeaderBrief` | `invoice-pdf-cover-header-brief.tsx` | Brief mode header (DIN sender zone; address window is page-level) |
| `InvoicePdfReferenceBar` | `invoice-pdf-reference-bar.tsx` | Client reference fields snapshot |
| `InvoicePdfCoverBody` | `invoice-pdf-cover-body.tsx` | Subject through outro (table, totals, payment, QR) |
| `InvoicePdfFooter` | `invoice-pdf-footer.tsx` | Every page footer |
| `InvoicePdfAppendix` | `invoice-pdf-appendix.tsx` | Fahrtendetails table + passive cancelled + excluded blocks |

### Local to `InvoicePdfDocument.tsx` (same file, not separate module)

| Symbol | Lines | Role |
|--------|-------|------|
| `DraftWatermark` | 119–125 | Diagonal ENTWURF stamp |
| `priceResolutionFromLineItem` | 127–175 | Snapshot → `PriceResolution` for totals |

### Still inline JSX inside `InvoicePdfDocument.tsx`

| Block | Lines | Why inline |
|-------|-------|------------|
| Brief mode **fold marks** (3 horizontal rules) | 456–487 | Absolute-positioned `<View>` elements with ad-hoc style objects |
| Brief mode **address window wrapper** | 489–504 | Absolute container around `InvoicePdfRecipientBlock` |
| **Appendix page orchestration** | 570–701 | `<Page>` wrappers, landscape/portrait branching, `grouped_by_billing_type` IIFE that maps groups to pages, duplicated footer/watermark pattern |
| `<Document>` root attributes | 444–451 | Title/author from invoice + company profile |

### Data logic still in the component (not extracted)

~250 lines (188–441): `effectiveProfile` resolution, recipient/salutation construction, `mainLineItems` / `appendixLineItems` filtering, `lineItemsForCalc` mapping, `calculateInvoiceTotals`, `summaryItems` branch (`single_row` | `grouped_by_billing_type` | grouped/flat), due-date formatting, legacy snapshot `console.warn`.

---

## 3. Props on `InvoicePdfDocument`

Defined on `InvoicePdfDocumentProps` (lines 80–112):

| Prop | Type | Primary consumers | Single-section candidate? |
|------|------|-------------------|---------------------------|
| `invoice` | `InvoiceDetail` | Everywhere (header, body, appendix, totals, recipient logic, document title) | No — core model |
| `paymentQrDataUrl` | `string \| null` (optional, default `null`) | `InvoicePdfCoverBody` only | **Yes** — payment/QR sub-tree |
| `introText` | `string \| null` (optional, default `null`) | Resolved with `invoice.intro_block`, passed to `InvoicePdfCoverBody` | **Yes** — intro paragraph only |
| `outroText` | `string \| null` (optional, default `null`) | Resolved with `invoice.outro_block`, passed to `InvoicePdfCoverBody` | **Yes** — outro block only |
| `renderMode` | `PdfRenderMode` (optional, default `'digital'`) | Brief DIN chrome, header variant, passed through to cover body | Partial — brief chrome vs digital header |
| `columnProfile` | `PdfColumnProfile \| null` (optional, default `null`) | Merged into `effectiveProfile`; drives summary layout, appendix columns/orientation, cancelled/excluded gates | No — cross-cutting |
| `cancelledTrips` | `CancelledTripRow[]` (optional, default `[]`) | Passive “Stornierte Fahrten” appendix only (after `show_cancelled_trips` gate) | **Yes** — appendix 2 only |
| `excludedTrips` | `ExcludedTripRow[]` (optional, default `[]`) | “Ausgeschlossene Fahrten” appendix only (after `show_excluded_trips` gate) | **Yes** — appendix 3 only |
| `showDraftWatermark` | `boolean` (optional, default `false`) | `DraftWatermark` on **every** `Page` (cover + all appendices) | No — document-level concern |

### Related types (from `invoice.types.ts` / `pdf-vorlage.types.ts`)

- **`InvoiceDetail`**: full invoice + `payer`, `client`, `line_items`, `company_profile`, optional `intro_block` / `outro_block`, optional resolved `column_profile`.
- **`CancelledTripRow`**: passive cancelled trip shape for €0 appendix listing.
- **`ExcludedTripRow`**: opted-out normal trip shape for Ausgeschlossene appendix.
- **`PdfColumnProfile`**: resolved Vorlage (`main_columns`, `appendix_columns`, `main_layout`, `appendix_is_landscape`, `show_cancelled_trips`, `show_excluded_trips`, `source`).
- **`PdfRenderMode`**: `'digital' | 'brief'` from `pdf-layout-constants.ts`.

---

## 4. PDF styles

**No `StyleSheet.create` inside `InvoicePdfDocument.tsx`.**

Shared styles live in **[`pdf-styles.ts`](../src/features/invoices/components/invoice-pdf/pdf-styles.ts)**:

- **`PDF_COLORS`** — palette keys: `text`, `muted`, `lightGray`, `border`, `primary`, `accent`, `billingReason`, `white`
- **`PDF_FONT_SIZES`** — `xs`, `sm`, `base`, `md`, `lg`, `xl`, `xxl`
- **`PDF_DRAFT_WATERMARK`** — `label`, `fontSize`, `color`, `opacity`, `rotationDeg`
- **`styles`** (`StyleSheet.create`) — keys include:

  `page`, `htmlBlock`, `angebotPageBody`, `angebotPage`, `appendixPage`, `appendixPageLandscape`, `headerRow`, `referenceBarWrap`, `referenceBarRow`, `referenceBarCell`, `referenceBarLabel`, `referenceBarValue`, `headerLeft`, `headerRight`, `brandStack`, `sloganBelowLogo`, `rightTaxLine`, `senderOneLine`, `senderOneLineRule`, `recipientBlock`, `addressCompanySecondary`, `addressBlock`, `rightTaxBlock`, `addressCompanyName`, `addressPersonName`, `addressLine`, `secondaryLegalBlock`, `secondaryLegalLabel`, `secondaryLegalName`, `logoLeft`, `metaContainer`, `metaHeading`, `metaItem`, `metaItemLast`, `metaLabel`, `metaValue`, `invoiceTitle`, `invoiceNumber`, `subject`, `salutation`, `bodyText`, `bodyOutroSection`, `bodyOutro`, `bodyClosing`, `tableHeader`, `tableRow`, `tableRowAlt`, `routePrimary`, `routeSecondary`, `appendixColAddrCity`, `appendixKtsNote`, `appendixMoneyMuted`, `tableHeaderText`, `totalsSection`, `totalsRow`, `totalsLabel`, `totalsValue`, `totalsGrandSpacer`, `totalsGrandRow`, `totalsGrandLabel`, `totalsGrandValue`, `notesSection`, `notesLabel`, `notesText`, `paymentInstructions`, `paymentContentRow`, `paymentDetailsCol`, `paymentQrCol`, `paymentQr`, `paymentDetailRow`, `paymentLabel`, `paymentValue`, `boldText`, `normalText`, `appendixHeaderFixed`, `draftWatermark`, `draftWatermarkText`, `topRightBlock`, `topRightText`, `footer`, `footerCol`, `footerColThird`, `footerKontaktHeading`, `footerNote`, `footerText`, `footerBold`, `footerPageNumber`

**Inline styles in `InvoicePdfDocument.tsx`:** Brief-mode fold marks and address window (lines 457–496) use one-off style objects referencing `PDF_DIN5008`, `PDF_PAGE`, and `PDF_COLORS.text` — not keys from `styles`.

Layout spacing tokens come from **[`pdf-layout-constants.ts`](../src/features/invoices/lib/pdf-layout-constants.ts)** (`PDF_PAGE`, `PDF_ZONES`, `PDF_DIN5008`) per module docs.

---

## 5. Conditional rendering branches

| Condition | What it gates |
|-----------|---------------|
| `Font.getHyphenationCallback() === null` | One-time global hyphenation disable (import time) |
| `showDraftWatermark` | `<DraftWatermark />` on each `Page` (cover + every appendix variant) |
| `renderMode === 'brief'` | DIN fold marks + absolute address window + `InvoicePdfCoverHeaderBrief` |
| `renderMode !== 'brief'` (else) | `InvoicePdfCoverHeader` (digital flow header) |
| `referenceFieldsForPdf.length > 0` | `InvoicePdfReferenceBar` on cover |
| `referenceFieldsForPdf.length > 0` (derived) | `subjectSectionMarginTop` → `PDF_ZONES.subjectMarginTopWithReferenceBar` vs `subjectMarginTopOffer` on cover body |
| `effectiveProfile.show_cancelled_trips && cancelledTrips.length > 0` | `cancelledRowsForPdf` non-empty → passive Stornierte appendix **Page** |
| `effectiveProfile.show_excluded_trips && excludedTrips.length > 0` | `excludedRowsForPdf` non-empty → Ausgeschlossene appendix **Page** |
| `effectiveProfile.main_layout === 'grouped_by_billing_type'` | **Multiple** appendix pages (one per billing-type group) vs **single** appendix page |
| `effectiveProfile.appendix_is_landscape` | Appendix `Page` size `A4_LANDSCAPE` vs `'A4'`; `styles.appendixPageLandscape` vs `styles.appendixPage` |
| `invoice.cancels_invoice_id != null` (`isStorno`) | Document `title` prefix “Stornorechnung”; passed to header + cover body (subject label, default intro) |
| `invoice.mode === 'per_client' && !!client` (`isPerClientBilled`) | Recipient field sources (client vs payer); dual-block §14 logic |
| `snapPrimary` (from `rechnungsempfaenger_snapshot`) | Window recipient vs client/payer fallback |
| `!isPerClientBilled && !snapPrimary && invoice.id` | One-time `console.warn` for legacy missing snapshot |
| Salutation fallback (`salutation === 'Sehr geehrte…' && isPerClientBilled && !snapPrimary && client?.last_name`) | `client.greeting_style` → Herr/Frau salutation |
| `effectiveProfile.main_layout === 'single_row'` | `buildInvoicePdfSingleRow` for Haupttabelle |
| `effectiveProfile.main_layout === 'grouped_by_billing_type'` | `buildInvoicePdfGroupedByBillingType` + grouped appendix pages |
| Else (grouped/flat) | `buildInvoicePdfSummary` / single appendix with `mainLayout` prop |
| Empty billing-type groups in grouped appendix | `console.warn` when `invoice.id` set |
| `mainLineItems` filter | Excludes `is_cancelled_trip === true` from Haupttabelle |
| `appendixLineItems` filter | `billing_included !== false`; sorted by `line_date` |

---

## 6. Re-render surface

### Inside the PDF component tree

- **No `React.memo`, `useMemo`, or `useCallback`** anywhere under `src/features/invoices/components/invoice-pdf/` (grep confirmed).
- **`InvoicePdfDocument` is a plain function component.** Any prop change causes:
  1. Full re-execution of all data prep (188–441) — including `calculateInvoiceTotals`, line-item mapping, recipient resolution, summary building.
  2. Full re-render of the entire `<Document>` tree — cover header, body, all appendix pages, all footers.

### QR block specifically

- `paymentQrDataUrl` is passed only to `InvoicePdfCoverBody`, but **there is no isolation**: a QR-only update still re-renders appendices, header, and re-runs all orchestration logic in the parent.
- The QR `<Image>` lives inside `InvoicePdfCoverBody` (lines 384–388); it is not a separate memoized component.

### Builder preview (external but relevant)

[`use-invoice-builder-pdf-preview.tsx`](../src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx) mitigates cost at the **hook** level, not inside `InvoicePdfDocument`:

- **Category A** (layout/template, includes `paymentQrDataUrl`) → debounced auto `usePDF` update.
- **Category B** (trip line items, cancelled/excluded lists) → manual “Aktualisieren” only.
- `usePDF` still rebuilds the **whole** document blob on each trigger; `@react-pdf/renderer` runs layout on the main thread.

**Conclusion:** Re-render surface = **entire document**. Sub-components do not limit reconciliation today. Splitting sections only helps re-render if paired with memoization and stable prop slicing (not present).

---

## 7. Senior recommendation: highest-value extraction

### Recommended: extract **`InvoicePdfAppendixPages`** (appendix orchestrator)

**What to extract:** Lines **570–701** — all appendix `<Page>` construction (Fahrtendetails grouping, passive Stornierte, Ausgeschlossene), including repeated watermark + footer boilerplate and the `grouped_by_billing_type` IIFE.

**Why this is highest value among *sections*:**

1. **Complexity:** ~130 lines of duplicated page shell logic (size/style/watermark/footer) and the non-trivial billing-type grouping branch — the densest JSX remaining in the root file after headers/body were already split.
2. **Prop locality:** `cancelledTrips` and `excludedTrips` are only consumed here (after gating). Moving them down removes two root-level props and clarifies the cover vs appendix contract.
3. **Re-render surface (with follow-up memo):** Appendix pages are the most expensive part for large invoices (120+ trip rows, landscape tables). A memoized `InvoicePdfAppendixPages` that receives stable `appendixLineItems` + profile could skip appendix layout when Category A changes affect only cover (intro/outro, QR, column profile on main table) — **if** the parent passes narrowly memoized inputs. Today nothing is memoized; this extraction is the best **hook point** for that optimization.
4. **Aligns with docs:** Module docs already treat Fahrtendetails, passive Stornierte, and Ausgeschlossene as distinct appendix variants — one orchestrator matches the documented mental model.

**Secondary (complexity, not visual section):** Extract data prep (188–441) into a pure **`buildInvoicePdfDocumentModel(invoice, props)`** function. That would shrink the root file by ~35% and make unit testing recipient/summary logic possible without rendering PDF — but it does not by itself reduce re-render surface.

**Not recommended as first split:** Further splitting the QR block alone — small (~20 lines of JSX in cover body), and without `memo` the parent still re-renders everything via `usePDF` anyway. QR extraction pays off only together with memoizing `InvoicePdfCoverBody` or splitting payment from the Haupttabelle table.

---

## Appendix: composition diagram

```mermaid
flowchart TB
  Doc[InvoicePdfDocument]
  Doc --> CoverPage[Cover Page A4]
  Doc --> AppPages[Appendix Page(s)]
  Doc --> CancelPage[Stornierte Page optional]
  Doc --> ExclPage[Ausgeschlossene Page optional]

  CoverPage --> WM1[DraftWatermark]
  CoverPage --> BriefDIN[Brief fold marks + address window inline]
  CoverPage --> Header[CoverHeader digital or Brief]
  CoverPage --> RefBar[ReferenceBar optional]
  CoverPage --> Body[CoverBody]
  CoverPage --> Foot1[Footer]

  Body --> Subject[Subject + intro]
  Body --> MainTable[Haupttabelle]
  Body --> Totals[Totals]
  Body --> Payment[Payment + QR]
  Body --> Outro[Outro]

  AppPages --> WM2[DraftWatermark]
  AppPages --> Appendix[InvoicePdfAppendix]
  AppPages --> Foot2[Footer]
```

---

## Files referenced

| File | Role |
|------|------|
| `InvoicePdfDocument.tsx` | Root orchestrator (704 lines) |
| `invoice-pdf-cover-header.tsx` | Digital header + shared recipient/branding blocks |
| `invoice-pdf-cover-header-brief.tsx` | Brief mode header |
| `invoice-pdf-cover-body.tsx` | Cover page body (407 lines) |
| `invoice-pdf-appendix.tsx` | Appendix tables (583 lines) |
| `invoice-pdf-footer.tsx` | Shared footer |
| `invoice-pdf-reference-bar.tsx` | Bezugszeichen bar |
| `pdf-styles.ts` | Central StyleSheet (660 lines) |
| `build-draft-invoice-detail-for-pdf.ts` | Builder → synthetic `InvoiceDetail` for preview |
