# Audit — Ad-hoc Rechnungsempfänger (Einmaliger Empfänger)

**Scope:** Read-only audit for adding an „Einmalig eingeben“ mode in Step 4 (`step-4-confirm.tsx`).  
**Date:** 2026-06-09  
**Related plans:** `.cursor/plans/spec_c_pricing_engine_3e136e60.plan.md`, `.cursor/plans/phase_4_invoice_builder_cea3993f.plan.md`, `.cursor/plans/phase_5_pdf_preview_5480b643.plan.md`

---

## 1. Freeze mechanism

When a stored Rechnungsempfänger is selected (catalog default or Step 4 override), recipient data is frozen via a **JSONB snapshot column** on `invoices`, not via individual address columns and not via live FK resolution at PDF time.

### Schema

Migration `supabase/migrations/20260405100003_invoices_recipient_snapshot.sql`:

- `invoices.rechnungsempfaenger_id` — nullable UUID FK → `rechnungsempfaenger(id)` ON DELETE SET NULL (L6–7)
- `invoices.rechnungsempfaenger_snapshot` — nullable JSONB, documented as §14 UStG frozen payload (L8, L13–14)

There are **no** separate `recipient_name` / `recipient_address` columns on `invoices`.

### Write path at create

`src/features/invoices/api/invoices.api.ts` — `createInvoice()` (L249–338):

1. Receives resolved `rechnungsempfaengerId` via `CreateInvoicePayload.rechnungsempfaengerId` (L227–228).
2. If `empId` is truthy, loads the live catalog row with `RechnungsempfaengerService.getById(empId)` (L260–261).
3. Serializes it with `rechnungsempfaengerRowToSnapshot(row)` (L263).
4. Inserts both `rechnungsempfaenger_id: empId` and `rechnungsempfaenger_snapshot` on the invoice row (L325–327).

Snapshot builder — `src/features/rechnungsempfaenger/api/rechnungsempfaenger.service.ts` `rechnungsempfaengerRowToSnapshot()` (L13–31) — writes these keys:

| Snapshot key | Source column |
|---|---|
| `id` | `row.id` |
| `name` | `row.name` |
| `anrede` | `row.anrede` |
| `first_name` | `row.first_name` |
| `last_name` | `row.last_name` |
| `company_name` | `row.company_name` |
| `abteilung` | `row.abteilung` |
| `address_line1` | `row.address_line1` |
| `address_line2` | `row.address_line2` |
| `city` | `row.city` |
| `postal_code` | `row.postal_code` |
| `country` | `row.country` |
| `email` | `row.email` |
| `phone` | `row.phone` |

If `empId` is null/undefined, **`rechnungsempfaenger_snapshot` stays `null`** (L259, L260–265) — no snapshot is built from any other source at create time.

### Write path at draft update

`updateDraftInvoice()` (L374–442) re-freezes the snapshot the same way: `getById` → `rechnungsempfaengerRowToSnapshot` when `rechnungsempfaengerId` is set (L396–404, L433–434). Drafts are allowed to refresh the snapshot; issued invoices are not edited through this path.

### Downstream reads

All post-create consumers read **`invoice.rechnungsempfaenger_snapshot`** (parsed through `recipientFromRechnungsempfaengerSnapshot` / `salutationFromSnapshot`), not the live `rechnungsempfaenger` table. The FK is audit/metadata only.

### Catalog default resolution (before freeze)

`src/features/invoices/hooks/use-invoice-builder.ts` (L429–439): after trips load, `catalogRecipientId` is set from `resolveRechnungsempfaenger()` using the **first trip’s** variant → type → payer FKs (`src/features/invoices/lib/resolve-rechnungsempfaenger.ts` L18–37). This ID is what Step 4 uses when the user leaves the select on „Automatisch“.

---

## 2. `onConfirm` payload

There is no `use-create-invoice.ts` hook. Creation is orchestrated by `useInvoiceBuilder` → `createInvoice()` in `invoices.api.ts`.

### Step 4 form type

`src/features/invoices/components/invoice-builder/step-4-confirm.tsx`:

- Local Zod schema `step4Schema` (L67–77):
  - `intro_block_id?: string`
  - `outro_block_id?: string`
  - `payment_due_days: number` (1–90)
  - `rechnungsempfaenger_id?: string` — `'none'` = catalog default; otherwise a catalog UUID
- Inferred type: `Step4Values = z.infer<typeof step4Schema>` (L79)
- `onConfirm: (values: Step4Values) => void` (L122)

Form submit passes **only** these four fields (L391–392 comment: „step4Values (meta fields) only“).

### Shell wiring

`src/features/invoices/components/invoice-builder/index.tsx` (L814–845): `onConfirm` receives `step4Values` and calls `createInvoice(step4Values, snapshotOverride)` (PDF column override is a **second** argument, not part of `Step4Values`).

### Hook mutation shape

`src/features/invoices/hooks/use-invoice-builder.ts` `createMutation` (L929–982):

- Accepts `step4Values: Pick<InvoiceBuilderFormValues, 'intro_block_id' | 'outro_block_id' | 'payment_due_days' | 'rechnungsempfaenger_id'>` (L931–937).
- Resolves recipient (L953–957):
  - `empRaw === 'none' | undefined | null` → `catalogRecipientId`
  - else → `empRaw` (catalog UUID override)
- Passes `rechnungsempfaengerId: rechnungsempfaengerId ?? null` to `createInvoice()` (L974–981).

### Global builder schema (upstream)

`src/features/invoices/types/invoice.types.ts` `invoiceBuilderSchema` (L517–529) also defines `rechnungsempfaenger_id: z.string().uuid().nullable().optional()` — but Step 4 does **not** validate against the full builder schema; it uses the local `step4Schema` only.

**Answer:** The confirm payload includes **no address fields**. Only `rechnungsempfaenger_id` (sentinel `'none'` or UUID) plus intro/outro/payment days. Address data is never submitted from Step 4; `createInvoice` always re-fetches the catalog row by ID to build the snapshot.

---

## 3. PDF shape

`src/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf.ts` does **not** accept a `RecipientRow` interface. It parses a **frozen JSON object** (`Record<string, unknown>`).

### Input (snapshot JSON)

`recipientFromRechnungsempfaengerSnapshot(snap)` (L102–149) reads snake_case keys:

- `name`, `address_line1`, `address_line2`, `postal_code`, `city`, `phone`
- `anrede`, `first_name`, `last_name`, `company_name`, `abteilung`

Returns `null` if all of `name`, `address_line1`, `postal_code`, `city` are empty (L121).

`country` and `email` exist in `rechnungsempfaengerRowToSnapshot` but are **not** read by the PDF parser.

### Output (`PdfCoverRecipient`)

Defined at L5–22 — camelCase, layout-oriented:

- `companyName`, `personName`, `displayName`, `street`, `streetNumber`, `zipCode`, `city`, `phone`, `addressLine2`, `anrede`, `firstName`, `lastName`, `abteilung`

### Comparison to Step 4 `RecipientRow`

`step-4-confirm.tsx` local `RecipientRow` (L87–100):

- Overlaps with snapshot input fields (name, structured names, address lines, postal_code, city, country, phone).
- **Missing** vs full snapshot: `email`, `id` (not needed for PDF parse).
- **Extra** vs PDF parser: `country` (display only in `formatRecipientFullAddress`, L102–110).

**Answer:** PDF input shape = **snapshot JSON** (same keys as `rechnungsempfaengerRowToSnapshot` output), not the local `RecipientRow` type. `RecipientRow` is a UI display subset. `PdfCoverRecipient` is the **parsed output**, not what callers pass in.

---

## 4. Overlay shape (`InvoiceBuilderStep4PdfOverlay.recipientRow`)

`src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` (L81–86):

```typescript
export interface InvoiceBuilderStep4PdfOverlay {
  paymentDueDays: number;
  introText: string | null;
  outroText: string | null;
  recipientRow: RechnungsempfaengerRow | null | undefined;
}
```

