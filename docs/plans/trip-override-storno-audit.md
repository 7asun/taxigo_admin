# Audit: Trip Override Persistence + Stornorechnung Branch Flow

Read-only audit (2026-06-05). **Implementation completed 2026-06-05** — see status table below.

**Sources read:** `src/types/database.types.ts` (trips Row), all `ALTER TABLE public.trips` / `public.invoices` migrations through `20260529080000`, `create_storno_invoice` / `replace_draft_invoice_line_items` RPCs, `invoices.api.ts`, `invoice-line-items.api.ts`, `use-invoice-builder.ts`, `invoice.types.ts`, `build-draft-invoice-detail-for-pdf.ts`, `step-3-line-items.tsx`, `trip-write-back.ts`, `storno.ts`, `map-line-item-row-to-builder-line-item.ts`, `invoice-actions.tsx`, `use-invoice.ts`, and a repo-wide case-insensitive `storno` search.

## Implementation status (2026-06-05)

| Item | Status | Migration / code |
|------|--------|------------------|
| `trips.manual_tax_rate` column | **Done** | `20260605120000_trips_manual_tax_rate.sql` |
| Write-back: `manual_tax_rate` only on tax override; never `trips.tax_rate` | **Done** | `trip-write-back.ts` + unit tests |
| `resolveEffectiveTaxRate` on invoice rebuild | **Done** | `resolve-effective-tax-rate.ts`, `invoice-line-items.api.ts` |
| `invoices.replaces_invoice_id` + unique index | **Done** | `20260605120100_invoices_replaces_invoice_id.sql` |
| `create_branch_draft_from_invoice` RPC | **Done** | `20260605120200_create_branch_draft_rpc.sql` |
| `createBranchDraft` API + hooks | **Done** | `invoices.api.ts`, `use-invoice.ts` |
| Detail UI: branch button + Storno guards | **Done** | `invoice-actions.tsx` |
| Edit route: branch bypasses revision flag | **Done** | `edit/page.tsx` |
| `trip_ids_matching_invoice_effective_status` RPC update | **Deferred** | — |
| Persist override badges on `invoice_line_items` | **Deferred** | — |
| Branch draft trip write-back policy | **Deferred** | create/edit still uses existing write-back |
| Abrechnung `cancelled` path cleanup | **Deferred** | — |

---

**Note on Step 3 path:** There is no `step-3-line-items/` directory. Step 3 is implemented as a single file: `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`.

**Note on `createInvoice` vs RPC:** `createInvoice()` does **not** call a Supabase RPC. It performs a direct `invoices` INSERT. Line items are inserted separately via `insertLineItems()` (direct `invoice_line_items` INSERT). The only invoice-related RPCs in the create/edit/storno paths are `replace_draft_invoice_line_items` (draft save) and `create_storno_invoice` (Storno).

---

## Section A — Current `trips` table schema

### A1. All columns on `trips`

There is **no `CREATE TABLE trips` migration** in `supabase/migrations/` (the table predates tracked migrations). The authoritative current shape is `Database['public']['Tables']['trips']['Row']` in `src/types/database.types.ts` (lines 1452–1530), augmented by migration comments below.

