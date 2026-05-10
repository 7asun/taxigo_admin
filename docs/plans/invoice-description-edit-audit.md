# Invoice row description edit — audit (read-only)

## Summary

Invoice row/position descriptions are **auto-generated client-side (TypeScript, in-browser)** when the invoice builder projects trips into `BuilderLineItem[]`, then **persisted immutably** into `invoice_line_items.description` on invoice creation. The PDF renderer **does not build descriptions** at render time; it either renders **grouped summary “Route/Leistung”** text (derived from addresses) or (in flat mode) prints the stored `invoice_line_items.description` field when the `description` column is selected in the resolved PDF profile. There is currently **no UI to edit the line-item description** in Step 3; the closest existing edit surface pattern is the Step 3 **inline gross override** input and the Step 4 **recipient override + text-block selection** that are saved as invoice snapshots.

## Auto-Generation Flow (with file refs + snippets)

### Where the description string is generated

The description is constructed inside `buildLineItemsFromTrips(...)` while building `BuilderLineItem[]`.

```ts
src/features/invoices/api/invoice-line-items.api.ts:L507-L527
const dateStr = trip.scheduled_at
  ? new Date(trip.scheduled_at).toLocaleDateString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })
  : null;

const description = [
  dateStr ? `Fahrt vom ${dateStr}` : 'Fahrt (kein Datum)',
  clientName
]
  .filter(Boolean)
  .join(' – ');

return {
  // ...
  description,
  // ...
} as Omit<BuilderLineItem, 'warnings'> & { _totalPrice: number | null };
```

- **Computed on**: frontend (browser) as part of the invoice builder’s trip → line-item projection.
- **Template**: `"Fahrt vom {dd.MM.yyyy} – {clientName}"` (fallback `"Fahrt (kein Datum)"`).
- **Inputs used**:
  - `trip.scheduled_at` (formatted via `toLocaleDateString('de-DE', ...)`)
  - `clientName` derived from either joined `clients(first_name,last_name)` or `trips.client_name` fallback:

```ts
src/features/invoices/api/invoice-line-items.api.ts:L501-L506
const clientName = trip.client
  ? [trip.client.first_name, trip.client.last_name].filter(Boolean).join(' ')
  : trip.client_name?.trim() || null;
```

### Where it is persisted (frozen snapshot)

On invoice creation, `insertLineItems(...)` persists `BuilderLineItem.description` into the DB as `invoice_line_items.description`.

```ts
src/features/invoices/api/invoice-line-items.api.ts:L768-L777
return {
  invoice_id: invoiceId,
  trip_id: item.trip_id,
  position: item.position,
  line_date: item.line_date,
  description: item.description,
  client_name: item.client_name,
  pickup_address: item.pickup_address,
  dropoff_address: item.dropoff_address,
  // ...
};
```

### Stored vs derived

- **Draft builder preview**: uses `BuilderLineItem.description` and maps it into a synthetic `InvoiceLineItemRow.description` for the PDF preview adapter:

```ts
src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts:L67-L76
return {
  // ...
  description: item.description,
  client_name: item.client_name,
  pickup_address: item.pickup_address,
  dropoff_address: item.dropoff_address,
  // ...
};
```

- **Issued invoice PDF**: uses the stored DB snapshot `invoice_line_items.description` (no re-generation at render time).

## Data Model (schema details)

### Does the table have a `description` column?

Yes — `public.invoice_line_items.description` exists and is **`TEXT NOT NULL`**.

```sql
supabase/migrations/20260331130000_create_invoice_line_items.sql:L50-L58
-- Human-readable description for this position.
-- Auto-generated from trip data; editable in the builder before finalizing.
-- Example: "Krankenfahrt vom 01.03.2026, Musterstraße → Klinikum".
description           TEXT          NOT NULL,
```

Additional schema commentary reiterates it is auto-generated and editable “in the builder”, but **no UI currently edits it** (see “Edit Surface” below):

```sql
supabase/migrations/20260331130000_create_invoice_line_items.sql:L166-L169
COMMENT ON COLUMN public.invoice_line_items.description IS
$$Human-readable description for this position.
Auto-generated from trip data; editable in the builder.
Example: "Krankenfahrt vom 01.03.2026, Musterstraße 1 → Klinikum".$$;
```

### Is it ever null?

- **DB level**: no (NOT NULL).
- **Runtime**: the generated string always has at least `"Fahrt (kein Datum)"` and/or `clientName`; `filter(Boolean)` ensures a non-empty array will still produce a string (but if both parts were falsy, it could become an empty string; current generation prevents that with the fallback label).

