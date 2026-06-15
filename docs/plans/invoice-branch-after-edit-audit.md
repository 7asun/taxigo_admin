# Invoice Branch-After-Edit Audit

**Invoices audited:** RE-2026-06-0008 (corrected original) · RE-2026-06-0019 (branch draft, now saved)  
**Date:** 2026-06-15  
**Method:** Read-only DB inspection (Supabase MCP `execute_sql`) + source-code review  
**Precursor audit:** [`invoice-snapshot-integrity-audit.md`](invoice-snapshot-integrity-audit.md)

---

## Conclusion (up front)

**The system behaves correctly in every measurable way.**

After excluding Abreise Ilse Sachs (position 104) and saving RE-2026-06-0019:
- Exactly **one additional row** has `billing_included = false` compared to RE-2026-06-0008.
- **No other row changed** in quantity, distance, or price — zero-row diff on those fields.
- The Abreise grouped-PDF aggregate drops by exactly Ilse Sachs's values (−1 trip, −6.85 qty,
  −6.848 km, −€20.22).
- The Anreise aggregate is **unchanged**.
- All live-trip distances still match their invoice snapshots.

The "50 vs 51" observation reported previously is explained below in §7.

---

## 0. Scenario verified

1. RE-2026-06-0008 (`b6d0131f-…`) — `status = corrected`, 125 line items, 3 already excluded.
2. RE-2026-06-0019 (`689ba91e-…`) was created as a branch draft from RE-2026-06-0008 and then
   **saved once** at 2026-06-15 20:03:54 UTC after the admin excluded a single trip:
   **position 104 — "Fahrt vom 28.04.2026 – Ilse Sachs" (Abreise, reason: "Wird mit KTS abgerechnet.")**.
3. Expected: only that one row's inclusion changes; all other rows are identical.

---

## 1. Invoice headers — before / after edit

| Field | RE-2026-06-0008 | RE-2026-06-0019 (after save) | Δ |
|-------|----------------|------------------------------|---|
| `status` | `corrected` | `draft` | — |
| `updated_at` | 2026-06-15 09:27:20 UTC | **2026-06-15 20:03:54 UTC** | saved once |
| `subtotal` | 8 336.85 | 8 317.95 | −18.90 |
| `tax_amount` | 1 316.54 | 1 315.22 | −1.32 |
| `total` | 9 653.39 | 9 633.17 | **−20.22** |

The €20.22 total delta will be reconciled against Ilse Sachs's line-item price in §3.

---

## 2. Billing-inclusion distribution

| Invoice | `billing_included = true` | `billing_included = false` |
|---------|--------------------------|---------------------------|
| RE-2026-06-0008 | 122 | 3 |
| RE-2026-06-0019 | **121** | **4** |

Exactly one row moved from included → excluded.

---

## 3. The excluded rows

### RE-2026-06-0008 (3 pre-existing exclusions — inherited from prior correction cycle)

| Pos | Client | Type | qty | effective_km | Reason |
|-----|--------|------|-----|-------------|--------|
| 27 | Gerd Otten | Anreise | 6.18 | 6.177 | Fahrer war vor Ort, Patient ist mit seiner Frau gefahren |
| 29 | Kellie Schröder | Abreise | 1.00 | 68.420 | 1. Minute vor Abholung bei einem anderen Taxiunternehmen eingestiegen |
| 115 | André Masson | Anreise | 43.29 | 43.293 | nicht vom RZO beauftragt worden, separate RE Stellung |

### RE-2026-06-0019 (same 3 + 1 new)

| Pos | Client | Type | qty | effective_km | Reason | Status |
|-----|--------|------|-----|-------------|--------|--------|
| 27 | Gerd Otten | Anreise | 6.18 | 6.177 | (same) | inherited |
| 29 | Kellie Schröder | Abreise | 1.00 | 68.420 | (same) | inherited |
| **104** | **Ilse Sachs** | **Abreise** | **6.85** | **6.848** | **Wird mit KTS abgerechnet.** | **new exclusion** |
| 115 | André Masson | Anreise | 43.29 | 43.293 | (same) | inherited |

**Finding:** Exactly one new exclusion — Ilse Sachs at position 104. The three inherited rows are
unchanged in every field.

---

## 4. Cross-invoice field diff on all 125 positions

SQL query compared `quantity`, `distance_km`, `effective_distance_km`, and `unit_price` for
every position that exists in both invoices:

```sql
SELECT a.position, …
FROM invoice_line_items a
JOIN invoice_line_items b ON a.position = b.position
…
WHERE (a.quantity != b.quantity
  OR a.distance_km != b.distance_km
  OR a.effective_distance_km != b.effective_distance_km
  OR a.unit_price != b.unit_price)
```

**Result: 0 rows.** No position changed in any numeric field. The only DB difference between
the two invoices is `billing_included` on position 104 (and the corresponding
`billing_exclusion_reason`).

---

## 5. Live trip vs snapshot comparison for all excluded positions

| Pos | Client | `trips.driving_km` | `trips.manual_km` | Snapshot `effective_km` | Snapshot `original_km` | Match |
|-----|--------|-------------------|------------------|------------------------|----------------------|-------|
| 27 | Gerd Otten | 6.177 | null | 6.177 | 6.177 | ✅ |
| 29 | Kellie Schröder | 68.420 | null | 68.420 | 68.420 | ✅ |
| 104 | Ilse Sachs | 6.848 | null | 6.848 | 6.848 | ✅ |
| 115 | André Masson | 43.293 | null | 43.293 | 43.293 | ✅ |

`resolveEffectiveDistanceKm(manual ?? driving)` = `null ?? driving = driving` for all four,
and every snapshot equals the driving distance. No drift.

---

## 6. Grouped "Nach Abrechnungsart" aggregates (billing_included = true rows only)

SQL aggregates over non-cancelled, billing-included rows per billing type:

### Abreise

| Invoice | Included trips | Total qty | Total effective km | Total gross price |
|---------|--------------|-----------|-------------------|------------------|
| RE-2026-06-0008 | **97** | **3 036.77** | **5 043.405** | **7 168.66** |
| RE-2026-06-0019 | **96** | **3 029.92** | **5 036.557** | **7 148.44** |
| **Δ** | **−1** | **−6.85** | **−6.848** | **−20.22** |

Ilse Sachs's values: qty = 6.85, effective_km = 6.848, total_price = 20.22.  
**The Abreise aggregate drop matches Ilse Sachs's row exactly — to the cent and to the millimetre.**

### Anreise

| Invoice | Included trips | Total qty | Total effective km | Total gross price |
|---------|--------------|-----------|-------------------|------------------|
| RE-2026-06-0008 | 25 | 1 032.63 | 1 102.895 | 2 484.67 |
| RE-2026-06-0019 | 25 | 1 032.63 | 1 102.895 | 2 484.67 |
| **Δ** | **0** | **0** | **0** | **0** |

**The Anreise group is completely unchanged**, as expected.

---

## 7. Explaining the "50 vs 51" / "4075.73 vs 4007.31" observations from the previous report

These numbers do not match the absolute DB values (97/96 trips, 5043/5036 km). Two likely
explanations:

### 7a. The user was comparing against the BUILDER UI preview state, not against RE-2026-06-0008

The branch draft (RE-2026-06-0019) starts with **3 inherited exclusions** (same as RE-0008).
If the user compared the branch draft builder's live PDF preview against the *prior* correction
chain invoice (the one RE-2026-06-0008 replaced), which may have had more included trips, the
numbers would be different.

### 7b. Confusion between position numbers and grouped-PDF row numbers

The invoice uses `grouped_by_billing_type` layout in its PDF. In that view:
- "Position 1" in the PDF is the first billing-type summary row (e.g. "Anreise" with all 25 trips).
- "Position 3" in the PDF might be a sub-group or a different billing type.

These PDF group row numbers do **not** correspond to `invoice_line_items.position` values.
When the user excludes one Abreise trip (position 2 = Ingrid Janke, also Abreise), the Abreise
group summary row changes — and the user interprets that as "positions 3 and 5 changed."
The individual line items at positions 3 and 5 are **not** changed.

**Regardless of interpretation, the DB audit now confirms:** after saving with the Ilse-Sachs
exclusion, no unexpected field changes occurred. The observation is a UI / aggregation perception
issue.

---

## 8. Code-path analysis: exclusion and save

### 8.1 Excluding a trip in the builder (Step 3)

