-- KTS PR4: accountant CSV import — add terminal invoiced state after handover.
-- See docs/kts-architecture.md §3.4 and §3.7.

-- why: Flow 2 (accountant invoice CSV) transitions trips to abgerechnet when invoice
-- data is stamped. Distinct from Flow 3 Krankenkasse payment (PR4.2: versendet, bezahlt, ruecklaufer).
ALTER TYPE public.kts_status
  ADD VALUE IF NOT EXISTS 'abgerechnet'
  AFTER 'uebergeben';

COMMENT ON TYPE public.kts_status IS
  'KTS document workflow state on trips. Order: ungeprueft → korrekt → fehlerhaft ↔ '
  'in_korrektur → uebergeben (handover) → abgerechnet (accountant CSV import, PR4). '
  'PR4.2 will add versendet, bezahlt, ruecklaufer for Krankenkasse payment matching (Flow 3).';
