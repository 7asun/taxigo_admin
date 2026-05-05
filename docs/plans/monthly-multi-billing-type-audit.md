# Audit — Monthly invoice Step 2 multi-select for Abrechnungsart (billing types)

**Read-only audit.** No code changes in this document.

**Scope:** Extending Step 2 so monthly (non–`per_client`) mode can select **multiple Abrechnungsfamilien** (`billing_types`) instead of only a single `Select` + “Alle”.

**Reference implementation in-repo:** Unterarten subset (`billing_variant_ids`) under **one** `billing_type_id` is already implemented in `step-2-params.tsx` + `invoice-line-items.api.ts` + query keys. This audit treats multi–billing-type as the next analogous feature.

---

## A. Current Step 2 billing type flow

### 1. JSX and state flow (monthly / standard mode, `mode !== 'per_client'`)

Billing types come from the selected payer’s embedded `billing_types`. The field renders only when `billingTypes.length > 0`. State is RHF `billing_type_id`; `billingTypeIdNorm` normalizes empty string to `null` for downstream logic (variant subset, Rechnungsempfänger preview).

**Full block** (standard flow: payer → optional billing type → optional variant subset):

```535:639:src/features/invoices/components/invoice-builder/step-2-params.tsx
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
                        onValueChange={(id) => {
                          field.onChange(id);
                          form.setValue('billing_type_id', null);
                          form.setValue('billing_variant_id', null);
                          form.setValue('billing_variant_ids', null);
                        }}
                      >
                    ...
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
                          onValueChange={(val) => {
                            field.onChange(val === 'all' ? null : val);
                            // why: variant IDs from one billing family must never leak into another family's fetch scope.
                            form.setValue('billing_variant_ids', null);
                            form.setValue('billing_variant_id', null);
                          }}
                        >
                          ...
                            <SelectItem value='all'>
                              Alle Abrechnungsarten
                            </SelectItem>
                            {billingTypes.map((bt) => (
                              <SelectItem key={bt.id} value={bt.id}>
                                {bt.name}
                              </SelectItem>
                            ))}
```

The **Unterarten** picker is shown only when a single `billing_type_id` is set and variants exist for that type (`billingTypeIdNorm && variantsForType.length > 0`).

### 2. Single-value `Select` and `all → null` semantics

Yes. The control uses `value={field.value ?? 'all'}` and:

```585:590:src/features/invoices/components/invoice-builder/step-2-params.tsx
                          onValueChange={(val) => {
                            field.onChange(val === 'all' ? null : val);
                            // why: variant IDs from one billing family must never leak into another family's fetch scope.
                            form.setValue('billing_variant_ids', null);
                            form.setValue('billing_variant_id', null);
                          }}
```

Submit normalizes with `values.billing_type_id || null` (empty string → `null`).

### 3. Exact type of `billing_type_id`

| Layer | Type / shape |
|--------|----------------|
| **Local Step 2 schema** (`step2Schema`) | `z.string().uuid().nullish().or(z.literal(''))` — effectively `string \| null \| undefined`, plus empty string. |
| **Global** `invoiceBuilderSchema` | `z.string().uuid().nullable()` → `string \| null` on `InvoiceBuilderFormValues`. |
| **`useInvoiceBuilder` Step2Values** | `Pick<InvoiceBuilderFormValues, … \| 'billing_type_id' \| …>` → `string \| null`. |
| **Draft PDF snapshot** `InvoiceBuilderStep2Snapshot` | `billing_type_id: string \| null`. |

```36:45:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
export interface InvoiceBuilderStep2Snapshot {
  mode: InvoiceMode;
  payer_id: string;
  billing_type_id: string | null;
  billing_variant_id: string | null;
  /** Monthly subset selection for preview parity; fetch-only, not on invoice header. */
  billing_variant_ids: string[] | null;
  period_from: string;
  period_to: string;
  client_id: string | null;
}
```

---

## B. Existing multi-select UI pattern

### 4. `DataTableFacetedFilter` vs other components

