Phase 8 — Anfahrtspreis + Extended Grouped Summary Columns
Two connected features:

Anfahrtspreis — a flat per-trip approach fee added to the existing pricing cascade

Extended InvoicePdfSummaryRow — new columns: trip count, total km, Anfahrtskosten, Beförderungskosten, Gesamtkosten netto/brutto

single_row layout — new main_layout option that collapses all trips into one summary row per invoice
Work in the order below. Each step has a clear scope and file list.
Step 1 — DB Migration

File: supabase/migrations/20260406120000_invoice_line_items_approach_fee.sql
sql
-- Adds approach fee (Anfahrtspreis) as a separate net amount on each line item.
-- Nullable: existing rows have no approach fee (treat as 0 in all calculations).
-- Stored as net (Netto) consistent with unit_price semantics on this table.
ALTER TABLE invoice_line_items
  ADD COLUMN approach_fee_net numeric(10, 2) DEFAULT NULL;
COMMENT ON COLUMN invoice_line_items.approach_fee_net IS
  'Optional flat Anfahrtspreis (net) added on top of the base transport price. '
  'Null on rows created before this migration — treat as 0. '
  'Grossed with tax_rate when computing total_price.';

Note: total_price stays as the full gross (base + approach, grossed). The split is only visible via price_resolution_snapshot.approach_fee_net.
Step 2 — Pricing Rule Config Schema

File: src/features/invoices/lib/pricing-rule-config.schema.ts
Add approach_fee_net as an optional field to every strategy config via a shared mixin — not per-strategy, because any strategy may optionally have an Anfahrtspreis:
typescript
// Shared optional approach fee — applies to every strategy
const approachFeeSchema = z.object({
  approach_fee_net: z.number().min(0).nullable().optional(),
})
// Apply to every strategy config using .merge():
const tieredKmConfigSchema = z.object({
  tiers: z.array(kmTierSchema).min(1),
}).merge(approachFeeSchema)
// Repeat for fixedBelowThresholdThenKmConfigSchema, timeBasedConfigSchema.
// For emptyConfigSchema strategies (client_price_tag, manual_trip_price, no_price):
const emptyConfigSchema = z.object({}).merge(approachFeeSchema)

Export a helper type:
typescript
export type ApproachFeeConfig = { approach_fee_net?: number | null }
Step 3 — PriceResolution Type

File: src/features/invoices/types/pricing.types.ts
Add one optional field to PriceResolution:
typescript
export interface PriceResolution {
  gross: number | null;
  net: number | null;           // base transport net only (excludes approach fee)
  tax_rate: number;
  strategy_used: PriceStrategyUsed;
  source: PriceResolutionSource;
  note?: string;
  unit_price_net: number | null;
  quantity: number;
  /** Flat Anfahrtspreis (net) charged in addition to the base transport price.
   *  Undefined/null if no approach fee applies.
   *  Not included in `net` or `gross` — callers add it separately for display splits.
   *  total_net = net + (approach_fee_net ?? 0)
   *  total_gross = total_net * (1 + tax_rate)
   */
  approach_fee_net?: number | null
}

Important design decision: net and gross on PriceResolution represent the base transport price only (Beförderungspreis). The approach fee is additive and tracked separately. This enables the PDF to show the split (Anfahrtskosten vs. Beförderungskosten) without any parsing.
Step 4 — resolveTripPrice

File: src/features/invoices/lib/resolve-trip-price.ts
After the existing cascade resolves the base price, append the approach fee if the rule config has one:
typescript
// At the end of resolveTripPrice, after the cascade resolves baseResolution:
const approachFeeNet = (rule?.config as ApproachFeeConfig)?.approach_fee_net ?? null
return {
  ...baseResolution,
  approach_fee_net: approachFeeNet ?? undefined,
}

Note: net and gross on the returned resolution remain the base transport price. The approach fee is additive metadata only. The caller (buildLineItemsFromTrips) is responsible for computing the full total.
Step 5 — BuilderLineItem

