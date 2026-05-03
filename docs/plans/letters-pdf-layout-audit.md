# Letters PDF layout audit

**Scope:** Read-only audit of letter, invoice, and offer (Angebot) PDF code paths, shared layout constants/styles, and data flow from the letter builder UI. No code was modified.

**Path notes:**

- There is **no** `src/features/letters/pdf/` directory. Letter PDFs live under `src/features/letters/components/letter-pdf/` (`letter-pdf-document.tsx`, `letter-pdf-cover-body.tsx`).
- There is **no** `src/features/quotes/pdf/` directory. “Quote” PDFs are **Angebote** under `src/features/angebote/components/angebot-pdf/`.
- There is **no** `src/features/shared/pdf/`. Shared PDF concerns are centralized in `src/features/invoices/lib/pdf-layout-constants.ts` and `src/features/invoices/components/invoice-pdf/pdf-styles.ts`, with cross-feature imports from invoices (by design).

---

## 1. Letter PDF structure overview

### Main React components

| Role | Component | Path |
|------|-----------|------|
| Root document | `LetterPdfDocument` | `src/features/letters/components/letter-pdf/letter-pdf-document.tsx` |
| Page shell | `Page` (`@react-pdf/renderer`) | Same file |
| DIN fold marks | Three `View` “lines” | Same file (decorative) |
| Address window | `View` + `InvoicePdfRecipientBlock` | Same file |
| Header (Brief) | `InvoicePdfCoverHeaderBrief` | `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header-brief.tsx` |
| Body / prose | `LetterPdfCoverBody` | `src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx` |
| Body wrapper | `View` using `styles.angebotPageBody` | `letter-pdf-document.tsx` |
| Footer | `InvoicePdfFooter` | `src/features/invoices/components/invoice-pdf/invoice-pdf-footer.tsx` |

There is **no** separate `LetterPdfPage` component; one `Page` wraps everything.

### Single-page structure (order of composition)

1. **`Document`** — `title` from letter number (or fallback `Brief-{id prefix}`), `author` from company profile.
2. **`Page`** — `size="A4"`, `style={styles.angebotPage}`, `wrap` enabled.
3. **Fold marks** — three absolutely positioned `View`s (top border as line) at `PDF_DIN5008.fold1`, `lochmarke`, `fold2`; `left: PDF_DIN5008.foldMarkX`, width `foldMarkWidth`, stroke `foldMarkStroke`, color `PDF_COLORS.text`.
4. **Address window** — `View` with `position: 'absolute'`, `top: PDF_DIN5008.addressWindowTop`, `left: PDF_PAGE.marginLeft`, `width: '52%'`, `maxHeight: PDF_DIN5008.addressWindowHeight`, `overflow: 'hidden'`, containing `InvoicePdfRecipientBlock`.
5. **`InvoicePdfCoverHeaderBrief`** — row: left branding + sender line, right meta grid (`styles.headerRow` → `headerLeft` / `headerRight`). **No** recipient in header (Brief path C).
6. **`View`** — `style={styles.angebotPageBody}` plus **`marginTop: PDF_ZONES_LETTER.briefBodyExtraMarginTop`** (letter-only clearance below the absolute DIN window; see [`letters-pdf-din-alignment-audit.md`](letters-pdf-din-alignment-audit.md) §9), `wrap` enabled; child **`LetterPdfCoverBody`**.
7. **`InvoicePdfFooter`** — fixed footer block + fixed page number line (see shared primitives).

### `LetterPdfCoverBody` inner structure

- Fragment with:
  - **`View`** — `marginTop: PDF_ZONES.subjectMarginTopOffer` (12pt). Optional **`Text`** `styles.subject` if `letter.subject` trimmed; always **`Text`** `styles.salutation` (computed greeting).
  - Conditional **`View`** — if `bodyHtml` non-empty: `wrap`, `styles.htmlBlock`, `marginBottom: PDF_ZONES.bodyMarginBottom`, child **`Html`** (`react-pdf-html`) with local `LETTER_HTML_STYLESHEET`.
  - **`View`** — `marginTop: PDF_ZONES.closingMarginTop`, **`wrap={false}`**, child **`Text`** `styles.bodyClosing` (“Mit freundlichen Grüßen,”).

### Major `View` containers and key layout props (letter page)

