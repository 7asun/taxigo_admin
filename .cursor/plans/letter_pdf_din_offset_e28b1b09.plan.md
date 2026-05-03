---
name: Letter PDF DIN offset
overview: Add a letter-only extra top margin derived from `PDF_DIN5008` + `PDF_PAGE` (+ a small safety buffer) so flow body clears the DIN address window, applied only in `letter-pdf-document.tsx`; document audits and gate on `bun run build`. Resolve the spec formula vs. injection-site geometry with a letter-only subtrahend if needed so the margin is incremental after the brief header, not ~200pt of dead space.
todos:
  - id: constants
    content: Add PDF_ZONES_LETTER (DIN-led briefBodyExtraMarginTop + comments) to pdf-layout-constants.ts; bun run build
    status: completed
  - id: letter-doc
    content: Apply marginTop on angebotPageBody View in letter-pdf-document.tsx; comment + import; bun run build
    status: completed
  - id: cover-body
    content: Review letter-pdf-cover-body spacing; tweak only if QA shows double gap; bun run build
    status: completed
  - id: docs
    content: Update letters-pdf-din-alignment-audit.md + letters-pdf-layout-audit.md with implementation notes
    status: completed
isProject: false
---

# Letter-only DIN body offset (Option 2)

## Context

- Letters always use Brief path C: absolute window at [`PDF_DIN5008.addressWindowTop`](src/features/invoices/lib/pdf-layout-constants.ts) / [`addressWindowHeight`](src/features/invoices/lib/pdf-layout-constants.ts), then [`InvoicePdfCoverHeaderBrief`](src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header-brief.tsx), then [`View` + `styles.angebotPageBody`](src/features/letters/components/letter-pdf/letter-pdf-document.tsx) + [`LetterPdfCoverBody`](src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx).
- Overlap happens because flow subject/salutation can start **inside** the window band (~127.56–255.12 pt from **page** top) while the recipient is drawn in an absolute layer ([`letters-pdf-din-alignment-audit.md`](docs/plans/letters-pdf-din-alignment-audit.md)).
- **Do not** change [`styles.angebotPage`](src/features/invoices/components/invoice-pdf/pdf-styles.ts), [`styles.angebotPageBody`](src/features/invoices/components/invoice-pdf/pdf-styles.ts), or any invoice/Angebot components.

## Geometry note (must handle during implementation)

The suggested expression `addressWindowTop + addressWindowHeight + safetyBuffer - PDF_PAGE.marginTop` evaluates to **~198–210 pt** with realistic `safetyBuffer` (e.g. 8–12). That value is a **page-space** distance from the **page top** to “just below the window,” **not** automatically the correct `marginTop` **after** the brief header (which already consumes a large share of that vertical band).

- **Wrong:** apply ~200 pt as `marginTop` on the body wrapper → huge gap under the header.
- **Right:** use the same DIN building blocks to compute an **incremental** `marginTop` on the letter body wrapper: enough extra space so the subject band clears `windowBottom + safetyBuffer` in page Y, **given** header + existing [`PDF_ZONES.headerRowMarginBottom`](src/features/invoices/lib/pdf-layout-constants.ts) + [`PDF_ZONES.subjectMarginTopOffer`](src/features/invoices/lib/pdf-layout-constants.ts) (12 pt on the first inner `View` in [`letter-pdf-cover-body.tsx`](src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx)).

**Concrete approach (letter-only, still DIN-led):**

1. Define in [`pdf-layout-constants.ts`](src/features/invoices/lib/pdf-layout-constants.ts) (new export, e.g. `PDF_ZONES_LETTER`):

   - `briefBodySafetyBufferPt` — small pt gap below the window (e.g. 12), documented.
   - `briefBodyWindowBottomPagePt` = `PDF_DIN5008.addressWindowTop + PDF_DIN5008.addressWindowHeight` (or inline in the next line).
   - `briefBodyExtraMarginTop` = `max(0, briefBodyWindowBottomPagePt + briefBodySafetyBufferPt - PDF_PAGE.marginTop - PDF_ZONES.headerRowMarginBottom - PDF_ZONES.subjectMarginTopOffer - briefHeaderFlowReservePt)`.

   Where `briefHeaderFlowReservePt` is a **single letter-only** conservative estimate (pt) for the **flow height** of `InvoicePdfCoverHeaderBrief` (logo + sender + meta), documented as a temporary stand-in until a global `renderMode === 'brief'` body offset exists. This is the minimal “non-magic” compromise: all other terms are existing `PDF_*` symbols; one reserve constant is explicit and grep-able.

   **Alternative** if you refuse any reserve: export only `briefBodyWindowBottomPagePt + briefBodySafetyBufferPt - PDF_PAGE.marginTop` as **documented “raw clearance from content top”** and apply `Math.max(0, raw - <tuned letter-only reserve>)` **only** in [`letter-pdf-document.tsx`](src/features/letters/components/letter-pdf/letter-pdf-document.tsx) with the reserve in `PDF_ZONES_LETTER` — same effect, one place for tuning.