`RechnungsempfaengerRow` = `Database['public']['Tables']['rechnungsempfaenger']['Row']` (`rechnungsempfaenger.service.ts` L6–7) — the **full catalog DB row** (includes `id`, `company_id`, `is_active`, `created_at`, `notes`, etc.), not the lightweight `empfaengerOptions` display shape (options are the same type — full rows from `listActive()`, L56–64).

### How overlay is populated

`step-4-confirm.tsx` (L259–266, L228–230):

- Finds `effectiveRow` from `empfaengerOptions` by `effectiveRecipientId`.
- Pushes `recipientRow: effectiveRow` into the overlay.

`buildDraftInvoiceDetailForPdf()` (`build-draft-invoice-detail-for-pdf.ts` L208, L283–285, L334–335):

- Accepts `recipientRow: RechnungsempfaengerRow | null | undefined`.
- Calls `rechnungsempfaengerRowToSnapshot(recipientRow)` → sets `rechnungsempfaenger_snapshot` on the synthetic draft.
- Sets `rechnungsempfaenger_id: recipientRow?.id ?? null`.

**Can it accept ad-hoc (no `id`)?**

- **TypeScript:** No — `RechnungsempfaengerRow` requires `id` and other catalog columns.
- **Runtime:** `rechnungsempfaengerRowToSnapshot` only reads address/name fields (L16–30); a partial object would work for PDF preview **if** cast/typed loosely, but `rechnungsempfaenger_id` would be `undefined` → stored as `null` on the draft (L334).
- **Today:** Ad-hoc cannot flow through the overlay without either a synthetic row or refactoring `buildDraftInvoiceDetailForPdf` to accept a pre-built snapshot.

---

## 5. Validation gap

### Current behaviour when no recipient resolves

Step 4 effective recipient (`step-4-confirm.tsx` L223–230):

- `empSelectRaw === 'none'` → `effectiveRecipientId = catalogRecipientId`
- Override UUID → `effectiveRecipientId = empSelectRaw`

If **both** are null (no catalog cascade **and** user on „Automatisch“), `effectiveRow` is undefined → amber alert (L446–452) but **submit is not blocked**.

### Submit guards

- `step-4-confirm.tsx` submit button: `disabled={isCreating || submitDisabled}` (L603); `submitDisabled` comes from parent as `isSubmitting || !section4Unlocked` (`index.tsx` L812) — **no recipient check**.
- Section 4 unlock: `isInvoiceBuilderSection4Unlocked(section3Complete)` (`index.tsx` L315) — depends on Step 3 confirmation only.

### Server / API

- `createInvoice()` (L260–265): if `rechnungsempfaengerId` is null, snapshot remains null; insert still succeeds.
- No Zod/refine on `invoiceBuilderSchema` requiring a recipient.
- No DB CHECK constraint requiring non-null snapshot.

### Resulting PDF behaviour (no snapshot)

`InvoicePdfDocument.tsx` (L329–338, L341–348):

- `monthly` / `single_trip`: falls back to **live Kostenträger address** (`payerWindowRecipient`) with `console.warn` for legacy missing snapshot.
- `per_client`: primary window uses **live Fahrgast** (`clientWindowRecipient`); secondary legal block only if snapshot parses.

**Answer:** Yes — invoice creation is allowed with `rechnungsempfaenger_id = null` and `rechnungsempfaenger_snapshot = null`. Recipient presence is **advisory UI only** (amber alert L446–452). No validation gate before submission.

---

## 6. Existing ad-hoc / freeform patterns

### Within `src/features/invoices`

No matches for `einmalig`, `adhoc`, or `ad-hoc` recipient entry. The word „manual“ in invoices refers to **pricing** (manual km, manual gross override), not recipient addresses.

The snapshot pattern is catalog-only:

- Preview builds snapshot from live catalog row (`build-draft-invoice-detail-for-pdf.ts` L283–285; plan `phase_5_pdf_preview_5480b643.plan.md` L98).
- Create always `getById` → `rechnungsempfaengerRowToSnapshot` (`invoices.api.ts` L260–264).

