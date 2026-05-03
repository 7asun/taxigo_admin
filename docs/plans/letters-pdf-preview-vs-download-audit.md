# Letters PDF — preview vs download audit

Read-only audit of letter PDF generation paths. No code was modified.

**Note:** There is no `useLetterBuilderPdfPreview.ts`; the hook is [`src/features/letters/components/letter-builder/use-letter-builder-pdf-preview.tsx`](../../src/features/letters/components/letter-builder/use-letter-builder-pdf-preview.tsx). There is no `app/api/letters/.../pdf` route; letter PDFs are generated **entirely in the browser** via `@react-pdf/renderer`.

---

## 1. Preview pipeline (builder)

### How the preview is built

1. **[`LetterBuilder`](../../src/features/letters/components/letter-builder/index.tsx)** holds form `values`, builds **`draftLetter`** with **`buildDraftLetter(values, { companyId, existing })`**, and passes **`companyProfile`** (from the page server props) into **`useLetterBuilderPdfPreview`** when `companyProfile` is non-null.
2. **[`useLetterBuilderPdfPreview`](../../src/features/letters/components/letter-builder/use-letter-builder-pdf-preview.tsx)** uses **`usePDF()`** from `@react-pdf/renderer`. After a **600 ms debounce**, it calls **`updatePdf(<LetterPdfDocument letter={draftLetter} companyProfile={companyProfileForDraft} />)`**.
3. **`companyProfileForDraft`** is **`companyProfile`** with **`logo_url` overwritten** by a **signed (or resolvable) URL** from **`resolveCompanyAssetUrl`** when `logo_path` / `logo_url` exist — so the preview worker can fetch the logo from private `company-assets` storage.
4. **`InvoiceBuilderPdfPanel`** does **not** embed `<PDFViewer>` or `<BlobProvider>`. It shows an **`<iframe src={pdf.url}>`** where **`pdf.url`** is the blob URL produced by **`usePDF`** (same family as `pdf().toBlob()`, but managed by the hook).

### Props passed to `LetterPdfDocument` in the preview path

| Prop | Source |
|------|--------|
| `letter` | `draftLetter` (`buildDraftLetter` output; edit mode uses loaded row + form, create mode uses placeholder id — see §4). |
| `companyProfile` | `companyProfileForDraft` (signed `logo_url` when applicable). |

**Not passed as props:** `renderMode`, layout flags, or `PDF_ZONES_LETTER` — those are **internal** to [`LetterPdfDocument`](../../src/features/letters/components/letter-pdf/letter-pdf-document.tsx) (`renderMode` is hardcoded `'brief'`; body offset reads `PDF_ZONES_LETTER` from shared constants).

---

## 2. Download pipeline

### Path A — “PDF” button in the letter builder

1. **Trigger:** [`LetterBuilder.handlePdf`](../../src/features/letters/components/letter-builder/index.tsx) (`useCallback`).
2. **API:** No server route. Client calls **`pdf(<LetterPdfDocument ... />).toBlob()`** from `@react-pdf/renderer`, then creates an object URL and triggers a download via a temporary `<a download>`.
3. **`LetterPdfDocument` instantiation:** Same file as preview; props:
   - **`letter={draftLetter}`** (same `buildDraftLetter` as preview).
   - **`companyProfile={companyProfile}`** — the **raw** profile from **`LetterBuilder` props** (no `resolveCompanyAssetUrl` pass).

### Path B — list row download icon

1. **Trigger:** [`LetterList`](../../src/features/letters/components/letter-list.tsx) button `onClick`.
2. **API:** Same pattern — **`pdf(<LetterPdfDocument letter={letter} companyProfile={companyProfile} />).toBlob()`** in the client.
3. **`letter`:** Persisted row from React Query (`useLetters()`), not `buildDraftLetter`.
4. **`companyProfile`:** Passed from **[`letters/page.tsx`](../../src/app/dashboard/letters/page.tsx)** Supabase `company_profiles` select (same shape as builder; typically **no** signed URL unless the stored `logo_url` is already public/signed).

### Shared “generate PDF” helper for letters

There is **no** shared `buildPdfBuffer` / `createPdfResponse` for letters. All paths use the **`pdf()`** default export from `@react-pdf/renderer` directly in UI code.

---

## 3. Component / version differences

| Question | Answer |
|----------|--------|
| Same `LetterPdfDocument` file? | **Yes** — all three call sites import **`../letter-pdf/letter-pdf-document`** (or `./letter-pdf/letter-pdf-document` from list). |
| Same `LetterPdfCoverBody`? | **Yes** — only used inside `LetterPdfDocument`. |
| Alternate letter PDF / `InvoicePdfDocument` for download? | **No** — grep shows only **`LetterPdfDocument`** for letters. |

---

## 4. Prop differences that affect layout

### `letter`

