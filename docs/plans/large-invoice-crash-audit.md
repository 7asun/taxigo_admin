# Audit — Large invoice (160+ trips) browser crash / tab death

**Scope:** Invoice builder create/edit flow with many line items, PDF live preview (`usePDF`), and long editing sessions (60–90 minutes). Read-only; no code changes.

**Context:** [`docs/plans/km-reset-audit.md`](km-reset-audit.md) (trips refetch / KM state), [`docs/plans/pdf-preview-performance-audit.md`](pdf-preview-performance-audit.md) (older monolithic debounce notes; superseded in part by split-trigger preview).

**Files read:**

| File | Role |
|------|------|
| `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` | Split Category A/B preview, `usePDF`, `requestPreviewUpdate` |
| `src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx` | iframe + blob revocation |
| `src/features/invoices/components/invoice-builder/index.tsx` | Always mounts preview hook + desktop panel |
| `src/features/invoices/hooks/use-invoice-builder.ts` | `lineItems` state (partial; no PDF coupling) |
| `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` | Full PDF tree |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx` | Per-row appendix table |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix-pages.tsx` | Appendix `Page` shells |
| `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` | `lineItems` → `InvoiceDetail` |
| `node_modules/@react-pdf/renderer/lib/react-pdf.browser.js` | `usePDF` blob / URL lifecycle |

---

## Section 1 — PDF preview trigger surface at 160+ trips

### 1. `requestPreviewUpdate` → `commitPreviewUpdate` → `updatePdf` (main thread)

**User action:** Clicks **Aktualisieren** in `InvoiceBuilderPdfPanel` → `onRequestPreviewUpdate` → `requestPreviewUpdate` from the hook.

**Synchronous call chain (same React event turn):**

```451:461:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  const requestPreviewUpdate = useCallback(() => {
    setCategoryBDirty(false);
    // why: if a layout change was queued and the user clicks Aktualisieren immediately,
    // clearing the timer prevents a double render — commitPreviewUpdate already uses
    // the latest draftInvoice including the layout change.
    if (categoryADebounceTimerRef.current !== null) {
      window.clearTimeout(categoryADebounceTimerRef.current);
      categoryADebounceTimerRef.current = null;
    }
    commitPreviewUpdate();
  }, [commitPreviewUpdate]);
```

```332:350:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  const commitPreviewUpdate = useCallback(() => {
    const p = previewPayloadRef.current;
    if (!p.draftInvoice) return;
    updatePdf(
      <InvoicePdfDocument
        invoice={p.draftInvoice}
        introText={p.introText}
        outroText={p.outroText}
        paymentQrDataUrl={p.paymentQrDataUrl}
        columnProfile={p.columnProfile}
        cancelledTrips={p.passiveCancelledTrips}
        excludedTrips={p.excludedTrips}
        showDraftWatermark={true}
      />
    );
  }, [updatePdf]);
```

```353:355:node_modules/@react-pdf/renderer/lib/react-pdf.browser.js
  const update = useCallback(newDoc => {
    pdfInstance.current.updateContainer(newDoc);
  }, []);
```

**What runs after `updateContainer` (async, still main-thread layout in browser build):**

1. `@react-pdf` reconciler walks the `InvoicePdfDocument` element tree.
2. Layout engine (`@react-pdf/layout`) measures and paginates every `Page` / `View` / `Text`.
3. `pdf().toBlob()` produces a PDF `Blob` (queued, concurrency **1**).
4. On success, `usePDF` sets `{ loading: false, url: URL.createObjectURL(blob), blob }`.

There is **no Web Worker** on this path in `@react-pdf/renderer` 4.3.2 browser bundle — layout and blob generation block or contend with the main thread until complete.

**React component traversal (160 included billing rows, default appendix profile):**

| Layer | Components / pages |
|--------|-------------------|
| Root | `Document` → cover `Page` (watermark, header, reference bar, cover body, footer) |
| Appendix | `InvoicePdfAppendixPages` → 1× `Page` + `InvoicePdfAppendix` when `main_layout !== 'grouped_by_billing_type'` (default) |
| Optional | +1 `Page` if passive cancelled trips + `show_cancelled_trips`; +1 if excluded trips + `show_excluded_trips` |
| Per trip | `renderLineItemRow` → row `View` + **7** column cells (default `SYSTEM_DEFAULT_APPENDIX_COLUMNS`) → each cell `View` + `Text` |

