# Audit: PDF Preview “Update” Banner Broken After billing-inclusion Refactor

**Date:** 2026-06-08  
**Scope:** Read-only trace of dirty-detection in the invoice builder PDF preview.  
**Verdict:** Phase 3 (`billingIncludedLineItems` swap) is **semantically identical** to the pre-refactor filter and is **unlikely** to be the root cause. The banner mechanism has **pre-existing structural weaknesses** (numeric Category B hash, first-render gate, pre-filtered hash input) that align better with the reported symptoms than the billing-inclusion helper itself.

**Status: Fix applied — 2026-06-08.** [`buildPreviewDirtyFingerprint`](../src/features/invoices/lib/preview-dirty-fingerprint.ts) replaces inline `buildCategoryBSignature`; Category B hashes **raw** `lineItems` with price fields; first-render guard on `setCategoryBDirty` removed. Root cause: pre-filtered hash input + narrow field coverage — **not** Phase 3 billing-inclusion refactor.

---

## Executive summary

The “Vorschau veraltet / Aktualisieren” banner is driven by `categoryBDirty` in `use-invoice-builder-pdf-preview.tsx`, exposed as `isDirty`. It is set when `buildCategoryBSignature(...)` changes **after** the first PDF blob URL exists (`hasCompletedFirstRenderRef`).

The billing-inclusion refactor (commits `48d1dbb` → `837ca9c`) changed **one line** in the preview hook: `lineItems.filter((li) => li.billingInclusion.included)` → `billingIncludedLineItems(lineItems)`. Git diff confirms no other preview dirty logic changed in Phase 3.

The more plausible regressions are:

1. **Category B hash omits most trip fields** (price, gross, tax, manual overrides) since commit `caaa514` replaced `JSON.stringify` of full rows with a lightweight numeric sum.
2. **Inclusion bit in `hashIncluded` is dead code** because the hash input is already the filtered *included-only* list — opt-out detection relies on moving rows between `includedLineItemsForDraft` and `excludedTrips`, not on the `billingInclusion.included` term inside the hash.
3. **First-render race:** Category B changes that occur before `pdf.url` is set update the signature baseline but **do not** set `categoryBDirty` (guarded at L496–497).

---

## Q1 — How is the dirty / stale signal computed?

**Primary signal:** React state `categoryBDirty` (`useState(false)` at L220), returned as `isDirty: categoryBDirty` (L530).

**Setter paths:**

| Setter | Location | Condition |
|--------|----------|-----------|
| `setCategoryBDirty(true)` | L418 | First `draftInvoice` on **large** invoices (≥ 90 trips), before first render |
| `setCategoryBDirty(true)` | L465 | Category A deps change on **large** invoices only |
| `setCategoryBDirty(true)` | L497 | Category B signature changed **and** `hasCompletedFirstRenderRef.current === true` |
| `setCategoryBDirty(false)` | L400 | `livePreviewActive` becomes false (reset) |
| `setCategoryBDirty(false)` | L507 | `requestPreviewUpdate()` (admin clicks Aktualisieren) |

**Category B detection (trip-data edits)** — L483–504:

```typescript
useEffect(() => {
  const sig = buildCategoryBSignature(
    includedLineItemsForDraft,
    billedCancelledTrips,
    passiveCancelledTrips,
    excludedTrips
  );
  if (prevCategoryBSignatureRef.current === null) {
    prevCategoryBSignatureRef.current = sig;
    return;
  }
  if (prevCategoryBSignatureRef.current === sig) return;
  prevCategoryBSignatureRef.current = sig;
  if (hasCompletedFirstRenderRef.current) {
    setCategoryBDirty(true);
  }
}, [
  includedLineItemsForDraft,
  billedCancelledTrips,
  passiveCancelledTrips,
  excludedTrips
]);
```

**First-render gate** — L390–393:

```typescript
useEffect(() => {
  if (pdf.url) {
    hasCompletedFirstRenderRef.current = true;
  }
}, [pdf.url]);
```

