# Price engine VAT audit (read-only)

Scope: **audit only, no code changes**. Findings based strictly on the current code in `src/` that computes trip and invoice prices.

## 1) Where is VAT applied in the price calculation chain?

### A. Trip price snapshot (`trips.gross_price`) — VAT applied once at the combined total (base net + approach net)

In the trip price engine wrapper, VAT is applied at the end when writing `gross_price` for the trip snapshot:

```263:275:src/features/trips/lib/trip-price-engine.ts
  const baseNetPrice = resolution.net;
  const approachFeeNet = resolution.approach_fee_net ?? 0;
  const totalGross =
    baseNetPrice !== null
      ? Math.round((baseNetPrice + approachFeeNet) * (1 + taxRate) * 100) / 100
      : null;

  return {
    gross_price: totalGross,
    tax_rate: baseNetPrice !== null ? taxRate : null,
    base_net_price: baseNetPrice,
    approach_fee_net: approachFeeNet
  };
```

**Implication:** for trip snapshots, VAT is not applied “per component” in separate steps; it’s applied once to \((base\_net + approach\_fee\_net)\).

### B. Invoice line totals (`invoice_line_items.total_price`) — VAT applied at line-total level; approach fee always grossed separately

For persisted invoice line items, VAT is applied when computing `total_price` during `insertLineItems`. There are two paths:

- **Gross-anchor** (`client_price_tag`): uses stored gross × quantity, then adds grossed-up `approach_fee_net`.
- **Net-anchor** (everything else): computes \(((unit\_price × quantity) + approach\_fee\_net) × (1 + tax\_rate)\) (rounded once at the line total).

```719:737:src/features/invoices/api/invoice-line-items.api.ts
    const total_price = isGrossAnchorClientPriceTag(frozen)
      ? frozen.gross! * item.quantity +
        (item.approach_fee_net ?? 0) * (1 + item.tax_rate)
      : ((item.unit_price ?? 0) * item.quantity +
          (item.approach_fee_net ?? 0)) *
        (1 + item.tax_rate);
```

### C. “Pure” price resolver (`PriceResolution.gross`) — VAT is derived from net inside `resolution()` (for net-anchor strategies), but **approach fee is excluded**

In the pure resolver, for net-anchor strategies, gross is derived from net via:

```199:201:src/features/invoices/lib/resolve-trip-price.ts
function grossFromNet(net: number, taxRate: number): number {
  return roundMoneyOnce(net * (1 + taxRate));
}
```

and used by `resolution()` when `partial.gross` isn’t explicitly provided:

```216:232:src/features/invoices/lib/resolve-trip-price.ts
  const net = partial.net;
  const gross =
    partial.gross !== undefined && partial.gross !== null
      ? partial.gross
      : net !== null && net !== undefined
        ? grossFromNet(net, taxRate)
        : null;
```

But **the resolver contract explicitly excludes** `approach_fee_net` from `priceResolution.gross` (approach is handled later at invoice line persistence / totals time and at trip snapshot time):

```73:78:src/features/invoices/lib/resolve-trip-price.ts
 * Always net-anchored regardless of the base transport strategy. It is stored
 * as net and grossed up with `× (1 + tax_rate)` in `insertLineItems` and in
 * `calculateInvoiceTotals`. It is NEVER included in `priceResolution.gross`.
```

## 2) Is VAT multiplication applied before or after the tiered km logic branches?

### Tiered km (`tiered_km`)

For `tiered_km`, the tier accumulation is net-only, then VAT is applied afterwards by `resolution()` (gross-from-net). The tier logic itself never multiplies VAT:

```174:197:src/features/invoices/lib/resolve-trip-price.ts
export function tieredNetTotal(distanceKm: number, tiers: KmTier[]): number {
  if (distanceKm <= 0) return 0;
  const sorted = [...tiers].sort((a, b) => a.from_km - b.from_km);
  let pos = 0;
  let raw = 0;
  let guard = 0;
  while (pos < distanceKm - 1e-9 && guard < 1000) {
    guard += 1;
    const tier = sorted.find(
      (t) => pos + 1e-9 >= t.from_km && (t.to_km === null || pos < t.to_km)
    );
    if (!tier) break;
    const cap =
      tier.to_km === null ? distanceKm : Math.min(tier.to_km, distanceKm);
    if (cap <= pos) break;
    const km = cap - pos;
    raw += km * tier.price_per_km;
    pos = cap;
  }
  return roundMoneyOnce(raw);
}
```

and then:

```303:318:src/features/invoices/lib/resolve-trip-price.ts
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

**Conclusion:** VAT is applied **after** the tiered km net total is computed (gross derived from net in `resolution()`), not per tier segment.

### Fixed below threshold then km (`fixed_below_threshold_then_km`) — explicit branch

This is the only tier-related strategy with a literal branch:

**Below threshold branch (commonly “<=5km” in configs where `threshold_km = 5`):**

```320:336:src/features/invoices/lib/resolve-trip-price.ts
    case 'fixed_below_threshold_then_km': {
      if (dist === null || dist === undefined) return null;
      const c = cfg as FixedBelowThresholdThenKmConfig;
      // Below threshold: flat net regardless of km (quantity 1).
      if (dist < c.threshold_km) {
        const n = roundMoneyOnce(c.fixed_price);
        return resolution(
          {
            net: n,
            strategy_used: 'fixed_below_threshold_then_km',
            source: scope,
            unit_price_net: n,
            quantity: 1
          },
          taxRate
        );
      }
```

**At/above threshold branch (commonly “>5km”):**

```337:349:src/features/invoices/lib/resolve-trip-price.ts
      // At/above threshold: full distance priced with km tiers (quantity = km).
      const totalNet = tieredNetTotal(dist, c.km_tiers);
      const unit = roundMoneyOnce(totalNet / dist);
      return resolution(
        {
          net: totalNet,
          strategy_used: 'fixed_below_threshold_then_km',
          source: scope,
          unit_price_net: unit,
          quantity: dist
        },
        taxRate
      );
    }
```

**Answering the specific question (“in the >5km code path, is VAT included in the final return value?”):**

- In **both** branches above, the returned value is `resolution(...)`, and `resolution()` includes gross-from-net when `partial.gross` is not provided:

```216:232:src/features/invoices/lib/resolve-trip-price.ts
  const gross =
    partial.gross !== undefined && partial.gross !== null
      ? partial.gross
      : net !== null && net !== undefined
        ? grossFromNet(net, taxRate)
        : null;
```

So **yes**, VAT is included in the returned `PriceResolution.gross` for both the below-threshold and above-threshold branches (unless `net` is null, which it is not in these two branch returns).

## 3) Are the per-km rates (2.30 and 1.99) stored as net or gross in DB / rule config?

### Billing pricing rules (tier rates) are **net**

The pricing rule dialog labels the per-km input explicitly as **net**:

```127:154:src/features/payers/components/pricing-rule-dialog/step2-rule-config.tsx
                <Label className='text-muted-foreground text-xs'>
                  €/km netto
                </Label>
```

The Zod schema validates `price_per_km` as a nonnegative number without any VAT/gross hint, and the resolver treats these as net amounts (it sums `km × price_per_km` into a net total, then VAT is applied later):

```15:21:src/features/invoices/lib/pricing-rule-config.schema.ts
export const kmTierSchema = z.object({
  // from_km: inclusive start of segment
  from_km: z.number().nonnegative(),
  // to_km: exclusive upper bound; null = unlimited tail
  to_km: z.number().nonnegative().nullable(),
  price_per_km: z.number().nonnegative()
});
```

and:

```193:197:src/features/invoices/lib/resolve-trip-price.ts
    const km = cap - pos;
    raw += km * tier.price_per_km;
```

**Conclusion:** per-km rates in `billing_pricing_rules.config` (`tiers[].price_per_km` / `km_tiers[].price_per_km`) are treated as **net** values.

### The “gross stored” exception is `client_price_tags.price_gross` / `clients.price_tag`

Client price tags are explicitly stored and handled as **gross**:

```44:51:src/features/invoices/lib/resolve-trip-price.ts
 * The client contract specifies a **gross** price (incl. VAT). The gross value
 * is the single source of truth and must never be recomputed from a rounded net.
