import PageContainer from '@/components/layout/page-container';
import { UsersTable } from '@/features/user-management/components/users-table';
import { assertAdminOrRedirect } from '@/lib/api/require-admin';

export const metadata = {
  title: 'Dashboard: Benutzerverwaltung',
  description: 'Alle Benutzer der Organisation verwalten.'
};

export default async function UsersAdminPage() {
  await assertAdminOrRedirect();

  return (
    <PageContainer
      scrollable
      pageTitle='Benutzerverwaltung'
      pageDescription='E-Mail und Passwort aus Supabase Auth, Konten sperren und entsperren.'
    >
      <UsersTable />
    </PageContainer>
  );
}
