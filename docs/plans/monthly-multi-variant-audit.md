# Audit 5 — Monthly invoice Step 2 multi-variant subset selection

Read-only audit. No code changes. Focus: extending **monthly** (and non–`per_client`) Step 2 to choose a **subset** of Unterarten (`billing_variants`) while staying aligned with fetch, cache keys, PDF preview, and `invoices` persistence.

---

## A. Current Step 2 structure

### 1. Monthly mode: payer + billing type JSX and state flow

**File:** `src/features/invoices/components/invoice-builder/step-2-params.tsx`

Monthly and other non–`per_client` modes render under `mode !== 'per_client'`. State is **react-hook-form** with `useForm<Step2Values>`; `selectedPayerId` / `billingTypes` derive from `form.watch('payer_id')` and `payers.find`.

**Payer `<Select>`** (single value, controlled by RHF `payer_id`):

```360:391:src/features/invoices/components/invoice-builder/step-2-params.tsx
          {mode !== 'per_client' && (
            <>
              {/* Payer picker */}
              <FormField
                control={form.control}
                name='payer_id'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Kostenträger <span className='text-destructive'>*</span>
                    </FormLabel>
                    <FormControl>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder='Kostenträger wählen…' />
                        </SelectTrigger>
                        <SelectContent>
                          {payers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.number})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
```

**Billing type `<Select>`** (optional; `billing_type_id`; sentinel `'all'` → `null`):

```394:431:src/features/invoices/components/invoice-builder/step-2-params.tsx
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
                          <SelectTrigger>
                            <SelectValue placeholder='Alle Abrechnungsarten' />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value='all'>
                              Alle Abrechnungsarten
                            </SelectItem>
                            {billingTypes.map((bt) => (
                              <SelectItem key={bt.id} value={bt.id}>
                                {bt.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormDescription>
                        Nur Fahrten dieser Abrechnungsart einbeziehen.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
```

**Submit → parent:** `onSubmit` passes `billing_variant_id` through (for monthly this stays default `null` unless wired elsewhere):

