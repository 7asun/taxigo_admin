# Invoice status state machine + `in_revision` workflow — feasibility audit

Read-only audit (2026-05-28). No code changes.

---

## Context correction

The assumed flow `draft → sent → finalised / corrected` does **not** match the codebase.

| Assumed | Actual |
|---------|--------|
| `finalised` | **`paid`** (terminal after `sent`) |
| `corrected` from send path | **`corrected`** is set on the **original** invoice when a **Stornorechnung** is created via RPC — not a normal forward transition |
| `cancelled` as primary storno outcome | Original becomes **`corrected`**; the Storno document is a **new** invoice with `status = 'draft'` |

Documented lifecycle (types + migration comments):

```49:59:src/features/invoices/types/invoice.types.ts
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

---

## 1. Current valid invoice statuses in the DB schema

### Definition

`status` is **`TEXT NOT NULL DEFAULT 'draft'`** with an inline **`CHECK` constraint** — **not** a Postgres `ENUM`.

```80:81:supabase/migrations/20260331120000_create_invoices.sql
  status                TEXT          NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','sent','paid','cancelled','corrected')),
```

No later migration redefines this CHECK. `in_revision` is **not** present.

### Migration pattern to add `in_revision`

Follow the same inline-CHECK pattern used elsewhere in this repo (e.g. letters table):

1. Drop the existing CHECK on `invoices.status` (constraint name is auto-generated unless explicitly named — inspect `\d invoices` or `pg_constraint` in prod).
2. Re-add CHECK including `'in_revision'`.

Example shape (exact constraint name must be verified at apply time):

```sql
ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check; -- verify name

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('draft','sent','paid','cancelled','corrected','in_revision'));
```

Also update in the same or follow-up migrations:

- TypeScript `InvoiceStatus` in `invoice.types.ts`
- `InvoiceStatusTransition` / UI status badges / list filters
- **`trip_ids_matching_invoice_effective_status`** — today only `draft`, `sent`, `paid` count as invoiced (see §3)
- **`create_storno_invoice`** eligibility — today `status IN ('draft', 'sent')` only

No `supabase/functions/` exist for invoices; all server logic is migrations + client API + one RPC.

---

## 2. Current state machine — transitions and trigger sites

There is **no enforced transition graph** in the DB (no trigger, no RPC guard on `updateInvoiceStatus`). Any value passing the CHECK can be written via a direct `.update({ status })`. Application code implements the intended machine.

### Transition inventory

| From | To | Mechanism | Triggered from |
|------|-----|-----------|----------------|
| *(none)* | `draft` | `INSERT` via `createInvoice()` | Invoice builder save — `useInvoiceBuilder` → `createMutation` → `createInvoice` (`status: 'draft'`) |
| `draft` | `sent` | Direct `.update({ status: 'sent', sent_at })` via `updateInvoiceStatus('sent')` | Detail: `invoice-actions.tsx` “Als versendet markieren”; Abrechnung widget: `abrechnung-recent-invoices.tsx` |
| `sent` | `paid` | `updateInvoiceStatus('paid')` | Detail: `invoice-actions.tsx` “Als bezahlt markieren”; Abrechnung widget |
| `draft` / `sent` | `corrected` (+ new Storno `draft`) | **`create_storno_invoice` RPC** (atomic) | Detail: `invoice-actions.tsx` → `createStornorechnung` → `storno.ts` |
| `sent` | `cancelled` | `updateInvoiceStatus('cancelled')` | **Abrechnung widget only** (`abrechnung-recent-invoices.tsx`) — **does not** create Stornorechnung |
| `paid`, `cancelled`, `corrected` | — | No UI actions | `invoice-actions.tsx` returns `null` |

### RPC: Storno (the real cancellation path)

```70:79:supabase/migrations/20260411120000_storno_atomic_rpc.sql
  IF NOT EXISTS (
    SELECT 1
    FROM public.invoices o
    WHERE o.id = p_original_invoice_id
      AND o.company_id = p_company_id
      AND o.status IN ('draft', 'sent')
  ) THEN
    RAISE EXCEPTION 'original invoice not found or not storno-eligible'
```

Original update inside same transaction:

```135:141:supabase/migrations/20260411120000_storno_atomic_rpc.sql
  UPDATE public.invoices
  SET
    status       = 'corrected',
    cancelled_at = now(),
    updated_at   = now()
  WHERE id = p_original_invoice_id
