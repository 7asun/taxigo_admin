# Audit: Cancelled trips in the invoice builder

Read-only audit (no application code changes). Focus: where trips are loaded for invoicing, how amounts are computed, PDF-Vorlage step state, react-pdf table mapping, creation flow, existing status guards, and DB/RLS facts for `trips.status`.

---

## Q1 — Trip fetch query

**Files:** `src/features/invoices/api/invoice-line-items.api.ts` (`fetchTripsForBuilder`), called from `src/features/invoices/hooks/use-invoice-builder.ts` (`tripsQuery.queryFn`).

**Finding:** Trips for the invoice builder are loaded only via `fetchTripsForBuilder`. There is **no** `.eq('status', …)` or `.neq('status', …)` on the trips query. Cancellation status is not filtered at fetch time.

**Raw query (client Supabase chain):**

```139:185:src/features/invoices/api/invoice-line-items.api.ts
  let query = supabase
    .from('trips')
    .select(
      `
      id,
      payer_id,
      scheduled_at,
      net_price,
      base_net_price,
      approach_fee_net,
      manual_gross_price,
      driving_distance_km,
      billing_variant_id,
      pickup_address,
      dropoff_address,
      kts_document_applies,
      no_invoice_required,
      link_type,
      linked_trip_id,
      driver:accounts!trips_driver_id_fkey(name),
      payer:payers(rechnungsempfaenger_id),
      billing_variant:billing_variants(
        id, code, name, billing_type_id, rechnungsempfaenger_id,
        billing_type:billing_types(name, rechnungsempfaenger_id)
      ),
      client:clients(id, first_name, last_name, price_tag, reference_fields)
    `
    )
    .eq('payer_id', params.payer_id)
    .gte('scheduled_at', params.period_from)
    .lte('scheduled_at', params.period_to + 'T23:59:59.999Z')
    .order('scheduled_at', { ascending: true });

  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }

  if (params.client_id) {
    query = query.eq('client_id', params.client_id);
  }

  const { data, error } = await query;
```

**Hook wiring:**

```106:114:src/features/invoices/hooks/use-invoice-builder.ts
      const { trips, clientPriceTags } = await fetchTripsForBuilder({
        payer_id: payerId,
        billing_type_id: step2Values?.billing_type_id,
        billing_variant_id: step2Values?.billing_variant_id,
        period_from: step2Values!.period_from,
        period_to: step2Values!.period_to,
        client_id: step2Values?.client_id
      });
      const items = buildLineItemsFromTrips(trips, rules, clientPriceTags);
```

**Summary:** Invoice builder trips = payer + date range (+ optional billing variant/type + optional client). **Cancelled trips are included if they match those filters.**

---

## Q2 — Cancelled trip status value

### Database / migrations

**Column:** `public.trips.status` (typed as `string` on generated DB types).

**Evidence for literal `'cancelled'`:** the driver-cancel RPC updates with lowercase `cancelled`:

```37:41:supabase/migrations/20260502120001_add_cancel_trip_as_driver_rpc.sql
  UPDATE public.trips
  SET
    status = 'cancelled',
    driver_id = NULL,
    notes = p_notes
  WHERE id = p_trip_id
```

Same pattern appears in dispatcher/recurring flows (e.g. `src/features/trips/api/recurring-exceptions.actions.ts` uses `status: 'cancelled'` on update — not repeated here; consistent with RPC).

No repo migration was found that adds a Postgres `CHECK` constraint enumerating allowed `trips.status` values; enforcement is application-level plus RPC guards (e.g. “cannot cancel if already `completed` / `cancelled`”).

### Frontend types / labels

```18:39:src/lib/trip-status.ts
/**
 * All possible trip status values.
 *
 * Kept in sync with the DB `trips.status` column.
 * ...
 *   cancelled  – driver or admin has cancelled; reason stored in notes
 */
export type TripStatus =
  | 'completed'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'driving'
  | 'cancelled'
  | 'pending'
  | 'open';
```

Generated Supabase row type:

```1298:1299:src/types/database.types.ts
          scheduled_at: string | null;
          status: string;
```

**Invoice-specific type:** `TripForInvoice` in `src/features/invoices/types/invoice.types.ts` **does not** include `status` — the invoice fetch simply never selects it, so TypeScript does not surface trip lifecycle on the builder path.

