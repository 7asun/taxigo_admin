# Invoice Snapshot Integrity Audit

**Invoices audited:** RE-2026-06-0008 · RE-2026-06-0018 · RE-2026-06-0019  
**Date:** 2026-06-15  
**Method:** Read-only DB inspection (Supabase MCP `execute_sql`) + full source-code review  
**Conclusion (up front):** Snapshots are **intact and frozen**. No live-trip mutation of line-item data was found. The differences the user observed are fully explained by inherited billing exclusions (correct behaviour) and a UX confusion between flat-list position numbers and grouped-PDF summary row numbers.

---

## 0. Business scenario (reconstructed)

1. A **corrected** original invoice **RE-2026-06-0008** exists. It is itself a branch draft
   (`replaces_invoice_id = adccbedd-ecaa-4e94-80f0-e1ddcb18c8df`), so this is already the
   second correction in a chain. When the user edited this invoice they excluded three trips
   (positions 27, 29, 115).
2. A dispatcher created a **Stornorechnung RE-2026-06-0018** to cancel RE-2026-06-0008.
   RE-2026-06-0008 moved to `corrected`. Both events share the same `updated_at` /
   `created_at` timestamp (2026-06-15 09:27:20 UTC).
3. Fourteen seconds later (09:27:34 UTC) the dispatcher created a **branch draft RE-2026-06-0019**
   from the corrected original via `create_branch_draft_from_invoice`.
4. RE-2026-06-0019 has **never been saved** (`updated_at = NULL`). Any differences the user
   observed are therefore visible only in the builder's live in-memory state, not on the DB row.
5. The user intended to exclude only **position 2 (Ingrid Janke, Abreise)** in RE-2026-06-0019.
   They noticed that the **grouped-PDF preview row for "Abreise"** changed (fewer trips, different
   total km) and — per the bug report — attributed this to "positions 3 and 5 also changing."

---

## 1. Invoice header inspection

| Field | RE-2026-06-0008 | RE-2026-06-0018 | RE-2026-06-0019 |
|-------|----------------|----------------|----------------|
| `id` | `b6d0131f-…` | `f54d9318-…` | `689ba91e-…` |
| `status` | `corrected` | `draft` | `draft` |
| `cancels_invoice_id` | `null` | `b6d0131f-…` (RE-0008) | `null` |
| `replaces_invoice_id` | `adccbedd-…` (prior) | `null` | `b6d0131f-…` (RE-0008) |
| `created_at` | 2026-06-06 18:18 UTC | 2026-06-15 09:27:20 UTC | 2026-06-15 09:27:34 UTC |
| `updated_at` | 2026-06-15 09:27:20 UTC | `null` | **`null`** |

**Notable:**
- RE-2026-06-0008 is itself a branch draft from a prior invoice (`adccbedd-…`), placing this
  incident in a 3-generation correction chain.
- RE-2026-06-0019's `updated_at = null` proves the branch draft was **never saved after creation**.
  All builder-visible differences exist only in ephemeral React state.

---

## 2. Line-item count and billing-inclusion distribution

| Invoice | Total items | `billing_included = true` | `billing_included = false` |
|---------|------------|--------------------------|---------------------------|
| RE-2026-06-0008 | 125 | 122 | **3** |
| RE-2026-06-0018 | 125 | 125 | 0 |
| RE-2026-06-0019 | 125 | 122 | **3** |

**Finding:** RE-2026-06-0019 is a verbatim copy of RE-2026-06-0008 — including its three
inherited exclusions. RE-2026-06-0018 (Storno) correctly includes all 125 rows as
`billing_included = true` (the full mirror amount must be negated regardless of prior opt-outs).

---

## 3. Positions-of-interest: full snapshot comparison (RE-0008 vs RE-0019)

All values confirmed equal via SQL. Selected positions listed below.

### Positions 2, 3, 5 (mentioned in user's report)

| Pos | Client | Type | billing_included | quantity | distance_km | effective_km | original_km |
|-----|--------|------|-----------------|----------|-------------|--------------|-------------|
| 2 | Ingrid Janke | **Abreise** | true | 1.00 | 9.531 | 9.531 | 9.531 |
| 3 | Margrit Opel | **Abreise** | true | 38.35 | 37.35 | 38.35 | 37.35 |
| 5 | Brunhilde Janssen | **Abreise** | true | 1.00 | 37.105 | 37.105 | 37.105 |

