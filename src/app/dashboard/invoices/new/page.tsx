import { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { InvoiceBuilder } from '@/features/invoices/components/invoice-builder';

export const metadata: Metadata = {
  title: 'Neue Rechnung | Taxigo',
  description: 'Rechnungs-Builder'
};

/**
 * /dashboard/invoices/new
 *
 * Server Component that pre-fetches reference data for the invoice builder so the
 * client shell avoids request waterfalls (payers, clients, company profile in parallel).
 *
 * Payers are loaded with nested billing_types because Step 2 (Abrechnungsart) resolves
 * labels from that join; without it the UI falls back to “Unbekannt”.
 *
 * pdf_vorlage_id is selected so Section 4 (PDF-Vorlage) can pre-fill the Kostenträger’s
 * assigned Vorlage without an extra round-trip.
 *
 * default_intro_block_id / default_outro_block_id feed the Bestätigung step’s PDF overlay
 * defaults (text block pickers).
 *
 * Must not run mutations or encode pricing — data is read-only reference context.
 */
export default async function NewInvoicePage() {
  const supabase = await createClient();

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
    // Fetch payers with nested billing_types for Step 2 Abrechnungsart dropdown.
    // pdf_vorlage_id is included so Step 4 (PDF-Vorlage) can pre-fill the
    // Kostenträger's assigned Vorlage without an extra client-side query.
    // WARNING: do not remove billing_types — Step 2 will show "Unbekannt" without it.
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
      />
    </div>
  );
}
