# KTS Workflow Audit

**Date:** 2026-06-09  
**Scope:** Read-only audit of trip data model, KTS/Fehler UI, invoicing, grouping, uploads, status machine, and external-facing surfaces — in preparation for a KTS document/clearing workflow.  
**Sources:** Trip routes under `src/app/dashboard/trips/`, feature modules (`src/features/trips`, `src/features/invoices`, `src/features/payers`), Supabase migrations, `src/types/database.types.ts`, module docs under `docs/` (65 top-level files), `.cursor/plans/` (116 plan files — KTS-related plans read in full; remainder inventoried by filename/theme).

**Note on requested `src/components/` scan:** No files under `src/components/` match `*kts*`, `*trip*`, `*invoice*`, or `*mistake*` in the filename. Trip, KTS, invoice, and “mistake” (KTS-Fehler) UI live in `src/features/` and shared primitives in `src/components/ui/`.

---

## Executive summary

TaxiGo Admin already has a **V1 KTS operational layer** on trips (`kts_document_applies`, `kts_source`, `kts_fehler`, `kts_fehler_beschreibung`) with catalog defaults, inline table editing, trip-detail editing, print/CSV surfacing, and **soft** invoice-builder warnings. There is **no** dedicated KTS clearing pipeline, **no** document upload per trip, **no** `kts_reviews` status history (V2 roadmap only), and **no** accountant/external portal. Invoicing is a mature, immutability-first admin module (`invoices` + `invoice_line_items`). The riskiest gap for a full KTS workflow is bridging **operational error flags** to a **stateful clearing lifecycle** without breaking invoice immutability or duplicating billing truth.

---

## 1. Trip data model — `public.trips`

There is **no `CREATE TABLE trips` migration** in the repo (table predates tracked migrations). The effective schema is `Database['public']['Tables']['trips']['Row']` in `src/types/database.types.ts` (lines 1465–1544), augmented by migrations through `20260605120000_trips_manual_tax_rate.sql`.

### 1.1 Full column inventory

