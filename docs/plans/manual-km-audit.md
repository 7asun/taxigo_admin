# Audit — Manual KM Override System

Read-only audit. Sources: Supabase migrations, generated `database.types.ts`, invoice builder, pricing resolution, PDF pipeline, and `driving_distance_km` usage inventory.

---

## 1. Schema & Data Model — `trips` columns and KM-related fields

**Finding:** There is no `CREATE TABLE public.trips` in the tracked `supabase/migrations/` snapshot; the **authoritative column set for this repo** is the generated Supabase types.

**Exact snippet (`src/types/database.types.ts` — `trips.Row`):**

```1243:1319:src/types/database.types.ts
      trips: {
        Row: {
          actual_dropoff_at: string | null;
          actual_pickup_at: string | null;
          billing_betreuer: string | null;
          billing_calling_station: string | null;
          billing_variant_id: string | null;
          kts_document_applies: boolean;
          kts_fehler: boolean;
          kts_fehler_beschreibung: string | null;
          kts_source: string | null;
          fremdfirma_cost: number | null;
          fremdfirma_id: string | null;
          fremdfirma_payment_mode: string | null;
          no_invoice_required: boolean;
          no_invoice_source: string | null;
          selbstzahler_collected_amount: number | null;
          client_id: string | null;
          client_name: string | null;
          client_phone: string | null;
          company_id: string | null;
          created_at: string | null;
          created_by: string | null;
          driver_id: string | null;
          dropoff_address: string | null;
          dropoff_lat: number | null;
          dropoff_lng: number | null;
          dropoff_city: string | null;
          dropoff_street: string | null;
          dropoff_street_number: string | null;
          dropoff_zip_code: string | null;
          driving_distance_km: number | null;
          driving_duration_seconds: number | null;
          dropoff_location: Json | null;
          dropoff_station: string | null;
          dropoff_place_id: string | null;
          greeting_style: string | null;
          has_missing_geodata: boolean;
          group_id: string | null;
          id: string;
          ingestion_source: string | null;
          is_wheelchair: boolean;
          link_type: string | null;
          linked_trip_id: string | null;
          note: string | null;
          notes: string | null;
          needs_driver_assignment: boolean;
          canceled_reason_notes: string | null;
          payer_id: string | null;
          payment_method: string | null;
          pickup_address: string | null;
          pickup_lat: number | null;
          pickup_lng: number | null;
          pickup_city: string | null;
          pickup_street: string | null;
          pickup_street_number: string | null;
          pickup_zip_code: string | null;
          pickup_location: Json | null;
          pickup_station: string | null;
          pickup_place_id: string | null;
          /** Generated STORED: COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0). Read-only; omit from writes. */
          net_price: number;
          gross_price: number | null;
          tax_rate: number | null;
          base_net_price: number | null;
          approach_fee_net: number | null;
          manual_gross_price: number | null;
          billing_type_id: string | null;
          requested_date: string | null;
          return_status: string | null;
          rule_id: string | null;
          scheduled_at: string | null;
          status: string;
          stop_order: number | null;
          stop_updates: Json;
          vehicle_id: string | null;
        };
```

**KM beyond Google routing:** The only dedicated distance fields on `trips` in this schema are `driving_distance_km` and `driving_duration_seconds`. Migration comment ties them to the routing provider:

```4:13:supabase/migrations/20260316090000_add_driving_distance_and_duration_to_trips.sql
ALTER TABLE trips
ADD COLUMN driving_distance_km DOUBLE PRECISION,
ADD COLUMN driving_duration_seconds INTEGER;

-- Comments on columns for clarity
COMMENT ON COLUMN trips.driving_distance_km IS
  'Total driving distance in kilometers for this trip, as returned by the routing provider (e.g. Google Directions, mode=driving). NULL if coordinates are missing or the API call failed.';

COMMENT ON COLUMN trips.driving_duration_seconds IS
  'Total driving duration in seconds for this trip, as returned by the routing provider (e.g. Google Directions, mode=driving). NULL if coordinates are missing or the API call failed.';
```

There is **no** separate `manual_km` (or similar) column in `trips.Row` above.

---

## 2. Schema & Data Model — `clients` columns and KM / route configuration

**Exact snippet (`src/types/database.types.ts` — `clients.Row`):**

```185:215:src/types/database.types.ts
      clients: {
        Row: {
          city: string;
          company_id: string;
          company_name: string | null;
          created_at: string;
          email: string | null;
          first_name: string | null;
          greeting_style: string | null;
          id: string;
          is_company: boolean;
          is_wheelchair: boolean;
          last_name: string | null;
          notes: string | null;
          phone: string | null;
          phone_secondary: string | null;
          // Default price for all trips of this client. Takes precedence over trip.price.
          price_tag: number | null;
          /** Ordered { label, value }[] for invoice PDF; null when unset. */
          reference_fields: Json | null;
          customer_number: number;
          requires_daily_scheduling: boolean | null;
          stations: string[] | null;
          street: string;
          street_number: string;
          relation: string | null;
          updated_at: string | null;
          zip_code: string;
          lat: number | null;
          lng: number | null;
        };
```

**Finding:** No KM or per-route configuration column on `clients`. Address + `lat`/`lng` exist; pricing uses `price_tag` (legacy) and `client_price_tags` (see §4).

---

## 3. `clients` vs `kostentraeger` / `payers`; trip relationships

**Finding:** **`clients` and `payers` are separate tables.** In the UI/product language, **Kostenträger** maps to the `payers` table (`src/features/payers/components/payers-page.tsx` title). **Fahrgast** maps to `clients`.

- A **trip** links to a **Kostenträger** via `trips.payer_id` → `payers.id` (FK in generated types):

```1517:1523:src/types/database.types.ts
          {
            foreignKeyName: 'trips_payer_id_fkey';
            columns: ['payer_id'];
            isOneToOne: false;
            referencedRelation: 'payers';
            referencedColumns: ['id'];
          },
```

- A **trip** links to a **client** via `trips.client_id` → `clients.id`:

```1475:1481:src/types/database.types.ts
          {
            foreignKeyName: 'trips_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
```

Invoice builder fetches trips filtered by `payer_id` (and optional `client_id` in per-client mode):

```190:207:src/features/invoices/api/invoice-line-items.api.ts
    .eq('payer_id', params.payer_id)
    .gte('scheduled_at', params.period_from)
    .lte('scheduled_at', params.period_to + 'T23:59:59.999Z')
    // Defence in depth: billing must never see cancelled rows even if other layers regress.
    .neq('status', CANCELLED_STATUS)
    .order('scheduled_at', { ascending: true });

  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }

  if (params.client_id) {
    // Trips with client_id = null are excluded here by design.
    // Best-effort resolution at trip creation ensures client_id is set
    // when a Stammdaten match exists. See docs/trip-client-linking.md.
    query = query.eq('client_id', params.client_id);
  }
```

---

## 4. Price rules storage and linkage — schema

### 4a. `billing_pricing_rules` (catalog rules — not per-client)

**Exact table definition:**

```7:29:supabase/migrations/20260405100000_billing_pricing_rules.sql
CREATE TABLE public.billing_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  payer_id uuid REFERENCES public.payers (id) ON DELETE CASCADE,
  billing_type_id uuid REFERENCES public.billing_types (id) ON DELETE CASCADE,
  billing_variant_id uuid REFERENCES public.billing_variants (id) ON DELETE CASCADE,
  strategy text NOT NULL CHECK (strategy IN (
    'client_price_tag',
    'tiered_km',
    'fixed_below_threshold_then_km',
    'time_based',
    'manual_trip_price',
    'no_price'
  )),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_pricing_rules_exactly_one_scope CHECK (
    (CASE WHEN payer_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN billing_type_id IS NOT NULL THEN 1 ELSE 0 END)
    + (CASE WHEN billing_variant_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);
```

**Finding:** Rules are scoped to **exactly one** of `payer_id`, `billing_type_id`, or `billing_variant_id`. There is **no** `client_id` FK on `billing_pricing_rules`.

### 4b. `client_price_tags` (client-negotiated gross prices, optionally scoped to payer/variant)

```6:16:supabase/migrations/20260412140000_client_price_tags.sql
CREATE TABLE public.client_price_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  payer_id uuid NULL REFERENCES public.payers (id) ON DELETE CASCADE,
  billing_variant_id uuid NULL REFERENCES public.billing_variants (id) ON DELETE CASCADE,
  price_gross numeric(10, 2) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

---

## 5. Invoice Step 3 (“Positionen”) — trip list layout and where KM appears

**Component:** `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` (used from `src/features/invoices/components/invoice-builder/index.tsx` as `Step3LineItems`).

**Rendering:** A **vertical list** of **collapsible cards** (`lineItems.map`), not a data table. Each row is a `Collapsible` with a header grid `grid-cols-[1fr_1fr_auto]`.

**Where KM appears:** Under the gross price input, as `item.distance_km` formatted to one decimal and `" km"`:

```529:533:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                          <span className='text-muted-foreground text-[10px] tabular-nums'>
                            {item.distance_km != null
                              ? `${item.distance_km.toFixed(1)} km`
                              : '—'}
                          </span>
