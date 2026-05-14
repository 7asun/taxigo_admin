# AUDIT — KTS checking view & Reha-Schein (read-only)

**Scope:** codebase and Supabase migrations as present in this repo snapshot. No application code was modified for this audit.

**Related docs read:** [`docs/kts-architecture.md`](../kts-architecture.md), [`docs/print-trips-export.md`](../print-trips-export.md). (Legacy [`docs/plans/kts-audit.md`](./kts-audit.md) is partly outdated—it predates `kts_fehler`.)

---

## Inventory — routes, pages, and where KTS UI lives

| Item | Location |
|-----|----------|
| Fahrten route (App Router) | [`src/app/dashboard/trips/page.tsx`](../../src/app/dashboard/trips/page.tsx) — wraps content in [`FahrtenPageShell`](../../src/app/dashboard/trips/fahrten-page-shell.tsx); title **Fahrten**; Suspense renders [`TripsListingPage`](../../src/features/trips/components/trips-listing.tsx). |
| View toggle (Liste / Kanban) | [`src/features/trips/components/trips-view-toggle.tsx`](../../src/features/trips/components/trips-view-toggle.tsx) |
| Neue Fahrt route | [`src/app/dashboard/trips/new/page.tsx`](../../src/app/dashboard/trips/new/page.tsx) (not re-read line-by-line here; Kostenträger section is in payer section component below). |

---

## Questions — answers with file references

### 1. KTS current implementation

#### 1.1 Columns on `trips` (exact names & types — from migrations)

| Column | Type (Postgres / migration wording) |
|--------|---------------------------------------|
| `kts_document_applies` | `boolean NOT NULL DEFAULT false` ([`supabase/migrations/20260403120000_kts_catalog_and_trips.sql`](../../supabase/migrations/20260403120000_kts_catalog_and_trips.sql), lines **16–21**) |
| `kts_source` | `text DEFAULT NULL`; comment documents values **variant \| familie \| payer \| manual \| system_default** (same migration, lines **17–24**) |
| `kts_fehler` | `boolean NOT NULL DEFAULT false` ([`supabase/migrations/20260504130000_kts_fehler.sql`](../../supabase/migrations/20260504130000_kts_fehler.sql), lines **6–10**) |
| `kts_fehler_beschreibung` | `text DEFAULT null` (same migration, lines **7–13**) |

**Note on naming:** There is **no** column named “KTS falsch”. The shipped UI label for the error flag is **„KTS-Fehler“** (see [`trip-detail-sheet.tsx`](../../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx) around lines **1643–1647**).

Canonical TypeScript typing for trips is [`Database['public']['Tables']['trips']['Row']`](../../src/types/database.types.ts) — KTS-related fields appear at **`kts_document_applies`**, **`kts_source`**, **`kts_fehler`**, **`kts_fehler_beschreibung`** (**lines ~1322–1325** in `database.types.ts`).

#### 1.2 Component that renders the main KTS switch

- **Neue Fahrt / Kostenträger section:** [`src/features/trips/components/create-trip/sections/payer-section.tsx`](../../src/features/trips/components/create-trip/sections/payer-section.tsx): `FormField` **`name='kts_document_applies'`** (**lines ~233–268**). Renders **`Switch`** with label **„KTS / Krankentransportschein“** only when **`watchedPayerId`** is truthy (**line ~233**: `{watchedPayerId && (`).

**Sub-controls:** In **Neue Fahrt** there are **no** visible controls for **`kts_fehler`** / description in `payer-section.tsx` — only the main `kts_document_applies` switch. Error fields remain in schema/defaults/submit normalization (below).

- **Trip detail (edit) sheet:** [`src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx`](../../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx): payer/billing block **„KTS / Krankentransportschein“** (**~1620–1676**): main **`Switch`** bound to **`ktsDocumentAppliesDraft`**; **`Checkbox`** „KTS-Fehler“ **`ktsFehlerDraft`**; **`Textarea`** for description (**~1630–1660**).

