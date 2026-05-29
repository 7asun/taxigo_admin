# Invoice Builder — Features 1, 2 & 3 Audit

Audit date: 2026-05-27. Read-only review of the invoice builder codebase. No code changes.

**Note on requested files:** `step-4-vorlage-2.tsx` does not exist. The live Step 4 Vorlage component is `src/features/invoices/components/invoice-builder/step-4-vorlage.tsx`.

---

## Implementation Status (2026-05-28)

| Feature | Status | Notes |
|---------|--------|-------|
| Feature 1 — Normal trip opt-out with mandatory reason | ✅ Implemented | `billingInclusion` on `BuilderLineItem`; Step 3 checkbox + dialog; `billing_included / billing_exclusion_reason` persisted; `Ausgeschlossene Fahrten` PDF appendix section |
| Feature 1b — Cancelled trip opt-in with billing reason | ✅ Implemented | `BuilderCancelledTripRow` with `billingInclusion`; Step 3 cancelled section; `is_cancelled_trip / cancelled_billing_reason` persisted; `Abgerechnete stornierte Fahrten` PDF billed block |
| Feature 2 — Edit Draft Invoice | ⏸ Deferred | No `updateInvoice` mutation; no builder hydration from existing invoice; see Section B for full gap analysis |
| Feature 3 — Google Maps icon on line item | ✅ Implemented | Map icon beside `#N` position in collapsed row; opens Google Maps Directions in new tab |

**Deferred items (Feature 1 + 1b):**
- PDF appendix column customisation for excluded/cancelled billed sections (fixed columns for now)
- Email PDF re-download of opted-in cancelled / excluded rows (`TODO(issued-cancelled-rows)` — issued invoices always pass empty lists)

---

## Section A — Feature 1: Cancelled Trip Opt-in

### 1. How is a cancelled trip identified on `BuilderLineItem`?

**Cancelled trips are not represented as `BuilderLineItem` rows today.**

`BuilderLineItem` has no `status` field, no cancelled boolean, and no cancelled-specific entry in `warnings`. The `LineItemWarning` union is only: `'missing_price' | 'missing_distance' | 'zero_price' | 'no_invoice_trip'`.

Cancelled trips use a separate type, `CancelledTripRow`, held in parallel state (`cancelledTrips` in `useInvoiceBuilder`). Identification happens upstream on `TripForInvoice`:

```248:249:src/features/invoices/types/invoice.types.ts
  /** Canonical trip lifecycle (`trips.status`); excluded from billing when `cancelled`. */
  status: TripStatus;
```

Billing query constant: `CANCELLED_STATUS = 'cancelled'` in `invoice-line-items.api.ts`. DB column: `trips.status = 'cancelled'`.

---

### 2. Full data flow: where are cancelled trips filtered before Step 3 `lineItems`?

1. **Step 2 submit** → `handleStep2Complete` sets `step2Values` in `use-invoice-builder.ts`.
2. **TanStack Query** (`tripsQuery`) runs when `step2ValuesReadyForTripsFetch(step2Values)` is true.
3. **Parallel fetches** in the query function:
   - `fetchTripsForBuilder(tripsParams)` — billing trips only
   - `fetchCancelledTripsForBuilder(tripsParams)` — display-only cancelled rows
4. **Filter location (billing):** PostgREST query in `fetchTripsForBuilder`:

```318:319:src/features/invoices/api/invoice-line-items.api.ts
    // Defence in depth: billing must never see cancelled rows even if other layers regress.
    .neq('status', CANCELLED_STATUS)
```

5. **Cancelled fetch:** separate query with `.eq('status', CANCELLED_STATUS)` in `fetchCancelledTripsForBuilder`.
6. **Line items:** `buildLineItemsFromTrips(trips, …)` runs only on non-cancelled `trips`; result → `setLineItems(items)`.
7. **Cancelled rows:** `setCancelledTrips(cancelled)` — never merged into `lineItems`.

The filter is **not** in Step 3, not in a selector, and not in `buildLineItemsFromTrips`. It is in the **upstream trip-fetch query** (`fetchTripsForBuilder`), orchestrated by **`use-invoice-builder.ts`**.

`showCancelledTrips` (Step 4 checkbox) does **not** affect which rows appear in Step 3. It only gates PDF rendering via `PdfColumnProfile.show_cancelled_trips`.

---

### 3. Does `price_resolution` run for cancelled trips?

