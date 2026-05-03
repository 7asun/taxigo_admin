---
name: Letter PDF DIN clearance
overview: Add `PDF_DIN5008.bodyStartY` as the DIN floor for letter body flow, then wrap `LetterPdfCoverBody` in a root `View` with `paddingTop` derived from `bodyStartY - PDF_PAGE.marginTop` (no literals in the letter file), removing the redundant 12pt subject top margin.
todos:
  - id: constant-bodyStartY
    content: Add PDF_DIN5008.bodyStartY after addressWindowHeight in pdf-layout-constants.ts
    status: completed
  - id: letter-padding
    content: Root View + DIN_BODY_CLEARANCE; drop subject marginTop; extend imports
    status: completed
  - id: build
    content: Run bun run build
    status: completed
isProject: false
---

# Letter PDF — DIN 5008 body clearance

## Fix 1 — [`pdf-layout-constants.ts`](src/features/invoices/lib/pdf-layout-constants.ts)

Insert **`bodyStartY: 255.12`** (and the multi-line comment block you specified) **immediately after** `addressWindowHeight` inside `PDF_DIN5008` — before the `// Fold and hole marks` section. No other edits in this file.

## Fix 2 — [`letter-pdf-cover-body.tsx`](src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx)

1. **Imports:** Extend the layout import from `PDF_ZONES` only to also import **`PDF_DIN5008`** and **`PDF_PAGE`** from the same module ([`pdf-layout-constants.ts`](src/features/invoices/lib/pdf-layout-constants.ts)) — single import line / named imports.

2. **Clearance constant (module scope, next to component or above return):**
   - `const DIN_BODY_CLEARANCE = PDF_DIN5008.bodyStartY - PDF_PAGE.marginTop` — **no numeric literals** in this file (rule 2).
   - Add a **one-line** comment on the same line or immediately above explaining this offsets flow content below the **page-level absolute** address window (per your “why” requirement).

3. **Structure:** Replace the fragment root `<>...</>` with a single **root** `<View style={{ paddingTop: DIN_BODY_CLEARANCE }}>` wrapping **all** current children (subject block, optional HTML block, closing block) so closing line stays inside the same clearance context.

4. **Remove** `marginTop: PDF_ZONES.subjectMarginTopOffer` from the **first inner** `<View>` (lines 81–84 today) — leave that `View` with no top margin (or `{}` if required). **Keep** `PDF_ZONES` usages elsewhere unchanged: `bodyMarginBottom`, `closingMarginTop`, and any styles on `Text` / `Html` unchanged.

## Verification

- Run **`bun run build`**.
- Manual PDF preview: subject/greeting start below the DIN window; if slight clip remains, bump **`bodyStartY`** only in `PDF_DIN5008` (+8–12pt) and document in the constant comment (per your verification note).

## Constraints

- Do **not** edit `AngebotPdfCoverBody`, `InvoicePdfCoverBody`, or other invoice/angebot files.
- Do **not** hardcode `255.12` or `198.12` in `letter-pdf-cover-body.tsx` — only `PDF_DIN5008.bodyStartY` and `PDF_PAGE.marginTop`.
