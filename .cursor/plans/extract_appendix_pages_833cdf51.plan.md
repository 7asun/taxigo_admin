---
name: Extract Appendix Pages
overview: "Structural refactor: move lines 570–701 from `InvoicePdfDocument.tsx` into a new `InvoicePdfAppendixPages` component. No behaviour changes, no memoization, exactly 3 files touched."
todos:
  - id: scaffold-props
    content: "Step 1: Create invoice-pdf-appendix-pages.tsx with InvoicePdfAppendixPagesProps + return null; bun run build"
    status: completed
  - id: verbatim-move
    content: "Step 2: Cut lines 570–701 into new component; wire InvoicePdfAppendixPages in root; drop unused imports; bun run build"
    status: completed
  - id: verify-props
    content: "Step 3: Verify cancelledTrips/excludedTrips pass-through only to InvoicePdfAppendixPages; bun run build + bun test"
    status: completed
  - id: parity-comments
    content: "Step 4: Add Scenario A/B/C trace + why-comments (incl. no memo); bun run build + bun test"
    status: completed
  - id: update-docs
    content: "Step 5: Update docs/invoices-module.md PDF composition table + memo note; bun run build"
    status: completed
isProject: false
---

# Extract InvoicePdfAppendixPages

## Goal

Remove ~130 lines of appendix `<Page>` orchestration (Fahrtendetails grouping IIFE, passive Stornierte, Ausgeschlossene, repeated watermark + footer shell) from [`InvoicePdfDocument.tsx`](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) into [`invoice-pdf-appendix-pages.tsx`](src/features/invoices/components/invoice-pdf/invoice-pdf-appendix-pages.tsx). Callers unchanged; `cancelledTrips` / `excludedTrips` remain on `InvoicePdfDocumentProps` but flow to the new child only.

```mermaid
flowchart TB
  Doc[InvoicePdfDocument]
  Doc --> CoverPage[Cover Page]
  Doc --> AppPages[InvoicePdfAppendixPages NEW]
  AppPages --> Fahrt[Fahrtendetails Page(s)]
  AppPages --> Storno[Stornierte Page optional]
  AppPages --> Excl[Ausgeschlossene Page optional]
  Fahrt --> Appendix[InvoicePdfAppendix unchanged]
  Storno --> Appendix
  Excl --> Appendix
```

---

## Pre-read confirmations

| Item | Finding |
|------|---------|
| Cut range | Lines **570–701** — Fahrtendetails branch + Stornierte + Ausgeschlossene; ends before `</Document>` |
| Gating logic | **Stays in root** (lines 195–203): `cancelledRowsForPdf` / `excludedRowsForPdf` derived from raw props + `effectiveProfile` flags |
| Footer type | [`InvoicePdfFooterProps.companyProfile`](src/features/invoices/components/invoice-pdf/invoice-pdf-footer.tsx): `InvoiceDetail['company_profile']`; also needs `notes: string \| null` |
| Extra closed-over refs in cut block | `invoice.invoice_number`, `invoice.created_at`, `invoice.notes` — **required props** (consumed in 570–701 but omitted from user Step 1 list) |
| `invoiceId` type | `string \| null` — draft preview synthetic `InvoiceDetail` may have null id; console.warn guard checks truthiness |
| `DraftWatermark` | Local function in root (lines 119–125); cover page still uses it. **Duplicate** the identical 6-line helper in the new file (3-file constraint; no 4th shared module) |
| `cancelledRowsForPdf` naming | Cut block uses gated arrays, not raw props. Pass `cancelledRowsForPdf` as `cancelledTrips` prop; inside new component replace `cancelledRowsForPdf` → destructured `cancelledTrips` (same for `excludedTrips`) |
| Imports to move | `Page`, `groupLineItemsByBillingType`, `A4_LANDSCAPE`, `InvoicePdfAppendix`, `InvoicePdfFooter`, `styles`, `PDF_DRAFT_WATERMARK` |
| Imports to drop from root after move | `A4_LANDSCAPE`, `InvoicePdfAppendix`, `groupLineItemsByBillingType` (keep `buildInvoicePdfGroupedByBillingType` for Haupttabelle) |

---

## Step 1 — Scaffold `invoice-pdf-appendix-pages.tsx`

Create new file with props interface and `return null` placeholder.

### `InvoicePdfAppendixPagesProps`

```typescript
interface InvoicePdfAppendixPagesProps {
  appendixLineItems: InvoiceDetail['line_items'];
  /** Already gated by show_cancelled_trips in parent — passive €0 rows only */
  cancelledTrips: CancelledTripRow[];
  /** Already gated by show_excluded_trips in parent */
  excludedTrips: ExcludedTripRow[];
  effectiveProfile: PdfColumnProfile;
  showDraftWatermark: boolean;
  companyProfile: InvoiceDetail['company_profile'];
  notes: string | null;
  invoiceId: string | null;
  invoiceNumber: string;
  invoiceCreatedAtIso: string;
}
```

No `React.memo`. No JSX logic yet.

**Build gate:** `bun run build`

---

## Step 2 — Verbatim move (570–701)

1. Cut lines 570–701 from [`InvoicePdfDocument.tsx`](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx).
2. Paste as return of `InvoicePdfAppendixPages` wrapped in `<>...</>` (sibling `<Page>` elements — no `<Document>`).
3. Replace closed-over variables **only**:

| Was | Becomes |
|-----|---------|
| `appendixLineItems` | prop |
| `cancelledRowsForPdf` | `cancelledTrips` (prop — parent passes gated array) |
| `excludedRowsForPdf` | `excludedTrips` (prop) |
| `effectiveProfile` | prop |
| `showDraftWatermark` | prop |
| `cp` | `companyProfile` |
| `invoice.notes` | `notes` |
| `invoice.id` (console.warn) | `invoiceId` |
| `invoice.invoice_number` | `invoiceNumber` |
| `invoice.created_at` | `invoiceCreatedAtIso` |

4. Add local `DraftWatermark` (copy from root lines 119–125).
5. Add required imports.

In root, replace removed block with:

```tsx
<InvoicePdfAppendixPages
  appendixLineItems={appendixLineItems}
  cancelledTrips={cancelledRowsForPdf}
  excludedTrips={excludedRowsForPdf}
  effectiveProfile={effectiveProfile}
  showDraftWatermark={showDraftWatermark}
  companyProfile={cp}
  notes={invoice.notes}
  invoiceId={invoice.id}
  invoiceNumber={invoice.invoice_number}
  invoiceCreatedAtIso={invoice.created_at}
/>
```

Add **why-comment** at call site: `cancelledTrips` / `excludedTrips` are appendix-only; gating stays here, consumption moves to `InvoicePdfAppendixPages`.

Remove now-unused root imports: `A4_LANDSCAPE`, `InvoicePdfAppendix`, `groupLineItemsByBillingType`.

**No logic edits** — no simplification of IIFE, no `(?? false)` cleanup, preserve all comments including `TODO(issued-cancelled-rows)`.

**Build gate:** `bun run build`

---

## Step 3 — Verify prop pass-through

Confirm in [`InvoicePdfDocument.tsx`](src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx):

- `InvoicePdfDocumentProps` still declares `cancelledTrips?` and `excludedTrips?` (defaults `[]`).
- Gating at lines 195–203 unchanged.
- Raw props used **only** for gating + single `<InvoicePdfAppendixPages>` pass (gated arrays).
- No `cancelledTrips` / `excludedTrips` passed to `InvoicePdfAppendix` directly (that was only in cut block).

Callers ([`use-invoice-builder-pdf-preview.tsx`](src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx), detail/preview routes) — **no changes** (still pass props to `InvoicePdfDocument`).

**Build gate:** `bun run build` + `bun test` (167/167)

---

## Step 4 — Parity trace comment block

Add at top of [`invoice-pdf-appendix-pages.tsx`](src/features/invoices/components/invoice-pdf/invoice-pdf-appendix-pages.tsx) (after file header, before props):

**Scenario A** — `effectiveProfile.main_layout === 'grouped_by_billing_type'`, 2 non-empty groups, `appendix_is_landscape: true`, `showDraftWatermark: true` → 2 `<Page>` elements, each: `DraftWatermark` + `InvoicePdfAppendix` (with `groupLabel`) + `InvoicePdfFooter`; landscape size/style.

**Scenario B** — non-grouped layout, `cancelledTrips.length > 0` (parent already gated with `show_cancelled_trips`) → 1 Fahrtendetails page + 1 Stornierte page (`groupLabel='Stornierte Fahrten'`, `cancelledLandscape` from profile).

**Scenario C** — `excludedTrips` non-empty but parent passes `[]` because `show_excluded_trips === false` → only Fahrtendetails page(s); no Ausgeschlossene `<Page>`.

Add file-level **why-comment**: exists to colocate appendix page shells and move `cancelledTrips`/`excludedTrips` consumption out of root; **no `React.memo`** — `@react-pdf/renderer` layout runs outside React reconciler, memo has no effect inside `<Document>`.

**Build gate:** `bun run build` + `bun test` (167/167)

---

## Step 5 — Documentation ([`docs/invoices-module.md`](docs/invoices-module.md))

Update **§ Invoice PDF** / **PDF layout & codebase map** (table ~lines 417–434):

1. Add row for **`invoice-pdf-appendix-pages.tsx`** — owns all appendix `<Page>` wrappers (Fahrtendetails single vs `grouped_by_billing_type` multi-page, passive Stornierte, Ausgeschlossene); repeats draft watermark + footer per page; receives **pre-gated** `cancelledTrips` / `excludedTrips` from root.
2. Update root composer row: `Document` + cover `Page` + `<InvoicePdfAppendixPages />` (not “two Pages” inline).
3. Note explicitly: **no `React.memo`** in PDF tree — react-pdf performs its own layout pass; memo does not skip appendix work.

Optional: add small composition bullet under **PDF Layout System** (draft watermark section) referencing that appendix pages delegate to `InvoicePdfAppendixPages`.

**Build gate:** `bun run build`

---

## Hard rules checklist

| Rule | How enforced |
|------|----------------|
| No logic changes | Verbatim cut-paste + prop renames only |
| No `React.memo` | Not added anywhere |
| No `invoice-pdf-appendix.tsx` changes | Out of scope |
| Props stay on `InvoicePdfDocumentProps` | Interface untouched |
| No `pdf-styles.ts` changes | Import only |
| Exactly 3 files | New file + root + docs only |
| Build + test gates | After steps 1, 2, 3, 4, 5 |

---

## Risk notes

- **`DraftWatermark` duplication** is intentional (3-file limit). Both copies must stay identical until a future shared-module extraction.
- **Prop naming:** `cancelledTrips`/`excludedTrips` on the new component carry **gated** arrays from parent — document this in props JSDoc to avoid future double-gating bugs.
