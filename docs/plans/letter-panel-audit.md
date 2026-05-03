# Split-panel PDF preview audit — Invoice & Angebot builders vs Letters (read-only)

This document answers the eight audit questions with concrete file paths and line references. No code was changed as part of this audit.

---

## 1. Panel layout structure

**There is no dedicated shared component named** `BuilderLayout`, `SplitPanelLayout`, or `TwoColumnBuilder`. The two-column shell is **duplicated** in each builder, with **one shared piece**: the right-hand preview chrome is **`InvoiceBuilderPdfPanel`** (`src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx`), reused by the Angebot builder.

**Angebot (`AngebotBuilder`)** — outer shell is **flex row** (`flex min-h-0 flex-1 overflow-hidden flex-row gap-0`):

- Left column: **full width on small screens**, fixed **480px from `lg` up** (`w-full shrink-0 … lg:w-[480px]`), border-right, contains the form column.
- Right column: **hidden below `lg`**, shown as `flex-1` from `lg` (`hidden … lg:flex`).
- References: `src/features/angebote/components/angebot-builder/index.tsx` lines **550–566** (layout), **433–547** (`leftPanel`), **558–565** (`InvoiceBuilderPdfPanel`).

**Invoice (`InvoiceBuilder`)** — same overall idea (**flex**, not CSS grid):

- Left: **fixed `w-[480px] shrink-0`** always (not `w-full` on mobile), scrollable form.
- Right: **hidden below `lg`**, `flex-1 min-w-0` from `lg`.
- References: `src/features/invoices/components/invoice-builder/index.tsx` lines **476–728** (outer `flex h-full min-h-0 gap-0 overflow-hidden`), **479** (left `w-[480px]`), **720–727** (right + `InvoiceBuilderPdfPanel`).

**Shared preview component** — `InvoiceBuilderPdfPanel` props interface: `lineItemCount`, `isLoadingTrips`, `section2Complete`, `draftInvoice`, `pdf: { loading, url }` at `invoice-builder-pdf-panel.tsx` lines **6–15**; iframe when URL ready at lines **70–79**.

**Letters today:** `LetterForm` uses a **single centered column** (`max-w-3xl`), not a split panel — `src/features/letters/components/letter-form.tsx` lines **217–218**.

---

## 2. PDF preview mechanism

**Neither builder uses `PDFViewer` from `@react-pdf/renderer` for the live preview.**

Both use the **`usePDF` hook** from `@react-pdf/renderer`, which maintains a **blob URL** consumed by an **`<iframe src={pdf.url}>`** inside `InvoiceBuilderPdfPanel`.

| Builder | Hook file | `usePDF` import | What updates the document |
|--------|-----------|-----------------|---------------------------|
| Angebot | `src/features/angebote/components/angebot-builder/use-angebot-builder-pdf-preview.tsx` | lines **14–15** (`usePDF`) | `updatePdf(<AngebotPdfDocument … />)` inside a **debounced** `useEffect` (lines **75–88**) |
| Invoice | `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` | lines **14–15** (`usePDF`) | `updatePdf(<InvoicePdfDocument … />)` inside a **debounced** `useEffect` (lines **236–266**) |

**Re-render trigger:** Any React state / memo change that alters **`draftAngebot`** / **`draftInvoice`** (or overlay inputs) causes the effect dependencies to fire; the hook then schedules **`updatePdf`** (after debounce, except invoice column reorder — see §4). There is **no** separate “refresh preview” button on desktop; typing updates state → draft recompute → hook runs.

**Letters:** Live iframe preview is **not implemented**. PDF is generated **on demand** via **`pdf(…).toBlob()`** in `letter-form.tsx` lines **179–200** (`handlePdf`).

---

## 3. State synchronisation (form → PDF)

**No React Context, no Zustand** for builder form ↔ PDF wiring. State is **lifted in the parent** client component; children receive **controlled values + callbacks** (`useState` setters or hook-returned state).

**Angebot — data path:**

1. `useState` for `empfaengerValues`, `detailsValues`; `useAngebotBuilder` for `lineItems` — `src/features/angebote/components/angebot-builder/index.tsx` lines **150–181**, **161–167**.
2. `draftAngebot` assembled with **`useMemo`** from that state — lines **253–330**.
3. `useAngebotBuilderPdfPreview({ companyProfile, draftAngebot })` — lines **332–335**.
4. Hook calls `updatePdf(<AngebotPdfDocument angebot={draftAngebot} companyProfile={…} />)` — `use-angebot-builder-pdf-preview.tsx` lines **78–84**.