| Path | Notes |
|------|--------|
| Preview & builder download | **`draftLetter`** — same assembly; **create mode** uses placeholder id `00000000-0000-4000-8000-000000000000` in [`build-draft-letter.ts`](../../src/features/letters/lib/build-draft-letter.ts) (affects **`Document` title** fallback `Brief-${id.slice(0,8)}`, not body flex layout). |
| List download | **DB `Letter`** — real `id`, persisted `bodyHtml`, `subject`, recipients, etc. Could differ from unsaved builder state if user downloads from list without saving. |

### `companyProfile` (highest-impact difference)

| Path | Logo / branding |
|------|-----------------|
| Preview | **`logo_url` replaced** with **`resolveCompanyAssetUrl`** result when assets need signing — logo **renders** in PDF. |
| Builder download | **Original** `companyProfile` — if logo relies on **private** storage and `logo_url` is not directly fetchable, **`Image`** in react-pdf may **fail** or omit logo; layout can shift (header height) vs preview. |
| List download | Same as builder download relative to server-loaded profile — **no** signing step in list. |

### `renderMode` / `PDF_ZONES_LETTER`

- **`renderMode`:** Not a prop; **`LetterPdfDocument`** always uses **`'brief'`** internally.
- **`PDF_ZONES_LETTER`:** Imported from **`pdf-layout-constants.ts`** inside **`LetterPdfDocument`** — **same bundle** for preview, builder download, and list download. There is **no** separate download bundle or stale constants path unless the user runs an old deployed build.

### Summary table

| Aspect | Preview | Builder download | List download |
|--------|---------|------------------|---------------|
| `LetterPdfDocument` | Yes | Yes | Yes |
| `letter` | `draftLetter` | `draftLetter` | Persisted row |
| `companyProfile` | Signed logo URL | Raw | Raw |
| Internal layout constants | Same file | Same file | Same file |

---

## 5. React-pdf rendering context differences

| Aspect | Preview | Download |
|--------|---------|----------|
| API | **`usePDF` → `updatePdf(element)`** → blob URL for iframe | **`pdf(element).toBlob()`** one-shot |
| Viewer | **iframe** with blob URL | N/A (file download) |
| `<PDFViewer>` / `<BlobProvider>` | **Not used** | **Not used** |
| Server `renderToStream` / edge | **Not used** for letters | **Not used** |

Both paths execute **client-side** in the same app; they should use the **same** `@react-pdf/renderer` version. There is **no** separate server renderer or global PDF style injection for letters.

**Comment in the hook** explicitly notes preview vs download may behave differently for logo fetch depending on bucket policy — aligns with **`companyProfile`** difference above.

---

## 6. Evidence of outdated or duplicated letter PDF code

- **Single** `LetterPdfDocument` implementation under [`src/features/letters/components/letter-pdf/`](../../src/features/letters/components/letter-pdf/).
- No **`letter-pdf-download`** API module or **`/api/letters/.../pdf`** route found under `src/app/api`.
- No second “legacy” letter document component located by search.

---

## 7. Root cause hypothesis (preview OK, download “broken”)

Most plausible explanations given this codebase:

1. **Logo / header height:** Preview uses **signed `logo_url`**; download uses **raw profile**. Failed or missing logo in download **shortens** the brief header stack → **different vertical position** of subject/body relative to the DIN window (especially relevant with **`PDF_ZONES_LETTER`** offset tuned against a typical header height). Symptom can look like “overlap” or “wrong spacing” vs preview even though the **same** `LetterPdfDocument` runs.

2. **Unsaved edits:** List download uses **persisted** `letter`; preview uses **draft**. Content mismatch is possible (not a component version issue).

3. **Less likely:** Old production bundle without `PDF_ZONES_LETTER` / `metaGridLayout` — would be a **deployment** issue, not two code paths in repo.

“Download still uses old `LetterPdfDocument` without marginTop” is **unlikely in source**: there is only one component file and all call sites import it.

---

## 8. Next-step recommendation

**Goal:** Same visual output for preview and download when data is equivalent.

1. **Align `companyProfile` for download with preview:** Before **`pdf().toBlob()`** in **`LetterBuilder.handlePdf`** and optionally in **`LetterList`**, resolve the logo the same way as **`useLetterBuilderPdfPreview`** (e.g. **`await resolveCompanyAssetUrl({ path: logo_path, url: logo_url })`** and pass **`{ ...companyProfile, logo_url: resolved ?? companyProfile.logo_url }`**). Extract a small shared helper (e.g. `companyProfileForLetterPdf`) to avoid duplication and document why.

2. **Optional:** If list download should match “current form” behaviour, only allow download from builder after save, or document that list PDF is last-saved version.

3. **Risks:** Signing URLs on every list download adds **async + storage** calls (acceptable for explicit user action). Caching signed URLs briefly could reduce load; ensure expiry longer than user session if needed.

4. **Not required for parity:** Unifying `usePDF` vs `pdf().toBlob()` into one helper — behaviour is already the same document tree; the **props** (especially **logo URL**) are the fix.

---

*End of audit.*