| Column | Type (effective) | Nullable | Role |
|--------|------------------|----------|------|
| `id` | uuid | NO | PK |
| `company_id` | uuid | YES | Tenant |
| `status` | text | NO | Operational lifecycle (no DB CHECK in repo) |
| `created_at` | timestamptz | YES | Audit |
| `created_by` | uuid | YES | FK → accounts |
| `scheduled_at` | timestamptz | YES | Primary business datetime |
| `requested_date` | date | YES | Date-only / import consistency |
| `actual_pickup_at` | timestamptz | YES | Driver-recorded pickup |
| `actual_dropoff_at` | timestamptz | YES | Driver-recorded dropoff |
| `driver_id` | uuid | YES | Assigned driver |
| `vehicle_id` | uuid | YES | Vehicle |
| `shift_id` | uuid | YES | Linked shift (used by driver portal; may be absent from generated types in some snapshots) |
| `client_id` | uuid | YES | FK → clients |
| `client_name` | text | YES | Denormalized passenger label |
| `client_phone` | text | YES | Denormalized |
| `payer_id` | uuid | YES | FK → payers |
| `billing_variant_id` | uuid | YES | Leaf billing selection |
| `billing_type_id` | uuid | YES | Denormalized family |
| `billing_calling_station` | text | YES | Billing metadata (Anrufstation) |
| `billing_betreuer` | text | YES | Billing metadata |
| `pickup_address` | text | YES | Legacy full string |
| `pickup_street` | text | YES | Structured address |
| `pickup_street_number` | text | YES | |
| `pickup_zip_code` | text | YES | |
| `pickup_city` | text | YES | |
| `pickup_station` | text | YES | Passenger-facing station label |
| `pickup_lat` / `pickup_lng` | numeric | YES | Coordinates |
| `pickup_place_id` | text | YES | Google place id |
| `pickup_location` | jsonb | YES | GeoJSON-style blob |
| `dropoff_address` | text | YES | |
| `dropoff_street` | text | YES | |
| `dropoff_street_number` | text | YES | |
| `dropoff_zip_code` | text | YES | |
| `dropoff_city` | text | YES | |
| `dropoff_station` | text | YES | |
| `dropoff_lat` / `dropoff_lng` | numeric | YES | |
| `dropoff_place_id` | text | YES | |
| `dropoff_location` | jsonb | YES | |
| `driving_distance_km` | double precision | YES | Routing distance |
| `driving_duration_seconds` | integer | YES | Routing duration |
| `manual_distance_km` | numeric | YES | Billing km override |
| `base_net_price` | numeric | YES | Transport net (writable) |
| `approach_fee_net` | numeric | YES | Anfahrt net (writable) |
| `net_price` | numeric | NO | **GENERATED STORED:** `COALESCE(base_net_price,0)+COALESCE(approach_fee_net,0)` |
| `gross_price` | numeric | YES | Gross total |
| `tax_rate` | numeric | YES | VAT fraction |
| `manual_gross_price` | numeric | YES | Gross override |
| `manual_tax_rate` | numeric | YES | Tax override (invoice write-back) |
| `rule_id` | uuid | YES | Recurring rule FK |
| `group_id` | uuid | YES | Dispatch grouping (shared driver/time) |
| `linked_trip_id` | uuid | YES | Hin/Rück partner |
| `link_type` | text | YES | Link semantics |
| `return_status` | text | YES | Return-trip workflow |
| `stop_order` | integer | YES | Multi-stop ordering |
| `stop_updates` | jsonb | YES | Stop change log |
| `note` | text | YES | Legacy note field |
| `notes` | text | YES | Dispatcher/driver notes |
| `canceled_reason_notes` | text | YES | Cancellation detail |
| `greeting_style` | text | YES | Passenger greeting |
| `is_wheelchair` | boolean | NO | Wheelchair flag |
| `needs_driver_assignment` | boolean | NO | Dispatch flag |
| `has_missing_geodata` | boolean | NO | Geocoding quality |
| `ingestion_source` | text | YES | e.g. `trip_duplicate`, bulk import |
| `payment_method` | text | YES | Payment modality |
| `selbstzahler_collected_amount` | numeric | YES | Self-payer collection |
| `fremdfirma_id` | uuid | YES | External company |
| `fremdfirma_payment_mode` | text | YES | Fremdfirma billing |
| `fremdfirma_cost` | numeric | YES | Fremdfirma cost |
| `no_invoice_required` | boolean | NO | Skip standard invoicing |
| `no_invoice_source` | text | YES | Catalog vs manual provenance |
| `reha_schein` | boolean | NO | Separate operational flag (not KTS) |

### 1.2 Columns related to KTS, mistakes, invoicing, billing

| Column(s) | Domain |
|-----------|--------|
| **`kts_document_applies`** | Primary KTS flag — trip requires Krankentransportschein / clearing process |
| **`kts_source`** | How flag was set: `variant` \| `familie` \| `payer` \| `manual` \| `system_default` |
| **`kts_fehler`** | Operational “mistake” / erroneous KTS document flag |
| **`kts_fehler_beschreibung`** | Free-text mistake description; cleared when `kts_fehler = false` |
| **`reha_schein`** | Related but **separate** from KTS (Reha-Schein gate on payer) |
| **`payer_id`, `billing_variant_id`, `billing_type_id`, `billing_*`** | Abrechnung catalog selection |
| **`no_invoice_required`, `no_invoice_source`** | Billing exclusion (can coexist with KTS — UI warns) |
| **`base_net_price`, `approach_fee_net`, `net_price`, `gross_price`, `tax_rate`, `manual_*`** | Trip pricing; KTS resolver often yields €0 transport net |
| **`fremdfirma_*`** | External-company billing path |
| **Invoice linkage** | No column on `trips`; inferred via `invoice_line_items.trip_id` |

**Catalog defaults (not on `trips`):** `payers.kts_default`, `billing_variants.kts_default`, `billing_types.behavior_profile.kts_default` — see `docs/kts-architecture.md`.

