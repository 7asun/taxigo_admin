# Bank CSV Import & Invoice Payment Reconciliation — Audit

**Date:** 2026-06-02  
**Scope:** Read-only audit. No code changes.  
**Goal:** Inventory the invoice data model, number format, existing UI/data layer, RLS, file-upload precedents, and recommend architecture for bank-statement CSV → `paid_at` / status reconciliation.

---

## Executive summary

- The **`public.invoices`** table already has **`status`** (lifecycle) and **`paid_at`** (`TIMESTAMPTZ`, nullable). Marking paid today is a direct Supabase `.update()` via `updateInvoiceStatus(id, 'paid')`, which sets `paid_at = now()` (not the bank booking date).
- Canonical invoice numbers are **`RE-YYYY-MM-NNNN`** (e.g. `RE-2026-05-0008`). PDF / SEPA QR **Verwendungszweck** is the bare number — no `RNR:` prefix. Payers often add their own prefixes in bank transfers.
- **No bank CSV import UI or backend exists.** Closest precedents: trip bulk CSV upload (`Papa.parse` + `react-dropzone`) and manual “Als bezahlt markieren” on invoice detail / Abrechnung overview.
- **RLS:** admins can **UPDATE** `invoices` for their company — sufficient for a client-side batch mark-paid flow; a hardened **`SECURITY DEFINER` RPC** is still recommended for atomic multi-row updates and guards (`status = 'sent'` only).
- **Recommendation:** parse CSV client-side → extract all canonical numbers with a strict regex → match DB by `invoice_number` → cross-check **Brutto** amount and **`status === 'sent'`** → **mandatory review UI** before write (especially multi-invoice payments and non-matching rows).

---

## 1. Invoice table schema (exact columns + types)

### Table name

**`public.invoices`** (not `rechnungen`).

Defined in [`supabase/migrations/20260331120000_create_invoices.sql`](../../supabase/migrations/20260331120000_create_invoices.sql), extended by later migrations. TypeScript mirror: [`src/features/invoices/types/invoice.types.ts`](../../src/features/invoices/types/invoice.types.ts) (`InvoiceRow`).

> **Note:** `src/types/database.types.ts` does **not** currently include a generated `invoices` table block; the feature relies on hand-maintained types in `invoice.types.ts`.

### All columns

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | `UUID` | NOT NULL | `gen_random_uuid()` | PK |
| `company_id` | `UUID` | NOT NULL | — | FK → `companies.id` |
| `invoice_number` | `TEXT` | NOT NULL | — | **UNIQUE** globally |
| `payer_id` | `UUID` | NOT NULL | — | FK → `payers.id` |
| `billing_type_id` | `UUID` | YES | — | FK → `billing_types.id`; optional family filter |
| `billing_variant_id` | `UUID` | YES | — | FK → `billing_variants.id`; added in `20260410120000` |
| `mode` | `TEXT` | NOT NULL | — | CHECK: `monthly`, `single_trip`, `per_client` |
| `client_id` | `UUID` | YES | — | FK → `clients.id`; `per_client` only |
| `period_from` | `DATE` | NOT NULL | — | Billing period start |
| `period_to` | `DATE` | NOT NULL | — | Billing period end |
| `status` | `TEXT` | NOT NULL | `'draft'` | CHECK — see §1.3 |
| `subtotal` | `NUMERIC(10,2)` | NOT NULL | `0` | Netto snapshot |
| `tax_amount` | `NUMERIC(10,2)` | NOT NULL | `0` | MwSt snapshot |
| `total` | `NUMERIC(10,2)` | NOT NULL | `0` | **Brutto** — use for amount matching |
| `notes` | `TEXT` | YES | — | |
| `payment_due_days` | `INTEGER` | NOT NULL | `14` | Zahlungsziel (days from creation) |
| `intro_block_id` | `UUID` | YES | — | FK → `invoice_text_blocks.id` |
| `outro_block_id` | `UUID` | YES | — | FK → `invoice_text_blocks.id` |
| `rechnungsempfaenger_id` | `UUID` | YES | — | FK → `rechnungsempfaenger.id` |
| `rechnungsempfaenger_snapshot` | `JSONB` | YES | — | Frozen recipient |
| `pdf_column_override` | `JSONB` | YES | — | Frozen PDF layout |
| `client_reference_fields_snapshot` | `JSONB` | YES | — | Frozen Bezugszeichen |
| `email_subject` | `TEXT` | YES | — | Mutable email draft |
| `email_body` | `TEXT` | YES | — | Mutable email draft |
| `created_by` | `TEXT` | YES | — | `auth.uid()` at creation |
| `created_at` | `TIMESTAMPTZ` | NOT NULL | `now()` | |
| `updated_at` | `TIMESTAMPTZ` | YES | — | Set on updates |
| `sent_at` | `TIMESTAMPTZ` | YES | — | Set when `status → sent` |
| **`paid_at`** | **`TIMESTAMPTZ`** | **YES** | **none** | **Set when `status → paid`** |
| `cancelled_at` | `TIMESTAMPTZ` | YES | — | Set when cancelled (legacy path) |
| `cancels_invoice_id` | `UUID` | YES | — | Self-FK; Stornorechnung → original |

