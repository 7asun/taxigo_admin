import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { InvoiceTemplatesSettingsPage } from '@/features/invoices/components/invoice-templates-settings-page';

export const metadata = {
  title: 'Rechnungsvorlagen',
  description:
    'Rechnungstext-Vorlagen verwalten (Einleitungen und Schlussformeln)'
};

/**
 * /dashboard/settings/invoice-templates
 *
 * Server component — auth check only. All data fetching is done
 * client-side via React Query in InvoiceTemplatesSettingsPage.
 */
export default async function Page() {
  const supabase = await createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/auth/sign-in');
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-6 md:p-8'>
      <InvoiceTemplatesSettingsPage />
    </div>
  );
}