```

Storno header inserted as `status = 'draft'` (line 93).

### Direct status API

```322:354:src/features/invoices/api/invoices.api.ts
export type InvoiceStatusTransition = 'sent' | 'paid' | 'cancelled';
// ...
  const { data, error } = await supabase
    .from('invoices')
    .update({ status, ...timestampUpdate, updated_at: now })
    .eq('id', id)
```

No validation of current status before update.

### List vs detail actions

- **`invoice-list-table/columns.tsx`**: Ansehen, PDF-Vorschau, PDF herunterladen — **no status changes, no edit**.
- **`invoice-detail/invoice-actions.tsx`**: Status + Storno only (see table above).
- **`saveInvoiceEmailDraft`**: Updates `email_subject` / `email_body` only — not lifecycle status.

### Proposed `in_revision` transitions (not implemented)

Natural fit for the requested flow:

- `draft` → `in_revision` — admin opens revision (new action)
- `in_revision` → `draft` — builder save overwrites data
- `in_revision` → `sent` — should be **blocked** until save returns to `draft`

---

## 3. RLS, CHECK constraints, triggers — blockers for `in_revision`

### RLS on `invoices`

Update policy is **company-scoped admin only** — **no status-based restriction**:

```31:40:supabase/migrations/20260401180000_invoices_invoice_line_items_rls.sql
CREATE POLICY "invoices_update_company_admin" ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
```

**Adding `in_revision` to the CHECK does not require RLS policy changes** for the status value itself.

Optional hardening (not present today): restrict which columns may change per status in app layer or a future trigger.

### RLS on `invoice_line_items` — **BLOCKER for overwrite save**

Only **SELECT** and **INSERT** policies exist. **No UPDATE or DELETE policies.**

```57:66:supabase/migrations/20260401180000_invoices_invoice_line_items_rls.sql
CREATE POLICY "invoice_line_items_insert_company_admin" ON public.invoice_line_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_line_items.invoice_id
        AND i.company_id = public.current_user_company_id()
    )
  );
```

With RLS enabled, **delete-and-reinsert** or **UPDATE** line items from the client **will fail** until new policies (or a `SECURITY DEFINER` RPC) are added.

### Triggers

**None** on `invoices` or `invoice_line_items` for status transitions (grep across `supabase/migrations/`).

### Other status-sensitive logic (must be updated for `in_revision`)

**Trip invoicing RPC** — `in_revision` trips would show as **uninvoiced** unless added:

```18:24:supabase/migrations/20260411140000_trip_ids_matching_invoice_effective_status.sql
      WHEN 'uninvoiced' THEN NOT EXISTS (
        SELECT 1
        FROM public.invoice_line_items li
        JOIN public.invoices i ON i.id = li.invoice_id
        WHERE li.trip_id = t.id
          AND i.status IN ('draft', 'sent', 'paid')
      )