Default appendix columns (7): `position`, `trip_date`, `client_name`, `pickup_address`, `dropoff_address`, `distance_km`, `net_price`.

**Rough JSX / layout node estimate (160 trips, single appendix page, no extra cancelled/excluded pages):**

- Cover page: ~80–150 nodes (header, summary table, QR block, intro/outro).
- Appendix: `coerceLineItemJsonbSnapshots` over 160 rows; header row ~14 nodes; **160 × (~7 cols × 2 + row wrapper ≈ 16)** ≈ **2,560** row nodes; KTS / cancelled-reason sub-rows add more on affected rows.
- **Order of magnitude: ~2,700–3,500** `@react-pdf` primitives for one full preview generation, before internal layout splits across PDF pages.

If `main_layout === 'grouped_by_billing_type'`, appendix splits into **one `Page` per billing group** (each still rendering its subset of rows) — total nodes similar, more page overhead.

**`commitPreviewUpdate` does not rebuild `draftInvoice`** — it reads `previewPayloadRef.current`, which is refreshed every render. The heavy **data** work for the click happened on the **last React render** (see Section 2).

---

### 2. Category A auto-triggers at 160+ trips (without Aktualisieren)

Split-trigger contract (file header + effects):

| Class | Triggers `commitPreviewUpdate`? |
|--------|--------------------------------|
| **Category A** | Yes — debounced `scheduleCategoryAUpdate` (600 ms, 0 ms on column reorder) |
| **Category B** | **No** — only `setCategoryBDirty(true)`; manual **Aktualisieren** |

**Category A `useEffect` dependencies** (auto preview **after** first successful `pdf.url`):

```398:425:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  useEffect(() => {
    if (!livePreviewActive) return;
    if (!hasCompletedFirstRenderRef.current) return;

    const reorderBumped =
      columnReorderGeneration !== lastColumnReorderGen.current;
    if (reorderBumped) {
      lastColumnReorderGen.current = columnReorderGeneration;
      scheduleCategoryAUpdate(PREVIEW_COLUMN_REORDER_DELAY_MS);
      return;
    }

    scheduleCategoryAUpdate(PREVIEW_CATEGORY_A_DEBOUNCE_MS);
  }, [
    livePreviewActive,
    introText,
    outroText,
    columnProfile,
    columnReorderGeneration,
    companyProfileForDraft,
    step2Values,
    paymentDueDays,
    recipientRow,
    payers,
    clients,
    companyId,
    scheduleCategoryAUpdate
  ]);
```

**Explicitly not in Category A deps:** `draftInvoice`, `lineItems`, `paymentQrDataUrl` (QR regen must not auto-reflow PDF on trip edits).

| Category A dep | Can change during long Step 3 session? | Risk at 160 trips |
|----------------|----------------------------------------|-------------------|
| `introText` / `outroText` | Only when Section 5 open **and** `applyStep4PdfOverlay` (`section4Unlocked && pdfStepAcknowledged && sectionOpen[5]`) | Low on Step 3 |
| `columnProfile` | Section 4 PDF-Vorlage edits | Medium if admin opens §4 |
| `columnReorderGeneration` | Column drag in §4 | Medium; **0 ms** debounce → immediate full PDF |
| `companyProfileForDraft` | Logo signed URL resolves (`pdfLogoUrl` effect, 1 h expiry) | Low; one extra render possible |
| `step2Values` | Unlikely after Step 2 submit (edit mode seeds once) | Low |
| `paymentDueDays` / `recipientRow` | Section 5 overlay only | Low on Step 3 |
| `payers` / `clients` / `companyId` | Static props from server page | None |
| **First load** | `draftInvoice` effect schedules **one** initial Category A render | **Always** one full PDF when trips load |

**`paymentQrDataUrl`:** Regenerated on **every** `draftInvoice` change (no debounce), but **does not** auto-call `updatePdf`:

