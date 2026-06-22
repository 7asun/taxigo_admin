# KTS Abrechnung Audit

## 1. trips table - financial columns

Literal `beleg_nr`:

- No literal `trips.beleg_nr` column was found in `src/types/database.types.ts` or the KTS migrations read.
- Equivalent/current column: `trips.kts_belegnummer`.
- Migration definition in `supabase/migrations/20260610171000_kts_external_invoices.sql`: `ADD COLUMN IF NOT EXISTS kts_belegnummer text`.
- Type definition in `src/types/database.types.ts`: `kts_belegnummer: string | null` on `Database['public']['Tables']['trips']['Row']`; optional `string | null` in `Insert` and `Update`.
- Comment in `supabase/migrations/20260610171000_kts_external_invoices.sql`: `Rechnungsnummer from accountant invoice CSV. One Belegnummer may cover multiple trips (outbound + return). Stamped at CSV import time (Flow 2). NOT the Krankenkasse payment reference.`
- Population: not all rows by schema (`NULL` allowed). The only write path found is CSV import RPC `public.apply_kts_invoice_import`, which sets `kts_belegnummer = r.belegnummer` only where `t.kts_belegnummer IS NULL`. Existing runtime coverage is `UNCLEAR` without querying data.

Literal `betrag`:

- No literal `trips.betrag` column was found in `src/types/database.types.ts` or the KTS migrations read.
- Equivalent/current amount column: `trips.kts_invoice_amount`.
- Migration definition in `supabase/migrations/20260610171000_kts_external_invoices.sql`: `ADD COLUMN IF NOT EXISTS kts_invoice_amount numeric(10, 2)`.
- Type definition in `src/types/database.types.ts`: `kts_invoice_amount: number | null` on `Database['public']['Tables']['trips']['Row']`; optional `number | null` in `Insert` and `Update`.
- Comment in `supabase/migrations/20260610171000_kts_external_invoices.sql`: `Gesamtpreis invoiced to Krankenkasse (from accountant CSV Gesamtpreis column). Represents amount INVOICED, not amount PAID. Payment tracking is Flow 3 / PR4.2.`
- Population: not all rows by schema (`NULL` allowed). The only write path found is CSV import RPC `public.apply_kts_invoice_import`, which sets `kts_invoice_amount = r.invoice_amount` only where `t.kts_belegnummer IS NULL`. Existing runtime coverage is `UNCLEAR` without querying data.

Other billing, settlement amount, or CSV import related columns on `trips`:

- KTS/accountant CSV columns in `src/types/database.types.ts`: `kts_belegnummer: string | null`, `kts_invoice_amount: number | null`, `kts_eigenanteil: number | null`, `kts_external_invoice_id: string | null`, `kts_handover_id: string | null`.
- KTS migration definitions in `supabase/migrations/20260610171000_kts_external_invoices.sql`: `kts_belegnummer text`, `kts_invoice_amount numeric(10, 2)`, `kts_eigenanteil numeric(10, 2)`, `kts_external_invoice_id uuid REFERENCES public.kts_external_invoices(id) ON DELETE SET NULL`.
- Handover migration definition in `supabase/migrations/20260610160000_kts_handovers.sql`: `kts_handover_id uuid REFERENCES public.kts_handovers(id) ON DELETE SET NULL`.
- Other billing/amount fields visible in `src/types/database.types.ts` on `trips`: `billing_betreuer`, `billing_calling_station`, `billing_variant_id`, `payer_id`, `payment_method`, `billing_type_id`, `no_invoice_required`, `no_invoice_source`, `selbstzahler_collected_amount`, `net_price`, `gross_price`, `tax_rate`, `base_net_price`, `approach_fee_net`, `manual_distance_km`, `manual_gross_price`, `manual_tax_rate`, `fremdfirma_cost`, `fremdfirma_id`, `fremdfirma_payment_mode`.
- No `invoice_id`, `settlement_id`, `csv_import_id`, literal `amount`, or literal `abrechnungsbetrag` column on `trips` was found in `src/types/database.types.ts`.