**Summary:** **`trips.status = 'cancelled'`** (lowercase) is the canonical cancelled value used in migrations and TS; invoice builder queries omit the column entirely.

---

## Q3 — Invoice amount calculation

**Primary location:** `buildLineItemsFromTrips` in `src/features/invoices/api/invoice-line-items.api.ts`, which delegates pricing to `resolveTripPricePure` (`resolve-trip-price`) after tax rate and pricing rule resolution.

**Per-trip unit/quantity and resolution:**

```250:275:src/features/invoices/api/invoice-line-items.api.ts
  const rawItems = trips.map((trip, index) => {
    const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);

    const rule = resolvePricingRule({
      rules,
      payerId: trip.payer_id,
      billingTypeId: trip.billing_variant?.billing_type_id ?? null,
      billingVariantId: trip.billing_variant_id,
      clientId: trip.client?.id ?? null,
      clientPriceTags
    });

    // manual_gross_price: persisted taxameter — P0 in resolveTripPrice (trips are SSOT).
    const priceResolution = resolveTripPricePure(
      {
        kts_document_applies: trip.kts_document_applies === true,
        net_price: trip.net_price ?? null,
        base_net_price: trip.base_net_price ?? null,
        manual_gross_price: trip.manual_gross_price ?? null,
        driving_distance_km: trip.driving_distance_km ?? null,
        scheduled_at: trip.scheduled_at,
        client: trip.client
      },
      taxRate,
      rule
    );
```

**Line totals on the builder row** use `priceResolution.unit_price_net` and `priceResolution.quantity` (and approach fee fields on the assembled `BuilderLineItem`).

**Invoice header totals** from current line items: `calculateInvoiceTotals` in the same file (used in `useInvoiceBuilder`).

**Persistence on create:** `insertLineItems` computes `total_price` per line from unit price, quantity, approach fee, tax — with a branch for gross-anchored client price tags (`isGrossAnchorClientPriceTag`).

**Summary:** Amounts are **computed** from trip pricing fields (`net_price` / `base_net_price` / `manual_gross_price`, client `price_tag`, rules, KTS flags, distance-based tax), not from a single raw `fare` column on the row for the builder select.

---

## Q4 — PDF-Vorlage wizard step

**File:** `src/features/invoices/components/invoice-builder/step-4-vorlage.tsx`  
**Component name:** `Step4Vorlage`

**Column selection data structure:**

- Local state: `customColumns: { main_columns: PdfColumnKey[]; appendix_columns: PdfColumnKey[] } | null` (lines 131–134).
- Catalog keys come from `pdf-column-catalog` (`MAIN_FLAT_COLUMNS` / `MAIN_GROUPED_COLUMNS`, `APPENDIX_COLUMNS`).
- Resolved profile type: `PdfColumnProfile` from `src/features/invoices/types/pdf-vorlage.types.ts` (`main_columns`, `appendix_columns`, `main_layout`, `appendix_is_landscape`, `source`).

**State management:**

- **Local:** React `useState` / `useEffect` inside `Step4Vorlage` for dropdown id, customize toggle, and column arrays.
- **Lifted to parent:** `invoice-builder/index.tsx` holds `builderColumnProfile` via `onColumnProfileChange={setBuilderColumnProfile}` (see `Step4Vorlage` props and shell comments lines 159–167 in `index.tsx`).
- **Ref for submit:** `onPdfOverrideChange` → `handlePdfOverridePersist` stores optional user override in `pdfOverrideRef` (only when “Spalten für diese Rechnung anpassen” is checked); preview always uses resolved profile from effects in `step-4-vorlage.tsx` (lines 182–207).

**Summary:** **`Step4Vorlage`** drives column UX; structure is **`main_columns` + `appendix_columns` (+ inherited `main_layout`)**; profile is **local + lifted + ref**, not TanStack Query or URL state.

---

## Q5 — Invoice table renderer (@react-pdf)

**Cover page body (main table):** `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` — imports `View`, `Text`, `Image` from `@react-pdf/renderer`.

**Grouped mode** — maps `summaryItems` (aggregated PDF summary rows):

```189:245:src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx
      {isGroupedMode
        ? summaryItems.map((item, idx) => (
            <View
              key={item.id}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {mainTableKeys.map((key, colIdx) => {
```

**Flat mode** — maps coerced line items:

```246:290:src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx
        : coercedFlatLineItems.map((lineItem, idx) => (
            <View
              key={lineItem.id}
              style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {mainTableKeys.map((key, colIdx) => {
```

**Invoice-level conditional (not per trip row):** Storno wording uses prop `isStorno` for intro/header text (`lines 122–125`, `149–151`).

**Appendix table:** `src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx` maps `coercedLineItems` and applies **row-level** styling when `item.kts_override === true` (muted currency + “Abgerechnet über KTS” note):

```182:182:src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx
      {coercedLineItems.map((item, idx) => renderLineItemRow(item, idx))}
```

**Summary:** Trip/table rows mirror **`line_items`** (flat) or **summary rows** (grouped). There is **no** branch on cancelled or void trips; **KTS override** is the main per-row special case in the appendix.

---

## Q6 — Invoice creation flow (wizard → DB → PDF)

**Entry:** `src/app/dashboard/invoices/new/page.tsx` → `<InvoiceBuilder … />`.

**Trips → line items (in-memory lock-in):** When Step 2 is complete, `useInvoiceBuilder` runs the trips query; on success **`setLineItems(buildLineItemsFromTrips(...))`** fixes the editable list for Step 3 onward (`use-invoice-builder.ts` lines 114–115). Commentary in `invoice-line-items.api.ts` describes line items as a **frozen snapshot** after building.

**Order of DB writes on submit (Section 5):**  
`Step4Confirm` `onConfirm` → `createInvoice(step4Values, snapshotOverride)` then, inside the mutation, **`await insertLineItems(invoice.id, lineItems)`** (`use-invoice-builder.ts` lines 256–266).

**Invoice header insert** (`createInvoice`): includes `pdf_column_override` (`invoices.api.ts` lines 281–306).

**PDF generation:** Issued PDFs resolve layout from stored `pdf_column_override` / payer Vorlage / defaults (outside this audit’s line-by-line trace); builder preview uses `useInvoiceBuilderPdfPreview` + `InvoicePdfDocument` with **`draftInvoice`** built from current `lineItems` and `builderColumnProfile`.

**Summary:** **Line items are fixed in React state after the trips query builds them** (until user edits Step 3). **First DB persistence** is **`invoices` insert**, then **`invoice_line_items` insert** — there is **no** intermediate table write for line items before that.

---

## Q7 — Existing filter/guard points (reuse candidates)

Examples that already treat **`cancelled`** explicitly (not exhaustive):