### Closest precedent: Angebote module

`src/features/angebote/components/angebot-builder/step-1-empfaenger.tsx` — freeform `recipient_*` fields stored **directly on the `angebote` row** (not a separate catalog + snapshot).

`angebot-builder/index.tsx` (L358–360): section completion requires `recipient_company || recipient_last_name`.

`angebote.api.ts` (L300–313): persists inline `recipient_company`, `recipient_street`, etc.

This is a **different persistence model** (denormalized columns on the offer table), but the **UX pattern** (manual address form, no catalog record) is the reference implementation for „Einmalig eingeben“.

### `client_reference_fields_snapshot`

`invoices.api.ts` (L267–282): another §14 freeze pattern — copies `clients.reference_fields` at create into `client_reference_fields_snapshot` JSONB without creating a new client. **Architecturally analogous** to ad-hoc recipient: freeze arbitrary structured data at invoice creation without a new catalog entity.

---

## 7. `step4Schema` extension

### Local schema (Step 4 form)

`step4Schema` is a standalone `z.object({...})` in `step-4-confirm.tsx` (L67–77), validated via `zodResolver(step4Schema)` (L175).

Zod object parsing **strips unknown keys** by default. Ad-hoc fields (`adhoc_name`, `adhoc_address_line1`, …) must be **declared in `step4Schema`** or they will not appear in `Step4Values` / `onConfirm`.

### Upstream stripping

- `onConfirm` → `createMutation` only destructures the four known fields (L931–937, L953–964). Even if extra keys were passed, they would be **ignored** unless the mutation and `createInvoice` are extended.
- Full `invoiceBuilderSchema` (`invoice.types.ts` L529) has no ad-hoc fields; Step 4 never runs the full schema on submit.

### `'none'` sentinel

`rechnungsempfaenger_id` in Step 4 allows `'none'` (L75–76), which is **not** a UUID — the local schema uses `z.string().optional()` without `.uuid()`, so the sentinel is valid. The global `invoiceBuilderSchema` uses `.uuid().nullable().optional()` (L529), which would **reject** `'none'` if ever parsed there (it is not today).

**Answer:** `step4Schema` **can** be extended with optional ad-hoc fields. They will not be dropped by Zod if added to the schema. However, the create pipeline must be extended separately — unknown keys are otherwise unused, and the hook only forwards `rechnungsempfaenger_id`.

**Recommended sentinel:** add `'adhoc'` (or similar) alongside `'none'` and UUIDs for mode discrimination, with conditional Zod `.superRefine` requiring address fields when `'adhoc'` is selected.

---

## 8. Risk surface — consumers of invoice recipient data

These components/hooks read `invoices.rechnungsempfaenger_snapshot` and/or `rechnungsempfaenger_id` after creation. Ad-hoc integration must keep snapshot JSON compatible with `recipientFromRechnungsempfaengerSnapshot` (snake_case keys above).

| Location | Usage | Ad-hoc risk |
|---|---|---|
| `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` | Primary/secondary recipient blocks, salutation (L241–348) | **High** — must parse ad-hoc snapshot; fallback to payer/client only when snapshot null |
| `src/features/invoices/components/invoice-pdf/invoice-pdf-cover-header.tsx` | Renders cover recipient props from document | **Medium** — inherits parsed shape |
| `src/features/invoices/components/invoice-pdf/lib/rechnungsempfaenger-pdf.ts` | Snapshot → `PdfCoverRecipient`, salutation, Briefkopf lines | **High** — define minimum required keys for ad-hoc |
| `src/features/invoices/components/invoice-detail/index.tsx` | Detail sidebar „An“ name/street from snapshot (L150–179) | **Medium** — works if snapshot parses |
| `src/features/invoices/lib/generate-invoice-email-draft.ts` | Email salutation from snapshot (L38–47) | **Low** — same parser |
| `src/features/invoices/components/abrechnung-overview/abrechnung-recent-invoices.tsx` | Empfänger column label (L62–78) | **Low** — `displayName` from snapshot |
| `src/features/invoices/lib/storno.ts` | Copies `rechnungsempfaenger_id` + snapshot to Storno RPC (L121–123) | **Low** — ad-hoc snapshot copies as-is; `id` in JSON may be absent |
| `supabase/migrations/20260605120200_create_branch_draft_rpc.sql` | Branch draft copies snapshot from original (L95–96) | **Low** — same |
| `src/features/invoices/api/invoices.api.ts` | `createInvoice`, `updateDraftInvoice`, `getInvoiceDetail` (`*` includes snapshot, L57 comment) | **High** — write path must accept ad-hoc snapshot without `getById` |
| `src/features/invoices/hooks/use-invoice-builder.ts` | Resolves ID for create/update (L953–957, L1044–1048); edit hydration sets `catalogRecipientId` from `detail.rechnungsempfaenger_id` (L332) | **High** — ad-hoc drafts have `rechnungsempfaenger_id = null`; edit re-open must hydrate ad-hoc fields from snapshot |
| `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts` | Preview snapshot from `recipientRow` (L283–335) | **High** — preview path |
| `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` | Overlay `recipientRow` (L252–254) | **High** — preview path |