#### 1.3 Is „KTS-Fehler“ + reason conditional on main KTS switch?

**Trip detail sheet — yes.**

- **`Checkbox` + `Textarea` block** are wrapped so they render **only if** **`ktsDocumentAppliesDraft`** is true (**lines ~1630–1662**):

```tsx
{ktsDocumentAppliesDraft ? (
  <div> ... Checkbox KTS-Fehler ... Textarea ... </div>
) : null}
```

- Turning **off** the main KTS **`Switch`** clears error draft state (**~1668–1671**):

```tsx
if (!c) {
  setKtsCatalogHint(null);
  setKtsFehlerDraft(false);
  setKtsFehlerBeschreibungDraft('');
}
```

- **`Textarea`** is **`disabled={!isOpen || !ktsFehlerDraft}`** (**~1655**).

**Neue Fahrt create form — indirectly enforced on save:** Persisted **`kts_fehler`** is forced **false** (and thus description cleared) unless **`kts_document_applies`** is also true (**`create-trip-form.tsx` ~1301–1305**):

```ts
const ktsFehlerForDb =
  !!values.kts_document_applies && !!values.kts_fehler;
const ktsFehlerBeschreibungForDb = ktsFehlerForDb
  ? values.kts_fehler_beschreibung?.trim() || null
  : null;
```

Zod refinement in **`schema.ts` ~71–84** forbids description text when **`kts_fehler`** is false (path **`kts_fehler_beschreibung`**).

---

### 2. Trip–payer relationship

#### 2.1 Foreign key

- **`trips.payer_id`** — nullable UUID FK to Kostenträger (confirmed in **`trips` Row**, [`database.types.ts`](../../src/types/database.types.ts) **`payer_id: string | null`** **~1363–1364**).

#### 2.2 Columns on `payers`

**Important:** Generated [`Tables['payers']['Row']`](../../src/types/database.types.ts) **lines ~676–687** lists a **subset**. The **actual** Postgres table has accrued more columns via migrations. Roll-up:

| Column (from migrations / app usage) | Notes |
|--------------------------------------|--------|
| `id`, `company_id`, `name`, `number`, `created_at` | Baseline payer identity / tenancy |
| `street`, `street_number`, `zip_code`, `city`, `contact_person`, `email`, `phone` | [`20260331100000_add_address_fields_to_payers.sql`](../../supabase/migrations/20260331100000_add_address_fields_to_payers.sql); `number` later becomes integer-backed per [`05-kundennummer-system.sql`](../../supabase/migrations/05-kundennummer-system.sql) |
| `rechnungsempfaenger_id` | [`20260405100002_catalog_recipient_fks.sql`](../../supabase/migrations/20260405100002_catalog_recipient_fks.sql) |
| `no_invoice_required_default` | [`20260404103000_no_invoice_fremdfirma_recurring.sql`](../../supabase/migrations/20260404103000_no_invoice_fremdfirma_recurring.sql) |
| `kts_default` | [`20260403120000_kts_catalog_and_trips.sql`](../../supabase/migrations/20260403120000_kts_catalog_and_trips.sql) |
| `default_intro_block_id`, `default_outro_block_id` | [`20260401190000_create_invoice_text_blocks.sql`](../../supabase/migrations/20260401190000_create_invoice_text_blocks.sql) |
| `pdf_vorlage_id` | [`20260408120001_pdf_vorlagen.sql`](../../supabase/migrations/20260408120001_pdf_vorlagen.sql) |
| `accepts_self_payment` | [`20260428120000_shift_reconciliations.sql`](../../supabase/migrations/20260428120000_shift_reconciliations.sql) |
| `manual_km_enabled` | [`20260505180000_manual_km_overrides_foundation.sql`](../../supabase/migrations/20260505180000_manual_km_overrides_foundation.sql) |

**App-facing interface** [`Payer` in `payer.types.ts`](../../src/features/payers/types/payer.types.ts) **~75–95** summarizes many of these (+ omits postal fields that still exist at DB layer).

