# Payer revision-flag UI — audit

**Status: IMPLEMENTED (2026-05-29)**

Step 4 of the draft invoice editing feature. Steps 1–3 shipped the DB column
(`payers.revision_invoices_enabled`), the `replace_draft_invoice_line_items`
RPC, the ENTWURF watermark, the inverse mapper, builder hydration, the save
path (`updateDraftInvoice`), the edit route, and the detail-page "Bearbeiten"
entry point. The only remaining gap was that admins had no UI to toggle the
per-payer flag — they would have needed raw SQL. This step adds that toggle.

## Problem

`payers.revision_invoices_enabled` is read by the invoice side (the
`getInvoiceDetail` payer join gates both the "Bearbeiten" button and the
edit-route server guard), but nothing in the admin UI could set it.

## Implementation

Mirrors the existing per-payer boolean toggles (`manual_km_enabled`,
`reha_schein_enabled`) exactly — no new patterns, no migration (the column has
existed since Step 1), no RLS change (the `payers_company_admin` policy is a
blanket admin `FOR ALL`, so no column-level restriction).

| # | File | Change |
|---|------|--------|
| 1 | [`payer.types.ts`](../../src/features/payers/types/payer.types.ts) | Added `revision_invoices_enabled: boolean` to the `Payer` type (after `reha_schein_enabled`), non-nullable to match the DB column. |
| 2 | [`payers.service.ts`](../../src/features/payers/api/payers.service.ts) | Appended `revision_invoices_enabled` to the `getPayers()` select string (without it the Switch always reads `false`). |
| 3 | [`payers.service.ts`](../../src/features/payers/api/payers.service.ts) | Added `updatePayerRevisionInvoicesEnabled(payerId, enabled, supabase)` — single-column `.update().eq('id', payerId)`, same error handling as the two existing updaters. |
| 4 | [`payer-details-sheet.tsx`](../../src/features/payers/components/payer-details-sheet.tsx) | Added `revisionInvoicesToggleBusy` state, `handleRevisionInvoicesEnabledChange` handler (invalidates `[PAYERS_QUERY_KEY]` + `referenceKeys.payers()`, toasts `Einstellung gespeichert` / `Speichern fehlgeschlagen`), and a `bg-card` Switch block ("Rechnungsentwurf bearbeiten") immediately after the reha block. Auto-saves on flip. |

## Hard rules honored

- `updatePayer` / `usePayers` / the hook mutation path untouched — the toggle uses
  the dedicated single-column updater, like reha/manual-km.
- No invoice-side code touched — the flag is still read via the Step 3
  `getInvoiceDetail` join.
- No migration (column exists since Step 1); no RLS change.
- Create flow and non-draft invoice behaviour unchanged.
- No magic strings — reused the exact toast messages and invalidation keys of the
  existing boolean toggles.

## Gates

- `bun run build` — green.
- `bun test` — 167/167 pass.

*End of audit.*
