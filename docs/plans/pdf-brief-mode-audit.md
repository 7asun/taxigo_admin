## Brief mode feasibility audit (DIN 5008 Form B)

Scope reviewed (read-only):

- `docs/plans/pdf-architecture-audit.md`
- `src/features/invoices/lib/pdf-layout-constants.ts`
- `src/features/invoices/components/invoice-pdf/pdf-styles.ts`
- `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx`
- `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`
- `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx`
- `package.json`

Context: `renderMode: 'digital' | 'brief'` is threaded into both documents with a `console.warn` fallback; Brief currently renders the same layout as Digital. DIN 5008 Form B requires the address window to start at **127pt** from the page top, which the current flow-based header cannot guarantee.

---

## Question 1 — Current header height reality check

### Minimum realistic rendered height (no logo, shortest address)

Even “minimum” is constrained by:

- Header is always a two-column row (`styles.headerRow`) with a right-side meta container that always renders and includes:
  - meta container padding (`paddingVertical: 9`, `paddingHorizontal: 10`)
  - meta heading + multiple meta rows (number/date/customer/period; plus tax IDs unless hidden via `metaConfig.showTaxIds`)
- Left-side branding stack (`styles.brandStack`) **always reserves `marginBottom: 12`**, even when there is no logo and no slogan.
- Recipient block (`styles.recipientBlock`) is always present, but can render as little as:
  - street line (always rendered, though could be empty string)
  - zip/city line (optional, only if computed string is non-empty)

**Minimum realistic height is still well above 127pt** in typical invoices because the meta container plus brandStack spacing alone already creates a non-trivial block; and the recipient block will usually render at least one line.

### Maximum realistic rendered height (logo maxHeight + slogan + sender + address + secondaryLegalRecipient)

Maximum grows with:

- Logo: `styles.logoLeft.maxHeight = 70`
- Slogan: `styles.sloganBelowLogo` uses 9pt text with `lineHeight: 1.4` and `marginTop: 2` (can wrap)
- Sender one-line: conditional; includes `paddingBottom: 3` and a rule with `marginBottom: 1`
- Recipient block: up to 6+ lines (company, person, abteilung, street, addressLine2, zip/city, phone)
- Secondary legal block (only sometimes): `styles.secondaryLegalBlock.marginTop = 14`, `paddingTop = 8`, border, plus label/name/lines.
- Meta grid can also expand with `metaConfig.extraRows` and multi-line period values.

**Maximum realistic height can easily exceed ~250–300pt** for worst cases (logo+slogan, sender line, long recipient, plus secondary legal block).

### Existing anchor mechanism for “address starts at 127pt”

In the current implementation:

- Header is entirely **flow layout** (`<View style={styles.headerRow}>`).
- There is **no fixed container height**, **no `minHeight`/`maxHeight`**, and **no absolute positioning** used for the address block.
- The only stable “reference” is page padding top (`PDF_PAGE.marginTop = 57`), but the address start is derived from stacked content above it (branding stack, sender line, margins).

So there is **no usable anchor point today** that can pin the address to a fixed page Y coordinate.

### Absolute positioning feasibility in react-pdf (critical behavior)

- **Yes**, react-pdf supports `position: 'absolute'` on `View` and other nodes.
- An absolutely positioned child is laid out out-of-flow relative to its positioned ancestor; **it does not contribute to the parent’s height calculation** (same as CSS / Yoga semantics).
  - Consequence: if you absolutely position the address block *inside* a flow container, the container’s height will be determined by the remaining in-flow children, not by the address window.

This is the key reason a “minHeight-only” strategy cannot guarantee the address position: you need either **page-level absolute positioning** or a **fixed, explicit zone geometry**.

---

## Question 2 — Three implementation paths (address window fixed at 127pt)

### Path A — Fixed-height header zone + absolute address positioning (inside header)

- **Feasibility**: **Medium**
- **Risk to existing digital layout**: **Low → Medium** (depends on how much code you share between modes)
- **Estimated LOC changed**: ~120–250

