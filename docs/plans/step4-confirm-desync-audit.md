# Audit: Step 4 Confirmation Display Desync + Quote Builder Reuse Scope

**Date:** 2026-06-08  
**Status:** Fix applied — 2026-06-08  
**Scope:** Read-only trace of Step 5 (Bestätigung) position table vs totals; quotes reuse assessment.  
**Verdict (historical):** Totals were correct because `use-invoice-builder.ts` filters before `calculateInvoiceTotals`. The position table and count were wrong because **`index.tsx` passed raw `lineItems` and `lineItems.length`** with no inclusion filter and **no billed cancelled trips**.

**Gaps closed by fix:**
- `lineItemCount` and Section 3 summary count now use `buildConfirmationDisplayRows` — matches totals slice
- Position table shows only billing-included normal rows + priced opted-in cancelled trips
- Billed cancelled trips visible in Step 5 confirmation table
- Section 3 collapsed summary count aligned with filtered subtotal

---

## Executive summary

| Surface | Data source | Filtered? | Matches totals? |
|---------|-------------|-----------|-----------------|
| Netto / MwSt. / Brutto | `totals` from hook | Yes (`billingIncludedLineItems` + opted-in cancelled) | Self-consistent |
| `{lineItemCount} Positionen` label | `lineItems.length` prop | No | **No** — counts opted-out normals |
| Position table rows | `lineItems` prop | No | **No** — shows opted-out normals; omits billed cancelled |
| Submit / persist | Hook `createInvoice` / `updateInvoice` | Persists **all** normal rows + opted-in cancelled via `insertLineItems` | Independent of Step4Confirm display |

This is a **props problem in `index.tsx`**, not a fetch or component-internal filter bug. Fixing display does not require changing submit if the hook continues to own persistence.

---

## Q1 — What does `index.tsx` pass to `Step4Confirm`?

**Call site:** [`index.tsx` L795–845](src/features/invoices/components/invoice-builder/index.tsx)

| Prop | Expression | Filtered? |
|------|------------|-----------|
| `subtotal` | `totals.subtotal` | Yes (via hook totals) |
| `taxAmount` | `totals.taxAmount` | Yes |
| `total` | `totals.total` | Yes |
| `lineItemCount` | **`lineItems.length`** | **No** — raw builder array length |
| `defaultPaymentDays` | `defaultPaymentDays` | N/A |
| `missingPrices` | `missingPrices` | Scoped to included rows in hook (`hasMissingPrices`) |
| `isCreating` | `isSubmitting` (`isCreating \|\| isSaving`) | N/A |
| `submitDisabled` | `isSubmitting \|\| !section4Unlocked` | N/A |
| `hideSubmitButton` | `true` (submit in card footer L776–790) | N/A |
| `onConfirm` | inline → `updateInvoice` or `createInvoice` with `step4Values` + `snapshotOverride` | Does **not** pass `lineItems` |
| `resolvedIntroBlockId` | `resolvedIntroBlockId` | N/A |
| `resolvedOutroBlockId` | `resolvedOutroBlockId` | N/A |
| `defaultRechnungsempfaengerId` | `catalogRecipientId` | N/A |
| `catalogRecipientId` | `catalogRecipientId` | N/A |
| **`lineItems`** | **`lineItems`** (raw from `useInvoiceBuilder`) | **No** |
| `onStep4PdfOverlayChange` | `handleStep4PdfOverlay` | N/A |
| `pdfOverlayEnabled` | `applyStep4PdfOverlay` | N/A |

**Not passed:** `cancelledTrips`, `billedCancelledTripsForPdf`, or any `billingIncludedLineItems(...)` result.

**`billingIncludedLineItems` in `index.tsx`:** Used only inside `useInvoiceBuilderPdfPreview` path indirectly via hook’s `lineItems` → preview hook’s `includedLineItemsForDraft`. **Not applied** before `Step4Confirm`.

