# Audit — PDF auto-render gate (step / panel awareness)

**Scope:** Whether and how to stop automatic Category A PDF renders while the admin is on form steps (especially Step 3), and what signal to use for “PDF panel visible.” Read-only; no code changes.

**Prior art:** [`docs/plans/large-invoice-crash-audit.md`](large-invoice-crash-audit.md) (crash mechanisms, Category A/B split, always-on preview on Step 3).

**Files read:**

| File | Role |
|------|------|
| `use-invoice-builder-pdf-preview.tsx` | `livePreviewActive`, Category A/B effects |
| `invoice-builder-pdf-panel.tsx` | iframe display only |
| `index.tsx` | Layout, `sectionOpen`, mobile sheet |
| `use-invoice-builder.ts` (L1–200) | `step2Values`, `lineItems` — no step index |
| `large-invoice-crash-audit.md` | Performance / trigger findings |

---

## Section 1 — How `livePreviewActive` and step visibility work today

### 1. Exact derivation of `livePreviewActive`

```243:244:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  const livePreviewActive =
    lineItems.length > 0 && !!step2Values && !!companyProfile;
```

**Meaning:** Preview *data* mode is on when there is at least one line item, Step 2 snapshot exists, and company profile is present.

**Not included:**

- Which builder section (1–5) is open (`sectionOpen`)
- Whether the desktop PDF column or mobile sheet is visible
- `document.visibilityState` / tab focus
- `section3Confirmed`, `section4Unlocked`, or `pdfStepAcknowledged`

`livePreviewActive` gates `draftInvoice` construction (`useMemo` returns `null` when false) and several effects (Category A auto-render after first paint, reset when inactive). It does **not** mean “admin is looking at the PDF.”

---

### 2. How the PDF panel is shown or hidden (desktop vs mobile)

**Desktop (`lg+`):** Always **mounted** in the DOM; hidden only below the `lg` breakpoint via Tailwind `hidden` + `lg:flex` (not `display: none` on a conditionally omitted subtree — the column is omitted from layout on small viewports but the hook still runs).

```835:846:src/features/invoices/components/invoice-builder/index.tsx
      {/* Right: PDF preview column — fills all remaining width */}
      <div className='hidden h-full min-w-0 flex-1 flex-col overflow-hidden lg:flex'>
        <InvoiceBuilderPdfPanel
          lineItemCount={lineItems.length}
          isLoadingTrips={isLoadingTrips}
          section2Complete={section2Complete}
          draftInvoice={draftInvoice}
          pdf={pdf}
          isDirty={isDirty}
          onRequestPreviewUpdate={requestPreviewUpdate}
        />
      </div>
```

**Mobile:** Panel is **not** in the main flex row. A separate instance mounts **inside** a Radix `Sheet` when the user opens it:

```821:864:src/features/invoices/components/invoice-builder/index.tsx
          {isMobile ? (
            <div className='flex justify-end pt-2 lg:hidden'>
              <Button
                type='button'
                variant='default'
                size='sm'
                onClick={() => setPreviewSheetOpen(true)}
              >
                Vorschau anzeigen
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      ...
      <Sheet open={previewSheetOpen} onOpenChange={setPreviewSheetOpen}>
        <SheetContent side='bottom' className='h-[88vh] overflow-hidden'>
          <SheetHeader>
            <SheetTitle>PDF-Vorschau</SheetTitle>
          </SheetHeader>
          <div className='mt-4 h-[calc(88vh-5rem)] overflow-auto'>
            <InvoiceBuilderPdfPanel
              lineItemCount={lineItems.length}
              isLoadingTrips={isLoadingTrips}
              section2Complete={section2Complete}
              draftInvoice={draftInvoice}
              pdf={pdf}
              isDirty={isDirty}
              onRequestPreviewUpdate={requestPreviewUpdate}
            />
          </div>
        </SheetContent>
      </Sheet>
```

| Surface | Mounted when | Visible when |
|---------|----------------|--------------|
| Desktop column | Always (after builder load) | Viewport `≥ lg` |
| Mobile sheet panel | Only while `Sheet` content is mounted (typically when `previewSheetOpen === true`) | User opened sheet |