File: src/features/invoices/types/invoice.types.ts
Add to BuilderLineItem:
typescript
/** Net Anfahrtspreis for this trip. Null if no approach fee applies. */
approach_fee_net: number | null

In buildLineItemsFromTrips, map it from the resolution:
typescript
approach_fee_net: priceResolution.approach_fee_net ?? null,
Step 6 — insertLineItems (total_price calculation)

File: src/features/invoices/api/invoice-line-items.api.ts
Update the total_price calculation to include the approach fee in the gross:
typescript
// Before:
total_price: (item.unit_price ?? 0) * item.quantity * (1 + item.tax_rate),
// After:
total_price: (
  (item.unit_price ?? 0) * item.quantity + (item.approach_fee_net ?? 0)
) * (1 + item.tax_rate),

Also persist the new column:
typescript
approach_fee_net: item.approach_fee_net ?? null,

Add a comment:
typescript
// total_price = (base_net + approach_fee_net) × (1 + tax_rate)
// Both components share the same tax_rate (Personenbeförderung).
// The split is preserved in price_resolution_snapshot.approach_fee_net for PDF rendering.
Step 7 — InvoiceLineItemRow Type

File: src/features/invoices/types/invoice.types.ts
Add to InvoiceLineItemRow:
typescript
/** Net Anfahrtspreis snapshot. Null on rows before this feature existed — treat as 0. */
approach_fee_net: number | null
Step 8 — builderItemToDraftLineItem

File: src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
Map the new field:
typescript
approach_fee_net: item.approach_fee_net ?? null,
Step 9 — Extended InvoicePdfSummaryRow + buildInvoicePdfSummary

File: src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts
Add fields to InvoicePdfSummaryRow:
typescript
export interface InvoicePdfSummaryRow {
  // existing fields unchanged...
  id: string
  position: number
  from: CanonicalPlace
  to: CanonicalPlace
  tax_rate: number
  total_price: number          // aggregated net (base + approach) — existing semantics preserved
  quantity: number             // trip count — existing semantics preserved
  descriptionPrimary: string
  descriptionSecondary: string
  description: string
  // new fields
  /** Sum of distance_km across all trips in this group. Null if any trip has null distance. */
  total_km: number | null
  /** Sum of approach_fee_net across all trips in this group. 0 if no approach fees. */
  approach_costs_net: number
  /** Base transport net = total_price - approach_costs_net */
  transport_costs_net: number
  /** Total gross = total_net × (1 + tax_rate) */
  total_costs_gross: number
}
Update RouteGroupAgg accumulator:
typescript
interface RouteGroupAgg {
  // existing...
  count: number
  total_price: number   // net (existing)
  // new
  total_km: number | null
  approach_costs_net: number
  has_null_km: boolean
}
Update the accumulation loop:
typescript
// Per line item in the group:
group.total_km = group.has_null_km ? null
  : item.distance_km == null
    ? (group.has_null_km = true, null)
    : (group.total_km ?? 0) + item.distance_km
group.approach_costs_net += item.approach_fee_net ?? 0
Map to InvoicePdfSummaryRow:
typescript
const totalNet = group.total_price  // base net + approach net (lineNetEurForPdfLineItem already sums both)
const approachNet = group.approach_costs_net
const transportNet = totalNet - approachNet
const totalGross = totalNet * (1 + group.tax_rate)
return {
  // existing fields...
  total_km: group.total_km,
  approach_costs_net: approachNet,
  transport_costs_net: transportNet,
  total_costs_gross: totalGross,
}
Step 10 — single_row Layout Mode

File: src/features/invoices/lib/build-invoice-pdf-summary.ts
Add a second export function buildInvoicePdfSingleRow that collapses all trips into one row:
typescript
/**
 * Collapses all line items into a single InvoicePdfSummaryRow.
 * Used for Kostenträger that want one summary line instead of per-route groups.
 * The row's descriptionPrimary is the invoice subject / payer name (passed as param).
 */
