import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { CompanySettingsPage } from '@/features/company-settings/components/company-settings-page';

export const metadata = {
  title: 'Einstellungen',
  description: 'Unternehmenseinstellungen verwalten'
};

/**
 * /dashboard/settings/company
 *
 * Server component — auth check only. All data fetching is done
 * client-side via React Query in CompanySettingsPage.
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
      <CompanySettingsPage />
    </div>
  );
}
