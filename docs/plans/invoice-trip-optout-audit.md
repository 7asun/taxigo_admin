# Invoice trip opt-out audit

Read-only audit (2026-06-15). No code changes.

**Scope:** Data model and snapshot logic for invoices (including Storno and corrective branch drafts), “opted out” / `Ausgeschlossen` trip logic in the invoice builder, trip status vs edit flow, scenario reasoning for “3 opted out when only 1 was deselected”, React state management, invariants, and fix recommendations.

**Path note:** The user prompt referenced `apps/web/…`. This repo uses `src/` (e.g. `src/features/invoices/`, `src/app/dashboard/invoices/`). All paths below are actual repo paths.

**Related docs read:** [`docs/invoices-module.md`](../invoices-module.md), [`docs/plans/revision-invoice-audit.md`](./revision-invoice-audit.md), [`docs/plans/trip-override-storno-audit.md`](./trip-override-storno-audit.md), [`docs/plans/cancelled-trips-invoice-audit.md`](./cancelled-trips-invoice-audit.md).

---

## Executive summary

The system does **not** use a separate “invoice snapshot” table. Snapshots live on **`invoice_line_items`** (per-trip frozen fields + JSONB) and **`invoices`** (header snapshots). A corrective invoice after Storno is a **branch draft** (`replaces_invoice_id` → corrected original), created by copying **all** line items verbatim—including rows with `billing_included = false`.

**“Opted out” in the UI is not a diff** between “snapshot at session start” and “current selection”. It is the **absolute** runtime flag `billingInclusion.included === false` on each `BuilderLineItem`, hydrated from persisted `billing_included` on each line item row.

The most plausible explanation for **3 opted-out trips when the user deselected only 1 in the branch edit flow** is:

1. **Inherited exclusions:** Invoice A already had **2** normal trips with `billing_included = false` (Ausgeschlossene Fahrten appendix). Branch draft B copies those flags unchanged. One additional opt-out in B → **3 total**—correct per code, surprising per user expectation.
2. **UX / mental model gap:** The UI does not distinguish “excluded on the original invoice” vs “excluded in this edit session”; all show the same `Ausgeschlossen` badge.

Live `trips.status` is **not** used to compute opted-out state in edit mode. Edit mode does **not** re-fetch trips from the period query.

---

## 1. Data model and snapshot logic

### 1.1 How is an “invoice snapshot” modelled in the database?

There is **no** dedicated snapshot table. Snapshots are **copied columns** on existing tables.

| Concept | Table / columns | Notes |
|--------|------------------|-------|
| **Original invoice** | `public.invoices` | One row per invoice. Lifecycle via `status`. |
| **Cancellation invoice (Stornorechnung)** | `public.invoices` with `cancels_invoice_id` → original | New row, `status = 'draft'`, negated totals/lines. Original set to `corrected`. |
| **Corrective / replacement draft** | `public.invoices` with `replaces_invoice_id` → corrected original | Branch draft after Storno; positive totals copied from original. |
| **Per-trip snapshot** | `public.invoice_line_items` | One row per position; `trip_id` is informational FK only. |
| **Pricing snapshot** | `invoice_line_items.price_resolution_snapshot` (JSONB) | Full `PriceResolution` frozen at issue/save. |
| **Trip display snapshot** | `invoice_line_items.trip_meta_snapshot` (JSONB) | Driver, direction, etc. |
| **Distance snapshot** | `distance_km`, `effective_distance_km`, `original_distance_km` | Routing vs billed km. |
| **Billing inclusion snapshot** | `billing_included`, `billing_exclusion_reason`, `is_cancelled_trip`, `cancelled_billing_reason` | Added in `20260528062000_invoice_line_items_billing_inclusion.sql`. |
| **Recipient snapshot** | `invoices.rechnungsempfaenger_snapshot`, `client_reference_fields_snapshot` | §14 UStG window addressee. |
| **PDF layout snapshot** | `invoices.pdf_column_override` (JSONB) | Resolved column profile at save. |

**Invoice relationship fields** (`20260331120000_create_invoices.sql`, `20260605120100_invoices_replaces_invoice_id.sql`):

