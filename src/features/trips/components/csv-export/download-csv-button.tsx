'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// Dynamic import for the dialog to reduce initial bundle size
const CsvExportDialog = dynamic(
  async () => {
    const { CsvExportDialog: Dialog } = await import(
      '@/features/trips/components/csv-export/csv-export-dialog'
    );
    return { default: Dialog };
  },
  {
    ssr: false,
    loading: () => (
      <div
        className='bg-muted/40 border-border h-9 w-[140px] shrink-0 animate-pulse rounded-md border'
        aria-hidden
      />
    )
  }
);

/**
 * Download CSV Button
 *
 * Button component that opens the CSV export dialog when clicked.
 * Placed next to the Bulk Upload button in the Fahrten page header.
 */
export function DownloadCsvButton() {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <>
      <Button
        variant='outline'
        className='gap-2'
        aria-label='CSV Export'
        title='CSV Export'
        onClick={() => setDialogOpen(true)}
      >
        <FileDown className='h-4 w-4 shrink-0' />
        <span className='hidden sm:inline'>CSV Export</span>
      </Button>

      <CsvExportDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