**Below threshold (< 90 trips):** Category A layout changes auto-render via debounced `scheduleCategoryAUpdate` (L428–457) — they **do not** clear `categoryBDirty`. Category B trip edits never auto-render; they only set dirty.

**Not used for dirty:** generation counter (`columnReorderGeneration`) only bypasses debounce for Category A auto-render (L433–438), not for Category B.

---

## Q2 — Was `billingInclusion.included` part of the dirty signal before?

**Yes — and it still is**, at L95 inside `hashIncluded`:

```typescript
(r.billingInclusion.included ? 1 : 0)
```

**Critical nuance:** Category B passes **`includedLineItemsForDraft`** (pre-filtered billable rows) into `buildCategoryBSignature`, not raw `lineItems`. Every row in that array has `billingInclusion.included === true` by construction. The inclusion bit **always contributes `+1`** per row and **never flips to `0`** inside this hash.

**Pre-refactor (Phase 3 parent `202cbc1`):** same structure — filtered list + same hash term (inline `.filter((li) => li.billingInclusion.included)` at L298).

**What actually detects normal-trip opt-out:** row **leaves** `includedLineItemsForDraft` (numeric sum decreases) and **enters** `excludedTrips` (`hashExcluded` increases). The `billingInclusion.included` term inside `hashIncluded` does not participate in that transition.

**Historical note:** Before commit `caaa514`, Category B used `JSON.stringify({ included, billedCancelled, passiveCancelled, excluded })` on full row objects — any field change (price, inclusion, reason) changed the signature. The numeric hash (`caaa514`) deliberately narrowed detection to position, km, and inclusion-related moves.

---

## Q3 — What does the hook receive for `lineItems` after Phase 3?

**Raw, unfiltered `lineItems` state** from the builder hook.

`index.tsx` L441–446:

```typescript
const { pdf, draftInvoice, isDirty, requestPreviewUpdate } =
  useInvoiceBuilderPdfPreview({
    companyId,
    companyProfile,
    step2Values: step2Snapshot,
    lineItems,
```

Filtering happens **inside** the preview hook (L299–301):

```typescript
const includedLineItemsForDraft = useMemo(
  () => billingIncludedLineItems(lineItems),
  [lineItems]
);
```

**Phase 3 did not add** `billingIncludedLineItems()` in `index.tsx` before passing props. The only Phase 3 change in `index.tsx` was a comment on `excludedTripsForPdf` (L413–414).

---

## Q4 — Does the `lineItems` array reference change on inclusion toggle?

**Yes.** `use-invoice-builder.ts` L646–654:

```typescript
const handleLineItemInclusionChange = useCallback(
  (position: number, included: boolean, reason: string) => {
    setLineItems((prev) =>
      prev.map((item) =>
        item.position === position
          ? { ...item, billingInclusion: { included, reason } }
          : item
      )
    );
  },
  []
);
```

Each toggle produces a **new top-level array** and a **new object** for the toggled row. No selector or memo wraps `lineItems` before the preview hook receives it.

Downstream memos in `index.tsx` (`excludedTripsForPdf` L415–426, billed/passive cancelled L431–438) also recompute because they depend on `[lineItems]` or `[cancelledTrips]`.

---

## Q5 — Category B hash — what does it include?

Full expression: `use-invoice-builder-pdf-preview.tsx` L83–119.