- **Fold marks:** `position: 'absolute'`, `top` (DIN constants), `left: foldMarkX`, `width: foldMarkWidth`, border-top as line.
- **Address window:** `position: 'absolute'`, `top`, `left`, `width: '52%'`, `maxHeight`, `overflow: 'hidden'`.
- **`angebotPageBody` wrapper:** `flex: 1`, `width: '100%'` (from `pdf-styles.ts`); **`wrap`** on the instance in `LetterPdfDocument`.
- **Subject block:** default column flow (no explicit `flexDirection`; react-pdf column stacking).
- **HTML body:** `width: '100%'` via `htmlBlock`; **`wrap`** enabled.
- **Closing block:** **`wrap={false}`** on the wrapping `View`.

---

## 2. Invoice / quote (Angebot) PDF structure overview

### Invoice (`InvoicePdfDocument`)

**Path:** `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`

- **Root:** `Document` + one or more **`Page`** components.
- **Cover `Page`:** `size="A4"`, `style={styles.page}`, `wrap`.
  - **Brief mode only:** same fold marks + absolute address window pattern as letters (recipient in window, not in header).
  - **Header:** `InvoicePdfCoverHeaderBrief` (brief) or **`InvoicePdfCoverHeader`** (digital; recipient in flow under branding).
  - **Optional** `InvoicePdfReferenceBar` (client reference fields).
  - **`InvoicePdfCoverBody`** — subject (“Rechnung Nr. …” / Storno), salutation, intro text, **table** (grouped/flat/single_row), totals, payment block + QR, outro + closing. Not wrapped in `angebotPageBody` (direct flow after header).
  - **`InvoicePdfFooter`** — same fixed footer as letters.
- **Additional pages:** appendix `Page`(s) (`styles.appendixPage` or `appendixPageLandscape`), each with `InvoicePdfAppendix` + footer; optional cancelled-trips page.

### Quote / offer (`AngebotPdfDocument`)

**Path:** `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`

- **Single `Page`:** `size="A4"`, `style={styles.angebotPage}`, `wrap` (same shell style as **letters**, not `styles.page`).
- **Brief mode:** optional same absolute fold + window + `InvoicePdfCoverHeaderBrief`; **digital:** `InvoicePdfCoverHeader` with `metaConfig` for Angebot labels.
- **`View`** `style={styles.angebotPageBody}` **`wrap`** → **`AngebotPdfCoverBody`**.
- **`InvoicePdfFooter`**.

### `AngebotPdfCoverBody` (central content)

**Path:** `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`

- Subject (optional) + salutation in a `View` with `marginTop: PDF_ZONES.subjectMarginTopOffer`.
- Optional intro `Html` in `View` with `wrap`, `styles.htmlBlock`, `marginBottom: PDF_ZONES.bodyMarginBottom`.
- Optional **table:** `styles.tableHeader`, `styles.tableRow` per line item, many rows with **`wrap={false}`** per row.
- Optional outro `Html` with `wrap`, `bodyOutroSection` + `htmlBlock`, extra `marginTop: PDF_ZONES.outroMarginTop`.

### Main body `View` containers and layout props (invoice cover body)

**Path:** `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx`

- Subject section: `View` with configurable `marginTop` (`subjectSectionMarginTop`).
- **Table header row:** `styles.tableHeader` — `flexDirection: 'row'`, `width: '100%'`, padding from `PDF_ZONES`.
- **Table rows:** `styles.tableRow` — `flexDirection: 'row'`, **`wrap={false}`** on each row (keeps row on one page chunk).
- **Totals:** `styles.totalsSection` with **`wrap={false}`**; grand total row **`wrap={false}`**.
- **Payment block:** `styles.paymentContentRow` and nested cols often **`wrap={false}`** (QR + details stay together).
- **Outro + closing:** `styles.bodyOutroSection` with **`wrap={false}`** wrapping outro text and **`Text`** `styles.bodyClosing`.

---

## 3. Shared PDF layout primitives

### Shared components (invoices + offers + letters)