What you’d do:

- Add a “brief header shell” mode in `InvoicePdfCoverHeader`:
  - Outer container gains a brief-only fixed height (127pt) and becomes the positioning context.
  - Address window is absolutely positioned within that 127pt zone.
  - Meta grid stays in flow (right side).

Main risk:

- The current header left column mixes branding + sender + address in one flow stack.
  - In brief mode, those must be split into:
    - “branding/sender area” (in-flow, top of zone)
    - “address window” (absolute, fixed window)
- If you keep one component and branch heavily, you risk accidental regressions in digital layout (lots of conditional code).

### Path B — Page-level absolute positioning for the address window (sibling to header)

- **Feasibility**: **Easy → Medium**
- **Risk to existing digital layout**: **Low**
- **Estimated LOC changed**: ~80–180

What you’d do:

- For brief mode only:
  - Render header **without** recipient block (branding + sender + meta only).
  - Render a separate address window `View` as a **direct child of `<Page>`**:
    - `position: 'absolute'`
    - `top: PDF_DIN5008.addressWindowTop` (127)
    - `left: PDF_PAGE.marginLeft` (45)
    - width aligned to the window spec you choose

Pros:

- Very direct: page coordinates are authoritative, and the address can be pinned to 127pt regardless of header flow height.
- Minimal interference with header logic; easiest to reason about for DIN compliance.

Cons:

- You must ensure the in-flow header content does not visually overlap the address window in brief mode.
  - That means adjusting the brief-mode header to not consume the same region.

### Path C — Separate header components (`InvoicePdfCoverHeader` digital, `InvoicePdfCoverHeaderBrief` new)

- **Feasibility**: **Medium**
- **Risk to existing digital layout**: **None → Low**
- **Estimated LOC changed**: ~200–450

Pros:

- Digital layout stays exactly as-is (least regression risk).
- Brief header can be designed cleanly around fixed DIN zones without bending the existing layout.

Cons:

- More code, more duplication (but that duplication is often the right trade in PDF layout work).

---

## Question 3 — Fold marks feasibility confirmation

### Can fold marks be rendered as absolute `View`s directly under `<Page>`?

**Yes.** Given current structure:

- `InvoicePdfDocument.tsx` renders `InvoicePdfCoverHeader`, optional `InvoicePdfReferenceBar`, `InvoicePdfCoverBody`, and `InvoicePdfFooter`.
- `AngebotPdfDocument.tsx` renders `InvoicePdfCoverHeader`, `AngebotPdfCoverBody`, and `InvoicePdfFooter`.

Adding:

```tsx
<View style={{ position: 'absolute', top: 298, left: 10, width: 8, borderTop: '0.5pt solid black' }} />
```

as a direct child of `<Page>` will render without affecting flow layout (absolute positioned).

### Existing fixed/absolute children conflicts at Y=298 / Y=421 / Y=595?

From `pdf-styles.ts`:

- Footer block is absolute with `bottom: PDF_ZONES.footerBottom` (near the page bottom).
- Page number is absolute with `top: PDF_ZONES.footerPageNumberTop` (818).

There are **no existing absolute/fixed elements** near 298, 421, or 595.

### Should fold marks live in `InvoicePdfFooter` or directly on `<Page>`?

Directly on `<Page>` is **safer** for multi-page documents:

- Footers are already absolute and tuned to the bottom; fold marks are top-anchored DIN artifacts.
- Putting fold marks in `InvoicePdfFooter` couples unrelated concerns and makes it harder to reason about which pages get marks.
- Page-level rendering allows explicit control: “only on first page” vs “every page”.

---

## Question 4 — renderMode prop threading audit

### Where renderMode currently flows

- `InvoicePdfDocument` receives `renderMode?: PdfRenderMode` and passes it to:
  - `InvoicePdfCoverHeader` (`renderMode={renderMode}`)
  - `InvoicePdfCoverBody` (`renderMode={renderMode}`)