#### 2.3 Feature-flag / settings on payer

There is **no** single **`settings` JSONB** on **`payers`**. Feature-like behavior uses **explicit columns** (e.g. **`kts_default`**, **`no_invoice_required_default`**, **`manual_km_enabled`**, **`accepts_self_payment`**) and **`behavior_profile` JSON on `billing_types`** (Familie-level KTS/no-invoice semantics — [`BillingTypeBehavior`](../../src/features/payers/types/payer.types.ts)).

---

### 3. Fahrten page structure

#### 3.1 Views/tabs — count, names, state

There are **2** views today:

| View | Label in UI | How active |
|-----|--------------|-------------|
| **List** | **Liste** (`List` icon) | URL query **`view=list`** (**default**) |
| **Kanban** | **Kanban** | URL query **`view=kanban`** |

- **Parser default:** **`view`** in [`src/lib/searchparams.ts`](../../src/lib/searchparams.ts) **line 24**: `parseAsString.withDefault('list')`.
- **Server reads URL:** [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) **line 48**: `const view = searchParamsCache.get('view') || 'list';`.
- **Client writes URL:** [`TripsViewToggle`](../../src/features/trips/components/trips-view-toggle.tsx) **`router.push(pathname + '?' + …)`** **`view`** **`list`** or **`kanban`** (**lines ~38–53**).

This is **not** a Radix `Tabs` primitive; it is a **segmented Button group**.

#### 3.2 Trip list query — selections and payer join

**Fetcher:** **`TripsListingPage`** (**server component**), [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx):

- **`select`** (**lines ~87–98**) uses **`trip` columns:** **`*`** (all scalar trip columns — includes all KTS fields above).
- **Joined `payers`:** **`payer:payers(name)`** only — payer **name**, not full payer row.

Also embedded FK selects: **`billing_variants`** (with **`billing_types`**), **`driver`**, **`fremdfirma`**, **`invoice_line_items` → invoices** — same block **~87–98**.

**TanStack Query / React Query on this page:** The **primary trips table payload is loaded in the RSC** (`TripsListingPage`), **not** via a `useQuery` for rows. Supporting client patterns include **`TripsRealtimeSync`** and **`TripsRscRefreshProvider`** (see **`page.tsx`**, **`fahrten-page-shell.tsx`**). Kostenträger admin list uses **`usePayers`** elsewhere; Fahrten filters may use [**`referenceKeys.payers()`**](../../src/query/keys/reference.ts) for slim lists (documented **`~20`** comment).

---

### 4. Data access patterns

#### 4.1 RLS

**Row Level Security is enabled** on **`trips`** [`20260409170000_add_missing_rls.sql`](../../supabase/migrations/20260409170000_add_missing_rls.sql) **~15**:

- **`trips_select_company_admin` / `_insert` / `_update` / `_delete`:** **`FOR authenticated`**, **`USING/WITH CHECK`** requires **`current_user_is_admin()`** and **`company_id = current_user_company_id()`**.
- **`trips_select_own_driver`**, **`trips_update_own_driver`**: driver-facing access by **`driver_id`** or **`trip_assignments`** (**~44–56**).

**Implication:** Any future **checking view** backed by **`trips`** using the normal Supabase client runs under **the same JWT + role** as today: **admins see company-wide trips**, **drivers** only assigned rows unless you add RPC/service-role paths.

#### 4.2 Edge Functions vs direct queries

Under **`supabase/`** there is **no `functions/`** subtree in this repo snapshot. Trip reads/writes on Fahrten are **direct Postgres via Supabase client** (server **`createClient` from `@/lib/supabase/server`** in listing; client in services). Auxiliary **Next.js Route Handlers** exist under **`src/app/api/trips/`** (e.g. **`export/route.ts`** references **`kts_document_applies`** **~233**).

---

### 5. Payer settings UI

#### 5.1 Where

