# Revision Invoice — Read-Only Audit

Audit date: 2026-05-28. No code changes.

Scope: invoice schema, creation flow, status model, PDF layer, payer configuration, trip–invoice linkage, RLS, and existing module docs. Answers the eight questions below with exact file paths, line references, and field/type names.

**Related docs read:** [`docs/invoices-module.md`](../invoices-module.md), [`docs/invoice-text-templates.md`](../invoice-text-templates.md), [`docs/no-invoice-required.md`](../no-invoice-required.md), [`docs/plans/invoice-builder-features-audit.md`](./invoice-builder-features-audit.md), [`docs/plans/invoice-price-override-audit.md`](./invoice-price-override-audit.md), [`docs/plans/cancelled-trips-invoice-audit.md`](./cancelled-trips-invoice-audit.md).

**Schema note:** There is **no** `invoice_trips` junction table, **no** `invoice_items` table (the line-item table is `invoice_line_items`), and **no** `trip_overrides` table. Trips link to invoices via `invoice_line_items.trip_id` (nullable FK).

---

## 1. Invoice status flow

### Definition (TypeScript)

```46:59:src/features/invoices/types/invoice.types.ts
/**
 * Invoice lifecycle states.
 *
 * State machine:
 *   draft ──→ sent ──→ paid
 *          └──→ cancelled  (triggers automatic Stornorechnung creation)
 *               corrected  (set on original when storniert; used for display only)
 */
export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'paid'
  | 'cancelled'
  | 'corrected';
```

There is **no** `pending`, `finalised`, or `in_revision` status today. **`draft` already exists** and is the default on insert (`Entwurf` in UI badges).

### Definition (database)

`status` is `TEXT NOT NULL DEFAULT 'draft'` with an inline `CHECK` — **not** a Postgres `ENUM`:

```73:81:supabase/migrations/20260331120000_create_invoices.sql
  -- ── Status Machine ────────────────────────────────────────
  -- Allowed transitions:
  --   draft      → sent        (Rechnung versenden)
  --   sent       → paid        (Zahlung eingegangen)
  --   sent       → cancelled   (Stornierung — triggers Stornorechnung creation)
  --   cancelled  → (terminal)
  --   corrected  → (terminal, set on original invoice when replaced by Storno)
  status                TEXT          NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','paid','cancelled','corrected')),
```

Column comment (same migration, lines 207–217) documents the same five values and transitions.

### UI labels

| Status | German label | Where |
|--------|--------------|-------|
| `draft` | Entwurf | `invoice-list-table/columns.tsx` L46, `invoice-detail/index.tsx` L65 |
| `sent` | Versendet | same |
| `paid` | Bezahlt | same |
| `cancelled` | Storniert | same |
| `corrected` | Korrigiert | same |

### Transition API

```322:331:src/features/invoices/api/invoices.api.ts
export type InvoiceStatusTransition = 'sent' | 'paid' | 'cancelled';

/**
 * Updates the status of an invoice and sets the corresponding lifecycle timestamp.
 *
 * Status transitions:
 *   draft → sent      (marks sent_at)
 *   sent  → paid      (marks paid_at)
 *   sent  → cancelled (marks cancelled_at; caller should also create Stornorechnung)
```

`createInvoice` always inserts `status: 'draft'` (L304 in `invoices.api.ts`).

### Where statuses are used

| Location | Behaviour |
|----------|-----------|
| `invoice-detail/invoice-actions.tsx` | `draft` → mark sent + Storno; `sent` → mark paid + Storno; terminal states → no actions |
| `abrechnung-overview/abrechnung-recent-invoices.tsx` | `getAvailableTransitions`: `draft`→`sent`, `sent`→`paid`/`cancelled` |
| `create_storno_invoice` RPC | Original must be `status IN ('draft', 'sent')`; original set to `corrected`; new Storno inserted as `draft` |
| `trip_ids_matching_invoice_effective_status` RPC | Counts `draft`, `sent`, `paid` as invoiced; ignores `cancelled` / `corrected` |
| `useInvoiceRevenueTotal` | Sums only `sent` and `paid` (`invoices.api.ts` L120) |
| Trip badge (`effective-trip-invoice-status.ts`) | Aggregates line items: paid > sent > draft > uninvoiced |