### Is there an override field today?

No. There is **no** `custom_description` / `description_override` column in migrations or types. The only persisted description is the required snapshot `description`.

## Template Variants (how single-row vs multi-row works)

### Where the template type/layout is stored

The “invoice template” that controls PDF table layout is **PDF-Vorlage**:

- `pdf_vorlagen.main_layout` (company-scoped template row)
- `payers.pdf_vorlage_id` (assign default template per payer)
- `invoices.pdf_column_override` (per-invoice snapshot override, immutable)

Schema introduction:

```sql
supabase/migrations/20260408120001_pdf_vorlagen.sql:L43-L49
main_layout      text NOT NULL DEFAULT 'grouped'
  CHECK (main_layout IN ('grouped', 'flat')),
```

Later expanded to include `single_row` and `grouped_by_billing_type`:

```sql
supabase/migrations/20260409130000_pdf_vorlagen_main_layout_billing_type.sql:L8-L10
CHECK (main_layout IN ('grouped', 'flat', 'single_row', 'grouped_by_billing_type'));
```

TypeScript union:

```ts
src/features/invoices/types/pdf-vorlage.types.ts:L18-L22
export type MainLayout =
  | 'grouped'
  | 'flat'
  | 'single_row'
  | 'grouped_by_billing_type';
```

### How the app decides which layout to use

The resolved effective column profile (including `main_layout`) is computed by the 4-level chain in `resolvePdfColumnProfile(...)`:

```ts
src/features/invoices/lib/resolve-pdf-column-profile.ts:L7-L13
 * 1. Invoice override — `invoices.pdf_column_override`
 * 2. Kostenträger Vorlage — `payers.pdf_vorlage_id` → `pdf_vorlagen`
 * 3. Company default — `pdf_vorlagen.is_default = true`
 * 4. System fallback — constants in `pdf-column-catalog.ts`
```

And it preserves stored `main_layout` from whichever tier won:

```ts
src/features/invoices/lib/resolve-pdf-column-profile.ts:L72-L80
if (override?.main_columns?.length && override.appendix_columns?.length) {
  // ...
  main_layout = override.main_layout ?? 'grouped';
}
```

### What “single-row” vs “multi-row” means in practice

In the PDF composer, `main_layout` chooses between:

- **`single_row`**: builds exactly one `InvoicePdfSummaryRow` on the cover page
- **`grouped`** or **`grouped_by_billing_type`**: builds multiple summary rows
- **`flat`**: prints one row per `invoice.line_items`

```ts
src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx:L341-L355
const summaryItems =
  effectiveProfile.main_layout === 'single_row'
    ? [buildInvoicePdfSingleRow(invoice.line_items, /* label */)]
    : effectiveProfile.main_layout === 'grouped_by_billing_type'
      ? buildInvoicePdfGroupedByBillingType(invoice.line_items)
      : buildInvoicePdfSummary(invoice).summaryItems;
```

## PDF Rendering (exact JSX refs)

### Where description is rendered in the PDF table

The cover page main table is rendered by `InvoicePdfCoverBody`.

#### Flat mode (one row per line item): `invoice_line_items.description`

In flat mode, each cell value is produced by `renderCellValue(lineItem, col)` and printed in a `<Text>` (or multi-line helper if it contains `\n`).

```tsx
src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx:L246-L285
: coercedFlatLineItems.map((lineItem, idx) => (
  <View key={lineItem.id} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
    {mainTableKeys.map((key, colIdx) => {
      const col = PDF_COLUMN_MAP[key];
      // ...
      const raw = renderCellValue(lineItem, col);
      const hasNl = raw.includes('\n');
      return (
        <View /* cell wrapper */>
          {hasNl ? (
            <MultilineCellText value={raw} fontSize={PDF_FONT_SIZES.sm} textAlign={col.align} />
          ) : (
            <Text style={{ fontSize: PDF_FONT_SIZES.sm, textAlign: col.align }}>
              {raw}
            </Text>
          )}
        </View>
      );
    })}
  </View>
))
```

The `description` column is defined as `dataField: 'description'` in the catalog:

```ts
src/features/invoices/lib/pdf-column-catalog.ts:L171-L181
{
  key: 'description',
  label: 'Beschreibung',
  uiLabel: 'Beschreibungstext',
  description: 'Freitextbeschreibung der Fahrt',
  dataField: 'description',
  // ...
  flatOnly: true
},
```