```text
Normal invoice:     cancels_invoice_id = NULL, replaces_invoice_id = NULL
Stornorechnung:     cancels_invoice_id = <original id>, replaces_invoice_id = NULL
Corrected original: status = 'corrected' (terminal for editing)
Branch draft:       replaces_invoice_id = <corrected original id>, status = 'draft'
```

Partial unique index: at most **one** branch draft per corrected original (`idx_invoices_replaces_invoice_id_unique`).

There is **no** `invoice_trips` junction table. Trip membership is `invoice_line_items.trip_id` (nullable for manual lines).

### 1.2 When a new invoice is started from a cancelled invoice, how are trips loaded/linked?

Two distinct flows:

#### A) Stornorechnung (`createStornorechnung`)

- **File:** `src/features/invoices/lib/storno.ts`
- **RPC:** `create_storno_invoice` (`20260411120000_storno_atomic_rpc.sql`, updated `20260528062000`)
- Mirrors **all** original line items with negated money fields; copies snapshot JSONB unchanged (pricing negation applied in TS for amounts).
- Original invoice → `status = 'corrected'`.
- Does **not** create an editable replacement invoice—only the negative Storno document.

#### B) Corrective branch draft (“Neue Rechnung erstellen”)

- **UI:** `src/features/invoices/components/invoice-detail/invoice-actions.tsx` → `createBranchDraft`
- **API:** `src/features/invoices/api/invoices.api.ts` → RPC `create_branch_draft_from_invoice`
- **Migration:** `supabase/migrations/20260605120200_create_branch_draft_rpc.sql`

**Mechanism:** Loads the `corrected` original, inserts a new `draft` header with **positive** totals and `replaces_invoice_id = original.id`, then:

```sql
INSERT INTO invoice_line_items (...)
SELECT v_branch_id, li.trip_id, li.position, ... -- all snapshot columns
FROM invoice_line_items li
WHERE li.invoice_id = p_original_invoice_id
ORDER BY li.position;
```

So branch draft:

- **References the same `trip_id`s** as the original (not a re-query of the trips table).
- **Copies trip state at invoice time** via snapshot columns—not live trip rows.
- **Copies `billing_included` and `billing_exclusion_reason` verbatim**—opted-out rows on the original remain opted-out on the branch.

**Edit hydration** (`use-invoice-builder.ts`):

- `enabled: !isEditMode` on `tripsQuery` — **no** `fetchTripsForBuilder` / `fetchCancelledTripsForBuilder` in edit mode.
- Line items come only from `getInvoiceDetail` → `mapLineItemRowToBuilderLineItem` / `mapLineItemRowToBuilderCancelledTrip`.
- Comment in hook (L473–475): re-running `buildLineItemsFromTrips` would silently recompute from **mutable** live trips.

The snapshot stores **full line-level state** (amounts, inclusion flags, trip meta), not trip IDs alone.

### 1.3 Logic that recomputes which trips belong to an invoice

| Event | Recomputes trip set? | Where |
|-------|----------------------|-------|
| **Create invoice (new)** | **Yes** — from live trips | `fetchTripsForBuilder` + `buildLineItemsFromTrips` in `use-invoice-builder.ts` |
| **Storno** | **No** — mirrors existing lines | `storno.ts` maps `originalLineItems` 1:1 |
| **Branch draft** | **No** — SQL copy of lines | `create_branch_draft_from_invoice` |
| **Draft save (edit)** | **No** — client sends full line array | `replace_draft_invoice_line_items` RPC deletes + reinserts supplied JSONB |
| **Draft re-open (edit)** | **No** — hydrate from DB | `map-line-item-row-to-builder-line-item.ts` |

**Create-mode trip fetch filters** (`invoice-line-items.api.ts`):

- Payer, date range, optional billing variant/type, optional client.
- Normal trips: `.neq('status', CANCELLED_STATUS)` (`CANCELLED_STATUS = 'cancelled'`).
- Cancelled trips: separate `fetchCancelledTripsForBuilder` with `.eq('status', 'cancelled')`.
- **No** filter excluding trips already linked to another invoice’s line items.

---

## 2. “Opted out” / deselected trips logic

### 2.1 Where is the list calculated for the invoice edit UI?