**Hook destructuring (L215–257):** `lineItems`, `cancelledTrips`, `totals`, etc. come from `useInvoiceBuilder`. `cancelledTrips` is used in Step 3 and PDF memos (`billedCancelledTripsForPdf` L431–434) but **never** forwarded to `Step4Confirm`.

**Related desync (same root cause):** Section 3 summary (L474–477) uses `` `${lineItems.length} Positionen · ${formatEurDe(totals.subtotal)}` `` — count raw, subtotal filtered.

---

## Q2 — What does `step-4-confirm.tsx` do with `lineItems`?

**Props type:** [`step-4-confirm.tsx` L113–143](src/features/invoices/components/invoice-builder/step-4-confirm.tsx) — `lineItems: BuilderLineItem[]`; no `cancelledTrips`.

**Position table row source:** L331 — `{lineItems.map((item) => { ... })}` — **direct render, no filter.**

**Per row, rendered fields:**

| Column | Source |
|--------|--------|
| `#` | `item.position` (L342–343) |
| Beschreibung | `item.description` (L345–346) |
| Preis | `lineItemNetAmountForDisplay(item)` (L349–351) |
| Tooltip | `item.price_resolution.source`, `item.price_resolution.strategy_used` (L332–338) |

**`lineItemCount`:** L292–294 — displays the **prop verbatim**: `` `{lineItemCount} Positionen · Netto` ``. No internal recount.

**Guard:** Table only mounts when `lineItems.length > 0` (L317) — also uses raw prop length.

**Conclusion:** Component is a pure display shell for whatever `index.tsx` passes. Internal filtering would fix symptoms but duplicate business rules; **derived props in `index.tsx` (or a shared helper) is the correct SSOT alignment.**

---

## Q3 — Does `step-4-confirm.tsx` make any data fetches?

**Inside the component:**

| Hook | Purpose | Lines |
|------|---------|-------|
| `useAllInvoiceTextBlocks()` | Intro/outro block catalog | L167–168 |
| `useRechnungsempfaengerOptions()` | Recipient dropdown + preview overlay | L169–170 |

**Not present:** `useQuery` for invoice detail, `useInvoiceDetail`, `useSuspenseQuery`, Supabase client calls, or trip refetch.

Submit path calls **`onConfirm(values)`** only — parent hook owns persistence.

---

## Q4 — Are totals correct and why?

**Yes.** Totals are computed in [`use-invoice-builder.ts` L903–919](src/features/invoices/hooks/use-invoice-builder.ts):

```typescript
const includedNormal = billingIncludedLineItems(lineItems);
const includedCancelled = cancelledTrips.filter(
  (c) => c.billingInclusion.included && c.price_resolution != null
);
const totals = calculateInvoiceTotals([
  ...includedNormal,
  ...includedCancelled.map((c) => ({ /* TotalsLineShape */ }))
]);
```

**`calculateInvoiceTotals`** lives in [`invoice-line-items.api.ts` L808`](src/features/invoices/api/invoice-line-items.api.ts) (not a separate `calculate-invoice-totals.ts`). Input: `TotalsLineShape[]` with `price_resolution`, `tax_rate`, `quantity`, `approach_fee_net`, `unit_price`, `manualGrossTotal`. Returns `{ subtotal, taxAmount, total, breakdown }`.

**Props path:** Hook returns `totals` (L1117) → `index.tsx` destructures (L220) → `Step4Confirm` L796–798.

**Mismatch:** Footer uses filtered monetary totals but **unfiltered** `lineItemCount` and **unfiltered** table rows.

---

## Q5 — Where do billed cancelled trips go?

**In `index.tsx`:**

| Slice | Definition | Consumer |
|-------|------------|----------|
| `billedCancelledTripsForPdf` | `cancelledTrips.filter(t => t.billingInclusion.included)` L431–434 | `useInvoiceBuilderPdfPreview` only |
| `passiveCancelledTripsForPdf` | opted-out cancelled L436–438 | PDF preview (passive appendix) |
| `cancelledTrips` (raw) | Hook state | Step 3 UI, totals, `insertLineItems` on save |

**`Step4Confirm`:** receives **none** of these.

**To show billed cancelled in confirmation table:**

1. Pass a unified billable display array (normals + opted-in cancelled with pricing), **or**
2. Extend `Step4Confirm` props with `cancelledLineItems` / `confirmationRows` and render a second section.

Cancelled rows lack `description` and `position` in the same shape as `BuilderLineItem` — they use `CancelledTripRow` / `BuilderCancelledTripRow` (`client_name`, `scheduled_at`, `price_resolution` when opted in). Display helpers today: `lineItemNetAmountForDisplay` is **`BuilderLineItem` only**; cancelled gross uses `cancelledTripGrossTotalForDisplay` in [`line-item-net-display.ts` L63`](src/features/invoices/lib/line-item-net-display.ts) — no net helper for cancelled in confirmation context yet.