- **`InvoicePdfRecipientBlock`** — recipient address lines (also used in letter address window).
- **`InvoicePdfCoverHeader` / `InvoicePdfCoverHeaderBrief`** — branding + meta; Brief variant excludes recipient from header.
- **`InvoicePdfFooter`** — `styles.footer` (`position: 'absolute'`, `bottom: PDF_ZONES.footerBottom`, left/right aligned to `PDF_PAGE` margins) with **`fixed`**; page number `Text` with **`fixed`**, `top: PDF_ZONES.footerPageNumberTop`, `render` for “Seite x von y”.
- **`InvoicePdfBrandingBlock` / `InvoicePdfMetaGrid`** — used inside header components (`invoice-pdf-cover-header.tsx`).

### Shared style modules

- **`pdf-layout-constants.ts`** — `PDF_PAGE` (margins), `PDF_ZONES` (spacing rhythm), `PDF_DIN5008` (window + fold geometry), `PdfRenderMode`, `mmToPt`.
- **`pdf-styles.ts`** — `PDF_COLORS`, `PDF_FONT_SIZES`, `StyleSheet.create` styles: `page`, `angebotPage`, `angebotPageBody`, appendix pages, header/footer, subject/salutation/body/table, etc.

### Reuse by letter PDFs

Letters **reuse:** `InvoicePdfCoverHeaderBrief`, `InvoicePdfRecipientBlock`, `InvoicePdfFooter`, `pdf-styles` (`angebotPage`, `angebotPageBody`, subject/salutation/bodyClosing/htmlBlock), `PDF_PAGE` / `PDF_DIN5008` / `PDF_ZONES`, `buildInvoicePdfSenderOneLine`, `fitSenderLine`.

Letters **do not** use: `InvoicePdfCoverBody`, `InvoicePdfReferenceBar`, `InvoicePdfAppendix`, invoice-specific table/totals/payment components.

### Constants / shared style objects

- **Page padding:** `PDF_PAGE.marginTop` (57), `marginBottom` (100 — footer reserve), `marginLeft` / `marginRight` (45), landscape `marginLandscape` (36).
- **Footer:** `PDF_ZONES.footerBottom`, `footerPaddingTop`, `footerPageNumberTop`.
- **Vertical rhythm:** `PDF_ZONES.subjectMarginTopOffer`, `subjectMarginBottom`, `salutationMarginBottom`, `bodyMarginBottom`, `closingMarginTop`, etc.

---

## 4. Page style and padding comparison (letter vs invoice / quote)

### Base `Page` styles

| Aspect | Letter | Angebot (offer) | Invoice (cover) |
|--------|--------|-----------------|-----------------|
| Style object | `styles.angebotPage` | `styles.angebotPage` | `styles.page` |
| `paddingTop` | `PDF_PAGE.marginTop` | same | same |
| `paddingBottom` | `PDF_PAGE.marginBottom` | same | same |
| `paddingLeft` / `paddingRight` | `PDF_PAGE.marginLeft` / `marginRight` | same | same |
| Typography | Helvetica, base 9pt, `lineHeight: 1.45` | same | same |
| `flexDirection` | Not set on page style (column flow default) | same | same |
| `wrap` on `Page` | `wrap` (enabled) | `wrap` | `wrap` |
| Background | Not set (default white) | same | same |

**Conclusion:** Letter and **offer** pages share the **same** `angebotPage` shell. Invoice cover uses **`page`**, which in `pdf-styles.ts` is **numerically identical** to `angebotPage` for padding and typography (only comments differ). Base padding and footer reserve **align** across document types.

### Letter main body area

- Wrapped in **`View` `angebotPageBody`** (`flex: 1`, `width: '100%'`) with **`wrap`**. Content stacks **vertically** (column); no `flexDirection: 'row'` for the main prose column.
- **Inside body:** no `position: 'absolute'` or `position: 'fixed'` in `letter-pdf-cover-body.tsx`. Absolute/fixed usage is **page-level** (window, fold marks, footer) and in **shared** footer styles.

### Header / footer reservation

- **Same mechanism for all:** `paddingBottom: PDF_PAGE.marginBottom` on the page reserves space; **`InvoicePdfFooter`** is **`position: 'absolute'`** + **`fixed`** so it repeats on every page; page number line is **fixed** at `footerPageNumberTop`.
- Letters **match** offers and invoices in this regard; they do not use a different footer reservation model.

---

## 5. Positioning, wrapping, and overlapping risk factors

### Letter PDF — absolute / fixed / hardcoded offsets

