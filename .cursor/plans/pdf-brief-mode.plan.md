# PDF Brief mode (DIN 5008) — implementation plan

## 1. Objective

Implement a real **Brief mode** (`renderMode='brief'`) for both invoice and offer PDFs that produces DIN 5008 Form B artifacts on the cover page: a **brief header variant** (Path C) plus a **page-level absolute recipient address window pinned to 127pt** and **fold marks / lochmarke** as direct `<Page>` children. Out of scope for this plan: changing the global DIN page margins to 71pt/57pt, and any sophisticated address overflow behavior (truncate/shrink/continue), because both require a separate cross-page layout audit and real-data visual testing.

## 2. Files changed

| File | Change |
|---|---|
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx` | Extract three shared sub-components (branding, meta grid, recipient block) and refactor `InvoicePdfCoverHeader` to compose them with **zero digital visual change**. |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header-brief.tsx` | Create new `InvoicePdfCoverHeaderBrief` that composes branding + meta grid only (no recipient), matching the existing header props interface for drop-in swapping. |
| `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` | Implement Brief mode rendering: page-level address window at `PDF_DIN5008.addressWindowTop`, fold marks as page children, and conditional swap to `InvoicePdfCoverHeaderBrief`; remove brief fallback `console.warn`. |
| `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` | Same Brief mode rendering as invoice: page-level address window + fold marks + header swap; remove brief fallback `console.warn`. |
| `docs/angebote-module.md` | Update `## PDF Layout System` to reflect Brief mode is implemented and document the “page-level address window + header swap” pattern. |
| `docs/invoices-module.md` | Same update as Angebote module; keep the cross-reference to the shared constants file. |
| `docs/plans/pdf-brief-mode-audit.md` | Append `## Implementation status` table (per required format) to track completion and explicitly list deferred items. |
| `docs/plans/pdf-architecture-audit.md` | Update the existing implementation status table rows for Brief mode items from “Not started” to “Done”, keeping dates consistent. |

## 3. Implementation steps

### Step 1 — Extract three shared sub-components from `invoice-pdf-cover-header.tsx`

**What changes**

- In `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`, extract exactly these three components (same file, first iteration; move to separate files only if necessary later):
  - `InvoicePdfBrandingBlock` — renders the left “brand stack”: logo (`cp.logo_url`) + slogan (`cp.slogan`) using the existing `styles.brandStack`, `styles.logoLeft`, `styles.sloganBelowLogo`.
  - `InvoicePdfMetaGrid` — renders the right meta container including:
    - label resolution (`heading`, `numberLabel`, `dateLabel`, `periodLabel`, `periodValue`, `showTaxIds`, `extraRows`, storno number label behavior)
    - all rendering of `styles.metaContainer` children.
  - `InvoicePdfRecipientBlock` — renders the complete recipient window block currently inside the left column, including sender one-line + rule + recipient lines + optional `secondaryLegalRecipient` block.

**Why**

- Path C requires a Brief header that reuses the same brand and meta logic while **omitting** the recipient block entirely (recipient becomes a page-level absolute window).
- Extracting these pieces makes that reuse explicit and keeps digital behavior stable by keeping the current composition the same.

**Hard constraints / invariants after this step**

- **Digital output must be pixel-identical** to the pre-refactor output:
  - `InvoicePdfCoverHeader` must render the same element tree and styles, just composed from sub-components.
  - No changes to any `styles.*` tokens and no layout token changes.
- **No magic numbers** may be introduced during extraction (reuse existing `styles` + constants only).

**Build gate**

- `bun run build` must pass before continuing to Step 2.

### Step 2 — Create `InvoicePdfCoverHeaderBrief`

**What changes**

- Create `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header-brief.tsx`.
- Export `InvoicePdfCoverHeaderBrief` that:
  - Accepts the **same props interface** as `InvoicePdfCoverHeader` (same `InvoicePdfCoverHeaderProps` type).
  - Renders the same overall header row structure and styling as the digital header’s row shell:
    - left column: `InvoicePdfBrandingBlock` plus (optionally) sender one-line if that is part of the branding contract; **do not render recipient window content here**.
    - right column: `InvoicePdfMetaGrid` identical to digital behavior.
  - Does **not** render any address lines / recipient info. That becomes the caller’s responsibility at the `<Page>` level (Step 3).

**Why**