export function buildInvoicePdfSingleRow(
  lineItems: InvoiceLineItemRow[],
  label: string
): InvoicePdfSummaryRow {
  // Sum all items into a single accumulator using the same logic as buildInvoicePdfSummary
  // but without route grouping.
}

File: src/features/invoices/types/pdf-vorlage.types.ts
Add 'single_row' to the main_layout union:
typescript
export type MainLayout = 'grouped' | 'flat' | 'single_row'

Update Zod schema and DB migration for pdf_vorlagen.main_layout to allow 'single_row'.
File: src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx
Add a third branch for single_row:
typescript
const rows =
  columnProfile.main_layout === 'grouped' ? buildInvoicePdfSummary(invoice)
  : columnProfile.main_layout === 'single_row' ? [buildInvoicePdfSingleRow(invoice.line_items, invoice.subject ?? '')]
  : invoice.line_items  // flat
Step 11 — PDF Column Catalog

File: src/features/invoices/components/invoice-pdf/pdf-column-catalog.ts
Add new catalog entries (all groupedOnly: false unless noted — they work in grouped, single_row, and appendix):
typescript
{
  key: 'trip_count',
  label: 'Anzahl',
  uiLabel: 'Anzahl Fahrten',
  description: 'Anzahl der Fahrten in dieser Gruppe',
  dataField: 'quantity',     // InvoicePdfSummaryRow.quantity = trip count
  format: 'integer',
  defaultWidthPt: 32,
  minWidthPt: 28,
  groupedOnly: true,
  appendixOnly: false,
  flatOnly: false,
},
{
  key: 'total_km',
  label: 'Strecke',
  uiLabel: 'Gesamtstrecke (km)',
  description: 'Summe aller Kilometer in dieser Gruppe',
  dataField: 'total_km',
  format: 'km',
  defaultWidthPt: 48,
  minWidthPt: 40,
  groupedOnly: true,
  flatOnly: false,
},
{
  key: 'approach_costs',
  label: 'Anfahrt',
  uiLabel: 'Anfahrtskosten',
  description: 'Anfahrtskosten (netto) für diese Gruppe',
  dataField: 'approach_costs_net',
  format: 'currency',
  defaultWidthPt: 55,
  minWidthPt: 44,
  groupedOnly: true,
  flatOnly: false,
},
{
  key: 'transport_costs',
  label: 'Beförderung',
  uiLabel: 'Beförderungskosten',
  description: 'Beförderungskosten ohne Anfahrt (netto)',
  dataField: 'transport_costs_net',
  format: 'currency',
  defaultWidthPt: 65,
  minWidthPt: 52,
  groupedOnly: true,
  flatOnly: false,
},
{
  key: 'total_net',
  label: 'Gesamt netto',
  uiLabel: 'Gesamtkosten (netto)',
  description: 'Beförderung + Anfahrt (netto)',
  dataField: 'total_price',   // InvoicePdfSummaryRow.total_price = total net
  format: 'currency',
  defaultWidthPt: 65,
  minWidthPt: 52,
  groupedOnly: true,
  flatOnly: false,
},
{
  key: 'total_gross',
  label: 'Gesamt brutto',
  uiLabel: 'Gesamtkosten (brutto)',
  description: 'Gesamtkosten inkl. MwSt.',
  dataField: 'total_costs_gross',
  format: 'currency',
  defaultWidthPt: 70,
  minWidthPt: 56,
  groupedOnly: true,
  flatOnly: false,
},
// Per-trip approach fee for flat/appendix layout:
{
  key: 'approach_fee_line',
  label: 'Anfahrt',
  uiLabel: 'Anfahrtskosten (Zeile)',
  description: 'Anfahrtspreis dieser einzelnen Fahrt (netto)',
  dataField: 'approach_fee_net',
  format: 'currency',
  defaultWidthPt: 52,
  minWidthPt: 44,
  flatOnly: true,
  groupedOnly: false,
},