| Location | Mechanism | Risk if body / fields grow |
|----------|-----------|-----------------------------|
| `letter-pdf-document.tsx` | Fold marks: `position: 'absolute'`, `top` = DIN fold positions, `left: foldMarkX` | Low — decorative, left margin. |
| Same | Address window: `position: 'absolute'`, `top: addressWindowTop`, `left: marginLeft`, `width: '52%'`, `maxHeight`, `overflow: 'hidden'` | **Medium** — long recipient data **clips** inside window; does not push flow. Unrelated to body length but relevant if left-panel recipient fields grow. |
| `InvoicePdfFooter` (shared) | `styles.footer`: `position: 'absolute'`, `bottom`, `left`, `right`; **`fixed`** | Low if `marginBottom` reserve holds; overflow if content ignores reserve. |
| Page number | `styles.footerPageNumber`: `position: 'absolute'`, `top: footerPageNumberTop`, `left`/`right` | Low — stable band. |

### Letter PDF — `wrap={false}` / nowrap patterns

- **`LetterPdfCoverBody`:** closing **`View`** has **`wrap={false}`** — the Grußformel block **cannot split across pages**. If the HTML body fills the page to the bottom, react-pdf may **push or clip** the closing block awkwardly vs a wrapping section.
- **`InvoicePdfRecipientBlock` / meta labels** (shared): various **`wrap={false}`** on short labels and sender line — same as invoices; risk is small for labels.

### Invoice / offer contrast

- **Invoices/offers** use **many** **`wrap={false}`** segments for **table rows**, **totals**, **payment row**, **outro+closing** — intentional to keep **financial/layout blocks** intact; they still rely on **vertical stacking** and page `wrap` for **pagination** of long tables (rows flow to next pages).
- **Letters** use **absolute** positioning for **DIN window + fold marks** — same as **invoice brief** mode, not unique to letters.
- **Offers** wrap prose in **`angebotPageBody`** like letters; invoice cover body is a **long vertical stack** without the `angebotPageBody` wrapper but with the same page padding.

**Multi-page:** Letters have **one** `Page` with `wrap`; long HTML should **paginate** like offer intro/outro. There is **no** letter-specific appendix or second-page template.

---

## 6. Letter body text handling (multi-page behaviour)

- **Holder:** `LetterPdfCoverBody` — conditional **`View`** with **`wrap`**, **`styles.htmlBlock`**, **`marginBottom: PDF_ZONES.bodyMarginBottom`**, child **`Html`** from `react-pdf-html` with `LETTER_HTML_STYLESHEET` (mirrors offer HTML prose: base 9pt, `lineHeight: 1.6`).
- **No fixed height** on the HTML container; **no absolute positioning** on the body block.
- **Pagination:** Parent **`Page`** has **`wrap`**; parent **`angebotPageBody`** **`View`** has **`wrap`**; HTML **`View`** has **`wrap`** — consistent with offer intro/outro pattern for long prose.
- **No** implemented logic for attachments or repeating letterheads on extra pages beyond react-pdf’s default breaks; **no** separate attachment `Page` type.

---

## 7. Props from left panel to letter PDFs

### Data assembly

- **Builder:** `LetterBuilder` builds **`draftLetter`** via **`buildDraftLetter(values, { companyId, existing })`** (`src/features/letters/lib/build-draft-letter.ts`) — maps all form fields to a **`Letter`** shape.
- **Preview:** `useLetterBuilderPdfPreview` passes **`draftLetter`** + **`companyProfile`** (with resolved logo URL) into **`LetterPdfDocument`**.
- **Download:** same **`LetterPdfDocument`** with `draftLetter` or persisted **`Letter`** from list/detail.

### `LetterPdfDocument` props

- **`letter: Letter`**
- **`companyProfile: InvoiceDetail['company_profile']`**

### Fields used in PDF rendering

| Letter field | Where used |
|--------------|------------|
| Recipient fields (`recipientCompany`, `recipientSalutation`, `recipientFirstName`, `recipientLastName`, `recipientStreet`, `recipientZip`, `recipientCity`, `recipientCountry`) | `buildWindowRecipient` → `InvoicePdfRecipientBlock` (window) + header Brief (recipient prop for any header logic that still receives it) |
| `letterNumber` | Meta grid as “Brief-Nr.”; document title |
| `letterDate` | Meta “Datum” (ISO normalized in helper) |
| `status` | Meta “Status” row (`Versendet` / `Entwurf`) via `metaConfig.periodLabel` / `periodValue` |
| `subject` | Optional `Text` `styles.subject` in `LetterPdfCoverBody` |
| (derived salutation) | From recipient fields in `salutationForLetter` — not a stored field |
| `bodyHtml` | `Html` in wrapped `View` when non-empty |
| `id` | Fallback PDF title prefix if no letter number |

