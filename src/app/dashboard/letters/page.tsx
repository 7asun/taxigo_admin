import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { LetterList } from '@/features/letters/components/letter-list';

export const metadata: Metadata = {
  title: 'Letters | Taxigo',
  description: 'Geschäftsbriefe verfassen und als PDF exportieren'
};

export default async function LettersPage() {
  const supabase = await createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();
  if (!session) redirect('/auth/sign-in');

  const { data: account } = await supabase
    .from('accounts')
    .select('company_id')
    .eq('id', session.user.id)
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
    <div className='flex min-h-0 w-full flex-1 flex-col overflow-y-auto'>
      <div className='space-y-6 p-8 pt-6'>
        <div className='flex items-center justify-between'>
          <h2 className='text-3xl font-bold tracking-tight'>Letters</h2>
          <Button asChild>
            <Link href='/dashboard/letters/new'>
              <Plus className='mr-2 h-4 w-4' />
              Neuer Brief
            </Link>
          </Button>
        </div>

        <LetterList companyProfile={companyProfile ?? null} />
      </div>
    </div>
  );
}