2. **Invariant:** `PDF_ZONES_LETTER` is imported **only** from [`letter-pdf-document.tsx`](src/features/letters/components/letter-pdf/letter-pdf-document.tsx) (and the constants file itself). Grep after change to ensure no other usages.

## Step 1 — Constants file

**File:** [`src/features/invoices/lib/pdf-layout-constants.ts`](src/features/invoices/lib/pdf-layout-constants.ts)

- Append **new export** `PDF_ZONES_LETTER` (or equivalent name) **after** existing `PDF_DIN5008` / `PDF_PAGE` so it can reference them.
- **Do not** mutate `PDF_PAGE`, `PDF_ZONES`, or `PDF_DIN5008` entries.
- Comment block (required): letter-only; compensates missing global brief-body offset per [`letters-pdf-din-alignment-audit.md`](docs/plans/letters-pdf-din-alignment-audit.md) Option C / “letter-only”; remove when shared `renderMode === 'brief'` spacing exists.

**Build:** `bun run build`.

## Step 2 — Apply offset once in letter document

**File:** [`src/features/letters/components/letter-pdf/letter-pdf-document.tsx`](src/features/letters/components/letter-pdf/letter-pdf-document.tsx)

- Import `PDF_ZONES_LETTER` from layout constants.
- On the existing `<View style={styles.angebotPageBody} wrap>` that wraps `LetterPdfCoverBody`, merge **`marginTop: PDF_ZONES_LETTER.briefBodyExtraMarginTop`** (or the chosen property name) into the style object **without** changing [`styles.angebotPageBody`](src/features/invoices/components/invoice-pdf/pdf-styles.ts) definition.
- Inline comment (required): DIN window band; temporary letter-only fix; points to [`letters-pdf-layout-audit.md`](docs/plans/letters-pdf-layout-audit.md) and [`letters-pdf-din-alignment-audit.md`](docs/plans/letters-pdf-din-alignment-audit.md).

**Build:** `bun run build`.

## Step 3 — `LetterPdfCoverBody` (likely no change)

**File:** [`src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx`](src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx)

- Keep first block `marginTop: PDF_ZONES.subjectMarginTopOffer` (12 pt) and shared `styles.subject` / `styles.salutation`.
- **Do not** change closing block (`wrap={false}`) or duplicate `bodyClosing` margins per user scope.
- **Only if** manual PDF shows excessive top gap after Step 2: reduce **letter-local** first-`View` margin (e.g. subtract from 12 using a letter-only constant in this file, **not** by editing shared `pdf-styles`). Prefer tuning `briefHeaderFlowReservePt` in Step 1 first so subject spacing stays 12 pt.

**Build:** `bun run build`.

## Step 4 — Manual QA (no code)

- Letter: compact header (small/no slogan) + typical recipient/subject/body — confirm no overlap; visible gap between window and Betreff.
- Brief Angebot + brief invoice (if UI exposes `renderMode`): confirm **no** change vs before (no edits to shared components/styles should guarantee this).
- If invoice/Angebot regress, **revert** usage outside letters — do not patch shared styles.

## Step 5 — Docs (mandatory)

1. [`docs/plans/letters-pdf-din-alignment-audit.md`](docs/plans/letters-pdf-din-alignment-audit.md): append **“Implementation”** subsection — Option 2 (letter-only offset) shipped; name of export (`PDF_ZONES_LETTER` / keys); temporary until global brief solution.
2. [`docs/plans/letters-pdf-layout-audit.md`](docs/plans/letters-pdf-layout-audit.md): short note under letter structure / risk — **top overlap** for letters addressed via letter-only offset; closing `wrap={false}` / duplicate margins remain future work.

## Files touched (only these)

| File | Change |
|------|--------|
| [`src/features/invoices/lib/pdf-layout-constants.ts`](src/features/invoices/lib/pdf-layout-constants.ts) | New `PDF_ZONES_LETTER` (DIN-led + safety + letter-only reserve / `max`) |
| [`src/features/letters/components/letter-pdf/letter-pdf-document.tsx`](src/features/letters/components/letter-pdf/letter-pdf-document.tsx) | `marginTop` on body wrapper + comment |
| [`src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx`](src/features/letters/components/letter-pdf/letter-pdf-cover-body.tsx) | Only if QA forces minimal local tweak |
| [`docs/plans/letters-pdf-din-alignment-audit.md`](docs/plans/letters-pdf-din-alignment-audit.md) | Implementation note |
| [`docs/plans/letters-pdf-layout-audit.md`](docs/plans/letters-pdf-layout-audit.md) | Shipped fix + future items |