| Slice | Function / location | Rule |
|-------|---------------------|------|
| **All normal candidate trips (create mode)** | `fetchTripsForBuilder` → `buildLineItemsFromTrips` | All non-cancelled trips in scope |
| **All normal positions (edit mode)** | `getInvoiceDetail` → `mapLineItemRowToBuilderLineItem` | Only rows on the draft invoice |
| **Selected (billable) normal trips** | `billingIncludedLineItems(lineItems)` in `billing-inclusion.ts` | `billingInclusion.included === true` |
| **Deselected / opted-out normal trips** | `lineItems.filter((i) => !isBillingIncludedRow(i))` | Inverse of above |
| **Opted-out count (Step 4 checkbox)** | `excludedTripCount` in `use-invoice-builder.ts` L951–953 | Same filter on `lineItems` |
| **PDF “Ausgeschlossene Fahrten”** | `excludedTripsForPdf` in `invoice-builder/index.tsx` L417–428 | Maps opted-out `lineItems` to `ExcludedTripRow` |
| **Cancelled trips (separate UX)** | `cancelledTrips` state; passive = `!billingInclusion.included` | **Not** counted in `excludedTripCount` |

**SSOT module:** `src/features/invoices/lib/billing-inclusion.ts`

### 2.2 Precise rule for marking a trip as “opted out” in the UI

In Step 3 (`step-3-line-items.tsx` L563):

```ts
const isOptedOut = !item.billingInclusion.included;
```

UI shows badge **“Ausgeschlossen”** when `isOptedOut` (L611–618).

**Not** used for normal trips:

- Diff vs snapshot at session start
- Diff vs original invoice trip set
- Live `trips.status`
- Whether trip is on another invoice

**Opt-out action:** Unchecking the inclusion checkbox opens a dialog; on confirm, `handleLineItemInclusionChange(position, false, reason)` sets `billingInclusion: { included: false, reason }` (`use-invoice-builder.ts` L676–686).

**Persist:** `lineItemToInsertRow` writes `billing_included` and `billing_exclusion_reason` (`invoice-line-items.api.ts` L970–974). Opted-out rows **remain in the array and DB** for audit and PDF appendix.

### 2.3 Does opted-out depend on live trip status?

**In edit mode (branch draft): No.**

Hydration maps only persisted flags:

```179:182:src/features/invoices/utils/map-line-item-row-to-builder-line-item.ts
    billingInclusion: {
      included: row.billing_included ?? true,
      reason: row.billing_exclusion_reason ?? ''
    },
```

The only live trip fetch in edit mode is `fetchTripWheelchairFlags` for the ♿ hint—not for inclusion.

**In create mode:** Live fetch determines **which trips appear**, not opted-out flags. New lines default to `billingInclusion: { included: true, reason: '' }` (`buildLineItemsFromTrips` L725–726). Cancelled trips from `fetchCancelledTripsForBuilder` default to **opted out** (`use-invoice-builder.ts` L450–451).

---

## 3. Relationship between trip status and invoice editing

### 3.1 Trip status values and invoice eligibility

**Lifecycle status** (`src/lib/trip-status.ts`, DB `trips.status`):

| Status | Typical meaning |
|--------|-----------------|
| `pending` / `open` | No driver yet |
| `assigned` | Driver assigned |
| `scheduled` | Planned (driver portal) |
| `in_progress` / `driving` | Underway |
| `completed` | Finished |
| `cancelled` | Cancelled |

**Invoice builder fetch behaviour:**

| Trip status | In normal `fetchTripsForBuilder`? | In `fetchCancelledTripsForBuilder`? |
|-------------|-----------------------------------|-------------------------------------|
| Non-`cancelled` | Yes (if payer/period/scope match) | No |
| `cancelled` | **Excluded** (`.neq('status', 'cancelled')`) | Yes |

**Separate field:** `trips.kts_status` (e.g. `abgerechnet` from KTS import) — not used in builder inclusion logic.

**Invoice effective status** (for Fahrten list badge / filter): `resolveEffectiveTripInvoiceStatus` — considers line items on invoices with `status IN ('draft','sent','paid')`; ignores `corrected` / `cancelled` invoice status (`effective-trip-invoice-status.ts`). Does **not** check `billing_included`.