### `paid_at`

- **Exists:** yes.
- **Type:** `TIMESTAMPTZ` (nullable).
- **Default:** none (`NULL` until paid).
- **Write path:** [`updateInvoiceStatus`](../../src/features/invoices/api/invoices.api.ts) sets `paid_at: new Date().toISOString()` when `status === 'paid'`. There is **no** API to set `paid_at` to an arbitrary bank booking date today.

### Payment / lifecycle status

Column: **`status`** (`TEXT NOT NULL DEFAULT 'draft'`).

Allowed values (CHECK constraint):

| Value | Meaning |
|-------|---------|
| `draft` | Editable draft (limited re-edit when payer flag enabled) |
| `sent` | Issued / awaiting payment |
| `paid` | Payment received |
| `cancelled` | Storniert (legacy terminal) |
| `corrected` | Original replaced by Stornorechnung |

There is **no** separate `payment_status`, `bezahlt`, or boolean paid flag.

Intended transitions (documented + UI-enforced):

```
draft → sent → paid
              └→ cancelled (→ Stornorechnung; original → corrected)
```

[`updateInvoiceStatus`](../../src/features/invoices/api/invoices.api.ts) does **not** server-side validate the prior status; the UI restricts transitions.

### Invoice number format in DB

**Current (all new issuances):** `RE-YYYY-MM-NNNN`

- Example: `RE-2026-05-0008`
- Generator: [`src/features/invoices/lib/invoice-number.ts`](../../src/features/invoices/lib/invoice-number.ts)
- Sequence resets each calendar month; numbers are **globally unique** across tenants (UNIQUE constraint + `invoice_numbers_max_for_prefix` RPC).

**Legacy rows may exist:** `RE-YYYY-NNNN` (e.g. `RE-2026-0001`) — documented in [`docs/invoices-module.md`](../invoices-module.md) §1.3. These do not participate in the monthly sequence query but remain valid stored values.

**Stornorechnungen** receive a **new** `RE-YYYY-MM-NNNN` number (not a `STORNO-` prefix; comment in old migration is outdated — see `20260401170000_invoice_number_format_comment.sql`).

---

## 2. Invoice number format + confirmed regex pattern

### Canonical format (system of record)

From [`invoice-number.ts`](../../src/features/invoices/lib/invoice-number.ts):

```typescript
// format: RE-{year}-{2-digit-month}-{4-digit-sequence}
/^RE-(\d{4})-(\d{2})-(\d+)$/
```

Production numbers use **4-digit zero-padded sequence** (`0001`…`9999`). Parser accepts `\d+` for sequence but generator always pads to 4.

**PDF / SEPA Verwendungszweck:** the bare invoice number only.

- PDF payment block: [`invoice-pdf-cover-body.tsx`](../../src/features/invoices/components/invoice-pdf/invoice-pdf-cover-body.tsx) renders `{invoiceNumber}` under “Verwendungszweck”.
- SEPA QR: [`generate-payment-qr-data-url.ts`](../../src/features/invoices/components/invoice-pdf/generate-payment-qr-data-url.ts) passes `remittance: invoice.invoice_number`.

So payers **should** transfer with `RE-2026-05-0008`, but many add prefixes, dates, names, or multiple numbers.

### Recommended extraction regex (bank CSV matching)

**Primary (canonical):** extract every occurrence globally (case-sensitive — numbers are uppercase `RE`):

```regex
\bRE-\d{4}-\d{2}-\d{4}\b
```

**Legacy fallback (optional, if old rows still open):**

```regex
\bRE-\d{4}-\d{4}\b
```

**Do not treat as valid system numbers:**

