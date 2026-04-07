import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PdfVorlagenSettingsPage } from '@/features/invoices/components/pdf-vorlagen/pdf-vorlagen-settings-page';

export const metadata = {
  title: 'PDF-Vorlagen',
  description: 'Spaltenprofile für Rechnungs-PDFs verwalten'
};

/**
 * /dashboard/settings/pdf-vorlagen
 */
export default async function Page() {
  const supabase = await createClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/auth/sign-in');
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('company_id')
    .eq('id', session.user.id)
    .single();

  const companyId = account?.company_id ?? '';

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pt-6 md:p-8'>
      {companyId ? (
        <PdfVorlagenSettingsPage companyId={companyId} />
      ) : (
        <p className='text-muted-foreground text-sm'>
          Kein Unternehmen zugeordnet.
        </p>
      )}
    </div>
  );
}
