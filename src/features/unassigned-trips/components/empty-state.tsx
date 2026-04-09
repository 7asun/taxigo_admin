'use client';

import { IconCheck } from '@tabler/icons-react';

export function EmptyState() {
  return (
    <div className='bg-card flex flex-col items-center justify-center rounded-lg border py-12 text-center'>
      <div className='mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600'>
        <IconCheck className='h-6 w-6' />
      </div>
      <h3 className='text-lg font-semibold'>
        Alle Fahrten haben eine Abrechnungsart.
      </h3>
      <p className='text-muted-foreground mt-1 max-w-md text-sm'>
        Es gibt derzeit keine Fahrten ohne zugewiesene Abrechnungsart. Alle
        erfassten Fahrten können in Rechnung gestellt werden.
      </p>
    </div>
  );
}