- `RE-2026-04-05-0006` — **five** numeric segments; **not** generated by this codebase (likely typo for `RE-2026-04-0006` or foreign format). No code path produces `RE-YYYY-MM-DD-NNNN`.

### Bank CSV patterns vs system format

| User test pattern | Matches system? | Notes |
|-------------------|-----------------|-------|
| `RNR:RE-2026-05-0008 30.042026` | **Partial** | `RNR:` is payer-side; extract `RE-2026-05-0008` via primary regex |
| `08.05.2026 5085.90 RE-2026-05-0007` | **Yes** (number) | Date/amount are noise; number at end is canonical |
| `RE-2026-05-0002` | **Yes** | Ideal case — matches PDF VZ exactly |
| `RE-2026-04-0006 04/2026 RE-2026-04-0005 03/2026` | **Yes** (×2) | Multi-invoice payment; extract **all** matches; split amount manually or by invoice totals |
| `HERBERS, KIRA … RE-2026-04-05-0006 …` | **No** (as written) | Extra `-05` segment — **won't match** primary regex; flag for manual review / typo correction |
| Rows without `RE-…` | **N/A** | Krankenkasse, Freenow, SEPA-DD, etc. — expected non-match |

---

## 3. Verwendungszweck pattern catalogue

### Emitted by TaxiGo (invoice PDF / QR)

| Pattern | Source | Example |
|---------|--------|---------|
| Bare invoice number | PDF “Verwendungszweck”, SEPA QR remittance | `RE-2026-05-0008` |

No `RNR:`, date, or amount is appended by the app.

### Observed in bank CSV (test file — user-provided)

| ID | Pattern | Handling |
|----|---------|----------|
| P1 | `RNR:RE-YYYY-MM-NNNN` + trailing date | Strip prefix; regex extract |
| P2 | `{DD.MM.YYYY} {amount} RE-YYYY-MM-NNNN` | Extract number; use amount column for cross-check |
| P3 | Standalone `RE-YYYY-MM-NNNN` | Direct lookup |
| P4 | Multiple `RE-…` + `{MM/YYYY}` hints | Multi-match → split payment UI |
| P5 | Free text + name + `RE-YYYY-MM-DD-NNNN` (5 segments) | No auto-match; manual |
| P6 | No TaxiGo number | Skip / “unmatched” bucket |

### Additional patterns to expect (from domain, not in repo test CSV)

| Pattern | Likelihood | Notes |
|---------|------------|-------|
| Legacy `RE-YYYY-NNNN` | Low (older rows only) | Secondary regex |
| Storno number `RE-…` on credit transfer | Medium | Storno rows are **`draft`** until sent — usually not “payment”; negative amounts may be refunds |
| Partial payments / Skonto | Medium | Single transfer ≠ single invoice total; amount check fails → review |
| Payer Kundennummer / Kostenträger refs | High | No reliable join to `invoice_number` — ignore for auto-match |
| SEPA Lastschrift (negative amounts) | High | Outflows — exclude from “mark paid” |

---

## 4. Existing UI inventory

### Invoice list

| Item | Path |
|------|------|
| Route | [`src/app/dashboard/invoices/page.tsx`](../../src/app/dashboard/invoices/page.tsx) |
| Table shell | [`src/features/invoices/components/invoice-list-table/index.tsx`](../../src/features/invoices/components/invoice-list-table/index.tsx) |
| Column defs | [`src/features/invoices/components/invoice-list-table/columns.tsx`](../../src/features/invoices/components/invoice-list-table/columns.tsx) |

**Columns shown:** Rechnungsnr., Fahrgast, Kostenträger, Zeitraum, Typ, **Status** (badge), Betrag, Actions.

**Payment status column:** **Yes** — `Status` via `InvoiceStatusBadge` (`Entwurf` / `Versendet` / `Bezahlt` / …).

**Paid date column:** **No** — `paid_at` is not displayed in the list.

### Related UI

| Surface | Path | Payment UX |
|---------|------|------------|
| Invoice detail | [`src/features/invoices/components/invoice-detail/index.tsx`](../../src/features/invoices/components/invoice-detail/index.tsx) | Status badge; [`invoice-actions.tsx`](../../src/features/invoices/components/invoice-detail/invoice-actions.tsx) — “Als bezahlt markieren” when `sent` |
| Abrechnung overview | [`src/app/dashboard/abrechnung/page.tsx`](../../src/app/dashboard/abrechnung/page.tsx) | [`abrechnung-recent-invoices.tsx`](../../src/features/invoices/components/abrechnung-overview/abrechnung-recent-invoices.tsx) — **Fällig** (derived due date), **Status**, quick status menu |
| Controlling | [`src/app/dashboard/controlling/page.tsx`](../../src/app/dashboard/controlling/page.tsx) | Read-only invoice KPIs via RPC (`paid_at` used for DSO in SQL) |

