# Invoicing Module & Builder Architecture

> See [access-control.md](access-control.md) for the full role-based access control architecture.


This document outlines the technical architecture, business logic, and UI flows of the Taxigo **Invoicing Module** (`src/features/invoices`). 

The system is designed with a strict emphasis on **legal compliance (Immutability per §14 UStG)**, **efficiency (Bulk processing)**, and **error prevention (Inline warnings & price editors)**.

---

## 1. Core Architectural Principles

### 1.1 Snapshot Pattern (Immutability)
Invoicing in Germany requires that once an invoice is issued, it **cannot be altered**.
To enforce this, the architecture heavily relies on the **Snapshot Pattern**:
- When an invoice is created, all underlying trip data (descriptions, distances, prices, passenger names, addresses, and tax rates) is **copied** into the `invoice_line_items` table.
- **Distance snapshots (manual KM):** `distance_km` on each line remains the **routing** snapshot (`trips.driving_distance_km`) for Step 3 display and audit; it is not overwritten when billing km differs. **`effective_distance_km`** is the km used for pricing, VAT, and **PDF distance column / `total_km` summaries** (manual trip km → client catalog override with variant/payer/global precedence → routing). **`original_distance_km`** duplicates the routing snapshot for audit. Storno line items copy both distance fields unchanged (non-monetary snapshots). See [manual-km-overrides.md](manual-km-overrides.md).
- The `invoice_line_items` table does **not** rely on foreign key JOINs to the `trips` or `clients` tables to render the PDF. 
- If a dispatcher later corrects a misspelling on a passenger's name in the `trips` table, the already-issued invoice remains mathematically and historically frozen.

### 1.2 The Storno Flow (Cancellations)
Because invoices are immutable, any mistake requires a formal cancellation (**Stornorechnung**).
- When a user confirms "Stornieren", the app calls [`createStornorechnung`](../src/features/invoices/lib/storno.ts), which invokes the Postgres function **`public.create_storno_invoice`** in a **single transaction**:
  1. Inserts a new Storno invoice row (`status = 'draft'`, new `RE-YYYY-MM-NNNN` from `generateNextInvoiceNumber`, `cancels_invoice_id` → original).
  2. Inserts mirrored line items (negated money fields; `quantity` unchanged) from a JSONB payload built in TypeScript.
  3. Updates the original invoice to `status = 'corrected'` and sets `cancelled_at` / `updated_at`.
- There is **no** separate `updateInvoiceStatus('cancelled')` step; if any step fails, Postgres rolls back all of them.

### 1.3 Invoice numbers (`RE-YYYY-MM-NNNN`)

Human-readable numbers are generated in [`src/features/invoices/lib/invoice-number.ts`](src/features/invoices/lib/invoice-number.ts) at **final insert time** (new invoice or Stornorechnung), using the machine date at that moment as the **issue month**:

- **Format**: `RE-{year}-{2-digit-month}-{4-digit-sequence}` (e.g. `RE-2026-04-0002`).
- **Sequence**: Increments within each calendar month, then resets to `0001` in the next month.
- **Uniqueness**: Enforced by a unique constraint on `invoices.invoice_number`.
- **Legacy**: Older rows may still show `RE-YYYY-NNNN`; they do not participate in the monthly `LIKE` query for the next number. New issuances use only the new shape.

### 1.4 Client reference fields (Bezugszeichen)

Fahrgast-specific reference lines (e.g. Versichertennummer, Unser Zeichen) are stored on `clients.reference_fields` as an ordered JSON array of `{ label, value }`. They are **not** read from the live client row when rendering an issued invoice PDF.

- **Snapshot:** On `createInvoice`, when `client_id` is set, the API loads `clients.reference_fields`, normalises it (strip empty labels, validate with Zod), and persists the result on `invoices.client_reference_fields_snapshot`. `NULL` means no bar; the app does not store an empty JSON array for “no fields”.
- **PDF:** [`InvoicePdfDocument`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) renders [`InvoicePdfReferenceBar`](../src/features/invoices/components/invoice-pdf/invoice-pdf-reference-bar.tsx) **only** when the snapshot parses to a non-empty array. Placement: full width directly **below** the cover header (Rechnungsdaten block) and **above** the subject / cover body, with vertical spacing consistent with other cover elements.
- **Modes:** Logic is keyed on **`client_id`**, not invoice `mode`. Today only `per_client` sets `client_id`; if other modes gain a client scope later, the same snapshot + PDF path applies.
- **Storno:** [`createStornorechnung`](../src/features/invoices/lib/storno.ts) / `create_storno_invoice` copies `client_reference_fields_snapshot` from the original invoice so the Storno PDF matches the corrected document’s layout.

### 1.5 Trip Invoice Status Badge