| Column | Type (Postgres) | Nullable | Default / generated |
|--------|-----------------|----------|---------------------|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `company_id` | `uuid` | nullable | — |
| `status` | `text` | NOT NULL | (required on insert; no DB default in types) |
| `scheduled_at` | `timestamptz` | nullable | — |
| `requested_date` | `date` | nullable | — |
| `created_at` | `timestamptz` | nullable | `now()` (typical) |
| `created_by` | `text` | nullable | — |
| `driver_id` | `uuid` | nullable | FK → accounts |
| `vehicle_id` | `uuid` | nullable | — |
| `client_id` | `uuid` | nullable | — |
| `client_name` | `text` | nullable | — |
| `client_phone` | `text` | nullable | — |
| `payer_id` | `uuid` | nullable | — |
| `billing_variant_id` | `uuid` | nullable | FK → billing_variants |
| `billing_type_id` | `uuid` | nullable | FK → billing_types (legacy; variant is primary) |
| `billing_betreuer` | `text` | nullable | — |
| `billing_calling_station` | `text` | nullable | — |
| `rule_id` | `uuid` | nullable | recurring rule FK |
| `group_id` | `uuid` | nullable | — |
| `linked_trip_id` | `uuid` | nullable | — |
| `link_type` | `text` | nullable | — |
| `return_status` | `text` | nullable | — |
| `stop_order` | `integer` | nullable | — |
| `stop_updates` | `jsonb` | NOT NULL | (required on insert in types) |
| `pickup_address` | `text` | nullable | — |
| `pickup_street` | `text` | nullable | — |
| `pickup_street_number` | `text` | nullable | — |
| `pickup_zip_code` | `text` | nullable | — |
| `pickup_city` | `text` | nullable | — |
| `pickup_lat` | `double precision` | nullable | — |
| `pickup_lng` | `double precision` | nullable | — |
| `pickup_location` | `jsonb` | nullable | — |
| `pickup_station` | `text` | nullable | — |
| `pickup_place_id` | `text` | nullable | — |
| `dropoff_address` | `text` | nullable | — |
| `dropoff_street` | `text` | nullable | — |
| `dropoff_street_number` | `text` | nullable | — |
| `dropoff_zip_code` | `text` | nullable | — |
| `dropoff_city` | `text` | nullable | — |
| `dropoff_lat` | `double precision` | nullable | — |
| `dropoff_lng` | `double precision` | nullable | — |
| `dropoff_location` | `jsonb` | nullable | — |
| `dropoff_station` | `text` | nullable | — |
| `dropoff_place_id` | `text` | nullable | — |
| `driving_distance_km` | `double precision` / `numeric` | nullable | routing provider value |
| `driving_duration_seconds` | `integer` | nullable | — |
| `manual_distance_km` | `double precision` | nullable | admin KM override (Phase 1 manual KM) |
| `base_net_price` | `numeric` | nullable | transport net component |
| `approach_fee_net` | `numeric` | nullable | Anfahrt net |
| **`net_price`** | `numeric(10,4)` | NOT NULL | **GENERATED ALWAYS AS** `COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0)` STORED — read-only |
| `gross_price` | `numeric` | nullable | — |
| `tax_rate` | `numeric` | nullable | e.g. 0.07 / 0.19 |
| `manual_gross_price` | `numeric` | nullable | taxameter / admin gross |
| `greeting_style` | `text` | nullable | — |
| `is_wheelchair` | `boolean` | NOT NULL | default `false` (typical) |
| `needs_driver_assignment` | `boolean` | NOT NULL | — |
| `has_missing_geodata` | `boolean` | NOT NULL | — |
| `kts_document_applies` | `boolean` | NOT NULL | — |
| `kts_source` | `text` | nullable | — |
| `kts_fehler` | `boolean` | NOT NULL | — |
| `kts_fehler_beschreibung` | `text` | nullable | — |
| `reha_schein` | `boolean` | NOT NULL | — |
| `no_invoice_required` | `boolean` | NOT NULL | — |
| `no_invoice_source` | `text` | nullable | — |
| `fremdfirma_id` | `uuid` | nullable | — |
| `fremdfirma_cost` | `numeric` | nullable | — |
| `fremdfirma_payment_mode` | `text` | nullable | — |
| `selbstzahler_collected_amount` | `numeric` | nullable | — |
| `payment_method` | `text` | nullable | — |
| `note` | `text` | nullable | — |
| `notes` | `text` | nullable | — |
| `canceled_reason_notes` | `text` | nullable | — |
| `actual_pickup_at` | `timestamptz` | nullable | — |
| `actual_dropoff_at` | `timestamptz` | nullable | — |
| `ingestion_source` | `text` | nullable | — |

Key migrations that shaped pricing / KM columns:

- `20260418120000_trips-price-schema.sql` — renamed `price` → `net_price`, added `gross_price`, `tax_rate`, `billing_type_id`
- `20260424100000_add_trip_price_split.sql` — `base_net_price`, `approach_fee_net`
- `20260425120000_net_price_generated.sql` — `net_price` became generated STORED column
- `20260423100000_add_trip_manual_gross_price.sql` — `manual_gross_price`
- `20260505180000_manual_km_overrides_foundation.sql` — `manual_distance_km`

### A2. Existing `_override` columns on `trips`

**Confirmed absent.** There are no columns named `distancekm_override`, `price_override`, `taxrate_override`, or any other `*_override` suffix on `trips`.

The closest existing concepts:

| User intent | Actual column / mechanism |
|-------------|-------------------------|
| KM override | `manual_distance_km` (nullable `double precision`) |
| Gross / taxameter override | `manual_gross_price` (nullable `numeric`) |
| Tax rate | `tax_rate` (nullable `numeric`) — not a separate override column |
| Client-level KM catalog | `client_km_overrides` table (not on `trips`) |

### A3. Database view or computed “effective” column on `trips`

**No view and no effective-distance computed column on `trips`.**