```

**Recommendation:** Treat `in_revision` like `draft` for trip badge/filter purposes (line items still linked).

**Storno RPC** — decide whether `in_revision` is storno-eligible (today only `draft` / `sent`).

**Revenue total** — only `sent` / `paid` count; `in_revision` correctly excluded.

**Manual km writeback RPC** (`20260528062000_invoice_line_items_billing_inclusion.sql`, `20260505180000_manual_km_overrides_foundation.sql`) — references `o.status IN ('draft', 'sent')`; include `in_revision` if edits should write back km during revision.

---

## 4. Invoice builder initialisation — pre-load feasibility

### Current behaviour: always fresh

| Aspect | Current |
|--------|---------|
| Route | `/dashboard/invoices/new` only (`src/app/dashboard/invoices/new/page.tsx`) |
| Props | `companyId`, payers, clients, company profile — **no `invoiceId`** |
| Hook init | `step2Values: null`, `lineItems: []`, `cancelledTrips: []` |
| Trip load | After Step 2 completes → `fetchTripsForBuilder` + `fetchCancelledTripsForBuilder` |
| Persist | **`createInvoice` INSERT only** — always new `invoice_number` |
| Post-save | `router.push(/dashboard/invoices/${newId})` |

```96:103:src/features/invoices/components/invoice-builder/index.tsx
interface InvoiceBuilderProps {
  companyId: string;
  payers: Payer[];
  clients: Client[];
  defaultPaymentDays: number;
  companyProfile: InvoiceDetail['company_profile'] | null;
  companyProfileMissing?: boolean;
}
```

**There is no mechanism today to pre-load an existing invoice into Steps 1–4.**

### What exists on the persisted row (available for hydration)

From `getInvoiceDetail` / `InvoiceRow`:

- Step 2: `mode`, `payer_id`, `client_id`, `period_from`, `period_to`, `billing_type_id`, `billing_variant_id`
- Step 4: `intro_block_id`, `outro_block_id`, `payment_due_days`, `rechnungsempfaenger_id`, `pdf_column_override`
- Header: `invoice_number`, snapshots, totals

### Gaps for full re-open

| Builder state | Persisted? | Re-hydration note |
|---------------|------------|-------------------|
| `billing_type_ids` / `billing_variant_ids` (monthly multi-select) | **No** | Must infer from line items or re-fetch all trips in period |
| Normal line items | Yes (`invoice_line_items`) | Need **`InvoiceLineItemRow` → `BuilderLineItem` mapper** (does not exist) |
| Opted-in cancelled trips | Yes (`is_cancelled_trip = true` rows) | Map from line items + `price_resolution_snapshot` |
| Opted-out cancelled trips (passive appendix) | **No** | Re-fetch via `fetchCancelledTripsForBuilder`, default opted-out |
| Excluded normal trips (`billing_included = false`) | Yes | Mapper must restore `billingInclusion` |
| `includeApproachFee` on cancelled rows | **No** | Infer from `approach_fee_net` vs snapshot or re-price |
| `show_cancelled_trips` / `show_excluded_trips` | Inside `pdf_column_override` JSON | Parse from `pdf_column_override` |
| Live pricing / km overrides in builder | Partially in snapshots + trip writeback columns | Risky round-trip (see §6) |

### Reference pattern in codebase

Angebot edit mode: `/dashboard/angebote/[id]/edit` — invoice module has **no equivalent route** (`src/app/dashboard/invoices/` has `new`, `[id]`, `[id]/preview` only).

### Work estimate signal

“Re-open with existing data” is **not a small UI toggle** — it requires a new route, hook branch, mapper, and **update** mutation path (not just a status flag).

---

## 5. Where line item data is read for a draft invoice

### Detail / PDF (persisted draft)

**Directly from `invoice_line_items`** via PostgREST embed — not builder cache.

```137:157:src/features/invoices/api/invoices.api.ts
export async function getInvoiceDetail(id: string): Promise<InvoiceDetail> {
  // ...
      line_items:invoice_line_items(*)
```

Sorted by `position` in application code. Detail view renders this read-only table (`invoice-detail/index.tsx`).

### Builder (create flow)

**Ephemeral React state** in `useInvoiceBuilder`:

- `lineItems: BuilderLineItem[]` — from live trip fetch + user edits
- `cancelledTrips: BuilderCancelledTripRow[]` — parallel fetch, not from DB until save

On save, `insertLineItems(invoice.id, lineItems, optedInCancelled)` maps builder rows → insert rows (`invoice-line-items.api.ts`).

### Builder PDF preview (pre-save)

Synthetic `InvoiceDetail` from **`build-draft-invoice-detail-for-pdf.ts`** using in-memory builder state — **not** `invoice_line_items`.

### Implication for `in_revision`

Pre-populating Step 3 means **hydrating builder state from `invoice_line_items`**, not reusing the detail query path. The detail page already proves the persisted shape; the builder uses a richer in-memory model (`BuilderLineItem`, `price_resolution`, `billingInclusion`, manual override flags).

---

## 6. Senior assessment — cleanest implementation path

### Is a new `in_revision` status the right approach?

**Yes, with caveats** — preferable to a boolean on `draft`:

| Approach | Pros | Cons |
|----------|------|------|
| **`in_revision` status** | Clear UX (“being edited”), blocks `sent`/Storno actions in UI, audit trail, trip RPC can treat like draft | Requires CHECK migration + ~15 touch points (badges, filters, RPCs, transition guards) |
| **`draft` + `is_editing` flag** | Fewer status enum changes | Ambiguous with never-sent drafts; harder to guard “Als versendet” while editor open; same overwrite problems |
| **Edit `draft` in place without new status** | Simplest state machine | No lock against concurrent send; doesn’t match “explicit revision mode” product intent |

Use `in_revision` **only if** you need a visible locked/intermediate state. If the product accepts “draft is editable until sent”, **`draft` + edit route** avoids a new status — but that contradicts the stated “return to draft on save” flow (`in_revision` → `draft` implies two draft-adjacent states).

### Recommended architecture (phased)

1. **Schema + RLS:** Add `in_revision` to CHECK; add `invoice_line_items` **DELETE** (and optionally UPDATE) policies **or** a single `replace_draft_invoice_line_items(invoice_id, jsonb)` RPC (SECURITY DEFINER, status guard `IN ('draft','in_revision')`).
2. **API:** `updateDraftInvoice(invoiceId, headerPatch, lineItems[])` — UPDATE header + delete/reinsert line items + recompute totals; transition `in_revision` → `draft` on success. **Do not** call `generateNextInvoiceNumber` (keep `invoice_number`).
3. **Route:** `/dashboard/invoices/[id]/edit` — same `InvoiceBuilder` with `invoiceId` + server-fetched `InvoiceDetail`.
4. **Hydration spike first:** `mapLineItemRowToBuilderLineItem` + `mapInvoiceToStep2Values` before UI polish.
5. **Entry:** Detail action “Bearbeiten” → `updateInvoiceStatus(id, 'in_revision')` (or dedicated mutation) → redirect to edit route.
6. **Trip RPC:** Add `in_revision` wherever `draft` is used for “already invoiced” semantics.

### Highest-risk part of pre-loading builder from `invoice_line_items`

1. **`InvoiceLineItemRow` → `BuilderLineItem` inverse mapping** — `price_resolution_snapshot` is JSON; manual km/gross flags must be reconstructed (`effective_distance_km`, `manualGrossTotal`, `isManualOverride`, `isManualKmOverride`). Wrong mapping → silent price drift on save.
2. **Line item overwrite without RPC** — RLS blocks DELETE today (**hard blocker**).
3. **Trip double-link / period change** — `fetchTripsForBuilder` does **not** exclude trips already on this invoice. Re-fetch after payer/period change can duplicate or drop trips. Revision mode must either:
   - seed from existing line items and merge with fresh fetch, or
   - exclude `trip_id`s already on `invoice_id` when re-querying.
4. **Passive cancelled trips** — not in DB; `show_cancelled_trips` only in `pdf_column_override`. Re-open must re-fetch cancelled trips or lose passive appendix rows.
5. **`includeApproachFee`** — builder-only; not persisted. Cancelled-trip approach-fee checkbox state cannot be restored exactly.
6. **Save side effects** — create flow fire-and-forgets trip writeback (`gross_price`, `manual_distance_km`, etc.). Edit save must define idempotent rules to avoid double-write or stale trip state.
7. **§14 UStG snapshots** — `rechnungsempfaenger_snapshot` / `client_reference_fields_snapshot` are frozen at **create**. Proposed “all fields editable including payer” implies **re-snapshot on revision save** while still `draft`/`in_revision` — acceptable legally if never `sent`, but contradicts current comments (“never mutate after issue”); document intent.

### Constraints / patterns that make this harder than it appears

| Surprise / blocker | Severity |
|--------------------|----------|
| **No `updateInvoice` / line-item mutation API** | **Blocker** |
| **`invoice_line_items` INSERT-only RLS** | **Blocker** for overwrite |
| **No edit route / no builder hydration** | **Large** new surface |
| **No `InvoiceLineItemRow` → `BuilderLineItem` mapper** | **Large** |
| **Step 2 multi-select filters not persisted** | Medium — monthly subset invoices |
| **`cancelled` via `updateInvoiceStatus` in Abrechnung widget** vs RPC Storno on detail | Medium — pre-existing inconsistency |
| **`finalised` does not exist** | Clarification only |
| **Immutability culture in docs/code** | Process — team must agree draft/revision mutability vs post-`sent` Storno-only |

### Alternative if scope must shrink

**Phase 0 without `in_revision`:** Allow edit only while `status = 'draft'`, same builder hydration + `updateDraftInvoice`, no intermediate status. Add `in_revision` later for UX/locking if needed.

---

## Summary

| Question | Answer |
|----------|--------|
| DB statuses | `draft`, `sent`, `paid`, `cancelled`, `corrected` — TEXT + CHECK, not ENUM |
| State machine | Create → draft; draft→sent; sent→paid; draft/sent→Storno (corrected + new draft); legacy sent→cancelled in one widget |
| RLS for new status | CHECK migration required; invoice RLS OK; **line item DELETE/UPDATE policies or RPC required** |
| Builder pre-load | **Does not exist** — new route + hook branch + mappers |
| Draft line items source | **`invoice_line_items` via `getInvoiceDetail`** on detail; builder uses ephemeral state |
| Cleanest path | New status optional but reasonable; **overwrite save + hydration mapper + line-item mutation** is the real work |

See also: [`invoice-builder-features-audit.md`](./invoice-builder-features-audit.md) (§10–13 draft-edit gaps), [`docs/invoices-module.md`](../invoices-module.md) (Storno, trip badge RPC, billing inclusion).