- **`DataTableFacetedFilter`** ([`src/components/ui/table/data-table-faceted-filter.tsx`](src/components/ui/table/data-table-faceted-filter.tsx)) is the canonical **Popover + Command + checkmark** multi-select, but it is **tied to TanStack Table** via `column?.getFilterValue()` / `setFilterValue()`.
- **Closer pattern for Step 2:** the in-file **`MonthlyVariantSubsetPicker`** in [`step-2-params.tsx`](src/features/invoices/components/invoice-builder/step-2-params.tsx) — same visual/interaction model, **RHF-driven** (no `Column`).
- Other **Command + Popover** usages (`DataTableViewOptions`, `TripsFiltersBar` column visibility) are **toggle lists**, not multi-select of entity IDs for forms.

**Conclusion:** For Step 2, **copy the `MonthlyVariantSubsetPicker` approach** (or extract a shared `FormFacetedMultiSelect`) rather than importing `DataTableFacetedFilter` directly.

### 5. Copy vs abstract

| Copy | Abstract |
|------|----------|
| Popover + Command + CommandInput + CommandList + CommandItem + checkmark styling + clear row | Optional: shared primitive `MultiSelectCommandPopover` with `options: { value, label }[]`, `value: string[] \| null`, `onChange`, trigger label rules |
| German placeholders / a11y consistent with invoice UX | TanStack `Column` API — **do not** abstract that into the form |

### 6. Senior UX recommendation (all / one / subset)

- **All billing types:** keep a single explicit state: **`null` or empty selection** = “Alle Abrechnungsarten” (matches today’s `all` sentinel → `null`).
- **Exactly one:** either one ID in `billing_type_ids` **or** keep **`billing_type_id`** for that case — see **C.9** for one clear rule.
- **Subset of several:** multi-select with deterministic trigger: e.g. `Alle Abrechnungsarten` / single family name / `N Abrechnungsarten gewählt` (mirror Unterarten picker).

Avoid a second “Alle” row inside the Command list if `null` already means all; that reduces duplicate semantics.

---

## C. Data model choice

### 7. Safest additive shape

**Recommendation: add `billing_type_ids: string[] | null` and keep `billing_type_id` for backward compatibility and `per_client`.**

- **`per_client`** today sets **`billing_type_id`** from the historical combination (`comb?.billing_type_id`) and must keep working without a multi-select.
- **Monthly** can treat **`billing_type_ids`** as the source of truth when non-null/non-empty, and **`billing_type_id`** as **legacy single-value** only if you adopt the dual-field rule in **C.9**; alternatively, monthly could use **only** `billing_type_ids` and always set `billing_type_id` to `null` in that mode (symmetric to `billing_variant_ids` not overloading `billing_variant_id`).

**Do not** replace with only an array without a migration path: persisted `invoices.billing_type_id` is a single UUID column today.

### 8. Files that must change if `billing_type_ids` is added end-to-end

| Area | Files (representative) |
|------|-------------------------|
| Schema / types | [`src/features/invoices/types/invoice.types.ts`](src/features/invoices/types/invoice.types.ts) (`invoiceBuilderSchema`, `InvoiceBuilderFormValues`) |
| Step 2 UI + local schema | [`src/features/invoices/components/invoice-builder/step-2-params.tsx`](src/features/invoices/components/invoice-builder/step-2-params.tsx) |
| Hook + fetch params | [`src/features/invoices/hooks/use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts) (`tripsBuilderParamsFromStep2`, `Step2Values` Pick) |
| Query key | [`src/query/keys/invoices.ts`](src/query/keys/invoices.ts) (`tripsForBuilder` + normalization helper for sorted IDs) |
| Trip + cancelled fetch | [`src/features/invoices/api/invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts) (`FetchTripsForBuilderParams`, `billingVariantFetchBranchFromParams` or successor, `resolveBillingVariantFilters`) |
| PDF draft snapshot | [`src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts`](src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts) |
| Builder shell snapshot | [`src/features/invoices/components/invoice-builder/index.tsx`](src/features/invoices/components/invoice-builder/index.tsx) (`step2Snapshot`) |
| Persistence | [`src/features/invoices/api/invoices.api.ts`](src/features/invoices/api/invoices.api.ts) — only if product chooses to persist multi-type on header (see **E**); else explicit non-persistence comment |
| Tests | Extend [`src/features/invoices/api/__tests__/billing-variant-fetch-branch.test.ts`](src/features/invoices/api/__tests__/billing-variant-fetch-branch.test.ts) or add parallel tests for type branching |
| Docs | [`docs/invoices-module.md`](docs/invoices-module.md) |