- **`net_price`** is the only generated column: `COALESCE(base_net_price,0) + COALESCE(approach_fee_net,0)` (`20260425120000_net_price_generated.sql`).
- **Effective distance** is resolved **in application code** via `resolveEffectiveDistanceKm()` in `src/features/invoices/lib/resolve-effective-distance.ts`:
  1. `trips.manual_distance_km`
  2. matching row in `client_km_overrides`
  3. `trips.driving_distance_km`
- The only SQL function relating trips to invoices is **`trip_ids_matching_invoice_effective_status(p_effective text)`** (`20260411140000_trip_ids_matching_invoice_effective_status.sql`) — it filters trips by **invoice status** via `invoice_line_items` joins, not by effective KM/price.

### A4. Foreign key from `trips` back to `invoices`

**No.** `trips` has **no `invoice_id` column** and no FK to `invoices`.

Linkage is **inverse only**:

- `invoice_line_items.trip_id` → `trips.id` (nullable, informational snapshot source)
- A migration comment on `invoice_line_items.trip_id` mentions a **future** `trips.invoice_id` for double-billing prevention — **not implemented** (`20260331130000_create_invoice_line_items.sql`, lines 154–155)

**When is linkage set?**

- At **invoice creation time**: `insertLineItems()` writes `trip_id` on each line item row.
- **Never** on trip fetch: `fetchTripsForBuilder()` does not set any invoice FK on trips.
- Trip “invoiced?” state is derived at read time from `invoice_line_items` + `invoices.status` (badge RPC, not a trip column).

---

## Section B — Invoice creation RPC and override handling

### B5. Exact Supabase RPC name used by `createInvoice`

**None.** `createInvoice()` in `src/features/invoices/api/invoices.api.ts` (lines 249–338) calls:

```typescript
supabase.from('invoices').insert({ ... }).select().single()
```

Related RPCs in the invoice lifecycle:

| Operation | Mechanism |
|-----------|-----------|
| Create header | Direct INSERT (`createInvoice`) |
| Create line items | Direct INSERT (`insertLineItems`) |
| Save draft edits | **`replace_draft_invoice_line_items(p_invoice_id uuid, p_line_items jsonb)`** → `RETURNS void` |
| Storno | **`create_storno_invoice(...)`** → `RETURNS uuid` (full signature in `20260528062000_invoice_line_items_billing_inclusion.sql` / `20260411120000_storno_atomic_rpc.sql`) |

`create_storno_invoice` signature (22 args):

```sql
CREATE OR REPLACE FUNCTION public.create_storno_invoice(
  p_company_id                        UUID,
  p_invoice_number                    TEXT,
  p_payer_id                          UUID,
  p_billing_type_id                   UUID,
  p_billing_variant_id                UUID,
  p_mode                              TEXT,
  p_client_id                         UUID,
  p_period_from                       DATE,
  p_period_to                         DATE,
  p_subtotal                          NUMERIC,
  p_tax_amount                        NUMERIC,
  p_total                             NUMERIC,
  p_notes                             TEXT,
  p_payment_due_days                  INTEGER,
  p_cancels_invoice_id                UUID,
  p_rechnungsempfaenger_id            UUID,
  p_rechnungsempfaenger_snapshot      JSONB,
  p_client_reference_fields_snapshot  JSONB,
  p_pdf_column_override               JSONB,
  p_original_invoice_id               UUID,
  p_line_items                        JSONB
) RETURNS UUID
```

### B6. Does the RPC write per-trip values back to `trips`?

**No RPC writes to `trips`.**

- `create_storno_invoice` — inserts Storno header + line items; updates original invoice to `corrected`. **No trip UPDATE.**
- `replace_draft_invoice_line_items` — replaces `invoice_line_items`; recomputes header totals. **No trip UPDATE.**

Per-trip persistence after invoice save happens **outside** any RPC, in TypeScript:

`executeTripWriteBack()` → `tripsService.updateTrip()` (`src/features/invoices/lib/trip-write-back.ts`).

### B7. Payload `createInvoice` sends to Supabase

`CreateInvoicePayload` fields consumed by `createInvoice()`:

| Field | Source |
|-------|--------|
| `companyId` | Builder shell |
| `formValues.payer_id` | Step 2 |
| `formValues.billing_type_id` | Step 2 (only when `mode === 'per_client'`, else forced `null`) |
| `formValues.billing_variant_id` | Step 2 |
| `formValues.mode` | Step 1 |
| `formValues.client_id` | Step 2 |
| `formValues.period_from` / `period_to` | Step 2 |
| `formValues.intro_block_id` / `outro_block_id` | Step 4 (resolved `'none'` → `null`) |
| `formValues.payment_due_days` | Step 4 |
| `subtotal`, `taxAmount`, `total` | Client-computed from `calculateInvoiceTotals()` |
| `rechnungsempfaengerId` | Step 4 or catalog cascade |
| `pdfColumnOverride` | Step 4 Vorlage (validated JSON or null) |

Also computed inside `createInvoice()` (not in payload):

- `invoice_number` via `generateNextInvoiceNumber()`
- `rechnungsempfaenger_snapshot` from live recipient row
- `client_reference_fields_snapshot` from live `clients.reference_fields`
- `status: 'draft'`

**Per-line override values are NOT in the `createInvoice` payload.** They are persisted in a **second step**:

`insertLineItems(invoiceId, lineItems, optedInCancelledTrips)` serializes each `BuilderLineItem` via `lineItemToInsertRow()`:

| Persisted column | Override / pricing source |
|------------------|---------------------------|
| `distance_km` | snapshot of `trips.driving_distance_km` |
| `effective_distance_km` | builder `effective_distance_km` (after KM override) |
| `original_distance_km` | builder `original_distance_km` |
| `unit_price`, `quantity`, `tax_rate`, `approach_fee_net` | builder state after overrides |
| `total_price` | computed from frozen `price_resolution` |
| `price_resolution_snapshot` | full `PriceResolution` JSON (includes gross/net/strategy) |
| `pricing_strategy_used`, `pricing_source`, `kts_override` | from resolution |
| `billing_included`, `billing_exclusion_reason` | Step 3 inclusion |
| `trip_meta_snapshot` | trip PDF meta |

**Builder-only flags NOT persisted:** `isManualOverride`, `manualGrossTotal`, `manualApproachFeeGross`, `isManualKmOverride`, `manualDistanceKm`, `isManualTaxRateOverride`, `resolved_rule`, `originalPriceResolution`.

### B8. Where override values live in React state (`useInvoiceBuilder`)

State: `const [lineItems, setLineItems] = useState<BuilderLineItem[]>([])`.

**KM override** — `applyKmOverride(position, km)` (lines 509–575):

- Sets `effective_distance_km`, `manualDistanceKm`, `isManualKmOverride: true`
- Reprices via `resolveTripPricePure` (except taxameter branch)
- Updates `tax_rate`, `unit_price`, `quantity`, `approach_fee_*`, `price_resolution`

**Gross override** — `applyGrossOverride(position, grossTotal, approachFeeGross)` (lines 453–481):

- Sets `manualGrossTotal`, `manualApproachFeeGross`, `isManualOverride: true`
- Patches `price_resolution` via `applyGrossOverrideToResolution`

**Tax rate override** — `applyTaxRateOverride` → `patchLineItemForTaxRateOverride` (lines 606–617, `apply-tax-rate-override.ts`):

- Sets `tax_rate`, `isManualTaxRateOverride`
- Reprices per gross-anchor vs net-anchor rules

**Example state shape** after KM + gross overrides on one line:

```typescript
// Subset of BuilderLineItem — see invoice.types.ts lines 541–711
{
  trip_id: 'uuid',
  position: 1,
  effective_distance_km: 42.5,      // committed KM
  original_distance_km: 38.2,       // routing snapshot
  manualDistanceKm: 42.5,
  isManualKmOverride: true,
  tax_rate: 0.07,                   // may change with KM or tax Select
  isManualTaxRateOverride: false,   // true if dispatcher changed Select
  unit_price: 12.34,
  quantity: 42.5,
  approach_fee_net: 3.50,
  approach_fee_gross: 3.75,
  manualGrossTotal: 89.90,
  manualApproachFeeGross: 4.00,
  isManualOverride: true,
  price_resolution: { /* PriceResolution */ },
  originalPriceResolution: { /* pre-override snapshot */ },
  resolved_rule: { /* BillingPricingRuleLike | null */ },
  billingInclusion: { included: true, reason: '' },
  // ... display snapshots, warnings, etc.
}
```

Full type: `BuilderLineItem` in `src/features/invoices/types/invoice.types.ts` (lines 541–711).

### B9. Post-`createInvoice` writes to `trips`

**Yes — but not inside `createInvoice` or any RPC.** After successful header + line insert:

```typescript
const syncFailures = await executeTripWriteBack(lineItems);
```

(`use-invoice-builder.ts` lines 983–986 create path; 1077–1078 update path)

