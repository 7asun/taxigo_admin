'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { ChevronDown, FileDown, Table2 } from 'lucide-react';

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
        className='bg-muted/40 border-border h-9 w-[148px] shrink-0 animate-pulse rounded-md border'
        aria-hidden
      />
    )
  }
);

/**
 * CSV export entry — dropdown with manual wizard vs table-view quick export.
 * Placed next to the Bulk Upload button in the Fahrten page header.
 */
export function DownloadCsvButton() {
  // Separate open state per mode so resetting one dialog does not clobber the other instance.
  const [manualOpen, setManualOpen] = React.useState(false);
  const [tableViewOpen, setTableViewOpen] = React.useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant='outline' className='gap-2'>
            <FileDown className='h-4 w-4 shrink-0' />
            <span className='hidden sm:inline'>CSV erstellen</span>
            <ChevronDown className='h-4 w-4 shrink-0' />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem onClick={() => setManualOpen(true)}>
            <FileDown className='mr-2 h-4 w-4' />
            CSV Export
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setTableViewOpen(true)}>
            <Table2 className='mr-2 h-4 w-4' />
            Tabellenansicht exportieren
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CsvExportDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        mode='manual'
      />
      <CsvExportDialog
        open={tableViewOpen}
        onOpenChange={setTableViewOpen}
        mode='table-view'
      />
    </>
  );
}