- **`PayerDetailsSheet`** — [`src/features/payers/components/payer-details-sheet.tsx`](../../src/features/payers/components/payer-details-sheet.tsx) **line 91** `export function PayerDetailsSheet`.

#### 5.2 Boolean / tri-state toggles

Not exhaustive of every field (full sheet is large), but **explicit catalog-style toggles** include:

- **KTS-Standard (Kostenträger):** **`Select`** with **`ktsSelectValue`** **`yes | no | unset`** (**~289–294**, **`~464–485`**), persists via **`handleKtsDefaultChange`** (**~229**).
- **„Keine Rechnung“-Standard**, **Selbstzahler**, **PDF-Vorlage**, **Rechnungsempfänger**, **Rechnungsvorlagen (Intro/Outro)** — **`Select`/save handlers** (**~296–382** and adjacent JSX).
- **Manual KM (`manual_km_enabled`):** **`Switch`** (**grep hit ~504** with **`displayPayer.manual_km_enabled`**).

Familie/Unterart KTS cascade is edited from **nested dialogs**: **`billing-type-behavior-dialog.tsx`** (Zod **`kts_default` enum `'unset'|'yes'|'no'`** **line 53**), **`edit-billing-variant-dialog.tsx`** (**`kts_variant`** tri-state mapped to **`billing_variants.kts_default`**).

---

### 6. Risk surface — files outside `/dashboard/trips` that reference KTS trip/pricing semantics

Grouped for scanning; **`kts_override`** denotes **invoice line item** €0-resolution tier (from **`invoice_line_items`**, migration [`20260405100004_invoice_line_items_pricing.sql`](../../supabase/migrations/20260405100004_invoice_line_items_pricing.sql)), aligned with **`kts_document_applies`** from trips.

| Area | Representative files |
|------|---------------------|
| **Invoicing** | [`invoice-line-items.api.ts`](../../src/features/invoices/api/invoice-line-items.api.ts); [`step-3-line-items.tsx`](../../src/features/invoices/components/invoice-builder/step-3-line-items.tsx); [`invoice.types.ts`](../../src/features/invoices/types/invoice.types.ts); [`use-invoice-builder.ts`](../../src/features/invoices/hooks/use-invoice-builder.ts); [`resolve-trip-price.ts`](../../src/features/invoices/lib/resolve-trip-price.ts); [`price-calculator.ts`](../../src/features/invoices/lib/price-calculator.ts); [`invoice-validators.ts`](../../src/features/invoices/lib/invoice-validators.ts); [`pricing-strategy-labels-de.ts`](../../src/features/invoices/lib/pricing-strategy-labels-de.ts); [`storno.ts`](../../src/features/invoices/lib/storno.ts); PDF helpers under [`invoice-pdf/`](../../src/features/invoices/components/invoice-pdf/) |
| **Trip pricing engine** | [`trip-price-engine.ts`](../../src/features/trips/lib/trip-price-engine.ts) (**`kts_document_applies`** in **`shouldRecalculatePrice`**, pricing context select) |
| **Duplicate / return / drafts** | [`duplicate-trips.ts`](../../src/features/trips/lib/duplicate-trips.ts); [`build-return-trip-insert.ts`](../../src/features/trips/lib/build-return-trip-insert.ts); [`create-trip-draft.ts`](../../src/features/trips/lib/create-trip-draft.ts) |
| **Bulk CSV import** | [`bulk-upload-dialog.tsx`](../../src/features/trips/components/bulk-upload-dialog.tsx); [`bulk-upload-types.ts`](../../src/features/trips/components/bulk-upload/bulk-upload-types.ts); [`resolve-billing-variants-step.tsx`](../../src/features/trips/components/bulk-upload/resolve-billing-variants-step.tsx) |
| **Recurring cron** | [`src/app/api/cron/generate-recurring-trips/route.ts`](../../src/app/api/cron/generate-recurring-trips/route.ts) |
| **Export API** | [`src/app/api/trips/export/route.ts`](../../src/app/api/trips/export/route.ts); [`csv-export-constants.ts`](../../src/features/trips/components/csv-export/csv-export-constants.ts) **key `'kts_document_applies'` line ~97** |
| **Print / JPEG / PDF-style cards** | [`print-trip-groups-list.tsx`](../../src/features/trips/components/print-trip-groups-list.tsx); [`mobile-print-template.tsx`](../../src/features/trips/components/mobile-print-template.tsx); see [`docs/print-trips-export.md`](../print-trips-export.md) |
| **Katalog cascade** | [`resolve-kts-default.ts`](../../src/features/trips/lib/resolve-kts-default.ts); payers **`payers.service.ts`**, dialogs above |
| **Recurring rule UI** | [`recurring-rule-form-body.tsx`](../../src/features/clients/components/recurring-rule-form-body.tsx); [`recurring-rule-billing-fields.tsx`](../../src/features/clients/components/recurring-rule-billing-fields.tsx) |
| **Unassigned trips** | [`unassigned-trips.service.ts`](../../src/features/unassigned-trips/api/unassigned-trips.service.ts); settings page selects **`kts_document_applies`** ([`src/app/dashboard/settings/unzugeordnete-fahrten/page.tsx`](../../src/app/dashboard/settings/unzugeordnete-fahrten/page.tsx)) |
| **Operational scripts** | e.g. [`scripts/backfill-null-trip-net-prices.ts`](../../scripts/backfill-null-trip-net-prices.ts) selects **`kts_document_applies`** **line ~45** |
| **Tests / fixtures** | Various `__tests__` and **`example-invoice-reha-zentrum.ts`** |