`buildTripWriteBackPatch()` writes to **`trips`** for each **billing-included** line with non-null `trip_id`:

| Trip column | When set |
|-------------|----------|
| `gross_price` | Always (from `manualGrossTotal` or display gross) |
| `tax_rate` | Always |
| `base_net_price` | From `price_resolution.net` |
| `approach_fee_net` | From line item |
| `manual_gross_price` | Only if `isManualOverride && manualGrossTotal != null` |
| `manual_distance_km` | Only if `isManualKmOverride && manualDistanceKm != null` |

Implementation: `tripsService.updateTrip()` → `supabase.from('trips').update(trip).eq('id', id)` (`trips.service.ts` lines 138–143).

**Not written:** separate override columns; `net_price` (generated — must not be in patch); `driving_distance_km` (routing SSOT, never overwritten by invoice flow).

Failures are collected in `syncFailedItems` for retry dialog; invoice row is **not** rolled back.

**Other `.from('trips').update()` in codebase** (not invoice create chain): bulk upload, driver assignment, reschedule, recurring exceptions, shift reconciliation, etc.

---

## Section C — Invoice status and Stornorechnung

### C10. Possible `invoices.status` values

From DB CHECK constraint (`20260331120000_create_invoices.sql` lines 80–81) and `InvoiceStatus` type:

| Value | Meaning |
|-------|---------|
| `draft` | Entwurf — editable when payer flag allows |
| `sent` | Versendet |
| `paid` | Bezahlt |
| `cancelled` | Storniert (legacy direct status update; see C12) |
| `corrected` | Original invoice after Stornorechnung RPC |

Default on INSERT: `'draft'`.

### C11. Stornorechnung / cancellation columns on `invoices`

| Column | Purpose |
|--------|---------|
| `cancels_invoice_id` | UUID FK → `invoices.id` — set on **Stornorechnung** row pointing to cancelled original |
| `cancelled_at` | Timestamp — set on **original** when Storno RPC runs (`corrected`) |
| `sent_at`, `paid_at` | Lifecycle timestamps for forward transitions |
| `notes` | Storno document includes auto-generated storno text |

**Absent:** `storno_invoice_id`, `parent_invoice_id`, `invoice_type`, `replaces_invoice_id`, `branch_of_invoice_id`, `revision_of_invoice_id`.

Storno identity is inferred by:

```sql
SELECT * FROM invoices WHERE cancels_invoice_id = '<original_id>';
```

There is **no** reverse FK on the original pointing to the Storno row.

### C12. Existing UI / route / hook for cancelling a sent invoice

**Yes — Stornorechnung flow (primary path).**

| Layer | Location | Behaviour |
|-------|----------|-----------|
| UI | `invoice-detail/invoice-actions.tsx` | “Stornieren” for `draft` and `sent`; confirm dialog |
| Hook | `useCreateStornorechnung()` in `use-invoice.ts` | Calls `createStornorechnung()` |
| Service | `src/features/invoices/lib/storno.ts` | Negates amounts in TS; single `create_storno_invoice` RPC |
| RPC | `create_storno_invoice` | Atomic: insert Storno (`status=draft`, negated totals), insert negated line items, set original `status=corrected`, `cancelled_at=now()` |

**Flow detail:**

1. User confirms Storno on detail page.
2. `generateNextInvoiceNumber()` in TS for Storno number.
3. Line items negated (`unit_price`, `total_price`, `approach_fee_net`, `price_resolution_snapshot` numeric fields).
4. RPC validates original `status IN ('draft','sent')`.
5. Original becomes **`corrected`** (not `cancelled`).
6. New Storno invoice is **`draft`** with `cancels_invoice_id = original.id`.
7. **No branch / replacement draft invoice** is created automatically.

**Secondary / inconsistent path:** `updateInvoiceStatus('cancelled')` exists (`invoices.api.ts` lines 446–487) and is used from `abrechnung-recent-invoices.tsx` — marks `cancelled` **without** creating Stornorechnung. Detail page Storno button does **not** use this.

**Draft re-open (not Storno):** `/dashboard/invoices/[id]/edit` when `status=draft` and `payers.revision_invoices_enabled=true` — edits same draft via `replace_draft_invoice_line_items`, not a new invoice branch.

### C13. Self-referencing FK on `invoices`

**Yes:** `cancels_invoice_id UUID REFERENCES public.invoices(id)`.

- Set on **Stornorechnung** rows only.
- NULL on normal invoices.
- One direction: Storno → original. No `ON DELETE` cascade documented beyond default.

---

## Section D — Line item state shape for branch creation