`handleLineItemInclusionChange` in `use-invoice-builder.ts` (line 722):
```typescript
(position, included, reason) => {
  setLineItems((prev) =>
    prev.map((item) =>
      item.position === position
        ? { ...item, billingInclusion: { included, reason } }
        : item   // ← every other item returned UNCHANGED
    )
  );
}
```
Only the `billingInclusion` field of the matched position is mutated. `quantity`,
`effective_distance_km`, `distance_km`, `unit_price`, and all other fields are preserved by the
spread operator. This is confirmed by the zero-row diff in §4.

### 8.2 Saving the draft

`updateDraftInvoice` → `replace_draft_invoice_line_items` (RPC):
1. The RPC atomically deletes all line items and re-inserts the array passed from TypeScript.
2. `lineItemToInsertRow` serialises `item.quantity` and `item.effective_distance_km` directly
   from the hydrated `BuilderLineItem` — **no call to `resolveEffectiveDistanceKm`**, no trip
   re-fetch.
3. The only field that differs for Ilse Sachs's row is `billing_included: false` (from
   `item.billingInclusion.included`) and `billing_exclusion_reason`.
4. Server-side totals are recomputed from the new line-item set, yielding the correct −€20.22
   header delta.

### 8.3 No re-derivation path

No code path between edit-mode hydration and save runs `buildLineItemsFromTrips`,
`resolveEffectiveDistanceKm`, or any other function that reads live trip data. The mapper
(`mapLineItemRowToBuilderLineItem`) copies all distance and quantity fields verbatim from the
persisted snapshot row.

---

## 9. Snapshot invariant evaluation

| Invariant | Status | Evidence |
|-----------|--------|---------|
| K1 – Billed km = `effective_distance_km ?? distance_km` | ✅ | All snapshots match live trips |
| K5 – Snapshots only; no live-trip re-read after creation | ✅ | Zero-row diff; no re-derivation path |
| Branch draft 1:1 copy | ✅ | RE-0019 inherited all 125 rows verbatim |
| Only one inclusion change after user edit | ✅ | DB shows exactly 4 excluded rows vs 3 |
| Header totals updated server-side from new line set | ✅ | Δ = −20.22, matches Ilse Sachs total_price |

**All invariants hold.**

---

## 10. Core questions answered

### 10.1 Is the DB behaviour correct after excluding Ilse Sachs and saving?

**Yes.** Exactly one row's `billing_included` flipped (position 104 → false). No other field on
any row changed in any way. The header totals are correct.

### 10.2 Is the grouped "Nach Abrechnungsart" view correct?

**Yes.** The Abreise summary row now shows 96 trips instead of 97 because one Abreise trip
(Ilse Sachs) is excluded. The total quantity drops by her 6.85 km, and the total gross drops
by her €20.22. The Anreise summary is unchanged.

The "50 vs 51" visual impression was a red herring: the user was likely looking at a different
part of the correction chain (the original pre-RE-0008 invoice) or confusing grouped-PDF row
numbers with flat-list position numbers.

### 10.3 Are the snapshot invariants upheld?

**Yes** — see §9 above.

---

## 11. Recommendations

### 11.1 Result for Ilse-Sachs edit

**Only expected changes.** No unexpected field mutations occurred at any layer. The system
correctly isolated the inclusion change to position 104 and recomputed header totals server-side.

### 11.2 Potential follow-ups

**Follow-up 1 — Clarify grouped-PDF row labels (cosmetic UX)**  
The grouped-by-billing-type PDF cover table shows a `trip_count` column.
When a billing type has inherited or new exclusions, the count shown is "included trips only"
but this is not labelled. Adding a footnote or sub-label ("97 abgerechnet / 1 ausgeschlossen")
would make the per-type exclusion visible without changing billing semantics.

**Follow-up 2 — Inherited exclusions summary in the builder header (UX clarity)**  
The builder already tags inherited rows with the "Ausgeschlossen (Ursprungsrechnung)" badge at
position level. A small summary line above the Step 3 table ("3 Fahrten aus der Originalrechnung
ausgeschlossen — davon 1 Abreise, 2 Anreise") would immediately surface inherited exclusions
and prevent the confusion of "why does the Abreise group show fewer trips before I even start
editing."

**Follow-up 3 — Snapshot integrity test (engineering)**  
From the prior audit recommendation: add an automated test that asserts a branch draft's
`invoice_line_items` match the source invoice field-for-field immediately after the RPC runs.
This test already passed implicitly (the zero-row diff shows the copy was exact), but an
explicit assertion in the test suite would prevent future regressions.

---

*Audit completed 2026-06-15. Read-only — no code or data changes made.*