**Optional:** [`src/features/invoices/lib/invoice-builder-section-guards.ts`](src/features/invoices/lib/invoice-builder-section-guards.ts) does not need `billing_type_ids` for section completion if gates stay payer + period only.

### 9. Rule: monthly UI writes only `billing_type_ids` vs mirroring into `billing_type_id`

**Recommendation (one clear rule):**

- In **monthly / single_trip** (`mode !== 'per_client'`), the **new** multi-select should write **only `billing_type_ids`** (and clear **`billing_type_id`** to `null`), mirroring the hard rule already used for **`billing_variant_ids`** vs **`billing_variant_id`**.
- **Exactly one** selected family is still represented as **`billing_type_ids: [singleId]`**, not as `billing_type_id: singleId`.

**Why:** avoids ambiguous precedence (`billing_type_id` vs array), keeps fetch branching deterministic, and aligns with “fetch-only / multi scope” fields living in arrays while single-header semantics stay reserved for **`per_client`** and future legacy reads.

**If** you need a single column on `invoices` for “primary family” for reporting, that is a **product** decision and should be explicit — not silently derived from “first selected”.

---

## D. Fetch logic

### 10. Where `billing_type_id` influences trip fetching today

`billing_type_id` is **not** applied directly on `trips`. It flows through **`billingVariantFetchBranchFromParams`** → **`resolveBillingVariantFilters`**, which queries **`billing_variants`** filtered by **`billing_type_id`**, producing either:

- a **single** `variantId`, or  
- a **`variantIdsForType`** list,

then the trip query uses **`.eq('billing_variant_id', variantId)`** or **`.in('billing_variant_id', variantIdsForType)`**.

```84:113:src/features/invoices/api/invoice-line-items.api.ts
export function billingVariantFetchBranchFromParams(
  params: Pick<
    FetchTripsForBuilderParams,
    'billing_type_id' | 'billing_variant_id' | 'billing_variant_ids'
  >
): BillingVariantFetchBranch {
  const typeId =
    params.billing_type_id && params.billing_type_id.length > 0
      ? params.billing_type_id
      : null;
  ...
  if (subset && typeId) {
    return { branch: 'subset', billingTypeId: typeId, requestedIds: subset };
  }
  if (single) {
    return { branch: 'single', variantId: single };
  }
  if (typeId) {
    return { branch: 'allVariantsOfType', billingTypeId: typeId };
  }
  return { branch: 'noVariantFilter' };
}
```

```266:270:src/features/invoices/api/invoice-line-items.api.ts
  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }
```

### 11. Multiple billing types — cleanest query-layer approach

**`trips` rows do not expose `billing_type_id` as a top-level filter in this query**; the join is via embedded `billing_variant`. The **lowest-risk** approach consistent with the current architecture:

1. **Resolve selected billing type IDs → union of all `billing_variants.id`** for those types (one or two Supabase queries, or one query with `.in('billing_type_id', typeIds)` on `billing_variants`).
2. Apply **`.in('billing_variant_id', mergedVariantIds)`** on `trips` (same as today’s multi-variant path).
3. If the union is **empty** (no variants for chosen types), keep the existing **`abortEmpty`** pattern.

**Direct `.in('billing_type_id', ids)` on `trips`** is not used today and would require a different filter shape (e.g. RPC or filtering on embedded relation) — **higher risk** than expanding to variant IDs first.

**Interaction with `billing_variant_ids`:** precedence must be specified (e.g. subset of variants **within** the union of selected types, or disallow combining until product defines it).

### 12. Cancelled trips — same change?

Yes. **`fetchCancelledTripsForBuilder`** calls the same **`resolveBillingVariantFilters`** and applies the same **`.eq` / `.in`** on **`billing_variant_id`**:

```301:336:src/features/invoices/api/invoice-line-items.api.ts
export async function fetchCancelledTripsForBuilder(
  params: FetchTripsForBuilderParams
): Promise<CancelledTripRow[]> {
  const supabase = createClient();

  const { variantId, variantIdsForType, abortEmpty } =
    await resolveBillingVariantFilters(params);
  ...
  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }
```