**No.** `resolveTripPrice` (via `buildLineItemsFromTrips` → `resolveTripPricePure`) runs only for rows returned by `fetchTripsForBuilder`, which excludes cancelled trips.

`resolve-pdf-column-profile.ts` does not perform pricing. It only resolves PDF column layout and reads `show_cancelled_trips` from `pdf_column_override`.

`CancelledTripRow` is intentionally incompatible with `TripForInvoice` and has no pricing fields (see comment on `CancelledTripRow` in `invoice.types.ts`).

---

### 4. Are `km` and `grossPrice` inputs blocked for cancelled trips?

**Neither blocked nor enabled — cancelled trips never reach Step 3.**

Step 3 (`step-3-line-items.tsx`) maps over `lineItems` only. Gross and KM inputs are shown per billing line item; there is no conditional `disabled` based on trip status because status is not on `BuilderLineItem`.

KM input visibility depends on `item.manual_km_enabled` (payer flag), not trip status.

---

### 5. What does the PDF appendix render when `show_cancelled_trips = true`?

**Separate data path — not filtered from `lineItems`.**

| Layer | Mechanism |
|-------|-----------|
| State | `cancelledTrips: CancelledTripRow[]` in builder hook |
| Profile gate | `PdfColumnProfile.show_cancelled_trips` from Step 4 checkbox → persisted in `invoices.pdf_column_override.show_cancelled_trips` |
| PDF entry | `InvoicePdfDocument` prop `cancelledTrips?: CancelledTripRow[]` (default `[]`) |
| Gating | `cancelledRowsForPdf = effectiveProfile.show_cancelled_trips && cancelledTrips.length > 0 ? cancelledTrips : []` |
| Render | Dedicated **final** PDF `Page` (not Haupttabelle) with `InvoicePdfAppendix` where `lineItems={[]}` and `cancelledTrips={cancelledRowsForPdf}`, `groupLabel='Stornierte Fahrten'` |

Cancelled section uses a **fixed 5-column grid** inside `invoice-pdf-appendix.tsx` (`renderCancelledSection`): Datum, Fahrgast, Von, Nach, Stornierungsgrund — not `columnProfile.appendix_columns`. All monetary cells are effectively €0 / em-dash via inline `cellValue`; helper `cancelledTripAppendixCell` exists but is **not** wired in the live appendix renderer (tests only).

**Issued-invoice re-download gap:** `InvoiceDetailView` passes `InvoicePdfDocument` without `cancelledTrips`; code comment `TODO(issued-cancelled-rows)` — detail/email PDF always gets `cancelledTrips=[]` even if `pdf_column_override.show_cancelled_trips` is true.

---

### 6. Existing `reason` / `note` field for cancellation billing reason?

| Location | Field | Purpose |
|----------|-------|---------|
| `CancelledTripRow` / `trips` | `canceled_reason_notes: string \| null` | PDF appendix “Stornierungsgrund” only; never billing |
| `BuilderLineItem` | Does not exist | — |
| `InvoiceLineItemRow` | Does not exist | — |
| `price_resolution.note` | string (advisory) | Pricing resolver notes, not cancellation |

For **billing** cancellation reason on an opt-in billable cancelled line: **requires a new field** (e.g. on `BuilderLineItem` + snapshot column on `invoice_line_items`, or reuse/extend trip `canceled_reason_notes` with explicit billing semantics). No dedicated billing-reason column exists today.

---

## Section B — Feature 2: Edit Draft Invoice (Steps 3–5 only)

### 7. `invoices.status` lifecycle

**Column name:** `status` (TEXT, NOT NULL, default `'draft'`).

**Allowed values** (DB CHECK + TypeScript `InvoiceStatus`):

| Value | Meaning |
|-------|---------|
| `draft` | Being prepared |
| `sent` | Sent to payer |
| `paid` | Payment received |
| `cancelled` | Storniert (invoice-level) |
| `corrected` | Original replaced by Stornorechnung (display only) |

Documented transitions: `draft → sent → paid`; `sent → cancelled`; Storno flow sets original to `corrected` via RPC (not a simple `cancelled` step on the original).

Lifecycle timestamps: `sent_at`, `paid_at`, `cancelled_at`.

---

### 8. What is persisted after `createInvoice`?

**Header — `invoices` table** (`createInvoice` in `invoices.api.ts`):