### Conditionally rendered (`&&` / ternary)

- **`subject`:** only if `letter.subject?.trim()`.
- **`bodyHtml`:** entire HTML block only if trimmed non-empty.
- **Logo / slogan / sender line / footer lines:** driven by `companyProfile` inside shared header/footer (same conditionals as other PDFs).

### Containers that may not adapt cleanly

- **Address window `View`:** **`maxHeight` + `overflow: 'hidden'`** — does not grow with content; long addresses **truncate visually**.
- **Closing `View` with `wrap={false}`** — does not adapt to page breaks; may cause **layout pressure** at page boundaries.

---

## 8. Visual differences relevant to padding and spacing

### Vertical rhythm (letters vs offers)

- **Subject block top:** Letters use **`PDF_ZONES.subjectMarginTopOffer` (12pt)** — **same** as **`AngebotPdfCoverBody`** subject section.
- **Subject → salutation:** `styles.subject` includes **`marginBottom: PDF_ZONES.subjectMarginBottom` (16pt)**; `styles.salutation` includes **`marginBottom: PDF_ZONES.salutationMarginBottom` (8pt)** — aligned with offer/invoice subject stack.
- **After HTML body:** **`PDF_ZONES.bodyMarginBottom` (16pt)** on letter HTML wrapper — matches offer intro spacing before table (letter has no table).
- **Closing:** Letter uses **`View`** with **`marginTop: PDF_ZONES.closingMarginTop` (12pt)** **and** **`Text`** with **`styles.bodyClosing`**, which **also** defines **`marginTop: PDF_ZONES.closingMarginTop`**. This **doubles** the intended closing margin relative to a single `bodyClosing` application (e.g. invoice outro section applies **`bodyClosing`** once after outro text). **Likely inconsistency / excess space** before “Mit freundlichen Grüßen,”.

### Invoice cover (reference)

- **Subject section `marginTop`:** conditional **`subjectMarginTopWithReferenceBar` (6)** vs **`subjectMarginTopOffer` (12)** when reference bar absent — letters **always** use the **12pt offer-style** gap (no reference bar), which is consistent with **no-bar** invoices.

### Typography

- Letters use **`pdf-styles`** for **`subject`**, **`salutation`**, **`bodyClosing`**, **`htmlBlock`** width; HTML stylesheet uses **`PDF_FONT_SIZES.base`**, **`PDF_COLORS.text`**, **`lineHeight: 1.6`** for prose — **same pattern as `AngebotPdfCoverBody`** (`HTML_PROSE` / paragraph margins). **Not** custom ad-hoc fonts outside the shared invoice PDF theme.

---

## 9. Risk surface and constraints

### Why letters might overlap or feel broken vs invoices/offers

**Update:** Top overlap between the DIN window and flow Betreff/Anrede/body is mitigated for letters by `PDF_ZONES_LETTER.briefBodyExtraMarginTop` on the body wrapper in `letter-pdf-document.tsx` (letters only; invoices/Angebote unchanged).

1. **DIN absolute address window** clips overflow; does not participate in flow — distinct from **digital** invoice header where recipient flows below branding.
2. **`wrap={false}` on the closing block** can **fight** pagination when the HTML body is long (closing may not split, leading to awkward breaks or overflow). **Still open** — not changed by the letter-only DIN top offset.
3. **Duplicate `marginTop`** on closing container + `bodyClosing` may waste vertical space and push the Grußformel **closer to the footer band** on short letters, increasing perceived crowding with the fixed footer. **Still open** — future work.
4. **Single-page `Document` structure** is fine for pagination, but there is **no** dedicated “continuation page” layout — only default breaks (same as long offer intros).

### Components / style objects to touch for a columnar, invoice-aligned letter flow

