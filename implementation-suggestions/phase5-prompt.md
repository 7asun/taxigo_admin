# Phase 5 — PDF Enhancement + Live Preview

Phase 4 is complete and verified. Please proceed with **Phase 5 — PDF Enhancement + Live Preview** exactly as specified below.

---

## Before writing any code

1. Confirm `bun run build` is currently passing (including the Thing 1 price calculation bug fix).
2. Read `docs/rechnungsempfaenger.md` → "PDF layout" section — the dual-block vs snapshot-only recipient rule is the most important constraint in this phase.
3. Read `src/features/invoices/components/invoice-pdf/InvoicePdfDocument.tsx` and `invoice-pdf-cover-header.tsx` in full before touching either file.
4. Confirm `@react-pdf/renderer` version and whether `usePDF()` hook is available in the installed version. If not available, note the fallback approach before proceeding.

---

## Step 1 — PDF recipient block (complete the original Phase 5 spec)

Update `InvoicePdfDocument.tsx` and `invoice-pdf-cover-header.tsx` to implement the mode-based recipient layout using `invoices.rechnungsempfaenger_snapshot`.

**Rule (locked — from docs/rechnungsempfaenger.md):**

- **`per_client` mode:** Client remains the primary window addressee and salutation block (`Sehr geehrter Herr/Frau XY`). A second labeled block appears below: `„Rechnungsempfänger / Zahlungspflichtiger"` showing the frozen snapshot name + full address.
- **`monthly` / `single_trip` mode:** `rechnungsempfaenger_snapshot` is the **sole** legal addressee block. No client header. If snapshot is null (legacy invoice before Phase 1), fall back to payer address fields (`payers.name`, `payers.street`, `payers.street_number`, `payers.zip_code`, `payers.city`) — log a console warning for the missing snapshot.

Add inline comment at both layout branches:
```typescript
// §14 UStG: use frozen snapshot — never read live payer/client data for legal addressee
```

---

## Step 2 — PDF line item columns (complete and correct)

Update the PDF line item table to render the correct columns with correct data. The column set for Phase 5 is **fixed** (not yet configurable — that is Phase 6). Every column must be present and correct:

| Column | Label | Source | Notes |
|--------|-------|--------|-------|
| `date` | Datum | `trips.scheduled_at` | Format: `dd.MM.yyyy` (de-DE) |
| `client` | Fahrgast | `clients.name` (from snapshot) | Full name |
| `from` | Von | `trips.pickup_address` | Truncate at 35 chars if needed |
| `to` | Nach | `trips.dropoff_address` | Truncate at 35 chars if needed |
| `km` | Strecke | `trips.driving_distance_km` | Format: `{n} km` — show only if set |
| `price_net` | Netto | `invoice_line_items.unit_price_net` | `Intl.NumberFormat de-DE EUR` |
| `tax` | MwSt. | `invoice_line_items.tax_rate` | Format: `7 %` or `19 %` |
| `price_gross` | Brutto | calculated: `net * (1 + tax_rate)` | `Intl.NumberFormat de-DE EUR` |
| `kts` | KTS | `invoice_line_items.kts_override` | Show `✓` if true, empty if false |
| `driver` | Fahrer | `trips.driver_name` (from snapshot) | Show only if set |
| `direction` | Hin/Rück | `trips.direction` | `Hin` / `Rück` / empty |

**KTS line items:** price columns show `€0,00` with a subtle gray text style + `„Abgerechnet über KTS"` in a note column or as a row-level note below the line.

**Column widths:** ensure the table fits on A4 (595pt wide, ~30pt margins each side = ~535pt usable). Adjust proportionally — address columns (`Von`, `Nach`) get more width, `KTS` and `MwSt.` get minimal width.

---

## Step 3 — Live debounced PDF preview in Step 4

Add a live PDF preview panel to Step 4 of the invoice builder.

**Technical approach:**
- Use `usePDF()` hook from `@react-pdf/renderer` to generate a blob URL in the browser
- Debounce re-generation at **600ms** after any input change in Step 4 (recipient override, payment days, template text)
- Display the blob URL in an `<iframe>` or `<embed>` alongside the Step 4 form
- Use the existing TanStack Query pattern for data freshness — the preview reads from the builder's in-memory state, not from the DB, so no new query keys are needed

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  Step 4                                              │
│  ┌─────────────────────┐  ┌───────────────────────┐ │
│  │  Confirmation form  │  │   Live PDF Preview    │ │
│  │  (existing UI)      │  │   <iframe / embed>    │ │
│  │                     │  │   debounced 600ms     │ │
│  │  Empfänger block    │  │                       │ │
│  │  Zahlungsziel       │  │   "Vorschau wird      │ │
│  │  Textbausteine      │  │    geladen..."        │ │
│  └─────────────────────┘  └───────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

- On mobile / narrow screens: preview collapses to a `„Vorschau anzeigen"` toggle button that opens the PDF in a sheet/modal
- Show a subtle loading indicator while the PDF is generating (between debounce trigger and blob URL ready)
- Loading state copy: `„Vorschau wird aktualisiert…"`
- If `usePDF()` is not available in the installed version: use `PDFDownloadLink` with a manual `„Vorschau aktualisieren"` button as fallback — document this clearly

**The preview must render:**
- Correct recipient (live — updates when dispatcher changes override in Step 4)
- All line items from Step 3 (passed through builder state)
- KTS line items showing €0 + note
- Correct totals (Netto, MwSt., Brutto)
- Invoice number placeholder: `„RE-{year}-{month}-XXXX"` (sequential number not yet assigned)

---

## Step 4 — `buildInvoicePdfSummary` — verify route canonicalization still works

After the column changes, verify that `buildInvoicePdfSummary` (which joins trips with identical canonical places) still produces correct groupings with the new column set. If the summary logic needs updating to account for the new fields, fix it. Do not break existing invoices.

---

## Standards to maintain

- All date formatting uses `date-fns/format` with `dd.MM.yyyy` — not `toLocaleDateString`
- All monetary formatting uses `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })`
- PDF renders correctly on A4 — test with a batch of 10+ line items to confirm page breaks work
- `@react-pdf/renderer` styles use `StyleSheet.create()` — no inline style objects
- Inline comment at every `§14 UStG` snapshot read in the PDF renderer
- Existing invoice PDFs (before Phase 1 migrations) must render without crashing — null-safe snapshot reads everywhere

---

## Out of scope for Phase 5

- Configurable PDF columns (Phase 6)
- Per-payer column configuration UI
- Any new DB migrations

---

## Completion deliverable

Confirm Phase 5 with:
1. Files created
2. Files modified
3. Confirmation of `usePDF()` availability and approach used (or fallback if not available)
4. Screenshot description of the Step 4 layout at desktop width
5. Confirmation that legacy invoices (null snapshot) render without crashing
6. `bun run build` passed