**Persist path already includes them:** `createMutation` L984–987 filters `optedInCancelled` and passes to `insertLineItems(invoice.id, lineItems, optedInCancelled)`.

---

## Q6 — Type gap: `ConfirmationLineItem`?

**Search result:** No `ConfirmationLineItem`, `ConfirmationDisplayRow`, or similar in [`invoice.types.ts`](src/features/invoices/types/invoice.types.ts) or `src/features/invoices/types/`.

Existing types:

- `BuilderLineItem` (L548+) — normal Step 3 rows
- `BuilderCancelledTripRow` (L420+) — cancelled with `billingInclusion` + pricing
- `ExcludedTripRow` (L458+) — PDF appendix only (no price)
- `InvoiceLineItemRow` — persisted DB shape

**Gap confirmed:** no unified confirmation-display type.

---

## Q7 — Unified billable preview array (minimal shape)

**Goal:** One array for Step 4 position table + count, aligned with totals.

**Billable sources (mirror totals L905–918):**

1. `billingIncludedLineItems(lineItems)` — normal included
2. `cancelledTrips.filter(c => c.billingInclusion.included && c.price_resolution != null)` — opted-in cancelled with pricing

**Fields Step4Confirm actually renders:**

| Field | Normal | Cancelled (needs mapping) |
|-------|--------|-------------------------|
| Row key | `position` | synthetic position or `id` |
| `#` column | `position` | append after max normal position (same as insert) |
| Beschreibung | `description` | build from date + `client_name` (Step 3 pattern) |
| Preis (net display) | `lineItemNetAmountForDisplay(item)` | need net from `price_resolution.net` or new helper |
| Tooltip | `price_resolution.source`, `strategy_used` | same when `price_resolution` present |

**Minimal unified type (proposal for planning only):**

```typescript
interface ConfirmationDisplayRow {
  key: string;
  position: number;
  description: string;
  price_resolution: PriceResolution;
  /** For net column — or pass BuilderLineItem | BuilderCancelledTripRow union */
  netDisplay: number | null;
}
```

Alternatively: **`ConfirmationDisplayRow = BuilderLineItem | BuilderCancelledTripRow`** with a type guard and small adapter for description/net — avoids duplicating price fields if component learns two shapes.

**Count:** `confirmationRows.length` (not `lineItems.length`).

---

## Q8 — Quotes reuse scope

### Does `src/features/quotes/` exist?

**No.** Glob found **0** files under `src/features/quotes/`.

### Does `src/features/invoices/components/quote-builder/` exist?

**No.**

### Does `use-quote-builder.ts` exist?

**No matches** in the repo.

### What exists instead: **Angebote** (`src/features/angebote/`)

| Area | Path |
|------|------|
| Builder shell | `features/angebote/components/angebot-builder/index.tsx` |
| Hook | `features/angebote/hooks/use-angebot-builder.ts` |
| Positions step | `step-2-positionen.tsx` (formula columns, DnD — not trip billing) |
| Details step | `step-3-details.tsx` (subject, dates, rich text) |
| PDF | `AngebotPdfDocument.tsx`, `use-angebot-builder-pdf-preview.tsx` |

