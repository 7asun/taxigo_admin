import PageContainer from '@/components/layout/page-container';
import { FleetPageContent } from '@/features/fleet/components/fleet-page-content';
import { assertAdminOrRedirect } from '@/lib/api/require-admin';

export const metadata = {
  title: 'Dashboard: Flottenübersicht',
  description: 'Live-Standorte der Fahrer auf der Karte.'
};

export default async function FleetPage() {
  await assertAdminOrRedirect();

  return (
    <PageContainer
      scrollable={false}
      pageTitle='Flottenübersicht'
      pageDescription='Aktuelle Positionen Ihrer Fahrer (ca. 5 Sekunden Aktualisierung).'
    >
      <FleetPageContent />
    </PageContainer>
  );
}