- Identity: `company_id`, `invoice_number`, `status: 'draft'`
- Scope: `payer_id`, `billing_type_id` (per_client only), `billing_variant_id`, `mode`, `client_id`, `period_from`, `period_to`
- Totals: `subtotal`, `tax_amount`, `total`
- Meta: `intro_block_id`, `outro_block_id`, `payment_due_days`, `notes` (null on create)
- Snapshots: `rechnungsempfaenger_id`, `rechnungsempfaenger_snapshot`, `client_reference_fields_snapshot`
- PDF layout: `pdf_column_override` (JSONB — includes `main_columns`, `appendix_columns`, `main_layout`, `show_cancelled_trips`)

**Line items — separate child table `invoice_line_items`** via `insertLineItems()` (not JSON on the header):

| Override / snapshot | Column(s) |
|---------------------|-----------|
| Gross total | `total_price` (computed from resolution + approach) |
| Net unit / quantity | `unit_price`, `quantity` |
| KM (effective / original) | `effective_distance_km`, `original_distance_km`, `distance_km` |
| Approach fee | `approach_fee_net` |
| Full pricing engine output | `price_resolution_snapshot` (JSONB) |
| Strategy metadata | `pricing_strategy_used`, `pricing_source`, `kts_override` |
| Addresses, client, dates | `pickup_address`, `dropoff_address`, `client_name`, `line_date`, `description`, … |
| Trip link | `trip_id` |
| PDF trip meta | `trip_meta_snapshot` (JSONB) |

In-session-only builder fields (`manualGrossTotal`, `isManualOverride`, `originalPriceResolution`, etc.) are **not** persisted as separate columns; they are folded into `total_price`, `unit_price`, and `price_resolution_snapshot` at insert.

**Not persisted:** `cancelledTrips` list (no table column; only `show_cancelled_trips` flag in `pdf_column_override`).

**RLS note:** `invoices` has UPDATE policy; `invoice_line_items` has SELECT + INSERT only — **no UPDATE or DELETE policy** in `20260401180000_invoices_invoice_line_items_rls.sql`.

---

### 9. Is `updateInvoice` implemented?

**Does not exist** as a full invoice/line-item update API.

Existing mutations in `invoices.api.ts`:

| Function | Accepts |
|----------|---------|
| `updateInvoiceStatus(id, status)` | `'sent' \| 'paid' \| 'cancelled'` + lifecycle timestamp |
| `saveInvoiceEmailDraft(id, { email_subject, email_body })` | Email draft text only |

No `updateInvoice`, no `updateLineItems`, no delete-and-replace helper for drafts.

---

### 10. Builder initial state seeding

**Always starts from scratch.**

- Route: `/dashboard/invoices/new` → `InvoiceBuilder` with reference data only (payers, clients, company profile).
- `useInvoiceBuilder(companyId, onCreated)` initializes: `step2Values: null`, `lineItems: []`, `cancelledTrips: []`, `section3Confirmed: false`.
- Trips load only after Step 2 completes (fresh Supabase fetch).
- **No** `invoiceId` prop, query param, or hook branch to load an existing draft.
- **No** mapper from `InvoiceLineItemRow` → `BuilderLineItem`.

On success, `router.push(\`/dashboard/invoices/${newId}\`)`.

---

### 11. Edit button / draft UI on list or detail

**No “Bearbeiten” / edit route exists.**

**Invoice list** (`columns.tsx` actions): Ansehen, PDF-Vorschau, PDF herunterladen — no edit.

**Invoice detail — draft (`status === 'draft'`):**

| UI | Action |
|----|--------|
| `InvoiceActions` | “Als versendet markieren” |
| `InvoiceActions` | “Stornieren” (creates Stornorechnung via RPC) |
| Sidebar | PDF download (digital) |
| Main | Read-only line items table, totals, period, recipient |
| `InvoiceEmailDraft` | Editable email subject/body (draft text on invoice row) |

No path back into the builder for steps 3–5.

---

### 12. Builder routing structure

| Aspect | Current |
|--------|---------|
| UI pattern | **Dedicated full-page route**, not modal/drawer |
| Create URL | `/dashboard/invoices/new` |
| Post-create | `/dashboard/invoices/[id]` |
| Layout | Single scroll form (sections 1–5) + sticky PDF preview column |

**Re-opening for draft edit (not implemented):** natural fit is same builder component on e.g. `/dashboard/invoices/[id]/edit` or `/dashboard/invoices/new?invoiceId=…` with server/hook hydration. **No mechanism exists today.**

