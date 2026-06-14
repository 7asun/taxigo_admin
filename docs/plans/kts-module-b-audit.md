# KTS Module B — Architecture Audit

**Date:** 2026-06-10  
**Scope:** Read-only audit preparing **Module B** (KTS external Beleg recording + CSV matching per PR4, and bank CSV reconciliation per PR5 in [`docs/kts-architecture.md`](../kts-architecture.md)).  
**Constraint:** No code changes — findings only.

---

## Sources read

### Supabase migrations (109 files; reviewed newest → oldest)

Key files read in full or in part (newest first):

| Migration | Relevance |
| --------- | --------- |
| `20260610120000_kts_corrections.sql` | `kts_corrections` table, RLS, `trip_kts_correction_summaries` RPC |
| `20260608140100_update_shift_day_summaries.sql` | Shift summaries (unrelated to Module B) |
| `20260608140000_add_reconciliation_status.sql` | Schichtzettel reconciliation |
| `20260608130000_admin_shift_entry.sql` | Admin shifts |
| `20260605120200_create_branch_draft_rpc.sql` | Invoice branch draft RPC (references `invoice_line_items`) |
| `20260530120000_controlling_rpcs.sql` | Controlling RPCs |
| `20260529080000_draft_invoice_editing_foundation.sql` | Draft invoice editing |
| `20260528062000_invoice_line_items_billing_inclusion.sql` | `billing_included`, `is_cancelled_trip`, … |
| `20260505180000_manual_km_overrides_foundation.sql` | `effective_distance_km`, `original_distance_km` on line items |
| `20260410120001_invoice_line_items_billing_type_name.sql` | `billing_type_name` |
| `20260409120000_phase8_approach_fee_single_row.sql` | `approach_fee_net` |
| `20260407120000_invoice_line_items_trip_meta_snapshot.sql` | `trip_meta_snapshot` |
| `20260405100004_invoice_line_items_pricing.sql` | Pricing provenance columns |
| `20260331130000_create_invoice_line_items.sql` | Base `invoice_line_items` DDL |
| `20260403120000_kts_catalog_and_trips.sql` | KTS columns on `trips` |
| `20260402120000_company_assets_storage_rls.sql` | Supabase Storage bucket RLS |

No migration defines `kts_external_invoices` or `kts_external_invoice_trips` (PR4 not yet implemented).

### Application code

- `src/features/trips/api/trips.service.ts`
- `src/features/trips/trip-detail-sheet/components/kts-correction-form.tsx`
- `src/features/trips/trip-detail-sheet/components/kts-correction-timeline.tsx`
- `src/features/kts/kts.service.ts`, `src/features/kts/hooks/use-kts-corrections.ts`
- All `src/**` files with **invoice** in the filename (132 files; key import/upload paths cited below)
- No `src/**` files with **import** in the filename (import logic lives under other names — see §3)

### Documentation

Module and integration docs under `docs/` including: `kts-architecture.md`, `invoices-module.md`, `bulk-trip-upload.md`, `bulk-upload-behavior-rules.md`, `SUPABASE_INTEGRATION.md`, `access-control.md`, `company-logo-upload.md`, `storage-upload-troubleshooting.md`, `server-state-query.md`, `plans/kts-module-a-architecture-audit.md`, and related KTS/billing plans.

---

## Audit answers

### 1. Trips table UUID column name

**Answer:** The primary key is **`trips.id`** — a standard Supabase/Postgres UUID column (`uuid PRIMARY KEY DEFAULT gen_random_uuid()`). There is **no separate UUID column**; `id` is the canonical trip identifier everywhere.

Evidence:

- `Database['public']['Tables']['trips']['Row']` in `src/types/database.types.ts` includes `id: string` alongside `company_id: string | null`.
- Foreign keys reference `public.trips(id)` (e.g. `kts_corrections.trip_id`, `invoice_line_items.trip_id`).
- Application code uses `trip.id` / `tripId` consistently (`tripsService.updateTrip(tripId, …)`, KTS hooks, detail sheet).

---

### 2. Existing `invoice_line_items` table

**Answer:** **Yes.** Created in `20260331130000_create_invoice_line_items.sql` with follow-on migrations adding columns.

**Full column inventory (base + migrations):**