### 3.2 Can post-invoice trip status changes affect the branch edit screen?

**Which trips appear:** No. Edit mode lists only `invoice_line_items` on the draft—live status is ignored.

**How they appear as opted out:** No. Inclusion comes from `billing_included` on the line row.

**Edge case:** A trip that was **normal** when invoiced but later **`cancelled` in `trips`** still appears as a **normal** line in the branch editor (snapshot row, `is_cancelled_trip = false`). It does not move to the “Stornierte Fahrten” collapsible unless it was persisted that way.

### 3.3 Automatic exclusion logic that could add extra “opted out” rows

| Mechanism | Could mark extra normal trips opted out? |
|-----------|------------------------------------------|
| Already on another invoice | **No** — create fetch does not exclude; edit does not merge live lists |
| Trip status → non-billable | **No** in edit mode |
| Part of Storno chain | **No** — does not flip `billingInclusion` in UI |
| **Branch copy of original `billing_included = false`** | **Yes** — shows as opted out immediately on open, without user action in this session |
| **Storno TS payload omits `billing_included`** | Affects Storno lines only (default `TRUE` in RPC), not branch copy from original |

**Cancelled-trip hydration bug (latent):** `mapLineItemRowToBuilderCancelledTrip` **always** sets `billingInclusion.included: true` (L246–249), ignoring `row.billing_included`. Create flow never persists opted-out cancelled rows, so this is rarely hit. If such a row existed on the original, it would display as opted **in** in the cancelled section—not as a third normal “Ausgeschlossen” row.

---

## 4. Specific scenario reproduction

### Scenario

1. Invoice A created with N trips (some may have been opted out).
2. Invoice A storniert → original `corrected`, Storno draft created.
3. Branch draft B via “Neue Rechnung erstellen” (`create_branch_draft_from_invoice`).
4. User opens B in builder (`/dashboard/invoices/[id]/edit`).
5. User opts out **exactly 1** additional normal trip.
6. UI shows **3** opted-out trips.

### 4.1 Under current code, when would more than 1 appear opted out?

Any of:

1. **≥2 rows on B already had `billing_included = false`** copied from A before the user’s single opt-out.
2. User counts **cancelled-section** passive trips (`cancelledTrips` with `included: false`) separately from normal `Ausgeschlossen`—different UI block, different counter (`excludedTripCount` is normal-only).
3. User counts **Step 4** “Ausgeschlossene Fahrten anzeigen (N)” where N = `excludedTripCount`—same as (1).
4. **Data inspection:** Query `invoice_line_items` for draft B: `WHERE billing_included = false AND is_cancelled_trip = false`.

If (1) is false in DB after only one user action, look for client state bugs (section 5).

### 4.2 Plausible causes (with code paths)

#### Cause A — Branch draft inherits prior exclusions (most likely)

**Path:** `create_branch_draft_from_invoice` copies `billing_included` / `billing_exclusion_reason` → `mapLineItemRowToBuilderLineItem` → Step 3 `isOptedOut`.

**Why 3 when user deselected 1:** Original A had 2 excluded normal trips; branch opens with 2 already `Ausgeschlossen`; user adds 1 → 3.

**Why user is surprised:** Product expectation is “fresh corrective edit from billed snapshot”, but implementation is “full line-item clone including appendix exclusions”.

#### Cause B — No session baseline / delta semantics

**Path:** `excludedTripCount` = absolute count (`use-invoice-builder.ts` L951–953), not `count(now) - count(atHydration)`.

**Why it feels like a bug:** UI never labels inherited exclusions vs new ones.

#### Cause C — Storno payload gap (does not directly cause branch issue; related)

**Path:** `storno.ts` L73–101 builds `stornoLineItems` **without** `billing_included`, `billing_exclusion_reason`, `is_cancelled_trip`, `cancelled_billing_reason`. RPC defaults missing keys to `billing_included = TRUE` (`20260528062000` L196).

**Effect:** Storno lines may misrepresent inclusion vs original; branch still copies **corrected original**, not Storno.

#### Cause D — Create-mode trip list pollution (not branch edit, but same product area)

**Path:** `fetchTripsForBuilder` has no “exclude trips on active invoices” filter.