Any change to resolver / params must stay **shared** so billing and cancelled scopes stay identical.

---

## E. Persistence and PDF semantics

### 13. Meaning of `invoices.billing_type_id` on insert and in types

```63:70:src/features/invoices/types/invoice.types.ts
export interface InvoiceRow {
  ...
  billing_type_id: string | null; // null = all billing types
  /** Optional Unterart scope (billing_variants.id). NULL = multi-variant invoice. */
  billing_variant_id: string | null;
```

Insert copies **`payload.formValues.billing_type_id`**:

```281:293:src/features/invoices/api/invoices.api.ts
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      ...
      payer_id: payload.formValues.payer_id,
      billing_type_id: payload.formValues.billing_type_id,
      ...
      mode: payload.formValues.mode,
```

### 14. Multi–billing-type monthly: `null` on header?

**Convention today:** `null` on **`billing_type_id`** already means **“all billing types for this payer”** in the type definition. A monthly invoice that includes **several but not all** families is **not** representable as a single UUID; it is analogous to **`billing_variant_id: null`** for multi-Unterart invoices where line items carry the real mix.

**Recommendation:** For **multi-family monthly** invoices, set **`invoices.billing_type_id` to `null`** (and document that the scope is defined by **line items / trip set**, not the header) — unless product adds a JSON/array column or a separate linking table.

### 15. Draft PDF / header dependency on single `billing_type_id`

- **`buildDraftInvoiceDetailForPdf`** copies **`step2.billing_type_id`** onto the synthetic invoice row:

```176:183:src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts
  const base = {
    ...
    payer_id: step2.payer_id,
    billing_type_id: step2.billing_type_id,
    billing_variant_id: step2.billing_variant_id,
```

- **Grep** under `invoice-pdf/`: no other references to `billing_type_id` except the example fixture — **`InvoicePdfDocument`** does not appear to branch on `billing_type_id` for layout in those paths; **line content** comes from **`line_items`** (snapshots include `billing_type_name` per line).

**Risk if multi-select:** if any future PDF header text assumes “one family”, it would need to use **first line / catalog** or explicit copy — today the draft row still carries a single nullable field only.

---

## F. Reset and invalid-state rules

### 16. What to clear when `payer_id` changes (monthly mode)

**Existing logic** already clears **`billing_type_id`**, **`billing_variant_id`**, and **`billing_variant_ids`**:

```548:555:src/features/invoices/components/invoice-builder/step-2-params.tsx
                        onValueChange={(id) => {
                          field.onChange(id);
                          form.setValue('billing_type_id', null);
                          form.setValue('billing_variant_id', null);
                          form.setValue('billing_variant_ids', null);
                        }}
```

For **`billing_type_ids`**, the same invariant should apply: **clear the multi-select array** when payer changes (families are payer-scoped).

### 17. Other parent–child dependencies

- **Billing type (`billing_type_id`) change** clears **Unterarten** subset + **`billing_variant_id`** (see **A.1**).
- **`per_client` client change** clears payer, billing type, variants, and **`billing_variant_ids`**.
- If **`billing_type_ids`** is added: changing the set of families should **clear `billing_variant_ids`** (variants are only meaningful relative to a known family set — today they are tied to a **single** `billingTypeIdNorm`; multi-type would require redefining whether Unterarten apply per family or globally).

### 18. Normalization boundary for invalid `billing_type_ids`