The **Fahrten** list ([`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx)) shows a per-trip **Rechnungsstatus** column so dispatchers can see invoicing state without opening each trip.

- **Data source:** The RSC PostgREST query embeds `invoice_line_items` on each trip via `invoice_line_items!invoice_line_items_trip_id_fkey(...)`, nested with `invoices(status, paid_at, sent_at)`. Only rows with a non-null `trip_id` appear (manual line items are excluded by the FK relationship).
- **Resolution logic** ([`trip-invoice-status-badge.tsx`](../src/features/trips/components/trip-invoice-status-badge.tsx)): aggregate across all embedded line items — **paid** > **sent** > **draft** > **uninvoiced** (Nicht abger.). Invoices in **`cancelled`** or **`corrected`** are ignored when computing the badge.
- **Storno:** After a Storno, the original invoice is `corrected` (ignored) and the Stornorechnung exists as **`draft`** until sent or paid, so the trip correctly shows **Entwurf** for the open Storno invoice.
- **List filter:** URL param `invoice_status` (`trips-filters-bar.tsx`) restricts rows to trips whose effective status matches. The RSC prefers Postgres RPC **`trip_ids_matching_invoice_effective_status`** (migration `20260411140000_trip_ids_matching_invoice_effective_status.sql`). If the RPC is not deployed yet (**PGRST202**), [`resolveInvoiceStatusTripFilter`](../src/features/trips/lib/resolve-invoice-status-trip-filter.ts) falls back to a paginated read of `invoice_line_items` + the same effective-status rules (`paid` / `sent` / `draft` use `.in('id', …)`; **uninvoiced** uses `.not('id', 'in', …)` for trips that have any draft/sent/paid line). Apply the migration for better performance on large datasets.

### 1.6 Draft invoice editing foundation (Phase A)

Drafts may be re-opened and edited; **sent / paid / cancelled / corrected stay immutable** (Storno only). Migration: [`20260529080000_draft_invoice_editing_foundation.sql`](../supabase/migrations/20260529080000_draft_invoice_editing_foundation.sql).

- **Per-payer flag `payers.revision_invoices_enabled`** (`BOOLEAN NOT NULL DEFAULT false`): gates whether a Kostenträger's draft invoices may be re-opened. Follows the existing per-payer feature-flag pattern (`manual_km_enabled`, `reha_schein_enabled`). **Toggled in the UI** via the Kostenträger settings sheet ([`payer-details-sheet.tsx`](../src/features/payers/components/payer-details-sheet.tsx) — "Rechnungsentwurf bearbeiten" Switch, auto-saves on flip through `updatePayerRevisionInvoicesEnabled` and invalidates the payer query keys, mirroring the reha/manual-km toggles). The invoice side reads the flag independently via the `getInvoiceDetail` payer join (Phase C), so flipping it here drives the detail-page "Bearbeiten" entry point and the edit-route guard.
- **RPC `replace_draft_invoice_line_items(p_invoice_id UUID, p_line_items JSONB)`** — `SECURITY DEFINER`, mirrors the [`create_storno_invoice`](../supabase/migrations/20260411120000_storno_atomic_rpc.sql) pattern rather than broadening RLS:
  - Guards: `current_user_is_admin()`, invoice belongs to `current_user_company_id()`, and **`status = 'draft'`** (the immutability guard — non-drafts raise `23514`). `invoice_line_items` still has no client UPDATE/DELETE policies; the RPC is the only mutation path.
  - Atomically deletes the existing line items, inserts the replacement rows from the JSONB array (same column shape as the Storno insert, incl. `billing_included` / `is_cancelled_trip`), and recomputes header totals.
  - **Server-side totals (authoritative).** Unlike `createInvoice`, which computes `subtotal`/`tax_amount`/`total` **client-side** in [`use-invoice-builder.ts`](../src/features/invoices/hooks/use-invoice-builder.ts) and passes them as insert values (the DB never verifies them today), this RPC recomputes the header from the persisted line items so the stored total can never desync from the stored lines. The recompute is a faithful port of [`calculateInvoiceTotals`](../src/features/invoices/api/invoice-line-items.api.ts): only `billing_included = true` rows count; `client_price_tag` gross-anchor lines sum `gross × qty` (+ grossed-up Anfahrt) while net-anchor lines accumulate net per tax-rate bucket and round VAT once per bucket; `tax_amount = total − subtotal`.
  - **Manual gross overrides:** intentionally **not** special-cased (see [revision-invoice-audit.md](plans/revision-invoice-audit.md) §"Deferred"). They are routed through the net-anchor path, which yields a bit-identical `subtotal` and differs from the TS only by ≤1 cent of `total`/`tax_amount` in mixed-rate invoices. The exact fix (a persisted `is_manual_gross_override` marker) is a deferred item for when the save path is wired.
- **Draft watermark:** see the PDF Layout System section below.

> **NOTE (Phase A → C):** Phase A shipped the schema + RPC; Phase B the read-only re-open (hydration); Phase C (below) the save path that calls `replace_draft_invoice_line_items`, the edit route, and the "Bearbeiten" entry point. The full round-trip (re-open → edit → save) is now live for flag-enabled payers.

### 1.6.1 Draft invoice re-open (Phase B) — hydration & inverse mapper

Re-opening a draft loads it back into the **existing** builder (no second editing UI). The mapping layer is reversible so a no-op edit re-persists byte-identical financials.

- **Inverse mapper** [`map-line-item-row-to-builder-line-item.ts`](../src/features/invoices/utils/map-line-item-row-to-builder-line-item.ts) (`mapLineItemRowToBuilderLineItem` + `mapLineItemRowToBuilderCancelledTrip`) inverts `lineItemToInsertRow` / `cancelledTripToInsertRow`. It is a **faithful copy, not a recomputation**: `price_resolution_snapshot` *is* the frozen `PriceResolution`, and `lineItemToInsertRow` recomputes `total_price` only from that snapshot + numeric columns. The mapper sets `unit_price = snapshot.unit_price_net` so `frozenPriceResolutionForInsert`'s `> 0.0001` guard stays false and the snapshot is returned unchanged on re-save. Round-trip fidelity is locked by [`map-line-item-row-to-builder-line-item.test.ts`](../src/features/invoices/utils/__tests__/map-line-item-row-to-builder-line-item.test.ts) (normal / manual gross override / KM override / billing excluded / cancelled / manual line).
- **Builder-only fields with no DB column** (documented reconstruction decisions):
  - **Manual gross override: NOT reconstructed.** `manualGrossTotal`/`isManualOverride` stay null/false — we do **not** reintroduce the `note.includes('Manuell überschrieben (Bruttoeingabe)')` string coupling that Phase A removed from the RPC. Hydrated override lines therefore flow through `calculateInvoiceTotals` exactly as the RPC persists them (`client_price_tag` → gross-anchor; all else → net-anchor), so the builder-displayed total equals the persisted total. The ≤1-cent mixed-rate edge is the single deferred item **D1** (now shared by both the RPC and the builder UI). Cosmetic trade-off: the Step-3 "Manuell" badge/reset is not shown for hydrated override lines.
  - **`originalPriceResolution` = the snapshot** (pre-override original is not persisted; "reset override" restores the last saved state).
  - **`resolved_rule` = reconstructed at hydration** via a live per-payer pricing-rules fetch (`listPricingRulesForPayer`, passed into the mapper as `ctx.rules` + `ctx.payerId`), so Step 3 KM overrides reprice in edit mode exactly like create mode. Because `invoice_line_items` snapshots only `billing_variant_code/name` + `billing_type_name` (not `billing_variant_id` / `billing_type_id` / `client_id`), the mapper passes `null` for those keys and `resolvePricingRule` resolves the **Kostenträger-wide rule** (STEP 3) or `null`; variant/type/client-specific rules cannot be reconstructed and degrade to `null`. The mapper falls back to `null` whenever no rules context is supplied (safe for any non-edit caller).
  - **KM "manuell" badge** is reconstructed (UI-only) when `effective_distance_km !== original_distance_km`; no financial effect.
- **Hydration in [`use-invoice-builder.ts`](../src/features/invoices/hooks/use-invoice-builder.ts)** — opt-in via an optional third arg `invoiceId`:
  - A pinned `useQuery` (`getInvoiceDetail`, `staleTime`/`gcTime: Infinity`, `refetchOnWindowFocus/Reconnect/Mount: false`) loads the draft. Seeding into builder state happens **once**, inside a `useEffect` gated by a `hasHydratedRef`, so a background/focus refetch can never overwrite in-progress edits.
  - A **separate** payer-keyed `useQuery` (`referenceKeys.billingPricingRules(payerId)` → `listPricingRulesForPayer`, the same cache create mode uses) fetches the payer's live pricing rules for `resolved_rule` reconstruction. It is intentionally **not** folded into the hydration query because `invoiceKeys.full` is shared with the detail page (`useInvoiceDetail`), which expects a plain `InvoiceDetail` — bundling rules there would poison that cache entry. The seed effect waits for this query to settle (`editRulesQuery.isLoading`) before its single seed so reconstruction can never be skipped by a race.
  - **No silent recalculation on load:** the trips fetch is gated with `enabled: !isEditMode && …` and the create-mode "reset when params incomplete" effect is gated with `if (!isEditMode)`. In edit mode `step2Values` is seeded from the invoice header (`billing_type_ids` / `billing_variant_ids` are null — fetch-only, never persisted).
  - Exposes `isEditMode`, `editInvoiceNumber`, `isHydrating`. Create mode (no `invoiceId`) is byte-for-byte unchanged.
- **Shell** [`invoice-builder/index.tsx`](../src/features/invoices/components/invoice-builder/index.tsx) accepts optional `invoiceId`, **locks payer + mode** (`Step1Mode` / `Step2Params` `locked` prop — changing them would invalidate the frozen snapshots), and shows a "Bearbeitung — Rechnung {Nr.}" indicator. Locking keeps `step2Values.payer_id` constant so neither the hook's clear effect nor the payer-change reset effect re-fires after hydration. The edit route (Phase C) now passes `invoiceId`.

### 1.6.2 Draft invoice re-open (Phase C) — save path + edit route + entry point

The save path closes the loop: an edited draft re-persists through the RPC with server-authoritative totals.

- **`updateDraftInvoice(payload)`** [`invoices.api.ts`](../src/features/invoices/api/invoices.api.ts) is the only write entry. Contract:
  - **Step A** calls `replace_draft_invoice_line_items(p_invoice_id, p_line_items)`. The RPC owns the `status='draft'` + company-ownership guard and the **server-side totals recompute** — `subtotal/tax_amount/total` are **never** sent from the client (hard rule). The serialized rows reuse `lineItemToInsertRow` / `cancelledTripToInsertRow` (the RPC reads `p_invoice_id`, ignoring each row's `invoice_id`).
  - **Step B** re-freezes `rechnungsempfaenger_snapshot` from the live recipient (a draft is not yet an issued §14 document, so it reflects the latest edit).
  - **Step C** updates **only draft-safe meta** (`intro_block_id`, `outro_block_id`, `payment_due_days`, `rechnungsempfaenger_id`, snapshot, `pdf_column_override`) with `.eq('id', …).eq('status','draft')` as defence in depth. It **never** touches `invoice_number`, `payer_id`, `company_id`, `mode`, `billing_*`, `period_*`, `client_id`, `status`, or totals.
- **Hook save branch** [`use-invoice-builder.ts`](../src/features/invoices/hooks/use-invoice-builder.ts): `updateMutation` mirrors `createMutation` (same step-4 meta resolution, same fire-and-forget trip writeback) but routes through `updateDraftInvoice`. `onSuccess` invalidates `invoiceKeys.all` + `full(id)` + `revenueTotal`, toasts, and navigates via the reused `onCreated(id)` callback (navigation-only — same detail target; not renamed to avoid changing the create-shared signature). Exposes `updateInvoice` / `isSaving`. The create flow is functionally unchanged.
- **Shell submit** branches `isEditMode ? updateInvoice(…) : createInvoice(…)` on the same confirm UI. Button label: `Änderungen speichern` / `Speichere Änderungen…` (edit) vs `Rechnung erstellen` / `Erstelle Rechnung…` (create); disabled on `isCreating || isSaving`.
- **Edit route** [`/dashboard/invoices/[id]/edit/page.tsx`](../src/app/dashboard/invoices/%5Bid%5D/edit/page.tsx) mirrors `new/page.tsx` reference data **plus a server-side guard**: the invoice must exist, be `status='draft'`, and belong to a payer with `revision_invoices_enabled = true`; otherwise `redirect('/dashboard/invoices/[id]')`. RLS already scopes the read to the company. This aligns with the RPC's own `draft` constraint — the capability is never reachable client-only.
- **Entry point** [`invoice-actions.tsx`](../src/features/invoices/components/invoice-detail/invoice-actions.tsx): a "Bearbeiten" button (Pencil) renders **only** when `status==='draft'` **and** `payer.revision_invoices_enabled === true`, routing to the edit route. Never shown for sent/paid/cancelled/corrected (terminal-state guard + draft check). `getInvoiceDetail` now selects `payers.revision_invoices_enabled` to supply the flag.

---

## PDF Layout System

Single source of truth (shared with Angebote): `src/features/invoices/lib/pdf-layout-constants.ts`.

- **`PDF_PAGE`**: Page dimensions + shared margins (pt) for A4 portrait and appendix landscape.
- **`PDF_ZONES`**: Named spacing tokens for header/body/table/footer zones (subject spacing variants, table padding, footer reserve, etc.).
- **`PDF_DIN5008`**: DIN 5008 Form B values used by Brief mode (cover-page address window + fold marks).
- **`PDF_RENDER_MODES`**: Supported render modes (`'digital'` / `'brief'`) with a typed `PdfRenderMode` union.

Rule: **All PDF spacing values must come from `pdf-layout-constants.ts`. No magic numbers in any PDF component.**

Cross-reference: **Shared with Angebote module — both import from `src/features/invoices/lib/pdf-layout-constants.ts`.**

### Draft watermark (`ENTWURF`)

[`InvoicePdfDocument`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx) accepts an optional `showDraftWatermark?: boolean` prop (**default `false`** — non-draft output stays byte-identical). When `true`, a diagonal light-gray `ENTWURF` stamp is rendered as the first child of **every** `Page` (cover + each appendix variant) using `fixed` so it repeats on wrapped pages and sits under the content. Cover watermark is in `InvoicePdfDocument`; appendix watermarks are repeated per page in `InvoicePdfAppendixPages`. Size / colour / opacity / rotation live in `PDF_DRAFT_WATERMARK` in [`pdf-styles.ts`](../src/features/invoices/components/invoice-pdf/pdf-styles.ts) (no magic numbers).

Wiring:
- **Detail downloads** ([`invoice-detail/index.tsx`](../src/features/invoices/components/invoice-detail/index.tsx), both Digital + Brief) and **preview route** ([`invoice-pdf-preview.tsx`](../src/features/invoices/components/invoice-pdf/invoice-pdf-preview.tsx)): `showDraftWatermark={invoice.status === 'draft'}`.
- **Builder live preview** ([`use-invoice-builder-pdf-preview.tsx`](../src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx)): `showDraftWatermark={true}` unconditionally — the builder only ever previews a draft (unsaved or saved-draft), and that preview is the most likely to be screenshotted/printed before saving, so it must never look final.

Brief mode implementation note (Path C):

- Brief mode uses `InvoicePdfCoverHeaderBrief` (separate component) plus a **page-level absolute address window** pinned to `PDF_DIN5008.addressWindowTop` (127pt) and fold marks as direct `<Page>` children.
- This avoids branching inside the digital header and guarantees DIN geometry even when flow content height varies.

## 2. The Invoice Builder Wizard (State Machine)

The creation of new invoices is handled entirely by a client-side **5-step** wizard (`InvoiceBuilder`). Transacting intermediate data on the client ensures the database is only touched once the user fully confirms the final layout.

**Lifted state:** `builderColumnProfile` (resolved `PdfColumnProfile`) is lifted to `invoice-builder/index.tsx` so the live PDF preview hook (`use-invoice-builder-pdf-preview.tsx`) can consume it from Step 1 onwards. Initialized to `resolvePdfColumnProfile(null, null, null)` (system default) so the preview is always valid before Step 4 is reached.

### Step 1: Mode Selection (`Step1Mode`)
Defines the aggregation strategy for fetching trips:
- **Monatlich / Zeitraum**: Fetches all trips for a selected Payer (Kostenträger) regardless of the client.
- **Einzelfahrt**: Targets one specific trip.
- **Fahrgast (per_client)**: Inverts the flow. The dispatcher selects a `Client` first, and the system dynamically computes and surfaces only the historical `payer + billing_variant` combinations that this specific passenger has used.

### Step 2: Parameter Collection (`Step2Params`)
Collects `payer_id`, `Date Range`, and optional billing scope fields.
- Relies heavily on Zod for form validation.
- Due to the dynamic nature of the `per_client` mode, hidden fields (like `billing_variant_id`) gracefully parse `nullish()` values out of Zod but are strictly cast to `string | null` before executing backend data fetches to prevent silent validation failures.

**Mode semantics:**
- **monthly / single_trip**: Optional **Abrechnungsarten** are stored in **`billing_type_ids`** (multi-select, Popover + Command). **`billing_type_id` is not the monthly source of truth** — it stays **`null`** on submit and on the **invoice header** for these modes (including when exactly one family is selected), so scope is not “mirrored” into the single UUID column. **Empty / null `billing_type_ids` = all families** for the payer. Trip fetch expands selected type IDs to a **union of `billing_variants.id`** and filters `trips` with `.in('billing_variant_id', …)` (no direct `trips.billing_type_id` filter).
- **Unterarten (optional)** (`billing_variant_ids`) appears **only when exactly one** family is in scope (`billing_type_ids.length === 1`). Otherwise the UI hides it and **`tripsBuilderParamsFromStep2`** clears `billing_variant_ids` and `billing_variant_id` before fetch — subset is meaningless across multiple families. The monthly subset control writes **only** `billing_variant_ids`; it never sets `billing_variant_id`. Header `invoices.billing_variant_id` stays **`null`** for monthly multi-variant runs; only **`per_client`** sets a single `billing_variant_id` for fetch + header.
- **Fetch-only fields:** `billing_variant_ids` and **`billing_type_ids`** are **not** persisted on the `invoices` row. Trip loading uses `resolveBillingVariantFilters` / `billingVariantFetchBranchFromParams` precedence: **validated subset** (exactly one family in scope) → else **single** `billing_variant_id` (**per_client**) → else **multi-type union** → else **all variants for one `billing_type_ids` entry** → else **all variants for legacy `billing_type_id`** → else no variant filter. Invalid subset state is cleared at the **param assembly** boundary (`trips-builder-params.ts`).
- **Rechnungsempfänger preview (Step 2):** if **exactly one** billing type is selected and that family row has a type-level Empfänger, the preview uses that tier; with **zero or multiple** families selected, the preview uses the **Kostenträger** tier only (same as when no type-specific recipient applies).
- **Query cache:** `invoiceKeys.tripsForBuilder` stores **`billing_type_ids`** and `billing_variant_ids` **sorted** (empty → `null`) — `normalizeTripsForBuilderTypeIdsForQueryKey` / `normalizeTripsForBuilderVariantIdsForQueryKey` in `src/query/keys/invoices.ts`.
- **per_client**: the dispatcher selects a **Fahrgast** first, then picks a historical `{ payer_id + billing_variant_id }` combination; **`billing_type_ids` is forced null**; **`billing_type_id`** comes from the combination.

### Step 3: Line Item Engine (`Step3LineItems`)
This is the heart of the verifier. The wizard queries the real `trips` matching the Step 2 parameters, and temporarily projects them into `BuilderLineItem` objects.
- **1-to-1 Mapping**: Every trip translates into one distinct line item.
- **Passenger snapshot:** Invoice line items snapshot `trips.client_name` when `client_id` is null but the trip carries a passenger display name (Stammdaten-linked trips still use the `clients` join first). See [trip-client-linking.md](trip-client-linking.md).
- **Route visibility**: Pickup and dropoff addresses appear in the **expanded** row panel (collapsed row stays compact). See [manual-km-overrides.md](manual-km-overrides.md) Step 3 UX.
- **Google Maps directions**: When both `pickup_address` and `dropoff_address` are non-empty, the **collapsed** row shows a map icon beside the position number (`#1`, `#2`, …) that opens Google Maps directions in a new tab — client-side navigation only, no Maps API key.
- **Manual KM** (when `payers.manual_km_enabled` is true for the trip’s payer): The collapsed row shows routing km (read-only) plus an inline km field; committing updates `effective_distance_km`, VAT, Anfahrt, and (unless the line is Taxameter / `manual_gross_price`) **per-km transport** via `resolveTripPrice` and `resolved_rule`. On invoice creation, confirmed km is written fire-and-forget to `trips.manual_distance_km` (never to `driving_distance_km`). Enable manual KM per payer in the Kostenträger detail sheet (**Manuelle KM-Eingabe**).
- **Inline Editing**: If a trip has no price (`unit_price === null`), the row receives a ⚠️ Warning Badge. The dispatcher can click the "Fehlt" button to inject the price locally—without having to leave the wizard.

**Billing Inclusion Control (Feature 1 + 1b):** Every normal `BuilderLineItem` starts as **included** (`billingInclusion: { included: true, reason: '' }`). The dispatcher can opt a trip out by unchecking the checkbox at the far left of the collapsed row — a shadcn `<Dialog>` forces entry of a mandatory exclusion reason before confirming. Opted-out rows stay in `lineItems[]` (never removed) but are excluded from `calculateInvoiceTotals` and from the Haupttabelle PDF; they are rendered in the **Ausgeschlossene Fahrten** appendix block when the Step 4 checkbox is enabled (only visible when at least one trip is excluded). Opted-out rows are persisted with `billing_included = false` and `billing_exclusion_reason` on `invoice_line_items`. Re-checking an opted-out trip immediately clears the reason with no dialog.

**Cancelled trips (billing vs PDF):** The builder loads trips in two queries ([`invoice-line-items.api.ts`](../src/features/invoices/api/invoice-line-items.api.ts)): `fetchTripsForBuilder` excludes `status = cancelled` (constant `CANCELLED_STATUS`). A parallel **`fetchCancelledTripsForBuilder`** returns a **`BuilderCancelledTripRow`** list (extends `CancelledTripRow` with `billingInclusion` + pricing fields). **Default: opted out** (`billingInclusion.included = false`). The Step 3 **Stornierte Fahrten** collapsible lets the dispatcher opt a cancelled trip in: an amber-styled mandatory billing-reason `<Textarea>` appears and the trip is priced via `buildCancelledTripBillingState` (same `resolveTripPrice` cascade as normal trips). Opted-in cancelled trips are included in `calculateInvoiceTotals`, inserted as `invoice_line_items` with `is_cancelled_trip = true` / `billing_included = true` / `cancelled_billing_reason`, and always shown in the **Abgerechnete stornierte Fahrten** billed block in the PDF appendix (no checkbox gate). The **`show_cancelled_trips`** Step 4 checkbox is **unchanged** — it only gates the **passive €0** list (`renderCancelledPassiveSection`) using `canceled_reason_notes`. Main cover and Haupttabelle appendix pages filter `invoice.line_items` to `billing_included = true && !is_cancelled_trip`. **Re-downloading** an issued PDF with opted-in cancelled rows is deferred to **`TODO(issued-cancelled-rows)`**.

### Step 4: PDF-Vorlage (`Step4Vorlage`)

Allows the dispatcher to select a PDF-Vorlage and optionally override the column layout for this specific invoice before confirming.

- Inherits the Vorlage from the selected Kostenträger (payer) if one is assigned, otherwise falls back to the company default, then the system default.
- Displays a live PDF preview that updates in real time as columns are changed.
- The dispatcher must click **"Weiter zur Bestätigung"** (`pdfStepAcknowledged`) to unlock Step 5 — this ensures conscious review of the PDF layout before committing.
- Column overrides selected here are saved to `invoices.pdf_column_override` at invoice creation time (immutable snapshot, same pattern as line items).
- **Stornierte Fahrten anzeigen** checkbox: gates the passive €0 cancelled-trips appendix block (`show_cancelled_trips`). Semantics unchanged from pre-Feature 1b.
- **Ausgeschlossene Fahrten anzeigen** checkbox (conditional): only shown when at least one normal trip was opted out in Step 3. Gates the `renderExcludedSection` appendix block (`show_excluded_trips`). Opted-out trips show date, passenger, route, and exclusion reason (amber) — no amount column since they have zero billing impact.

### Step 5: Bestätigung (`Step4Confirm`)

Calculates the final Netto and Brutto summaries using a tax breakdown (separating 7% and 19% items). It overrides the default `payment_due_days` (inherited from the Company Profile) if needed, and officially triggers the DB insertion.

### Phase 5 & 5b (complete) — PDF hardening + builder shell

- **Recipient / §14:** `InvoicePdfDocument` uses frozen `rechnungsempfaenger_snapshot` per [docs/rechnungsempfaenger.md](rechnungsempfaenger.md) (dual block for `per_client`, snapshot-only window for `monthly` / `single_trip`, payer fallback + `console.warn` when snapshot is missing on legacy rows).
- **Appendix table:** [`invoice-pdf-appendix.tsx`](../src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx) — fixed columns (Datum, Fahrgast, Von/Nach, Strecke, Netto, MwSt., Brutto, KTS, Fahrer, Hin/Rück); line net uses `price_resolution_snapshot.net` when present ([`invoice-pdf-line-amounts.ts`](../src/features/invoices/components/invoice-pdf/lib/invoice-pdf-line-amounts.ts)); KTS rows show €0 + note.
- **Trip meta snapshot:** Optional JSONB `invoice_line_items.trip_meta_snapshot` (migration `20260407120000_invoice_line_items_trip_meta_snapshot.sql`) — frozen driver + direction for PDF, **separate** from `price_resolution_snapshot`. **Creating** invoices requires this migration applied so `insertLineItems` can persist the column.
- **Detail fetch:** `getInvoiceDetail` loads line items with `line_items:invoice_line_items(*)` so PostgREST does not fail if optional columns are not migrated yet; after migration, `(*)` still returns `trip_meta_snapshot`.
- **Builder preview:** `/dashboard/invoices/new` loads a full `company_profiles` row and passes `companyProfile` into `InvoiceBuilder`. [`use-invoice-builder-pdf-preview.tsx`](../src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx) runs [`build-draft-invoice-detail-for-pdf.ts`](../src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts) + [`usePDF`](https://react-pdf.org/hooks#usepdf) from **step 3** when line items exist; [`invoice-builder-pdf-panel.tsx`](../src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx) shows the iframe (desktop right column; mobile Sheet via **Vorschau**).

#### Split-trigger preview (Category A / Category B)

Large invoices (120+ trips) previously re-rendered the full PDF on every KM/price blur, causing tab OOM. The builder now splits preview triggers by change type:

| Category | What changes | Trigger |
|---|---|---|
| **A — layout/template** | `columnProfile`, intro/outro text, `step2Values`, company profile, recipient, payment days, column reorder | **Auto-render** — `scheduleCategoryAUpdate` with **600 ms** debounce (`PREVIEW_CATEGORY_A_DEBOUNCE_MS`); **0 ms** on `columnReorderGeneration` bump |
| **B — trip data** | `lineItems`, billed/passive cancelled trips, excluded trips | **Manual only** — sets `isDirty`; admin clicks **Aktualisieren** → `requestPreviewUpdate()` (immediate, clears pending A timer) |

- **Initial load** (trips fetch / edit hydration): one auto-render when `draftInvoice` first becomes available — not marked dirty.
- **`livePreviewActive` false** (trips cleared): resets `isDirty` and preview session refs so a stale “Vorschau veraltet” banner cannot persist.
- **Continuous iframe:** while `usePDF` sets `loading: true`, `pdf.url` still points at the previous blob; the panel keeps the iframe visible and shows a non-blocking **“Wird aktualisiert…”** badge. Superseded blob URLs are revoked in the panel when `pdf.url` changes **and** `pdf.loading === false` (react-pdf sets both in one `setState` on completion).
- **Main thread:** browser `usePDF` runs layout on the main thread (not a Web Worker) — Category B gating is required at scale.
- **Mobile sheet** uses the same `isDirty` / `requestPreviewUpdate` props as the desktop panel.

Classification contract is documented in the comment block at the top of `use-invoice-builder-pdf-preview.tsx`.

### Phase 6 (complete) — Dynamic PDF-Vorlagen (column layout system)

#### Overview

Phase 6 introduced a fully configurable PDF column system. Dispatchers and admins can now control which columns appear in the main invoice table and the appendix, in what order, and with what layout (grouped by route vs. flat per-trip). Dedicated reference: [pdf-vorlagen.md](pdf-vorlagen.md).

#### Database additions (6a)

- `pdf_vorlagen` — company-scoped Vorlage definitions: `main_columns` (ordered `text[]`), `appendix_columns` (ordered `text[]`), `main_layout` (`grouped` | `flat` | `single_row` | `grouped_by_billing_type`), `is_default`, `name`. RLS scoped to `company_id`.
- `payers.pdf_vorlage_id` — assigns a preferred Vorlage to a Kostenträger.
- `invoices.pdf_column_override` — JSONB snapshot of the full resolved `PdfColumnProfile` at invoice creation time (immutable, mirrors the line-item snapshot pattern).

#### 4-level resolution chain

Priority order (highest to lowest):

1. `invoices.pdf_column_override` — per-invoice dispatcher override (frozen at creation)
2. `payers.pdf_vorlage_id` → linked `pdf_vorlagen` row
3. `pdf_vorlagen WHERE is_default = true` — company-wide default Vorlage
4. `SYSTEM_DEFAULT_*` constants in `pdf-column-catalog.ts` — hardcoded app fallback

Implemented in `resolve-pdf-column-profile.ts`. The resolver returns `main_columns` **exactly as stored** — it never filters by layout compatibility. Layout filtering happens only at render time in `InvoicePdfCoverBody` via `mainTableKeys`.

#### Single source of truth — `pdf-column-catalog.ts`

Every PDF column is defined once in `PDF_COLUMN_CATALOG`. No other file defines column metadata independently. Adding a new column requires only one new entry here.

Column flags:

- `flatOnly: true` — only valid in flat main layout (trip-level fields like `client_name`, `trip_date`, `pickup_address`, `dropoff_address`, `distance_km`, `driver_name`, `billing_variant`, `description`, `unit_price_net`, `billing_type`)
- `groupedOnly: true` — only valid in grouped layout (`route_leistung`, `quantity`)
- `appendixOnly: true` — not shown in main page pickers

#### Dynamic PDF renderer (6e)

`InvoicePdfCoverBody` renders:

- **Grouped** (`main_layout: 'grouped'`): `InvoicePdfSummaryRow[]` from `buildInvoicePdfSummary()` — grouped-safe columns only
- **Single row** (`main_layout: 'single_row'`): one `InvoicePdfSummaryRow` from `buildInvoicePdfSingleRow()` (same column pool as grouped; all trips collapsed)
- **Nach Abrechnungsart** (`main_layout: 'grouped_by_billing_type'`): `InvoicePdfSummaryRow[]` from `buildInvoicePdfGroupedByBillingType()` — one row per `(billing_type_name` snapshotted on each line item, else legacy `billing_variant_name` / `code`, `tax_rate)`; uses the same grouped column pool. Labels use the **Abrechnungsfamilie** so rows show e.g. Abreise / Anreise instead of the generic Unterart name „Standard“.
- **Flat** (`main_layout: 'flat'`): `InvoiceLineItemRow[]` — per-trip columns

`InvoicePdfAppendix` always renders flat line items regardless of `main_layout`. Auto-switches to landscape when `appendix_columns.length > APPENDIX_LANDSCAPE_THRESHOLD`.

#### Key rendering rules (hard-won fixes)

- `mainTableKeys` is the **single source array** for `calcColumnWidths`, the header row, and all data rows. Using different arrays for any of these three causes column misalignment after drag reorder.
- `@react-pdf/renderer` flex rows require `width: '100%'` on row containers and `minWidth: 0, overflow: 'hidden'` on cells or columns overflow and misalign.
- PostgREST returns JSONB columns (`trip_meta_snapshot`, `price_resolution_snapshot`) as strings despite TypeScript typing them as objects. `coerceLineItemJsonbSnapshots` parses them once per row before any `renderCellValue` call.
- Per-line net for grouping and aggregates in **`lineNetEurForPdfLineItem`** still uses **`(unit_price × quantity) + (approach_fee_net ?? 0)`** on **persisted** columns (historical rows may predate the net-first insert). **New** invoices: `insertLineItems` writes `total_price` from **`price_resolution_snapshot.net` + approach** so totals match tiered pricing; the builder / draft PDF use the same authoritative `net`. Where a single gross-backed net is needed, `total_price / (1 + tax_rate)` matches the stored line gross.

#### Phase 9 — grouped_by_billing_type layout

Fourth `main_layout` value: groups invoice cover rows by Abrechnungsart instead of route.

**`main_layout` modes:**

| `main_layout` | Description |
|---|---|
| `grouped` | Grouped by route (Hinfahrt/Rückfahrt address pairs) |
| `flat` | One row per trip |
| `single_row` | All trips collapsed into one summary row |
| `grouped_by_billing_type` | One row per (Abrechnungsart, MwSt.-Satz) combination — if a billing type has trips at both 7% and 19%, they appear as two separate rows |

**Grouping key:** `billing_variant_name ?? billing_variant_code ?? 'Unbekannt'` combined with `tax_rate`, where `billing_variant_name` is the snapshotted **Unterart** name. This composite key guarantees every output row has exactly one tax rate — no approximations, no hidden mixed-rate scenarios.

**`from`/`to` fields:** set to empty `CanonicalPlace`; origin/destination addresses are not meaningful at billing-category level.

**`total_km`:** Sums **`effective_distance_km`** (fallback routing `distance_km` when effective is null). `null` when any contributing line has no resolved billed km (rendered as `—`).

**Snapshot fields (hierarchy):**
- `invoice_line_items.billing_variant_name` = **Unterart** name snapshot (immutable)
- `invoice_line_items.billing_type_name` = **Abrechnungsfamilie** name snapshot (immutable)
- `invoices.billing_variant_id` = Unterart scope when variant-scoped; `null` otherwise

#### Phase 8 — Anfahrtspreis + extended summary

- **`single_row`:** third `main_layout` — entire invoice as **one** summary row (label from payer + period on the cover, not a `subject` field).
- **`InvoicePdfSummaryRow`:** adds `total_km`, `has_null_km`, `approach_costs_net`, `transport_costs_net`, `total_costs_gross` (transport net = total line net minus summed approach; gross uses the same tax rounding as the rest of the PDF).
- **Catalog keys** (grouped / `single_row`): `trip_count`, `total_km`, `approach_costs`, `transport_costs`, `total_net`, `total_gross`; flat layout can expose `approach_fee_line` where applicable. See `pdf-column-catalog.ts` and [anfahrtspreis.md](anfahrtspreis.md).

#### Storno behavior

`storno.ts` passes `pdf_column_override` into **`create_storno_invoice`**, which persists it on the Storno row in the same transaction as line items and the original `corrected` update. Per §14 UStG, a Stornorechnung must mirror the layout of the original.

#### Settings UI

Route: `/dashboard/abrechnung/vorlagen` (PDF & Layout tab; legacy `/dashboard/settings/pdf-vorlagen` redirects)

- PanelList of all company Vorlagen (left) + editor panel (right)
- dnd-kit sortable column chips for reordering
- Separate column pickers for main page and appendix
- Layout radio: `gruppiert`, `eine Zeile (Gesamtübersicht)`, `pro Fahrt`, `nach Abrechnungsart`
- Switching layout migrates existing columns: surviving valid keys are kept, incompatible columns dropped, never leaves list empty

#### Payer assignment

Kostenträger detail sheet includes a PDF-Vorlage Select in the settings section. Changing this sets `payers.pdf_vorlage_id`. All future invoices for this payer will use the assigned Vorlage unless the dispatcher overrides in Step 4.

---

## 3. Pricing & Tax Calculation Layer

Tax and price logic is abstracted away from the UI into dedicated service files.

### 3.1 Tax Rate Resolution (`lib/tax-calculator.ts`)
Automatically determines the German MwSt rate:
- Trips under 50km receive `7%` (ermäßigter Steuersatz für Personennahverkehr)
- Trips over 50km receive `19%`
- Trips with unknown distance default to `7%` (conservative fallback)

### 3.2 Price Resolution (`lib/price-calculator.ts`)

**Catalog rules:** Production pricing also loads **`billing_pricing_rules`** per Kostenträger / Abrechnungsfamilie / Unterart and runs **`resolvePricingRule`** then **`resolveTripPrice`** (see [pricing-engine.md](pricing-engine.md)). Manage those rules centrally under **Abrechnung → Preisregeln** — [`/dashboard/abrechnung/preise`](../src/app/dashboard/abrechnung/preise/page.tsx).

The `resolveTripPrice()` function follows a strict **3-tier precedence hierarchy** when determining the billable price for a trip:

#### Price Precedence (Highest → Lowest)

| Priority | Source | Field | Description |
|----------|--------|-------|-------------|
| **1. Highest** | Client price tag | `clients.price_tag` | **Stored as BRUTTO** (gross price incl. tax). Automatically converted to NETTO during invoicing. Applies to ALL trips of this client. |
| **2. Fallback** | Trip price | `trips.price` | **Stored as NETTO** (net price without tax). Manually entered per trip. Only used when client has no `price_tag`. |
| **3. Last resort** | Manual entry | `null` | No price available. Dispatcher must enter price manually in Step 3. |

#### Key Behaviors

- **`clients.price_tag` wins automatically**: If a client has a `price_tag` set, it takes precedence over any manually entered `trips.price`
- **Visual indicator in Step 3**: The invoice builder shows a badge indicating which price source was used:
  - "Kunden-Preis" (green badge) — price from `clients.price_tag`
  - "Fahrt-Preis" (blue badge) — price from `trips.price`
- **Consistent pricing**: Setting a `price_tag` on a client ensures all their trips use the same price, eliminating the need to manually enter prices for every trip

#### Brutto → Netto Conversion

When a `price_tag` is used, the system automatically converts from **brutto** (stored) to **netto** (invoice line item):

```
netto = brutto / (1 + tax_rate)
```

**Example**: Client has `price_tag = 25.00 €`, trip qualifies for 19% tax:
- **Netto** (stored in line item): 25.00 / 1.19 = **21.01 €**
- **Tax** (7% or 19%): 21.01 × 0.19 = **3.99 €**
- **Brutto** (matches price_tag): 21.01 + 3.99 = **25.00 €** ✓

#### Example Scenarios

| Client has `price_tag` | Trip has `price` | Tax Rate | Result (Netto) | Source Badge |
|------------------------|------------------|----------|----------------|--------------|
| 25.00 € (brutto) | 30.00 € (netto) | 19% | **21.01 €** | Kunden-Preis |
| null | 30.00 € (netto) | 19% | **30.00 €** | Fahrt-Preis |
| 25.00 € (brutto) | null | 7% | **23.36 €** | Kunden-Preis |
| null | null | — | **null** ⚠️ | Fehlt (manual entry required) |

---

## 4. API & PDF Generation

### Data Fetching Constraints (`invoices.api.ts`)
Due to strict foreign key relationships, complex objects like the `company_profile` cannot be recursively joined in a single PostgREST pass from the `invoices` table.
- `getInvoiceDetail` sequentially fetches the invoice (with payer, client, and **`line_items:invoice_line_items(*)`** — wildcard avoids errors when new line-item columns are added before every environment has run migrations), then fetches `company_profile` using the invoice's `company_id`.

### Query Invalidation for Dashboard Stats

Invoice mutations automatically refresh the "Rechnungsumsatz" stat on the dashboard overview through React Query invalidation:

- **`useUpdateInvoiceStatus`**: Invalidates `invoiceKeys.revenueTotal` on `onSettled` when invoice status changes (draft → sent → paid). This ensures the revenue total reflects only invoices with status 'sent' or 'paid'.
- **`useInvoiceBuilder`**: Invalidates `invoiceKeys.revenueTotal` on `onSuccess` after invoice creation. New invoices start as 'draft' but may immediately be sent, so the cache is refreshed to include the new invoice if it qualifies for revenue calculation.

The revenue total query (`useInvoiceRevenueTotal`) has a 5-minute `staleTime` since invoice revenue does not need real-time precision, but explicit invalidation ensures the stat updates immediately after user actions.

### Invoice PDF (`@react-pdf/renderer`)

PDFs are generated in the browser with **`InvoicePdfDocument`** ([`src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`](../src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx)):

- **Detail page** — [`PDFDownloadLink`](https://react-pdf.org/components#pdfdownloadlink) wraps the same document for “PDF herunterladen”.
- **Preview** — dashboard route `src/app/dashboard/invoices/[id]/preview/page.tsx` uses `InvoicePdfPreview` + `PDFViewer`.

**Composition:** cover `Page` (header, reference bar, body, footer) + [`InvoicePdfAppendixPages`](../src/features/invoices/components/invoice-pdf/invoice-pdf-appendix-pages.tsx) (all appendix `Page` shells). Root keeps recipient/salutation/totals prep and gates `cancelledTrips` / `excludedTrips` before passing pre-filtered arrays to the appendix orchestrator.

**No `React.memo` in the PDF tree:** `@react-pdf/renderer` performs its own layout pass outside React's reconciler — memo does not skip appendix work inside `<Document>`.

Styling is centralized in [`pdf-styles.ts`](../src/features/invoices/components/invoice-pdf/pdf-styles.ts) (A4 padding, DIN-oriented top margin, flex tables). Supporting utilities: `resolve-sender-font-size.ts`, `generate-payment-qr-data-url.ts`, `build-sepa-qr-payload.ts`.

## Logo im PDF-Header
### Struktur
Das Logo wird über `cp.logo_url` als `<Image>` in `brandStack` gerendert,
direkt im `headerLeft`-Block oberhalb von Slogan, Senderzeile und Empfängeradresse.

### Bekanntes react-pdf Verhalten
- Feste `height` auf `<Image>` + `objectFit: 'contain'` erzeugt toten Leerraum
  (die Box behält die volle Höhe, auch wenn das Bild nur einen Bruchteil davon ausfüllt)
- `objectFit: 'contain'` zentriert das Bild vertikal → Lücke ÜBER dem Logo

### Lösung (aktuell implementiert)
| Property | Wert | Warum |
|---|---|---|
| `width` | `220` | Horizontale Breite des Logos |
| `maxHeight` | `70` | Begrenzt Höhe ohne toten Raum |
| `objectFit` | `'contain'` | Seitenverhältnis bleibt erhalten |
| `alignSelf` | `'flex-start'` | Kein vertikales Dehnen im Flex-Container |
| `objectPositionY` | `0` | Bild beginnt oben, Leerraum fällt nach unten |

### Größe anpassen
`maxHeight = width / erwartetes_Seitenverhältnis`

Beispiel: Breites Logo (4:1) → `width: 220, maxHeight: 65`

### Kein Logo vorhanden
Wenn `cp.logo_url` null ist, rendert `brandStack` leer und der Briefkopf
(Senderzeile + Empfängeradresse) beginnt direkt am oberen Rand von `headerLeft`.
Das Layout ist identisch — kein Extra-Padding nötig.

#### PDF layout & codebase map

| Piece | File | Role |
|-------|------|------|
| Root composer | `InvoicePdfDocument.tsx` | `Document` + cover `Page`; recipient/salutation; totals + `buildInvoicePdfSummary`; passes gated appendix props to `InvoicePdfAppendixPages` |
| Appendix pages | `invoice-pdf-appendix-pages.tsx` | All appendix `<Page>` wrappers: Fahrtendetails (single or `grouped_by_billing_type` multi-page), passive Stornierte, Ausgeschlossene; draft watermark + footer per page; receives pre-gated `cancelledTrips` / `excludedTrips`, `appendixLineItems`, `effectiveProfile`, `invoiceId` (`string | null`) |
| Cover header | `invoice-pdf-cover-header.tsx` | Logo, sender line, address window, Rechnungsdaten |
| Cover body | `invoice-pdf-cover-body.tsx` | Dynamic main table: grouped (`InvoicePdfSummaryRow`) or flat (`InvoiceLineItemRow`); `mainTableKeys` as single source array for widths + header + body |
| Footer | `invoice-pdf-footer.tsx` | Fixed footer + `Seite x / y` |
| Appendix | `invoice-pdf-appendix.tsx` | Dynamic appendix: columns from `columnProfile.appendix_columns`; auto-landscape when > 7 columns; `coerceLineItemJsonbSnapshots` before render |
| Column catalog | `pdf-column-catalog.ts` | Single source of truth for all PDF column definitions; `flatOnly`, `groupedOnly`, `appendixOnly` flags |
| Column layout utils | `pdf-column-layout.ts` | `getNestedValue`, `coerceLineItemJsonbSnapshots`, `renderCellValue`, `renderGroupedCellValue`, `calcColumnWidths` |
| Profile resolver | `resolve-pdf-column-profile.ts` | 4-level resolution chain; returns profile as stored (no layout filtering) |
| Profile enricher | `enrich-invoice-detail-column-profile.ts` | Attaches `column_profile` to `InvoiceDetail` outside `invoices.api.ts` (frozen file) |
| Vorlage API | `pdf-vorlagen.api.ts` | CRUD for `pdf_vorlagen`; delete blocked if payer references it; `setDefaultVorlage` clears other defaults first |
| Draft adapter | `build-draft-invoice-detail-for-pdf.ts` | Synthetic `InvoiceDetail` for builder live preview only |
| Format helpers | `lib/invoice-pdf-format.ts` | EUR, dates, IBAN display, sender one-liner |
| Places / routes | `lib/invoice-pdf-places.ts` | Canonical addresses, hint map, airport label |
| Summary build | `lib/build-invoice-pdf-summary.ts` | Grouped routes, Hinfahrt/Rückfahrt labels, net line amount |

**Route Consolidation Logic:** The summary builder now matches routes by canonicalized addresses **only** (not by tax rate). This ensures Hinfahrt and Rückfahrt pairs consolidate properly even if they have different tax rates. The direction labels (Hinfahrt/Rückfahrt) are determined by the first occurrence order of the route.

**Key Normalization Strategy:** Place keys use `cityStem` (city without zip code) to ensure consistent matching. For example, "Taubenstraße 17, 26122 Oldenburg (Oldb)" becomes key: `taubenstraße 17|oldenburg oldb`. This ensures incomplete addresses that receive hints match complete addresses with the same canonical key, preventing fragmentation into 3 route groups instead of 2.

**Pages:** (1) summary + payment; (2) trip-detail appendix. Footer repeats on both; appendix uses a fixed header when content wraps.

---

## Invoice Email Draft

Feature: per-invoice editable email draft (subject + body) stored on the `invoices` table.

- **Columns:** `email_subject` TEXT, `email_body` TEXT, both nullable; mutable (same pattern as `notes`).
- **Migration:** `20260410190000_invoices_email_draft.sql`.
- **Generation:** [`src/features/invoices/lib/generate-invoice-email-draft.ts`](../src/features/invoices/lib/generate-invoice-email-draft.ts) — builds subject from `invoice_number` + `period_from` / `period_to`, body from `total` + due date (`created_at` + `payment_due_days`).
- **Recipient resolution for salutation:** `rechnungsempfaenger_snapshot` → `payer.name`.
- **UI:** [`invoice-email-draft.tsx`](../src/features/invoices/components/invoice-detail/invoice-email-draft.tsx) — collapsible panel, inline editable fields, per-field copy button, saves via `useSaveInvoiceEmailDraft` → `saveInvoiceEmailDraft` → invalidates `invoiceKeys.full(id)`.
- **Does not send email** — copy-paste only by design.

---

## 5. Security & RBAC Notes
- **`invoices` / `invoice_line_items`**: RLS restricts SELECT/INSERT/UPDATE to `accounts.role = 'admin'` rows whose `company_id` matches `current_user_company_id()` (see migration `20260401180000_invoices_invoice_line_items_rls.sql`). The next invoice number is allocated via RPC `invoice_numbers_max_for_prefix` (SECURITY DEFINER) so the sequence stays **global** across tenants while list/detail queries remain company-scoped.
- All endpoints rely on Supabase Row Level Security (RLS) bound to the active `company_id`.
- Sentry captures all PDF generation render faults and query lookup errors to ensure seamless administrative support.

---

*Architecture notes updated through Phase 6g (PDF-Vorlagen + dynamic column system).*