### Important correction: `cancelled` vs Storno

The **primary** cancellation path is **Stornorechnung** via `createStornorechnung` → `create_storno_invoice`, which sets the original to **`corrected`** (not `cancelled`). The Abrechnung widget still exposes `updateInvoiceStatus('cancelled')` without creating a Storno — a legacy/inconsistent path.

---

## 2. Immutability

### When does an invoice become immutable?

**Application convention + comments, not DB enforcement:**

1. **Schema intent** — financial totals on `invoices` are documented as immutable snapshots at finalization (`20260331120000_create_invoices.sql` L83–86, L219–228). Line items are immutable snapshots (`20260331130000_create_invoice_line_items.sql` L8–17).

2. **TypeScript principle** — `invoice.types.ts` L7–9: *"ALL invoice data is a snapshot taken at creation time… This immutability matches German legal requirements (§14 UStG)."*

3. **Practical lock point: `draft` → `sent`** — After `sent`, the product treats the invoice as issued. There is **no** invoice builder re-open or line-item UPDATE path. Post-`sent` corrections are intended to go through **Stornorechnung** only.

4. **No server-side status guard on UPDATE** — RLS allows any admin to UPDATE any column on `invoices` regardless of `status` (see §7). Immutability is **not** enforced at the database layer.

### Status-based UI guards

**Invoice detail / list — no edit form:**

- `invoice-actions.tsx` L73–76: returns `null` for `paid`, `cancelled`, `corrected`.
- `invoice-detail/index.tsx`: line items table is **display-only** (no edit handlers).
- `invoice-list-table/columns.tsx`: actions are Ansehen, PDF-Vorschau, PDF herunterladen — **no Bearbeiten**.

**Grep for `readOnly`, `locked`, `isEditable` in invoice feature:**

| Match | Meaning |
|-------|---------|
| `invoice-builder/index.tsx` `locked={isLocked(n)}` | Wizard **section** gating (Step 2 unlocks after Step 1, etc.) — **not** invoice immutability |
| `step-4-vorlage.tsx` `unlocked` prop | Same — PDF step disabled until Step 3 complete |
| `invoice-email-draft.tsx` L101 `readOnly` | Email **An** field display only |
| `invoice-line-items.api.ts` L11–15 | Comment: line items *"never edited after creation"* |

**No `isEditable` function exists** for invoices.

### What remains mutable after creation

| Field | API | Status restriction |
|-------|-----|------------------|
| `email_subject`, `email_body` | `saveInvoiceEmailDraft` | None documented |
| `status` + lifecycle timestamps | `updateInvoiceStatus` | UI limits transitions; API does not validate prior status |
| Entire row (theoretically) | Direct Supabase UPDATE | RLS admin-only; no status CHECK on columns |

`notes` and `payment_due_days` are editable in the **builder before first save**; there is **no** post-create UI to change them on the detail page.

---

## 3. Trip overrides

### During invoice building (pre-save)

Overrides live in **in-memory `BuilderLineItem`** / `BuilderCancelledTripRow` in `use-invoice-builder.ts`:

| Override | Builder field | Set by |
|----------|---------------|--------|
| Gross total | `manualGrossTotal`, `isManualOverride` | `applyGrossOverride` |
| Anfahrt gross | `manualApproachFeeGross` | same |
| KM for pricing/VAT | `manualDistanceKm`, `isManualKmOverride` | `applyKmOverride` |
| Billing opt-out | `billingInclusion.included`, `billingInclusion.reason` | `handleLineItemInclusionChange` |
| Description | `description` | Step 3 (editable before save) |
| Unit net (legacy path) | `unit_price` | inline price edit |

Types documented in `invoice.types.ts` L529–685 (`BuilderLineItem`).

### On invoice save (authoritative for this invoice)

**Stored on `invoice_line_items`**, not on a separate override/junction table:

| Persisted column | Source |
|------------------|--------|
| `unit_price`, `quantity`, `total_price`, `tax_rate` | Builder + `frozenPriceResolutionForInsert` |
| `price_resolution_snapshot` (JSONB) | Full `PriceResolution` snapshot |
| `effective_distance_km`, `original_distance_km`, `distance_km` | KM snapshots |
| `approach_fee_net` | Pricing / override path |
| `trip_meta_snapshot` (JSONB) | Driver, direction |
| `billing_included`, `billing_exclusion_reason` | Opt-out audit |
| `is_cancelled_trip`, `cancelled_billing_reason` | Opt-in cancelled billing |
| `description`, address/name snapshots | Trip snapshot fields |

Insert path: `insertLineItems()` in `invoice-line-items.api.ts` L1015+; row builder `lineItemToInsertRow` L900–934.

Explicit design comment:

```11:16:src/features/invoices/api/invoice-line-items.api.ts
 * ─── Snapshot principle ────────────────────────────────────────────────────
 * Line items are always created FROM trips, never edited after creation.
 * If the data is wrong, the invoice must be storniert and a new one created.
 * This is intentional — it matches German legal requirements for invoice
 * immutability (§14 UStG: Rechnungen dürfen nicht nachträglich geändert werden).
```

### Optional writeback to `trips` (side effect — affects future invoices)

After `insertLineItems`, `use-invoice-builder.ts` fire-and-forgets trip updates:

```688:710:src/features/invoices/hooks/use-invoice-builder.ts
      // Fire-and-forget: failed writeback must never block the invoice.
      void Promise.allSettled(
        lineItems
          .filter((item) => item.trip_id !== null)
          .map((item) => {
            const baseNet = item.price_resolution.net;
            const approachNet = item.approach_fee_net ?? 0;
            return tripsService.updateTrip(item.trip_id!, {
              gross_price: item.manualGrossTotal ?? item.price_resolution.gross,
              tax_rate: item.tax_rate,
              base_net_price: baseNet,
              approach_fee_net: approachNet,
              ...(item.isManualOverride && item.manualGrossTotal !== null
                ? { manual_gross_price: item.manualGrossTotal }
                : {}),
              ...(item.isManualKmOverride && item.manualDistanceKm != null
                ? { manual_distance_km: item.manualDistanceKm }
                : {})
            });
          })
      );
```

**Critical implication:** Manual KM/gross overrides are **snapshotted on the line item** (safe for the issued invoice PDF) but **also** written to `trips.manual_gross_price` / `trips.manual_distance_km` when flagged — those trip columns influence **future** pricing via `resolveTripPrice` / `resolveEffectiveDistanceKm`. They do **not** retroactively change already-inserted `invoice_line_items`.

There is **no** `trip_overrides` table. Trip–invoice link is **`invoice_line_items.trip_id`** (nullable; manual lines have `NULL`).

---

## 4. PDF watermark capability

### Current state: **no draft watermark / “Entwurf” overlay**

Grep across `src/features/invoices/components/invoice-pdf/**` finds **no** conditional rendering for `invoice.status`, watermark, or “Entwurf” text. The only `status: 'draft'` usages are in **`build-draft-invoice-detail-for-pdf.ts`** (synthetic pre-save preview) and test fixtures — not render logic in `InvoicePdfDocument`.

### `InvoicePdfDocument` structure and props

Root component: `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx`

```72:98:src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx
export interface InvoicePdfDocumentProps {
  invoice: InvoiceDetail;
  /** PNG data URL from `qrcode` (EPC SCT payload); omit if IBAN missing or generation failed. */
  paymentQrDataUrl?: string | null;
  /** Optional intro text override from invoice_text_blocks */
  introText?: string | null;
  /** Optional outro text override from invoice_text_blocks */
  outroText?: string | null;
  renderMode?: PdfRenderMode;
  columnProfile?: PdfColumnProfile | null;
  cancelledTrips?: CancelledTripRow[];
  excludedTrips?: ExcludedTripRow[];
}
```

Composition: `Document` → cover `Page` (`InvoicePdfCoverHeader` / `InvoicePdfCoverHeaderBrief`, `InvoicePdfReferenceBar`, `InvoicePdfCoverBody`) + appendix `Page` (`InvoicePdfAppendix`) + `InvoicePdfFooter`. Styling in `pdf-styles.ts`; layout constants in `pdf-layout-constants.ts`.