```197:207:src/features/invoices/components/invoice-builder/step-2-params.tsx
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

### 2. Where a variant subset control fits with least disruption

**Recommendation (audit):** Place a **conditional secondary control directly below** “Abrechnungsart (optional)” inside the same `mode !== 'per_client'` block—after the billing type field, before the shared Rechnungsempfänger preview and date range. That preserves the existing order (Kostenträger → Familie → … → Zeitraum) and avoids replacing the family filter, which already encodes product semantics (“Nur Fahrten dieser Abrechnungsart”).

Replacing `Abrechnungsart` would regress the current “all families” vs “one family” behaviour unless reimplemented inside the new control.

### 3. Popover / Command / Select usage in Step 2

**Imports in `step-2-params.tsx`:** only `Select` family from shadcn—no `Popover` or `Command`.

```31:37:src/features/invoices/components/invoice-builder/step-2-params.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
```

**Controls used:** `Select` (payer, billing type, per_client combo), `ClientAutoSuggest`, `DateRangePicker`, `Button`, form primitives. **No** `Popover`/`Command` in this file.

---

## B. Existing reusable multi-select patterns

### 4. Reusable multi-select in the repo

**Yes — for data tables.** `src/components/ui/table/data-table-faceted-filter.tsx` implements **`Popover` + `Command` + faux checkbox squares + `CheckIcon`**, with **`multiple`** toggling multi-select vs single-select.

```78:186:src/components/ui/table/data-table-faceted-filter.tsx
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm' className='border-dashed'>
          ...
          {selectedValues?.size > 0 && (
            <>
              ...
              <div className='hidden items-center gap-1 lg:flex'>
                {selectedValues.size > 2 ? (
                  <Badge
                    variant='secondary'
                    className='rounded-sm px-1 font-normal'
                  >
                    {selectedValues.size} selected
                  </Badge>
                ) : (
                  options
                    .filter((option) => selectedValues.has(option.value))
                    .map((option) => (
                      <Badge
                        variant='secondary'
                        key={option.value}
                        className='rounded-sm px-1 font-normal'
                      >
                        {option.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[12.5rem] p-0' align='start'>
        <Command>
          <CommandInput placeholder={title} />
          ...
              {options.map((option) => {
                const isSelected = selectedValues.has(option.value);

                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => onItemSelect(option, isSelected)}
                  >
                    <div
                      className={cn(
                        'border-primary flex size-4 items-center justify-center rounded-sm border',
                        isSelected
                          ? 'bg-primary'
                          : 'opacity-50 [&_svg]:invisible'
                      )}
                    >
                      <CheckIcon />
                    </div>
                    ...
                  </CommandItem>
                );
              })}
```

**Wiring:** `src/components/ui/table/data-table-toolbar.tsx` uses `variant: 'multiSelect'` → `DataTableFacetedFilter` with `multiple={true}`.

```133:141:src/components/ui/table/data-table-toolbar.tsx
        case 'select':
        case 'multiSelect':
          return (
            <DataTableFacetedFilter
              column={column}
              title={columnMeta.label ?? column.id}
              options={columnMeta.options ?? []}
              multiple={columnMeta.variant === 'multiSelect'}
            />
          );
```

**Note:** It is **coupled to TanStack Table** (`column.getFilterValue` / `setFilterValue`). For Step 2 you would **extract the visual/interaction pattern** or duplicate a slim Popover+Command+checkbox list bound to RHF.

### 5. Closest pattern to “clean dropdown with checkboxes + summary label”

**`DataTableFacetedFilter`** is the closest shipped pattern: dashed outline trigger, count badge / up to two labels, searchable list, clear action. Step 2 today uses plain **`Select`** with no multi-value equivalent.

### 6. Senior UX/stack recommendation: extend Select vs Popover + Command

**Recommendation:** **Do not** fake multi-select inside Radix **`Select`** (accessibility and value model fight multi-value). Prefer **`Popover` + `Command` + row checkmarks** (same ingredients as `DataTableFacetedFilter`), styled to match Step 2 (`FormItem` / `FormLabel` / trigger width). Optionally factor a small **`VariantSubsetPicker`** that accepts `options`, `value: string[]`, `onChange`, and summary props—reusing tokens from the faceted filter without importing TanStack.

---

## C. Builder state and fetch shape

### 7. Smallest safe extension: `billing_variant_id` only vs `billing_variant_ids` vs replace

| Option | Pros | Cons |
|--------|------|------|
| **Keep only `billing_variant_id: string \| null`** | No schema churn | Cannot represent **2+** Unterarten without overloading semantics (e.g. comma string — bad). |
| **Add `billing_variant_ids: string[]`** (nullable or empty = “no explicit subset”) | Clear; fetch can `.in()`; cache key can include sorted joined ids | Must define precedence vs `billing_variant_id` for **`per_client`** (today single combo). |
| **Replace `billing_variant_id` entirely** | Single field | **Breaking** for `per_client`, `createInvoice`, draft PDF, and any code assuming one UUID for “single-Unterart invoice”. |

**Best fit for current architecture:** **Add** `billing_variant_ids: string[] | null` (or `[]` meaning “not used”) **and retain** `billing_variant_id` for:

- **`per_client`** (one historical combo),
- **Single-Unterart** invoice header semantics (`invoices.billing_variant_id`),
- Backward compatibility.

**Resolution rule (conceptual):** For monthly fetch, if `billing_variant_ids?.length` → filter `.in(ids)` (after validating ids ⊆ allowed set for current `billing_type_id`); else fall through to existing `resolveBillingVariantFilters` (`single id` or `all variants of type` or `no variant filter`).

### 8. Files touched if `billing_variant_ids: string[]` is added end-to-end

| Area | File(s) |
|------|---------|
| Step 2 form schema + defaults + submit | `src/features/invoices/components/invoice-builder/step-2-params.tsx` |
| Hook state `Pick` + trips query params | `src/features/invoices/hooks/use-invoice-builder.ts` |
| Zod + `InvoiceBuilderFormValues` | `src/features/invoices/types/invoice.types.ts` (`invoiceBuilderSchema`) |
| Query key factory | `src/query/keys/invoices.ts` (`tripsForBuilder` params object) |
| Fetch + cancelled fetch | `src/features/invoices/api/invoice-line-items.api.ts` (`FetchTripsForBuilderParams`, `resolveBillingVariantFilters`, `fetchTripsForBuilder`, `fetchCancelledTripsForBuilder`) |
| Draft PDF snapshot | `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` (`InvoiceBuilderStep2Snapshot`) |
| Builder shell snapshot | `src/features/invoices/components/invoice-builder/index.tsx` (`step2Snapshot` useMemo) |
| PDF preview hook | `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` (only if snapshot type gains fields—pass-through today) |
| Section guards | `src/features/invoices/lib/invoice-builder-section-guards.ts` (optional: if completion rules depend on new field) |
| **Persistence** | If the subset must be auditable on the invoice row: **DB migration** + `src/features/invoices/api/invoices.api.ts` + `InvoiceRow` / `database.types.ts` regeneration—not required for trip fetch alone if line items are authoritative |

### 9. Where fetch logic should switch to `.in(selected variant ids)`

Today the branch is:

```204:208:src/features/invoices/api/invoice-line-items.api.ts
  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }
```

**Change location:** After `resolveBillingVariantFilters` returns (or **inside** an extended resolver), introduce a third case, e.g. when `params.billing_variant_ids?.length` (validated non-empty):

- set `query = query.in('billing_variant_id', params.billing_variant_ids)`  
- and **skip** or **narrow** `variantIdsForType` so you never OR-conflict (single coherent branch).

The parallel **cancelled** query mirrors the same block:

```270:274:src/features/invoices/api/invoice-line-items.api.ts
  if (variantId) {
    query = query.eq('billing_variant_id', variantId);
  } else if (variantIdsForType) {
    query = query.in('billing_variant_id', variantIdsForType);
  }
```

Both must stay in sync.

### 10. `invoices.billing_variant_id` for multi-variant monthly — remain `null`?

**Current semantics (application types):**

```69:70:src/features/invoices/types/invoice.types.ts
  /** Optional Unterart scope (billing_variants.id). NULL = multi-variant invoice. */
  billing_variant_id: string | null;
```

**Insert path:**

```287:289:src/features/invoices/api/invoices.api.ts
      billing_type_id: payload.formValues.billing_type_id,
      // Set when the invoice is scoped to exactly one Unterart (billing_variants.id); NULL otherwise.
      billing_variant_id: payload.formValues.billing_variant_id ?? null,
```

**Conclusion:** For an invoice that includes trips from **multiple** Unterarten, **`billing_variant_id` should remain `null`**—this already means “multi-variant invoice” in code and comments. Actual variant mix is **derived from line items** (`billing_variant_name` / code snapshots). A subset selection in Step 2 does not change that unless product wants a **single** representative FK (not recommended when lines span variants).

---

## D. UX constraints

### 11. Collapsed summary text for subset control

**Align with existing app pattern:** `DataTableFacetedFilter` uses **badges for ≤2 selections** and **`{n} selected`** (English) for more.

**Recommendation for German Step 2:**

- **0 explicit picks** (meaning “all allowed by Abrechnungsart / payer”): show **`Alle Unterarten`** or inherit label from billing type choice.
- **1 pick:** show **exact variant display name** (reuse `formatBillingVariantOptionLabel` / name from catalog).
- **2 picks:** two short labels or **„2 Unterarten“**.
- **>2:** **„N Unterarten gewählt“** (matches the count-badge pattern; avoids comma overflow in a narrow 480px column).

### 12. Billing type change → clear variant subset?

**Existing dependent-reset pattern** when **client** changes (resets payer, billing type, variant):

```241:247:src/features/invoices/components/invoice-builder/step-2-params.tsx
                          onSelect={(client) => {
                            field.onChange(client?.id ?? '');
                            // Reset payer logic when client changes
                            form.setValue('payer_id', '');
                            form.clearErrors('payer_id');
                            form.setValue('billing_type_id', null);
                            form.setValue('billing_variant_id', null);
                          }}
```

**Recommendation:** When **`billing_type_id`** changes, **clear `billing_variant_ids`** (and any single `billing_variant_id` for monthly) **automatically**—same spirit as above; otherwise IDs could reference variants outside the newly selected family and fetch would return wrong or empty sets.

### 13. Subset without billing type first?

**Current fetch shape:** `resolveBillingVariantFilters` only loads **all variant IDs for a family** when `billing_type_id` is set; with **no** `billing_variant_id` and **no** `billing_type_id`, **no** variant predicate is applied (all variants under payer in range).

**Lower-risk product choice:** **Require `billing_type_id` before enabling subset selection** so the option list is **one family’s variants** (small, predictable). Allowing cross-family multi-select without first picking a family duplicates the “Alle Abrechnungsarten” explosion and needs a **new** query: all `billing_variants` for `payer_id` across types—more complex and easier to misconfigure.

---

## E. Risk surface

### 14. Files reading Step 2 `billing_variant_id` from builder state / snapshots (review for subset)

| File | How used |
|------|-----------|
| `src/features/invoices/hooks/use-invoice-builder.ts` | `invoiceKeys.tripsForBuilder({ … billing_variant_id })`, `fetchTripsForBuilder` / `fetchCancelledTripsForBuilder` params, `fullValues` spread into `createInvoice` |
| `src/features/invoices/components/invoice-builder/index.tsx` | `step2Snapshot.billing_variant_id` for PDF preview input |
| `src/query/keys/invoices.ts` | `tripsForBuilder` params include `billing_variant_id` |
| `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` | `InvoiceBuilderStep2Snapshot.billing_variant_id` → draft invoice row |
| `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` | Passes `step2Values` into `buildDraftInvoiceDetailForPdf` |
| `src/features/invoices/api/invoices.api.ts` | Persists `formValues.billing_variant_id` on insert |

Also conceptually related (not builder state, but same FK): `src/features/invoices/lib/storno.ts` / RPC args copying `billing_variant_id` from **stored** invoice—not Step 2.

### 15. Where a new `billing_variant_ids` array could cause accidental effects

| Risk | Mitigation idea |
|------|------------------|
| **TanStack cache duplication / stale hits** | Include **sorted** `billing_variant_ids` in `invoiceKeys.tripsForBuilder` params object; avoid mutable array identity churn in keys |
| **PDF preview** | Draft header `billing_variant_id` should stay **`null`** for multi-variant; preview content already driven by **line items**—verify no code assumes header FK for subject line |
| **Persistence** | Do not stuff JSON into `billing_variant_id`; if audit needs subset, add dedicated nullable JSON/text column + migration |
| **per_client** | Guard rails: ignore or forbid `billing_variant_ids` when `mode === 'per_client'` to avoid conflicting with single combo |

### `database.types.ts` note (requested scope)

**`billing_variants.Row`** (Unterart catalog):

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

**Invoice tables:** This workspace’s `src/types/database.types.ts` **does not** contain top-level generated blocks for `invoices` / `invoice_line_items` (search finds RPCs like `create_storno_invoice` but not those tables). **Invoice row shape** used by the app is **`InvoiceRow` in** `src/features/invoices/types/invoice.types.ts` (see §C.10).

---

## F. Recommendation

### 16. Concrete implementation outline

**Status:** Step 2 monthly subset selection (`billing_variant_ids`) is implemented per this audit (see `docs/invoices-module.md` §Step 2).

- **UI:** **`Popover` + `Command` + checkmark rows**, patterned after `DataTableFacetedFilter` but **RHF-controlled** (no TanStack column). Keep Step 2 visually light: one row label “Unterarten (optional)” + compact trigger under Abrechnungsart.
- **State:** **Add** `billing_variant_ids: string[] | null` (or `[]` = unused) **alongside** existing `billing_variant_id` for `per_client` / single-header semantics.
- **Billing type first:** **Yes** — enable subset picker only when `billing_type_id` is set; options = variants with `billing_type_id` match (same source as `resolveBillingVariantFilters` today).
- **Invoice header:** **`billing_variant_id` stays `null`** when more than one variant contributes (or whenever subset length ≠ 1); matches existing “NULL = multi-variant invoice”.
- **Complexity:** **Medium** — one new control + resolver/fetch branching + query key + types + snapshot; **no** DB migration unless product demands persisted subset on `invoices`.

---

## Senior Recommendation

1. **Do not overload `Select`** for multi-variant; **reuse the Popover + Command + checkmark pattern** already proven in `data-table-faceted-filter.tsx`, decoupled from TanStack Table.
2. **Extend state additively:** keep **`billing_variant_id`** for single-Unterart and `per_client`; add **`billing_variant_ids`** for monthly subset. Teach **`resolveBillingVariantFilters` / `fetchTripsForBuilder`** a single precedence: explicit subset `.in(ids)` → else existing single-id → else all IDs for type → else no variant filter.
3. **Gate subset UI on Abrechnungsfamilie** to bound options and match current mental model (“Nur Fahrten dieser Abrechnungsart” + “welche Unterarten davon”).
4. **Keep `invoices.billing_variant_id = null`** for true multi-variant runs; rely on **line snapshots** for PDF grouping (already the pattern for mixed Unterarten).
5. **Reset subset when `billing_type_id` changes**—consistent with existing reset behaviour when the client changes in Step 2.
6. Plan **~medium** effort: touch Step 2, hook, keys, fetch (×2 for cancelled), Zod/types, draft snapshot; add focused tests for filter composition and cache keys.

---

*(End of Audit 5.)*