Reference pattern in codebase: `/dashboard/angebote/[id]/edit` (Angebot builder edit mode).

---

### 13. Read-only context for locked Steps 1 & 2 during draft edit

Fields available on the persisted **`invoices`** row (+ joins from `getInvoiceDetail`):

| Display need | Source |
|--------------|--------|
| Billing mode | `mode` → Monatlich / Einzelfahrt / Fahrgast |
| Payer name | `payer.name` (join) or `rechnungsempfaenger_snapshot` |
| Date range | `period_from`, `period_to` |
| Fahrgast (per_client) | `client` join + `client_id` |
| Abrechnungsfamilie scope | `billing_type_id` (per_client header); monthly multi-type scope is **not** persisted (was `billing_type_ids` in builder only) |
| Unterart scope | `billing_variant_id` (single variant header); monthly `billing_variant_ids` subset **not** persisted |
| Trip / position count | `line_items.length` |
| Invoice number | `invoice_number` |
| Recipient | `rechnungsempfaenger_snapshot` |
| Existing totals (reference) | `subtotal`, `tax_amount`, `total` |

**Gap:** Step 2 multi-select filters (`billing_type_ids`, `billing_variant_ids`) used for trip fetch are **fetch-only** and not stored on the invoice row — read-only summary for monthly subset invoices may be incomplete unless inferred from line items’ `billing_type_name` / `billing_variant_code`.

---

## Section C — Feature 3: Google Maps Icon on Line Item

### 14. Pickup/dropoff field names on `BuilderLineItem`

**Correct names:** `pickup_address` and `dropoff_address` (snake_case) — **not** `pickupaddress` / `dropoffaddress`.

Types: `string | null` on both `BuilderLineItem` and `InvoiceLineItemRow`.

Step 3 rendering:

```697:701:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                            <span className='truncate'>
                              {item.pickup_address ?? '—'}
                            </span>
                            <span className='truncate'>
                              {item.dropoff_address ?? '—'}
```

**Normalisation:** Builder snapshots plain strings from `trips.pickup_address` / `trips.dropoff_address` at build time. No lat/lng on `BuilderLineItem`. Underlying `trips` rows may have `pickup_lat`, `pickup_lng`, structured street fields, and geocoding elsewhere in the app — **not** carried into the invoice builder line item.

---

### 15. GDPR / policy concerns — Google Maps directions URL

Client-side navigation to `https://www.google.com/maps/dir/?api=1&origin=…&destination=…` (no API key):

| Topic | Consideration |
|-------|----------------|
| Data disclosure | Full pickup/dropoff strings (often patient names embedded in facility names, home addresses) are sent to **Google** when the user opens the link — third-party processing outside the TaxiGo stack. |
| Legal basis | Krankentransport addresses are **personal data** (often special-category context in practice). Product/privacy review should confirm lawful basis and whether staff use of Google Maps for routing is covered in AV/DPA and privacy notice. |
| Google terms | Maps URLs fall under Google’s consumer/Maps terms; no enterprise DPA from this integration alone. |
| vs in-app API | Unlike server-side Geocoding/Directions (already used with `GOOGLE_MAPS_API_KEY`), this is **user-initiated** browser navigation — lower engineering risk, similar GDPR “transfer to US provider” discussion. |
| Alternatives | OpenStreetMap links, copy-address-only, or in-app map using existing internal geodata without sending raw strings to Google. |
| Logging | No server log of the URL if implemented as `window.open` / `<a target="_blank">`; risk is at the client → Google boundary. |

**Recommendation for team:** Document in internal data-processing notes that dispatchers may export patient trip addresses to Google via optional Maps link; align with existing Google Maps usage policy for the product.

---

## Section D — Cross-cutting

### 16. `bun run build`

**Result: success (exit 0).** Next.js 16.0.10 compiled and TypeScript passed.

**Warnings (pre-existing, not in audited invoice files):** repeated `[baseline-browser-mapping] The data in this module is over two months old` during build — dependency advisory, not a TS error.

**TypeScript errors in audited files:** none observed at build time.

---

### 17. Shared touchpoints — parallel development merge conflict risk