### D14. Complete in-memory `BuilderLineItem` at save time

At `createMutation` completion, normal lines are passed as `BuilderLineItem[]` to `insertLineItems()`. The TypeScript type is **`BuilderLineItem`** (`invoice.types.ts` lines 541–711). Serialized insert shape is `lineItemToInsertRow()` output (not identical — builder-only fields stripped).

Core persisted-relevant fields at RPC/insert moment:

```typescript
interface BuilderLineItem {
  trip_id: string | null;
  position: number;
  line_date: string | null;
  description: string;
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_km: number | null;
  effective_distance_km: number | null;
  original_distance_km: number | null;
  manual_km_enabled?: boolean;
  manualDistanceKm?: number | null;
  isManualKmOverride?: boolean;
  unit_price: number | null;
  approach_fee_net: number | null;
  approach_fee_gross?: number | null;
  quantity: number;
  tax_rate: number;
  isManualTaxRateOverride?: boolean;
  billing_variant_code: string | null;
  billing_variant_name: string | null;
  billing_type_name: string | null;
  kts_document_applies: boolean;
  no_invoice_warning: boolean;
  is_wheelchair: boolean;
  price_resolution: PriceResolution;
  resolved_rule?: BillingPricingRuleLike | null;
  kts_override: boolean;
  trip_meta: TripMetaSnapshot | null;
  price_source: 'client_price_tag' | 'trip_price' | null;
  warnings: LineItemWarning[];
  billingInclusion: BillingInclusionState;
  originalPriceResolution?: PriceResolution;
  manualGrossTotal?: number | null;
  manualApproachFeeGross?: number | null;
  isManualOverride?: boolean;
}
```

Opted-in cancelled trips use **`BuilderCancelledTripRow`** (extends `CancelledTripRow`) — appended via `cancelledTripToInsertRow()`.

### D15. Duplicate / copy / clone / branch invoice functionality

**No invoice duplicate, copy, clone, or branch feature exists** in `src/features/invoices/`.

Search findings:

| Term | Invoice-related result |
|------|------------------------|
| `duplicate` | Trip duplication (`duplicate-trips.ts`); billing fetch “branch” enum — unrelated |
| `copy` | `client_reference_fields_snapshot` “frozen copy”; email draft copy button |
| `clone` | None in invoices feature |
| `branch` | Only `BillingVariantFetchBranch` type in trip fetch planner |
| `revision` | **`revision_invoices_enabled`** payer flag — re-open **same** draft, not copy |

Storno creates a **negating** invoice, not a corrective replacement draft pre-filled for editing.

### D16. Edit-mode line item hydration (`invoiceId` prop)

**Data path: persisted snapshot on `invoice_line_items`, not live trips.**

1. `useInvoiceBuilder(..., invoiceId)` sets `isEditMode = true`.
2. `getInvoiceDetail(invoiceId)` loads `invoices.*` + `invoice_line_items(*)` + payer join (`invoiceKeys.full`).
3. **Trips are NOT re-fetched** for pricing (`tripsQuery` disabled when `isEditMode`).
4. Each normal line: `mapLineItemRowToBuilderLineItem(row, mapCtx)` — inverts `lineItemToInsertRow`.
5. `price_resolution` restored from **`price_resolution_snapshot`** (not recomputed from trips).
6. `resolved_rule` reconstructed from **live** `billing_pricing_rules` for payer (for KM repricing in edit).
7. `is_wheelchair` batch-fetched from **`trips.is_wheelchair`** only (not on line items).
8. Cancelled lines: `mapLineItemRowToBuilderCancelledTrip`.
9. Save: `updateDraftInvoice()` → `replace_draft_invoice_line_items` RPC + meta UPDATE.

**Explicit design comment** in hook (lines 439–441): re-running `buildLineItemsFromTrips` on load would silently recompute from mutable trips — intentionally avoided.

---

## Section E — Senior recommendation

### E1. Lowest-risk way to add trip override columns + RPC writeback

**Recommendation: extend existing columns rather than add parallel `*_override` triplets.**

The codebase already persists admin intent via:

- `manual_distance_km` (KM)
- `manual_gross_price` + price split fields (gross/tax)
- `tax_rate`, `base_net_price`, `approach_fee_net`, `gross_price`

Adding `distancekm_override`, `price_override`, `taxrate_override` would **duplicate** semantics and force every reader (`resolveEffectiveDistanceKm`, trip listing, price engine, controlling RPCs) to choose between raw vs override.

**Lower-risk approach:**

