# Invoice KM behaviour — invariants

This document summarises the KM (kilometre) invariants derived from the audit in
[`docs/plans/invoice-km-mismatch-audit.md`](plans/invoice-km-mismatch-audit.md).
All code that computes or displays KM on invoices must satisfy these invariants.

---

## Invariants

### K1 — Billed km per row

**Billed km for a single line item = `effective_distance_km ?? distance_km`.**

`effective_distance_km` is the override-resolved value (manual admin km → client catalog → routing) used for pricing and VAT. It is always the "what we billed for" value.
`distance_km` is the routing snapshot used only as a legacy fallback (rows saved before `effective_distance_km` was tracked).

Implementation: `computeInvoiceLineKm(item)` in
[`src/features/invoices/lib/compute-invoice-km.ts`](../src/features/invoices/lib/compute-invoice-km.ts).

---

### K2 — Normal-billed bucket

**Gesamtstrecke = sum of `computeInvoiceLineKm` for rows where `billing_included = true` AND `is_cancelled_trip` is not true.**

Opted-out rows (`billing_included = false`) must never contribute to Gesamtstrecke.
Cancelled trips must not be merged into Gesamtstrecke even when they are opted in (K3).

---

### K3 — Cancelled-billed bucket

**Cancelled-billed km = sum of `computeInvoiceLineKm` for rows where `billing_included = true` AND `is_cancelled_trip = true`.**

These are trips that drove but were billed at €0 (Storniert). Their distance is reported
separately so it never inflates Gesamtstrecke. The bucket is exposed on the PDF cover via
the Step 4 toggle `show_cancelled_billed_km_on_cover` and always on the detail page.

---

### K4 — Excluded rows are ignored

**`billing_included = false` rows must not contribute to either KM bucket.**

Opted-out rows are kept in `invoice_line_items` for audit but must have zero effect on
all displayed totals.

---

### K5 — Snapshot-only km

**After invoice creation, KM is always derived from `invoice_line_items` snapshot columns. Never from live `trips` queries.**

`trip_id` on line items is informational only; it must not be used to JOIN back to `trips`
for KM display.

---

### K6 — Null propagation per bucket

**If any contributing row in a bucket has `null` billed km (i.e. both `effective_distance_km` and `distance_km` are null), the whole bucket returns `null` rather than a partial sum.**

`null` renders as `—` in all UI surfaces (PDF cover, detail page). A partial sum would be
misleading because the actual total is unknown.

---

### K7 — Single SSOT for KM logic

**The only permitted implementation of K1–K6 is `computeInvoiceKmBuckets` / `computeInvoiceCoverKm` / `computeInvoiceLineKm` from `src/features/invoices/lib/compute-invoice-km.ts`.**

Do not write `effective_distance_km ?? distance_km` outside that module. Do not duplicate
`billing_included !== false` or `is_cancelled_trip` checks for KM aggregation.

---

## KM display surfaces

| Surface | Source | Notes |
|---------|--------|-------|
| PDF cover Gesamtstrecke | `computeInvoiceCoverKm(invoice.line_items).normalBilledKm` | **Optional** — only rendered when `show_normal_billed_km_on_cover` on. Default off. |
| PDF cover stornierte Fahrten | `computeInvoiceCoverKm(invoice.line_items).cancelledBilledKm` | Only when `show_cancelled_billed_km_on_cover` on |
| PDF main table `total_km` column | `computeInvoiceLineKm` via `build-invoice-pdf-summary.ts` | Per-group partial; filtered through `mainCoverLineItems` by caller |
| Detail page KM column | `computeInvoiceLineKm(item)` | Billed km (was: `distance_km` only — routing) |
| Detail page KM summary | `computeInvoiceCoverKm(invoice.line_items)` | Always shows both buckets, not gated by toggle — audit surface |
| Builder Step 3 | `effective_distance_km` (editable) + `distance_km` (read-only routing reference) | Live values; not yet snapshotted |

---

## Toggle: `show_normal_billed_km_on_cover`

Added as a follow-up to the KM consistency work (2026-06). Stored in `invoices.pdf_column_override`.

- Default: `false` — PDF cover shows **no** Gesamtstrecke line for existing or new invoices unless explicitly turned on.
- When `true`: the cover renders the "Gesamtstrecke" line using `normalBilledKm` from `computeInvoiceCoverKm`.
- Even when hidden on the PDF cover, `normalBilledKm` is still computed and visible on the detail page KM summary (audit surface).
- Display-only; no effect on tax snapshots, money totals, or appendix listings.

---

## Toggle: `show_cancelled_billed_km_on_cover`

Added in Step 4 of the KM consistency work (2026-06). Stored in `invoices.pdf_column_override`.

- Default: `false` (admin opts in per invoice).
- When `true`: the cover page always renders the second KM line, even when `cancelledBilledKm === 0`.
- When `null` bucket: the line still renders (toggle is on); value shows `—`.
- Does not affect tax snapshots, money totals, or appendix listings (`show_cancelled_trips` is a separate, unrelated toggle).
- Independent of `show_normal_billed_km_on_cover` — either line can be shown or hidden without affecting the other.

---

## Branch draft inherited exclusions

Branch drafts created via `create_branch_draft_from_invoice` copy all line items verbatim, including `billing_included = false` rows. The builder detects these inherited exclusions by comparing the branch draft's line items against the original invoice's `billing_included` state (fetched once per session and cached). Rows that were already excluded on the original receive the `exclusionInherited: true` builder-only flag, shown as the badge **"Ausgeschlossen (Ursprungsrechnung)"** in Step 3.

This flag is never persisted to the database and has no effect on KM computations (K4 applies regardless).

---

*Last updated: 2026-06 (KM consistency follow-up — `show_normal_billed_km_on_cover` toggle).*