```303:320:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  useEffect(() => {
    if (!draftInvoice) {
      setPaymentQrDataUrl(null);
      return;
    }
    let cancelled = false;
    import('.../generate-payment-qr-data-url').then(({ generatePaymentQrDataUrl }) => {
      void generatePaymentQrDataUrl(draftInvoice).then((url) => {
        if (!cancelled) setPaymentQrDataUrl(url);
      });
    });
    return () => { cancelled = true; };
  }, [draftInvoice]);
```

**Trip edits (Category B):** Do **not** schedule `commitPreviewUpdate`. They **do** still rebuild `draftInvoice` via `includedLineItemsForDraft` in `useMemo` on every `lineItems` reference change — CPU + memory churn without PDF, unless admin clicks Aktualisieren.

**No `step2Values` timeout** in preview code. Trips query uses `refetchOnWindowFocus: false` (see km-reset audit) — not a preview trigger.

---

### 3. Blob URL accumulation and revocation

#### Panel (`invoice-builder-pdf-panel.tsx`)

```48:57:src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx
  useEffect(() => {
    if (!pdf.url || pdf.loading) return;
    if (pdf.url === displayedPdfUrlRef.current) return;

    if (displayedPdfUrlRef.current) {
      URL.revokeObjectURL(displayedPdfUrlRef.current);
    }
    displayedPdfUrlRef.current = pdf.url;
    setIframeSrc(pdf.url);
  }, [pdf.url, pdf.loading]);
```

- Iframe **only** swaps when `pdf.url` is set **and** `pdf.loading === false` (matches `usePDF` setting both in one `setState` in `onRenderSuccessful`).
- While `pdf.loading === true`, previous `iframeSrc` stays — old PDF visible; panel does **not** revoke until the new URL is adopted.
- Unmount / `draftInvoice` null: panel revokes `displayedPdfUrlRef` and clears iframe.

#### `usePDF` (`react-pdf.browser.js` 4.3.2)

```324:352:node_modules/@react-pdf/renderer/lib/react-pdf.browser.js
    const onRenderSuccessful = blob => {
      setState({
        blob,
        error: null,
        loading: false,
        url: URL.createObjectURL(blob)
      });
    };
    // ...
  useEffect(() => {
    return () => {
      if (state.url) {
        URL.revokeObjectURL(state.url);
      }
    };
  }, [state.url]);
```

- Each successful render creates a **new** object URL.
- When `state.url` changes, React runs the **cleanup** of the previous effect and **revokes the prior URL**.
- Render queue **`concurrency: 1`** — at most one `toBlob()` in flight; reduces overlapping blobs.

**Residual leak scenarios:**

| Scenario | Likelihood |
|----------|------------|
| Panel and `usePDF` both revoke the same URL when swapping | Low — same string reference; second revoke is a no-op in browsers |
| `onRenderFailed` — `url` left stale, no new blob | Old URL kept until next success; not duplicated |
| Many **completed** renders over a session | Each new `url` should revoke the previous via `usePDF` effect; panel revokes the last **displayed** URL when adopting the next |
| **`blob` field retained in `usePDF` state** | Full PDF binary stays in JS heap until replaced — **dominant memory**, not object-URL leak |
| iframe holds decoded PDF | Browser keeps PDF document in memory for current `src` — separate from blob URL |

**Conclusion:** Object-URL **leak is unlikely** if the panel and `usePDF` hooks stay mounted; **PDF blob + decoded iframe memory** scales with **each successful preview** and **size of document** (160-row appendix), not with unreleased `blob:` strings alone.

---

## Section 2 — `lineItems` memory at scale

### 4. `BuilderLineItem` shape and size

**Type:** `src/features/invoices/types/invoice.types.ts` (`BuilderLineItem`, L541–711).

