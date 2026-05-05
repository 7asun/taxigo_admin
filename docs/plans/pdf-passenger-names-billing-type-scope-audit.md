# Audit — Passenger names vs. Step 2 Abrechnungsarten scope

**Read-only audit.** No application code changes in this document.

**Symptom (reproduction):** When Step 2 uses a payer with several Abrechnungsarten and the user selects all or some of them, passenger names in the PDF appendix often look wrong or missing. When the user selects a payer “without” Abrechnungsarten (UI: no billing-type multi-select), names appear correct.

**Goal:** Determine whether the failure is caused by billing-type-dependent fetch/filtering, grouped-by-billing-type PDF logic, appendix partitioning, column profile differences, or a different row shape — without assuming the prior `trips.client_name` analysis is the full story.

---

## A. Reproduce the branching logic

### 1. What Step 2 state selects flat vs grouped vs `grouped_by_billing_type` vs appendix partitioning?

**Important:** `main_layout` and `appendix_columns` come from **PDF Vorlage resolution** (override → payer Vorlage → company default → system), **not** from `billing_type_ids` or trip fetch scope.

- **`single_row`:** `effectiveProfile.main_layout === 'single_row'` → cover summary uses `buildInvoicePdfSingleRow` (one Haupttabelle row).
- **`grouped`:** default summary path `buildInvoicePdfSummary(invoice).summaryItems`.
- **`grouped_by_billing_type`:** cover summary uses `buildInvoicePdfGroupedByBillingType(invoice.line_items)`; **appendix** is split into **one PDF page per billing-family group** via `groupLineItemsByBillingType`.

```341:354:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
  const summaryItems =
    effectiveProfile.main_layout === 'single_row'
      ? [
          buildInvoicePdfSingleRow(
            invoice.line_items,
            ...
          )
        ]
      : effectiveProfile.main_layout === 'grouped_by_billing_type'
        ? buildInvoicePdfGroupedByBillingType(invoice.line_items)
        : buildInvoicePdfSummary(invoice).summaryItems;
```

Appendix branching (partitioning only when `grouped_by_billing_type`):

```502:537:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
      {effectiveProfile.main_layout === 'grouped_by_billing_type' ? (
        (() => {
          const groups = groupLineItemsByBillingType(invoice.line_items);
          ...
          return groups.map((group) => (
            <Page
              key={group.label}
              ...
            >
              <InvoicePdfAppendix
                ...
                lineItems={group.items.map((item, idx) => ({
                  ...item,
                  position: idx + 1
                }))}
                columnProfile={effectiveProfile}
                groupLabel={group.label}
```

**Step 2 billing scope** (`billing_type_id`, `billing_type_ids`, `billing_variant_id`, `billing_variant_ids`) is translated only into **`FetchTripsForBuilderParams`** via `tripsBuilderParamsFromStep2` — it **narrows which `billing_variant_id` values** are included in the trips query, not the PDF layout mode.

```29:67:src/features/invoices/lib/trips-builder-params.ts
export function tripsBuilderParamsFromStep2(
  step2: TripsBuilderStep2Input
): FetchTripsForBuilderParams {
  ...
  const billing_type_ids =
    step2.mode === 'per_client'
      ? null
      : normalizeTripsForBuilderTypeIdsForQueryKey(step2.billing_type_ids);
  ...
  return {
    payer_id: step2.payer_id,
    billing_type_id,
    billing_type_ids,
    billing_variant_id,
    billing_variant_ids,
    ...
  };
}
```

**Column profile reset on payer change only** (not when toggling Abrechnungsarten on the same payer):

```330:337:src/features/invoices/components/invoice-builder/index.tsx
  useEffect(() => {
    setPdfStepAcknowledged(false);
    pdfOverrideRef.current = null;
    setBuilderColumnProfile(resolvePdfColumnProfile(null, null, null));
    setBuilderResolvedVorlage(null);
  }, [step2Values?.payer_id]);
```

So a user comparing **different payers** (one with `billing_types[]`, one without) also compares **potentially different default Vorlagen** (`payers.pdf_vorlage_id`) once Step 4 re-resolves — that can flip `main_layout` and `appendix_columns` independently of `billing_type_ids`.

### 2. Exact path: Step 2 selection → PDF document props / layout mode

1. **Section 2 submit** sets `step2Values` in `useInvoiceBuilder`.
2. **Query key + fetch:** `invoiceKeys.tripsForBuilder(tripsBuilderParamsFromStep2(step2Values))` → `fetchTripsForBuilder` → `buildLineItemsFromTrips` → `setLineItems(items)` (`use-invoice-builder.ts`).
3. **Preview draft:** `step2Snapshot` (includes `billing_type_ids`) + `lineItems` + `columnProfile: builderColumnProfile` → `buildDraftInvoiceDetailForPdf` → `InvoicePdfDocument` with `columnProfile` unchanged by billing scope (`use-invoice-builder-pdf-preview.tsx`).