| Asset | Feature 1 | Feature 2 | Feature 3 | Conflict risk |
|-------|-----------|-----------|-----------|---------------|
| `step-3-line-items.tsx` | ✓ (cancelled rows in list) | ✓ (edit mode UX) | ✓ (Maps button) | **High** |
| `use-invoice-builder.ts` | ✓ | ✓ (hydrate + update path) | — | **High** |
| `invoice-builder/index.tsx` | ✓ (cancelled + PDF) | ✓ (route/edit shell) | — | **Medium** |
| `invoice.types.ts` (`BuilderLineItem`) | ✓ | ✓ | — | **Medium** |
| `invoice-line-items.api.ts` | ✓ | ✓ (update/upsert) | — | **Medium** |
| `invoices.api.ts` | — | ✓ | — | Low–medium |
| `InvoicePdfDocument.tsx` / `invoice-pdf-appendix.tsx` | ✓ | ✓ (re-fetch cancelled) | — | Medium |
| `step-4-vorlage.tsx` | ✓ (existing checkbox) | ✓ (rehydrate override) | — | Low |
| `line-item-net-display.ts` | — | — | — | Low |
| `resolve-pdf-column-profile.ts` | — | — | — | Low |
| `invoice-validators.ts` | ✓ (new warnings) | — | — | Low |

Feature 3 is the most isolated (primarily `step-3-line-items.tsx`).

---

### 18. Highest-risk change and de-risk recommendation

**Highest risk: Feature 2 — Edit draft invoice (Steps 3–5).**

Reasons:

1. **Architectural contradiction:** Code and migrations treat line items as **immutable snapshots** after insert (`§14 UStG` comments; no UPDATE RLS on `invoice_line_items`).
2. **Missing API surface:** No `updateInvoice`, no line-item replace/update, no `BuilderLineItem` ← `InvoiceLineItemRow` hydration.
3. **Scope persistence gaps:** Step 2 multi-filters not on invoice row — re-fetch vs stored line items can diverge.
4. **Side effects on save:** Create flow **writebacks** to `trips` (gross, km, approach) fire-and-forget; edit mode must define idempotent rules to avoid double-write or stale trip state.
5. **Cancelled trips:** `show_cancelled_trips` persisted but cancelled rows are not — draft re-edit/PDF preview needs a refetch strategy.

**De-risk plan:**

1. **Spike first:** `InvoiceLineItemRow` → `BuilderLineItem` mapper + load draft into builder behind `/invoices/[id]/edit` (read-only steps 1–2) before any UPDATE API.
2. **Explicit draft mutation contract:** `updateDraftInvoice(invoiceId, headerPatch, lineItems[])` with **delete-all + re-insert** line items (or add RLS UPDATE/DELETE policies) — document that this applies **only** while `status = 'draft'`.
3. **Serialize Feature 2 before Feature 1** if both touch `use-invoice-builder` and Step 3 list composition; or split Step 3 into subcomponents per row type to reduce merge conflicts.
4. **Feature 1 separately:** Keep cancelled billing rows out of totals until pricing rules are defined; add integration test for `fetchTripsForBuilder` + opt-in inclusion path.
5. **Feature 3 last:** Maps link is additive in Step 3 collapsible — ship after Step 3 structure stabilizes from F1/F2.

---

## File index (audited)

| # | Path | Status |
|---|------|--------|
| 1 | `src/features/invoices/types/invoice.types.ts` | Read |
| 2 | `src/features/invoices/types/pdf-vorlage.types.ts` | Read |
| 3 | `src/features/invoices/lib/resolve-pdf-column-profile.ts` | Read |
| 4 | `src/features/invoices/lib/pdf-column-catalog.ts` | Read |
| 5 | `src/features/invoices/lib/line-item-net-display.ts` | Read |
| 6 | `src/features/invoices/lib/invoice-validators.ts` | Read |
| 7 | `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` | Read |
| 8 | `src/features/invoices/components/invoice-builder/step-4-vorlage.tsx` | Read (substitute for missing `step-4-vorlage-2.tsx`) |
| 9 | `src/features/invoices/components/invoice-builder/index.tsx` | Read |
| 10 | `src/features/invoices/hooks/use-invoice-builder.ts` | Read |
| 11 | `src/features/invoices/api/pdf-vorlagen.api.ts` | Read (partial) |
| 12 | `src/features/invoices/api/invoices.api.ts` | Read |
| 13 | `supabase/migrations/20260331120000_create_invoices.sql`, `20260331130000_create_invoice_line_items.sql`, related migrations | Read |
| 14 | `src/features/invoices/components/invoice-detail/index.tsx`, `invoice-list-table/columns.tsx` | Read |
