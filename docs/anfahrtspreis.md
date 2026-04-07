# Anfahrtspreis (`approach_fee_net`)

Optional flat **net** amount per invoiced trip, configured on Kostenträger pricing rules (`billing_pricing_rules.config.approach_fee_net`). It is added **on top of** the resolved base transport net for a line.

## Resolver behavior

Implementation: `resolveTripPrice` in `src/features/invoices/lib/resolve-trip-price.ts`.

| Situation | `approach_fee_net` on `PriceResolution` |
|-----------|----------------------------------------|
| **KTS** (`kts_override`) | Omitted — line stays €0 |
| **Negotiated `clients.price_tag` wins (P1)** | Omitted — tag gross is all-in |
| **Any other strategy** | Copied from active rule config when set and valid |

`PriceResolution.net` / `gross` always describe **base transport only**; they never include Anfahrt.

## Price math

- **Line net (total):** `(unit_price × quantity) + (approach_fee_net ?? 0)`
- **Line gross (`total_price`):** `line_net × (1 + tax_rate)` — see `insertLineItems` in `src/features/invoices/api/invoice-line-items.api.ts`

Invoice header totals use `calculateInvoiceTotals`, which includes approach per line so subtotal/tax/total match persisted rows.

## Persistence

- `invoice_line_items.approach_fee_net`
- `price_resolution_snapshot.approach_fee_net` (audit)

**Storno:** mirrored lines negate `approach_fee_net` like other money fields (`src/features/invoices/lib/storno.ts`).

## Admin & builder

- **Kostenträger → Preisregel:** optional field „Anfahrtspreis (Netto)“ in `pricing-rule-dialog.tsx`.
- **Rechnung Schritt 3:** when `approach_fee_net > 0`, a small hint under the price shows e.g. `+ €X,XX Anfahrt`.

## PDF

- **Per-line net** for grouping and sums: `lineNetEurForPdfLineItem` — column math only, not `snapshot.net`.
- **Grouped / `single_row` summary:** `buildInvoicePdfSummary` / `buildInvoicePdfSingleRow` expose approach vs transport splits and optional catalog columns — see `src/features/invoices/lib/pdf-column-catalog.ts`.

## Related docs

- [pricing-engine.md](pricing-engine.md) — cascade + Anfahrt section
- [invoices-module.md](invoices-module.md) — Phase 8 PDF summary + `single_row`