**Adding a revision/draft watermark** would require new props (e.g. `showDraftLabel?: boolean`) or branching on `invoice.status` inside `InvoicePdfDocument` — neither exists today.

### Where PDFs are rendered

| Entry | File |
|-------|------|
| Detail download | `invoice-detail/index.tsx` — `PDFDownloadLink` + `InvoicePdfDocument` |
| Preview route | `src/app/dashboard/invoices/[id]/preview/page.tsx` |
| Builder live preview | `use-invoice-builder-pdf-preview.tsx` → `build-draft-invoice-detail-for-pdf.ts` |

---

## 5. Payer settings

### No separate payer settings table

Per-payer configuration is stored **as columns on `public.payers`**, spread across migrations. There is no `payer_settings` JSON object or child table.

### Known payer columns relevant to invoicing

| Column | Migration / source | Purpose |
|--------|-------------------|---------|
| `pdf_vorlage_id` | `20260408120001_pdf_vorlagen.sql` | Default PDF column Vorlage |
| `default_intro_block_id`, `default_outro_block_id` | `20260401190000_create_invoice_text_blocks.sql` | Default Rechnungsvorlagen |
| `rechnungsempfaenger_id` | `20260405100002_catalog_recipient_fks.sql` | Default Rechnungsempfänger tier |
| `manual_km_enabled` | `20260505180000_manual_km_overrides_foundation.sql` | Enables Step 3 KM override UI |
| `kts_default` | `20260403120000_kts_catalog_and_trips.sql` | KTS catalog default |
| `no_invoice_required_default` | `20260404103000_no_invoice_fremdfirma_recurring.sql` | “Keine Rechnung” default |
| `accepts_self_payment` | `20260428120000_shift_reconciliations.sql` | Self-pay billing class |
| `reha_schein_enabled` | `20260514120000_reha_schein.sql` | Reha-Schein feature flag |
| Address fields | `20260331100000_add_address_fields_to_payers.sql` | PDF/display (live payer row; invoice recipient uses snapshot) |

Partial TypeScript mirror (`database.types.ts` L758–772): `accepts_self_payment`, `manual_km_enabled`, `kts_default`, `no_invoice_required_default`, `rechnungsempfaenger_id`, etc. (generated types may lag migrations for `pdf_vorlage_id`).

### Natural place for `revision_invoices_enabled`

**`payers` table — new boolean column**, following existing feature flags (`manual_km_enabled`, `reha_schein_enabled`, `no_invoice_required_default`):

- Checked when showing “Bearbeiten” / entering revision mode on detail or list.
- Loaded on `/dashboard/invoices/new` payer fetch (already selects payer fields in `new/page.tsx` L67–83).
- No new table required; Kostenträger detail sheet is the established settings surface (see `docs/invoices-module.md` § Phase 6 payer assignment).

Alternative (heavier): company-wide flag on `company_profiles` — less aligned with “enabled per payer” requirement.

---

## 6. Invoice edit flow

### Creation flow (one-way)

| Step | Route / component | DB operation |
|------|-------------------|--------------|
| 1–5 | `/dashboard/invoices/new` → `InvoiceBuilder` | None until submit |
| Submit | `useInvoiceBuilder` → `createMutation` | `createInvoice()` INSERT `invoices` (`status: 'draft'`) |
| Line items | same mutation | `insertLineItems()` INSERT `invoice_line_items` |
| Trip writeback | same mutation (async) | `tripsService.updateTrip()` UPDATE `trips` |
| Redirect | `router.push(/dashboard/invoices/${id})` | — |

There is **no** `updateInvoice`, **no** `/dashboard/invoices/[id]/edit` route, **no** builder hydration from existing `invoiceId` (`invoice-builder/index.tsx` props: `companyId`, `payers`, `clients`, `companyProfile` only).

Feature 2 “Edit Draft Invoice” is explicitly **deferred** in `docs/plans/invoice-builder-features-audit.md` L15.

### Post-creation changes (what exists today)