Step components are **not** `react-hook-form` — they use plain controlled inputs (e.g. `Step1Empfaenger` `values` / `onChange`: `step-1-empfaenger.tsx` lines **29–32**, **64–68**).

**Invoice — data path:**

1. `useInvoiceBuilder(…)` provides `step2Values`, `lineItems`, `cancelledTrips`, etc. — `invoice-builder/index.tsx` lines **188–207**.
2. `useInvoiceBuilderPdfPreview({ … })` composes **`buildDraftInvoiceDetailForPdf`** — hook file `use-invoice-builder-pdf-preview.tsx` lines **180–211** (`draftInvoice` `useMemo`), **245–254** (`updatePdf` with `InvoicePdfDocument`).
3. `InvoiceBuilderPdfPanel` receives `pdf` and `draftInvoice` — `invoice-builder/index.tsx` lines **721–727**.

**Angebot adapter for shared panel:** When preview is inactive, Angebot still passes **`draftInvoice={livePreviewActive ? ({} as InvoiceDetail) : null}`** and **`section2Complete={livePreviewActive}`** — `angebot-builder/index.tsx` lines **559–564**. So the **same** gating/loading UI as invoices is reused; the invoice-shaped `draftInvoice` is a **placeholder** when the offer preview is off.

---

## 4. Debounce

**Yes** — both preview hooks debounce calls to `updatePdf`.

| Location | Delay | Mechanism |
|----------|-------|-----------|
| `use-angebot-builder-pdf-preview.tsx` | **600 ms** | `window.setTimeout` / `clearTimeout` in `useEffect` — lines **78–87**; rationale in file header **6–8** |
| `use-invoice-builder-pdf-preview.tsx` | **600 ms** normally, **0 ms** when `columnReorderGeneration` bumps | lines **238–244**, **243** (`delayMs = reorderBumped ? 0 : 600`) |

There is no shared `debounce` utility import in these hooks; debouncing is **inline** in the effects.

---

## 5. Responsive / mobile behaviour

**Angebot:**

- Right PDF column: **hidden** below `lg` — `index.tsx` line **558** (`hidden … lg:flex`).
- **Sheet** opens from **“Vorschau”** in the footer — lines **522–531**, **568–590**; iframe inside sheet lines **577–582**.

**Invoice:**

- Right PDF column: **hidden** below `lg` — `index.tsx` line **720**.
- Extra **“Vorschau anzeigen”** button when `isMobile` — lines **705–716**.
- **Sheet** from **bottom** (`side='bottom'`, `h-[88vh]`) — lines **729–743**; embeds second `InvoiceBuilderPdfPanel`.

**Letters:** No split panel; no mobile preview sheet (only full-page scroll + PDF download).

---

## 6. `letter-form.tsx` current structure

**Not a strict single-column form:** top-level wrapper is **`div` with `mx-auto max-w-3xl space-y-8`** — lines **217–218** (main return). Inside, sections use **`grid gap-4 sm:grid-cols-2`** for meta and recipient blocks — lines **246**, **289**.

**Props (`LetterFormProps`):** `mode`, optional `letterId`, `companyId`, `companyProfile` — lines **41–46**.

**Form fields / controls (current):**

- `letterDate` — `DatePicker` (lines **248–252**)
- `letterNumber` — `Input` (lines **254–261**)
- `status` — `Select` draft/sent (lines **262–276**)
- `subject` — `Input` (lines **277–284**)
- Recipient: `recipientCompany`, `recipientSalutation`, `recipientFirstName`, `recipientLastName`, `recipientStreet`, `recipientZip`, `recipientCity`, `recipientCountry` — lines **287–347**
- `bodyHtml` — `AngebotTiptapField` (lines **350–356**)
- Navigation/actions: back link, PDF button, Save (lines **219–237**)
- Edit-only: delete button (lines **358–379**)

State is **local `useState`** per field (lines **64–76**), hydrated from `useLetter` in edit mode (lines **78–93**).

---

## 7. `LetterPdfDocument` props

**Props interface** `LetterPdfDocumentProps` — **`letter: Letter`** and **`companyProfile: InvoiceDetail['company_profile']`** — `src/features/letters/components/letter-pdf/letter-pdf-document.tsx` lines **29–32**.

**Derivable from `letter-form` state:** The **`letter`** object is built in **`buildDraftLetter()`** (`letter-form.tsx` lines **95–133**) and matches the shape needed for PDF (id, companyId, recipient fields, subject, bodyHtml, letterDate, status, etc.). **`companyProfile` is not part of form state**; it is passed **from the page** into `LetterForm` and through to `LetterPdfDocument` in `handlePdf` (lines **185–189**).