```typescript
function buildCategoryBSignature(
  included: BuilderLineItem[],
  billed: BuilderCancelledTripRow[],
  passive: BuilderCancelledTripRow[],
  excluded: ExcludedTripRow[]
): string {
  const hashIncluded = (rows: BuilderLineItem[]) =>
    rows.reduce(
      (acc, r) =>
        acc +
        (r.position ?? 0) * 1000 +
        Math.round((r.effective_distance_km ?? 0) * 100) +
        (r.billingInclusion.included ? 1 : 0),
      0
    );

  const hashCancelled = (rows: BuilderCancelledTripRow[]) =>
    rows.reduce((acc, r) => {
      const idFold = r.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      return (
        acc +
        idFold * 1000 +
        Math.round((r.effective_distance_km ?? 0) * 100) +
        (r.billingInclusion.included ? 1 : 0)
      );
    }, 0);

  const hashExcluded = (rows: ExcludedTripRow[]) =>
    rows.reduce((acc, r) => {
      let reasonFold = 0;
      for (let i = 0; i < r.billing_exclusion_reason.length; i++) {
        reasonFold += r.billing_exclusion_reason.charCodeAt(i);
      }
      return acc + (r.client_name?.length ?? 0) * 1000 + reasonFold;
    }, 0);

  return `${hashIncluded(included)}_${hashCancelled(billed)}_${hashCancelled(passive)}_${hashExcluded(excluded)}`;
}
```

**Per slice:**

| Slice | Input at call site | Fields hashed |
|-------|-------------------|---------------|
| `hashIncluded` | `includedLineItemsForDraft` | `position`, `effective_distance_km`, `billingInclusion.included` (always true here) |
| `hashCancelled` ×2 | `billedCancelledTrips`, `passiveCancelledTrips` | trip `id` char fold, `effective_distance_km`, `billingInclusion.included` |
| `hashExcluded` | `excludedTrips` | `client_name.length`, `billing_exclusion_reason` char sum |

**Not hashed:** unit price, gross, net, tax rate, manual overrides, warnings, addresses, `trip_id`, line count alone, most `BuilderLineItem` fields.

**Phase 3 change:** none to this function. Only the **caller’s first argument** is still the filtered list; Phase 3 swapped how that list is built (helper vs inline filter), not what the hash reads.

---

## Q6 — Dependency arrays — any missing entries?

All `useMemo` / `useEffect` / `useCallback` with dependency arrays in `use-invoice-builder-pdf-preview.tsx`:

| Hook | Lines | Deps | Notes |
|------|-------|------|-------|
| `useEffect` (logo) | L227–249 | `[companyProfile?.logo_path, companyProfile?.logo_url]` | OK |
| `useMemo` companyProfileForDraft | L251–257 | `[companyProfile, pdfLogoUrl]` | OK |
| `useMemo` placeholderInvoiceNumber | L259–263 | `[]` | OK (static) |
| `useMemo` introDefault | L265–268 | `[textBlocks, payerIntroBlockId]` | OK |
| `useMemo` outroDefault | L270–273 | `[textBlocks, payerOutroBlockId]` | OK |
| `useMemo` defaultRecipientRow | L275–278 | `[catalogRecipientId, empfaengerOptions]` | OK |
| `useMemo` includedLineItemsForDraft | L299–302 | `[lineItems]` | OK — `billingIncludedLineItems` is pure |
| `useMemo` draftInvoice | L322–337 | includes `includedLineItemsForDraft`, not raw `lineItems` | Intentional |
| `useCallback` commitPreviewUpdate | L352–373 | `[updatePdf]` | OK (reads ref) |
| `useCallback` scheduleCategoryAUpdate | L375–386 | `[commitPreviewUpdate]` | OK |
| `useEffect` pdf.url / first render | L390–394 | `[pdf.url]` | OK |
| `useEffect` livePreviewActive reset | L398–408 | `[livePreviewActive]` | OK |
| `useEffect` first draft / large invoice | L412–423 | `[draftInvoice, isLargeInvoice, scheduleCategoryAUpdate]` | OK |
| `useEffect` Category A auto-render | L428–457 | layout/meta deps; **excludes** `lineItems`, `includedLineItemsForDraft`, `excludedTrips` | **Intentional** — B edits must not auto-render |
| `useEffect` Category A → dirty (large only) | L462–480 | layout/meta deps | OK |
| `useEffect` Category B signature | L483–504 | `[includedLineItemsForDraft, billedCancelledTrips, passiveCancelledTrips, excludedTrips]` | OK for current design |
| `useCallback` requestPreviewUpdate | L506–516 | `[commitPreviewUpdate]` | OK |
| `useEffect` cleanup timer | L518–524 | `[]` | OK |