| Area | Path | Pattern |
|------|------|---------|
| Kanban visible columns | `src/features/invoices/components/kanban/kanban-board.tsx` | `effectiveTrips.filter((trip) => trip.status !== 'cancelled')` |
| Print / ZIP export | `src/features/trips/components/print-trips-button.tsx` | `.neq('status', 'cancelled')` and client-side filter |
| Pending assignments | `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | `.neq('status', 'cancelled')` |
| Client trips panel | `src/features/trips/components/client-trips-panel.tsx` | `.not('status', 'in', '(cancelled,completed)')` |
| Recurring overlap guard | `src/features/trips/api/recurring-rules.service.ts` | `.not('status', 'in', '(\"completed\",\"cancelled\")')` |
| Trip list URL filter | `src/features/trips/components/trips-listing.tsx` | `.eq('status', status)` / `.in('status', …)` when `status` param set |
| Urgency | `src/features/trips/lib/urgency-logic.ts` | Excludes completed/cancelled |

**Invoice builder:** **No** `status` guard on fetch (Q1). `no_invoice_required` is copied as **`no_invoice_warning`** on `BuilderLineItem` but is documented as advisory — it does **not** block billing (`invoice.types.ts` lines 389–391).

**Summary:** Many trip UIs/queries exclude **`cancelled`**; **invoice billing does not**.

---

## Q8 — Wizard state persistence (PDF columns)

**Template-level (company):** Rows in **`pdf_vorlagen`** — edited in settings (`PdfVorlagenSettingsPage`, `vorlage-editor-panel`, etc.). Payers carry **`pdf_vorlage_id`** (`new/page.tsx` prefetch).

**Per-invoice at creation:** On “Rechnung erstellen”, the shell **always** builds a **`PdfColumnOverridePayload`** snapshot (resolved columns + `main_layout`) and passes it to `createInvoice`, which persists **`invoices.pdf_column_override`** (`index.tsx` lines 671–688, `invoices.api.ts` line 305). Comment in `index.tsx` states intent: issued invoice PDF matches what the dispatcher saw (layout snapshot).

**Ephemeral vs DB:** Customize checkbox only controls whether **`pdfOverrideRef`** holds the **user-edited** column arrays before submit; either way **a full snapshot is written** on create. **`PdfColumnProfile.source`** distinguishes override vs payer vs company vs system — that’s resolver metadata for the preview, not a separate persisted wizard table.

**Summary:** **Column layout is persisted per invoice** (`pdf_column_override` + Vorlage FK on payer/template catalog). Wizard UI state is **session-local** except what gets merged into that snapshot at submit.

---

## RLS on `trips` (status)

**File:** `supabase/migrations/20260409170000_add_missing_rls.sql`

Policies **`trips_select_company_admin`**, **`trips_select_own_driver`**, etc., scope by **company / admin role / driver assignment** — **no predicate on `trips.status`**.

**Summary:** RLS does **not** hide cancelled trips from admins; excluding them for invoicing must be **application query logic** (or a new policy, which would be a breaking change for legitimate reads).

---

## Cursor’s Recommendation

**(a) Exclude cancelled trips from invoice billing (minimal / low-risk)**  

- Apply **one filter** at the canonical data boundary: **`fetchTripsForBuilder`** — e.g. `.neq('status', 'cancelled')` (or `.not('status', 'eq', 'cancelled')` per Supabase client conventions).  
- **Why here:** Every builder mode (`monthly`, `single_trip`, `per_client`) flows through this function; fixes totals, Step 3, inserts, and post-create `tripsService.updateTrip` side effects together.  
- **Risks / ambiguities:** If the product should still **list** cancelled trips in Step 3 with €0 or “Storniert” for audit, a blanket exclude changes UX — current code has no such list row; **confirm with product**. Edge case: **`single_trip`** mode still uses date range + payer — if two trips share a day, ensure dispatchers understand range semantics (pre-existing). Align literal with DB: **`'cancelled'`** (double-L).

**(b) “Cancelled trips” checkbox on PDF-Vorlage step**  

- **If the checkbox means “include cancelled rows on the PDF”:** You must **first** stop excluding them at fetch (or load them separately) and then **filter line items** for PDF/totals — higher complexity and legal/totals risk.  
- **If the checkbox means “show cancelled trips as informational lines (no charge)”:** Requires **fetching** cancelled rows and a **second channel** into PDF/summary (new column or appendix flag) without inflating `calculateInvoiceTotals` — scope is larger than a one-line filter.  
- **If the checkbox means “hide/show already-included rows that were cancelled after invoice draft”:** Impossible without re-querying trips at PDF time; today line items are **snapshots** — align expectations.  
- **UI fit:** `Step4Vorlage` already uses **checkboxes** for “Spalten für diese Rechnung anpassen”; a new option would need a **typed field** in `pdf_column_override` schema (`pdf-vorlage.types.ts` Zod) **or** separate invoice column if it affects billing, not just layout.

**Lowest-risk combination:** **Filter `cancelled` in `fetchTripsForBuilder`** and **defer** any “show stornierte Fahrten” checkbox until product defines whether it affects **totals**, **PDF only**, or **audit trail** — those differ materially.

---

*Audit generated from repository state; line numbers refer to the version read during the audit.*

---

## Implementation (2026-05-01)

The recommendations above were implemented:

- **`fetchTripsForBuilder`** applies **`.neq('status', CANCELLED_STATUS)`**; billing and line-item snapshots exclude cancelled trips.
- **`fetchCancelledTripsForBuilder`** mirrors filters with **`.eq('status', …)`** for **`CancelledTripRow`** only — never fed into totals or **`insertLineItems`**.
- **PDF-Vorlage (Step 4):** Checkbox + German copy; **`show_cancelled_trips`** is stored in **`invoices.pdf_column_override`** via the existing submit snapshot; **`PdfColumnProfile`** and **`resolvePdfColumnProfile`** carry the flag from parsed override JSON (**default false** for legacy rows).
- **Cover main table:** Muted informational rows appended when the flag is true and **`cancelledTrips`** are passed (builder preview today). **`TODO(issued-cancelled-rows)`** remains for invoice-detail PDF download/email until trips are refetched for issued invoices.