| UX path | Allowed change | DB operations |
|---------|----------------|---------------|
| Detail → “Als versendet markieren” | `draft` → `sent` | `updateInvoiceStatus` UPDATE `invoices.status`, `sent_at` |
| Detail → “Als bezahlt markieren” | `sent` → `paid` | UPDATE `paid_at` |
| Detail → “Stornieren” | Storno workflow | RPC `create_storno_invoice`: INSERT Storno invoice + line items; UPDATE original → `corrected` |
| Abrechnung widget dropdown | `draft`→`sent`, `sent`→`paid`/`cancelled` | Same `updateInvoiceStatus` (cancelled path inconsistent with Storno) |
| Detail → E-Mail-Entwurf panel | Edit subject/body | `saveInvoiceEmailDraft` UPDATE `email_subject`, `email_body` |
| Detail / list → PDF | Download/preview | Read-only `getInvoiceDetail` |
| — | Line items, totals, payer, period, PDF columns | **Not editable** in UI |

### Draft invoice on detail page

Even for `status === 'draft'`, the detail view is **read-only** for line items and header fields. Actions are limited to mark sent, Storno, PDF, and email draft (`invoice-builder-features-audit.md` §11).

---

## 7. Existing RLS policies

Source migration: `supabase/migrations/20260401180000_invoices_invoice_line_items_rls.sql`

### `invoices`

| Policy | Command | Restriction |
|--------|---------|-------------|
| `invoices_select_company_admin` | SELECT | `current_user_is_admin()` AND `company_id = current_user_company_id()` |
| `invoices_insert_company_admin` | INSERT | same WITH CHECK |
| `invoices_update_company_admin` | UPDATE | same USING + WITH CHECK |

**No policy restricts UPDATE by `status`.** An admin can theoretically set `subtotal`/`total` or revert `sent` → `draft` via direct Supabase client — the app does not expose this.

**No DELETE policy** on `invoices` — with RLS enabled, client DELETE would be denied unless a policy is added or a SECURITY DEFINER RPC is used.

### `invoice_line_items`

| Policy | Command | Restriction |
|--------|---------|-------------|
| `invoice_line_items_select_company_admin` | SELECT | Admin + parent invoice in company |
| `invoice_line_items_insert_company_admin` | INSERT | Admin + parent invoice in company |

**No UPDATE or DELETE policies.** Client-side line-item mutation or delete-and-reinsert **will fail** under RLS until new policies or a SECURITY DEFINER RPC (e.g. `replace_draft_invoice_line_items`) is added.

No later migration adds invoice line-item UPDATE/DELETE policies (verified grep across `supabase/migrations/**`).

### Related SECURITY DEFINER functions

| Function | Role |
|----------|------|
| `invoice_numbers_max_for_prefix` | Global invoice number allocation |
| `create_storno_invoice` | Atomic Storno insert + original `corrected` |
| `trip_ids_matching_invoice_effective_status` | INVOKER — respects RLS on underlying tables |

---

## 8. Recommendation — lowest-risk path to a mutable “Revision” state

### Goals restated

(a) Do not break existing **sent/paid** invoices  
(b) Preserve **manual trip overrides** (snapshotted on line items)  
(c) Enable **per payer** via config  

### Honest assessment

The codebase is built around **create-once snapshots** and **Storno for post-issue correction**. A “Revision” mode that reuses the builder is ** feasible** but **not a small flag change** — the real work is **mutating draft line items** and **hydrating builder state**, not adding a status string alone.

### Recommended approach (phased, lowest risk)

#### Phase A — Schema & guards (no UX yet)

1. Add `payers.revision_invoices_enabled BOOLEAN NOT NULL DEFAULT false` (or `draft_editing_enabled` — name to product spec).
2. **Do not** change behaviour for `sent` / `paid` / `corrected` — keep Storno as the only post-issue correction path.
3. Add `invoice_line_items` **DELETE** policy scoped to parent `invoices.status IN ('draft')` **or** prefer a single **`replace_draft_invoice_line_items(invoice_id, jsonb)`** SECURITY DEFINER RPC with explicit status guard — avoids broad DELETE and matches Storno RPC pattern (`20260411120000_storno_atomic_rpc.sql`).