```180:211:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
  const draftInvoice = useMemo(() => {
    if (!livePreviewActive || !companyProfileForDraft || !step2Values)
      return null;
    return buildDraftInvoiceDetailForPdf({
      companyId,
      companyProfile: companyProfileForDraft,
      step2: step2Values,
      lineItems,
      ...
      columnProfile
    });
  }, [
    ...
    columnProfile
  ]);
```

```245:253:src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
      updatePdf(
        <InvoicePdfDocument
          invoice={draftInvoice}
          ...
          columnProfile={columnProfile}
          cancelledTrips={cancelledTrips}
        />
      );
```

4. **`InvoicePdfDocument`** merges stored invoice `column_profile` with optional dev override, then uses `effectiveProfile.main_layout` for **cover summary** and **appendix page split** as shown above.

**Conclusion for A:** There is **no** code branch that sets `main_layout` or `appendix_columns` from `billing_type_ids`. Layout mode is entirely **Vorlage / Step 4 override + payer**. Billing scope only changes **which trips** become `line_items`.

---

## B. Billing-type scope effects

### 3. When `billing_type_ids` is empty / all / multiple / one — what row set hits main table vs appendix?

**Fetch behavior** (after `resolveBillingVariantFilters`):

- **Empty / null / “all types”** for monthly: no `.in('billing_variant_id', …)` extra filter beyond payer + period (all non-cancelled trips for payer in range).
- **Non-empty `billing_type_ids`:** query restricts to trips whose `billing_variant_id` lies in the **union of variants** for those types (`variantIdsForType` branch in `invoice-line-items.api.ts`).

The **same** `invoice.line_items` array is used for:

- **Haupttabelle / summary** (possibly aggregated): always derived from `invoice.line_items` in `InvoicePdfDocument`.
- **Appendix:** same objects; if `main_layout === 'grouped_by_billing_type'`, each appendix page receives a **slice** `group.items` (still full `InvoiceLineItemRow` objects).

There is no second line-item array keyed by billing scope.

### 4. Does selecting multiple billing types change `main_layout`, `appendix_columns`, grouped row derivation, or line item shape?

| Concern | Effect of `billing_type_ids` |
|--------|-------------------------------|
| `main_layout` | **No** — from `resolvePdfColumnProfile` only (override / Vorlage / defaults). |
| `appendix_columns` | **No** — same resolver; not passed billing scope. |
| Grouped appendix derivation | **No** — `groupLineItemsByBillingType` groups whatever rows are already in `invoice.line_items`; it does not re-fetch. |
| Line item **shape** | **No** — always `buildLineItemsFromTrips`; only the **input `trips[]`** changes. |

```62:93:src/features/invoices/lib/resolve-pdf-column-profile.ts
export function resolvePdfColumnProfile(
  override: PdfColumnOverridePayload | null,
  payerVorlage: PdfVorlageRow | null,
  companyDefaultVorlage: PdfVorlageRow | null
): PdfColumnProfile {
  ...
  if (override?.main_columns?.length && override.appendix_columns?.length) {
    ...
      main_layout = override.main_layout ?? 'grouped';
    }
  }
  if (!main.length || !appendix.length) {
    const v = payerVorlage;
    if (v) {
      ...
        main_layout = v.main_layout;
```

### 5. Code paths (quoted)

- **Trips query filter:** `fetchTripsForBuilder` applies `variantIdsForType` when resolver returns a variant id set (`invoice-line-items.api.ts`, lines 319–323 in current tree).
- **Line items:** `buildLineItemsFromTrips` — identical mapping for every trip regardless of how it was filtered (`client_name` from `trip.client` only, lines 495–521).
- **PDF:** `InvoicePdfDocument` — `effectiveProfile.main_layout` drives summary + appendix split; **no** read of `billing_type_ids`.

---

## C. Appendix passenger-name field under billing-type scope

### 6. Under the multi-billing-type path, does the appendix still receive full `InvoiceLineItemRow.client_name` values?

**Yes, if the value was non-null on the row.** Multi-type scope does not transform line items before the appendix beyond **re-ordering into groups** and **remapping `position`** for display:

```530:533:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
                lineItems={group.items.map((item, idx) => ({
                  ...item,
                  position: idx + 1
                }))}
```

`client_name` is spread from `item` unchanged.