**Note:** Radix `Sheet` often keeps content mounted when closed (animation / portal); verify at implementation time whether closed sheet unmounts `InvoiceBuilderPdfPanel`. Even if it unmounts, **`useInvoiceBuilderPdfPreview` always runs** in `InvoiceBuilder` — PDF logic is not tied to panel mount.

---

### 3. Existing “viewing PDF vs form” signal?

**No dedicated signal exists.**

Related state that is **not** equivalent:

| State | What it tracks |
|-------|----------------|
| `previewSheetOpen` | Mobile sheet open/closed only — **not** passed to preview hook |
| `sectionOpen: Record<SectionNum, boolean>` | Which **left-column** accordion sections are expanded — not PDF visibility |
| `livePreviewActive` | Data ready for draft — not UI visibility |

There is **no** `isPdfPanelVisible`, `activePanel`, or React context for preview visibility.

---

### 4. Current “active step” in the builder

**There is no `currentStep` or `activeStep`.**

Navigation uses:

```163:169:src/features/invoices/components/invoice-builder/index.tsx
  const [sectionOpen, setSectionOpen] = useState<Record<SectionNum, boolean>>({
    1: true,
    2: false,
    3: false,
    4: false,
    5: false
  });
```

```95:95:src/features/invoices/components/invoice-builder/index.tsx
type SectionNum = 1 | 2 | 3 | 4 | 5;
```

- **Type:** `SectionNum` = `1 | 2 | 3 | 4 | 5`
- **Semantics:** Multiple sections can be open at once (`Record<SectionNum, boolean>`). This is **not** a single active step index.
- **Source:** Local `useState` in `index.tsx` only; `useInvoiceBuilder` does not export step/section state.

Completion/unlock flags (derived, not “you are here”):

- `section1Complete`, `section2Complete`, `section3Complete`, `section4Unlocked`, `section5Unlocked`, `pdfStepAcknowledged`

Auto-scroll effects open the *next* section when a gate completes (e.g. Step 2 done → open 3), but they do not maintain a canonical `currentStep`.

---

## Section 2 — Category A auto-render triggers in detail

### 5. Category A effect — every dependency and Step 3 KM editing

**Effect (post–first-`pdf.url`):**

```398:425:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  useEffect(() => {
    if (!livePreviewActive) return;
    if (!hasCompletedFirstRenderRef.current) return;
    // ... reorder branch ...
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

| Dependency | Can change on Step 3 while editing KM only (no PDF UI)? |
|------------|------------------------------------------------------|
| `livePreviewActive` | **No** — stable once trips loaded + step2 + profile |
| `introText` | **No** — `applyStep4PdfOverlay` requires §5 open (`sectionOpen[5]` + ack) |
| `outroText` | **No** — same |
| `columnProfile` | **No** — only if admin opens §4 PDF-Vorlage |
| `columnReorderGeneration` | **No** — only §4 column drag |
| `companyProfileForDraft` | **Rare** — async logo signed URL (`pdfLogoUrl`) may flip `companyProfileForDraft` once |
| `step2Values` | **No** — fixed after Step 2 submit in normal flow |
| `paymentDueDays` | **No** — §5 overlay only |
| `recipientRow` | **No** — §5 overlay or static default |
| `payers` | **No** — server props |
| `clients` | **No** — server props |
| `companyId` | **No** — prop |
| `scheduleCategoryAUpdate` | **No** — stable `useCallback` |

**Conclusion for pure Step 3 KM/price work:** Category A auto-render **does not** re-fire from these deps. Trip edits are Category B (`isDirty` only).

**Separate effect — initial render (not Category A deps list):**

```387:394:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  useEffect(() => {
    if (!draftInvoice) return;
    if (hasCompletedFirstRenderRef.current) return;
    if (initialRenderScheduledRef.current) return;
    initialRenderScheduledRef.current = true;
    scheduleCategoryAUpdate(PREVIEW_CATEGORY_A_DEBOUNCE_MS);
  }, [draftInvoice, scheduleCategoryAUpdate]);