And the renderer reads it via `getNestedValue(item, col.dataField)` → `'text'` formatting:

```ts
src/features/invoices/components/invoice-pdf/pdf-column-layout.ts:L258-L279
const raw = rawForLineItem(item, col);
switch (col.format) {
  // ...
  case 'text':
    return formatTextCell(raw);
  // ...
}
```

#### Grouped / single-row / grouped_by_billing_type: NOT `invoice_line_items.description`

For grouped layouts, the main “description-like” text is the **Route/Leistung** column (two-line cell), derived from `InvoicePdfSummaryRow.descriptionPrimary` / `descriptionSecondary`, not from `invoice_line_items.description`.

```tsx
src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx:L189-L219
{isGroupedMode
  ? summaryItems.map((item, idx) => (
      <View key={item.id} style={[styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}]} wrap={false}>
        {mainTableKeys.map((key, colIdx) => {
          const col = PDF_COLUMN_MAP[key];
          // ...
          if (isGroupedRouteLeistungColumn(col)) {
            const { primary, secondary } = getGroupedRouteLines(item);
            return (
              <View /* cell wrapper */>
                <Text style={styles.routePrimary}>{primary}</Text>
                {secondary ? <Text style={styles.routeSecondary}>{secondary}</Text> : null}
              </View>
            );
          }
          // ...
        })}
      </View>
    ))
  : /* flat mode */ null}
```

## Edit Surface (existing patterns)

### Is there currently any UI to edit invoice line-item descriptions?

Not found in the invoice builder steps that were read:

- Step 3 (`Step3LineItems`) shows passenger/date, km, gross + approach editing, warnings/badges — **but does not display or edit `item.description`**.
- Step 4 confirmation (`Step4Confirm`) shows a read-only table listing “Beschreibung” and uses `item.description` purely for display:

```tsx
src/features/invoices/components/invoice-builder/step-4-confirm.tsx:L323-L347
<TableHead>Beschreibung</TableHead>
// ...
<TableCell className='max-w-[200px] truncate text-sm'>
  {item.description}
</TableCell>
```

### Closest existing edit patterns we could follow later

- **Inline per-row editing (Step 3)**: gross/approach editing uses per-row local state + `<Input>` + blur/Enter/Escape commit pattern (`Step3LineItems`), which is the closest UX for “edit description per position”.
- **Per-invoice mutable fields**: invoice email draft (`InvoiceEmailDraft`) shows a simple editable surface saved via a React Query mutation (`saveInvoiceEmailDraft` in `invoices.api.ts`), but note that issued invoice line items are designed to be immutable under §14.

## Risk Surface (files that would be affected)

If a nullable `custom_description` (or similar) was added to invoice line items and used as an override, you’d need to touch at least these readers / renderers / generators:

- **Auto-generation + persistence**
  - `src/features/invoices/api/invoice-line-items.api.ts` (generation in `buildLineItemsFromTrips`, persistence in `insertLineItems`)
  - `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` (draft preview adapter)
  - `src/features/invoices/types/invoice.types.ts` (`InvoiceLineItemRow`, `BuilderLineItem` shapes)
- **PDF rendering**
  - `src/features/invoices/lib/pdf-column-catalog.ts` (the `description` column key; might need a new valueSource or a new key, depending on approach)
  - `src/features/invoices/components/invoice-pdf/pdf-column-layout.ts` (cell rendering / nested value selection)
  - `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx` (flat-mode renders description through `renderCellValue`)
- **Builder confirmation / UI display**
  - `src/features/invoices/components/invoice-builder/step-4-confirm.tsx` (displays `item.description`)
- **Schema / migrations**
  - `supabase/migrations/20260331130000_create_invoice_line_items.sql` (existing `description NOT NULL`)
  - plus a new migration adding `custom_description` (not present today)

## Senior Recommendation

The cleanest approach (given the current architecture) is to treat a per-position description override as **another immutable snapshot field** on `invoice_line_items` (e.g. `custom_description text null`) used only when present, leaving the existing `description` as the auto-generated baseline for audit. Implement the override **in the builder Step 3** (the place where line items already have per-row edit state), so the dispatcher/admin can see the effect immediately and the persisted invoice remains legally frozen afterward—mirroring how prices are currently overridden and snapshotted. For grouped layouts, clarify product semantics: an overridden per-line description will only be visible in **flat main_layout** (or appendix), because grouped cover rows do not use `invoice_line_items.description` at all.