### 7. Is `client_name` present on those rows before `InvoicePdfAppendix`?

It is whatever `buildLineItemsFromTrips` produced (then passed through `builderItemToDraftLineItem` in preview, or DB snapshot after insert). **No** step in the PDF pipeline clears `client_name` based on billing type.

```58:66:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
  return {
    ...
    client_name: item.client_name,
```

### 8. If blank, at which step is it lost?

For trips where **`trip.client` is null** at fetch time, `client_name` is set to **`null` immediately in `buildLineItemsFromTrips`** — **before** any PDF grouping:

```495:521:src/features/invoices/api/invoice-line-items.api.ts
    const clientName = trip.client
      ? [trip.client.first_name, trip.client.last_name]
          .filter(Boolean)
          .join(' ')
      : null;
    ...
      client_name: clientName,
```

The trips query **does not select** `trips.client_name`, so a denormalized name on the trip row is invisible to this path (see prior audit).

---

## D. Grouped-by-billing-type interaction

### 9. How are appendix groups built when `main_layout === 'grouped_by_billing_type'`?

`groupLineItemsByBillingType` walks **`lineItems` in order**, buckets by `invoicePdfBillingCategoryLabel(item)` (billing family label), preserves **original order within each bucket**, and returns `{ label, items }[]`.

```481:497:src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts
export function groupLineItemsByBillingType(
  lineItems: InvoiceLineItemRow[]
): { label: string; items: InvoiceLineItemRow[] }[] {
  const order: string[] = [];
  const map = new Map<string, InvoiceLineItemRow[]>();

  for (const item of lineItems) {
    const label = invoicePdfBillingCategoryLabel(item);
    if (!map.has(label)) {
      map.set(label, []);
      order.push(label);
    }
    map.get(label)!.push(item);
  }

  return order.map((label) => ({ label, items: map.get(label)! }));
}
```

### 10. Does `groupLineItemsByBillingType` preserve `client_name`?

**Yes.** It stores **references** to the same `InvoiceLineItemRow` objects; no mapping that omits fields.

### 11. Does the appendix suppress repeated passenger names or “show once per group”?

**No.** `InvoicePdfAppendix` renders one cell per column per row via `renderCellValue`; there is no deduplication of `client_name` across rows or groups. The file header even states the appendix is a **flat table** over line items; `main_layout` only affects the **cover** page.

```3:6:src/features/invoices/components/invoice-pdf/invoice-pdf-appendix.tsx
 * **Anhang: Fahrtendetails** — always a **flat** table over `invoice.line_items`, independent of
 * `columnProfile.main_layout` (grouped vs flat applies only to the cover page).
```

---

## E. Column profile / Vorlage differences

### 12. Does `columnProfile.appendix_columns` depend on billing-type scope?

**No** — only on the resolver inputs (`override`, `payerVorlage`, `companyDefaultVorlage`). Billing scope is not an input.

### 13. Is `client_name` included in appendix columns for the “affected” case?

**If** the effective Vorlage (or override) lists the catalog key `client_name`, it will render. The **system default** appendix includes `client_name`:

```449:452:src/features/invoices/lib/pdf-column-catalog.ts
export const SYSTEM_DEFAULT_APPENDIX_COLUMNS: PdfColumnKey[] = [
  ...
  'client_name',
```

If a **custom Vorlage** omits `client_name`, the passenger column disappears for **all** trips — not specifically for multi-type scope.

### 14. Can the column be present in one layout but absent in another?

**Yes, but the driver is Vorlage / override, not `billing_type_ids`.** For example, payer A uses company default (includes `client_name`); payer B uses a slim Vorlage without `client_name`. That matches “sometimes names appear” when users switch payers — and correlates with “payer has many Abrechnungsarten” **without** implying a causal link in code.

---

## F. Line-item creation under billing-type filtering

### 15. Compare `buildLineItemsFromTrips` outputs

| Scenario | Difference |
|----------|------------|
| Payer without UI billing types / “all” | Larger (or different) `trips[]`; same per-trip mapping. |
| One selected billing type | `trips` filtered to variants of that type; same mapping. |
| Multiple selected billing types | `trips` filtered to **union** of variants for selected types; same mapping. |

**Single function** builds every row:

```138:143:src/features/invoices/hooks/use-invoice-builder.ts
      const items = buildLineItemsFromTrips(
        trips,
        rules,
        clientPriceTags,
        clientKmOverrides
      );
```

### 16. Does billing-type filtering correlate with `client_name` availability?

**Only statistically.** Narrowing to certain Abrechnungsarten changes **which trips** appear. If those trips (e.g. certain services) more often have `client_id` null or stale joins, **`client_name` will be null more often** — not because the filter touches `client_name`, but because the **population** changed.