```

This **does** run when `draftInvoice` first becomes non-null (trips land on Step 3) — **one** debounced full PDF even if admin never looks at the right column.

---

### 6. `paymentQrDataUrl` effect

**Exact deps:** `[draftInvoice]` only.

```303:320:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  useEffect(() => {
    if (!draftInvoice) {
      setPaymentQrDataUrl(null);
      return;
    }
    let cancelled = false;
    import(
      '@/features/invoices/components/invoice-pdf/generate-payment-qr-data-url'
    ).then(({ generatePaymentQrDataUrl }) => {
      void generatePaymentQrDataUrl(draftInvoice).then((url) => {
        if (!cancelled) setPaymentQrDataUrl(url);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [draftInvoice]);
```

| Question | Answer |
|----------|--------|
| Re-run when `lineItems` change? | **Indirectly** — `lineItems` → `includedLineItemsForDraft` → `draftInvoice` `useMemo` → new `draftInvoice` reference |
| Re-run when `draftInvoice` changes? | **Yes** — any rebuild (trip edit, layout field, totals) |
| Cost | **Async:** dynamic `import()` + `QRCode.toDataURL` (240×240 PNG data URL). Not canvas-on-main-thread heavy vs PDF; typically tens of ms |
| Triggers Category A PDF? | **No** — `paymentQrDataUrl` is **not** in Category A effect deps. Value is read from `previewPayloadRef` at `commitPreviewUpdate` time, so the **next** manual or Category A render picks up the latest QR without QR alone scheduling PDF |

---

### 7. Initial render effect — can it fire more than once?

**Guards:**

- `initialRenderScheduledRef` — set `true` when first scheduled; blocks re-schedule from this effect
- `hasCompletedFirstRenderRef` — set when `pdf.url` exists; blocks Category A effect until first success

**Reset when `livePreviewActive` becomes false:**

```375:385:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  useEffect(() => {
    if (livePreviewActive) return;
    setCategoryBDirty(false);
    hasCompletedFirstRenderRef.current = false;
    initialRenderScheduledRef.current = false;
    prevCategoryBSignatureRef.current = null;
    // ... clear debounce timer ...
  }, [livePreviewActive]);
```

| Scenario | Re-fires initial auto PDF? |
|----------|----------------------------|
| Step 2 → Step 3, trips load, `draftInvoice` null → object | **Once** per “active” period — normal path |
| `draftInvoice` flickers null briefly mid-session | **Unlikely** — `livePreviewActive` stays true; `draftInvoice` only null if `livePreviewActive` false or missing profile/step2 |
| Payer change clears trips (`lineItems` → []) | `livePreviewActive` false → refs reset → trips reload → **yes, again** (intended) |
| Create mode: Step 2 incomplete clears `lineItems` | Same reset path if `step2Values` invalidated |

**Step 2 → Step 3 transition:** `step2Snapshot` becomes non-null; trips fetch populates `lineItems`; `draftInvoice` goes null → built. Initial effect runs **once** when `draftInvoice` first truthy — typically right when admin enters Step 3 with loaded trips, **even if focus is on the left column**.

---

## Section 3 — What a step-awareness gate would touch

### 8. Minimal changes to suppress Category A when PDF panel hidden

**Recommended signal (simplest):** `pdfPreviewVisible: boolean` from `index.tsx`:

- Desktop: `const pdfPreviewVisible = !isMobile` (column always “available” on `lg+`) **or** always `true` on desktop if the design goal is only skip auto-render on mobile until sheet opens
- Mobile: `pdfPreviewVisible = previewSheetOpen`

If the product intent is “no auto PDF while admin stares at Step 3 **on desktop too**,” use:

`pdfPreviewVisible = isMobile ? previewSheetOpen : userToggledPreview` **or** derive from “not only Step 3 open” — see Section 4 for cleaner unified flag.

| File | Changes |
|------|---------|
| **`index.tsx`** | Compute `pdfPreviewVisible`; pass to `useInvoiceBuilderPdfPreview({ pdfPreviewVisible, ... })`; on mobile `onOpenChange` when sheet opens `true`, call hook’s `requestPreviewOnPanelOpen()` (or set visible + let effect run) |
| **`use-invoice-builder-pdf-preview.tsx`** | Add param `pdfPreviewVisible`; gate `scheduleCategoryAUpdate` in **initial** and **Category A** effects with `if (!pdfPreviewVisible) return`; add `useEffect` on `pdfPreviewVisible` false→true → `requestPreviewUpdate()` or `scheduleCategoryAUpdate(0)` once; optionally gate `commitPreviewUpdate` only for auto paths, not manual `requestPreviewUpdate` |
| **`invoice-builder-pdf-panel.tsx`** | **Optional** — no change required for gating auto-render. Optional UX: pass `pdfPreviewVisible` only if panel needs “waiting for open” copy |
| **`use-invoice-builder.ts`** | **None** |

**Hook exports (optional):**

- Existing `requestPreviewUpdate` stays for Category B + manual refresh
- Optional `onPreviewPanelOpened` internal effect — no new export if parent sets `pdfPreviewVisible` and effect handles it

**Effects to change inside hook:**

1. **Initial render** (`draftInvoice` effect) — require `pdfPreviewVisible`
2. **Category A** effect — require `pdfPreviewVisible`
3. **New:** `pdfPreviewVisible` false → true — one `commitPreviewUpdate` (or debounced) with latest `previewPayloadRef`
4. **Do not gate:** Category B dirty effect; `requestPreviewUpdate` (Aktualisieren); `livePreviewActive` reset effect

**Do not gate:** `draftInvoice` `useMemo` (cheapish vs PDF; needed for dirty banner totals) unless optimizing further — separate from auto-render gate.

---

### 9. Risk: slow first open after suppressed Category A

**Yes — by design the first visible open may do one full layout pass with all pending state.**

For **160 trips**, from [`large-invoice-crash-audit.md`](large-invoice-crash-audit.md):

- ~2,700–3,500 layout nodes + `toBlob()` on main thread
- **Typical perceived delay:** ~3–15+ seconds depending on device (M1 laptop often 4–8 s; weaker hardware worse)
- Not “600 ms × N changes” stacked — **one** render with latest `draftInvoice` (includes all Step 3 KM edits already in memory)

**Mitigations (out of scope for minimal gate, but related):**

- Show panel spinner (`pdf.loading`) immediately on open
- Do **not** queue multiple Category A timers while hidden — coalesce to single open render
- Light-preview threshold is a separate optimization (explicitly excluded from this gate’s requirements)

---

## Section 4 — Senior recommendation

### 10. Cleanest implementation plan (panel visibility gate)

**Simpler than tracking “current step”:** Use one boolean **`autoRenderPdf`** = “admin can see the PDF preview surface.”

**Derivation in `index.tsx`:**

```typescript
const pdfPreviewVisible =
  !isMobile || previewSheetOpen;
```

- **Desktop (`lg+`):** Preview column is always on screen → auto-render allowed (matches today’s desktop UX for §4 column edits showing live preview).
- **Mobile:** Auto-render only when sheet is open.

If product also wants **no auto-render on desktop during Step 3-only work**, extend:

```typescript
const pdfPreviewVisible =
  (!isMobile || previewSheetOpen) &&
  !(sectionOpen[3] && !sectionOpen[4] && !sectionOpen[5]);
```

That is brittle (multiple sections open). Prefer explicit **`allowAutoPdfRender`** default `true` on desktop, `false` on mobile until sheet open — **or** a “Pause live preview” toggle later.

**Recommended default for crash fix aligned with user ask (“not viewing PDF panel”):**

Use **`pdfPreviewVisible = !isMobile || previewSheetOpen`** plus:

> On desktop, the PDF column is always visible — so Category A still runs on first trip load unless you **also** defer first render until first paint of panel OR add `deferAutoRenderUntilInteraction` ref set when user clicks into preview column once.

For **desktop Step 3 crash** (admin never looks right, but first-load PDF still runs), add:

**`hasUserEngagedPreviewRef`** — set `true` on first `mouseenter`/`focusin` on PDF column **or** first mobile sheet open. Gate **initial** + Category A auto on `pdfPreviewVisible && hasUserEngagedPreview`.

**Concrete plan (smallest surface, meets requirements):**

| # | File | Change |
|---|------|--------|
| 1 | `use-invoice-builder-pdf-preview.tsx` | Add `pdfPreviewVisible: boolean` (default `true` for backward compat in tests). Helper `maybeScheduleCategoryA(delay)` checks `pdfPreviewVisible`. Initial + Category A effects call it. New effect: `[pdfPreviewVisible]` when transitions to `true` and `draftInvoice` and (`isDirty` or never rendered) → `requestPreviewUpdate()` once. |
| 2 | `index.tsx` | `const pdfPreviewVisible = !isMobile \|\| previewSheetOpen`; pass to hook. |
| 3 | `invoice-builder-pdf-panel.tsx` | No change required. |

**Preserve Category B:** `requestPreviewUpdate` unchanged — always calls `commitPreviewUpdate()`; clears `isDirty`. Works when panel visible or hidden (admin can refresh from mobile sheet after edits).

**Preserve manual Aktualisieren:** Same function.

**No trip-count threshold.**

**Hook return value:** Unchanged (`pdf`, `draftInvoice`, `livePreviewActive`, `isDirty`, `requestPreviewUpdate`).

**Optional desktop enhancement (one line in index):** Wrap PDF column with `onMouseEnter={() => setPreviewEngaged(true)}` and pass `previewEngaged` so first auto PDF waits until admin moves mouse to preview — stops hidden first-load crash on Step 3 while keeping §4 live column preview after engagement.

---

### 11. Risks and edge cases

| Risk | Mitigation |
|------|------------|
| **Desktop: panel always visible → gate ineffective for Step 3 crash** | Add `previewEngaged` (mouseenter/focus) or defer initial render until §4 unlocked — product choice |
| **Mobile: sheet closed, `isDirty` true, user opens sheet** | `pdfPreviewVisible` true effect should call `requestPreviewUpdate` if `isDirty` or no `iframeSrc` — show spinner, not stale blank |
| **Open panel → 160-trip render blocks UI** | Expected; show `pdf.loading` overlay (already in panel) |
| **QR async completes after open render** | First PDF might lack QR; second manual refresh or optional tiny effect: when `paymentQrDataUrl` arrives and panel visible and no pending load — one optional re-render (today QR doesn’t auto-trigger; document if intentional) |
| **`livePreviewActive` false resets refs** | Payer/trip reset still clears preview state — OK |
| **Two `InvoiceBuilderPdfPanel` instances (mobile)** | Same `pdf` state — OK; both show same blob |
| **Category A suppressed, admin changes §4 columns on desktop** | Column changes won’t live-preview until engagement/open effect — acceptable if `previewEngaged` used; else desktop still auto-updates |
| **`commitPreviewUpdate` with stale QR** | `previewPayloadRef` updated every render — open-panel render uses latest ref at call time; await QR only if QR must be on first paint |
| **Radix Sheet keeps children mounted when closed** | Mobile may still mount panel when closed — `pdfPreviewVisible` must track `previewSheetOpen`, not mount |
| **Edit mode hydration** | Initial effect runs when `draftInvoice` appears — same gate applies |
| **Double render on open** | Clear `categoryADebounceTimerRef` when scheduling open render; use single `requestPreviewUpdate` |

---

## Summary

| Question | Answer |
|----------|--------|
| `livePreviewActive` | `lineItems.length > 0 && !!step2Values && !!companyProfile` — no step/panel awareness |
| PDF panel mount | Desktop: always mounted, `hidden lg:flex`. Mobile: inside `Sheet`, gated by `previewSheetOpen` |
| PDF vs form signal | **Does not exist** |
| `currentStep` | **Does not exist** — `sectionOpen: Record<1\|2\|3\|4\|5, boolean>` |
| Category A on Step 3 KM only | **Deps do not change** — but **initial** effect still runs when trips load |
| QR effect | `[draftInvoice]`; async; does **not** trigger Category A |
| Initial effect twice? | Only if `livePreviewActive` resets (e.g. empty `lineItems`) |
| Minimal gate | `pdfPreviewVisible` param + gate 2 effects + open-transition effect; `index.tsx` wires mobile sheet |
| Slow first open | **Yes** — one full 160-trip PDF, ~3–15+ s typical |
| Best plan | `pdfPreviewVisible = !isMobile \|\| previewSheetOpen` + optional `previewEngaged` on desktop for first-load; preserve `requestPreviewUpdate` |

**Simpler than step-index tracking:** Panel visibility boolean + one “became visible” effect beats inferring `currentStep` from `sectionOpen` (multi-open accordions, no single active step).