---

## 2. “Mistake switch + text field” — where rendered and what it writes

The product uses **KTS-Fehler** terminology, not “mistake” in code.

### 2.1 Fahrten table (inline editing)

| UI | File | Control | DB write |
|----|------|---------|----------|
| KTS-Fehler switch | `src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx` → `KtsFehlerSwitchCell` | `Switch` (only when `kts_document_applies`) | `useUpdateTripMutation` → `trips.kts_fehler`; turning off also sets `kts_fehler_beschreibung: null` |
| KTS-Fehler text | Same file → `KtsFehlerTextCell` | Debounced `<input>` (1500 ms) | `useTripFieldUpdate` → `trips.kts_fehler_beschreibung` (trimmed, `null` if empty) |

Columns wired in `src/features/trips/components/trips-tables/columns.tsx` (`kts_fehler`, `kts_fehler_beschreibung`). Shared optimistic state via `KtsCellGroupProvider` keeps KTS / Fehler / text columns in sync per row.

### 2.2 Trip detail sheet

| UI | File | Control | DB write |
|----|------|---------|----------|
| KTS-Fehler | `src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx` (~1680–1707) | `Checkbox` + `Textarea` (visible when `ktsDocumentAppliesDraft`) | Saved via **Trip aktualisieren** → `buildTripDetailsPatch` → `tripsService.updateTrip` |
| Patch builder | `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` | — | Sets `kts_fehler`, `kts_fehler_beschreibung` (clears description when flag false) |

Paired Hin/Rück saves mirror both fields via `PAIRED_SYNC_COLUMN_KEYS` in `paired-trip-sync.ts`.

### 2.3 Not rendered (but in schema)

- **Neue Fahrt:** Zod defaults in `create-trip/schema.ts` (`kts_fehler: false`, description null) — **no payer UI** for Fehler; persisted on create with defaults.
- **No component** under `src/components/` named for mistakes.

### 2.4 Cascade rules

- Turning **KTS off** clears Fehler + description (table `KtsSwitchCell`, detail sheet KTS switch, patch builder).
- Fehler fields are **independent of** `resolveKtsDefault()` catalog cascade.

---

## 3. KTS trip vs non-KTS trip

### 3.1 Storage

| Concept | Storage |
|---------|---------|
| KTS trip | `trips.kts_document_applies = true` |
| Non-KTS trip | `trips.kts_document_applies = false` (default) |
| Provenance | `trips.kts_source` records catalog tier or `manual` |

Defaults resolved by **`resolveKtsDefault()`** (`src/features/trips/lib/resolve-kts-default.ts`): variant → familie behavior → payer → system `false`.

### 3.2 Rendering

| Surface | Behavior |
|---------|----------|
| Fahrten table | Column **KTS** — inline `Switch` (`KtsSwitchCell`); filter `ktsFilter` in `trips-listing.tsx` (`kts`, `kts_fehler`, etc.) |
| Mobile card list | KTS badge when `kts_document_applies` |
| Trip detail sheet | Dashed **KTS / Krankentransportschein** row with catalog hint + switch; Fehler block when on |
| Neue Fahrt | KTS switch in payer/billing section when Kostenträger selected |
| Invoice builder Step 3 | Soft warning banner + per-row **KTS** badge (`step-3-line-items.tsx`) |
| Print / JPEG export | KTS-Fehler rose block when `kts_fehler` (`print-trip-groups-list.tsx`) |
| CSV export | Optional column `kts_document_applies` |

There is **no separate route or sheet** for “KTS trips only” — same trip detail with conditional KTS section.

---

## 4. Invoice and billing data model

### 4.1 Core tables