**Billing inclusion:** **No references** to `billingInclusion`, `billing_included`, or `billing-inclusion.ts` under `features/angebote/`.

Angebote is a **separate product model** (manual position rows + formula engine + Vorlagen columns), not trip-based billing with opt-out.

### Would a shared “billable confirmation items” helper help quotes?

**For current Angebote:** **Low direct reuse** — no trip inclusion model; positions are user-authored rows, not `BuilderLineItem[]` from trip fetch.

**For a future trip-based quote flow** (if product adds “quote from same trips as invoice”): **High reuse** — same inclusion semantics (which trips are in the offer total vs excluded) would benefit from a domain helper parallel to invoice totals, ideally colocated with billing-inclusion or a thin `confirmation-display.ts` that **imports** `billingIncludedLineItems` rather than extending `billing-inclusion.ts` with display concerns.

### Invoice vs quote confirmation differences (when quoting exists)

| Aspect | Invoice Step 4 | Angebote today |
|--------|----------------|----------------|
| Line source | Trips + inclusion | Manual positionen |
| Tax footer | Netto / MwSt. / Brutto | Formula-driven totals (different engine) |
| Cancelled trips | Opt-in billing slice | N/A |
| Persist | `createInvoice` + `insertLineItems` | `angebote.api` |
| Status | Draft → issued | Offer lifecycle (separate) |

---

## Q9 — Risk surface of the fix

### Files likely to change

| File | Change |
|------|--------|
| **`index.tsx`** | Compute `confirmationLineItems` + `confirmationLineCount`; pass to `Step4Confirm`; optional Section 3 summary fix |
| **`step-4-confirm.tsx`** | Accept new prop(s) or union row type; map cancelled rows for description/net; **or** stay dumb if parent passes pre-mapped `ConfirmationDisplayRow[]` |
| **New helper** (recommended) | e.g. `buildConfirmationDisplayRows.ts` in `src/features/invoices/lib/` |
| **New type** (optional) | `ConfirmationDisplayRow` in `invoice.types.ts` |
| **`line-item-net-display.ts`** | Optional: `confirmationNetForDisplay(row)` if union type |

**Not required for display fix:** `use-invoice-builder.ts` totals logic, `billing-inclusion.ts`, `insertLineItems`, PDF components.

**Tests:** No unit/E2E tests reference `Step4Confirm` or assert current broken count (grep: **0** matches). No snapshot updates expected unless added as part of fix.

### Filter in `index.tsx` vs inside `step-4-confirm.tsx`

| Approach | Pros | Cons |
|----------|------|------|
| Filter in `index.tsx` only | Single prop swap; component stays presentational | Cancelled rows need mapping before pass |
| Filter inside component | Localized UI | Duplicates inclusion rules; violates SSOT |
| **Helper + derived prop in `index.tsx`** | Matches totals/PDF pattern; testable; quote-ready | +1 file |

### Submit independence

**Confirmed independent of display props.**

Submit flow [`index.tsx` L805–836](src/features/invoices/components/invoice-builder/index.tsx):

- `onConfirm(step4Values)` → `createInvoice(step4Values, snapshotOverride)` or `updateInvoice(...)`
- **`step4Values`** = intro/outro blocks, payment days, recipient only (Step 4 form schema L67–77)

Hook [`use-invoice-builder.ts` L974–987](src/features/invoices/hooks/use-invoice-builder.ts):

- `createInvoice({ subtotal: totals.subtotal, ... })` — totals from hook, not from Step4Confirm table
- `insertLineItems(invoice.id, lineItems, optedInCancelled)` — **full** normal `lineItems` array (includes opted-out rows persisted with `billing_included: false` per L971–974 in `lineItemToInsertRow`)

**Fixing confirmation display does not change what is submitted** unless someone mistakenly wires submit to display props (not the case today).

---

## Senior assessment

### 1. Cleanest fix path