Also update MAIN_GROUPED_COLUMNS and APPENDIX_COLUMNS to include the new keys where appropriate.
Step 12 — Vorlage Editor UI

File: src/components/layout/vorlage-editor-panel.tsx
Add 'single_row' to the main_layout radio:
tsx
<RadioGroupItem value="single_row" />
<Label>Eine Zeile (Gesamtübersicht)</Label>

When single_row is selected, use MAIN_GROUPED_COLUMNS as the available pool (same non-flatOnly columns) — single_row uses the same InvoicePdfSummaryRow shape as grouped.
Update the handleMainLayoutChange migration logic to treat single_row identically to grouped for column compatibility:
typescript
const validPool =
  newLayout === 'flat' ? MAIN_FLAT_COLUMNS : MAIN_GROUPED_COLUMNS
Step 13 — invoice-pdf-cover-body.tsx Layout Filter

Update mainTableKeys filtering to treat single_row like grouped:
typescript
const isGroupedMode = columnProfile.main_layout !== 'flat'
const mainTableKeys = columnProfile.main_columns.filter(key => {
  const col = PDF_COLUMN_MAP[key]
  if (!col) return false
  if (isGroupedMode && col.flatOnly) return false
  if (!isGroupedMode && col.groupedOnly) return false
  return true
})
Step 14 — renderGroupedCellValue: new fields

File: src/features/invoices/components/invoice-pdf/pdf-column-layout.ts
renderGroupedCellValue already handles InvoicePdfSummaryRow via getNestedValue. Since all new fields (total_km, approach_costs_net, transport_costs_net, total_costs_gross) are direct fields on the summary row with matching dataField strings, they will resolve automatically via the existing getNestedValue path. No changes needed here unless format: 'km' is not yet implemented.
Add 'km' format case if missing:
typescript
case 'km':
  return raw != null ? `${Number(raw).toLocaleString('de-DE')} km` : '—'
Step 15 — Builder UI: Anfahrtspreis display in Step 3

File: src/features/invoices/components/invoice-builder/step-3-line-items.tsx
In the line item row, show the approach fee when non-null:
tsx
{item.approach_fee_net != null && item.approach_fee_net > 0 && (
  <span className="text-xs text-muted-foreground">
    + {formatEur(item.approach_fee_net)} Anfahrt
  </span>
)}

This is display-only — the approach fee is not editable in the builder (it comes from the billing rule config). A tooltip can explain: "Anfahrtspreis gemäß Abrechnungsregel".
Step 16 — docs/pricing-engine.md

Add a section:
text
## Anfahrtspreis (Approach Fee)
An optional flat fee added on top of the base transport price. Configured per
billing pricing rule via `config.approach_fee_net` (net EUR, optional).
**Price math:**
total_net = base_net + approach_fee_net
total_gross = total_net × (1 + tax_rate)
The split is preserved in `price_resolution_snapshot.approach_fee_net` and in
`invoice_line_items.approach_fee_net` for audit and PDF rendering.
`PriceResolution.net` always contains the base transport net only.
Verification

Billing rule with approach_fee_net: 5.00 → line item total_price = (base_net + 5.00) × (1 + 0.07)

approach_fee_net: null on rule → line item approach_fee_net is null, total_price unchanged from pre-Phase-8

Old line items (approach_fee_net IS NULL) render as "—" in approach column — treated as 0 in sums

Grouped summary: approach_costs_net = sum of all line approach_fee_net (nulls = 0)

Grouped summary: transport_costs_net = total_price − approach_costs_net

Grouped summary: total_km = sum of distance_km; null if any trip has null distance

single_row layout: all trips collapse to one PDF row with correct aggregated totals

New columns appear in the Vorlage editor under Haupt- and Appendix-column pickers

Step 3 shows "+ €5,00 Anfahrt" badge on affected line items

bun run build passes

