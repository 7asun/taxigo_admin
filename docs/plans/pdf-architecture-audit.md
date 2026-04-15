## PDF architecture audit — layout constants & render-mode feasibility

Scope (read-only):

- `src/features/invoices/components/invoice-pdf/pdf-styles.ts`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-footer.tsx`
- `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- `package.json`

Units: **pt**.

### Question 1 — Magic number inventory

Definition used here: any hardcoded numeric spacing/layout value **not already a named constant** (i.e. not `PDF_FONT_SIZES.*`, not `PDF_COLORS.*`, not a named exported constant).

#### Page structure

| File | Component/style key | Current value (pt) | What it controls |
|---|---|---:|---|
| `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` | `<Page size='A4' ...>` | (A4 preset) | Page size preset (dimensions defined by react-pdf). |
| `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` | `<Page size='A4' ...>` | (A4 preset) | Page size preset (dimensions defined by react-pdf). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.page.paddingTop` | 57 | Top content inset for invoice pages. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.page.paddingBottom` | 100 | Bottom content inset / reserved space for fixed footer + page number line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.page.paddingLeft` | 45 | Left content inset (acts as margin). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.page.paddingRight` | 45 | Right content inset (acts as margin). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.page.lineHeight` | 1.45 | Default line-height multiplier for page text. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.angebotPage.paddingTop` | 57 | Top content inset for offer pages. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.angebotPage.paddingBottom` | 100 | Bottom content inset / reserved space for fixed footer + page number line (offers). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.angebotPage.paddingLeft` | 45 | Left content inset (offers). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.angebotPage.paddingRight` | 45 | Right content inset (offers). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.angebotPage.lineHeight` | 1.45 | Default line-height multiplier (offers). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPage.paddingTop` | 57 | Top content inset for invoice appendix pages. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPage.paddingBottom` | 100 | Bottom content inset for invoice appendix pages. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPage.paddingLeft` | 45 | Left inset for appendix pages. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPage.paddingRight` | 45 | Right inset for appendix pages. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPage.lineHeight` | 1.45 | Default line-height multiplier (appendix). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPageLandscape.paddingTop` | 57 | Top inset for landscape appendix. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPageLandscape.paddingBottom` | 100 | Bottom inset for landscape appendix. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPageLandscape.paddingLeft` | 36 | Left inset for landscape appendix. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPageLandscape.paddingRight` | 36 | Right inset for landscape appendix. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixPageLandscape.lineHeight` | 1.45 | Default line-height multiplier (landscape appendix). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.htmlBlock.width` | `'100%'` | HTML block width spanning content area. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.angebotPageBody.flex` | 1 | Fill remaining vertical space between header and footer. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.angebotPageBody.width` | `'100%'` | Body column width. |

#### Header zone (Briefkopf/meta)

| File | Component/style key | Current value (pt) | What it controls |
|---|---|---:|---|
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.headerRow.marginBottom` | 2 | Gap below the header row (before reference bar or subject). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.headerLeft.width` | `'52%'` | Width of header left column (branding + sender + address). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.headerLeft.paddingRight` | 10 | Inner gap between left column content and right column. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.headerRight.width` | `'44%'` | Width of header right column (meta grid). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.headerRight.paddingTop` | 0 | Top padding of header right column. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.brandStack.marginBottom` | 12 | Gap below branding stack before sender/address area. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.sloganBelowLogo.lineHeight` | 1.4 | Line-height multiplier for slogan text. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.sloganBelowLogo.marginTop` | 2 | Gap between logo and slogan. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.sloganBelowLogo.maxWidth` | 260 | Max slogan width (layout constraint; not “pt spacing” but a hard numeric layout cap). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.rightTaxLine.marginBottom` | 1 | Vertical spacing between tax lines (if used). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.senderOneLine.paddingBottom` | 3 | Space under sender one-line text. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.senderOneLine.lineHeight` | 1.35 | Line-height multiplier for sender one-line text. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.senderOneLineRule.borderBottomWidth` | 0.4 | Thickness of rule under sender line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.senderOneLineRule.marginBottom` | 1 | Gap under sender rule before address. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.logoLeft.width` | 220 | Logo box width. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.logoLeft.maxHeight` | 70 | Max logo height (caps the box). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaContainer.borderWidth` | 0.8 | Meta container border thickness. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaContainer.borderRadius` | 6 | Meta container corner radius. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaContainer.paddingVertical` | 9 | Vertical padding inside meta container. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaContainer.paddingHorizontal` | 10 | Horizontal padding inside meta container. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaHeading.letterSpacing` | 0.5 | Tracking for meta heading. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaHeading.marginBottom` | 1 | Gap below meta heading. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaItem.paddingVertical` | 2 | Vertical padding per meta row. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaItem.borderBottomWidth` | 0.5 | Divider thickness between meta rows. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaItemLast.paddingBottom` | 0 | Removes extra padding on last meta row. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaLabel.letterSpacing` | 0.3 | Tracking for meta labels. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaLabel.width` | 92 | Fixed label column width in meta grid. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaLabel.paddingTop` | 1 | Nudges label baseline down slightly. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaLabel.paddingRight` | 8 | Gap between label and value. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaValue.lineHeight` | 1.35 | Line-height multiplier for meta values. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.metaValue.maxWidth` | `'58%'` | Caps value column width inside meta grid. |

