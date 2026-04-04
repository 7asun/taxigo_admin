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
 * Invoice Builder page.
 * Pre-fetches required reference data (payers with billing types, clients)
 * and the user's company profile to pass down to the client-side wizard state machine.
 */
export default async function NewInvoicePage() {
  const supabase = await createClient();

  // 1. Get the current user's company ID
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

  // 2. Fetch the company profile for default payment days
  // Used to populate step 4, and acts as a guard if they haven't set up the profile.
  const { data: companyProfile } = await supabase
    .from('company_profiles')
    .select('default_payment_days, legal_name, tax_id')
    .eq('company_id', companyId)
    .single();

  const isProfileMissing =
    !companyProfile?.legal_name || !companyProfile?.tax_id;

  // 3. Fetch reference data for the Step 2 form dropdowns
  const [payersRes, clientsRes] = await Promise.all([
    // Payers with nested billing types
    supabase
      .from('payers')
      .select(
        `
        id,
        name,
        number,
        rechnungsempfaenger_id,
        billing_types(id, name, rechnungsempfaenger_id)
      `
      )
      .order('name'),

    // Clients
    supabase
      .from('clients')
      .select('id, first_name, last_name')
      .order('last_name')
  ]);

  return (
    <div className='w-full flex-1 overflow-y-auto'>
      <div className='mx-auto max-w-4xl space-y-6 p-4 md:p-8 md:pt-6'>
        <div className='flex items-center justify-between space-y-2'>
          <h2 className='text-3xl font-bold tracking-tight'>Neue Rechnung</h2>
        </div>

        <InvoiceBuilder
          companyId={companyId}
          payers={payersRes.data ?? []}
          clients={clientsRes.data ?? []}
          defaultPaymentDays={companyProfile?.default_payment_days ?? 14}
          companyProfileMissing={isProfileMissing}
        />
      </div>
    </div>
  );
}