**Cleanest boundary:** same as variant subset — **`tripsBuilderParamsFromStep2`** in [`use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts) (or a dedicated normalizer):

- Intersect requested IDs with **`selectedPayer.billing_types`** (or re-fetch types for payer server-side in the resolver).
- Drop unknown IDs; if result empty but user had selection, either **`abortEmpty`** or treat as “no filter” per product.
- Sort for **stable query keys** in [`invoiceKeys.tripsForBuilder`](src/query/keys/invoices.ts).

---

## G. Risk surface

### 19. Files that read `billing_type_id` from Step 2 / snapshot / create payload

| Location | Role |
|----------|------|
| [`step-2-params.tsx`](src/features/invoices/components/invoice-builder/step-2-params.tsx) | Form field, Rechnungsempfänger preview, variant filtering |
| [`use-invoice-builder.ts`](src/features/invoices/hooks/use-invoice-builder.ts) | `tripsBuilderParamsFromStep2` → fetch |
| [`invoice-line-items.api.ts`](src/features/invoices/api/invoice-line-items.api.ts) | Branch + resolver |
| [`index.tsx`](src/features/invoices/components/invoice-builder/index.tsx) | `step2Snapshot` |
| [`build-draft-invoice-detail-for-pdf.ts`](src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts) | Draft `InvoiceDetail.billing_type_id` |
| [`use-invoice-builder-pdf-preview.tsx`](src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx) | Passes snapshot into `buildDraftInvoiceDetailForPdf` |
| [`invoices.api.ts`](src/features/invoices/api/invoices.api.ts) | `createInvoice` insert |
| [`invoice-builder-section-guards.ts`](src/features/invoices/lib/invoice-builder-section-guards.ts) | `InvoiceBuilderStep2Slice` includes `billing_type_id` (completion / fetch gate) |
| [`invoice.types.ts`](src/features/invoices/types/invoice.types.ts) | `invoiceBuilderSchema`, `InvoiceRow` |

**Note:** [`use-client-payers.ts`](src/features/invoices/hooks/use-client-payers.ts) deals with **`per_client`** combination rows, not monthly Step 2 state.

### 20. Risks if `billing_type_ids` is introduced

| Area | Risk |
|------|------|
| **Cache keys** | Must normalize sorted `billing_type_ids`; omit from key or use `null` when empty to avoid churn. |
| **PDF preview** | Draft header still single `billing_type_id`; multi-type should align snapshot + insert semantics (**E.14**). |
| **Persistence** | DB column is single UUID; multi-scope invoices need **`null`** + line snapshots unless schema changes. |
| **Existing monthly invoices** | Unchanged if new field is optional and fetch precedence preserves “no array = current behaviour”. |
| **Unterarten picker** | Today gated on **one** `billingTypeIdNorm`; multi-type needs a **UX/product** rule (disable subset, or per-family expansion). |

---

## H. Recommendation

### 21. Concrete recommendation

| Dimension | Recommendation |
|-----------|----------------|
| **UI pattern** | Reuse **`MonthlyVariantSubsetPicker`-style** Popover + Command + checkmarks (RHF), not `DataTableFacetedFilter` directly. |
| **State shape** | Add **`billing_type_ids: string[] \| null`**; in monthly/standard mode, **do not** mirror one selected id into **`billing_type_id`**; keep **`billing_type_id`** for **`per_client`** and legacy. Normalize invalid IDs at **hook / param assembly** boundary. |
| **Fetch strategy** | Resolve **union of `billing_variants.id`** for all selected type IDs → **`.in('billing_variant_id', …)`**; share resolver with **cancelled** fetch; define precedence with **`billing_variant_ids`** explicitly. |
| **Persistence** | **`invoices.billing_type_id = null`** for true multi-family monthly (line items define mix); do **not** stuff arrays into the UUID column without migration. |
| **Complexity** | **Medium** — parallel to existing `billing_variant_ids` work: UI + schema + hook + query key + resolver branch + tests + docs; **higher** if Unterarten subset must work across multiple families simultaneously. |

---

## Senior Recommendation

1. **Treat multi–billing-type like multi–Unterart:** fetch-driven array field, stable sorted query keys, **no** silent overload of the existing single UUID header fields in monthly mode.
2. **Expand types → variant IDs** for PostgREST filters; do not invent a new `trips.billing_type_id` filter path without verifying embed / RLS / performance.
3. **Resolve UX for Unterarten** before coding: with multiple families, either **disable** the current single-family subset picker or **nest** per-family selection — the current `variantsForType` filter **`v.billing_type_id === billingTypeIdNorm`** is inherently single-family.
4. **Keep cancelled trips in lockstep** with billing trips via one resolver.
5. **Document** header `null` semantics for multi-family invoices next to existing multi-variant documentation in [`docs/invoices-module.md`](docs/invoices-module.md).

**Implementation status:** Implemented in app code per plan `monthly_billing_types_multi-select` — `billing_type_ids`, resolver union + precedence, Unterarten gated to one family, monthly header `billing_type_id` always null, docs in `docs/invoices-module.md`.

*(End of audit.)*