The fetch still uses the same `client:clients(...)` embed; there is no billing-type-specific join.

### 17. Are “missing name” trips concentrated in billing-type-scoped rows?

**Plausible as data correlation**, not as a dedicated code path. Any trip without `trip.client` yields `client_name: null` regardless of billing type id.

---

## G. Preview vs persisted

### 18. Preview only, persisted only, or both?

**Both should match** for the same builder state: preview uses `buildDraftInvoiceDetailForPdf` which copies `client_name` from `BuilderLineItem` 1:1; persisted invoices use `insertLineItems` with the same `item.client_name` (see prior audit snippets in `pdf-appendix-passenger-names-audit.md`).

### 19. Mismatch between draft preview and persisted `invoice.line_items`?

No intentional mismatch for `client_name` based on billing scope. If a user sees a difference, it would be from **changing trips/line items after save**, different Vorlage on the stored invoice vs preview session, or a bug outside this trace — not from `billing_type_ids` handling in the PDF stack.

---

## H. Cross-check prior audit (`trips.client_name` / `trip.client` join)

### 20. Re-evaluation

The prior document correctly identified that **`client_name` on line items is derived only from `trip.client`**, while **`trips.client_name` is not selected** in `fetchTripsForBuilder`:

```282:310:src/features/invoices/api/invoice-line-items.api.ts
  let query = supabase
    .from('trips')
    .select(
      `
      id,
      ...
      client:clients(id, first_name, last_name, price_tag, reference_fields)
    `
    )
```

### 21. Primary vs contributing vs wrong diagnosis

- **Primary (unchanged):** Row **data / snapshot** gap — missing or null `trip.client` → null `client_name`; no fallback to `trips.client_name`.
- **Contributing:** **Vorlage** without `client_name` in appendix columns; **payer switching** changing default profile.
- **Not supported by code review:** A second bug where **grouping by billing type strips names** or **billing scope rewrites rows**.

### 22. Same bug, second bug, or different root cause?

**Same underlying row-data issue**, with a **narrower reproduction** that **correlates** with Abrechnungsarten scope because:

1. Scoping changes **which trips** are invoiced.
2. Payers with configured `billing_types` often differ in **Vorlage** / `main_layout` from payers without (UI hides type picker when `billing_types.length === 0`).

There is **no** evidence in-repo of a **separate** “billing_type_ids breaks appendix names” transformer.

---

## I. Recommendation

### 23. Classification

**Combination:**

- **Row data bug** (primary): `client_name` null when `trip.client` missing; `trips.client_name` unused.
- **Layout/profile** (secondary): wrong or missing `client_name` column in Vorlage can mask or mimic the symptom when comparing payers.
- **Fetch/filter composition** (correlation only): multi-type selection changes trip population; does not alter line-item mapping logic.

### 24. Smallest safe next fix (after confirming root cause in staging data)

1. **Prove on a failing invoice:** For a trip row with empty appendix passenger name, check DB: `trips.client_id`, `trips.client_name`, and whether `clients` join would return a name.
2. If `client_name` exists on `trips` but `client_id` is null: extend `fetchTripsForBuilder` select to include `client_name` (or equivalent) and set `clientName` in `buildLineItemsFromTrips` with fallback **`trip.client` first, then trip-level name** (exact precedence per product/legal snapshot rules — align with `docs/plans/pdf-appendix-passenger-names-audit.md`).

### 25. Files to touch for that fix

- `src/features/invoices/api/invoice-line-items.api.ts` — `fetchTripsForBuilder` select list; `buildLineItemsFromTrips` `clientName` derivation.
- Optionally **types** for `TripForInvoice` if the select adds fields.
- **Tests** covering builder line items when `client` embed is null but trip carries a name (if product allows).

No change required to `groupLineItemsByBillingType`, `InvoicePdfAppendix`, or `resolvePdfColumnProfile` for the billing-type-scope symptom **as traced here**.

---

## Senior Recommendation

Treat the Abrechnungsarten-scope reproduction as **trip population + unchanged snapshot rules**, not as PDF grouping logic. The codebase shows **no** coupling from `billing_type_ids` to `main_layout`, `appendix_columns`, or `client_name` mutation; appendix partitioning only **slices** existing rows. **Investigate failing trips for `client_id` / join presence first**; implement **fetch + fallback** for passenger display if product requires showing `trips.client_name` when Stammdaten link is absent. When comparing “payer with types” vs “payer without”, **also compare `pdf_vorlage_id` and effective `appendix_columns`** to avoid chasing a red herring.