### Not snapshot-dependent (lower risk)

| Location | Notes |
|---|---|
| `src/features/invoices/components/invoice-list-table/columns.tsx` | Shows payer + Fahrgast, **not** Rechnungsempfänger (L98–120) |
| `src/features/invoices/lib/build-confirmation-display-rows.ts` | Line items only — **no recipient data** (entire file) |
| `src/features/invoices/components/invoice-builder/step-2-params.tsx` | Catalog preview via `resolveRechnungsempfaenger` — unaffected unless product wants Step 2 hint for ad-hoc |

### Intentionally excluded from this audit

- `rechnungsempfaenger` catalog CRUD / payer assignment UI
- RPC `create_storno_invoice` signature (already accepts `p_rechnungsempfaenger_snapshot JSONB`)

---

## 9. Relevant existing plans (`.cursor/plans/`)

Plans mentioning Rechnungsempfänger / recipient / Empfänger:

| Plan file | Relevance |
|---|---|
| `spec_c_pricing_engine_3e136e60.plan.md` | Defines snapshot-on-create, PDF dual-layout, `rechnungsempfaengerRowToSnapshot` |
| `phase_4_invoice_builder_cea3993f.plan.md` | Step 4 override UI, `catalogRecipientId`, createInvoice freeze |
| `phase_5_pdf_preview_5480b643.plan.md` | Synthetic snapshot for preview from catalog row; §14 comments |
| `split_pdf_preview_trigger_3b990b14.plan.md` | `recipientRow` as Category A preview dep |
| `client_reference_fields_pdf_51482cbb.plan.md` | Parallel §14 snapshot pattern on invoices |
| `monthly_billing_types_multi-select_bf12cfa3.plan.md` | Step 2 recipient preview rules |
| `angebote_module_build_00cc7d2b.plan.md` | Freeform recipient on offers (UX precedent) |
| `pdf-brief-mode.plan.md` | DIN recipient window layout |
| `phase_4_invoice_builder_cea3993f.plan.md` | Step 4 confirmation block (implemented) |

No existing plan describes invoice ad-hoc / „Einmalig“ Rechnungsempfänger.

---

## 10. Senior recommendation — cleanest integration path

### Do **not** add new `invoices` address columns

The schema already has the right abstraction: **`rechnungsempfaenger_snapshot` JSONB** (migration `20260405100003`, documented in `docs/rechnungsempfaenger.md` L35–37). Ad-hoc entry is a **snapshot-only** recipient with `rechnungsempfaenger_id = null`, matching the product requirement (no catalog row, no client row).

This mirrors `client_reference_fields_snapshot` — freeze arbitrary structured data at create without a new entity.

### Recommended implementation sequence

1. **Snapshot builder** — Add `adhocRecipientFormToSnapshot(form)` next to `rechnungsempfaengerRowToSnapshot()` in `rechnungsempfaenger.service.ts`, producing the **same snake_case keys** (omit `id` or set `id: null`). Optionally synthesize `name` from structured fields for backward compatibility with parsers that check `snap.name` (L106–121 in `rechnungsempfaenger-pdf.ts`).