#### Address zone (recipient window)

| File | Component/style key | Current value (pt) | What it controls |
|---|---|---:|---|
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.recipientBlock.marginTop` | 4 | Gap above recipient address block (below sender line/rule). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.addressCompanySecondary.marginBottom` | 2 | Gap under secondary company line (if used). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.rightTaxBlock.paddingTop` | 2 | Top padding for right-tax block (if used). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.addressCompanyName.marginBottom` | 1 | Spacing between address lines (company). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.addressPersonName.marginBottom` | 1 | Spacing between address lines (person). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.addressLine.marginBottom` | 1 | Spacing between address lines (generic). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.addressPhoneLine.marginTop` | 2 | Gap above phone line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.addressPhoneLine.marginBottom` | 1 | Gap below phone line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.addressPhoneLine.lineHeight` | 1.5 | Phone line-height multiplier. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.secondaryLegalBlock.marginTop` | 14 | Gap above “secondary legal recipient” block. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.secondaryLegalBlock.paddingTop` | 8 | Padding above secondary legal block content (after border). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.secondaryLegalBlock.borderTopWidth` | 0.5 | Divider thickness above secondary legal block. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.secondaryLegalLabel.marginBottom` | 4 | Gap under secondary legal label. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.secondaryLegalName.marginBottom` | 2 | Gap under secondary legal name. |

#### Subject/body spacing (cover page body blocks)

| File | Component/style key | Current value (pt) | What it controls |
|---|---|---:|---|
| `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` | `subjectSectionMarginTop` prop | 6 / 12 | Margin above invoice subject block (6 when reference bar exists, else 12). |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | `subjectSectionMarginTop` default | 8 | Default margin above subject block (if not overridden). |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | `<View style={{ marginTop: subjectSectionMarginTop }}>` | (prop value) | Subject block top spacing in invoice cover body. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.subject.marginBottom` | 16 | Subject → next block spacing (to salutation). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.salutation.marginBottom` | 8 | Salutation → body text spacing. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.salutation.lineHeight` | 1.5 | Salutation line-height multiplier. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.bodyText.lineHeight` | 1.6 | Body text line-height multiplier. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.bodyText.marginBottom` | 16 | Body text → table header spacing. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.bodyOutroSection.marginTop` | 16 | Gap above outro section (invoice). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.bodyClosing.marginTop` | 12 | Gap above closing line (“Mit freundlichen Grüßen”). |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | `styles.totalsSection` extra style | 8 | Inline `{ marginTop: 8 }` on totals block wrapper. |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | Payment instructions intro text margins | 4 / 2 | Inline `marginBottom: 4, marginTop: 2` on payment paragraph. |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | Payment details first row override | 0 | Inline `{ marginTop: 0 }` on first payment detail row. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | Subject wrapper `marginTop` | 12 | Offer subject+salutation wrapper top spacing. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | Intro HTML wrapper `marginBottom` | 16 | Offer intro prose spacing before table. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | Outro wrapper `marginTop` | 8 | Offer outro prose spacing after table. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | HTML stylesheet `p.marginBottom` | 8 | Paragraph spacing inside offer intro/outro HTML rendering. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | HTML stylesheet `li.marginBottom` | 4 | List item spacing inside HTML. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | HTML stylesheet `ul.paddingLeft` / `ol.paddingLeft` | 10 | List indentation inside HTML. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | HTML stylesheet `ul.marginBottom` / `ol.marginBottom` | 8 | Bottom spacing after lists inside HTML. |

#### Table spacing / table layout

| File | Component/style key | Current value (pt) | What it controls |
|---|---|---:|---|
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.tableHeader.borderBottomWidth` | 1.5 | Table header bottom border thickness. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.tableHeader.paddingVertical` | 6 | Table header vertical padding. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.tableHeader.paddingHorizontal` | 8 | Table header horizontal padding. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.tableRow.paddingVertical` | 5 | Table row vertical padding. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.tableRow.paddingHorizontal` | 8 | Table row horizontal padding. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.tableRow.borderBottomWidth` | 0.5 | Table row divider thickness. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.routePrimary.lineHeight` | 1.35 | Line-height multiplier for primary route line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.routeSecondary.lineHeight` | 1.3 | Line-height multiplier for secondary route line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.routeSecondary.marginTop` | 2 | Gap between primary and secondary route lines. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixColAddrCity.fontSize` | 6 | Appendix address second line font size (pt, but hardcoded not via `PDF_FONT_SIZES`). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixColAddrCity.marginTop` | 1 | Gap above appendix city line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.appendixKtsNote.marginTop` | 2 | Gap above KTS note line in appendix. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.tableHeaderText.letterSpacing` | 0.4 | Tracking for table header labels. |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | Table cell style `paddingRight` | 4 | Per-column right padding in header row and body rows (inline style). |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` | `<Text numberOfLines={1}>` | 1 | Header label truncation to one line (react-pdf prop). |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | Column fallback width | 20 | Fallback column width floor when a width is missing (`colWidths[col.id] ?? 20`). |
| `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` | Header/row cell `paddingRight` | 4 | Per-cell right padding in offer table (inline style). |

#### Footer

| File | Component/style key | Current value (pt) | What it controls |
|---|---|---:|---|
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footer.bottom` | 28 | Bottom offset of the fixed footer block. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footer.left` / `styles.footer.right` | 45 | Footer block horizontal inset (matches page padding). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footer.borderTopWidth` | 0.5 | Footer top border thickness. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footer.paddingTop` | 8 | Padding above footer contents. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerCol.paddingRight` | 10 | Right padding for generic footer column (unused by 3-col variant). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerColThird.width` | `'32%'` | Width of each of the three footer columns. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerColThird.paddingRight` | 8 | Right padding in each footer third column. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerKontaktHeading.marginBottom` | 1 | Spacing under “Kontakt” label. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerNote.marginTop` | 1 | Spacing above footer note. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerText.marginBottom` | 0.25 | Tight spacing between footer lines. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerBold.marginBottom` | 1 | Spacing under bold footer heading line. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerPageNumber.top` | 818 | Absolute Y position for page number line (A4 height ≈ 842pt). |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerPageNumber.left` / `right` | 45 | Page number line horizontal inset. |
| `src/features/invoices/components/invoice-pdf/pdf-styles.ts` | `styles.footerPageNumber.minHeight` | 14 | Reserves minimum height for the page number render text. |