Related DB objects (not exhaustive): **`recurring_rules.kts_*`** parallel to trips (**[`20260403120000_kts_catalog_and_trips.sql`](../../supabase/migrations/20260403120000_kts_catalog_and_trips.sql)**); **`billing_variants.kts_default`**, **`billing_types`** JSON **`behavior_profile.kts_default`**.

---

## Senior recommendations

### A. Adding `reha_schein` (or similar) on `trips`

- **Structural fit:** The **`trips`** table already carries **orthogonal operational booleans/strings** beside billing FKs (**`no_invoice_*`**, **`kts_*`**). Adding a **`boolean NOT NULL DEFAULT false`** (**or nullable tri-state**, if inherit semantics matter) follows the same mechanical pattern as **`kts_document_applies`**.
- **Caveats before “just a column”:** If Reha behaves like **KTS** (catalog defaults, recurrence copy, duplication, CSV, pricing), you likely need the **same cross-cutting propagation** (**`recurring_rules`**, **`duplicate-trips`**, **`build-return-trip-insert`**, maybe **export**)—not only a column.

### B. Third tab vs current pattern

- Today **Fahrten** uses **two URL-driven mutually exclusive layouts** (** Liste / Kanban **). Extending **`TripsViewToggle`** (+ **`searchParams.view`** + **`trips-listing` branch**) is consistent and low-surprise (`TripsKanbanBoard` already switches on **`view`**).
- **Alternative:** a **heavy filter preset** (**“Nur Schein-QA”**) could avoid expanding nav surface if the view is primarily a narrowed list (depends on UX).

### C. Naming conventions

- **Postgres:** **snake_case**, mostly **English** fragment identifiers (**`kts_document_applies`**, **`billing_variant_id`**), with **`kts_fehler`** / **`…_beschreibung`** as **German** operational labels mirrored in identifiers.
- **TypeScript/domain:** Interfaces mix **German domain nouns** in UI strings and **`Payer`**/**`Trip`** names; enums for stored tiers use **English** tokens (**`manual`**, **`variant`** in **`kts_source`**).
- **Suggestion:** Prefer **`snake_case` DB** + **English technical root** (**`reha_schein`**, **`requires_rehabilitation_certificate`**) for consistency **unless** product insists German column names (**`rehaschein_erforderlich`**) everywhere—either way document in **`database.types`** and [`kts-architecture.md`](../kts-architecture.md)-style canon.

---

*End of audit.*