| Column | Type / notes |
| ------ | ------------ |
| `id` | `uuid` PK, `gen_random_uuid()` |
| `invoice_id` | `uuid NOT NULL` → `invoices(id)` ON DELETE CASCADE |
| `trip_id` | `uuid` nullable → `trips(id)` (informational; display uses snapshots) |
| `position` | `integer NOT NULL` (1-based PDF order) |
| `line_date` | originally `date`, altered to `timestamptz` in `20260402083000_alter_line_date_to_timestamp.sql` |
| `description` | `text NOT NULL` |
| `client_name` | `text` |
| `pickup_address` | `text` |
| `dropoff_address` | `text` |
| `distance_km` | `numeric(8,2)` — routing snapshot |
| `unit_price` | `numeric(10,4) NOT NULL` |
| `quantity` | `numeric(8,2) NOT NULL DEFAULT 1` |
| `total_price` | `numeric(10,2) NOT NULL` |
| `tax_rate` | `numeric(5,4) NOT NULL` |
| `billing_variant_code` | `text` |
| `billing_variant_name` | `text` |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` |
| `pricing_strategy_used` | `text` (`20260405100004`) |
| `pricing_source` | `text` |
| `kts_override` | `boolean NOT NULL DEFAULT false` |
| `price_resolution_snapshot` | `jsonb` |
| `trip_meta_snapshot` | `jsonb` (`20260407120000`) |
| `billing_type_name` | `text` (`20260410120001`) |
| `approach_fee_net` | `numeric(10,2)` (`20260409120000`) |
| `effective_distance_km` | `double precision` (`20260505180000`) |
| `original_distance_km` | `double precision` |
| `billing_included` | `boolean NOT NULL DEFAULT true` (`20260528062000`) |
| `billing_exclusion_reason` | `text` |
| `is_cancelled_trip` | `boolean NOT NULL DEFAULT false` |
| `cancelled_billing_reason` | `text` |

TypeScript mirror: `InvoiceLineItemRow` in `src/features/invoices/types/invoice.types.ts`.

RLS: `20260401180000_invoices_invoice_line_items_rls.sql`.

**Note:** `invoice_line_items` is **not** in the generated `Database['public']['Tables']` section of `database.types.ts` (only RPC `replace_draft_invoice_line_items` appears). Runtime access uses hand-maintained types in `invoice.types.ts` and service APIs.

---

### 3. Existing import infrastructure

**Answer:** **Yes** — multiple patterns, all feature-local (no generic “imports module”).

| Feature | Location | Mechanism |
| ------- | -------- | --------- |
| **Bulk trip CSV upload** | `src/features/trips/components/bulk-upload-dialog.tsx` | Client: `Papa.parse` → validate rows → `tripsService.bulkCreateTrips` via Supabase browser client. Post-upload client-linking wizard. Docs: `docs/bulk-trip-upload.md`, `docs/bulk-upload-behavior-rules.md`. |
| **Bank CSV (Zahlungsabgleich)** | `src/features/bank-reconciliation/` | Client: `parse-bank-csv.ts` (`Papa.parse`) → `match-invoices.ts` → `useUpdateInvoiceStatus` batch mutations. Orchestrated by `use-zahlungsabgleich.ts`. UI: `zahlungsabgleich-dialog.tsx` + `review-table.tsx`. |
| **Trips CSV export** | `src/app/api/trips/export/route.ts` | Server API route: `unparse` from Papa Parse (export only, not import). |
| **Trips CSV export (client)** | `src/features/trips/components/csv-export/` | Client-side export helpers. |

**Server actions for file processing:** None found. File parsing happens **client-side** for both bulk trips and bank reconciliation. Writes go through Supabase client hooks/services or TanStack Query mutations — not through `'use server'` file handlers.

**No files under `src/` contain “import” in the filename.** Import behavior is embedded in bulk-upload and bank-reconciliation features.

---

### 4. Supabase Storage file upload

**Answer:** **Yes** — one production use case.

| File | Usage |
| ---- | ----- |
| `src/features/company-settings/api/company-settings.api.ts` | `CompanySettingsService.uploadLogo()` → `supabase.storage.from('company-assets').upload(...)`; `deleteLogo()` → `.remove(...)`. Bucket RLS in `20260402120000_company_assets_storage_rls.sql`. |
| `docs/company-logo-upload.md`, `docs/storage-upload-troubleshooting.md` | Operational docs |

**Shared UI component (local files only, not Storage):**

| File | Usage |
| ---- | ----- |
| `src/components/file-uploader.tsx` | Generic `react-dropzone` wrapper |
| `src/components/forms/form-file-upload.tsx` | Form field wrapper |
| `src/features/trips/components/bulk-upload-dialog.tsx` | CSV pick → read in memory |
| `src/features/bank-reconciliation/components/zahlungsabgleich-dialog.tsx` | Bank CSV pick → read in memory |

**Module B implication:** Storage is available and documented, but **CSV imports today do not persist files to Storage** — they parse in the browser and discard the file.

---

### 5. Edge Functions usage

**Answer:** **None deployed in this repo.**

- No `supabase/functions/` directory.
- `supabase/config.toml` has commented Edge Function / hook placeholders only.
- Background work uses **Next.js API routes** instead, e.g.:
  - `src/app/api/cron/generate-recurring-trips/route.ts` — Vercel cron; `CRON_SECRET` auth; calls `generateRecurringTrips()` with service role.
  - Other API routes under `src/app/api/` (trips export, driving-metrics proxy, driver PATCH, etc.) — standard Route Handlers, not Supabase Edge Functions.

**Module B implication:** Introducing Edge Functions would be a **new operational surface** (CLI deploy, secrets, Deno runtime). The project’s established pattern is Next.js server routes + Supabase Postgres RLS/RPC.

---

### 6. Server actions pattern

**Answer:** Thin `'use server'` wrappers in feature `actions.ts` files that delegate to service layer — **no direct Supabase calls in the action file**.

**Example:** `src/features/shift-reconciliations/actions.ts`

| Aspect | Pattern |
| ------ | ------- |
| **Location** | `src/features/<feature>/actions.ts` (also `src/features/driver-planning/actions.ts`, `src/features/trips/api/recurring-rules.actions.ts`, `src/lib/driver-availability.actions.ts`) |
| **Naming** | `<verb><Entity>Action` — e.g. `completeReconciliationAction`, `getShiftTripsForDateAction` |
| **Return type** | Data fetches: direct domain types (`ShiftTrip[]`, `DriverListItem[]`). Mutations: discriminated union `{ success: true } \| { success: false; error: string; message?: string }` |
| **Error handling** | `try/catch` in mutation actions; map known errors (e.g. `IST_ZEIT_INCOMPLETE`) to structured `{ success: false, error, message }`; unknown → generic message |
| **Cache** | `revalidatePath('/dashboard/...')` after successful mutations |
| **Data access** | Imported from `./api/*.service` — aligns with `docs/SUPABASE_INTEGRATION.md` Tier 1/2 split |

**Contrast with KTS corrections (PR2.1):** KTS uses **client-side** TanStack Query mutations + browser Supabase client, not server actions — because the detail sheet is already a client component and RLS scopes writes.

---

### 7. Dashboard navigation / upload routes

**Answer:** **No dedicated “Uploads” or “Imports” nav item or route.**

- `src/config/nav-config.ts` — no upload/import entries.
- No `src/app/**/upload/**` routes.
- Upload entry points are **embedded in feature pages**:
  - **Fahrten:** bulk CSV via header/dialog (`bulk-upload-dialog.tsx` on trips listing).
  - **Rechnungen:** Zahlungsabgleich dialog on invoices UI (`zahlungsabgleich-dialog.tsx`).
  - **Firmeneinstellungen:** logo upload via company settings (Storage).

**Module B (PR4/PR5)** will likely attach to KTS workflow surfaces (trip detail, future KTS dashboard per PR6) rather than a new top-level nav — unless product explicitly adds one.

---

### 8. KTS correction insert — end-to-end chain

Full path from UI to database:

```
TripDetailSheet (kts_fehler gate, showCorrectionForm)
  └─► KtsCorrectionForm
        props: tripId, companyId (= trip.company_id!)
        local state: sentTo, sentAt, notes
        handleSubmit → insertMutation.mutateAsync({ tripId, companyId, sentTo, sentAt, notes })
  └─► useInsertKtsCorrectionMutation (use-kts-corrections.ts)
        mutationFn: createClient() → insertKtsCorrection(supabase, payload)
        onSuccess: invalidateQueries tripKeys.ktsCorrections(tripId)
  └─► insertKtsCorrection (kts.service.ts)
        validate sentTo non-empty
        supabase.auth.getUser() → created_by
        build KtsCorrectionInsert row:
          company_id, trip_id, sent_to, sent_at (ISO), notes, created_by
        supabase.from('kts_corrections').insert(row).select().single()
        throw user-facing Error on failure
  └─► Postgres
        Table kts_corrections (append-only round)
        RLS: company_id must match current_user_company_id()
  └─► KtsCorrectionTimeline
        useTripCorrections(tripId) → fetchTripCorrections → re-fetch after invalidation
```

**Close path (for completeness):** `KtsCorrectionTimeline` → `useCloseKtsCorrectionMutation` → `closeKtsCorrection` → `.update({ received_at }).eq('id').is('received_at', null)`.

**Not coupled to trip PATCH:** Opening a correction round does **not** mutate `trips.kts_fehler` — independent satellite table per Option 1 architecture.

---

### 9. `company_id` pattern

**Answer:** Multi-layered — **not a React context**, not on Clerk session directly.

| Layer | How `company_id` is obtained |
| ----- | ---------------------------- |
| **Database / RLS** | `public.current_user_company_id()` reads `accounts.company_id` for `auth.uid()`. Helper also used in policies (`docs/access-control.md`). Trips and most tenant tables carry `company_id` column. |
| **Server services** | `resolveCompanyId(supabase)` pattern — e.g. `src/features/trips/api/trip-presets.service.ts`: `auth.getUser()` → `accounts.company_id`. Same idea in company settings. |
| **Trip rows** | Every trip has `trips.company_id`; UI passes `trip.company_id` into KTS correction insert (detail sheet line ~1736). |
| **Explicit on insert** | `kts_corrections.company_id` is **required on insert** (not inferred server-side in `insertKtsCorrection`) — caller must supply it; RLS validates match. |
| **Clerk** | Organization (`orgId`) is used for auth/navigation gating; tenant data isolation is **`companies.id` ↔ `accounts.company_id`**, not Clerk org id directly on trip rows. |

**Module B implication:** External invoice CSV imports must stamp `company_id` on every row — follow `resolveCompanyId(supabase)` on server, or pass from authenticated session context; never trust client-supplied tenant id without RLS (RLS is the backstop).

---

### 10. Grouped / nested data tables in UI

**Answer:** **Yes** — several patterns; none yet group by external **Belegnummer** (PR4 concept).

| Pattern | Component / module | Grouping behavior |
| ------- | ------------------ | ----------------- |
| **Invoice PDF grouped layout** | `buildInvoicePdfGroupedByBillingType`, `groupLineItemsByBillingType` in `src/features/invoices/components/invoice-pdf/lib/build-invoice-pdf-summary.ts` | Aggregates line items by Abrechnungsfamilie for PDF `main_layout = 'grouped'` — not an interactive table |
| **Invoice builder Step 3 expandable rows** | `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` | Per-position expand/collapse (“Mehr anzeigen”) for Anfahrt/detail — flat list with nested disclosure, not parent/child rows |
| **Bank reconciliation review** | `src/features/bank-reconciliation/components/review-table.tsx` | Flat table with **bucket** semantics (`ready` vs `warning`) in `use-zahlungsabgleich.ts`; multi-invoice resolution rows handled in matcher, not hierarchical tree grid |
| **Invoice list** | `src/features/invoices/components/invoice-list-table/` | Standard TanStack flat table |
| **Trips list** | TanStack Table in `src/features/trips/components/trips-tables/` | Flat; `group_id` is a column value, not nested row grouping |

**Closest precedent for Module B CSV review UI:** bank reconciliation dialog (parse → match → review table → batch confirm) — reuse that UX flow rather than inventing nested tree tables.

---

## Module B context (from roadmap)

Per `docs/kts-architecture.md` §7.2:

| PR | Scope | Status |
| -- | ----- | ------ |
| PR4 | `kts_external_invoices` + `kts_external_invoice_trips` — external Beleg recording, CSV matching | **Not started** (no migrations) |
| PR5 | Bank CSV reconciliation against **external** invoice numbers | **Not started** |
| PR6 | KTS-Abrechnung dashboard | Future |

Existing **internal** invoice bank reconciliation (`bank-reconciliation/`) matches against **`invoices.invoice_number`** — PR5 extends the concept to KTS external Beleg numbers.

---

## Senior recommendation: where should CSV parsing happen?

**Recommendation: parse and validate on the server (Next.js Route Handler or server action), with optional client-side preview only.**

### Recommended architecture

1. **Client:** File picker (`FileUploader`) → read file as `ArrayBuffer`/`text` → optional **preview** (first N rows, column detection) using Papa Parse in the browser for instant UX — same as bank reconciliation today.
2. **Server:** Authoritative parse + validation + DB writes in a **Next.js Route Handler** (`POST /api/kts/external-invoices/import`) or **`'use server'` action** that:
   - Authenticates via Clerk + Supabase server client (session JWT, RLS enforced).
   - Parses CSV with Papa Parse (already a dependency; works in Node/Bun).
   - Validates schema, resolves trip matches, inserts `kts_external_invoices` / link rows in a transaction (prefer Postgres RPC for atomicity if multi-table).
   - Returns structured result `{ imported, skipped, errors[] }` for the review UI.

### Why not client-only (status quo for trips/bank CSV)?

- Module B writes **new tenant-scoped tables** with matching logic against trips — parsing on the client exposes business rules to tampering and duplicates validation between preview and persist.
- Large CSVs block the main thread; server can stream/chunk.
- Audit trail: server can log import batch id, user, row counts — harder if parse+insert split across untrusted client.
- Aligns with **`requireAdmin()` / tenant guard** patterns in `docs/access-control.md` for sensitive financial data.

### Why not Supabase Edge Function?

- **Zero existing Edge Functions** in the repo — new deploy pipeline, Deno runtime, separate secrets, harder local dev vs `bun run dev`.
- Cron and heavy server work already live in **Next.js API routes** with service role where needed.
- Edge Functions shine for webhooks, Storage triggers, or latency to Supabase DB from non-Vercel clients — none apply here; the admin app already runs on Vercel/Node adjacent to Supabase.
- RLS still requires a user JWT or careful service-role design; Edge Function adds indirection without simplifying auth.

### Why not client-only with direct Supabase insert?

- Bulk insert from browser bypasses centralized validation; matching rules (trip id, Belegnummer, amounts) belong in one server module testable with Bun tests (project already has 224+ tests).
- PR5 bank reconciliation already shows the **review-before-commit** pattern — keep preview on client, **commit on server**.

### Practical split (matches existing codebase)

| Phase | Where | Rationale |
| ----- | ----- | --------- |
| File pick + preview | Client (`FileUploader`, Papa Parse) | Reuse bank-reconciliation UX; instant feedback |
| Match preview (dry-run) | Server action or API `?dryRun=1` | Consistent rules; no partial client state |
| Persist import batch | Server + Postgres RPC | Atomic multi-row insert; RLS + tenant guard |
| Optional file archive | Supabase Storage (`company-assets` or new bucket) | Audit only — parse from memory first; Storage optional second phase |

**Default choice:** **Server action or API route** (not Edge Function). Prefer **API route** if the payload is large (multipart file upload) or you need streaming; prefer **server action** if returning structured errors to a client dialog without REST boilerplate — both are established in this stack; bank reconciliation’s client-parse pattern should **not** be copied verbatim for PR4 persist path.

---

## Gaps / risks for Module B implementation

1. **No PR4 schema** — design `kts_external_invoices` + link table before UI; define Belegnummer uniqueness per company.
2. **`invoice_line_items` types drift** — regenerate or extend `database.types.ts` when touching invoice/KTS cross-queries.
3. **Two reconciliation flows** — internal invoices (`bank-reconciliation/`) vs KTS external Belege (PR5); share `FileUploader` + review table patterns, separate matchers.
4. **company_id on every write** — follow `resolveCompanyId` server-side; do not rely solely on trip prop from client.
5. **No Storage audit trail for CSVs yet** — decide whether PR4 requires retained uploads or parse-and-discard is sufficient for v1.

---

## Related documents

- [`docs/kts-architecture.md`](../kts-architecture.md) — PR4–PR6 roadmap
- [`docs/plans/kts-module-a-architecture-audit.md`](kts-module-a-architecture-audit.md) — Option 1 satellite tables
- [`docs/bulk-trip-upload.md`](../bulk-trip-upload.md) — existing CSV import UX
- [`docs/invoices-module.md`](../invoices-module.md) — snapshot / line item model
- [`docs/SUPABASE_INTEGRATION.md`](../SUPABASE_INTEGRATION.md) — 3-tier service/hook/view pattern
- [`docs/access-control.md`](../access-control.md) — RLS, `current_user_company_id()`, tenant guards