1. **Keep** `driving_distance_km` as immutable routing SSOT (already invariant).
2. **Keep** `manual_distance_km` as the KM override column (already written by `executeTripWriteBack`).
3. **Keep** invoice-confirmed pricing on `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net`, `manual_gross_price`.
4. If audit requires explicit “override vs raw” flags, add **boolean markers** (`km_override_active`, etc.) rather than parallel value columns — or persist override metadata in a single `pricing_override_jsonb` on trips.

**Migration risks if new override columns duplicate existing fields:**

| Risk | Detail |
|------|--------|
| Split-brain reads | Many paths read `driving_distance_km` or `net_price` directly (dashboard, CSV, driver portal, controlling RPCs). New columns invisible until every reader updated. |
| Generated `net_price` | Writes must target `base_net_price` + `approach_fee_net` only; never `net_price`. |
| Write path already exists | `executeTripWriteBack` post-insert — moving writes into an RPC is optional; current fire-and-forget pattern already updates trips without blocking invoice commit. |
| Edit-mode hydration | Line items come from snapshots; trip columns affect **future** invoice builds, not open draft reload. |

If the goal is “RPC writes overrides at invoice creation”: **`createInvoice` has no RPC today.** Lowest change is either (a) extend `executeTripWriteBack` / `buildTripWriteBackPatch` (current pattern), or (b) add a small `sync_trip_pricing_from_invoice_line_items` SECURITY DEFINER RPC called after line insert — mirroring `replace_draft_invoice_line_items` auth guards.

### E2. Stornorechnung + branch flow — cleanest atomic backend operation

**Current state:** Storno is atomic (`create_storno_invoice`) but **ends** with Storno draft + original `corrected`. **No replacement draft.**

**Desired flow (a+b+c):**

| Step | Today | Gap |
|------|-------|-----|
| (a) Mark original storniert | Original → `corrected` + `cancelled_at` | No `cancelled` status on original in primary path |
| (b) Create Stornorechnung | Yes — negated draft with `cancels_invoice_id` | Works |
| (c) New draft from cancelled invoice lines | **Missing entirely** | No RPC, no UI, no schema link |

**Recommended atomic operation:** new RPC e.g. `storno_and_branch_invoice(p_original_id, p_line_items_positive jsonb, p_meta jsonb)` that in one transaction:

1. Validates original `status IN ('sent')` (and optionally `draft` if product allows).
2. Inserts Stornorechnung (negated lines) — reuse `create_storno_invoice` logic inline or call it via internal helper.
3. Sets original to `corrected` (keep current semantics for §14 audit trail).
4. Inserts **new** invoice header (`status=draft`) + **positive** line items cloned from original snapshots (or from supplied JSON).
5. Returns `{ storno_id, branch_draft_id }`.

**Schema additions likely needed:**

| Addition | Purpose |
|----------|---------|
| `invoices.replaces_invoice_id uuid REFERENCES invoices(id)` or `branched_from_invoice_id` | Link corrective draft to storniert original (inverse of `cancels_invoice_id`) |
| Optional `invoices.invoice_kind text CHECK (...)` | Distinguish `standard` / `storno` / `branch` for list filters |
| Persist `is_manual_gross_override boolean` on `invoice_line_items` | Fix known RPC totals drift for manual gross overrides (deferred in `replace_draft_invoice_line_items` comments) |
| Optional `storno_invoice_id` on original | Convenience reverse lookup (denormalized; can query `cancels_invoice_id` instead) |

**Pre-population source:** Use **`invoice_line_items` snapshots** (same as edit-mode hydration), **not** live `trips` — preserves §14 immutability and override values frozen at issue time.

### E3. Patterns to follow vs conflicts

**Follow / extend:**

| Pattern | Use for new work |
|---------|------------------|
| `create_storno_invoice` | Atomic multi-table invoice writes, SECURITY DEFINER + `current_user_is_admin()` |
| `replace_draft_invoice_line_items` | Draft line swap + server-side totals; JSONB line shape shared with Storno |
| `lineItemToInsertRow` / `mapLineItemRowToBuilderLineItem` | Round-trip builder ↔ DB |
| `executeTripWriteBack` + `TripWriteBackPatch` | Trip SSOT after invoice confirmation |
| `manual_distance_km` / `manual_gross_price` | Admin override persistence (already shipped) |
| `payers.revision_invoices_enabled` | Per-payer feature gating precedent |
| `invoice_line_items.price_resolution_snapshot` | Legal frozen pricing; branch should copy verbatim |

**Conflicts / gaps:**

