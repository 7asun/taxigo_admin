'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, Upload } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { KtsAbrechnungKpiSection } from '@/features/kts/components/kts-abrechnung-kpi-section';
import { KtsCsvImportDialog } from '@/features/kts/components/kts-csv-import-dialog';
import { KtsKpiSection } from '@/features/kts/components/kts-kpi-section';
import { cn } from '@/lib/utils';

function isAbrechnungView(view: string | null): boolean {
  return view === 'abrechnung';
}

function isBearbeitungView(view: string | null): boolean {
  return !view || view === 'list' || view === 'bearbeitung';
}

export function KtsHeader() {
  const [kpiOpen, setKpiOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const view = searchParams.get('view');
  const abrechnungActive = isAbrechnungView(view);

  const switchTab = (next: 'bearbeitung' | 'abrechnung') => {
    const params = new URLSearchParams(searchParams.toString());
    // why: kts_status semantics differ per tab — clear before the new filters bar mounts.
    params.delete('kts_status');
    params.set('page', '1');

    if (next === 'abrechnung') {
      params.set('view', 'abrechnung');
      params.delete('overdue');
    } else {
      params.set('view', 'list');
      params.delete('imported_from');
      params.delete('imported_to');
    }

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div className='flex shrink-0 flex-col gap-4'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <h1 className='text-xl font-semibold'>KTS</h1>
          <p className='text-muted-foreground text-sm'>
            Belegprüfung und Korrekturverwaltung
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <div className='bg-muted/40 flex items-center rounded-md border p-0.5'>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className={cn(
                'h-8 rounded-sm px-3 text-xs',
                isBearbeitungView(view) && 'bg-background shadow-sm'
              )}
              onClick={() => switchTab('bearbeitung')}
            >
              Bearbeitung
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className={cn(
                'h-8 rounded-sm px-3 text-xs',
                abrechnungActive && 'bg-background shadow-sm'
              )}
              onClick={() => switchTab('abrechnung')}
            >
              Abrechnung
            </Button>
          </div>
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
      {abrechnungActive ? (
        <KtsAbrechnungKpiSection open={kpiOpen} onOpenChange={setKpiOpen} />
      ) : (
        <KtsKpiSection open={kpiOpen} onOpenChange={setKpiOpen} />
      )}
      {importOpen ? (
        <KtsCsvImportDialog open={importOpen} onOpenChange={setImportOpen} />
      ) : null}
    </div>
  );
}
