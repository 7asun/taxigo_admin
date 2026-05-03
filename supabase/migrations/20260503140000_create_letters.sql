-- Letters module: table-free business letters (PDF), company-scoped.
-- RLS mirrors public.angebote (admin + current_user_company_id).

CREATE TABLE public.letters (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  letter_number          text,
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'sent')),

  recipient_company      text,
  recipient_salutation   text,
  recipient_first_name   text,
  recipient_last_name   text,
  recipient_street       text,
  recipient_zip          text,
  recipient_city         text,
  recipient_country      text,

  subject                text,
  body_html              text,
  letter_date            date NOT NULL DEFAULT CURRENT_DATE,

  created_by             text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_letters_company_id
  ON public.letters (company_id);

CREATE INDEX IF NOT EXISTS idx_letters_letter_date
  ON public.letters (company_id, letter_date DESC);

COMMENT ON TABLE public.letters IS
  'Ad-hoc business letters (no line items). PDF uses Brief layout; numbering is optional / client-side until RPC exists.';

COMMENT ON COLUMN public.letters.id IS 'Primary key.';
COMMENT ON COLUMN public.letters.company_id IS
  'Tenant scope; FK to public.companies. Must match accounts.company_id for the signed-in admin.';
COMMENT ON COLUMN public.letters.letter_number IS
  'Optional human reference (e.g. B-2026-001). Not auto-generated in DB; no uniqueness constraint in v1.';
COMMENT ON COLUMN public.letters.status IS
  'Lifecycle: draft (editable) or sent (dispatched — semantic only, no separate sent_at column in v1).';

COMMENT ON COLUMN public.letters.recipient_company IS 'Addressee organisation name for the DIN address window.';
COMMENT ON COLUMN public.letters.recipient_salutation IS
  'Salutation line (Herr/Frau or free text); mapped to PDF recipient anrede / greeting logic.';
COMMENT ON COLUMN public.letters.recipient_first_name IS 'Addressee given name.';
COMMENT ON COLUMN public.letters.recipient_last_name IS 'Addressee family name.';
COMMENT ON COLUMN public.letters.recipient_street IS 'Street line (no separate house number column in v1).';
COMMENT ON COLUMN public.letters.recipient_zip IS 'Postal code.';
COMMENT ON COLUMN public.letters.recipient_city IS 'City; country may be appended in PDF when recipient_country is set.';
COMMENT ON COLUMN public.letters.recipient_country IS
  'Optional country; app may render with city in the address block (no dedicated country line in shared PDF primitive).';

COMMENT ON COLUMN public.letters.subject IS 'Betreff — shown as subject line in the letter body.';
COMMENT ON COLUMN public.letters.body_html IS
  'Tiptap HTML; rendered in PDF via react-pdf-html (same subset as Angebot intro/outro).';
COMMENT ON COLUMN public.letters.letter_date IS
  'Document date on the letter (PDF meta “Datum”); not necessarily equal to created_at.';

COMMENT ON COLUMN public.letters.created_by IS
  'auth.uid() as text at insert time (optional); mirrors invoices.created_by pattern.';
COMMENT ON COLUMN public.letters.created_at IS 'Row creation timestamp.';
COMMENT ON COLUMN public.letters.updated_at IS
  'Last update; maintained by the application on PATCH (no DB trigger).';

ALTER TABLE public.letters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "letters_select_company_admin" ON public.letters
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "letters_insert_company_admin" ON public.letters
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "letters_update_company_admin" ON public.letters
  FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  )
  WITH CHECK (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );

CREATE POLICY "letters_delete_company_admin" ON public.letters
  FOR DELETE TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