| Table | Purpose |
|-------|---------|
| **`invoices`** | One row per invoice; modes `monthly`, `single_trip`, `per_client`; status lifecycle |
| **`invoice_line_items`** | Immutable snapshots per position; optional `trip_id` FK |
| **`rechnungsempfaenger`** | Invoice recipient catalog + snapshots on invoice |
| **`billing_types` / `billing_variants`** | Abrechnungsfamilie / Unterart |
| **`billing_pricing_rules`** | Payer pricing rules |
| **`payers`** | Kostenträger master data |
| **`company_profiles`** | Issuer block for PDFs |
| **`pdf_vorlagen` / `invoice_text_blocks`** | PDF layout and text templates |
| **`angebote` / `angebot_line_items`** | Quotes (parallel module, not trip invoices) |

**No table** named `billing`, `accountant_submissions`, or similar exists in migrations.

### 4.2 `invoices` status machine

From `20260331120000_create_invoices.sql` + later migrations:

```
draft → sent → paid
sent → cancelled (Stornorechnung via cancels_invoice_id)
original → corrected (when Storno issued)
```

Timestamps: `created_at`, `updated_at`, `sent_at`, `paid_at`, `cancelled_at`.  
Branch drafts: `replaces_invoice_id` (corrective invoice after Storno).

### 4.3 Trip ↔ invoice relationship

- **Link:** `invoice_line_items.trip_id` → `trips.id`
- **Effective status badge** on Fahrten list: `trip-invoice-status-badge.tsx` aggregates embedded line items (`paid` > `sent` > `draft` > uninvoiced); ignores `cancelled` / `corrected` parent invoices
- **RPC filter:** `trip_ids_matching_invoice_effective_status` for list filtering
- **Distance freeze:** trips on invoice line items block distance field updates (`build-trip-details-patch.ts`)

Full module architecture: `docs/invoices-module.md`, `docs/abrechnung-overview.md`.

---

## 5. Grouping trips together

Several **distinct** grouping concepts exist; none is a dedicated “KTS batch for accountant” entity.

| Mechanism | Column / artifact | Purpose |
|-----------|-------------------|---------|
| **Dispatch group** | `trips.group_id` | Same driver/time bucket; Kanban grouped cards; bulk CSV `group_id`; print merged **Gruppe** cards |
| **Hin/Rück pair** | `linked_trip_id`, `link_type` | Two-leg round trip; paired sync on save |
| **Recurring series** | `rule_id` | Materialized occurrences from `recurring_rules` |
| **Invoice batch** | `invoices` + line items | Groups trips by payer + period + mode (monthly / per_client / single_trip) |
| **Invoice PDF appendix** | Grouped by billing variant | “Nach Abrechnungsart” pages in PDF |

`group_id` is **not copied** to return trips (returns may diverge). Invoice grouping is **billing-scoped**, not KTS-scoped.

---

## 6. File upload infrastructure

### 6.1 Shared components

| Component | Path |
|-----------|------|
| `FileUploader` | `src/components/file-uploader.tsx` (react-dropzone) |
| `FormFileUpload` | `src/components/forms/form-file-upload.tsx` |

### 6.2 Supabase Storage

| Bucket | Path pattern | Used for |
|--------|--------------|----------|
| **`company-assets`** | `{company_id}/logo.{ext}` | Company logo (`company_profiles.logo_path`) — RLS migration `20260402120000_company_assets_storage_rls.sql` |

**No trip-level or KTS document storage** bucket/column exists today.

### 6.3 Other upload flows (not Storage)

| Flow | File | Input |
|------|------|-------|
| Bulk trip CSV | `bulk-upload-dialog.tsx` | `FileUploader` → parse client-side → INSERT trips |
| Bank CSV (Zahlungsabgleich) | `zahlungsabgleich-dialog.tsx` | `FileUploader` → match invoice numbers |
| CSV export | `POST /api/trips/export` | Server-generated download (not upload) |

Troubleshooting: `docs/storage-upload-troubleshooting.md`, `docs/company-logo-upload.md`.

---

## 7. Trip status state machine

### 7.1 Canonical values

Defined in `src/lib/trip-status.ts` (`TripStatus` type):