2. **Step 4 UX** — Extend the recipient select with **„Einmalig eingeben“** (`value='adhoc'`). Show conditional address fields (reuse field names aligned to snapshot keys). Extend `step4Schema` with optional ad-hoc fields + `.superRefine` when mode is `'adhoc'` (minimum: display name via `company_name` or `last_name` + `address_line1` + `postal_code` + `city` — mirror Angebot gate `recipient_company || recipient_last_name`, `angebot-builder/index.tsx` L358–360).

3. **Create pipeline** — Extend `CreateInvoicePayload` with optional `rechnungsempfaengerSnapshot?: Record<string, unknown> | null`. In `createInvoice()`:
   - If ad-hoc snapshot provided → write it directly, `rechnungsempfaenger_id = null`.
   - Else existing `getById` path unchanged.
   
   Extend `useInvoiceBuilder` `createMutation` to branch on `empRaw === 'adhoc'` and pass the built snapshot (do **not** fall back to `catalogRecipientId`).

4. **Validation** — Block submit when `'adhoc'` selected but required fields empty; optionally block create when neither catalog recipient nor ad-hoc snapshot is available (closes gap in §5).

5. **PDF preview** — Prefer refactoring `buildDraftInvoiceDetailForPdf` to accept `rechnungsempfaengerSnapshot: Record<string, unknown> | null` **in addition to** `recipientRow`, avoiding fake `RechnungsempfaengerRow` casts. Update `InvoiceBuilderStep4PdfOverlay` similarly.

6. **Draft edit** — `updateDraftInvoice()` today only rebuilds snapshot from FK (L396–404). For ad-hoc drafts, pass snapshot from form on save (same branch as create). Edit hydration (`use-invoice-builder.ts` L332) must detect `rechnungsempfaenger_id == null && rechnungsempfaenger_snapshot != null` and populate ad-hoc form fields.

7. **Storno / branch** — No schema change; existing copy of `rechnungsempfaenger_snapshot` JSON is sufficient.

### Why not alternatives

| Approach | Verdict |
|---|---|
| Extend `step4Schema` only | Insufficient — create path ignores extra fields today |
| New `invoices` address columns | Duplicates snapshot; breaks single §14 read path in PDF/email/detail |
| Create hidden catalog row per ad-hoc entry | Violates product requirement; pollutes catalog |
| Resolve via `rechnungsempfaenger_id` FK only | Cannot represent one-off addresses |

### Minimum snapshot contract for ad-hoc

Ensure ad-hoc snapshots include enough for `recipientFromRechnungsempfaengerSnapshot` to return non-null:

- At least one of: `name`, or (`company_name` / `first_name`+`last_name`)
- Plus at least one of: `address_line1`, `postal_code`, `city` (per L121 guard)

Align field names with `rechnungsempfaengerRowToSnapshot` (L16–30) so **all existing consumers keep working without branching on „adhoc vs catalog“**.

---

## Summary table

| Question | Short answer |
|---|---|
| Freeze mechanism | JSONB `rechnungsempfaenger_snapshot` + optional FK `rechnungsempfaenger_id`; built via `rechnungsempfaengerRowToSnapshot` at create |
| `onConfirm` payload | `Step4Values`: intro/outro/payment_days/`rechnungsempfaenger_id` only — no address |
| PDF input shape | Snapshot JSON (snake_case), not local `RecipientRow`; output is `PdfCoverRecipient` |
| Overlay | `RechnungsempfaengerRow` (full DB row); not ad-hoc-ready without refactor |
| Validation gap | No hard gate; null snapshot allowed; payer/client PDF fallback |
| Ad-hoc precedent | Angebote freeform fields; `client_reference_fields_snapshot` freeze pattern |
| `step4Schema` | Extendable; stripped if omitted; hook/API must also change |
| Risk surface | PDF, detail, email, overview, storno, create/update/hydration, preview |