- **`letter-pdf-document.tsx`** — page structure, optional wrapper tweaks, whether to mirror invoice brief vs digital; fold/window placement must stay for DIN Brief identity.
- **`letter-pdf-cover-body.tsx`** — spacing (closing margins), **`wrap`** on closing, optional signature block later.
- **`pdf-styles.ts`** — only if new shared tokens are needed (prefer **`PDF_ZONES`** / **`pdf-layout-constants`** first).
- **`pdf-layout-constants.ts`** — if letter-specific spacing must diverge from offers while staying centralized.

### Shared impact if changed carelessly

- Editing **`InvoicePdfFooter`**, **`InvoicePdfCoverHeaderBrief`**, **`styles.angebotPage` / `angebotPageBody`**, or **`PDF_PAGE` / `PDF_ZONES`** affects **offers and/or invoices**, not only letters. Prefer **letter-local** changes or **document-type-specific** style keys when invoice/offer visuals must stay frozen.

---

## 10. Senior-level recommendation

### Goal

Fix letter **overlap / padding** issues **without** changing invoice or offer PDF appearance: preserve **DIN Brief** window, fold marks, and shared branding/footer identity.

### Refactor targets (by path)

1. **`letter-pdf-cover-body.tsx`** — primary: remove **`wrap={false}`** from the closing block (or replace with wrapping-friendly grouping), and **eliminate duplicated `closingMarginTop`** (drop extra margin from either the wrapping `View` or `styles.bodyClosing` for this use case — one source of truth).
2. **`letter-pdf-document.tsx`** — secondary: verify **`angebotPageBody` + `Page` `wrap`** matches the proven **Angebot** pattern; only adjust if diagnostics show the wrapper interacts badly with `Html` pagination (keep parity with `AngebotPdfDocument`).
3. **Avoid** changing **`styles.page` / `styles.angebotPage`**, **`PDF_PAGE`**, or **`InvoicePdfFooter`** for letter-only fixes unless a **letter-specific** style duplicate is introduced.

### Shared primitives

- **Continue reusing** `InvoicePdfCoverHeaderBrief`, `InvoicePdfRecipientBlock`, `InvoicePdfFooter`, `pdf-styles`, and **`PDF_ZONES`** — do **not** fork DIN geometry.
- If a **shared “prose column”** wrapper emerges, it should be a **thin optional helper** or documented pattern shared by **`AngebotPdfCoverBody`** and **`LetterPdfCoverBody`**, not a change to invoice **`InvoicePdfCoverBody`**.

### Minimal safe change set (letters only)

- Adjust **closing section** wrapping and **margin duplication** in **`letter-pdf-cover-body.tsx`** only.
- Optionally add **letter-specific constants** in **`pdf-layout-constants.ts`** (e.g. `letterClosingWrap`) if you need feature flags — still avoids touching invoice render paths.

### Suggested implementation sequence (small, testable steps)

1. **Reproduce** long `bodyHtml` + short letter in preview/download; capture PDF page breaks at closing Grußformel.
2. **Patch `LetterPdfCoverBody`:** remove duplicate `marginTop` (single parent or single `bodyClosing` margin); set closing wrapper to **`wrap`** (or remove `wrap={false}`) and regression-test one-page and multi-page letters.
3. **Visual diff** against a **short Angebot** PDF (same `angebotPage`): subject/salutation/body spacing should remain **intentionally similar**.
4. **Stress-test** long recipient address: confirm **clipping** is acceptable or document need for **smaller font / more lines** inside window (separate UX decision; out of minimal overlap scope).
5. **Confirm** invoice PDF snapshot or manual check **unchanged** (no edits to shared footer/header styles in this pass).

---

## UI follow-up (letter builder and list)

**Shipped:**

- **Briefdaten in the letter PDF preview** (right-hand meta card in the builder iframe): only **Datum** is shown. Implemented via `metaGridLayout: 'date_only'` on `PdfCoverHeaderMetaConfig` in letter `InvoicePdfCoverHeaderBrief` usage (`letter-pdf-document.tsx`); invoice and Angebot PDFs still use the default full grid.
- **Breadcrumb:** `Dashboard > Briefe > Neuer Brief` for `/dashboard/letters/new`, and `… > Brief bearbeiten` for `/dashboard/letters/[id]` (no more generic **Rechnung** tail for letter UUIDs). Logic lives in `build-breadcrumbs.ts`.
- **Letters index table:** `overflow-x-auto` wrapper (same idea as other wide tables) in `letter-list.tsx`.

---

*End of audit.*