```

---

## 6. Where KM is read for invoice line item calculation

**Primary path — build line items from trips:**

```320:385:src/features/invoices/api/invoice-line-items.api.ts
export function buildLineItemsFromTrips(
  trips: TripForInvoice[],
  rules: BillingPricingRuleLike[],
  clientPriceTags: ClientPriceTagLike[] = []
): BuilderLineItem[] {
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
    // ...
    return {
      trip_id: trip.id,
      position: index + 1,
      // ...
      distance_km: trip.driving_distance_km,
```

**Pricing strategies using distance** (`resolveTripPricePure` → `executeStrategy`):

```249:300:src/features/invoices/lib/resolve-trip-price.ts
  const dist = trip.driving_distance_km;
  const sched = trip.scheduled_at;

  switch (strategy) {
    // ...
    case 'tiered_km': {
      // Distance required: cannot price km tiers without driving_distance_km.
      if (dist === null || dist === undefined) return null;
      const c = cfg as TieredKmConfig;
      const totalNet = tieredNetTotal(dist, c.tiers);
      const unit = roundMoneyOnce(totalNet / dist);
      return resolution(
        {
          net: totalNet,
          strategy_used: 'tiered_km',
          source: scope,
          unit_price_net: unit,
          quantity: dist
        },
        taxRate
      );
    }
```

**Tax rate from distance:**

```40:50:src/features/invoices/lib/tax-calculator.ts
/**
 * Resolves the applicable MwSt rate for a trip based on driving distance.
 *
 * @param distanceKm - Driving distance in km from `trips.driving_distance_km`.
 *                     Pass `null` if the distance is unknown.
 * @returns TaxRateResult with the resolved rate and a confidence indicator.
 *
 * @example
 *   resolveTaxRate(30)   // → { rate: 0.07, confidence: 'exact' }
 *   resolveTaxRate(75)   // → { rate: 0.19, confidence: 'exact' }
 *   resolveTaxRate(null) // → { rate: 0.07, confidence: 'fallback' }
```

---

## 7. Invoice generation: sync vs async; KM path to PDF

**Finding:** Invoice **creation** runs in the **browser** via TanStack Query mutation: it `await`s `createInvoice` (Supabase client) then `insertLineItems`. Not an Edge Function.

```267:277:src/features/invoices/hooks/use-invoice-builder.ts
      const invoice = await createInvoice({
        companyId,
        formValues: fullValues,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        rechnungsempfaengerId: rechnungsempfaengerId ?? null,
        pdfColumnOverride: pdfPayload
      });

      await insertLineItems(invoice.id, lineItems);
```

`createInvoice` uses `createClient()` (Supabase JS client):

```246:249:src/features/invoices/api/invoices.api.ts
export async function createInvoice(
  payload: CreateInvoicePayload
): Promise<InvoiceRow> {
  const supabase = createClient();
```

**KM frozen on the line item row:**

```589:598:src/features/invoices/api/invoice-line-items.api.ts
    return {
      invoice_id: invoiceId,
      trip_id: item.trip_id,
      position: item.position,
      line_date: item.line_date,
      description: item.description,
      client_name: item.client_name,
      pickup_address: item.pickup_address,
      dropoff_address: item.dropoff_address,
      distance_km: item.distance_km,
```

**PDF:** `InvoicePdfDocument` maps persisted `li.distance_km` into the structure used for totals/display:

```305:314:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
  const lineItemsForCalc: BuilderLineItem[] = invoice.line_items.map((li) => ({
    trip_id: li.trip_id,
    position: li.position,
    line_date: li.line_date,
    description: li.description,
    client_name: li.client_name,
    pickup_address: li.pickup_address,
    dropoff_address: li.dropoff_address,
    distance_km: li.distance_km,
```

**PDF column catalog** defines a `distance_km` column for Vorlagen:

```208:212:src/features/invoices/lib/pdf-column-catalog.ts
    key: 'distance_km',
    label: 'km',
    uiLabel: 'Fahrtstrecke (km)',
    dataField: 'distance_km',
```

---

## 8. Full price rule resolution order (per trip)

**Implementation:** `resolvePricingRule` in `src/features/invoices/lib/resolve-pricing-rule.ts`.

**Order:**

1. **STEP 0 — `client_price_tags`** (only if `clientId` and tags exist): pick tag by priority **variant-scoped → payer-scoped → global**; if valid `price_gross`, synthesize a rule with strategy `client_price_tag` and `_price_gross`.
2. **STEP 1 — Variant rule:** active `billing_pricing_rules` row where `billing_variant_id` matches trip’s variant.
3. **STEP 2 — Billing type (family) rule:** active rule where `billing_type_id` matches, and `billing_variant_id` and `payer_id` are null on the rule row.
4. **STEP 3 — Payer-wide rule:** active rule where `payer_id` matches trip’s payer, and type/variant FKs null on the rule row.

**Exact code:**

```33:113:src/features/invoices/lib/resolve-pricing-rule.ts
  // STEP 0 resolves client+payer price tags before catalog rules.
  // Priority within tags: variant-scoped > payer-scoped > global fallback.
  // See docs/pricing-engine.md and docs/preisregeln.md.
  if (clientId && clientPriceTags?.length) {
    const tags = clientPriceTags.filter(
      (t) => t.client_id === clientId && t.is_active
    );
    let tag: ClientPriceTagLike | undefined;

    if (billingVariantId) {
      tag = tags.find(
        (t) => (t.billing_variant_id ?? null) === billingVariantId
      );
    }
    if (!tag && payerId) {
      tag = tags.find(
        (t) => t.payer_id === payerId && (t.billing_variant_id ?? null) === null
      );
    }
    if (!tag) {
      tag = tags.find(
        (t) =>
          (t.payer_id ?? null) === null &&
          (t.billing_variant_id ?? null) === null
      );
    }

    if (tag) {
      const g = Number(tag.price_gross);
      if (!Number.isNaN(g) && g > 0) {
        return {
          id: tag.id,
          company_id: companyId,
          payer_id: tag.payer_id,
          billing_type_id: null,
          billing_variant_id: tag.billing_variant_id,
          strategy: 'client_price_tag',
          config: {},
          is_active: true,
          _price_gross: g
        };
      }
    }
  }

  // STEP 1 — Unterart: use a variant-level rule only when the trip has a variant.
  if (billingVariantId) {
    const v = rules.find(
      (r) => (r.billing_variant_id ?? null) === billingVariantId && r.is_active
    );
    if (v) return v;
  }

  // STEP 2 — Abrechnungsfamilie: type-level catalog row (payer_id null) when the
  // trip has a billing type. No match simply means we try STEP 3 next.
  if (billingTypeId) {
    const t = rules.find(
      (r) =>
        (r.billing_type_id ?? null) === billingTypeId &&
        (r.billing_variant_id ?? null) === null &&
        (r.payer_id ?? null) === null &&
        r.is_active
    );
    if (t) return t;
  }

  // STEP 3 — Kostenträger-wide fallback.
  const p = rules.find(
    (r) =>
      (r.payer_id ?? null) === payerId &&
      (r.billing_type_id ?? null) === null &&
      (r.billing_variant_id ?? null) === null &&
      r.is_active
  );
  return p ?? null;
```

**Note:** This is **not** “trip-level rule” first; trip-stored prices enter in `resolveTripPricePure` **after** a rule is chosen (e.g. `manual_trip_price`, KTS, taxameter paths — see `src/features/invoices/lib/resolve-trip-price.ts`).

---

## 9. Shared utility for the “winning” price rule

**Yes:** `export function resolvePricingRule(...)` — full file `src/features/invoices/lib/resolve-pricing-rule.ts` (snippet in §8).

---

## 10. UI — add a price rule per client tied to a Kostenträger

**Pattern:** **`client_price_tags`**, not a row in `billing_pricing_rules`, is how a **client-specific** price is tied to a **payer** (and optionally a variant).

**Entry points:**

- **Fahrgast (client) panel:** `src/features/clients/components/client-detail-panel.tsx` — section “Kunden-Preise”, opens `PricingRuleDialog` locked to the client with `initialStrategy='client_price_tag'`.

```386:396:src/features/clients/components/client-detail-panel.tsx
      {activeClientId && !isNew && (
        <PricingRuleDialog
          open={priceTagDialogOpen}
          onOpenChange={setPriceTagDialogOpen}
          scope={null}
          editing={null}
          initialStrategy='client_price_tag'
          initialClientId={activeClientId}
          lockClientSelection
          onSaved={handlePriceTagDialogSaved}
        />
      )}
```

- **Dialog structure** (`src/features/payers/components/pricing-rule-dialog/index.tsx`): Step 1 strategy tiles; Step 2 either rule config + scope or `ClientPriceTagStep` for `client_price_tag`.

```3:15:src/features/payers/components/pricing-rule-dialog/index.tsx
/**
 * PricingRuleDialog — two-step create flow, direct-edit flow.
 *
 * Step routing:
 *   step 1  → strategy tile grid (create only)
 *   step 2  → billing rule config + scope, or `ClientPriceTagStep` for client_price_tag
 *
 * `client_price_tag`: Step 2 opens the Kunden-Preis manager (`client_price_tags` + legacy
 * `clients.price_tag` for global rows). See docs/preisregeln.md.
```

- **Client price step** (`src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx`): client selector (unless locked), `Step2ScopePicker` / payer + family + variant picks, gross price input, CRUD on `client_price_tags`.

```70:88:src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx
export function ClientPriceTagStep({
  busy: externalBusy,
  initialClientId,
  lockClientSelection = false,
  onSaved
}: ClientPriceTagStepProps) {
  const qc = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const { data: clients = [] } = useClientsForPricing();
  const { data: payers = [] } = usePayers();

  const [searchQuery, setSearchQuery] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [pickPayerId, setPickPayerId] = useState<string | null>(null);
  const [pickFamilyId, setPickFamilyId] = useState<string | null>(null);
  const [pickVariantId, setPickVariantId] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState('');
```

**Central catalog (all rules + CPT rows):** `src/features/payers/components/pricing-rules-page.tsx` (`/dashboard/abrechnung/preise`).

---

## 11. Kostenträger page — configuration options

**List page:** `src/features/payers/components/payers-page.tsx` (route `src/app/dashboard/payers/page.tsx`).

**Detail sheet:** `src/features/payers/components/payer-details-sheet.tsx` includes **per-payer defaults and catalog wiring**, including:

- KTS default (`kts_default`)
- “Keine Rechnung” default (`no_invoice_required_default`)
- Selbstzahler / Schichtzettel (`accepts_self_payment`)
- Rechnungsempfänger (`rechnungsempfaenger_id`)
- PDF Vorlage (`pdf_vorlage_id`)
- Invoice text blocks (intro/outro) via `updatePayerTextBlocks`
- Abrechnungsfamilien / Unterarten and **pricing rules** per variant/type/payer (`useBillingPricingRules`, `PricingRuleDialog`)

**Example toggles (snippets):**

```438:465:src/features/payers/components/payer-details-sheet.tsx
            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <label className='text-muted-foreground mb-2 block text-xs font-medium tracking-wide uppercase'>
                KTS-Standard (Kostenträger)
              </label>
              <Select
                value={ktsSelectValue}
                onValueChange={(v) =>
                  void handleKtsDefaultChange(v as 'unset' | 'yes' | 'no')
                }
                disabled={isUpdating}
              >
```

```497:527:src/features/payers/components/payer-details-sheet.tsx
            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <label className='text-muted-foreground mb-2 block text-xs font-medium tracking-wide uppercase'>
                Fahrgast zahlt direkt (Schichtzettel)
              </label>
              <Select
                value={acceptsSelfPaymentSelectValue}
                onValueChange={(v) =>
                  void handleAcceptsSelfPaymentChange(
                    v as 'unset' | 'yes' | 'no'
                  )
                }
                disabled={isUpdating}
              >
```

---

## 12. Foreign key: trip → Kostenträger

**Column name:** `trips.payer_id` → `payers.id` (see §3 FK snippet).

---

## 13. Blast radius — every file that reads `driving_distance_km` from a trip (or trip-shaped row)

Inventory from repository grep (`driving_distance_km` in `*.ts` / `*.tsx`):

| Path |
|------|
| `src/app/api/cron/generate-recurring-trips/route.ts` |
| `src/app/api/trips/export/route.ts` |
| `src/app/api/trips/groups/metrics/route.ts` |
| `src/app/api/trips/metrics/route.ts` |
| `src/app/dashboard/settings/unzugeordnete-fahrten/page.tsx` |
| `src/features/invoices/api/invoice-line-items.api.ts` |
| `src/features/invoices/lib/__tests__/resolve-trip-price.test.ts` |
| `src/features/invoices/lib/invoice-validators.ts` |
| `src/features/invoices/lib/price-calculator.ts` |
| `src/features/invoices/lib/resolve-trip-price.ts` |
| `src/features/invoices/lib/tax-calculator.ts` |
| `src/features/invoices/types/invoice.types.ts` |
| `src/features/invoices/types/pricing.types.ts` |
| `src/features/trips/components/bulk-upload-dialog.tsx` |
| `src/features/trips/components/create-trip/create-trip-form.tsx` |
| `src/features/trips/components/csv-export/csv-export-constants.ts` |
| `src/features/trips/lib/__tests__/duplicate-trips.test.ts` |
| `src/features/trips/lib/__tests__/trip-price-engine.test.ts` |
| `src/features/trips/lib/build-return-trip-insert.ts` |
| `src/features/trips/lib/duplicate-trips.ts` |
| `src/features/trips/lib/trip-price-engine.ts` |
| `src/features/trips/trip-detail-sheet/components/linked-partner-callout.tsx` |
| `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` |
| `src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts` |
| `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` |
| `src/features/unassigned-trips/api/unassigned-trips.service.ts` |
| `src/features/unassigned-trips/components/trip-row.tsx` |
| `src/features/unassigned-trips/types/unassigned-trips.types.ts` |
| `src/lib/google-directions.ts` |
| `src/types/database.types.ts` |
| `scripts/backfill-driving-distance.ts` |
| `scripts/backfill-null-trip-net-prices.ts` |
| `scripts/backfill-trip-price-split.ts` |

Any manual-KM feature would need to intersect **pricing** (`resolve-trip-price`, `invoice-line-items.api`, `tax-calculator`, `trip-price-engine`), **persistence** (`build-trip-details-patch` distance freeze), **UI** (trip detail, invoice step 3), and **reporting/export** (CSV, metrics, cron).

---

## 14. Invoice PDF template and KM

**Yes.** Persisted `invoice_line_items.distance_km` is passed through to PDF calculation props (`InvoicePdfDocument`), and the column catalog exposes `distance_km` / “Fahrtstrecke (km)” for Vorlagen (§7 snippets).

**Invoice detail UI** also displays stored `distance_km`:

```338:342:src/features/invoices/components/invoice-detail/index.tsx
                    <TableCell className='text-sm'>
                      {item.distance_km !== null
                        ? `${item.distance_km.toFixed(1)}`
                        : '—'}
                    </TableCell>
```

---

## Appendix — `docs/` module documentation files

**Scope (per audit brief):** Markdown files under `docs/` that are **not** under `docs/plans/`.

- `docs/access-control.md`
- `docs/accounts-table.md`
- `docs/abrechnung-overview.md`
- `docs/address-autocomplete.md`
- `docs/anfahrtspreis.md`
- `docs/angebot-builder.md`
- `docs/angebot-formula-engine.md`
- `docs/angebote-module.md`
- `docs/angebote-vorlagen.md`
- `docs/billing-families-variants.md`
- `docs/bulk-trip-upload.md`
- `docs/bulk-upload-behavior-rules.md`
- `docs/client-price-tags.md`
- `docs/clients.md`
- `docs/color-system.md`
- `docs/company-logo-upload.md`
- `docs/csv-export-feature.md`
- `docs/date-picker.md`
- `docs/dispatch-inbox.md`
- `docs/driver-portal.md`
- `docs/driver-system.md`
- `docs/driving-metrics-api.md`
- `docs/feature-folder-structure.md`
- `docs/features/recurring-rules-overview.md`
- `docs/fremdfirma.md`
- `docs/invoice-text-templates.md`
- `docs/invoices-module.md`
- `docs/kanban-view.md`
- `docs/kts-architecture.md`
- `docs/kundennummer-system.md`
- `docs/letters-module.md`
- `docs/mobile-ui.md`
- `docs/navigation.md`
- `docs/no-invoice-required.md`
- `docs/panel-layout-system.md`
- `docs/pdf-vorlagen.md`
- `docs/preisregeln.md`
- `docs/price-calculation-engine.md`
- `docs/pricing-engine-3.md`
- `docs/pricing-engine.md`
- `docs/print-trips-export.md`
- `docs/rechnungsempfaenger.md`
- `docs/server-state-query.md`
- `docs/shift-reconciliations.md`
- `docs/storage-upload-troubleshooting.md`
- `docs/SUPABASE_INTEGRATION.md`
- `docs/trip-client-linking.md`
- `docs/trip-detail-sheet-editing.md`
- `docs/trip-linking-and-cancellation.md`
- `docs/trip-reschedule-v1.md`
- `docs/trip-status-helper.md`
- `docs/trips-date-filter.md`
- `docs/trips-duplicate.md`
- `docs/trips-filters-bar.md`
- `docs/trips-page-rsc-refresh.md`
- `docs/trips-rueckfahrt-detail-sheet.md`
- `docs/urgency-indicator.md`

---

## Senior Recommendation

**Complexity and risk:** Medium–high. Distance is a **cross-cutting input**: it drives **VAT** (`resolveTaxRate`), **per-km and hybrid pricing** (`tiered_km`, `fixed_below_threshold_then_km`), **line item snapshots** (`distance_km` on `invoice_line_items`), **PDF columns and summaries**, and **trip edit guards** when linked to invoices (`build-trip-details-patch` distance freeze). A manual override that only changed display but not pricing would be inconsistent; one that changed pricing must stay aligned with tax logic and immutability rules after invoice creation.

**Price rules pattern vs client-level KM override:** The **`billing_pricing_rules` pattern is not a direct fit** for “client + payer scoped KM” because those rules **cannot** target `client_id`. The **`client_price_tags` pattern is the closer analogue**: separate table, `client_id` + optional `payer_id` / `billing_variant_id`, resolved **before** catalog rules in `resolvePricingRule` STEP 0. A KM override would likely mirror **that** shape (scoped rows + priority chain), or extend resolution **next to** STEP 0, not inside `billing_pricing_rules`.

**Suggested resolution order for “effective KM”:**  
1) **Trip explicit manual override** (new field or tagged source — auditable).  
2) **Client + payer (+ optional variant) override table** (parallel to `client_price_tags`).  
3) **Payer-level default** (only if you need a Kostenträger-wide contracted distance policy without per-client rows).  
4) **`trips.driving_distance_km`** from routing (current behavior).  

This keeps the mental model “most specific wins” consistent with pricing tags, while preserving Google-derived distance as the default.

**Storage:** A **dedicated `client_km_overrides` (or generalized `trip_metric_overrides`) table** with the same scoping dimensions as `client_price_tags` is **stronger** than a single column on `clients`: KM is inherently **per payer/variant** (and sometimes per trip), not a single global number per Fahrgast. A column on `clients` alone cannot express payer-scoped overrides without collisions.

---

*End of audit.*

---

## Audit 2

### Step 3 — Manual price editing mechanics

#### 1. How the manual price override works in Step 3

**Price input is inline (no dialog/sheet).** The gross price (`Bruttopreis`) is always rendered as an `<Input>` directly on the collapsed row card; “Anfahrtskosten (brutto)” is another inline `<Input>` inside the expanded panel.

Path: `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`

```481:527:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                          <Input
                            type='text'
                            inputMode='decimal'
                            aria-label='Bruttopreis'
                            className='h-7 w-24 text-right text-sm tabular-nums'
                            value={grossInputValue}
                            placeholder='Betrag'
                            onFocus={() => {
                              handleFocus(item.position);
                              if (!isEditingThisRow) beginEditing(item);
                            }}
                            onChange={(e) => {
                              if (isEditingThisRow) {
                                setEditing((prev) => {
                                  const next = prev
                                    ? { ...prev, grossValue: e.target.value }
                                    : prev;
                                  editingRef.current = next;
                                  return next;
                                });
                              } else {
                                const next = {
                                  position: item.position,
                                  grossValue: e.target.value,
                                  approachValue:
                                    item.approach_fee_gross != null &&
                                    item.approach_fee_gross !== undefined
                                      ? formatEurInput(item.approach_fee_gross)
                                      : ''
                                };
                                editingRef.current = next;
                                setEditing(next);
                              }
                            }}
                            onBlur={() => blurIfThisRow(item.position)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitIfThisRow(item.position);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                          />
```

The input writes into **local Step 3 editing state** (`EditingState`) and on commit calls the callback `onApplyGrossOverride(position, grossTotal, approachFeeGross)` (see `commitEdit`).

```238:248:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
  const commitEdit = (state: EditingState) => {
    if (!state) return;
    const { position, grossValue, approachValue } = state;
    const gross = parseFloat(grossValue.replace(',', '.'));
    const approach = parseFloat(approachValue.replace(',', '.'));
    if (!isNaN(gross)) {
      onApplyGrossOverride(position, gross, isNaN(approach) ? 0 : approach);
    }
    editingRef.current = null;
    setEditing(null);
  };
```

**What line item fields it ultimately writes to:** `useInvoiceBuilder.applyGrossOverride` patches the `BuilderLineItem` in memory, notably:
- `unit_price`
- `approach_fee_net`
- `approach_fee_gross`
- `price_resolution`
- `manualGrossTotal`
- `manualApproachFeeGross`
- `isManualOverride`

Path: `src/features/invoices/hooks/use-invoice-builder.ts`

```146:170:src/features/invoices/hooks/use-invoice-builder.ts
  const applyGrossOverride = useCallback(
    (position: number, grossTotal: number, approachFeeGross: number) => {
      setLineItems((prev) =>
        prev.map((item) => {
          if (item.position !== position) return item;
          const nextRes = applyGrossOverrideToResolution(
            item.price_resolution,
            grossTotal,
            approachFeeGross,
            item.tax_rate
          );
          const patched: BuilderLineItem = {
            ...item,
            unit_price: nextRes.unit_price_net,
            approach_fee_net: nextRes.approach_fee_net ?? null,
            approach_fee_gross: approachFeeGross,
            price_resolution: nextRes,
            kts_override: false,
            price_source: null,
            manualGrossTotal: grossTotal,
            manualApproachFeeGross: approachFeeGross,
            isManualOverride: true
          };
          return { ...patched, warnings: validateLineItem(patched) };
        })
      );
    },
    []
  );
```

#### 2. `BuilderLineItem` type shape (every field)

Path: `src/features/invoices/types/invoice.types.ts`

```372:477:src/features/invoices/types/invoice.types.ts
export interface BuilderLineItem {
  /** Source trip ID — null for manually added items. */
  trip_id: string | null;
  /** 1-based row order; assigned when building from the fetched trip list. */
  position: number;
  /** Snapshot of `trips.scheduled_at` (ISO) for display and PDF. */
  line_date: string | null;
  /** Human-readable line title built in `buildLineItemsFromTrips` (date + client). */
  description: string;
  /** Passenger name snapshot from `trips.client` at build time. */
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  /** `trips.driving_distance_km` — feeds tax rate and per-km strategies. */
  distance_km: number | null;
  /**
   * Net unit price for the line (€). Mirrors `price_resolution.unit_price_net` until the
   * user overrides in step 3; `null` means unresolved / missing (step-3 `missing_price`).
   */
  unit_price: number | null;
  /** Net Anfahrtspreis for this trip. Null if resolver omitted it (no rule fee or tag/KTS path). */
  approach_fee_net: number | null;
  /**
   * Billing quantity from `PriceResolution.quantity` (usually `1`; equals km for per-km rules).
   */
  quantity: number;
  /** VAT rate from `resolveTaxRate(driving_distance_km)` — not from the pricing rule. */
  tax_rate: number;
  /** From joined `billing_variants.code` on the trip. */
  billing_variant_code: string | null;
  /** From joined `billing_variants.name` on the trip. */
  billing_variant_name: string | null;
  /** From joined `billing_types.name` via billing_variants.billing_type (family label). */
  billing_type_name: string | null;
  /**
   * Copy of `trips.kts_document_applies` — informational badge; actual €0 KTS pricing is
   * reflected in `price_resolution` / `kts_override`.
   */
  kts_document_applies: boolean;
  /**
   * Copy of `trips.no_invoice_required` — soft advisory only; does not block the wizard.
   */
  no_invoice_warning: boolean;
  /**
   * Full output of `resolveTripPrice` for this trip (strategy, source, net, gross, notes).
   * Persisted as `invoice_line_items.price_resolution_snapshot` on insert; step-4 tooltips
   * read `strategy_used` and `source` from here.
   */
  price_resolution: PriceResolution;
  /**
   * `true` when `price_resolution.strategy_used === 'kts_override'` (KTS branch in
   * `resolveTripPrice`). Skips the `zero_price` validator warning for €0 lines.
   */
  kts_override: boolean;

  /**
   * Trip-only PDF snapshot; persisted as `trip_meta_snapshot` on insert — §14 UStG.
   */
  trip_meta: TripMetaSnapshot | null;

  /**
   * Legacy subset of `price_resolution.source` for incremental UI migration
   * (`client_price_tag` | `trip_price` only).
   * @deprecated Prefer `price_resolution.source` and DB `pricing_source`.
   */
  price_source: 'client_price_tag' | 'trip_price' | null;

  /**
   * Advisory codes from `validateLineItem` (missing price, distance, no-invoice trip, …).
   */
  warnings: LineItemWarning[];

  // ── Gross override fields (set by admin in Step 3) ──────────────────────────

  /**
   * Gross representation of `approach_fee_net × (1 + tax_rate)`; pre-computed at
   * build time in `buildLineItemsFromTrips`. Used to pre-fill the Anfahrt input
   * in edit mode without requiring a runtime multiplication.
   */
  approach_fee_gross?: number | null;

  /**
   * Snapshot of the engine-computed `PriceResolution` before any admin override.
   * Used by `resetLineItemOverride` to restore the original pricing.
   * Always set by `buildLineItemsFromTrips`; optional here only to avoid breaking
   * existing code paths before initialization.
   */
  originalPriceResolution?: PriceResolution;

  /**
   * Admin-entered gross total (transport + Anfahrt combined). `null` = not overridden;
   * engine-priced value is used instead.
   */
  manualGrossTotal?: number | null;

  /**
   * Admin-entered Anfahrtskosten gross. `null` = not overridden.
   */
  manualApproachFeeGross?: number | null;

  /**
   * `true` when the admin has committed a gross override via `applyGrossOverride`.
   * Drives the amber "Manuell" badge and the × reset button in Step 3.
   */
  isManualOverride?: boolean;
}
```

#### 3. Full flow when user edits price in Step 3 (trace)

**Initial pricing** is computed once when trips are fetched and transformed into `BuilderLineItem[]` via `buildLineItemsFromTrips`, which calls `resolveTripPrice(...)` (pure engine) using `trip.driving_distance_km` and the resolved pricing rule.

Path: `src/features/invoices/api/invoice-line-items.api.ts`

```320:350:src/features/invoices/api/invoice-line-items.api.ts
  const rawItems = trips.map((trip, index) => {
    const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);
    const rule = resolvePricingRule({ /* ... */ });
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

**User edit** does **not re-run** `resolveTripPrice(...)` against the trip/rules cascade. Instead it **patches the already-resolved `price_resolution`** by calling `applyGrossOverrideToResolution(baseResolution, grossTotal, approachFeeGross, taxRate)`.

Path: `src/features/invoices/hooks/use-invoice-builder.ts`

```151:156:src/features/invoices/hooks/use-invoice-builder.ts
          const nextRes = applyGrossOverrideToResolution(
            item.price_resolution,
            grossTotal,
            approachFeeGross,
            item.tax_rate
          );
```

That helper back-calculates `unit_price_net` and `approach_fee_net` so downstream math stays consistent, and forces `strategy_used: 'manual_trip_price'` on the `PriceResolution`:

Path: `src/features/invoices/lib/resolve-trip-price.ts`

```518:543:src/features/invoices/lib/resolve-trip-price.ts
export function applyGrossOverrideToResolution(
  base: PriceResolution,
  grossTotal: number,
  approachFeeGross: number,
  taxRate: number
): PriceResolution {
  const qty = base.quantity;
  const approachFeeNet = approachFeeGross / (1 + taxRate);
  const transportNet = (grossTotal - approachFeeGross) / (1 + taxRate);
  const unitPriceNet = qty > 1 ? transportNet / qty : transportNet;
  const prevNote = base.note;
  const overrideNote = 'Manuell überschrieben (Bruttoeingabe)';
  const note =
    prevNote && !prevNote.includes(overrideNote)
      ? `${prevNote} · ${overrideNote}`
      : overrideNote;
  return {
    ...base,
    unit_price_net: unitPriceNet,
    net: transportNet,
    gross: grossTotal,
    tax_rate: taxRate,
    approach_fee_net: approachFeeNet,
    strategy_used: 'manual_trip_price',
    note
  };
}
```

**Conclusion:** Step 3 manual editing **bypasses the rule resolution chain** and instead mutates the existing resolution output, keeping totals/insert semantics stable by back-calculating net/unit/approach from the entered gross.

#### 4. Is the price input always visible or conditional?

**Always visible.** There is no condition around rendering the Bruttopreis input per row; it is inside the main row layout for every `lineItems.map(...)` entry.

Path: `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`

```338:388:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
              {lineItems.map((item) => {
                // ...
                return (
                  <Collapsible /* ... */>
                    <div /* ... */>
                      <div className={cn('grid grid-cols-[1fr_1fr_auto] ...')}>
                        {/* ... */}
                        <Input aria-label='Bruttopreis' /* ... */ />
```

#### 5. How manual edits are flagged vs rule-resolved prices

There are **two distinct “manual” concepts** in Step 3 UX:

1) **Trip-level persisted taxameter** (`trips.manual_gross_price`) → shows “Taxameter” badge if `item.price_resolution.source === 'manual_gross_price'`.\n
2) **In-session Step 3 override** → sets `isManualOverride: true` and `manualGrossTotal` fields on the line item, and also shows “Taxameter” badge (same label) plus a reset `X` button.

Path: `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`

```54:66:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
  const taxameterBadge =
    item.price_resolution.source === 'manual_gross_price' ||
    item.isManualOverride;
  if (taxameterBadge) {
    return { label: 'Taxameter', className: '...' };
  }
```

The reset action is only available when `item.isManualOverride` is true:

```434:456:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                            {(item.isManualOverride ||
                              item.price_resolution.source ===
                                'manual_gross_price') && (
                              <>
                                <Badge /* ... */>Taxameter</Badge>
                                {item.isManualOverride && (
                                  <button
                                    type='button'
                                    aria-label='Taxameter-Preis zurücksetzen'
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onResetOverride(item.position);
                                    }}
                                  >
                                    <X className='h-3 w-3' />
                                  </button>
                                )}
                              </>
                            )}
```

---

### Step 3 — State management

#### 6. Where `lineItems` is stored and how mutations are dispatched

`lineItems` lives in the invoice builder hook as **local React state** (`useState<BuilderLineItem[]>`) inside `useInvoiceBuilder`, not Zustand and not React Query state.

Path: `src/features/invoices/hooks/use-invoice-builder.ts`

```71:74:src/features/invoices/hooks/use-invoice-builder.ts
  const [step2Values, setStep2Values] = useState<Step2Values | null>(null);
  const [lineItems, setLineItems] = useState<BuilderLineItem[]>([]);
  /** PDF-only cancelled rows — never folded into totals or invoice_line_items. */
  const [cancelledTrips, setCancelledTrips] = useState<CancelledTripRow[]>([]);
```

Mutations are dispatched by calling `setLineItems(prev => prev.map(...))` from callbacks (`applyGrossOverride`, `resetLineItemOverride`).

#### 7. Is there an `updateLineItem` / `setLineItemPrice` function?

There is no generic `updateLineItem` function; the hook exposes targeted mutators:

- `applyGrossOverride(position, grossTotal, approachFeeGross)` — called from Step 3 via `onApplyGrossOverride`.
- `resetLineItemOverride(position)` — called from Step 3 via the “X” button.

Paths:
- Definition: `src/features/invoices/hooks/use-invoice-builder.ts` (snippets in Q1 and Q5)
- Call site: `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`

```243:245:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
    if (!isNaN(gross)) {
      onApplyGrossOverride(position, gross, isNaN(approach) ? 0 : approach);
    }
```

```449:452:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onResetOverride(item.position);
                                    }}
```

---

### Payer toggle pattern

#### 8. Example toggle: `payers.kts_default` end-to-end

**DB column (generated types):** `payers.Row.kts_default: boolean | null`

Path: `src/types/database.types.ts`

```605:617:src/types/database.types.ts
      payers: {
        Row: {
          accepts_self_payment: boolean | null;
          company_id: string;
          created_at: string;
          id: string;
          kts_default: boolean | null;
          name: string;
          no_invoice_required_default: boolean | null;
          number: string;
          rechnungsempfaenger_id: string | null;
        };
```

**Important schema note:** `database.types.ts` is **not fully up to date** for payers. Migrations add additional columns (e.g. address fields and `pdf_vorlage_id`) which are not present in the `payers.Row` block above:\n

- Address fields migration:

```15:22:supabase/migrations/20260331100000_add_address_fields_to_payers.sql
ALTER TABLE public.payers
  ADD COLUMN IF NOT EXISTS street          TEXT,
  ADD COLUMN IF NOT EXISTS street_number   TEXT,
  ADD COLUMN IF NOT EXISTS zip_code        TEXT,
  ADD COLUMN IF NOT EXISTS city            TEXT,
  ADD COLUMN IF NOT EXISTS contact_person  TEXT,
  ADD COLUMN IF NOT EXISTS email           TEXT,
  ADD COLUMN IF NOT EXISTS phone           TEXT;
```

- PDF Vorlage FK migration:

```76:78:supabase/migrations/20260408120001_pdf_vorlagen.sql
ALTER TABLE public.payers
  ADD COLUMN pdf_vorlage_id uuid
    REFERENCES public.pdf_vorlagen(id) ON DELETE SET NULL;
```

**Loaded in payer details:** `displayPayer.kts_default` (from `usePayers()` list/cache) is normalized into `ktsSelectValue`.

Path: `src/features/payers/components/payer-details-sheet.tsx`

```265:270:src/features/payers/components/payer-details-sheet.tsx
  const ktsSelectValue =
    displayPayer.kts_default === true
      ? 'yes'
      : displayPayer.kts_default === false
        ? 'no'
        : 'unset';
```

**Saved back to DB:** `handleKtsDefaultChange` calls `updatePayer({ kts_default: ... })`.

Path: `src/features/payers/components/payer-details-sheet.tsx`

```205:218:src/features/payers/components/payer-details-sheet.tsx
  const handleKtsDefaultChange = async (v: 'unset' | 'yes' | 'no') => {
    if (!displayPayer) return;
    try {
      await updatePayer({
        id: displayPayer.id,
        name: displayPayer.name,
        number: displayPayer.number ?? '',
        kts_default: v === 'unset' ? null : v === 'yes',
        no_invoice_required_default:
          displayPayer.no_invoice_required_default ?? null,
        accepts_self_payment: displayPayer.accepts_self_payment ?? null,
        rechnungsempfaenger_id: displayPayer.rechnungsempfaenger_id ?? null,
        pdf_vorlage_id: displayPayer.pdf_vorlage_id ?? null
      });
```

The persistence layer ultimately updates the `payers` row:

Path: `src/features/payers/api/payers.service.ts`

```92:112:src/features/payers/api/payers.service.ts
    const { error } = await supabase
      .from('payers')
      .update({
        name: args.name,
        number: args.number,
        kts_default: args.kts_default,
        ...(args.no_invoice_required_default !== undefined
          ? { no_invoice_required_default: args.no_invoice_required_default }
          : {}),
        ...(args.accepts_self_payment !== undefined
          ? { accepts_self_payment: args.accepts_self_payment }
          : {}),
        ...(args.rechnungsempfaenger_id !== undefined
          ? { rechnungsempfaenger_id: args.rechnungsempfaenger_id }
          : {}),
        ...(args.pdf_vorlage_id !== undefined
          ? { pdf_vorlage_id: args.pdf_vorlage_id }
          : {})
      })
      .eq('id', args.id);
```

**Read elsewhere (trip creation default cascade):** Trip creation fetches payers with `kts_default` and applies a catalog precedence resolver.

Path: `src/features/trips/api/trip-reference-data.ts`

```28:36:src/features/trips/api/trip-reference-data.ts
export async function fetchPayers(): Promise<PayerOption[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('payers')
    .select('id, name, kts_default, no_invoice_required_default')
    .order('name');
```

Path: `src/features/trips/lib/resolve-kts-default.ts`

```66:85:src/features/trips/lib/resolve-kts-default.ts
export function resolveKtsDefault(input: ResolveKtsDefaultInput): {
  value: boolean;
  source: KtsCatalogSource;
} {
  const v = input.variantKtsDefault;
  if (v !== null && v !== undefined) {
    return { value: !!v, source: 'variant' };
  }
  const kd = normalizeKtsDefaultFromBehavior(input.familyBehaviorProfile);
  if (kd === 'yes') return { value: true, source: 'familie' };
  if (kd === 'no') return { value: false, source: 'familie' };
  const pk = input.payerKtsDefault;
  if (pk !== null && pk !== undefined) {
    return { value: !!pk, source: 'payer' };
  }
  return { value: false, source: 'system_default' };
}
```

And `CreateTripForm` uses it to prefill the trip form:

Path: `src/features/trips/components/create-trip/create-trip-form.tsx`

```399:424:src/features/trips/components/create-trip/create-trip-form.tsx
  // KTS default from catalog unless the dispatcher has overridden the switch.
  React.useEffect(() => {
    if (ktsUserLockedRef.current) return;
    // ...
    if (!watchedBillingVariantId) {
      const r = resolveKtsDefault({
        payerKtsDefault: payer.kts_default,
        familyBehaviorProfile: undefined,
        variantKtsDefault: undefined
      });
      const curKts = form.getValues('kts_document_applies');
      if (curKts !== r.value) {
        form.setValue('kts_document_applies', r.value);
      }
      // ...
      return;
    }
```

#### 9. Does invoice builder read payer-level flags to hide/show Step 3 UI?

**No.** `useInvoiceBuilder` fetches pricing rules and trips, but the trip select only embeds `payer:payers(rechnungsempfaenger_id)` (no `kts_default`, `no_invoice_required_default`, etc.), and `Step3LineItems` renders inputs unconditionally.

Path: `src/features/invoices/api/invoice-line-items.api.ts`

```181:188:src/features/invoices/api/invoice-line-items.api.ts
      payer:payers(rechnungsempfaenger_id),
      billing_variant:billing_variants(
        id, code, name, billing_type_id, rechnungsempfaenger_id,
        billing_type:billing_types(name, rechnungsempfaenger_id)
      ),
```

Path: `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` (no conditional around the inputs; see Q4 snippet).

---

### Existing manual price in trips

#### 10. `trips.manual_gross_price`: how it’s set, and interaction with Step 3

**How it’s used by the pricing engine:** `resolveTripPrice` treats `manual_gross_price` as absolute P0 (“Taxameter”), setting `source: 'manual_gross_price'` and preventing approach fee add-on.

Path: `src/features/invoices/lib/resolve-trip-price.ts`

```395:423:src/features/invoices/lib/resolve-trip-price.ts
  if (
    trip.manual_gross_price != null &&
    trip.manual_gross_price !== undefined
  ) {
    const gross = trip.manual_gross_price;
    const net = gross / (1 + taxRate);
    return {
      ...resolution(
        {
          net,
          gross,
          strategy_used: 'manual_trip_price',
          source: 'manual_gross_price',
          unit_price_net: net,
          quantity: 1,
          note: 'Taxameter-Preis (Admin erfasst)'
        },
        taxRate
      ),
      approach_fee_net: 0
    };
  }
```

**How it enters Step 3:** The trips fetch includes `manual_gross_price`, and `buildLineItemsFromTrips` passes it into the resolver:

Path: `src/features/invoices/api/invoice-line-items.api.ts`

```168:174:src/features/invoices/api/invoice-line-items.api.ts
      manual_gross_price,
      driving_distance_km,
```

```337:347:src/features/invoices/api/invoice-line-items.api.ts
    const priceResolution = resolveTripPricePure(
      {
        // ...
        manual_gross_price: trip.manual_gross_price ?? null,
        driving_distance_km: trip.driving_distance_km ?? null,
```

Step 3’s gross input display is based on the **builder line item** (not directly on the trip). The “Taxameter” badge is shown when either:
- the resolved `price_resolution.source === 'manual_gross_price'` (persisted trip-level), or
- `item.isManualOverride` (Step 3 override)

Path: `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`

```57:60:src/features/invoices/components/invoice-builder/step-3-line-items.tsx
  const taxameterBadge =
    item.price_resolution.source === 'manual_gross_price' ||
    item.isManualOverride;
```

**How `manual_gross_price` can be set from Step 3:** On invoice creation, the builder performs a fire-and-forget writeback to `trips`, and **when `isManualOverride` is true** it persists `manual_gross_price` to the trip row:

Path: `src/features/invoices/hooks/use-invoice-builder.ts`

```282:296:src/features/invoices/hooks/use-invoice-builder.ts
      void Promise.allSettled(
        lineItems
          .filter((item) => item.trip_id !== null)
          .map((item) => {
            const baseNet = item.price_resolution.net;
            const approachNet = item.approach_fee_net ?? 0;
            return tripsService.updateTrip(item.trip_id!, {
              gross_price: item.manualGrossTotal ?? item.price_resolution.gross,
              tax_rate: item.tax_rate,
              base_net_price: baseNet,
              approach_fee_net: approachNet,
              ...(item.isManualOverride && item.manualGrossTotal !== null
                ? { manual_gross_price: item.manualGrossTotal }
                : {})
            });
          })
      );
```

**Other places that set it:** Shift reconciliations expose a direct write API that updates `manual_gross_price` only:

Path: `src/features/shift-reconciliations/api/shift-reconciliations.service.ts`

```188:211:src/features/shift-reconciliations/api/shift-reconciliations.service.ts
export async function updateTripManualPrice(
  tripId: string,
  manualGrossPrice: number | null
): Promise<void> {
  // ...
  const { error } = await supabase
    .from('trips')
    .update({ manual_gross_price: manualGrossPrice })
    .eq('id', tripId);
  if (error) throw toQueryError(error);
}
```

---

### Audit 2 — Senior Recommendation

**Clone the Step 3 pattern for KM by adding an inline decimal input per line item, backed by local “editing state” and a targeted mutator in `useInvoiceBuilder` (same shape as `applyGrossOverride`).** Concretely:

- **UX:** Add a `KM` `<Input type='text' inputMode='decimal'>` in the same collapsed-row area where Step 3 currently shows `${item.distance_km.toFixed(1)} km`. Keep commit semantics identical (blur/enter commits; escape cancels; row-scoped timer guard).\n
- **Builder state:** Add an optional field on `BuilderLineItem` such as `manualDistanceKm?: number | null` (and possibly a `isManualKmOverride?: boolean`) and dispatch updates via `setLineItems(prev => prev.map(...))` just like `applyGrossOverride`.\n
- **Effective-KM consumption:** Today the system always uses `trip.driving_distance_km` for (a) `resolveTaxRate` and (b) per-km strategy quantities (`tiered_km` etc.). The minimal integration change is to thread an “effective distance” into the existing pipeline:\n
  - In `buildLineItemsFromTrips`, compute `effectiveDistanceKm = (manualDistanceKm ?? trip.driving_distance_km)` and use it for both `resolveTaxRate(effectiveDistanceKm)` and `resolveTripPrice({ driving_distance_km: effectiveDistanceKm, ... })`.\n
  - This keeps the pricing engine contract intact (it already expects `TripPriceInput.driving_distance_km`).\n
- **DB minimal change:** If the goal is to support manual KM **only during invoice creation** (snapshot-only), the smallest DB change is adding a new snapshot column on `invoice_line_items` (e.g. `effective_distance_km`) so PDFs/invoice detail can display and summarize the overridden distance without re-reading `trips`. If instead manual KM must affect trip-level behavior outside invoicing (trip detail, exports, metrics), then a new `trips.manual_distance_km` (or a scoped override table) is required.\n
\n*(End of Audit 2.)*

---

## Audit 3 — Phase 3 prerequisites

Read-only audit (2026-05-05). Sources: `client-price-tag-step.tsx`, `pricing-rule-dialog/index.tsx`, `client-detail-panel.tsx`, `InvoicePdfDocument.tsx`, `pdf-column-catalog.ts`, `invoice-line-items.api.ts` (`buildLineItemsFromTrips`), `invoice.types.ts` (`BuilderLineItem`), `pricing.types.ts` (`PriceResolution`, `BillingPricingRuleLike`), `resolve-trip-price.ts`.

### 1. Exact props of `ClientPriceTagStep`

Path: `src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx`

```62:68:src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx
export interface ClientPriceTagStepProps {
  busy: boolean;
  initialClientId: string | null;
  /** When true, client cannot be changed (e.g. opened from Fahrgast panel). */
  lockClientSelection?: boolean;
  onSaved: () => void;
}
```

- `busy: boolean`
- `initialClientId: string | null`
- `lockClientSelection?: boolean` (optional; default `false` in destructuring)
- `onSaved: () => void`

### 2. Form fields `ClientPriceTagStep` renders

Path: `src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx`

| Field / control | Label (or placeholder) | Writes to | Required / optional |
|-----------------|------------------------|-----------|---------------------|
| Passenger search `Input` | placeholder `Fahrgast suchen…` | React state `searchQuery`; selecting a hit sets `clientId` | Optional (hidden when `lockClientSelection` or when `clientId` set) |
| `Step2ScopePicker` (add form) | section “Zuordnung” via child: Kostenträger, Abrechnungsfamilie (optional), Unterart (optional) | `pickPayerId`, `pickFamilyId`, `pickVariantId` | Optional for scope (empty = global); payer selects enable family/variant |
| `Input` “Preis brutto” | `Label` “Preis brutto (€)”, placeholder `z. B. 32,60` | `newPrice` (string) | Required to save a **valid** add: `handleAdd` rejects empty/invalid parse |
| “Speichern” (add) | — | triggers `handleAdd` | — |
| List row: edit `Input` | unlabeled in edit mode | `editPrice` | Required for valid save in `saveEdit` |
| List row: “Aktiv” `Switch` | “Aktiv” | `handleToggleActive` → DB/API | — |
| “Bearbeiten” / “OK” / “Abbrechen” / “Löschen” | buttons | edit mode / `saveEdit` / cancel / `handleDelete` | — |

Helper copy states global when scope empty: “Leer lassen = globaler Preis (alle Kostenträger). Optional Kostenträger, dann Unterart…”.

### 3. Payer scope selector — `Step2ScopePicker` vs inline

Path: `src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx` — **separate** `Step2ScopePicker` component (not inline markup).

```369:382:src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx
          {showAddForm && (
            <div className='bg-muted/30 space-y-3 rounded-lg border p-3'>
              <Step2ScopePicker
                pickPayerId={pickPayerId}
                pickFamilyId={pickFamilyId}
                pickVariantId={pickVariantId}
                payers={payers}
                billingFamilies={billingFamilies}
                selectedFamily={selectedFamily}
                busy={busy}
                onPayerChange={setPickPayerId}
                onFamilyChange={setPickFamilyId}
                onVariantChange={setPickVariantId}
              />
```

Path: `src/features/payers/components/pricing-rule-dialog/step2-scope-picker.tsx` — renders **Kostenträger**, then optional **Abrechnungsfamilie**, then optional **Unterart** (payer + billing type family + billing variant).

```55:132:src/features/payers/components/pricing-rule-dialog/step2-scope-picker.tsx
  return (
    <div className='space-y-3 border-t pt-2'>
      <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
        Zuordnung
      </p>
      <div className='space-y-1.5'>
        <Label>Kostenträger</Label>
        <Select
          value={pickPayerId ?? ''}
          onValueChange={(v) => onPayerChange(v || null)}
          disabled={busy}
        >
          <SelectTrigger>
            <SelectValue placeholder='Kostenträger wählen…' />
          </SelectTrigger>
          <SelectContent>
            {payers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {pickPayerId && billingFamilies.length > 0 && (
        <div className='space-y-1.5'>
          <Label>
            Abrechnungsfamilie{' '}
            <span className='text-muted-foreground text-xs font-normal'>
              (optional)
            </span>
          </Label>
          <Select
            value={pickFamilyId ?? ''}
            onValueChange={(v) => onFamilyChange(v || null)}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue placeholder='Alle Familien' />
            </SelectTrigger>
            <SelectContent>
              {billingFamilies.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {pickFamilyId && (selectedFamily?.billing_variants ?? []).length > 0 && (
        <div className='space-y-1.5'>
          <Label>
            Unterart{' '}
            <span className='text-muted-foreground text-xs font-normal'>
              (optional)
            </span>
          </Label>
          <Select
            value={pickVariantId ?? ''}
            onValueChange={(v) => onVariantChange(v || null)}
            disabled={busy}
          >
            <SelectTrigger>
              <SelectValue placeholder='Alle Unterarten' />
            </SelectTrigger>
            <SelectContent>
              {(selectedFamily?.billing_variants ?? []).map((bv) => (
                <SelectItem key={bv.id} value={bv.id}>
                  {bv.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
```

### 4. Launch from `client-detail-panel.tsx` — trigger and `PricingRuleDialog` props

Path: `src/features/clients/components/client-detail-panel.tsx`

Trigger: “Kunden-Preise” section — `Button` “Bearbeiten” sets `setPriceTagDialogOpen(true)`.

```298:313:src/features/clients/components/client-detail-panel.tsx
              {activeClientId && !isNew && client && (
                <section className='space-y-2' aria-label='Kunden-Preise'>
                  <div className='flex items-center justify-between gap-2'>
                    <h3 className='text-sm font-medium tracking-tight'>
                      Kunden-Preise
                    </h3>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 gap-1 px-2 text-xs'
                      type='button'
                      onClick={() => setPriceTagDialogOpen(true)}
                    >
                      <Pencil className='mr-1 h-3 w-3' />
                      Bearbeiten
                    </Button>
                  </div>
```

`PricingRuleDialog` JSX:

```386:397:src/features/clients/components/client-detail-panel.tsx
      {activeClientId && !isNew && (
        <PricingRuleDialog
          open={priceTagDialogOpen}
          onOpenChange={setPriceTagDialogOpen}
          scope={null}
          editing={null}
          initialStrategy='client_price_tag'
          initialClientId={activeClientId}
          lockClientSelection
          onSaved={handlePriceTagDialogSaved}
        />
      )}
```

### 5. How `ClientPriceTagStep` saves a new row

Path: `src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx`

Not a React Hook Form submit: **`handleAdd`** calls **service/API helpers** (not raw `supabase` in this function — `insertClientPriceTag` is imported from `client-price-tags.service`; `setClientPriceTag` from `clients-pricing.api`). `supabase` is used for **delete** mutation and list fetch via `listClientPriceTagsForManager`.

Exact save branches:

```179:217:src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx
  const handleAdd = async () => {
    if (!clientId) return;
    const raw = newPrice.trim().replace(',', '.');
    const priceGross = parseFloat(raw);
    if (Number.isNaN(priceGross) || priceGross < 0) {
      toast.error('Ungültiger Preis.');
      return;
    }
    setSaving(true);
    try {
      if (pickVariantId) {
        await insertClientPriceTag({
          client_id: clientId,
          payer_id: null,
          billing_variant_id: pickVariantId,
          price_gross: priceGross
        });
      } else if (pickPayerId) {
        await insertClientPriceTag({
          client_id: clientId,
          payer_id: pickPayerId,
          billing_variant_id: null,
          price_gross: priceGross
        });
      } else {
        await setClientPriceTag(clientId, priceGross);
      }
      toast.success('Kunden-Preis gespeichert');
      setNewPrice('');
      setShowAddForm(false);
      setPickPayerId(null);
      setPickFamilyId(null);
      setPickVariantId(null);
      await invalidateTagCaches(clientId);
    } catch (e) {
      toast.error(pricingRulesErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };
```

### 6. List of existing rows; edit / delete

Path: `src/features/payers/components/pricing-rule-dialog/client-price-tag-step.tsx`

- **List:** `useQuery` → `listClientPriceTagsForManager(clientId!, supabase)`; rendered as `<ul>` of rows (`tagsQuery.data!.map`).
- **Edit:** “Bearbeiten” → `startEdit` sets `editingId` + `editPrice`; “OK” → `saveEdit` calls `updateClientPriceTag(row.id, { price_gross })` and for global rows also `setClientPriceTag(row.client_id, priceGross)`.
- **Delete:** “Löschen” → `handleDelete` → `deleteTagMutation` → global rows: `setClientPriceTag(row.client_id, null)`; else `deleteClientPriceTag(row.id, supabase)`.
- **Active toggle:** `Switch` → `handleToggleActive` (`updateClientPriceTag` / `setClientPriceTag` as appropriate).

### 7. Where `distance_km` is rendered in `InvoicePdfDocument.tsx`

Path: `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`

**There is no JSX in this file that renders a `distance_km` cell.** The only occurrences are when mapping persisted line items into **`BuilderLineItem[]` for `calculateInvoiceTotals`** (totals math), not for table cells:

```305:333:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
  const lineItemsForCalc: BuilderLineItem[] = invoice.line_items.map((li) => ({
    trip_id: li.trip_id,
    position: li.position,
    line_date: li.line_date,
    description: li.description,
    client_name: li.client_name,
    pickup_address: li.pickup_address,
    dropoff_address: li.dropoff_address,
    distance_km: li.distance_km,
    effective_distance_km: li.effective_distance_km ?? li.distance_km,
    original_distance_km: li.original_distance_km ?? li.distance_km,
    manual_km_enabled: false,
    unit_price: li.unit_price,
    quantity: li.quantity,
    approach_fee_net: li.approach_fee_net ?? null,
    tax_rate: li.tax_rate,
    billing_variant_code: li.billing_variant_code,
    billing_variant_name: li.billing_variant_name,
    billing_type_name: li.billing_type_name ?? null,
    kts_document_applies: li.kts_override,
    no_invoice_warning: false,
    price_resolution: priceResolutionFromLineItem(li),
    kts_override: li.kts_override,
    trip_meta: parseTripMetaSnapshot(
      li.trip_meta_snapshot as Record<string, unknown> | null | undefined
    ),
    price_source: null,
    warnings: []
  }));
```

Actual PDF **columns** resolve `distance_km` / `total_km` via **`pdf-column-catalog.ts`** `dataField` and downstream layout (`InvoicePdfCoverBody`, `InvoicePdfAppendix`). **Grouped main layout** aggregates km in `build-invoice-pdf-summary.ts` using **`item.distance_km`** (not `effective_distance_km`):

Path: `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts`

```215:219:src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts
    if (item.distance_km == null) {
      group.has_null_km = true;
    } else if (!group.has_null_km) {
      group.total_km += Number(item.distance_km);
    }
```

### 8. `distance_km` column in `pdf-column-catalog.ts`

Path: `src/features/invoices/lib/pdf-column-catalog.ts`

```207:218:src/features/invoices/lib/pdf-column-catalog.ts
  {
    key: 'distance_km',
    label: 'km',
    uiLabel: 'Fahrtstrecke (km)',
    description: 'Gefahrene Strecke in Kilometern',
    dataField: 'distance_km',
    defaultWidthPt: 40,
    minWidthPt: 32,
    align: 'right',
    format: 'km',
    flatOnly: true
  },
```

- **key:** `distance_km`
- **label:** `km`
- **uiLabel:** `Fahrtstrecke (km)`
- **dataField:** `distance_km`
- **No** `valueSource`; **no** catalog-level `total`/`sum` — per-line km is read from the row field. **Grouped** layouts use a **separate** catalog entry `total_km` (`groupedOnly: true`, `dataField: 'total_km'`) populated by summary builders that sum `distance_km` (see §7).

```333:344:src/features/invoices/lib/pdf-column-catalog.ts
  {
    key: 'total_km',
    label: 'Strecke',
    uiLabel: 'Gesamtstrecke (km)',
    description: 'Summe aller Kilometer in dieser Gruppe',
    dataField: 'total_km',
    defaultWidthPt: 48,
    minWidthPt: 40,
    align: 'right',
    format: 'km',
    groupedOnly: true
  },
```

### 9. `effective_distance_km` in PDF document vs catalog

- **`InvoicePdfDocument.tsx`:** Present **only** on the **`lineItemsForCalc`** mapping (see §7 snippet: `effective_distance_km: li.effective_distance_km ?? li.distance_km`). Not used for PDF table rendering in this file.
- **`pdf-column-catalog.ts`:** **No** entry with `dataField: 'effective_distance_km'` or key `effective_distance_km`.

**Minimal change to show billed/effective KM in PDF tables:** either **(A)** change the existing `distance_km` column’s `dataField` to `effective_distance_km` (and ensure every row shape passed to the PDF pipeline includes it — `InvoiceLineItemRow` already has `effective_distance_km`), **or (B)** add a **new** catalog key (e.g. `effective_distance_km`) with `dataField: 'effective_distance_km'` and migrate Vorlagen/pickers if the old routing-only column must remain. **Grouped `total_km`** today sums `distance_km`; showing effective km in groups would require updating `build-invoice-pdf-summary.ts` (and possibly `buildInvoicePdfGroupedByBillingType` / single-row helpers) to sum **`effective_distance_km`** (with the same null-guard semantics) — not only a catalog line change.

### 10. How PDF receives line item data — `BuilderLineItem[]` vs persisted rows

Path: `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`

- **Totals:** `calculateInvoiceTotals(lineItemsForCalc)` where `lineItemsForCalc` is **derived from** `invoice.line_items` (`InvoiceDetail['line_items']` / `InvoiceLineItemRow[]`) mapped into **`BuilderLineItem[]`** for the calculator.
- **Cover main table:** `summaryItems` from `buildInvoicePdfSingleRow` / `buildInvoicePdfGroupedByBillingType` / `buildInvoicePdfSummary` — all take **`invoice.line_items`** (persisted snapshots).
- **Appendix:** `InvoicePdfAppendix` receives **`lineItems={invoice.line_items}`** (or grouped slices), not the `lineItemsForCalc` array.

**Draft preview:** `InvoicePdfDocumentProps` documents optional `columnProfile` for builder preview; draft detail assembly (e.g. `build-draft-invoice-detail-for-pdf.ts`) still produces **`InvoiceDetail` with `line_items`** snapshots. **Both** persisted invoices and draft preview ultimately feed **`InvoiceLineItemRow[]`** into the PDF table path; the **`BuilderLineItem[]`** mapping here is **only** for total calculation in this component.

### 11. Full `PriceResolution` type; rule reconstruction

Path: `src/features/invoices/types/pricing.types.ts`

```109:126:src/features/invoices/types/pricing.types.ts
export interface PriceResolution {
  gross: number | null;
  /** Base transport net only — excludes Anfahrtspreis. */
  net: number | null;
  tax_rate: number;
  strategy_used: PriceStrategyUsed;
  source: PriceResolutionSource;
  note?: string;
  /** Net unit price (invoice line semantics). */
  unit_price_net: number | null;
  /** Billing quantity (1 for flat; driving_distance_km for per-km). */
  quantity: number;
  /**
   * Flat Anfahrtspreis (net) in addition to base transport. Omitted when none applies.
   * Not included in `net` / `gross`. Line total net = `net` + `(approach_fee_net ?? 0)` at persistence.
   */
  approach_fee_net?: number | null;
}
```

**Enough to reconstruct full pricing rule (strategy + config)?** **No.** `PriceResolution` captures **outcome** (amounts, `strategy_used`, `source`, `quantity`, optional `approach_fee_net`) but **not** rule identity, `config` JSON (tiers, thresholds, time windows), or `_price_gross` synthetic fields. Phase 3 repricing from KM changes needs either **retaining `BillingPricingRuleLike` (or rule id + config)** on the line item / builder state or **re-resolving** the rule from the same inputs used in `buildLineItemsFromTrips`.

### 12. Is `rule` stored on `BuilderLineItem` after `buildLineItemsFromTrips`?

Path: `src/features/invoices/api/invoice-line-items.api.ts`

`resolvePricingRule` returns `rule`, passed only into **`resolveTripPricePure`**. The returned **`BuilderLineItem`** objects include **`price_resolution`** (and copies like `originalPriceResolution`) but **do not** assign `rule` to any property.

```344:366:src/features/invoices/api/invoice-line-items.api.ts
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
        driving_distance_km: effectiveDistanceKm,
        scheduled_at: trip.scheduled_at,
        client: trip.client
      },
      taxRate,
      rule
    );
```

The built object (lines 393–435) sets `price_resolution`, not `rule`. **`rule` is discarded** after the resolver returns.

### 13. `BillingPricingRuleLike` — fields and import location

Path: `src/features/invoices/types/pricing.types.ts`

```82:93:src/features/invoices/types/pricing.types.ts
export interface BillingPricingRuleLike {
  id: string;
  company_id: string;
  payer_id: string | null;
  billing_type_id: string | null;
  billing_variant_id: string | null;
  strategy: PricingStrategy;
  config: unknown;
  is_active: boolean;
  /** Gross € from `client_price_tags` when this object is a synthetic STEP 0 hit. */
  _price_gross?: number;
}
```

Path: `src/features/invoices/api/invoice-line-items.api.ts` — **imported from** `../types/pricing.types` (shared types file), not defined locally.

```34:37:src/features/invoices/api/invoice-line-items.api.ts
import type {
  BillingPricingRuleLike,
  ClientPriceTagLike
} from '../types/pricing.types';
```

---

*(End of Audit 3.)*

## Audit 4 — Multi-variant selection in Step 2 (Monatliche Abrechnung)

Read-only audit (2026-05-05). Scope: invoice builder Step 1–2, trip fetch, builder state, PDF/invoice header. **Finding:** For `mode === 'monthly'` (and `single_trip`), Step 2 does **not** expose an Unterart (`billing_variant_id`) picker; only **Fahrgast** (`per_client`) mode binds variant through the combined “Abrechnung” `<Select>`. Monthly runs with `billing_variant_id: null` unless changed by future UI.

### 1. What component renders Step 2?

**Path:** `src/features/invoices/components/invoice-builder/step-2-params.tsx`  
**Component:** `Step2Params`

```100:107:src/features/invoices/components/invoice-builder/step-2-params.tsx
/** Step 2: Payer, date range, billing type, and (per_client) client picker. */
export function Step2Params({
  mode,
  payers,
  clients,
  isLoadingTrips,
  onNext
}: Step2ParamsProps) {
```

It is mounted from the builder shell:

```550:556:src/features/invoices/components/invoice-builder/index.tsx
            <Step2Params
              mode={(step2Values?.mode as InvoiceMode) ?? 'monthly'}
              payers={payers}
              clients={clients}
              isLoadingTrips={isLoadingTrips}
              onNext={handleStep2Complete}
            />
```

### 2. How is variant selection implemented (control type + JSX)?

**Monthly / standard modes (`mode !== 'per_client'`):** There is **no** Unterart control. The “standard flow” renders Kostenträger `<Select>` and optional **Abrechnungsart** `<Select>` (`billing_type_id` only)—no `billing_variant_id` field in JSX.

```360:431:src/features/invoices/components/invoice-builder/step-2-params.tsx
          {/* ─── Standard Mode Flow (ALL OTHER MODES) ────────────────────── */}
          {mode !== 'per_client' && (
            <>
              {/* Payer picker */}
              <FormField
                control={form.control}
                name='payer_id'
                render={({ field }) => (
                  <FormItem>
                    ...
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
...
              {/* Billing type filter (optional) */}
              {billingTypes.length > 0 && (
                <FormField
                  control={form.control}
                  name='billing_type_id'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Abrechnungsart (optional)</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ?? 'all'}
                          onValueChange={(val) =>
                            field.onChange(val === 'all' ? null : val)
                          }
                        >
```

**`per_client` mode:** One `<Select>` for “Abrechnung” encodes **`payer_id` + `billing_variant_id`** via a composite value `payerId|variantId` (variant segment may be empty).

```276:346:src/features/invoices/components/invoice-builder/step-2-params.tsx
                        <Select
                          value={combinedValue}
                          onValueChange={(val) => {
                            const [pId, rawVariant] = val.split('|');
                            const variantId =
                              rawVariant && rawVariant.length > 0
                                ? rawVariant
                                : null;
                            field.onChange(pId);
                            const comb = clientCombinations.find(
                              (c) =>
                                c.payer_id === pId &&
                                (c.billing_variant_id ?? '') ===
                                  (variantId ?? '')
                            );
                            form.setValue('billing_variant_id', variantId, {
                              shouldValidate: true
                            });
                            form.setValue(
                              'billing_type_id',
                              comb?.billing_type_id ?? null,
                              { shouldValidate: true }
                            );
                          }}
                        >
...
                          <SelectContent>
                            ...
                              clientCombinations.map((comb) => {
...
                                const valStr = `${comb.payer_id}|${comb.billing_variant_id || ''}`;
                                return (
                                  <SelectItem key={valStr} value={valStr}>
                                    {label}
                                  </SelectItem>
                                );
                              })
```

### 3. Current options; is there “alle Varianten”?

- **Monthly:** No explicit “alle Varianten” list. Optional **“Alle Abrechnungsarten”** applies to **`billing_type_id`**, not to `billing_variant_id`:

```412:415:src/features/invoices/components/invoice-builder/step-2-params.tsx
                          <SelectContent>
                            <SelectItem value='all'>
                              Alle Abrechnungsarten
                            </SelectItem>
```

- **`per_client`:** Options are **historical payer + Unterart combinations** from `useClientPayers` (`clientCombinations.map` → one `<SelectItem>` per combo). There is no separate “all variants” entry; scope is always one selected combo (variant id may be null for that row).

### 4. State variable for selected variant(s) — type and initialisation

**Form field:** `billing_variant_id` on react-hook-form state, typed via Zod-inferred `Step2Values`.

```55:64:src/features/invoices/components/invoice-builder/step-2-params.tsx
const step2Schema = z.object({
  payer_id: z.string().uuid(),
  billing_type_id: z.string().uuid().nullish().or(z.literal('')),
  billing_variant_id: z.string().uuid().nullable().nullish().or(z.literal('')),
  period_from: z.string().min(1, 'Startdatum erforderlich'),
  period_to: z.string().min(1, 'Enddatum erforderlich'),
  client_id: z.string().uuid().nullish().or(z.literal(''))
});

type Step2Values = z.infer<typeof step2Schema>;
```

**Defaults:**

```113:120:src/features/invoices/components/invoice-builder/step-2-params.tsx
    defaultValues: {
      payer_id: '',
      billing_type_id: null,
      billing_variant_id: null,
      period_from: '',
      period_to: '',
      client_id: null
    }
```

**Submit normalisation** (empty string → `null`):

```197:206:src/features/invoices/components/invoice-builder/step-2-params.tsx
  const onSubmit = (values: Step2Values) => {
    onNext({
      payer_id: values.payer_id,
      billing_type_id: values.billing_type_id || null,
      billing_variant_id: values.billing_variant_id || null,
      period_from: values.period_from,
      period_to: values.period_to,
      client_id: values.client_id || null,
      mode
    });
  };
```

**Builder hook:** `useInvoiceBuilder` holds `step2Values` as `useState<Step2Values | null>(null)` where `Step2Values` is `Pick<InvoiceBuilderFormValues, 'mode' | 'payer_id' | 'billing_type_id' | 'billing_variant_id' | 'period_from' | 'period_to' | 'client_id'>`:

```47:57:src/features/invoices/hooks/use-invoice-builder.ts
type Step2Values = Pick<
  InvoiceBuilderFormValues,
  | 'mode'
  | 'payer_id'
  | 'billing_type_id'
  | 'billing_variant_id'
  | 'period_from'
  | 'period_to'
  | 'client_id'
>;
```

```96:96:src/features/invoices/hooks/use-invoice-builder.ts
  const [step2Values, setStep2Values] = useState<Step2Values | null>(null);
```

**Canonical schema comment** on `InvoiceBuilderFormValues`:

```342:347:src/features/invoices/types/invoice.types.ts
  /**
   * Optional: scope trips to exactly one Unterart (billing_variants.id).
   * NULL means "all Unterarten" (subject to billing_type_id filter if present).
   */
  billing_variant_id: z.string().uuid().nullable(),
```

**Summary:** At most **one** UUID or **`null`** — not `string[]`.

### 5. `fetchTripsForBuilder`: how is the selected variant used to filter trips?

Filtering is done **in the Supabase query** via PostgREST chaining: **either** `.eq('billing_variant_id', variantId)` **or** `.in('billing_variant_id', variantIdsForType)`, **or** neither when no variant scope applies.

`variantId` / `variantIdsForType` come from `resolveBillingVariantFilters` (see Q7).

```204:208:src/features/invoices/api/invoice-line-items.api.ts
  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }
```

There is **no** client-side `.filter()` on trips by variant after fetch in this function.

### 6. JS post-fetch variant filtering?

**None** in `fetchTripsForBuilder` for variant: the function maps client IDs and loads tags/overrides only:

```217:232:src/features/invoices/api/invoice-line-items.api.ts
  const { data, error } = await query;

  if (error) throw toQueryError(error);
  const trips = (data ?? []) as unknown as TripForInvoice[];
  const clientIds = [
    ...new Set(
      trips
        .map((t) => t.client?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  ];
  const [clientPriceTags, clientKmOverrides] = await Promise.all([
    listClientPriceTagsForClientIds(clientIds),
    listClientKmOverridesForClientIds(clientIds)
  ]);
  return { trips, clientPriceTags, clientKmOverrides };
```

### 7. “Alle Varianten” / no variant selection today

Behavior is driven by **`resolveBillingVariantFilters`**:

```72:101:src/features/invoices/api/invoice-line-items.api.ts
async function resolveBillingVariantFilters(
  params: FetchTripsForBuilderParams
): Promise<{
  variantId: string | null;
  variantIdsForType: string[] | null;
  /** billing_type scoped but zero variants resolve — callers return empty arrays */
  abortEmpty: boolean;
}> {
  const supabase = createClient();
  const variantId =
    params.billing_variant_id && params.billing_variant_id.length > 0
      ? params.billing_variant_id
      : null;

  let variantIdsForType: string[] | null = null;
  if (!variantId && params.billing_type_id) {
    const { data: variants, error: vErr } = await supabase
      .from('billing_variants')
      .select('id')
      .eq('billing_type_id', params.billing_type_id);
    if (vErr) throw toQueryError(vErr);
    variantIdsForType = (variants ?? []).map((v) => v.id);
    if (variantIdsForType.length === 0) {
      return { variantId: null, variantIdsForType: null, abortEmpty: true };
    }
  }

  return { variantId, variantIdsForType, abortEmpty: false };
}
```

- **`billing_variant_id` set:** single-variant scope → `.eq`.
- **`billing_variant_id` null + `billing_type_id` set:** all variants **of that family** → `.in` with IDs from `billing_variants`.
- **`billing_variant_id` null + `billing_type_id` null:** **no** `billing_variant_id` predicate on the trips query → **all Unterarten** for the payer in the date range (subject to other filters: payer, period, status, optional `client_id`).

No special sentinel string is used in the fetch layer; “all” is represented by **omitting** the variant filter (and optionally narrowing by type).

### 8. Builder state passed from Step 2 into Step 3

Step 3 consumes **`lineItems`** (and loading flags) from the hook, not a raw “step 2 object”. The **persisted slice** that Step 2 submits and the hook stores is `step2Values` with this shape (from `Pick` + `InvoiceBuilderFormValues`):

| Field | Role |
|--------|------|
| `mode` | `monthly` \| `single_trip` \| `per_client` |
| `payer_id` | Kostenträger UUID |
| `billing_type_id` | Optional Abrechnungsfamilie filter; `null` = all types |
| `billing_variant_id` | Optional single Unterart; `null` = not scoped to one variant (monthly default) |
| `period_from` / `period_to` | Zeitraum (ymd strings) |
| `client_id` | Fahrgast UUID or `null` (required when `mode === 'per_client'`) |

```340:343:src/features/invoices/hooks/use-invoice-builder.ts
  const handleStep2Complete = useCallback((values: Step2Values) => {
    setSection3Confirmed(false);
    setStep2Values(values);
  }, []);
```

Section-gating **does not** require `billing_variant_id` to be set:

```29:44:src/features/invoices/lib/invoice-builder-section-guards.ts
export function isInvoiceBuilderSection2Complete(
  step2Values: InvoiceBuilderStep2Slice
): boolean {
  if (
    !step2Values?.mode ||
    !step2Values.payer_id ||
    !step2Values.period_from ||
    !step2Values.period_to
  ) {
    return false;
  }
  if (step2Values.mode === 'per_client' && !step2Values.client_id) {
    return false;
  }
  return true;
}
```

*(Note: `InvoiceBuilderStep2Slice` type omits `billing_variant_id` from its `Pick`, but runtime `step2Values` in the hook is the wider `Step2Values` that **includes** `billing_variant_id`.)*

### 9. Step 3 grouping / labelling by variant

- **Step 3 UI:** Line items are a **flat list** in trip fetch order (`order('scheduled_at', { ascending: true })` in `fetchTripsForBuilder`). There is **no** variant-based grouping in `step-3-line-items.tsx`.
- **Per-row labels:** Each `BuilderLineItem` carries **`billing_variant_name`**, **`billing_variant_code`**, **`billing_type_name`** (snapshots from the trip join). The expanded row can show a **badge** for `billing_variant_name` (and related flags)—not a grouped section header.

```453:457:src/features/invoices/types/invoice.types.ts
  /** From joined `billing_variants.code` on the trip. */
  billing_variant_code: string | null;
  /** From joined `billing_variants.name` on the trip. */
  billing_variant_name: string | null;
  /** From joined `billing_types.name` via billing_variants.billing_type (family label). */
  billing_type_name: string | null;
```

### 10. PDF / invoice header: which variant(s) are recorded?

- **`invoices` row:** On create, **`billing_variant_id`** is copied from **`formValues.billing_variant_id`** (null = multi-variant invoice per comment).

```281:289:src/features/invoices/api/invoices.api.ts
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      company_id: payload.companyId,
      invoice_number: invoiceNumber,
      payer_id: payload.formValues.payer_id,
      billing_type_id: payload.formValues.billing_type_id,
      // Set when the invoice is scoped to exactly one Unterart (billing_variants.id); NULL otherwise.
      billing_variant_id: payload.formValues.billing_variant_id ?? null,
```

```69:70:src/features/invoices/types/invoice.types.ts
  /** Optional Unterart scope (billing_variants.id). NULL = multi-variant invoice. */
  billing_variant_id: string | null;
```

- **Draft PDF preview:** `buildDraftInvoiceDetailForPdf` sets the synthetic invoice’s **`billing_variant_id`** from **`step2.billing_variant_id`**.

```174:181:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
  const base = {
    id: '__pdf_preview__',
    company_id: companyId,
    invoice_number: placeholderInvoiceNumber,
    payer_id: step2.payer_id,
    billing_type_id: step2.billing_type_id,
    billing_variant_id: step2.billing_variant_id,
```

- **Line-level truth for mixed-variant invoices:** Each persisted line has **`billing_variant_name` / `billing_variant_code`** (and optional **`billing_type_name`**) on `invoice_line_items` / `BuilderLineItem`; PDF layouts like **`grouped_by_billing_type`** can group by these **snapshots** (see `build-invoice-pdf-summary.ts` / docs), independent of whether the invoice header `billing_variant_id` is null.

### 11. Other references to builder `billing_variant_id` (outside Step 2 UI and `fetchTripsForBuilder`)

Files that thread **`step2Values.billing_variant_id`** / **`InvoiceBuilderStep2Snapshot.billing_variant_id`** / query keys (same param name):

| File | Usage |
|------|--------|
| `src/features/invoices/hooks/use-invoice-builder.ts` | `invoiceKeys.tripsForBuilder({ … billing_variant_id: step2Values.billing_variant_id })`; `fetchTripsForBuilder` / `fetchCancelledTripsForBuilder` params; `createInvoice` merges `...step2Values` into `fullValues`. |
| `src/features/invoices/components/invoice-builder/index.tsx` | `step2Snapshot` includes `billing_variant_id: step2Values.billing_variant_id ?? null` for PDF preview input. |
| `src/query/keys/invoices.ts` | `tripsForBuilder` key object includes `billing_variant_id?: string \| null`. |
| `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` | `InvoiceBuilderStep2Snapshot.billing_variant_id`; copied onto draft `InvoiceDetail`. |
| `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` | Passes `step2Values` into `buildDraftInvoiceDetailForPdf({ step2: step2Values, … })`. |
| `src/features/invoices/api/invoices.api.ts` | Persists `billing_variant_id` on `invoices` insert from `payload.formValues`. |

**Not listed:** Trip CRUD, recurring rules, trips filter bar, pricing-rule tables, etc.—those use `billing_variant_id` on **trips/DB entities**, not the **invoice builder Step 2 selection state**.

### Reference: `billing_variants.Row` (database.types)

```134:145:src/types/database.types.ts
      billing_variants: {
        Row: {
          billing_type_id: string;
          code: string;
          created_at: string;
          id: string;
          kts_default: boolean | null;
          name: string;
          no_invoice_required_default: boolean | null;
          rechnungsempfaenger_id: string | null;
          sort_order: number;
        };
```

### Step 1 — “Monatliche Abrechnung” selection

**Path:** `src/features/invoices/components/invoice-builder/step-1-mode.tsx`  
**Component:** `Step1Mode` — three **`<button>`** cards (not `<input type="radio">`). “Monatliche Abrechnung” is `mode: 'monthly'`.

```29:36:src/features/invoices/components/invoice-builder/step-1-mode.tsx
const MODES: ModeCard[] = [
  {
    mode: 'monthly',
    icon: Calendar,
    title: 'Monatliche Abrechnung',
    description:
      'Alle Fahrten eines Kostenträgers in einem Zeitraum (z. B. ganzer Monat). Häufigster Fall.'
  },
```

```66:71:src/features/invoices/components/invoice-builder/step-1-mode.tsx
        {MODES.map(({ mode, icon: Icon, title, description }) => (
          <button
            key={mode}
            type='button'
            onClick={() => onSelect(mode)}
```

Payer choice happens only in **Step 2** (`Step2Params`), not Step 1.

---

*(End of Audit 4.)*