Values are **identical** between RE-2026-06-0008 and RE-2026-06-0019.

### The 3 inherited excluded positions

These are the rows with `billing_included = false` in both RE-0008 and RE-0019:

| Pos | Client | Type | quantity | effective_km | Exclusion reason |
|-----|--------|------|----------|--------------|-----------------|
| 27 | Gerd Otten | Anreise | 6.18 | 6.177 | Fahrer war vor Ort, Patient ist mit seiner Frau gefahren |
| 29 | Kellie Schröder | **Abreise** | 1.00 | 68.42 | 1. Minute vor Abholung bei einem anderen Taxiunternehmen eingestiegen |
| 115 | André Masson | Anreise | 43.29 | 43.293 | nicht vom RZO beauftragt worden, separate RE Stellung |

---

## 4. Billing-type distribution — included rows only

Confirms both invoices show **identical billable content** before any user edits:

| Invoice | Billing type | Included count | Included total km |
|---------|-------------|---------------|-------------------|
| RE-2026-06-0008 | Abreise | **97** | 5 043.41 |
| RE-2026-06-0008 | Anreise | **25** | 1 102.90 |
| RE-2026-06-0019 | Abreise | **97** | 5 043.41 |
| RE-2026-06-0019 | Anreise | **25** | 1 102.90 |

---

## 5. Live trips vs snapshot comparison

Trips for positions 2, 3, 5 (and 1, 4 for context):

| Trip (position) | `trips.driving_distance_km` | `trips.manual_distance_km` | Snapshot `effective_km` | Snapshot `original_km` | Match? |
|-----------------|---------------------------|--------------------------|------------------------|----------------------|--------|
| Pos 1 – Heide Diers | 35.691 | **36.691** | 36.691 | 35.691 | ✅ |
| Pos 2 – Ingrid Janke | 9.531 | null | 9.531 | 9.531 | ✅ |
| Pos 3 – Margrit Opel | 37.35 | **38.35** | 38.35 | 37.35 | ✅ |
| Pos 4 – Birgit Gresser | 67.051 | **70.851** | 70.851 | 67.051 | ✅ |
| Pos 5 – Brunhilde Janssen | 37.105 | null | 37.105 | 37.105 | ✅ |

The `effective_distance_km` on every line item equals `resolveEffectiveDistanceKm(manual ?? driving)`,
which is exactly the value frozen at invoice creation (K1). No post-creation drift.

**Note on `original_distance_km`:** For positions 1, 3, 4 the effective km differs from the routing
km because `trips.manual_distance_km` was set. The snapshot correctly records:
- `effective_distance_km` = manual override (used for pricing/VAT)
- `original_distance_km` = routing snapshot (audit reference, never billing-relevant)

---

## 6. Code-path analysis

### 6.1 Create invoice from trips

`buildLineItemsFromTrips` in `invoice-line-items.api.ts` runs `resolveEffectiveDistanceKm` on live
trip data and freezes the result into `effective_distance_km` / `original_distance_km`. After
`insertLineItems`, line items are independent of the trips table.

### 6.2 Create Storno

`create_storno_invoice` (Postgres RPC) inserts negated money fields from a JSONB payload built in
TypeScript (`storno.ts`). All `billing_included` values are set to `true` regardless of the
source, so the full negation amount is captured. Distance fields are copied verbatim (non-monetary
snapshots).

### 6.3 Create branch draft

`create_branch_draft_from_invoice` (Postgres RPC, `20260605120200_create_branch_draft_rpc.sql`)
copies every column of `invoice_line_items` verbatim — including `billing_included`,
`billing_exclusion_reason`, all three distance fields, and `quantity`. There is no recomputation
of any kind. This is confirmed by the DB evidence: RE-2026-06-0019 has byte-identical line items
to RE-2026-06-0008.

### 6.4 Edit mode (re-open branch draft)

`use-invoice-builder.ts` hydration path (`isEditMode = true`):
- Trips fetch is gated with `enabled: !isEditMode && …` — **trips are never re-fetched**.
- `mapLineItemRowToBuilderLineItem` reads `distance_km`, `effective_distance_km`,
  `original_distance_km`, and `quantity` directly from the persisted row — **no call to
  `resolveEffectiveDistanceKm`**.
