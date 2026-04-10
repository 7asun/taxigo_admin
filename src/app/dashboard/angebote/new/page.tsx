import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';

import { AngebotBuilder } from '@/features/angebote/components/angebot-builder';

export const metadata: Metadata = {
  title: 'Neues Angebot | Taxigo',
  description: 'Angebot erstellen'
};

/**
 * /dashboard/angebote/new
 *
 * Server component that pre-fetches the company profile so the builder
 * can render a live PDF preview without a client-side waterfall.
 *
 * Pattern mirrors /dashboard/invoices/new/page.tsx.
 */
export default async function NewAngebotPage() {
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

  const isProfileMissing = !companyProfile?.legal_name;

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <AngebotBuilder
        companyId={companyId}
        companyProfile={companyProfile ?? null}
        companyProfileMissing={isProfileMissing}
      />
    </div>
  );
}