### Import / upload UI in dashboard

| Feature | Exists? | Location |
|---------|---------|----------|
| **Bank CSV / payment import** | **No** | — |
| Trip bulk CSV upload | Yes | [`src/features/trips/components/bulk-upload-dialog.tsx`](../../src/features/trips/components/bulk-upload-dialog.tsx) (Fahrten page) |
| Trip CSV export (download) | Yes | [`src/features/trips/components/csv-export/`](../../src/features/trips/components/csv-export/) |
| Company logo upload | Yes | [`src/features/company-settings/components/company-settings-form.tsx`](../../src/features/company-settings/components/company-settings-form.tsx) (image → Supabase Storage) |

No `.cursor/plans/*` or `docs/*` document a deferred bank CSV feature — **greenfield**.

---

## 5. React Query / data fetching layer summary

### Query keys

Factory: [`src/query/keys/invoices.ts`](../../src/query/keys/invoices.ts)

| Key | Usage |
|-----|--------|
| `invoiceKeys.all` | `['invoices']` — broad invalidation |
| `invoiceKeys.list(filter)` | `['invoices', 'list', filter]` — list table + KPIs |
| `invoiceKeys.full(id)` | `['invoices', 'full', id]` — detail + PDF |
| `invoiceKeys.revenueTotal` | Dashboard revenue stat |

### Hooks

| Hook | File | Fetches via |
|------|------|-------------|
| `useInvoices(filter)` | [`src/features/invoices/hooks/use-invoices.ts`](../../src/features/invoices/hooks/use-invoices.ts) | `listInvoices()` |
| `useInvoiceDetail(id)` | [`src/features/invoices/hooks/use-invoice.ts`](../../src/features/invoices/hooks/use-invoice.ts) | `getInvoiceDetail()` |
| `useUpdateInvoiceStatus(id)` | [`src/features/invoices/hooks/use-invoice.ts`](../../src/features/invoices/hooks/use-invoice.ts) | `updateInvoiceStatus()` — optimistic patch on all `['invoices','list',…]` caches |

### Service layer

**Yes — feature API module:** [`src/features/invoices/api/invoices.api.ts`](../../src/features/invoices/api/invoices.api.ts)

- Uses **browser Supabase client** (`createClient()` from `@/lib/supabase/client`).
- **Not** server actions (contrast: shift reconciliations use server-only service + actions).
- List query: `.from('invoices').select('*, payer:…, client:…')` with optional filters on `status`, `payer_id`, `created_at` range.

**Mark paid today:**

```typescript
// invoices.api.ts — simplified
.update({ status: 'paid', paid_at: now, updated_at: now })
.eq('id', id)
```

No dedicated `lib/invoices.ts` at repo root — logic lives under `src/features/invoices/`.

---

## 6. RLS & permissions status

### RLS enabled

Migration [`20260401180000_invoices_invoice_line_items_rls.sql`](../../supabase/migrations/20260401180000_invoices_invoice_line_items_rls.sql):

```sql
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
```

### Policies on `invoices`

| Policy | Command | Rule |
|--------|---------|------|
| `invoices_select_company_admin` | SELECT | `current_user_is_admin()` AND `company_id = current_user_company_id()` |
| `invoices_insert_company_admin` | INSERT | same (WITH CHECK) |
| **`invoices_update_company_admin`** | **UPDATE** | same (USING + WITH CHECK) |

**No DELETE policy** on `invoices` (rows are legal documents).

### Can authenticated admin UPDATE?

**Yes**, for rows in their company, when `accounts.role = 'admin'`.

Drivers (`role = 'driver'`) fail `current_user_is_admin()` — no access.

### Implications for bank import

- Client-side batch `.update()` on `invoices` is **RLS-permitted** for admins.
- **`invoice_line_items`** has SELECT/INSERT only — line items cannot be mutated except via RPCs (`create_storno_invoice`, `replace_draft_invoice_line_items`).
- **`invoice_number`** uniqueness is **global**; allocation uses `invoice_numbers_max_for_prefix` (SECURITY DEFINER). Matching by number is safe across tenants (unique), but list queries remain company-scoped.