- `AngebotPdfDocument` receives `renderMode?: PdfRenderMode` and passes it to:
  - `InvoicePdfCoverHeader` (`renderMode={renderMode}`)
- `InvoicePdfCoverHeader` accepts `renderMode` but currently ignores it (`renderMode: _renderMode`).

### Additional components that would need renderMode for Brief mode

At minimum:

- **Fold marks**: most naturally implemented in `InvoicePdfDocument` / `AngebotPdfDocument` at the `<Page>` level.
- **Address positioning**: either
  - `InvoicePdfCoverHeader` (Path A), or
  - `InvoicePdfDocument` (Path B), or
  - a new `InvoicePdfCoverHeaderBrief` (Path C).

### Existing context/provider pattern for PDF components?

In the files reviewed, there is **no React context/provider** used for PDF rendering; components rely on explicit props (`companyProfile`, `recipient`, `metaConfig`, etc.). So Brief mode will require either:

- Continued prop threading, or
- Introducing a small context specifically for PDF render settings (not present today).

---

## Question 5 — Senior engineering recommendation (direct opinion)

### Recommended header path (A/B/C)

**Recommend Path C (two separate header components).**

Reason: DIN 5008 compliance is not a “tweak” of the existing header; it is a *different layout contract* with fixed zones and absolute positioning. Keeping digital layout stable is paramount, and branching inside the same component (Path A) tends to accumulate conditional layout logic that is brittle and hard to test visually. Path C creates a clean separation: digital stays flexible/brand-driven; brief stays geometry-driven.

If you want the fastest path to a compliant MVP, Path B can be a short-term bridge—but I would still land on Path C as the maintainable end state.

### Is react-pdf the right tool for Brief mode?

**Yes, react-pdf is still viable for Brief mode here**, because:

- You already have a stable react-pdf pipeline, shared header/footer, and style tokenization (`pdf-layout-constants.ts`).
- Fold marks + absolute address windows are well within react-pdf’s capabilities.

However: if you need pixel-perfect typography across platforms (font metrics, kerning, line breaking identical to Word/LibreOffice DIN templates), Puppeteer/Chromium HTML→PDF will usually win. Based on this codebase, I would only switch to Puppeteer if:

- you must match an external DIN template exactly, or
- you hit unresolvable react-pdf layout bugs under realistic data.

### Single biggest risk not yet accounted for

**Text wrapping + variable content height inside fixed DIN windows**, especially:

- Long company names / departments
- Recipient address lines that exceed window height
- Secondary legal recipient block (for `per_client`) colliding with DIN constraints

DIN compliance requires deterministic behavior when content overflows fixed zones (truncate? shrink? spill to next line?).

### Minimum viable Brief mode (ship in one focused session)

MVP I would ship:

- **Fold marks** on cover page only (at 298/595; optionally hole mark at 421).
- **Brief header swap (Path C)**:
  - New brief header with fixed 127pt zone and **page-level absolute address window** inside that zone contract.
  - Keep the rest of the document body identical to digital (same tables, same footer).
- Defer:
  - DIN margin changes (71/57) and any complex “address overflow handling”
  - perfect alignment across all edge-case recipients
  - any redesign of the meta grid beyond keeping it readable in the brief header

---

## Implementation status

| Item | Status | Date |
|---|---|---|
| InvoicePdfBrandingBlock sub-component extracted | ✅ Done | 2026-04-15 |
| InvoicePdfMetaGrid sub-component extracted | ✅ Done | 2026-04-15 |
| InvoicePdfRecipientBlock sub-component extracted | ✅ Done | 2026-04-15 |
| InvoicePdfCoverHeaderBrief created | ✅ Done | 2026-04-15 |
| Fold marks + Lochmarke on cover page | ✅ Done | 2026-04-15 |
| Page-level address window at 127pt | ✅ Done | 2026-04-15 |
| DIN margins (71pt/57pt) | ⏳ Deferred |  |
| Address overflow handling | ⏳ Deferred |  |