| Status | Label (DE) | Meaning |
|--------|------------|---------|
| `pending` | Offen | No driver (admin kanban) |
| `open` | Offen | Legacy alias for `pending` |
| `assigned` | Zugewiesen | Driver assigned (admin) |
| `scheduled` | Geplant | Planned (driver portal flow) |
| `in_progress` | Unterwegs | Tour started |
| `driving` | Unterwegs | Legacy alias for `in_progress` |
| `completed` | Erledigt | Tour finished |
| `cancelled` | Storniert | Cancelled |

No PostgreSQL CHECK on `trips.status` in repo migrations — values are app-enforced.

### 7.2 Where status is set

| Transition | Location |
|------------|----------|
| `pending` → `assigned` (driver assigned) | `getStatusWhenDriverChanges()` — table `driver-select-cell`, kanban save, create-trip form, trip detail driver change |
| `assigned` → `pending` (unassign) | Same helper |
| → `in_progress` + `actual_pickup_at` | Driver portal `startTrip()` — `driver-trips.service.ts` |
| → `completed` + `actual_dropoff_at` | Driver portal `completeTrip()` |
| → `cancelled` | Admin cancellation hooks; recurring exception actions; driver `cancel_trip_as_driver` RPC |
| Bulk import | `bulk-upload-dialog.tsx` — `pending` or `assigned` from CSV driver column |
| Duplicate | `duplicate-trips.ts` — resets to `pending`/`assigned` based on driver |

Helper docs: `docs/trip-status-helper.md`.

---

## 8. KTS trip detail view — UI structure

There is **one** trip detail sheet for all trips (`trip-detail-sheet.tsx`). When `kts_document_applies` is true (or user enables KTS in the sheet), KTS-specific controls appear inside the standard layout.

### 8.1 Layout (top → bottom)

1. **Header band** — billing accent color; status badge; Hin/Rück / Kopie / partner-cancelled badges; passenger name + Rollstuhl switch; **Datum** + **Uhrzeit** pickers; optional **Anrufstation** / **Betreuer** when billing family asks
2. **TripSheetTopCallouts** — linked Gegenfahrt strip; **Gruppe** hint when `group_id` set
3. **Route & Verlauf** — timeline with expandable address editing
4. **Details grid (two columns)** — Fahrer; Kostenträger; Abrechnung (Unterart select); then billing flags:
   - **KTS / Krankentransportschein** — catalog hint, **KTS-Fehler** checkbox + description textarea (when KTS on), main KTS switch
   - **Reha-Schein** — when payer gate enabled
   - **Keine Rechnung** — with catalog hint; amber alert if both KTS and Keine Rechnung active
   - **Kontakt** — client autosuggest, name, phone
5. **Fremdfirma section** — when applicable
6. **Wichtige Hinweise** — amber notes block for drivers
7. **Preis** — price tooltip / manual overrides (distance freeze when invoiced)
8. **Footer** — **Trip aktualisieren** when dirty; **Aktionen** dropdown (Duplizieren, Verschieben, Rückfahrt, …); **Fahrt stornieren**

### 8.2 KTS-specific actions visible

- Toggle KTS (`kts_document_applies`, sets `kts_source = manual` on user override)
- Toggle KTS-Fehler + optional description (save via footer, not auto-save except in table inline cells)
- No KTS document upload, no clearing status timeline, no “submit to accountant” action

### 8.3 Related surfaces (not detail sheet)

- Fahrten table inline KTS / Fehler / text columns
- Filters: KTS / KTS-Fehler in `trips-filters-bar` / `trips-listing.tsx`
- Print cards: KTS-Fehler warning block

---

## 9. Timestamp fields and handling

### 9.1 On `trips`

| Field | Set when |
|-------|----------|
| `created_at` | Insert (default `now()`) |
| `scheduled_at` | Trip scheduling — **must** use `buildScheduledAt(ymd, hm)` / `buildScheduledAtOrNull` from `trip-time.ts` (Berlin business rules) |
| `requested_date` | Date-only rows / imports |
| `actual_pickup_at` | Driver starts tour |
| `actual_dropoff_at` | Driver completes tour |

