# PDF preview performance audit — invoice builder

Read-only audit. Scope:

| File | Role |
|---|---|
| `src/features/invoices/hooks/use-invoice-builder.ts` | Builder state (`lineItems`, overrides, totals) |
| `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` | Debounced `usePDF` hook (note: lives under `components/invoice-builder/`, not `hooks/`) |
| `src/features/invoices/components/invoice-builder/index.tsx` | Shell; mounts preview panel + calls preview hook |
| `src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx` | Preview UI (`iframe` + blob URL) |
| `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` | PDF document tree |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-preview.tsx` | **Detail-page** preview (separate route; uses `PDFViewer`) |

### `invoice-builder/` folder inventory

| File | PDF-related? |
|---|---|
| `index.tsx` | Yes — mounts panel, calls `useInvoiceBuilderPdfPreview` |
| `use-invoice-builder-pdf-preview.tsx` | Yes — `usePDF` |
| `invoice-builder-pdf-panel.tsx` | Yes — displays `pdf.url` in `<iframe>` |
| `step-1-mode.tsx` | No |
| `step-2-params.tsx` | No |
| `step-3-line-items.tsx` | No (calls override handlers only) |
| `step-4-vorlage.tsx` | No direct react-pdf API (column profile state only) |
| `step-4-confirm.tsx` | No direct react-pdf API (Step 5 overlay only) |

No file under `invoice-builder/` uses `PDFViewer` or `BlobProvider`.

---

## 1. What triggers a PDF re-render? Debounced?

**Trigger chain**

1. Any builder input that changes `draftInvoice` (or its overlay deps) schedules a PDF update.
2. `useInvoiceBuilderPdfPreview` calls `updatePdf(<InvoicePdfDocument … />)` inside a `useEffect` (`use-invoice-builder-pdf-preview.tsx` L254–292).
3. `draftInvoice` is rebuilt in `useMemo` whenever `lineItems` (via `includedLineItemsForDraft`), `step2Values`, `columnProfile`, text blocks, recipient, payment days, etc. change (`use-invoice-builder-pdf-preview.tsx` L193–231).
4. The same effect also depends on `introText`, `outroText`, `columnProfile`, `paymentQrDataUrl`, `passiveCancelledTrips`, `excludedTrips`, and `columnReorderGeneration`.

**`use-invoice-builder.ts` and PDF**

- No `useEffect`, `useMemo`, or PDF queries depend on `lineItems` directly in this hook.
- `lineItems` changes only propagate to PDF indirectly: `index.tsx` passes `lineItems` into `useInvoiceBuilderPdfPreview` (L416–434).
- Derived values in the hook (`totals`, `missingPrices`, `hasInclusionErrors`) recalculate on every render when `lineItems` changes (L756–778) but do not feed the PDF hook except where `index.tsx` passes them as separate props (e.g. excluded trips are pre-split from `lineItems` in `index.tsx` L390–402).

**Debouncing: yes — 600 ms default**

```263:263:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
    const delayMs = reorderBumped ? 0 : 600;
```

- Normal edits: **600 ms** debounce before `updatePdf` runs (`use-invoice-builder-pdf-preview.tsx` L254–281).
- Column drag-reorder in Section 4: **0 ms** (immediate) when `columnReorderGeneration` bumps (`use-invoice-builder-pdf-preview.tsx` L258–262, L78).
- Cleanup clears the pending timer on dependency change, so rapid edits coalesce into one render after the last change + 600 ms.

**When PDF is *not* recomputed**

- `livePreviewActive` is false → `draftInvoice` is `null` → effect returns early (`use-invoice-builder-pdf-preview.tsx` L175–176, L198–200, L257).
- Conditions: `lineItems.length === 0`, missing `step2Values`, or missing `companyProfile`.

**Not debounced separately**

- QR code generation runs on every `draftInvoice` change with no debounce (`use-invoice-builder-pdf-preview.tsx` L236–252).
- Logo signed-URL resolution runs on logo path/url change (`use-invoice-builder-pdf-preview.tsx` L122–144).

---

## 2. Is the PDF preview always mounted?

**Hook: always active**

`useInvoiceBuilderPdfPreview(...)` is invoked unconditionally at the top level of `InvoiceBuilder` (`index.tsx` L416–434). It runs on every builder page load regardless of which section is open.

**Panel DOM: always present on desktop**

```827:834:src/features/invoices/components/invoice-builder/index.tsx
      <div className='hidden h-full min-w-0 flex-1 flex-col overflow-hidden lg:flex'>
        <InvoiceBuilderPdfPanel
          lineItemCount={lineItems.length}
          isLoadingTrips={isLoadingTrips}
          section2Complete={section2Complete}
          draftInvoice={draftInvoice}
          pdf={pdf}
        />