| Issue | Impact |
|-------|--------|
| `createInvoice` client-side totals | Header totals not verified server-side on create (only on draft **update** RPC) |
| Builder-only override flags not persisted | Branch/hydration cannot restore “Manuell” badge or gross-anchor totals edge cases |
| `updateInvoiceStatus('cancelled')` without Storno | Abrechnung widget inconsistent with detail Storno |
| `trip_ids_matching_invoice_effective_status` ignores `corrected` | After Storno, trips may still show as invoiced via old line items |
| No `trips.invoice_id` | Double-billing prevention relies on line-item existence checks only |
| Storno RPC `create_storno_invoice` eligibility includes `draft` | Storno-of-draft may be intentional for Entwurf discard; branch flow must define rules |

### E4. Single highest-risk part + de-risk plan

**Highest risk: Storno + branch atomicity combined with trip write-back and invoicing-status semantics.**

Creating three linked documents (original corrected, Storno negation, branch draft) while trips still reference old line items via `invoice_line_items.trip_id` creates:

- **Double counting** in revenue KPIs if branch draft lines duplicate trip linkage before original is excluded from “open invoice” logic.
- **Trip badge / filter wrong state** — `trip_ids_matching_invoice_effective_status` treats any `draft`/`sent`/`paid` line as invoiced; a branch draft would block re-invoicing trips unless status rules change.
- **Write-back race** — branch might re-run `executeTripWriteBack` with different values than the storniert invoice unless trip pricing is explicitly reconciled.

**De-risk:**

1. **Ship schema link first** (`replaces_invoice_id` + document kinds) without UI.
2. **Extend trip invoiced-status RPC** to exclude trips whose only active invoices are `corrected` originals, or exclude branch drafts until sent.
3. **Implement branch RPC** by copying `invoice_line_items` rows in SQL (positives from original, negatives in Storno) — single transaction, no live trip reads.
4. **Define trip write-back policy** for branch: either skip write-back on branch creation (trips already updated at original issue) or idempotent re-sync from branch lines only.
5. **Integration test matrix:** sent invoice with KM + gross + tax overrides → Storno → branch draft → verify totals, PDF snapshots, trip columns, and trip list badge.
6. **Remove or gate** legacy `cancelled` status path when Storno+branch ships.

---

## Appendix — Storno-related files (repo-wide `storno` search)

| File | Relevance |
|------|-----------|
| `src/features/invoices/lib/storno.ts` | **Primary** — builds negated payload, calls RPC |
| `supabase/migrations/20260411120000_storno_atomic_rpc.sql` | Initial RPC |
| `supabase/migrations/20260505180000_manual_km_overrides_foundation.sql` | RPC update — distance snapshot cols |
| `supabase/migrations/20260528062000_invoice_line_items_billing_inclusion.sql` | RPC update — billing inclusion cols |
| `src/features/invoices/hooks/use-invoice.ts` | `useCreateStornorechnung` |
| `src/features/invoices/components/invoice-detail/invoice-actions.tsx` | Storno UI |
| `src/features/invoices/types/invoice.types.ts` | Status machine, `cancels_invoice_id` |
| `src/features/invoices/components/invoice-pdf/*` | Storno PDF labelling |
| `docs/invoices-module.md`, `docs/plans/revision-invoice-audit.md`, `docs/plans/invoice-revision-workflow-audit.md` | Prior audits |
| Trip cancel UI (`recurring-trip-cancel-dialog`, `cell-action`) | Trip cancellation — **not** invoice Storno |

---

## Appendix — Override handler trace summary

| Handler | State mutations | Persisted to Supabase outside RPC |
|---------|-----------------|-----------------------------------|
| `applyKmOverride` | `effective_distance_km`, `manualDistanceKm`, `isManualKmOverride`, repriced fields | **`trips.manual_distance_km`** via write-back; **`invoice_line_items.effective_distance_km`** via insert/update |
| `applyGrossOverride` | `manualGrossTotal`, `isManualOverride`, patched `price_resolution` | **`trips.manual_gross_price`**, `gross_price`, `base_net_price`, etc. via write-back; snapshot via `price_resolution_snapshot` |
| `applyTaxRateOverride` | `tax_rate`, `isManualTaxRateOverride`, repriced fields | **`trips.manual_tax_rate`** via write-back when override flag set; **`trips.tax_rate` never written**; line `tax_rate` + snapshot |

None of these handlers call Supabase directly; persistence is **`insertLineItems` / `replace_draft_invoice_line_items`** (line snapshots) plus **`executeTripWriteBack`** (trip row patch after save).