## 2. kts_status values

Current `trips.kts_status` values found in migrations, generated types, service constants, labels, and filter values:

- `ungeprueft`
- `korrekt`
- `fehlerhaft`
- `in_korrektur`
- `uebergeben`
- `abgerechnet`

Sources:

- `supabase/migrations/20260610140000_kts_status.sql` creates `public.kts_status AS ENUM ('ungeprueft', 'korrekt', 'fehlerhaft', 'in_korrektur', 'uebergeben')`.
- `supabase/migrations/20260610170000_kts_abgerechnet_status.sql` adds `ALTER TYPE public.kts_status ADD VALUE IF NOT EXISTS 'abgerechnet' AFTER 'uebergeben'`.
- `src/types/database.types.ts` defines `Database['public']['Enums']['kts_status']` as `'ungeprueft' | 'korrekt' | 'fehlerhaft' | 'in_korrektur' | 'uebergeben' | 'abgerechnet'`.
- `src/types/database.types.ts` exports `Constants.public.Enums.kts_status` with `['ungeprueft', 'korrekt', 'fehlerhaft', 'in_korrektur', 'uebergeben', 'abgerechnet']`.
- `src/features/kts/kts.service.ts` exports constants `KTS_STATUS_UNGEPRUEFT`, `KTS_STATUS_KORREKT`, `KTS_STATUS_FEHLERHAFT`, `KTS_STATUS_IN_KORREKTUR`, `KTS_STATUS_UEBERGEBEN`, `KTS_STATUS_ABGERECHNET`.
- `src/lib/kts-status.ts` includes all six values in `KTS_STATUS_LABELS`, `KTS_STATUS_DOT`, and `KTS_STATUS_VALUES`.

Settled after CSV upload:

- The status value used for accountant CSV import is literally `abgerechnet`.
- `supabase/migrations/20260610172000_kts_invoice_import_rpc.sql`, `20260610173000_kts_invoice_import_rpc_v2.sql`, and `20260610174000_kts_invoice_import_rpc_v3.sql` set `kts_status = 'abgerechnet'::public.kts_status`.
- `src/features/kts/kts.service.ts` defines `KTS_STATUS_ABGERECHNET = 'abgerechnet' as KtsStatus`.

Column type:

- `kts_status` is a Postgres enum, not plain text/varchar.
- Migration: `ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS kts_status public.kts_status DEFAULT NULL`.
- Type file: `kts_status: Database['public']['Enums']['kts_status'] | null`.

## 3. kts_corrections table