```

- Right column is in the DOM for all sections (Steps 1–5) on `lg+` viewports.
- It is **not** gated on “PDF preview step” or Section 4 unlock.

**Mobile**

- Panel is hidden by default; duplicate `InvoiceBuilderPdfPanel` mounts inside a bottom `Sheet` when the user taps “Vorschau anzeigen” (`index.tsx` L812–851).

**When the iframe / PDF worker actually runs**

| Phase | Panel shows | `updatePdf` runs? |
|---|---|---|
| Step 1–2, trips not loaded | Placeholder (“Fahrten laden…”) | No (`draftInvoice` null) |
| Trips loading | “Fahrten werden geladen…” | No |
| Step 3+ with line items | `<iframe src={pdf.url}>` | Yes (debounced) |

So: the **preview column is always mounted** on desktop after the builder loads; **PDF generation starts** once Section 2 is complete, trips are loaded, and `lineItems.length > 0` — typically while the user is still on Step 3, not only on a dedicated preview step.

---

## 3. Which react-pdf API?

**Invoice builder: `usePDF` (blob URL → iframe)**

```116:116:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  const [pdf, updatePdf] = usePDF();
```

```74:78:src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx
        ) : pdf.url ? (
          <iframe
            title='Rechnungs-PDF-Vorschau'
            src={pdf.url}
            className='absolute inset-0 h-full w-full border-0'
```

- **`usePDF`**: imperative `updatePdf(ReactElement)`; exposes `{ loading, url }`.
- **Not** `PDFViewer` or `BlobProvider` in the builder path.

**Contrast: invoice detail preview route**

`src/features/invoices/components/invoice-pdf/invoice-pdf-preview.tsx` uses **`PDFViewer`** (L110–118) — iframe-based viewer component, different from the builder.

---

## 4. State update chain when price or KM changes

### KM override

| Step | Location | What happens |
|---|---|---|
| 1 | `step-3-line-items.tsx` L285–294 | `commitKmEdit` parses input, calls `onApplyKmOverride(state.position, parsed)` |
| 2 | `index.tsx` L676 | Prop wired to `applyKmOverride` from `useInvoiceBuilder` |
| 3 | `use-invoice-builder.ts` L397–462 | `setLineItems((prev) => prev.map(...))` |
| 4 | `index.tsx` L416+ | Re-render; new `lineItems` ref passed to preview hook |
| 5 | `use-invoice-builder-pdf-preview.tsx` L193–196 | `includedLineItemsForDraft` recomputes (new array ref) |
| 6 | L198–231 | `draftInvoice` `useMemo` rebuilds full draft object |
| 7 | L254–281 | Debounced `updatePdf(<InvoicePdfDocument …>)` after 600 ms |

### Gross price override

Same pattern via `commitEdit` → `onApplyGrossOverride` (`step-3-line-items.tsx` L357–364) → `applyGrossOverride` (`use-invoice-builder.ts` L341–368).

### Targeted vs whole-array replace

**Update style:** functional `setLineItems(prev => prev.map(...))` — **new array every time**, but **only the matching `position` gets a new object**; other items are returned by reference unchanged (`use-invoice-builder.ts` L343–345, L399–400).

**PDF impact:** because the hook’s `useMemo` depends on `[lineItems]` (the array reference), not deep equality, **any single-item edit invalidates `includedLineItemsForDraft` and `draftInvoice`**, even though unchanged row objects are structurally shared. The full draft `InvoiceDetail` and full `InvoicePdfDocument` tree are regenerated on each debounced tick.

Step 3 local edit state (`kmEditing`, `editing`) is component-local and does **not** touch `lineItems` until blur/commit (`step-3-line-items.tsx` L269–321, L334–373).

---

## 5. Memoization protecting the PDF document?

| Mechanism | Present? | Location |
|---|---|---|
| `React.memo` on `InvoicePdfDocument` | **No** | — |
| `React.memo` on `InvoiceBuilderPdfPanel` | **No** | — |
| `useMemo` for `draftInvoice` | **Yes** | `use-invoice-builder-pdf-preview.tsx` L198–231 |
| `useMemo` for stable trip sub-arrays | **Yes** | `index.tsx` L390–414 (`excludedTripsForPdf`, cancelled splits) |
| `useCallback` for PDF-related props | **Partial** | Handlers in `index.tsx`; not on PDF document |
| Debounced `updatePdf` | **Yes** | 600 ms (`use-invoice-builder-pdf-preview.tsx` L263) |

**Explicit guard against infinite PDF reload**

```387:389:src/features/invoices/components/invoice-builder/index.tsx
  // why: useMemo so the derived array keeps a stable reference between renders —
  // an inline .filter().map() produces a new array every render, firing the
  // preview hook's useEffect dependency comparison and causing an infinite reload loop.
```

Without `useMemo` on `excludedTripsForPdf` / cancelled splits, the preview `useEffect` would fire every parent render even when trip data unchanged.

**No protection** against re-render when unrelated builder state changes (section open/close, scroll, Step 4 form) unless those states also change preview deps. Section toggles alone do not pass into the preview hook.

---

## 6. Page reload / state loss (10–15 trip edits)

**Reproduction status:** Not reproduced in this audit environment (no interactive browser session, no DevTools attached). Findings below are from static analysis and known architecture.

### What to check in browser DevTools

When editing 10–15 trips, monitor:

1. **Console**
   - Unhandled promise rejections (logo URL, QR import, `updatePdf` worker errors).
   - React error-boundary messages (would show overlay, not silent reload).
   - Memory / “Aw, Snap!” / tab killed messages (Chromium OOM).

2. **Network**
   - Unexpected full document navigation (would indicate `router.push` or hard reload).
   - Only expected: text blocks, empfaenger options, logo signed URL.

3. **Performance / Memory**
   - Heap growth during repeated KM/price commits (each debounced tick = full PDF layout in `@react-pdf` worker + new blob URL in iframe).

4. **Application**
   - Session storage / Clerk session intact after “reload” → distinguishes tab crash vs in-app navigation.

### Likely mechanisms (code-informed)

| Symptom | Likely cause in this codebase |
|---|---|
| Tab goes blank / “Page unresponsive” | **Browser tab OOM** — live preview runs full `InvoicePdfDocument` (cover + appendix + cancelled/excluded pages) on every debounced `lineItems` change while the right panel stays mounted (`index.tsx` L827–834). 10–15 edits ⇒ 10–15 full PDF generations. |
| Form resets, URL unchanged | **React tree remount** (error boundary) or **hot reload in dev** — no builder-local `router.push` on edit; navigation only on create/save success (`use-invoice-builder.ts` L868–876, L980–993). |
| Full page navigation to another route | **Save/create success** or user action — not triggered by KM/price handlers. |
| Infinite “Vorschau wird aktualisiert…” | Historical **infinite `useEffect` loop** from unstable array refs — mitigated by `useMemo` in `index.tsx` L390–414; if reload persists, verify no new inline `.filter().map()` passed into preview deps. |

### No evidence in code of

- Intentional page reload on line-item edit.
- Debounce bypass on KM/price (always 600 ms unless column reorder).
- PDF preview unmount when user is on Step 1/2 **after** trips are loaded (preview keeps updating in background on Step 3).

### Recommended manual repro protocol

1. Open builder on desktop (`lg+`), complete Steps 1–2, load ≥15 trips.
2. Open DevTools → Console (preserve log) + Performance monitor (JS heap).
3. Edit KM on 10–15 rows sequentially (blur each field).
4. Note whether:
   - URL changes (`/dashboard/invoices/new` vs detail) → navigation.
   - Error overlay appears → React error boundary.
   - Tab dies with no Next.js overlay → memory / worker crash.
   - Builder state clears with same URL → parent remount or HMR.

---

## Summary

| Question | Answer |
|---|---|
| PDF re-render trigger | `draftInvoice` / overlay deps change → debounced `updatePdf` |
| Debounce | **600 ms** (0 ms on column reorder) |
| Always mounted? | Hook + desktop panel **yes**; iframe/PDF worker only after trips loaded |
| react-pdf API | Builder: **`usePDF` + iframe**; detail route: **`PDFViewer`** |
| Line item update | `prev.map` — new array, one new item object; full draft + PDF rebuild |
| Memo protection | `useMemo` + debounce; **no** `React.memo` on document |
| Reload issue | **Not reproduced here**; most plausible: memory from repeated full PDF renders while preview stays live on Step 3 |