**No missing dependency introduced by Phase 3.** `billingIncludedLineItems` is not listed directly because `includedLineItemsForDraft` already depends on `[lineItems]`.

**Structural gap (by design, not a deps bug):** Category B effect depends on the **filtered** memo, not raw `lineItems`. Inclusion toggles on opted-out rows that remain out only change `excludedTrips` (reason text) — that **is** in deps via `excludedTrips` from `index.tsx`.

---

## Q7 — Was the generation counter updated on inclusion change?

**No — and it should not be.**

- Counter: `pdfColumnReorderGeneration` in `index.tsx` L187–188.
- Increment: L757 — `setPdfColumnReorderGeneration((g) => g + 1)` on PDF **column drag-reorder** in Step 4 only.
- Passed to preview hook: L459 `columnReorderGeneration: pdfColumnReorderGeneration`.
- Used in preview: L433–438 to skip debounce on column reorder; L448 in Category A effect deps.

**Phase 3 did not touch** this wiring (only a comment on `excludedTripsForPdf`).

Inclusion toggles flow through Category B signature, not the reorder generation counter.

---

## Q8 — Banner render condition

**UI:** `invoice-builder-pdf-panel.tsx` L150:

```typescript
{isDirty && !pdf.loading ? (
  // "Vorschau veraltet" + Aktualisieren button
) : null}
```

**Prop chain:** hook `isDirty: categoryBDirty` (L530) → `index.tsx` L870 / L898 → panel.

**Earliest setter for trip edits:** Category B `useEffect` L497 `setCategoryBDirty(true)`, guarded by `hasCompletedFirstRenderRef.current`.

**Inclusion toggle path:**

1. `step-3-line-items.tsx` L596–605 (re-include) or opt-out dialog → `onLineItemInclusionChange` (L1613 confirm path).
2. `use-invoice-builder.ts` L648 `setLineItems(...)` — new array.
3. `index.tsx` recomputes `excludedTripsForPdf` (L415–426) and passes raw `lineItems` + derived slices to hook (L446–449).
4. Preview hook recomputes `includedLineItemsForDraft` (L299–301) and runs Category B effect (L483–504).
5. If signature changed **and** first PDF completed → `categoryBDirty = true` → banner eligible when `iframeSrc` set and `!pdf.loading`.

**Phase 3 does not break this chain.** The helper filter is equivalent to the previous inline filter for `BuilderLineItem` rows.

---

## Hypothesis evaluation (from brief)

| Hypothesis | Assessment |
|------------|------------|
| **A** Hash no longer includes `billingInclusion.included` | **Partially false.** Term still present (L95) but **ineffective** on pre-filtered input; detection relies on list membership + `excludedTrips`. Not introduced by Phase 3. |
| **B** Pre-filtered list breaks dirty detection | **Partially true structurally**, but opt-out moves rows between slices — should still change composite signature. Phase 3 did not change filter semantics. |
| **C** Missing useMemo deps | **Not supported** — deps are consistent with current design. |
| **D** Generation counter disconnected | **Not supported** — counter was never wired to inclusion. |

---

## Senior assessment

### Single most likely cause

**Not the Phase 3 `billingIncludedLineItems` rename.** Git shows that commit only swaps an equivalent filter.

The banner issue is most likely a **combination of (1) the narrowed Category B numeric hash** (since `caaa514`) and **(2) the architectural choice to hash the filtered included slice** rather than raw `lineItems`:

- **Price, gross, tax, manual KM, and most Step 3 field edits do not change the signature** — so no banner fires even though `draftInvoice` changes. This matches “changes on the left side” if dispatchers edit amounts, not only inclusion.
- **Inclusion-only edits should still change the signature** via included↔excluded redistribution; if inclusion banner is specifically broken in QA, check the **first-render race** (changes before `pdf.url` set update baseline without setting dirty) or verify QA is on **large invoices** (≥ 90 trips) where Category A/B behavior differs.

