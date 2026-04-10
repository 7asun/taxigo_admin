import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AngeboteListView } from '@/features/angebote/components/angebote-list-view';

export const metadata: Metadata = {
  title: 'Angebote | Taxigo',
  description: 'Angebote verwalten und erstellen'
};

/**
 * /dashboard/angebote
 *
 * Angebote list page. Data is fetched client-side via React Query in
 * AngeboteListView to keep this a lightweight server shell.
 */
export default function AngebotePage() {
  return (
    <div className='flex min-h-0 w-full flex-1 flex-col overflow-y-auto'>
      <div className='space-y-6 p-8 pt-6'>
        <div className='flex items-center justify-between'>
          <h2 className='text-3xl font-bold tracking-tight'>Angebote</h2>
          <Button asChild>
            <Link href='/dashboard/angebote/new'>
              <Plus className='mr-2 h-4 w-4' />
              Neues Angebot
            </Link>
          </Button>
        </div>

        <AngeboteListView />
      </div>
    </div>
  );
}