```

and the STEP 0 selection returns `_price_gross`:

```63:75:src/features/invoices/lib/resolve-pricing-rule.ts
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
```

**So:**
- `2.30` / `1.99` (when they appear as km rates in `billing_pricing_rules.config`) are **net**.
- Client negotiated prices (`client_price_tags.price_gross` and legacy `clients.price_tag`) are **gross**.

## 4) Any early return / short-circuit / cached result in the >5km path that could skip VAT?

Within the tier/threshold strategies, there is **no** caching and no VAT “step” that is conditionally applied only for small distances:

- `tiered_km` always computes `totalNet` then returns `resolution(...)` (gross derived from net).
- `fixed_below_threshold_then_km` returns `resolution(...)` in both branches (gross derived from net).

Potential early returns exist only for:

- **Missing distance**: strategy returns `null` (unpriced), not “priced but missing VAT”.

```303:306:src/features/invoices/lib/resolve-trip-price.ts
    case 'tiered_km': {
      // Distance required: cannot price km tiers without driving_distance_km.
      if (dist === null || dist === undefined) return null;
```

and:

```320:322:src/features/invoices/lib/resolve-trip-price.ts
    case 'fixed_below_threshold_then_km': {
      if (dist === null || dist === undefined) return null;
```

- **KTS override** and **manual gross (taxameter)**: those short-circuit the entire pricing chain intentionally (and still set `tax_rate` in the resolution; for manual gross the net is derived via division by \(1+taxRate\)):

```418:438:src/features/invoices/lib/resolve-trip-price.ts
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

There is **no** mechanism in the >threshold branch that would compute a net amount but fail to apply VAT to the returned gross: both branches return through `resolution(...)`, whose gross derivation is uniform.

## 5) Where does invoice creation call the price engine? Same path as live price display?

### Invoice builder (creation flow)

The invoice creation flow is:

1) Fetch trips + rules, build line items (pricing happens here via pure resolver).
2) Calculate invoice totals from the built line items.
3) Create invoice header with those totals.
4) Insert line items (persists `total_price` and snapshots).

Pricing for invoice creation happens in `buildLineItemsFromTrips`:

```457:492:src/features/invoices/api/invoice-line-items.api.ts
    const effectiveDistanceKm = resolveEffectiveDistanceKm({ ... });
    const { rate: taxRate } = resolveTaxRate(effectiveDistanceKm);

    const rule = resolvePricingRule({ ... });

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

Invoice totals are computed (VAT applied per tax-rate bucket for net-anchor items; gross-anchor handled separately) in:

```607:689:src/features/invoices/api/invoice-line-items.api.ts
export function calculateInvoiceTotals(items: BuilderLineItem[]): {
  subtotal: number;
  taxAmount: number;
  total: number;
  breakdown: TaxBreakdown[];
} {
  // ...
  const taxNonTag = Object.entries(byRateNonTag).reduce(
    (sum, [rateStr, net]) => {
      return sum + Math.round(net * parseFloat(rateStr) * 100) / 100;
    },
    0
  );
  const total =
    Math.round((nonTagSubtotal + taxNonTag + grossFixed) * 100) / 100;
  const subtotal = Math.round((nonTagSubtotal + priceTagNetTotal) * 100) / 100;
  const taxAmount = Math.round((total - subtotal) * 100) / 100;
  // ...
}
```

The builder then writes the header row and line items:

```384:395:src/features/invoices/hooks/use-invoice-builder.ts
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

### Live trip price display path

The Fahrten table displays `trips.gross_price` and `trips.tax_rate` stored on the trip row:

```284:295:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'gross_price',
    accessorKey: 'gross_price',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Brutto' />
    ),
    cell: ({ row }) => {
      const value = row.original.gross_price as number | null | undefined;
      if (value == null) {
        return <span className='text-muted-foreground'>—</span>;
      }
      return <span className='tabular-nums'>{EUR_DE.format(value)}</span>;
    },
    enableColumnFilter: false
  },
```

and those trip fields are computed in `computeTripPrice` using the same pure resolver (`resolveTripPrice`) but then **re-grosses the combined base + approach at the end** for the trip snapshot:

```229:275:src/features/trips/lib/trip-price-engine.ts
  const { rate: taxRate } = resolveTaxRate(trip.driving_distance_km);
  // ...
  const resolution = resolveTripPrice(tripInput, taxRate, rule);
  // ...
  const totalGross =
    baseNetPrice !== null
      ? Math.round((baseNetPrice + approachFeeNet) * (1 + taxRate) * 100) / 100
      : null;
```

**Conclusion:** invoice creation and live trip snapshot pricing share the same underlying pure pricing resolver (`resolveTripPrice`), but they are **not the same exact final calculation path**:

- **Invoices**: price resolution + VAT is ultimately applied at **invoice line persistence** (`insertLineItems`) and **invoice totals** (`calculateInvoiceTotals`), with special gross-anchor handling for `client_price_tag`.
- **Trips**: snapshot `gross_price` is calculated by applying VAT once to \((base\_net + approach\_fee\_net)\) inside `computeTripPrice` (trip-level snapshot semantics).

This difference matters when investigating discrepancies between a trip’s displayed `gross_price` and an invoice line’s persisted `total_price` (they are computed from related data, but by different aggregation/rounding loci).