| Field | Notes |
|-------|--------|
| `trip_id`, `position` | IDs / numbers |
| `line_date`, `description`, `client_name` | Strings |
| `pickup_address`, `dropoff_address` | **Full address strings** (often 50–120 chars each) |
| `distance_km`, `effective_distance_km`, `original_distance_km` | numbers |
| `manual_km_enabled`, `manualDistanceKm`, `isManualKmOverride` | optional override |
| `unit_price`, `approach_fee_net`, `quantity`, `tax_rate` | numbers |
| `billing_variant_code`, `billing_variant_name`, `billing_type_name` | strings |
| `kts_document_applies`, `no_invoice_warning`, `is_wheelchair` | booleans |
| `isManualTaxRateOverride` | optional |
| **`price_resolution`** | `PriceResolution` object (~8–10 fields: gross, net, tax_rate, strategy_used, source, note, unit_price_net, quantity, approach_fee_net) |
| **`resolved_rule`** | Optional **`BillingPricingRuleLike`** — includes **`config: unknown`** (tiered km tiers array can be **large**) |
| `kts_override`, `trip_meta` | small |
| `price_source`, `warnings[]` | small |
| `billingInclusion` | `{ included, reason }` |
| `approach_fee_gross`, `originalPriceResolution`, `manualGrossTotal`, `manualApproachFeeGross`, `isManualOverride` | override snapshots |

**Large fields:** addresses (×2), **`price_resolution`**, **`originalPriceResolution`** (duplicate), **`resolved_rule.config`** (JSON-like tier arrays).

**No separate `price_resolution_snapshot` on `BuilderLineItem`** — snapshot is created only when mapping to draft/DB (`frozenPriceResolutionForInsert` → `price_resolution_snapshot` on `InvoiceLineItemRow`).

**Rough per-row heap estimate (V8):**

| Component | Bytes (order of magnitude) |
|-----------|----------------------------|
| Scalar + short strings | 500–1,500 |
| Two addresses | 200–400 |
| `price_resolution` + `originalPriceResolution` | 400–800 |
| `resolved_rule` with tiered `config` | 500–3,000+ |
| **Total per `BuilderLineItem`** | **~2–6 KB typical; up to ~10 KB** with heavy rules |

**160 rows:** **~320 KB – 1.6 MB** for `lineItems` alone (excluding React overhead and duplicated draft structures).

---

### 5. Array copies on one `requestPreviewUpdate` click

**On the click itself (synchronous):**

1. `requestPreviewUpdate` → `commitPreviewUpdate` — **no** new `lineItems` filter/map in the hook.
2. `updatePdf` uses **existing** `p.draftInvoice` from `previewPayloadRef` (last render).

**Data work already paid on the preceding render** (when `lineItems` last changed):

| Step | Allocation |
|------|------------|
| `includedLineItemsForDraft = lineItems.filter(...)` | 1 new array (≤160 refs) |
| `buildDraftInvoiceDetailForPdf` | `lineItems.map(builderItemToDraftLineItem)` → **160 new row objects**; merge cancelled; **`.sort()`** new array; **`.map` re-position** → **third** array |
| `calculateInvoiceTotals([...lineItems, ...cancelled])` | iterates; no full copy of 160 builder rows beyond spread input |
| `previewPayloadRef.current = { draftInvoice, ... }` | pointer assign |

**Inside `InvoicePdfDocument` during `updatePdf` layout** (same `draftInvoice`):

| Step | Allocation |
|------|------------|
| `mainLineItems = invoice.line_items.filter(...)` | 1 array |
| `appendixLineItems = invoice.line_items.filter(...).sort(...)` | 2 arrays |
| `lineItemsForCalc = ...filter(...).map(...)` | **160 new `BuilderLineItem`-shaped objects** for totals |
| `InvoicePdfAppendix`: `coercedLineItems = lineItems.map(coerceLineItemJsonbSnapshots)` | **160 row copies** |
| Grouped layout: `group.items.map` with spread per group | extra copies per group |

**Conservative count for one Aktualisieren after fresh render:** **~6–10 intermediate arrays / 320+ row object clones** touching all 160 trips through draft build + PDF tree (many short-lived, GC pressure under load).

---

### 6. `price_resolution_snapshot` in memory for 160 trips

**In builder session:**

- **`BuilderLineItem.price_resolution`** — live object on every row (always).
- **`BuilderLineItem.resolved_rule`** — often present for repricing; **not** the DB snapshot but can be **larger** than snapshot (full rule + `config`).

