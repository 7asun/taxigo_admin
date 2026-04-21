## PDF layout audit (Invoices vs Quotes)

Source of truth:

- **Invoices**: `src/features/invoices/components/invoice-pdf/*` (styles in `pdf-styles.ts`)
- **Quotes (Angebote)**: `src/features/angebote/components/angebot-pdf/*` (reuses invoice header/footer/styles; body differs)

Units: **pt** (React-PDF uses points).

### Invoices (Rechnungen) — layout values

| Audit item | Invoice PDF (Rechnungen) | Quote PDF (Angebote) |
|---|---:|---:|
| **1) Page dimensions + margins** | **Page size**: `A4` (`<Page size='A4' ... />`)<br>**Page “margins” (implemented as padding on `styles.page`)**:<br>- `paddingTop` = **57**<br>- `paddingBottom` = **100** (reserved for footer)<br>- `paddingLeft` = **45**<br>- `paddingRight` = **45** | **Page size**: `A4` (`<Page size='A4' style={styles.angebotPage} ... />`)<br>**Page “margins” (padding on `styles.angebotPage`)**:<br>- `paddingTop` = **57**<br>- `paddingBottom` = **80**<br>- `paddingLeft` = **45**<br>- `paddingRight` = **45** |
| **2) Briefkopf / header zone** | Rendered by `InvoicePdfCoverHeader` in **flow layout** (no fixed height). It is a `View` with `styles.headerRow`:<br>- `flexDirection: 'row'` (left + right columns)<br>- `marginBottom` = **2**<br>**No absolute positioning** for header; height depends on logo/sender/address/meta content. | Same component: `InvoicePdfCoverHeader` (offers pass `metaConfig` labels only). Same flow layout and `marginBottom: 2`. |
| **3) Anschriftenfeld (recipient address window)** | Rendered inside header **left column** in `InvoicePdfCoverHeader` as `styles.recipientBlock` (flow, not absolute):<br>- `styles.headerLeft.width` = **'52%'**<br>- `styles.recipientBlock.marginTop` = **4**<br>**Start Y** is not a single constant; it’s in-flow under branding + optional sender line. The first explicit offset in styles before the address block is `recipientBlock.marginTop: 4` (plus `brandStack.marginBottom: 12`, plus optional sender block).<br>**Left offset**: page padding left **45** (no extra left positioning inside headerLeft).<br>**Width**: `headerLeft.width = '52%'` of the inner content width (A4 minus left/right padding). | Same address rendering (same header component, same `headerLeft.width: '52%'`, same `recipientBlock.marginTop: 4`, same page left padding **45**). Note: offer recipient mapping differs (it avoids duplicating company name when no person is set), but layout is identical. |
| **4) Infoblock (Datum, Referenz, etc.)** | Rendered as the right header column in the same header row (side-by-side with address):<br>- `styles.headerRight.width` = **'44%'**<br>- `styles.metaContainer` (the “grid” container) has `paddingVertical: 9`, `paddingHorizontal: 10`, border, background, etc.<br>**Positioning**: in a **flex row next to** the address (not absolute). | Same position (same `headerRight.width: '44%'`, same meta container). Content labels differ via `metaConfig` (e.g. “Angebotsnr.”, “Angebotsdatum”, “Gültig bis”; `showTaxIds: false`). |
| **5) Betreff / Subject line** | In `InvoicePdfCoverBody`, subject block wrapper `View` uses `marginTop = subjectSectionMarginTop` (pt). Default is **8**, but the document passes:<br>- **12** when **no** reference bar is rendered<br>- **6** when the reference bar **is** rendered (`subjectSectionMarginTop={referenceFieldsForPdf.length > 0 ? 6 : 12}`)<br>Inside that block, `styles.subject.marginBottom` = **16**. | In `AngebotPdfCoverBody`, subject/salutation wrapper uses `marginTop: 8` (inline style):<br>- subject block wrapper `marginTop` = **8**<br>Inside, `styles.subject.marginBottom` = **16** (same shared style). |
| **6) Anrede / Salutation** | `styles.salutation.marginBottom` = **8** (same style used for salutation `<Text>`). This is the spacing after the salutation before body text (`styles.bodyText`). | Same `styles.salutation.marginBottom` = **8**. In offers, the intro block comes after the salutation (not `styles.bodyText`), so the salutation’s marginBottom is the spacing to intro. |
| **7) Body text / Fließtext** | Immediately after salutation inside the same subject block:<br>- `styles.bodyText.marginBottom` = **16** → **spacing to the table header** is 16pt. | Offer intro/outro are HTML blocks (via `react-pdf-html`). Intro block wrapper adds `marginBottom: 8` (inline):<br>- Intro block `marginBottom` = **8** (spacing to the table header).<br>Offer does not use `styles.bodyText` for intro; it uses HTML stylesheet with paragraph `marginBottom: 8`. |
| **8) Table / line items** | Table header starts immediately after the intro/body text (no explicit `marginTop` on `styles.tableHeader`). Therefore, spacing is controlled by the preceding block’s marginBottom (invoice: `bodyText.marginBottom = 16`). | Table header starts immediately after intro HTML block (no explicit `marginTop`). Spacing is controlled by intro wrapper’s `marginBottom: 8` (and paragraph spacing inside HTML). |
| **9) Footer** | Rendered by `InvoicePdfFooter` and included on **every page** (cover + appendix pages). Footer uses **fixed positioning** via `fixed` + absolute styles:<br>- `styles.footer`: `position: 'absolute'`, `bottom: 28`, `left: 45`, `right: 45`<br>- Page number line: `styles.footerPageNumber`: `position: 'absolute'`, `top: 818`, `left: 45`, `right: 45`, `minHeight: 14` (uses `top`, not `bottom`). | Same footer component, same absolute positioning and `fixed`, and it is on the offer page as well. The only offer-specific difference is page paddingBottom (80 vs 100), but footer itself is identical. |
| **10) Falzmarken / fold marks** | **Not rendered** (no “falz/fold” markers found; no components draw fold marks). | **Not rendered** (same; no fold-mark rendering in offer components). |

