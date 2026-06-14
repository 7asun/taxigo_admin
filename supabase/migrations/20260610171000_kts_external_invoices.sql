-- KTS PR4: accountant CSV import batch table + trip invoice snapshot columns.
-- See docs/kts-architecture.md §3.7.

CREATE TABLE public.kts_external_invoices (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid        NOT NULL
                                REFERENCES public.companies(id)
                                ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES auth.users(id)
                                ON DELETE SET NULL,
  kts_handover_id   uuid        REFERENCES public.kts_handovers(id)
                                ON DELETE SET NULL,
  row_count         integer     NOT NULL DEFAULT 0,
  source_filename   text
);

COMMENT ON TABLE public.kts_external_invoices IS
  'Append-only audit log: one row per accountant CSV import run (PR4 Flow 2).';

COMMENT ON COLUMN public.kts_external_invoices.id IS
  'Primary key — returned by apply_kts_invoice_import RPC.';

COMMENT ON COLUMN public.kts_external_invoices.company_id IS
  'Tenant scope — all queries and RLS policies filter by this column.';

COMMENT ON COLUMN public.kts_external_invoices.created_at IS
  'When the import batch was committed.';

COMMENT ON COLUMN public.kts_external_invoices.created_by IS
  'Auth user who ran the import. SET NULL on user deletion; company_id is authoritative.';

COMMENT ON COLUMN public.kts_external_invoices.kts_handover_id IS
  'Optional audit hint linking this import to a handover batch — not enforced 1:1; '
  'NULL when CSV spans multiple handovers or admin omitted handover context.';

COMMENT ON COLUMN public.kts_external_invoices.row_count IS
  'Number of trips actually stamped in this import (excludes skipped already-imported rows).';

COMMENT ON COLUMN public.kts_external_invoices.source_filename IS
  'Original CSV filename for audit trail (display only, not parsed from DB).';

CREATE INDEX idx_kts_external_invoices_company_id
  ON public.kts_external_invoices (company_id);

CREATE INDEX idx_kts_external_invoices_company_created_at
  ON public.kts_external_invoices (company_id, created_at DESC);

CREATE INDEX idx_kts_external_invoices_handover_id
  ON public.kts_external_invoices (kts_handover_id)
  WHERE kts_handover_id IS NOT NULL;

ALTER TABLE public.kts_external_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kts_external_invoices_select"
  ON public.kts_external_invoices
  FOR SELECT
  USING (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

CREATE POLICY "kts_external_invoices_insert"
  ON public.kts_external_invoices
  FOR INSERT
  WITH CHECK (
    company_id = (
      SELECT a.company_id FROM public.accounts a WHERE a.id = auth.uid()
    )
  );

-- No UPDATE/DELETE policies — append-only audit; rows removed via CASCADE from companies.

GRANT SELECT, INSERT ON public.kts_external_invoices TO authenticated, service_role;

-- why: invoice snapshot on trip at import time — amounts are INVOICED, not PAID (Flow 3 / PR4.2).
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS kts_belegnummer text,
  ADD COLUMN IF NOT EXISTS kts_invoice_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS kts_eigenanteil numeric(10, 2),
  ADD COLUMN IF NOT EXISTS kts_external_invoice_id uuid
    REFERENCES public.kts_external_invoices(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.trips.kts_belegnummer IS
  'Rechnungsnummer from accountant invoice CSV. One Belegnummer may cover multiple trips '
  '(outbound + return). Stamped at CSV import time (Flow 2). NOT the Krankenkasse payment reference.';

COMMENT ON COLUMN public.trips.kts_invoice_amount IS
  'Gesamtpreis invoiced to Krankenkasse (from accountant CSV Gesamtpreis column). '
  'Represents amount INVOICED, not amount PAID. Payment tracking is Flow 3 / PR4.2.';

COMMENT ON COLUMN public.trips.kts_eigenanteil IS
  'Patient co-payment (Eigenanteil) from accountant CSV. Amount the patient owes directly, '
  'not billed to Krankenkasse.';

COMMENT ON COLUMN public.trips.kts_external_invoice_id IS
  'FK to the import batch that stamped this trip. Links trip → import run → optional handover hint.';

CREATE INDEX IF NOT EXISTS idx_trips_kts_external_invoice_id
  ON public.trips (kts_external_invoice_id)
  WHERE kts_external_invoice_id IS NOT NULL;

-- why: Step 1 matching in PR4.1 preview uses kts_patient_id + company scope.
CREATE INDEX IF NOT EXISTS idx_trips_company_kts_patient_id
  ON public.trips (company_id, kts_patient_id)
  WHERE kts_document_applies = true
    AND kts_patient_id IS NOT NULL;

-- Note: no expression index on (scheduled_at AT TIME ZONE 'Europe/Berlin')::date —
-- PR4.1 client-side matching filters by Berlin date in TypeScript; RPC commit is
-- pre-matched by trip_id. Add a dedicated index if server-side candidate fetch is added later.
