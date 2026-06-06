import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { InvoiceBuilder } from '@/features/invoices/components/invoice-builder';

export const metadata: Metadata = {
  title: 'Rechnung bearbeiten | Taxigo',
  description: 'Entwurf bearbeiten'
};

interface EditInvoicePageProps {
  params: Promise<{
    id: string;
  }>;
}

/**
 * /dashboard/invoices/[id]/edit
 *
 * Server Component entry point for re-opening a DRAFT invoice in the builder.
 * Mirrors new/page.tsx for the builder's reference data (payers, clients,
 * company profile) and additionally enforces a server-side guard so the edit
 * capability is never reachable client-only.
 *
 * GUARD (defence in depth on top of the RPC's own status='draft' check):
 *   The invoice must exist, be status='draft', and belong to a payer with
 *   revision_invoices_enabled = true. Any failure redirects back to the detail
 *   page — issued invoices (sent/paid/cancelled/corrected) are immutable §14
 *   UStG documents and must be corrected via Stornorechnung, never edited.
 *
 * RLS already scopes the invoice read to the current company, so a cross-tenant
 * id cannot leak here.
 */
export default async function EditInvoicePage({
  params
}: EditInvoicePageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Guard query first: cheap status + flag check before loading builder context.
  const { data: invoice } = await supabase
    .from('invoices')
    .select(
      'id, status, replaces_invoice_id, payer:payers(revision_invoices_enabled)'
    )
    .eq('id', id)
    .single();

  const payerFlagEnabled =
    (invoice?.payer as { revision_invoices_enabled?: boolean } | null)
      ?.revision_invoices_enabled === true;

  const isBranchDraft = invoice?.replaces_invoice_id != null;
  // why: branch drafts bypass revision_invoices_enabled — corrective work after Storno;
  // all other draft re-opens still require the per-payer flag.
  const canEdit =
    invoice?.status === 'draft' && (isBranchDraft || payerFlagEnabled);

  if (!invoice || !canEdit) {
    redirect(`/dashboard/invoices/${id}`);
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  let companyId = '';
  if (user) {
    const { data: account } = await supabase
      .from('accounts')
      .select('company_id')
      .eq('id', user.id)
      .single();
    companyId = account?.company_id ?? '';
  }

  const { data: companyProfile } = await supabase
    .from('company_profiles')
    .select(
      `
        legal_name, street, street_number, zip_code, city,
        tax_id, vat_id, bank_name, bank_iban, bank_bic,
        logo_path, logo_url, slogan, phone, inhaber, email, website,
        default_payment_days
      `
    )
    .eq('company_id', companyId)
    .single();

  const isProfileMissing =
    !companyProfile?.legal_name || !companyProfile?.tax_id;

  const [payersRes, clientsRes] = await Promise.all([
    // Same reference shape as new/page.tsx — Step 2 needs billing_types, Step 4
    // needs pdf_vorlage_id. (Payer/mode are locked in edit mode but the builder
    // still reads these joins for labels and Vorlage resolution.)
    supabase
      .from('payers')
      .select(
        `
        id,
        name,
        number,
        street,
        street_number,
        zip_code,
        city,
        contact_person,
        email,
        rechnungsempfaenger_id,
        pdf_vorlage_id,
        default_intro_block_id,
        default_outro_block_id,
        billing_types(id, name, rechnungsempfaenger_id)
      `
      )
      .order('name'),

    supabase
      .from('clients')
      .select(
        'id, first_name, last_name, company_name, greeting_style, customer_number, street, street_number, zip_code, city, email, phone, reference_fields'
      )
      .order('last_name')
  ]);

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <InvoiceBuilder
        companyId={companyId}
        payers={payersRes.data ?? []}
        clients={clientsRes.data ?? []}
        defaultPaymentDays={companyProfile?.default_payment_days ?? 14}
        companyProfile={companyProfile ?? null}
        companyProfileMissing={isProfileMissing}
        invoiceId={id}
      />
    </div>
  );
}