**Effect:** New invoices can include trips already on draft/sent/paid line items. Does **not** explain branch edit opt-out count unless user confuses flows.

#### Cause E — `hasHydratedRef` never resets on `invoiceId` change

**Path:** `use-invoice-builder.ts` L208, L277–287 — ref set true on first seed, never cleared when `invoiceId` changes.

**Risk:** If `InvoiceBuilder` / hook were reused with a new `invoiceId` without remount, stale `lineItems` could leak. **Mitigation today:** edit route navigates to new URL → page remount. Low probability unless embedded without remount.

#### Cause F — Save path drops opted-out cancelled rows (re-open surprise, not extra normal opt-outs)

**Path:** `updateMutation` only persists `optedInCancelled` cancelled rows (L1117–1122). Opted-out cancelled trips vanish from DB on save; they won’t reappear as normal `Ausgeschlossen`.

---

## 5. UI / state management audit

### 5.1 How is selected vs opted-out state stored?

| Layer | Storage |
|-------|---------|
| **Runtime inclusion** | React `useState`: `lineItems`, `cancelledTrips` in `use-invoice-builder.ts` |
| **Server truth** | `invoice_line_items.billing_included` (+ reason columns) |
| **React Query** | `hydrationQuery` with `invoiceKeys.full(invoiceId)` — `staleTime: Infinity`, no refetch on focus |
| **Derived counts** | `excludedTripCount`, `excludedTripsForPdf` — computed on each render / `useMemo` from `lineItems` |

Not used for inclusion: Zustand, URL params, or TanStack cache of trip lists in edit mode.

### 5.2 Initialization when starting edit from branch draft

**Expected path:**

1. `EditInvoicePage` passes `invoiceId` to `InvoiceBuilder`.
2. `useInvoiceBuilder(..., invoiceId)` sets `isEditMode = true`.
3. `hydrationQuery` loads `getInvoiceDetail`.
4. Single `useEffect` seeds `lineItems` / `cancelledTrips` once (`hasHydratedRef`).
5. `tripsQuery` disabled — no overwrite from live trips.

**Suspicious patterns:**

| Pattern | Risk |
|---------|------|
| `hasHydratedRef` not tied to `invoiceId` | Stale state if hook reused across invoices without remount |
| `invoiceKeys.full` shared with detail page | Intentionally separate rules query to avoid cache poisoning — OK |
| Payer `useEffect` in `index.tsx` L386–392 resets PDF profile on `payer_id` change | Payer locked in edit mode — should not fire after hydration |
| No “reset builder state” on `invoiceId` change inside hook | Safe only while page always remounts |

**Verdict:** Selection state is **derived from server snapshot on load**, then **mutated locally**. Inherited `billing_included = false` rows are indistinguishable from user-opted-out rows in the UI.

---

## 6. Safety, invariants, and recommendations

### 6.1 Invariants that should hold but are not fully enforced / communicated

| Invariant | Holds today? |
|-----------|--------------|
| Opted-out count in UI = count of `lineItems` with `billingInclusion.included === false` | **Yes** |
| Opted-out count = “trips user deselected this session” | **No** — includes inherited exclusions |
| Branch draft trip set = only trips that were **billed** on original | **No** — includes appendix excluded rows |
| Branch draft amounts = billed totals only | **Partially** — header totals copied from original (billed); excluded rows still present on lines |
| Edit flow independent of live `trips.status` for opt-out display | **Yes** |
| Storno line items mirror original `billing_included` | **No** — TS payload omits fields; RPC defaults to `TRUE` |
| At most one branch draft per corrected original | **Yes** (DB unique index) |
| `billing_included = false` ⇒ `billing_exclusion_reason IS NOT NULL` (normal trips) | **Yes** (DB CHECK) |
| Cancelled-trip rows in DB always hydrate with correct inclusion | **No** — mapper forces `included: true` |

### 6.2 Senior-level recommendation (narrow the bug, no implementation yet)

**Step 1 — Confirm with data (5 minutes in SQL):**

For the affected branch draft invoice `B`:

```sql
SELECT position, trip_id, billing_included, billing_exclusion_reason, is_cancelled_trip
FROM invoice_line_items
WHERE invoice_id = '<branch-draft-id>'
ORDER BY position;
```