- Brief mode needs a different layout contract: the address window must be pinned to a fixed page Y coordinate (127pt) and therefore must not be owned by a flow-based header component.
- Keeping a distinct `InvoicePdfCoverHeaderBrief` avoids complex branching in `InvoicePdfCoverHeader` and protects digital mode from regressions (Path C rationale from `docs/plans/pdf-brief-mode-audit.md` Q5).

**Hard constraints / invariants after this step**

- No changes to digital output yet (Brief mode still falls back until Step 3/4 wiring).
- No new layout constants: use only existing `styles` + `PDF_*` constants where needed.

**Build gate**

- `bun run build` must pass before continuing to Step 3.

### Step 3 — Add page-level address window and fold marks to both document components

**What changes**

- In `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` and `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`, add brief-only page-level elements under the cover `<Page>`:
  - **Address window (recipient block)** when `renderMode === 'brief'`:
    - Render `InvoicePdfRecipientBlock` as a **direct child of `<Page>`** with `position: 'absolute'`.
    - Pin its Y coordinate to `top: PDF_DIN5008.addressWindowTop` (127pt).
    - Use `left: PDF_PAGE.marginLeft` so it aligns to the existing content rail (this preserves current margins; DIN 71pt/57pt margins remain deferred).
    - Ensure the address window content is constrained to the DIN window height contract by using `maxHeight: PDF_DIN5008.addressWindowHeight` only if react-pdf respects it reliably; otherwise, explicitly defer overflow handling (see Deferred items).
  - **Fold marks / Lochmarke** when `renderMode === 'brief'`:
    - Render three absolute `View`s as direct `<Page>` children (cover page only):
      - Falzmarke 1: `top: PDF_DIN5008.fold1`
      - Lochmarke: `top: PDF_DIN5008.lochmarke`
      - Falzmarke 2: `top: PDF_DIN5008.fold2`
    - Use `left: PDF_DIN5008.foldMarkX`, `width: PDF_DIN5008.foldMarkWidth`, and stroke thickness from `PDF_DIN5008.foldMarkStroke`.
    - These must be rendered **only on the cover page**, never on invoice appendix pages (portrait or landscape).

**Why**

- `@react-pdf/renderer` flow layout cannot guarantee “address starts at 127pt”; page-level absolute positioning makes the page coordinate authoritative (as validated in `docs/plans/pdf-brief-mode-audit.md` Q2/Q3).
- Fold marks are DIN artifacts that are easiest and safest to implement as direct `<Page>` children with absolute positioning, independent of flow content.

**Hard constraints / invariants after this step**

- **No magic numbers**:
  - All DIN coordinates and measurements must come from `PDF_DIN5008`.
  - All page rails must come from `PDF_PAGE`.
  - All spacing tokens remain from `PDF_ZONES`.
- **Fold marks on cover page only**:
  - In invoices, appendix pages must not include fold marks.
  - In offers (single page), fold marks are present only on that page (the cover).
- Digital mode output must remain pixel-identical (brief-only branches must not affect the `renderMode !== 'brief'` path).

**Build gate**

- `bun run build` must pass before continuing to Step 4.

### Step 4 — Wire the header swap in both document components

**What changes**

- In `InvoicePdfDocument.tsx` and `AngebotPdfDocument.tsx`:
  - Replace the current “brief not implemented” behavior:
    - Remove the `console.warn` fallback entirely.
    - Replace it with a **comment** documenting the two real render paths (digital vs brief).
  - Implement conditional rendering:
    - `renderMode === 'brief'` → render `InvoicePdfCoverHeaderBrief`
    - otherwise → render the existing `InvoicePdfCoverHeader`
  - Ensure the Brief cover page includes:
    - fold marks + lochmarke as page-level absolute children (from Step 3)
    - page-level address window `InvoicePdfRecipientBlock` (from Step 3)
  - Ensure no change to:
    - body content rendering (subject/table/footer)
    - invoice appendix pages
    - any prop shapes except choosing the header component

**Why**

- Brief mode is now fully implemented via Path C (separate header) plus page-level address window and fold marks; the fallback warning becomes incorrect once Brief is real.
- Keeping the selection at the document level makes the mode switch explicit and localized to the `<Page>` composition point, which is where DIN geometry must be enforced.

**Hard constraints / invariants after this step**

- Digital mode output remains pixel-identical (header refactor must be a pure composition change).
- Brief mode must not change any non-cover pages (appendix unaffected; offers only have cover).

**Build gate**

- Final verification:
  - `bun run build` must pass.
  - `bun test` must pass.

### Step 5 — Docs and inline comments (mandatory final step)

**Inline comments requirements (why-comments only)**

