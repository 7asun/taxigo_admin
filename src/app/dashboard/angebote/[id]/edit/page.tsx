import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AngebotBuilder } from '@/features/angebote/components/angebot-builder';
import type { AngebotWithLineItems } from '@/features/angebote/types/angebot.types';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Angebot bearbeiten | Taxigo',
  description: 'Angebot bearbeiten'
};

interface EditAngebotPageProps {
  params: Promise<{ id: string }>;
}

/**
 * /dashboard/angebote/[id]/edit
 *
 * Loads the existing offer server-side, pre-fills AngebotBuilder, and saves via
 * updateAngebot + replaceAngebotLineItems (see useAngebotBuilder edit mode).
 */
export default async function EditAngebotPage({
  params
}: EditAngebotPageProps) {
  const { id } = await params;
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

  const { data: raw, error } = await supabase
    .from('angebote')
    .select(
      `
      *,
      line_items:angebot_line_items(*)
    `
    )
    .eq('id', id)
    .single();

  if (error || !raw) {
    notFound();
  }

  const angebot = raw as unknown as AngebotWithLineItems;
  if (angebot.line_items?.length) {
    angebot.line_items.sort((a, b) => a.position - b.position);
  } else {
    angebot.line_items = [];
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
        initialAngebot={angebot}
      />
    </div>
  );
}
