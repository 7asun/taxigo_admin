-- KTS PR4.2: payment workflow states after accountant CSV import (abgerechnet).
-- See docs/kts-architecture.md §3.4 and docs/plans/kts-pr4.2-abrechnung-tab.md.

ALTER TYPE public.kts_status
  ADD VALUE IF NOT EXISTS 'ruecklaufer'
  AFTER 'abgerechnet';

ALTER TYPE public.kts_status
  ADD VALUE IF NOT EXISTS 'bezahlt'
  AFTER 'ruecklaufer';

COMMENT ON TYPE public.kts_status IS
  'KTS document workflow state on trips. Bearbeitung queue: ungeprueft → korrekt → '
  'fehlerhaft ↔ in_korrektur → uebergeben. Abrechnung (PR4/PR4.2): uebergeben or eligible '
  'trip → abgerechnet (accountant CSV) → bezahlt (payment confirmed) or ruecklaufer '
  '(returned for correction). ruecklaufer resolves back to abgerechnet via CSV reimport '
  '(apply_kts_invoice_import v4) or manual mark_belegnummer_abgerechnet escape hatch. '
  'bezahlt is terminal.';