- Add a JSDoc block to each extracted sub-component in `invoice-pdf-cover-header.tsx`:
  - `InvoicePdfBrandingBlock`: why extracted, where used (digital header + brief header).
  - `InvoicePdfMetaGrid`: why extracted, where used (digital header + brief header; offers via `metaConfig`).
  - `InvoicePdfRecipientBlock`: why extracted, where used (digital header; page-level address window in brief mode).
- Add a JSDoc block to `InvoicePdfCoverHeaderBrief` explaining:
  - the DIN 5008 fixed-zone contract (briefkopf ends at 127pt)
  - the recipient window is intentionally absent because it must be page-level absolute.
- In both document components:
  - On the page-level address window `View`, add an inline comment that:
    - references `PDF_DIN5008.addressWindowTop`
    - explains why it is at page level rather than inside the header (flow header cannot guarantee fixed Y).
  - On each fold mark `View`, add an inline comment stating:
    - which mark it represents (Falzmarke 1 / Lochmarke / Falzmarke 2)
    - its mm equivalent (105mm / 148.5mm / 210mm) while still using pt constants.
  - On the header swap conditional, add an inline comment explaining why Path C was chosen over A and B (stability + clean contract separation).

**Docs to update**

- `docs/angebote-module.md`:
  - Update `## PDF Layout System` to state Brief mode is implemented.
  - Mention `InvoicePdfCoverHeaderBrief` and the **page-level address window** pattern used by both documents.
  - Keep the “no magic numbers” rule and emphasize that DIN values come from `PDF_DIN5008`.
- `docs/invoices-module.md`:
  - Same update, keep the cross-reference that constants are shared with Angebote.
- `docs/plans/pdf-brief-mode-audit.md`:
  - Append `## Implementation status` with this exact table shape (fill `{date}` with the implementation date at execution time):

| Item | Status | Date |
|---|---|---|
| InvoicePdfBrandingBlock sub-component extracted | ✅ Done | {date} |
| InvoicePdfMetaGrid sub-component extracted | ✅ Done | {date} |
| InvoicePdfRecipientBlock sub-component extracted | ✅ Done | {date} |
| InvoicePdfCoverHeaderBrief created | ✅ Done | {date} |
| Fold marks + Lochmarke on cover page | ✅ Done | {date} |
| Page-level address window at 127pt | ✅ Done | {date} |
| DIN margins (71pt/57pt) | ⏳ Deferred |  |
| Address overflow handling | ⏳ Deferred |  |

- `docs/plans/pdf-architecture-audit.md`:
  - Update the existing implementation status rows:
    - “Brief mode — fold marks” → ✅ Done with `{date}`
    - “Brief mode — fixed 127pt header zone” → ✅ Done with `{date}` (implemented via brief header + page-level address window contract)
    - Keep “DIN 5008 margins (71pt/57pt)” as deferred/not started per this plan’s Deferred items.

**Build gate**

- No additional build gate beyond Step 4’s final `bun run build` + `bun test`, but Step 5 is mandatory for completion of the implementation.

## 4. Hard rules

- **Digital mode output must be pixel-identical** before and after:
  - `InvoicePdfCoverHeader` extraction is a pure refactor to sub-components; no behavioral/layout changes.
- **No magic numbers**:
  - All DIN 5008 values must come from `PDF_DIN5008`.
  - All page rails/margins must come from `PDF_PAGE`.
  - All spacing tokens must come from `PDF_ZONES`.
- **Fold marks on cover page only**:
  - Never render fold marks on invoice appendix pages (portrait or landscape).
- **Both document components updated**:
  - Implement Brief mode for **both** `InvoicePdfDocument` and `AngebotPdfDocument`; no partial rollout.
- **Build gates must be respected**:
  - `bun run build` passes after every step independently (Step 1, Step 2, Step 3).
  - Final `bun run build` + `bun test` passes at the end (Step 4).
- **Step 5 is mandatory**:
  - The implementation is not considered complete without the docs + why-comments.

## 5. Deferred items

- **DIN left/right margin changes (71pt/57pt)**:
  - Deferred because it affects every page type (invoice cover, invoice appendix portrait, invoice appendix landscape, offer pages) and must be audited as a whole to avoid regressions and broken column width assumptions.
- **Address overflow handling**:
  - Deferred because real recipients (long company names, department lines, secondary legal blocks) may exceed the 113pt DIN window height; deciding between truncation, font scaling, or alternative layout requires visual testing with real production-like data and a policy decision.