**In `draftInvoice.line_items` (preview):**

```95:96:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
    price_resolution_snapshot: frozen as unknown as Record<string, unknown>,
```

`frozenPriceResolutionForInsert` returns a **flattened `PriceResolution`** (~8 fields, shallow object) — **not** a deep JSONB dump.

**Typical snapshot:** ~200–400 bytes serialized; shallow `Record` in memory.

**160 rows:** **~32–64 KB** for snapshots in `draftInvoice.line_items`, **plus** the full `BuilderLineItem` graph still held in `lineItems` state (much larger).

**Depth:** 1 level (fields on `PriceResolution`); no nested tiers in snapshot (tiers stay in `resolved_rule` on builder row only).

---

## Section 3 — Render loop risks

### 7. Timers, effects, polling, QR cost

| Mechanism | Present? | At 160 trips |
|-----------|----------|--------------|
| `setInterval` in builder / preview | **No** | — |
| `setTimeout` | Category A debounce **600 ms** (one-shot); column reorder **0 ms**; Step 3 KM debounce **600 ms** (separate file) | Bounded |
| `useEffect` deps changing every render | **No** obvious unstable deps in preview hook | — |
| React Query **`refetchInterval`** on builder queries | **No** | — |
| `useAllInvoiceTextBlocks` | `staleTime: 5 * 60 * 1000`; global `refetchOnWindowFocus: true` | Rare refetch; not PDF |
| `useRechnungsempfaengerOptions` | `staleTime: 60_000`; focus refetch | Rare |
| `tripsQuery` | `refetchOnWindowFocus: false` | No trip refetch wipe (km-reset fix) |

**Category B signature effect — high CPU at scale:**

```73:84:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
function categoryBSignature(...) {
  return JSON.stringify({
    included: includedLineItems,
    billedCancelled,
    passiveCancelled,
    excluded
  });
}
```

Runs on **every** change to `includedLineItemsForDraft` / cancelled / excluded arrays. At 160 rows this serializes **full** line objects (including `price_resolution`, `resolved_rule`, addresses) — **O(n × row size)** per KM/price edit, **no PDF**, but main-thread JSON work **every edit**.

**QR generation:** `generatePaymentQrDataUrl` — dynamic import + `QRCode.toDataURL` (240×240 PNG data URL). Cheap vs PDF; runs on **`draftInvoice` change** (every `lineItems` update), async, cancelled on cleanup.

---

### 8. Is preview active on Step 3? Does `commitPreviewUpdate` run hidden?

```243:244:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  const livePreviewActive =
    lineItems.length > 0 && !!step2Values && !!companyProfile;
```

- **`livePreviewActive`** is true whenever trips are loaded — **including Step 3**, regardless of which accordion section is open.
- **No** tab-visibility, `document.hidden`, or “Section 4/5 only” guard on the hook.

```422:441:src/features/invoices/components/invoice-builder/index.tsx
  const { pdf, draftInvoice, isDirty, requestPreviewUpdate } =
    useInvoiceBuilderPdfPreview({ ... });
```

Hook runs **unconditionally** in `InvoiceBuilder`.

```836:845:src/features/invoices/components/invoice-builder/index.tsx
      <div className='hidden ... lg:flex'>
        <InvoiceBuilderPdfPanel ... />
```

Desktop panel is **always mounted** (hidden on small screens; mobile uses Sheet).

| Action | Step 3 (160 trips) |
|--------|---------------------|
| Trip edit (Category B) | **No** `commitPreviewUpdate`; **yes** `draftInvoice` rebuild + `categoryBSignature` JSON.stringify + QR effect |
| First trips load | **Yes** — one debounced Category A PDF |
| §4 column / text / logo | **Yes** — Category A debounced PDF |
| **Aktualisieren** | **Yes** — immediate full PDF |

---

## Section 4 — Browser crash signals

### 9. Error boundaries

- **No** `error.tsx` under `src/app/dashboard/invoices/` (only overview parallel routes have error boundaries).
- **No** `ErrorBoundary` around `InvoiceBuilder` or `InvoiceBuilderPdfPanel` in `index.tsx`.
- `@react-pdf` `usePDF` logs render errors to **`console.error`** and sets `state.error` — does not recover in UI.