### Quotes (Angebote) — layout values (same items, quote-specific context)

The quote PDF reuses the invoice header/footer/styles. Differences are primarily page bottom padding and body block spacing (subject intro/outro).

| Audit item | Invoice PDF (Rechnungen) | Quote PDF (Angebote) |
|---|---:|---:|
| **1) Page dimensions + margins** | **A4**; padding/margins via `styles.page`: Top **57**, Bottom **100**, Left **45**, Right **45**. | **A4**; padding/margins via `styles.angebotPage`: Top **57**, Bottom **80**, Left **45**, Right **45**. |
| **2) Briefkopf / header zone** | `InvoicePdfCoverHeader` (flow row). `styles.headerRow.marginBottom` = **2**. No fixed height; no absolute positioning. | Same. |
| **3) Anschriftenfeld** | Left column `width: '52%'`; address block is in-flow with `recipientBlock.marginTop: 4`; left offset via page padding **45**. | Same. |
| **4) Infoblock** | Right column `width: '44%'`; sits next to address in flex row; meta container paddings `9/10`. | Same placement; offer uses `metaConfig` to relabel/hide tax rows. |
| **5) Betreff** | Subject wrapper `marginTop` = **6** or **12** (depending on reference bar); `styles.subject.marginBottom` = **16**. | Subject wrapper `marginTop` = **8**; `styles.subject.marginBottom` = **16**. |
| **6) Anrede spacing after subject** | Subject-to-salutation spacing comes from `styles.subject.marginBottom` = **16**. Salutation-to-next spacing `styles.salutation.marginBottom` = **8**. | Same style values: subject marginBottom **16**, salutation marginBottom **8**. |
| **7) Body text spacing** | Salutation → body text: controlled by `styles.salutation.marginBottom = 8` (then body text). Body text → table: `styles.bodyText.marginBottom = 16`. | Salutation → intro HTML: `styles.salutation.marginBottom = 8`. Intro wrapper adds `marginBottom = 8` to separate from table header. |
| **8) Table spacing** | No explicit table `marginTop`; spacing comes from `bodyText.marginBottom = 16`. | No explicit table `marginTop`; spacing comes from intro wrapper `marginBottom = 8` (and HTML paragraph spacing). |
| **9) Footer** | `styles.footer.bottom = 28`; page number `styles.footerPageNumber.top = 818`; `fixed`; included on every page. | Same footer/positions; included on offer page. |
| **10) Falzmarken** | None. | None. |