**Async at PDF render time:** The document itself is synchronous. **`companyProfile`** is **prefetched server-side** (see §8). If the logo lives in a private bucket, the same **signed-URL** concern that invoice/angebot previews solve via **`resolveCompanyAssetUrl`** in their preview hooks (`use-angebot-builder-pdf-preview.tsx` lines **43–65**, `use-invoice-builder-pdf-preview.tsx` lines **109–132`) is **not** applied in `handlePdf` for letters — a **parity gap** if previews are added without that step.

---

## 8. `companyProfile` prefetch

**Pattern: server-side fetch in the route shell, passed as a prop to the client feature.**

| Route | Fetch | Pass-through |
|-------|--------|--------------|
| **Invoice new** | `src/app/dashboard/invoices/new/page.tsx` — `company_profiles` select lines **44–55**, `InvoiceBuilder` props **97–104** | `companyProfile={companyProfile ?? null}` |
| **Angebot new** | `src/app/dashboard/angebote/new/page.tsx` lines **36–47**, **53–56** | `AngebotBuilder` |
| **Angebot edit** | `src/app/dashboard/angebote/[id]/edit/page.tsx` lines **65–76**, **82–86** | `AngebotBuilder` |
| **Letters new** | `src/app/dashboard/letters/new/page.tsx` lines **27–37**, **44–48** | `LetterForm` |
| **Letters edit** | `src/app/dashboard/letters/[id]/page.tsx` lines **32–40**, **49–54** | `LetterForm` |

**Not used in client hooks** for letters (no `useCompanyProfile`-style fetch in `letter-form.tsx`); the composer receives **`companyProfile` from props** only (`letter-form.tsx` lines **41–45**, **54**).

**Note:** `src/app/dashboard/angebote/[id]/page.tsx` is **detail-only** (`AngebotDetailView`), not the builder — lines **25–29**. The builder with prefetch is **`/angebote/new`** and **`/angebote/[id]/edit`**.

---

## Auditor recommendation

1. **Shared layout component:** Extracting a small **`BuilderSplitShell`** (flex row, left width tokens, right `lg` visibility, optional mobile sheet slots) would **reduce duplication** between `AngebotBuilder` and `InvoiceBuilder`, which today repeat the same structural pattern (lines cited in §1) with minor differences (Angebot left is `w-full lg:w-[480px]`; Invoice left is always `w-[480px]`). **Do reuse `InvoiceBuilderPdfPanel` directly** for any letter preview — it is already the shared iframe + loading states surface (`invoice-builder-pdf-panel.tsx`). You may need a **thin adapter** or generalized props if letter preview gating does not map cleanly to `lineItemCount` / `section2Complete` / `isLoadingTrips` (Angebot already passes **synthetic** values — `angebot-builder/index.tsx` lines **559–564**).

2. **Wiring letters → `LetterPdfDocument`:** Mirror the **Angebot** path (simpler than invoice): lift or keep composable state in the letter shell, add **`useMemo` for a draft `Letter`** (or reuse `buildDraftLetter`), add **`useLetterBuilderPdfPreview`** (or rename generically) that:
   - resolves **`companyProfile` logo** via **`resolveCompanyAssetUrl`** like the other two hooks, then
   - debounces **`updatePdf(<LetterPdfDocument letter={…} companyProfile={…} />)`** with **~600 ms** given Tiptap/HTML churn.
   Pass **`pdf`** into `InvoiceBuilderPdfPanel` with letter-appropriate gate flags (e.g. treat “preview active” when `companyProfile` and minimal fields exist).

3. **Letter-specific risks:**
   - **Tiptap HTML** on every keystroke will thrash **`updatePdf`** without debounce; match **600 ms** (Angebot rationale: `use-angebot-builder-pdf-preview.tsx` lines **6–8**).
   - **`react-pdf-html`** (used in `LetterPdfCoverBody` per `docs/letters-module.md`) adds **layout latency** and cost per render; keep previews **off the critical path** for every micro-update beyond debounce, and consider **disabling preview until blur** if performance is poor.
   - **Logo / private storage:** align letter preview with **`resolveCompanyAssetUrl`** before calling `updatePdf`, or PDFs may differ from download behavior.

4. **`PDFViewer` vs `usePDF`:** The codebase **standard is `usePDF` + `<iframe>`** (`InvoiceBuilderPdfPanel` lines **75–79**). **`PDFViewer` is not used** in these flows. For consistency, **worker isolation**, and reuse of **`InvoiceBuilderPdfPanel`**, **`usePDF` is the better fit** for a letter builder preview. `PDFViewer` would introduce a second embedding pattern without clear benefit given existing hooks and panels.
