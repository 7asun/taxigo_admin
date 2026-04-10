import type { Metadata } from 'next';

import { AngebotDetailView } from '@/features/angebote/components/angebot-detail-view';

export const metadata: Metadata = {
  title: 'Angebot | Taxigo',
  description: 'Angebotsdetails'
};

interface AngebotDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * /dashboard/angebote/[id]
 *
 * Single Angebot detail page.
 * Passes the ID to the client component, which fetches full detail via React Query.
 */
export default async function AngebotDetailPage({
  params
}: AngebotDetailPageProps) {
  const { id } = await params;

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col overflow-y-auto'>
      <div className='mx-auto w-full max-w-5xl space-y-6 p-8 pt-6'>
        <AngebotDetailView angebotId={id} />
      </div>
    </div>
  );
}