---

### Question 2 — Header zone structure feasibility

Requirement stated: in “Brief mode”, recipient address window must start at exactly **127pt from page top** (DIN 5008 Form B: 45mm).

#### Approximate rendered height of `InvoicePdfCoverHeader` today (estimate)

`InvoicePdfCoverHeader` is a flow layout composed of:

- Branding stack (`styles.brandStack`): logo (`styles.logoLeft.maxHeight = 70`) + optional slogan (`styles.sloganBelowLogo` with `lineHeight: 1.4`, `marginTop: 2`), then `brandStack.marginBottom = 12`.
- Optional sender one-line: `styles.senderOneLine.lineHeight = 1.35` + `paddingBottom: 3`, plus rule (`borderBottomWidth: 0.4`, `marginBottom: 1`).
- Recipient block: `styles.recipientBlock.marginTop = 4`, then a variable number of address lines each with `marginBottom` (mostly 1) and (mostly inherited) line height, plus optional phone line (`lineHeight: 1.5`, `marginTop: 2`, `marginBottom: 1`).
- Optional “secondary legal recipient” block adds significant additional height (`marginTop: 14`, `paddingTop: 8`, plus multiple lines).
- Right column meta grid adds its own minimum height (container padding 9/10 + multiple rows).

**Estimate** (typical “has logo + 4–6 address lines, no secondary legal block”):

- Logo: up to ~70
- Slogan: ~9pt font × 1.4 ≈ ~13 (+2 marginTop) ≈ ~15 (if present)
- brandStack marginBottom: 12
- Sender line + rule: roughly ~10–15 depending on fitted font size and line height
- recipientBlock marginTop: 4
- Address lines: commonly 4–6 lines; with ~9pt font and page lineHeight 1.45 → per line ~13pt + 1pt margin ≈ ~14pt/line → ~56–84
- Phone line (if present): ~9pt × 1.5 ≈ ~14 + margins ≈ ~17

Putting that together yields an approximate header height on the **order of ~150–200pt** for many realistic cases (and **more** when `secondaryLegalRecipient` is present).

#### Does react-pdf support `minHeight`/`height` on flow Views?

**Yes.** `@react-pdf/renderer` supports layout constraints such as `minHeight` and `height` on `View` in flow layout (Yoga-based).

#### What would break if we added `minHeight: 127` to the header container View? Specific risks

