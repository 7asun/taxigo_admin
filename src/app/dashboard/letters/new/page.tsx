import type { Metadata } from 'next';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { LetterBuilder } from '@/features/letters/components/letter-builder';

export const metadata: Metadata = {
  title: 'Neuer Brief | Taxigo',
  description: 'Geschäftsbrief erstellen'
};

export default async function NewLetterPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/sign-in');

  const { data: account } = await supabase
    .from('accounts')
    .select('company_id')
    .eq('id', user.id)
    .single();

  const companyId = account?.company_id ?? '';

  const { data: companyProfile } = companyId
    ? await supabase
        .from('company_profiles')
        .select(
          `legal_name, street, street_number, zip_code, city,
           tax_id, vat_id, bank_name, bank_iban, bank_bic,
           logo_path, logo_url, slogan, phone, inhaber, email, website,
           default_payment_days`
        )
        .eq('company_id', companyId)
        .single()
    : { data: null };

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <LetterBuilder
        mode='create'
        companyId={companyId}
        companyProfile={companyProfile ?? null}
      />
    </div>
  );
}