---

## 7. File upload precedent (library used, component path)

| Use case | Component | Libraries | Parse / transport |
|----------|-----------|-----------|-------------------|
| **Trip bulk CSV import** | [`bulk-upload-dialog.tsx`](../../src/features/trips/components/bulk-upload-dialog.tsx) | **`papaparse`**, **`react-dropzone`** via [`FileUploader`](../../src/components/file-uploader.tsx) | `Papa.parse(file, { header: true, skipEmptyLines: true })` — comma-separated trip CSV |
| Trip CSV export | [`csv-export-dialog.tsx`](../../src/features/trips/components/csv-export/csv-export-dialog.tsx) | — | Server generates CSV (`/api/trips/export`); client download only |
| Company logo | [`company-settings-form.tsx`](../../src/features/company-settings/components/company-settings-form.tsx) | native `File` + Supabase Storage | No CSV |
| Demo form upload | [`form-file-upload.tsx`](../../src/components/forms/form-file-upload.tsx) | `FileUploader` / dropzone | Demo only |

**Dependencies** (already in `package.json`): `papaparse@^5.5.3`, `react-dropzone@^14.3.5`, `@types/papaparse`.

**Bank CSV specifics:** user states **semicolon delimiter** and **`Verwendungszweck` at index 4** — trip upload uses **comma** + header row. Bank import must use `Papa.parse` with `delimiter: ';'` (and likely `header: false` or a fixed column map, depending on bank export format).

---

## 8. Senior-level recommendation

### Architecture (cleanest path)

```
┌─────────────┐    Papa.parse (;)     ┌──────────────────┐
│ Bank CSV    │ ───────────────────►  │ Parsed rows      │
│ upload UI   │                       │ (client-only)    │
└─────────────┘                       └────────┬─────────┘
                                             │ regex extract RE-…
                                             ▼
                                    ┌──────────────────┐
                                    │ Match candidates │◄── listInvoices({ status:'sent' })
                                    │ + amount check   │    or targeted .in('invoice_number', …)
                                    └────────┬─────────┘
                                             │
                                             ▼
                                    ┌──────────────────┐
                                    │ Review screen    │  mandatory
                                    │ (confirm/reject) │
                                    └────────┬─────────┘
                                             │ apply
                                             ▼
                                    ┌──────────────────┐
                                    │ Write paid       │  extend updateInvoiceStatus
                                    │ status + paid_at │  or new RPC batch
                                    └──────────────────┘
```

**Where to put it:** new feature module e.g. `src/features/bank-reconciliation/` with route `/dashboard/abrechnung/zahlungsabgleich` (alongside existing Abrechnung nav) — keeps invoices feature focused on issuance.

**Parse:** client-side `Papa.parse` (consistent with bulk trip upload; CSV files are small). No need for a server route unless files exceed comfortable browser memory (unlikely for bank exports).

**Match:** **exact** `invoice_number` string match after regex extraction — **not fuzzy**. Invoice numbers are discrete identifiers; fuzzy matching risks false positives on sequence digits.

**Amount check:** compare bank **credit amount** (absolute value) to `invoices.total` (Brutto) with tolerance **±0.01 €**. Mismatch → yellow flag on review row, not auto-apply.

**Status guard:** only auto-suggest rows where invoice `status === 'sent'`. Skip or flag: `draft`, `paid`, `cancelled`, `corrected`.

**`paid_at` source:** prefer **bank booking date** from CSV (not `now()`). Requires extending `updateInvoiceStatus` (or RPC) to accept optional `paid_at` ISO string — today’s implementation always uses current timestamp.

### Matching strategy — honest opinion

| Approach | Verdict |
|----------|---------|
| Regex extract all `RE-YYYY-MM-NNNN` | **Do** — covers P1–P4 |
| Exact DB lookup on `invoice_number` | **Do** — UNIQUE constraint makes this reliable |
| Fuzzy / Levenshtein on numbers | **Don’t** — high risk on `0007` vs `0008` |
| Match on amount alone | **Don’t** — collisions across payers |
| Match on payer name from CSV | **Optional hint only** — bank text is messy |
| Multi-invoice single transfer | **Manual split UI required** — cannot silently mark two invoices paid without amount allocation review |

### Manual confirmation — required?