**Not present on trips:** `updated_at`, `submitted_at`, `completed_at` (completion = `status = completed` + optional `actual_dropoff_at`).

Day boundaries for filters: `getZonedDayBoundsIso(ymd)` from `trip-business-date.ts` — see `docs/trips-date-filter.md`.

### 9.2 On invoices

`created_at`, `updated_at`, `sent_at`, `paid_at`, `cancelled_at` — see §4.2.

### 9.3 Codebase convention

- Persisted trip times: always through `trip-time.ts` helpers (AGENTS.md invariant)
- Display: `date-fns` + Berlin TZ utilities for controlling/reporting
- Inline table text fields: debounced PATCH (e.g. 1500 ms for KTS-Fehler description)

---

## 10. Accountant-facing / external-facing views

| Audience | Routes | Access | KTS / invoicing |
|----------|--------|--------|-----------------|
| **Admin / dispatcher** | `/dashboard/*` | `accounts.role = admin` | Full trips, invoices, controlling, exports |
| **Driver** | `/driver/*` | `role = driver` | Own trips only; **no** KTS fields, **no** invoices (RLS) |
| **Accountant / external** | — | **None** | No portal, no submission queue, no read-only export role |

Exports usable for external handoff (admin-only):

- Invoice PDF (digital / Brief mode)
- Fahrten CSV export (`/api/trips/export`)
- Print trips ZIP (PDF + JPEG) — `docs/print-trips-export.md`
- Controlling RPC dashboards — internal CFO analytics only

Bank reconciliation (`Zahlungsabgleich`) is admin CSV import on `/dashboard/invoices`, not an external login.

Access layers: `docs/access-control.md`.

---

## 11. Trip route folder inventory

Path: `src/app/dashboard/trips/` (not `(dashboard)` group — uses `dashboard` segment).

| File | Role |
|------|------|
| `page.tsx` | Main Fahrten list — RSC shell + `TripsListingPage` |
| `fahrten-page-shell.tsx` | Layout wrapper |
| `trips-header-actions.tsx` | Header actions (create, print, etc.) |
| `new/page.tsx` | Neue Fahrt — `CreateTripForm` |
| `new/layout.tsx` | New trip layout |

Related API routes: `src/app/api/trips/{export,duplicate,bulk-delete,driving-metrics,metrics,groups/metrics}/`.

Trip UI overwhelmingly lives in `src/features/trips/`, not under `app/`.

---

## 12. Module documentation reviewed

Top-level module docs (`docs/*.md`, 65 files) — key references for this audit:

| Doc | Relevance |
|-----|-----------|
| `kts-architecture.md` | **Canonical KTS design** — cascade, V1/V2, code map |
| `invoices-module.md` | Invoice builder, immutability, trip badge |
| `trip-detail-sheet-editing.md` | Detail sheet layout, paired sync incl. KTS fields |
| `billing-families-variants.md` | Catalog hierarchy |
| `no-invoice-required.md` | Parallel flag to KTS |
| `print-trips-export.md` | KTS-Fehler on print cards |
| `bulk-trip-upload.md` | CSV KTS columns |
| `access-control.md` | Roles, RLS, no external accountant |
| `driver-portal.md` | Driver status transitions |
| `abrechnung-overview.md`, `controlling-module.md` | Internal billing analytics |
| `csv-export-feature.md` | Admin export |
| `features/recurring-rules-overview.md` | Rule → trip generation |

---

## 13. `.cursor/plans/` inventory (KTS-relevant)

116 plan files total. **Read in full for this audit:**

| Plan | Status / theme |
|------|----------------|
| `kts_document_workflow.plan.md` | Strategic KTS V1 + V2 `kts_reviews`; todos partially stale vs shipped code |
| `kts-fehler_feature_6a2db4aa.plan.md` | **Completed** — Fehler columns, detail sheet, table, print |
| `kts_filter_dropdown_944b7343.plan.md` | KTS list filters |
| `plan_e_inline_kts_reha_44831f8d.plan.md` | Inline KTS + Reha in table |