**Introduce a derived display array in `index.tsx`**, built by a shared helper, and pass that to `Step4Confirm` instead of raw `lineItems`. Keep `step-4-confirm.tsx` mostly presentational — extend props to accept either:

- `confirmationRows: ConfirmationDisplayRow[]` + `lineItemCount={confirmationRows.length}`, or
- keep prop name `lineItems` but pass the **derived** array (misleading name; prefer rename).

Also fix **Section 3 summary** (L474–477) to use the same count for consistency.

Do **not** filter only inside `step-4-confirm.tsx` — that duplicates `billingIncludedLineItems` rules.

### 2. Helper recommendation

**Name:** `buildConfirmationDisplayRows(lineItems, cancelledTrips)`  
**Location:** **New file** — e.g. [`src/features/invoices/lib/build-confirmation-display-rows.ts`](src/features/invoices/lib/build-confirmation-display-rows.ts)

**Why not `billing-inclusion.ts`:** That module owns **predicates and billable slices** for totals/PDF/persist semantics. Confirmation display adds **labels, synthetic positions, and net formatting** — different concern. Import `billingIncludedLineItems` + mirror `includedCancelled` filter from totals (pricing-ready guard).

**Return:** `ConfirmationDisplayRow[]` sorted by `position`.

**Quotes:** Export types/helpers from a neutral name (`confirmation-display.ts`) if a future trip-based quote builder appears; **do not** force into Angebote’s formula model.

Optional companion: `confirmationDisplayRowCount(rows) => rows.length` — trivial inline.

### 3. Minimal type

**Prefer a new `ConfirmationDisplayRow` interface** (Pick-like from display needs) rather than extending `BuilderLineItem`. Cancelled trips are not line items; forcing them into `BuilderLineItem` creates fake `description`/`trip_id` fields.

If minimizing churn: pass `(BuilderLineItem | BuilderCancelledTripRow)[]` with `isBillingIncludedRow` pre-filtered and teach Step4Confirm a **single map branch** — less clean but fewer new types.

### 4. Submit risk

**None** for display-only fix, traced above. Opted-out rows remain in `insertLineItems` input by design (audit trail on invoice). Display should hide them; persist unchanged.

### 5. One session or own plan?

**Own small plan recommended** (not a one-liner):

- New helper + type + tests (mirror totals filter cases: opted-out hidden, opted-in cancelled shown, count matches)
- `index.tsx` + `step-4-confirm.tsx` prop/table updates
- Section 3 summary alignment
- Optional: net display helper for cancelled rows

Estimate: **half day**, separate from billing-inclusion/PDF work. Worth a dedicated plan because cancelled row mapping and prop rename touch UX copy (“Positionen”) and need tests so count always matches `totals` slice.

---

## Reference: related SSOT modules (unchanged by this audit)

| Module | Role |
|--------|------|
| [`billing-inclusion.ts`](src/features/invoices/lib/billing-inclusion.ts) | `isBillingIncludedRow`, `billingIncludedLineItems`, `mainCoverLineItems` |
| [`preview-dirty-fingerprint.ts`](src/features/invoices/lib/preview-dirty-fingerprint.ts) | PDF preview dirty banner only — separate from confirmation display |
| [`invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts) | `calculateInvoiceTotals`, `insertLineItems` |

---

## Files read

| File | Focus |
|------|-------|
| `index.tsx` | Step4Confirm props, PDF memos, summaries |
| `step-4-confirm.tsx` | Full component |
| `use-invoice-builder.ts` | Totals, create/update mutations |
| `invoice-line-items.api.ts` | `calculateInvoiceTotals`, `insertLineItems` |
| `billing-inclusion.ts` | Three exports (skim) |
| `preview-dirty-fingerprint.ts` | Exists; separate concern (skim) |
| `invoice.types.ts` | Builder types; no Confirmation type |
| `line-item-net-display.ts` | Net/gross display helpers |
| `features/angebote/**` | Quotes analogue — Angebote, no billing inclusion |