If added to the header container (`styles.headerRow` / outer `<View style={styles.headerRow}>`):

- **It would not guarantee the address starts at 127pt from page top.** `minHeight` only enforces a minimum total header height; it does not pin the recipient block’s internal Y position.
- **If the header currently renders shorter than 127pt in edge cases** (e.g. no logo, no slogan, no sender line, very short address), `minHeight` would introduce extra whitespace below the header, pushing the reference bar/subject/body down (reducing usable body space).
- **Pagination pressure**: increasing minimum header height reduces vertical space for the body/table on page 1, increasing the chance of table rows pushing to the next page (especially with long intro HTML in offers, or long tables).
- **Layout coupling to right meta grid height**: the header is a left/right flex row. A forced minHeight might expose visual misalignment if one side is much shorter; the other side won’t “fill” unless explicitly stretched, which can make the container look unexpectedly tall with content anchored at the top.
- **It still allows overflow**: any content taller than 127pt will still expand the header (because `minHeight` is not a cap), so “Brief mode exact start” is not achieved by `minHeight` alone.

#### Could header content overflow 127pt?

**Yes — easily**, given today’s structure and values:

- **Logo** alone can be up to 70pt high (`logoLeft.maxHeight = 70`), plus slogan + margins.
- **Recipient address** can be multiple lines (company name + person + department + street + line2 + zip/city + phone), each with margins and inherited line height.
- **Secondary legal block** (`secondaryLegalRecipient`) explicitly adds `marginTop: 14`, `paddingTop: 8`, a border, and multiple additional lines—this can push the header significantly beyond 127pt.
- **Meta grid** can also grow with extra rows (`metaConfig.extraRows`) and multi-line period values.

---

### Question 3 — Fold mark rendering feasibility

Target fold marks: horizontal lines at **top=298pt** and **top=595pt**, at **left=10pt**, width **8pt**, thin stroke, added as absolutely positioned `View`s directly under `<Page>`.

#### Conflicts with current `<Page>` children at those Y positions?

In `InvoicePdfDocument.tsx`, the cover page `<Page size='A4' style={styles.page} wrap>` has these direct children in order:

- `<InvoicePdfCoverHeader ... />`
- optional `<InvoicePdfReferenceBar ... />`
- `<InvoicePdfCoverBody ... />`
- `<InvoicePdfFooter ... />` (renders absolutely-positioned footer + page number, both `fixed`)

**No direct-child wrapper uses absolute positioning** in the cover/header/body; content is in normal flow. Therefore, adding absolutely positioned fold-mark `View`s at Y=298/595 (as siblings of these children) would not inherently “conflict” with existing children (they would simply overlay at those coordinates).

Practical note (still within feasibility): because the body content flows, fold marks could visually overlay text/table content if those Y positions happen to intersect content; there is currently no reserved empty “margin rail” at those Y positions. (This is an observation of feasibility, not a suggestion.)

#### Existing absolutely positioned elements near 298pt or 595pt?

From `pdf-styles.ts`, the existing absolute-positioned elements are:

- Footer block: `styles.footer` with `bottom: 28` (near the bottom of the page, not near 298/595).
- Page number line: `styles.footerPageNumber` with `top: 818` (also near bottom).

**No existing absolute elements** use `top` values near **298** or **595**.

#### Is there a shared `<Page>` wrapper component?

**No.** Each document defines its own `<Page>` directly:

- Invoices: `InvoicePdfDocument.tsx` renders `<Page ... style={styles.page}>` (and separate appendix `<Page>` instances).
- Offers: `AngebotPdfDocument.tsx` renders `<Page ... style={styles.angebotPage}>`.

There is shared styling (`pdf-styles.ts`) and shared header/footer components, but no shared `<Page>` wrapper abstraction in the files reviewed.

---

### Question 4 — Shared dependency map (imports from `pdf-styles.ts`)

Files that import from `src/features/invoices/components/invoice-pdf/pdf-styles.ts` (via relative or alias paths):

- `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-footer.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-reference-bar.tsx`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`

---

### Question 5 — Existing dependencies for DIN 5008 layout precision

Checked `package.json` for PDF/layout helpers, measurement utilities, or mm→pt conversions.

- **PDF rendering**: `@react-pdf/renderer` (server-side PDF rendering), `react-pdf-html` (HTML → react-pdf text rendering).
- **Other PDF lib present**: `jspdf` (client-side PDF library), but no DIN 5008 helpers or unit-conversion utilities are apparent from dependencies.
- **Unit conversion / mm→pt tokens**: no dedicated dependency found (no obvious measurement library, and no dependency that advertises mm/pt conversion helpers).

**No relevant dependency found.**