#### Phase B — Draft edit without new status (smallest behavioural change)

1. When `payers.revision_invoices_enabled` and `invoices.status = 'draft'`, show **Bearbeiten** on detail → `/dashboard/invoices/[id]/edit`.
2. Reuse `InvoiceBuilder` with `invoiceId` prop; hydrate Step 2 from invoice row + Step 3 from `invoice_line_items` via new **`mapLineItemRowToBuilderLineItem`** (inverse of `lineItemToInsertRow`).
3. Save via **`updateDraftInvoice`**: UPDATE header fields + replace line items + recompute totals; **keep same `invoice_number`**; no `generateNextInvoiceNumber`.
4. Treat **`in_revision` status as optional Phase C** — only add if you need a visible lock (“being edited”) or to block concurrent “Als versendet” while editor is open. Phase B can use `draft` alone with optimistic UI disable on detail actions.

**Why defer `in_revision` initially:** Fewer touch points (`trip_ids_matching_invoice_effective_status`, Storno eligibility, badges, revenue queries already treat `draft` correctly). Adding `in_revision` requires updating every place that lists `draft` (RPC L23, L51, Storno RPC L75, manual-km writeback guards in `20260505180000_manual_km_overrides_foundation.sql`).

#### Phase C — Preserve overrides on re-open

When mapping `InvoiceLineItemRow` → `BuilderLineItem`:

- Reconstruct `manualGrossTotal` / `isManualOverride` from `price_resolution_snapshot` + `total_price` vs engine output — **highest-risk mapping**; wrong logic causes silent total drift on save.
- Restore `effective_distance_km`, `original_distance_km`, `billingInclusion` from persisted columns.
- Restore cancelled opt-in rows from `is_cancelled_trip = true` lines; re-fetch passive cancelled trips for appendix (not stored as line items).
- On save, re-run same `insertLineItems` / writeback rules as create flow; define idempotent trip writeback (same values → no harm).

**Do not** rely on live `trips` JOIN for PDF/display — keep snapshot principle for anything that might have been `sent` once; for draft-only edit, overwriting line items is legally acceptable if never issued.

#### Phase D — PDF / sent invoices (unchanged)

- **No watermark required** for revision workflow unless product wants “Entwurf” on PDFs for `draft` — add optional prop to `InvoicePdfDocument` (§4); default off for parity with current issued PDFs.
- **`sent` / `paid`:** no edit entry point; Storno-only. Per-payer flag does not apply after send.

### What to avoid

| Anti-pattern | Risk |
|--------------|------|
| Editing `trips` as source of truth for invoice amounts | Overrides leak to other invoices / trips |
| Allowing UPDATE on `sent` invoices without Storno | §14 UStG / audit failure |
| Client-only delete/reinsert line items without RLS/RPC fix | Hard failure in production |
| New status without updating trip RPC | Trips show “Nicht abgerechnet” while on revising invoice |

### Effort ranking (blockers first)

1. **RLS / RPC for line-item replace** — blocker  
2. **`InvoiceLineItemRow` → `BuilderLineItem` mapper** — large, price-drift risk  
3. **Edit route + hook branch** — large but mechanical  
4. **`in_revision` status + UI badges** — medium, optional  
5. **`payers.revision_invoices_enabled`** — small  

### Summary table

| Question | Answer |
|----------|--------|
| Statuses today | `draft`, `sent`, `paid`, `cancelled`, `corrected` — `draft` exists; no `pending` |
| Immutability | Cultural/app-level at `sent`; no DB column guards; detail is read-only |
| Overrides storage | **`invoice_line_items` snapshots**; optional **`trips`** writeback for future pricing |
| PDF watermark | **None**; extend via `InvoicePdfDocumentProps` |
| Payer config | **Columns on `payers`**; add boolean there |
| Edit after create | **Email draft + status only**; no line-item/header edit |
| RLS | Invoice UPDATE unrestricted by status; **line items INSERT-only** |
| Lowest-risk revision | Per-payer flag + **draft-only** builder re-open + **RPC replace line items** + mapper; keep Storno for sent/paid |

---

*End of audit.*