**Yes, always.**

Minimum review table columns: bank date, bank amount, raw Verwendungszweck, extracted number(s), matched invoice (if any), invoice total, current status, proposed action.

Buckets:

1. **Ready** — one number, amount matches, status `sent` → default checked.
2. **Review** — multi-number, amount mismatch, already paid, not found, wrong status.
3. **Ignored** — no extractable number (P6).

Do **not** write to DB on file drop. User clicks **“X Rechnungen als bezahlt markieren”** after review.

### Batch write implementation

**Phase 1 (fast):** loop `updateInvoiceStatus(id, 'paid')` with extended `paid_at` param — reuse optimistic invalidation from [`useUpdateInvoiceStatus`](../../src/features/invoices/hooks/use-invoice.ts).

**Phase 2 (safer):** Postgres RPC `mark_invoices_paid(p_items jsonb)` — SECURITY DEFINER, guards:

- `current_user_is_admin()` + company match
- each invoice `status = 'sent'`
- set `paid_at` from payload (bank date, end-of-day Berlin or noon UTC policy — document choice)
- return per-id result for partial failure handling

Mirror pattern: [`create_storno_invoice`](../../supabase/migrations/20260411120000_storno_atomic_rpc.sql), [`replace_draft_invoice_line_items`](../../supabase/migrations/20260529080000_draft_invoice_editing_foundation.sql).

### Optional future: audit table

Not present today. Consider `payment_import_batches` + `payment_import_rows` (raw VZ, match result, applied_at, user_id) for §14 / bookkeeping traceability — defer until MVP works.

### UX precedent

[`shift-reconciliations`](../../src/features/shift-reconciliations/) implements **review → confirm** for operational reconciliation — good UX reference for a similar two-step bank import flow (filters in URL, admin-only server guards).

### Out of scope / deferred

- Auto-reconciling Krankenkasse bulk settlements without invoice numbers
- Linking partial payments / overpayments
- Credit notes / Storno inbound transfers
- Replacing DATEV / Lexoffice — this feature only closes the **`sent → paid`** loop inside TaxiGo

---

## Appendix A — Docs & plans consulted

**Module docs (invoice-relevant):** [`docs/invoices-module.md`](../invoices-module.md), [`docs/abrechnung-overview.md`](../abrechnung-overview.md), [`docs/controlling-module.md`](../controlling-module.md), [`docs/bulk-trip-upload.md`](../bulk-trip-upload.md), [`docs/csv-export-feature.md`](../csv-export-feature.md), [`docs/access-control.md`](../access-control.md).

**Plans (invoice / payment adjacent):** `draft_invoice_editing_foundation`, `invoice_status_rpc_hardening`, `revision-invoice-audit`, `schichtzettel_reconciliation`, `cfo-dashboard-audit` (notes `paid_at` for DSO). **No existing plan** for bank CSV payment import.

**Migrations read:** `20260331120000_create_invoices.sql`, `20260401170000`, `20260401180000`, `20260401193000`, `20260405100003`, `20260408120001`, `20260410120000`, `20260410140100`, `20260410190000`, `20260529080000`, `20260530120000_controlling_rpcs.sql`.

---

## Appendix B — Quick answers to audit questions

| # | Question | Answer |
|---|----------|--------|
| 1 | Table name | `public.invoices` |
| 1 | `paid_at`? | Yes — `TIMESTAMPTZ NULL`, set on mark paid |
| 1 | Payment status column? | `status` — `draft` \| `sent` \| `paid` \| `cancelled` \| `corrected` |
| 1 | Number format | `RE-YYYY-MM-NNNN` (legacy `RE-YYYY-NNNN` possible) |
| 2 | Regex | `\bRE-\d{4}-\d{2}-\d{4}\b` (+ optional legacy `\bRE-\d{4}-\d{4}\b`) |
| 3 | List path | `src/app/dashboard/invoices/page.tsx` + `invoice-list-table/` |
| 3 | Paid date in list? | No (status badge only) |
| 3 | Bank import UI? | No |
| 4 | Query key | `invoiceKeys.list(filter)` via `useInvoices()` |
| 4 | Service | `src/features/invoices/api/invoices.api.ts` (Supabase client) |
| 5 | RLS on invoices? | Yes — admin company-scoped SELECT/INSERT/UPDATE |
| 6 | CSV upload precedent | `bulk-upload-dialog.tsx` — Papa Parse + react-dropzone |