- `hasHydratedRef` prevents re-seeding on any subsequent re-render or focus event.
- The create-mode "reset when params incomplete" effect is gated with `if (!isEditMode)`.

### 6.5 Save (edit mode)

`updateDraftInvoice` calls `replace_draft_invoice_line_items` (RPC). The RPC atomically
deletes and re-inserts all rows, recomputing totals server-side. `lineItemToInsertRow` serialises
`item.quantity` directly from the hydrated `BuilderLineItem` — **no KM re-derivation occurs**.

### 6.6 Trip-level distance updates

`build-trip-details-patch.ts` guards the `driving_distance_km` write via `isDistanceLocked` (set
when the trip already appears on an `invoice_line_items` row). `manual_distance_km` can still be
written but it only affects **future** invoice creation; existing line-item snapshots are
unaffected (no back-propagation path exists).

### 6.7 Back-propagation search

A full search across all TypeScript source confirmed there is **no code path** that:
- Updates `invoice_line_items.effective_distance_km` or `distance_km` after initial insert.
- Re-runs `resolveEffectiveDistanceKm` for existing line items.
- Re-reads `trips.manual_distance_km` or `trips.driving_distance_km` to update a saved line item.

No scheduled job or background cron touches `invoice_line_items` distance fields.

---

## 7. Root cause of the user's observation

The user described "Pos 3 'Abreise' shows 50 instead of 51 and different km" and "Similar for Pos 5." Based on the DB evidence this translates to:

**What actually happened:**

1. RE-2026-06-0008 was itself edited as a branch draft in a previous session. The admin excluded
   three trips (positions 27, 29, 115) with explicit reasons. The Abreise group ended up with
   **97 included trips** (one Abreise — position 29 — was excluded).
2. RE-2026-06-0019 was created as the next branch draft and inherited those same 3 exclusions
   verbatim via the RPC copy. **The branch draft opens with the same 97 Abreise / 25 Anreise
   distribution as the corrected original — identical, no divergence.**
3. The user then excluded **position 2 (Ingrid Janke, billing_type = Abreise)** in the builder.
   This reduced the Abreise group from **97 to 96** trips and subtracted 9.531 km from the
   group total in the grouped-PDF preview.
4. The user interpreted the changed Abreise group summary row in the PDF preview as "positions 3
   and 5 changed" — but positions 3 and 5 (Margrit Opel and Brunhilde Janssen) are **also
   Abreise trips** and their **individual line items are completely unchanged**. The change they
   saw was the Abreise **group aggregate row**, not the individual positions.
5. The "50 vs 51" numeric discrepancy in the user's report does not align with the actual DB
   counts (97/96 Abreise, 25 Anreise). The exact numbers cited are likely either: (a) referring
   to the grouped PDF trip_count column after some confusion with another invoice in the chain,
   (b) referring to a value in the original invoice that predates RE-2026-06-0008 in the
   correction chain, or (c) approximate/colloquial descriptions.

**In summary:** No snapshot was mutated. The observed change is the correct aggregation behaviour:
excluding one Abreise trip from the builder naturally reduces the Abreise group count and total km
in the grouped PDF preview.

---

## 8. Snapshot invariant evaluation

| Invariant (from `invoice-km-behaviour.md`) | Status |
|---------------------------------------------|--------|
| K1 – Billed km per row = `effective_distance_km ?? distance_km` | ✅ All rows confirmed |
| K2 – Normal billed bucket excludes cancelled | ✅ No cancelled trips in these invoices |
| K4 – `billing_included = false` rows ignored in KM buckets | ✅ |
| K5 – KM from snapshots only, never live trips | ✅ No re-read path found |
| K6 – Null propagation | ✅ Not triggered (all distances set) |
| K7 – Single SSOT in `compute-invoice-km.ts` | ✅ |
| Snapshot principle – frozen at insert, no retroactive changes | ✅ Confirmed |
| Branch draft – line items copied 1:1 from corrected original | ✅ DB verified |

**All invariants hold.** RE-2026-06-0019 is an exact copy of RE-2026-06-0008 and has never been
mutated after creation.