Other plans touch adjacent domains (invoice builder phases, regelfahrten cron, draft invoice editing, trip invoice status badge, bank CSV, etc.) but do not define a KTS document pipeline.

**V2 explicitly deferred** in `docs/kts-architecture.md` §8: `kts_reviews` append-only table, lifecycle states (Fehlerhaft → In Korrektur → … → Bezahlt), collapsible **KTS-Status** timeline on detail sheet.

---

## 14. Senior assessment

### 14.1 Riskiest part to implement

**Defining a KTS clearing lifecycle that touches money and legal documents without corrupting invoice immutability.**

Concrete risks observed in the codebase:

1. **Two parallel “status” concepts** — trip `status` (dispatch), trip invoice badge (derived from `invoice_line_items`), and the planned KTS review states (V2). Conflating them on `trips` would break filters, driver portal, and controlling RPCs.

2. **KTS-Fehler is a boolean + free text today** — no workflow, no assignee, no timestamps, no link to uploaded Schein PDFs. Building “submit to accountant” on top of inline switches invites **dual write paths** (table debounce vs detail PATCH vs future workflow) unless unified behind one service.

3. **Invoice snapshot isolation** — once a trip is on `invoice_line_items`, trip edits are partially frozen (distance). A KTS workflow that changes billing eligibility **after** invoicing must decide: mutate trips only, issue Storno/branch draft, or track KTS state separately from invoice lines.

4. **No document storage** — any “KTS document workflow” requires new Storage bucket + RLS + trip FK + virus/retention policy; logo upload is the only precedent.

5. **`kts_document_applies` vs `no_invoice_required`** — both can be true; UI warns but does not block. Clearing workflows must not assume “KTS ⇒ invoiced” or the inverse.

### 14.2 What to do first

Recommended sequence:

1. **Product spec for V2 boundary** — Confirm whether clearing is **operational-only** (status + documents, no invoice block) or **gates invoice batch export**. Align with existing soft warnings in Step 3. Write explicit state diagram **separate from** `trips.status` and `invoices.status`.

2. **Schema spike: `kts_reviews` + optional `kts_documents`** — Follow `docs/kts-architecture.md` §8 append-only reviews; add Storage metadata table if uploads are in scope. Do **not** add `kts_review_status` on `trips`.

3. **Single write API for KTS operational fields** — Consolidate table inline cells, detail sheet, and future workflow modal through one server action or service (today: `useUpdateTripMutation` / `tripsService.updateTrip` with divergent call patterns).

4. **Detail sheet “KTS-Status” panel (read-only timeline first)** — Surface `kts_fehler` history once `kts_reviews` exists; keep Fehler checkbox as “raise issue” that inserts a review row.

5. **Defer accountant portal** — Start with admin-export bundle (CSV of open KTS cases + PDF links) unless external auth is a hard requirement; the codebase has **zero** patterns for third-party read-only roles.

6. **Reconcile stale plan todos** — `kts_document_workflow.plan.md` marks migration/resolver as in_progress but V1 is largely shipped per `kts-architecture.md` §9; update planning docs before implementation to avoid duplicate migration work.

---

## 15. Gaps checklist (for upcoming KTS workflow work)

| Capability | Current state |
|------------|---------------|
| KTS flag on trip | ✅ `kts_document_applies` |
| Catalog defaults | ✅ Full cascade |
| Mistake flag + text | ✅ `kts_fehler`, `kts_fehler_beschreibung` |
| KTS clearing status machine | ❌ V2 only (conceptual) |
| KTS document upload | ❌ |
| Accountant submission / portal | ❌ |
| Hard block KTS trips in invoicing | ❌ Soft warning only |
| Dedicated KTS list view | ⚠️ Filter only (`trips-listing` KTS filter) |
| Audit trail for KTS status changes | ❌ |
| Group KTS trips for combined clearing | ❌ (only dispatch `group_id` / invoice batching) |

---

*End of audit — no code changes made.*