Columns in `public.kts_corrections` from `supabase/migrations/20260610120000_kts_corrections.sql`:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
- `company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE`
- `trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE`
- `sent_to text NOT NULL`
- `sent_at timestamptz NOT NULL`
- `received_at timestamptz`
- `notes text`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`

Type definition in `src/types/database.types.ts`:

- `company_id: string`
- `created_at: string`
- `created_by: string | null`
- `id: string`
- `notes: string | null`
- `received_at: string | null`
- `sent_at: string`
- `sent_to: string`
- `trip_id: string`

Financial or billing columns:

- No amount, `beleg_nr`, `belegnummer`, invoice, settlement, or CSV import columns were found on `kts_corrections`.

Relationship to `beleg_nr` or settlement batch:

- `kts_corrections.trip_id` references `public.trips(id)`.
- No direct relationship to `kts_belegnummer`, `kts_external_invoices`, `kts_handovers`, or a settlement batch was found.
- Any indirect relationship would be through the same parent `trips` row; no explicit FK or column on `kts_corrections` exists for it.

## 4. CSV import - how does "Abgerechnet" get set?

Existing code that handles CSV upload and sets `kts_status = 'abgerechnet'`:

- UI entry: `src/app/dashboard/kts/kts-header.tsx`, component `KtsHeader`, button `CSV importieren` opens `KtsCsvImportDialog`.
- Dialog: `src/features/kts/components/kts-csv-import-dialog.tsx`, component `KtsCsvImportDialog`, uses Papa Parse and `useKtsCsvImport`.
- Orchestration: `src/features/kts/hooks/use-kts-csv-import.ts`, hook `useKtsCsvImport`, function `onConfirm`.
- Mutation hook: `src/features/kts/hooks/use-kts-invoice-import.ts`, hook `useApplyKtsInvoiceImportMutation`.
- Service function: `src/features/kts/kts.service.ts`, function `applyKtsInvoiceImport`.
- Database RPC: `public.apply_kts_invoice_import` in latest migration `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql`.

What the import writes:

- `src/features/kts/hooks/use-kts-csv-import.ts` sends rows with `tripId`, `belegnummer`, `invoiceAmount`, `eigenanteil`, and `patientId`.
- `src/features/kts/kts.service.ts` maps payload rows to RPC rows with `trip_id`, `belegnummer`, `invoice_amount`, `eigenanteil`, `patient_id`.
- `supabase/migrations/20260610174000_kts_invoice_import_rpc_v3.sql` updates `public.trips` with:
  - `kts_belegnummer = r.belegnummer`
  - `kts_invoice_amount = r.invoice_amount`
  - `kts_eigenanteil = r.eigenanteil`
  - `kts_external_invoice_id = v_import_id`
  - `kts_status = 'abgerechnet'::public.kts_status`
  - `kts_patient_id = CASE ... END` (null-only/no-clobber backfill)
- The same RPC inserts one row into `public.kts_external_invoices`.
- It also backfills `public.clients.kts_patient_id` null-only when `trips.client_id` is set and the CSV provides a non-empty `patient_id`.

Separate CSV import table:

- Table name: `public.kts_external_invoices`.
- Columns from `supabase/migrations/20260610171000_kts_external_invoices.sql`:
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`
  - `kts_handover_id uuid REFERENCES public.kts_handovers(id) ON DELETE SET NULL`
  - `row_count integer NOT NULL DEFAULT 0`
  - `source_filename text`
- Type definition in `src/types/database.types.ts`: `company_id: string`, `created_at: string`, `created_by: string | null`, `id: string`, `kts_handover_id: string | null`, `row_count: number`, `source_filename: string | null`.

## 5. Current KTS table component

`KtsTable` location:

- Requested path `src/features/kts/components/kts-table.tsx` does not exist.
- Actual component path: `src/features/kts/components/kts-table/index.tsx`.
- `src/features/kts/components/kts-listing-page.tsx` imports it via `@/features/kts/components/kts-table`.

Visible columns rendered by `createKtsColumns` in `src/features/kts/components/kts-table/kts-columns.tsx`:

- `select` - checkbox column, no visible text header.
- `scheduled_at` - header title `Termin`.
- `client_name` - header title `Fahrgast`.
- `kts_patient_id` - header title `KTS-Patient-ID`.
- `route` - header title `Route`.
- `kts_status` - header title `Status`.
- `kts_belegnummer` - header title `Beleg-Nr.`.
- `kts_invoice_amount` - header title `Betrag`.
- `actions` - screen-reader header `Aktionen`.

Display of `beleg_nr` or `betrag`:

- No literal `beleg_nr` or `betrag` is shown.
- `kts_belegnummer` is shown as `Beleg-Nr.`.
- `kts_invoice_amount` is shown as `Betrag` and formatted with `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })`.

Table implementation:

- `KtsTable` uses `useDataTable` from `src/hooks/use-data-table` with TanStack column definitions from `@tanstack/react-table`.
- Rendering is custom KTS table chrome in `src/features/kts/components/kts-table/kts-data-table.tsx`, using shadcn table primitives from `@/components/ui/table`, `ScrollArea`, and `DataTablePagination`.
- This is a custom KTS table built on TanStack + shadcn primitives, not the generic shared `DataTable` component.

Expandable rows:

- Yes.
- `src/features/kts/components/kts-table/index.tsx` stores `expandedRow` as `KtsExpandState`.
- `KtsExpandState` is defined in `src/features/kts/components/kts-table/kts-actions-cell.tsx` as `{ id: string; mode: 'fehler' | 'send' } | null`.
- `KtsActionsCell` calls `setExpandedRow({ id: trip.id, mode })`.
- `KtsDataTable` renders an extra `<TableRow>` when `expandedRow?.id === row.id`, containing `KtsExpandRow`.
- `KtsExpandRow` renders either a `Textarea` for `mode === 'fehler'` or an `Input` for `mode === 'send'`.

## 6. KtsFiltersBar and searchParams

Registered parameters in `searchParamsCache` from `src/lib/searchparams.ts`:

- `page`: integer, default `1`.
- `perPage`: integer, default `50`.
- `search`: string.
- `name`: string.
- `gender`: string.
- `category`: string.
- `status`: string.
- `driver_id`: string.
- `payer_id`: array of strings, comma-separated.
- `billing_variant_id`: array of strings, comma-separated.
- `invoice_status`: string.
- `kts_filter`: array of strings, comma-separated.
- `kts_status`: array of strings, comma-separated.
- `overdue`: boolean, default `false`.
- `scheduled_at`: string.
- `sort`: string.
- `view`: string, default `list`.
- `role`: string, default `all`.

`kts_status` filter:

- Yes, `searchParamsCache` registers `kts_status: parseAsArrayOf(parseAsString, ',')`.
- `src/features/kts/components/kts-filters-bar.tsx` reads `searchParams.get('kts_status')` and displays `KTS_STATUS_VALUES.map(...)`.
- `src/lib/kts-status.ts` includes `abgerechnet` in `KTS_STATUS_VALUES`, so `abgerechnet` is included as a filter option.
- `KtsFiltersBar` defaults the page to `kts_status=ungeprueft` on first mount if `kts_status` is absent.

Tabs or view mode:

- `src/lib/searchparams.ts` globally registers `view: parseAsString.withDefault('list')`.
- No KTS-specific tab switcher, `Tabs`, `TabsList`, `TabsTrigger`, or view-mode usage was found in `src/app/dashboard/kts`, `src/features/kts`, or `src/lib/searchparams.ts`.
- Current KTS page structure is a single flat listing plus filters/KPIs; no tab-based view switching exists today.

## 7. KtsPageShell and KtsHeader

`KtsPageShell`:

- File: `src/app/dashboard/kts/kts-page-shell.tsx`.
- Component: `KtsPageShell`.
- It is a client boundary and context provider wrapper: `return <TripsRscRefreshProvider>{children}</TripsRscRefreshProvider>;`.
- It does not render visible layout chrome by itself.

`KtsHeader`:

- File: `src/app/dashboard/kts/kts-header.tsx`.
- Component: `KtsHeader`.
- Renders title `KTS`.
- Renders subtitle `Belegprüfung und Korrekturverwaltung`.
- Renders action button `CSV importieren`, which opens `KtsCsvImportDialog`.
- Renders a KPI visibility toggle button with labels `Ausblenden` / `Übersicht anzeigen`.
- Renders `KtsKpiSection`.
- It is a flat header with actions and collapsible KPIs; no tab bar or view switching prep was found.

Page composition:

- `src/app/dashboard/kts/page.tsx` renders `KtsPageShell`, `PageContainer scrollable={false}`, `KtsHeader`, `Suspense` with `DataTableSkeleton`, `KtsListingPage`, and `TripsRealtimeSync`.

## 8. Existing docs

`docs/` exists.

KTS module doc:

- Path: `docs/kts-architecture.md`.
- Summary: This is the canonical KTS architecture document. It describes catalog cascade defaults (`payers`, `billing_types.behavior_profile`, `billing_variants`), trip persistence fields including `kts_document_applies`, `kts_status`, `kts_patient_id`, `kts_belegnummer`, `kts_invoice_amount`, `kts_eigenanteil`, and `kts_external_invoice_id`, the `kts_corrections` table, the `kts_status` state machine, `kts_handovers`, accountant CSV import via `kts_external_invoices` and `apply_kts_invoice_import`, the `/dashboard/kts` queue page, UI surfaces, service functions, and a roadmap for later payment/review flows.