If inclusion toggle truly never shows the banner **after** a successful first preview, suspect **numeric hash collision** (same reduced sum for different row sets) — low probability but possible because `hashIncluded` is a plain sum.

### Fix category

| Type | Applies? |
|------|----------|
| Missing dependency | No |
| Disconnected signal | Unlikely from Phase 3 |
| Pre-filtering side effect | **Yes — structural** (inclusion bit dead; cross-list detection fragile) |
| Hash too narrow | **Yes — primary** for non-inclusion field edits |

### Should we add another helper?

A **`buildCategoryBSignatureFromLineItems(lineItems, cancelledTrips, excludedTrips)`** (or hash raw `lineItems` with `isBillingIncludedRow` + price-relevant fields) is preferable to more inclusion helpers. **`billing-inclusion.ts` should stay the SSOT for billable slices**; dirty detection should **not** reuse the draft filter as its fingerprint input.

Recommended signature inputs:

- Raw `lineItems`: per-row `position`, `effective_distance_km`, **`isBillingIncludedRow(item)`**, plus price/tax fields that affect PDF.
- `excludedTrips` / cancelled slices as today, or derive excluded count + reason hash from raw state.
- Optional: `lineItems.length` + excluded count to catch pure membership changes cheaply.

### Pattern going forward

1. **Separate “PDF draft slice” from “dirty fingerprint slice”.** Draft uses `billingIncludedLineItems`; dirty hash uses **raw builder state** (or a dedicated `buildPreviewDirtyFingerprint()`).
2. **Never hash a pre-filtered list with a predicate bit that is always true on that list.**
3. **Document Category A vs B** in the hook header: which edits auto-render (< 90 trips), which set dirty only, which fields the fingerprint covers.
4. **Add a unit test** for `buildCategoryBSignature`: opt-out, re-include, price change, km change — assert signature changes.

### Minimal fix path (fewest files, no regression on other signals)

**One file, targeted:**

`use-invoice-builder-pdf-preview.tsx` — change Category B call from:

```typescript
buildCategoryBSignature(includedLineItemsForDraft, ...)
```

to:

```typescript
buildCategoryBSignature(lineItems, ...)  // raw rows; hash uses isBillingIncludedRow / billingInclusion.included meaningfully
```

Keep `includedLineItemsForDraft` **only** for `buildDraftInvoiceDetailForPdf`. Extend `hashIncluded` to fold in 1–2 price fields if price-only edits must show the banner (restores pre-`caaa514` behaviour without full `JSON.stringify`).

**Optional second line:** remove or relax `hasCompletedFirstRenderRef` guard for Category B so pre-first-render edits set dirty once preview becomes active — fixes the first-render race without touching `index.tsx` or `billing-inclusion.ts`.

**Do not revert** Phase 2 PDF cover fixes or Phase 3 builder dedup; this is independent preview fingerprint work.

---

## Files read

| File | Role |
|------|------|
| `use-invoice-builder-pdf-preview.tsx` | Dirty state, Category A/B effects, signature |
| `index.tsx` | Props into preview hook, excluded/billed/passive memos |
| `billing-inclusion.ts` | Three exports — confirmed pure filter, no dirty logic |
| `use-invoice-builder.ts` | `lineItems` updates on inclusion toggle |
| `step-3-line-items.tsx` | Opt-out checkbox / dialog → `onLineItemInclusionChange` |
| `invoice-builder-pdf-panel.tsx` | Banner render condition |
| Git history `caaa514`, `f90f687`, `986533c` | When hash and threshold behaviour changed |

---

## Related commits (timeline)

| Commit | Effect on banner |
|--------|------------------|
| Pre-`caaa514` | `JSON.stringify` full rows — all field changes detected |
| `caaa514` | Numeric hash — price/gross edits no longer detected |
| `f90f687` | Below 90 trips: Category A auto-render restored; Category B unchanged |
| `986533c` (Phase 3) | `billingIncludedLineItems()` replaces inline filter — **no semantic change** |