**If layout throws or OOM:** Uncaught errors may hit Next.js root / `global-error.tsx`; Chromium often kills the tab (**Aw, Snap!**) without a React overlay for OOM.

---

### 10. Is `pdf.error` checked?

**`usePDF` state shape** (library):

```296:301:node_modules/@react-pdf/renderer/lib/react-pdf.browser.js
  const [state, setState] = useState({
    url: null,
    blob: null,
    error: null,
    loading: !!document
  });
```

**App usage:** `InvoiceBuilderPdfPanel` only types and uses `loading` and `url`:

```15:18:src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx
  pdf: {
    loading: boolean;
    url: string | null;
  };
```

Grep across `src/features/invoices/components/invoice-builder/` and invoice PDF preview: **no reads of `pdf.error`**. Failures are **silent in the UI** (spinner may stop; iframe unchanged).

---

## Section 5 — Senior recommendation

### 11. Most likely crash mechanisms (60–90 min, 160+ trips)

**1. Main-thread memory + CPU spike on full `@react-pdf` layout when preview runs (especially repeated Aktualisieren or Category A after §4).**  
Each run materializes thousands of layout nodes, a full PDF blob, decoded iframe PDF, and retains `lineItems` + `draftInvoice` + `blob` in `usePDF` state. Several runs in a long session push Chromium tab memory past OOM — looks like a sudden tab crash, not a route change.

**2. Sustained heap growth from editing without PDF: `draftInvoice` rebuild + `JSON.stringify` Category B signature on every line-item mutation × 160 full row graphs.**  
This does not require clicking Aktualisieren; it accumulates over 60–90 minutes of Step 3 work and makes the **next** PDF render more likely to fail.

*(Secondary, already mitigated: trips refetch wiping state — see km-reset audit; not the primary tab-crash mechanism.)*

---

### 12. Single highest-impact change (keep PDF preview)

**Gate full `InvoicePdfDocument` rendering behind an explicit user intent and a row-count guard — do not call `updatePdf` with the full 160-row appendix until the admin requests it, and/or switch preview to a “light” document (cover + totals only) when `includedLineItems.length` exceeds a threshold (e.g. 80), with a button to load the full appendix preview.**

Why this beats smaller tweaks:

- Split-trigger already stops **automatic** PDF on trip edits; crashes at 160+ are dominated by **size of one layout pass**, not debounce ms.
- Blob revocation and `refetchOnWindowFocus: false` do not reduce **per-render** layout cost.
- A light preview removes **~2,500+ appendix layout nodes** from the default path while preserving “does the cover look right?” for large invoices.

**Runner-up (lower impact alone):** Replace `categoryBSignature` `JSON.stringify(full rows)` with a cheap hash (positions + `manualDistanceKm` + gross flags) to stop per-edit megabyte-scale serialization at 160 rows.

---

## Summary table

| Question | Answer |
|----------|--------|
| Aktualisieren chain | `requestPreviewUpdate` → `commitPreviewUpdate` → `updatePdf` → `updateContainer` → layout + `toBlob` → `createObjectURL` (main thread) |
| Auto PDF at 160 on Step 3? | **No** for trip edits (Category B); **yes** for first load + Category A (§4/§5/meta) |
| Blob leak? | Unlikely for URLs (dual revoke); **blob + iframe PDF** dominate memory |
| `BuilderLineItem` size | ~2–10 KB/row; addresses + `price_resolution` + `resolved_rule.config` |
| Copies per Aktualisieren | ~6–10 array/object passes over 160 rows (draft + PDF tree) |
| Snapshot in memory | Yes on `draftInvoice.line_items`; small; builder rows much larger |
| Render loop? | No interval; **yes** heavy `JSON.stringify` on each B edit |
| Preview on Step 3? | Hook + panel active; B edits skip PDF; draft still rebuilds |
| Error boundary? | **No** |
| `pdf.error` UI? | **Not checked** |
| Top crash cause | Full PDF layout + blob at 160 rows, repeated / after long heap churn |
| Best fix | Threshold / light preview + explicit full preview; fix B signature serialization |