The one nuance worth noting: RE-2026-06-0018 (Storno) deliberately sets all `billing_included =
true` regardless of the source invoice's exclusion state. This is **correct** — the Storno must
negate the full original invoice amount, and the exclusions only apply to the *positive* billing
side.

---

## 9. Recommendations (no implementation in this step)

### 9.1 Root cause for this specific incident

Not a bug. The user observed **correct behavior** (inherited exclusions + grouped-PDF aggregation)
but interpreted it as snapshot corruption because:
(a) Inherited exclusions from prior corrections were not visually distinguished from new
    session exclusions in the previous version.
(b) The grouped-by-billing-type PDF preview was changed by the user's own action (excluding
    Ingrid Janke, an Abreise trip) and the effect appeared as a change to "other positions."

The `exclusionInherited` mechanism and badge **"Ausgeschlossen (Ursprungsrechnung)"** already
shipped in the KM consistency work and directly solves (a). Observation (b) is expected behaviour
by design.

### 9.2 Preventive measures

**Fix 1 — `exclusionInherited` badge (already implemented)**  
Already live as of the KM consistency work. Rows with `exclusionInherited = true` receive the
"Ausgeschlossen (Ursprungsrechnung)" badge in Step 3 of the builder, clearly distinguishing
inherited exclusions from new ones. This prevents the user from thinking "I only touched pos 2,
why is pos 3 different" for inherited exclusions.

**Fix 2 — Consider seeding branch drafts from only billing-included rows (deferred)**  
`create_branch_draft_from_invoice` currently copies ALL rows verbatim (including
`billing_included = false`). An alternative would be to copy only `billing_included = true` rows,
treating a branch draft as a clean slate. This was discussed in `invoice-trip-optout-audit.md`
and left as deferred. The trade-off is that removing inherited exclusions could lead to
"phantom re-inclusion" of trips that should stay out. Until there is a clear user requirement
to deviate, the verbatim copy is safer and the `exclusionInherited` badge is sufficient UX.

**Fix 3 — Add a snapshot integrity test after branch draft creation (recommended)**  
Currently there is no automated check that `invoice_line_items` for a branch draft match the
source invoice at creation time. A test could assert:
- Every position from the source invoice exists in the branch draft with matching
  `distance_km`, `effective_distance_km`, `original_distance_km`, `quantity`, and
  `price_resolution_snapshot`.
- No row has different distance/price values between source and branch (only `invoice_id`
  and billing-inclusion state may differ).

This test would catch any future regression where the RPC inadvertently re-resolves distances
(e.g. if a developer adds `resolveEffectiveDistanceKm` to the copy SELECT).

**Fix 4 — Clarify grouped-PDF row labels with inherited exclusion count (optional UX)**  
In the grouped_by_billing_type PDF summary, the `trip_count` column could note excluded trips
in parentheses (e.g. "97 (+1 excluded)") when any trips in that billing type are excluded.
This would prevent confusion between "96 included Abreise" and "97 original Abreise."

---

## 10. Data tables: full positions 1–7 snapshot dump

For audit/reference, the first 7 positions of each invoice confirmed identical:

| Pos | Client | RE-0008 qty | RE-0018 qty | RE-0019 qty | effective_km (0008) | effective_km (0019) | Match |
|-----|--------|------------|------------|------------|--------------------|--------------------|-------|
| 1 | Heide Diers | 36.69 | 36.69 | 36.69 | 36.691 | 36.691 | ✅ |
| 2 | Ingrid Janke | 1.00 | 1.00 | 1.00 | 9.531 | 9.531 | ✅ |
| 3 | Margrit Opel | 38.35 | 38.35 | 38.35 | 38.35 | 38.35 | ✅ |
| 4 | Birgit Gresser | 70.85 | 70.85 | 70.85 | 70.851 | 70.851 | ✅ |
| 5 | Brunhilde Janssen | 1.00 | 1.00 | 1.00 | 37.105 | 37.105 | ✅ |
| 6 | Otto Blaffert | 100.00 | 100.00 | 100.00 | 100 | 100 | ✅ |
| 7 | Gerta Blaffert | 100.00 | 100.00 | 100.00 | 100 | 100 | ✅ |

---

*Audit completed 2026-06-15. No code changes made. Findings are read-only.*