KTS-related files found in `docs/`:

- `docs/kts-architecture.md`
- `docs/plans/kts-module-a-architecture-audit.md`
- `docs/plans/kts-rpc-tenant-guard-deferred.md`
- `docs/plans/kts-pr3-2-page-shell-audit.md`
- `docs/plans/kts-module-b-patient-id-audit.md`
- `docs/plans/kts-pr3-1-status-audit.md`
- `docs/plans/kts-workflow-audit.md`
- `docs/plans/kts-reha-overlap-indicator-audit.md`
- `docs/plans/kts-filter-reconciliation-audit.md`
- `docs/plans/kts-pr2-1-1-badges-audit.md`
- `docs/plans/kts-pr1-deferred-paths-audit.md`
- `docs/plans/kts-pr3-5-page-shell-audit.md`
- `docs/plans/kts-pr2-columns-audit.md`
- `docs/plans/kts-reha-audit.md`
- `docs/plans/kts-patient-id-backfill-audit.md`
- `docs/plans/kts-audit.md`
- `docs/plans/kts-module-b-audit.md`
- `docs/plans/kts-filter-audit.md`

`.cursor/plans/` exists.

KTS-related plan files found in `.cursor/plans/`:

- `.cursor/plans/plan_e_inline_kts_reha_44831f8d.plan.md`
- `.cursor/plans/kts_pr3.2_queue_page_c140c62d.plan.md`
- `.cursor/plans/kts_filter_dropdown_944b7343.plan.md`
- `.cursor/plans/kts-patient-id-hardening_a91f454c.plan.md`
- `.cursor/plans/kts_reha_indicator_af62533a.plan.md`
- `.cursor/plans/kts_pr2.2_detail_ui_33b37dce.plan.md`
- `.cursor/plans/kts_pr3_patient_id_ad6e7de4.plan.md`
- `.cursor/plans/kts_sec01_rpc_guard.plan.md`
- `.cursor/plans/kts-fehler_feature_6a2db4aa.plan.md`
- `.cursor/plans/kts_pr2_schema_51cbc82c.plan.md`
- `.cursor/plans/kts_service_pr1_503c5297.plan.md`
- `.cursor/plans/kts_copy_sanitize_pr1.5_cd9b5b79.plan.md`
- `.cursor/plans/kts_document_workflow.plan.md`
- `.cursor/plans/pr3.3_kts_handover_5df2b17f.plan.md`
- `.cursor/plans/kts-filter-fix_612fa74f.plan.md`
- `.cursor/plans/kts_pr2.1_service_hooks_cf967f6d.plan.md`
- `.cursor/plans/kts_pr3.1_status_b10cae3b.plan.md`

## Senior Recommendation

`beleg_nr` and `betrag` are not the actual column names, but the implemented equivalents `kts_belegnummer` and `kts_invoice_amount` are structurally ready for grouping/aggregation: both are nullable, typed (`text`, `numeric(10,2)`), stamped atomically by `apply_kts_invoice_import`, and linked to an import batch via `kts_external_invoice_id`. `kts_eigenanteil` is also available for patient co-payment aggregation.

The single biggest unknown/risk for adding a tab-based Abrechnung view is runtime data completeness and grouping semantics, not column existence. The files prove CSV-imported trips are stamped, but they do not prove how many historical `abgerechnet` trips have `kts_belegnummer` and `kts_invoice_amount`, whether one `kts_belegnummer` should always group multiple trips, or whether admins expect grouping by `kts_belegnummer`, `kts_external_invoice_id`, `kts_handover_id`, or a combination.

No schema migration appears required before UI work can begin for an accountant-invoice aggregation view based on existing CSV import data. A data backfill may be required if historical rows exist with `kts_status = 'abgerechnet'` but missing `kts_belegnummer`, `kts_invoice_amount`, or `kts_external_invoice_id`; that is `UNCLEAR` without querying production/local data.
