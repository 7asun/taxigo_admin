'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { KtsCsvImportDialog } from '@/features/kts/components/kts-csv-import-dialog';
import { KtsKpiSection } from '@/features/kts/components/kts-kpi-section';

export function KtsHeader() {
  const [kpiOpen, setKpiOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className='flex shrink-0 flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-xl font-semibold'>KTS</h1>
          <p className='text-muted-foreground text-sm'>
            Belegprüfung und Korrekturverwaltung
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            className='gap-1.5'
            onClick={() => setImportOpen(true)}
          >
            <Upload className='h-3.5 w-3.5' />
            CSV importieren
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='text-muted-foreground h-7 gap-1 text-xs'
            onClick={() => setKpiOpen((v) => !v)}
          >
            {kpiOpen ? (
              <>
                <ChevronUp className='h-3.5 w-3.5' />
                Ausblenden
              </>
            ) : (
              <>
                <ChevronDown className='h-3.5 w-3.5' />
                Übersicht anzeigen
              </>
            )}
          </Button>
        </div>
      </div>
      <KtsKpiSection open={kpiOpen} onOpenChange={setKpiOpen} />
      {importOpen ? (
        <KtsCsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
      ) : null}
    </div>
  );
}