Compare to corrected original `A`. If two rows were already `billing_included = false` before the user’s edit, the behaviour is **by design** of `create_branch_draft_from_invoice`, not a trip-status leak.

**Step 2 — Clarify product rule for branch drafts:**

Decide legally/operationally:

- **Option “billed snapshot”:** Branch should contain only trips that were `billing_included = true` on the original (excluded appendix rows dropped or archived separately).
- **Option “full clone”:** Keep all rows but **label** inherited exclusions in UI (“Von Ursprungsrechnung ausgeschlossen”) vs session changes.

**Step 3 — Fix Storno payload consistency:**

Add `billing_included`, `billing_exclusion_reason`, `is_cancelled_trip`, `cancelled_billing_reason` to `storno.ts` line payload so Storno documents match original inclusion metadata.

**Step 4 — Hardening (if data disproves Cause A):**

- Reset `hasHydratedRef` when `invoiceId` changes.
- Add integration test: branch open → opt out one → `excludedTripCount` increases by exactly 1 from hydration baseline.
- Fix `mapLineItemRowToBuilderCancelledTrip` to respect `row.billing_included`.

---

## Appendix — Key file map

| Area | Files |
|------|-------|
| Branch RPC | `supabase/migrations/20260605120200_create_branch_draft_rpc.sql` |
| Storno RPC | `supabase/migrations/20260411120000_storno_atomic_rpc.sql`, `20260528062000` |
| Billing inclusion schema | `supabase/migrations/20260528062000_invoice_line_items_billing_inclusion.sql` |
| Builder state | `src/features/invoices/hooks/use-invoice-builder.ts` |
| Hydration mapper | `src/features/invoices/utils/map-line-item-row-to-builder-line-item.ts` |
| Inclusion SSOT | `src/features/invoices/lib/billing-inclusion.ts` |
| Step 3 UI | `src/features/invoices/components/invoice-builder/step-3-line-items.tsx` |
| PDF excluded slice | `src/features/invoices/components/invoice-builder/index.tsx` |
| Trip fetch | `src/features/invoices/api/invoice-line-items.api.ts` |
| Edit route guard | `src/app/dashboard/invoices/[id]/edit/page.tsx` |
| Storno client | `src/features/invoices/lib/storno.ts` |
| Module overview | `docs/invoices-module.md` §1.2.1, §1.6 |

---

## Next steps

### Option 1 — Branch draft seeds only billable trips (recommended if users expect a “clean” corrective edit)

**Change:** In `create_branch_draft_from_invoice`, copy only lines where `billing_included = TRUE`, or copy all but set `billing_included = TRUE` for the branch baseline (dropping appendix-only rows from the editable set). Recompute header totals from included lines or keep original billed totals on header.

| Pros | Cons |
|------|------|
| Matches “replace the issued invoice” mental model | Requires legal review: are excluded trips on the original still referenced on the replacement? |
| Opt-out count in new edit session starts at 0 | Migration/RPC change; existing branch drafts unchanged |
| Eliminates inherited “ghost” exclusions | May need to preserve excluded rows elsewhere for audit trail |

### Option 2 — Full clone + explicit UX (lower risk, faster)

**Change:** Keep verbatim copy; improve UI only:

- On branch draft open, show banner: “X Fahrten waren auf der Ursprungsrechnung bereits ausgeschlossen.”
- Differentiate badge: “Ausgeschlossen (Ursprung)” vs “Ausgeschlossen (neu)”.
- Optional: `excludedTripCount` split into `inheritedExcludedCount` vs `sessionExcludedCount`.

| Pros | Cons |
|------|------|
| No change to legal snapshot chain or RPC | Does not reduce line-item clutter |
| Fast to ship; no historical data rewrite | Users must still understand appendix semantics |
| Fixes confusion without guessing billed-only rule | Storno `billing_included` payload gap remains |

**Suggested immediate action:** Run the SQL check on the affected invoice pair. If inherited exclusions explain the count, choose Option 1 vs 2 with product/legal input. If not, prioritize Option 1 investigation plus `hasHydratedRef` / hydration tests.
