'use client';

/**
 * Pre-insert step: rows matched a billing family with multiple variants but CSV
 * omitted `abrechnungsvariante`. Dispatcher picks the Unterart per row before geocode/insert.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ValidatedTripRow } from './bulk-upload-types';
import type { InsertTrip } from '@/features/trips/api/trips.service';
import {
  firstNonEmptyKtsCsvSource,
  parseKtsCsvCell,
  resolveKtsDefault
} from '@/features/trips/lib/resolve-kts-default';

interface ResolveBillingVariantsStepProps {
  rows: ValidatedTripRow<InsertTrip | null>[];
  onCancel: () => void;
  /** Called with the same row objects (mutated: issues cleared, trip.billing_variant_id set). */
  onContinue: (rows: ValidatedTripRow<InsertTrip | null>[]) => void;
}

export function ResolveBillingVariantsStep({
  rows,
  onCancel,
  onContinue
}: ResolveBillingVariantsStepProps) {
  const [choices, setChoices] = React.useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const r of rows) {
      if (r.variantResolution?.variants.length === 1) {
        init[r.rowNumber] = r.variantResolution.variants[0].id;
      }
    }
    return init;
  });

  const allChosen = rows.every((r) => {
    const id = choices[r.rowNumber];
    return typeof id === 'string' && id.length > 0;
  });

  const handleContinue = () => {
    for (const r of rows) {
      const vid = choices[r.rowNumber];
      if (!vid || !r.trip) continue;
      r.trip.billing_variant_id = vid;

      const ktsRaw = firstNonEmptyKtsCsvSource(r.source);
      const ktsParsed = parseKtsCsvCell(ktsRaw);
      if (ktsParsed === 'empty' && r.variantResolution) {
        const chosen = r.variantResolution.variants.find((v) => v.id === vid);
        const res = resolveKtsDefault({
          payerKtsDefault: r.variantResolution.payerKtsDefault,
          familyBehaviorProfile: r.variantResolution.familyBehaviorProfile,
          variantKtsDefault: chosen?.kts_default
        });
        r.trip.kts_document_applies = res.value;
        r.trip.kts_source = res.source;
      }

      r.issues = r.issues.filter((i) => i.type !== 'billing_variant_missing');
    }
    onContinue(rows);
  };

  return (
    <div className='flex max-h-[min(70vh,520px)] flex-col gap-4'>
      <p className='text-muted-foreground text-sm'>
        Für diese Zeilen ist die Abrechnungsfamilie eindeutig, aber die Unterart
        fehlt in der CSV. Bitte je Zeile eine Variante wählen (entspricht Spalte{' '}
        <code className='text-xs'>abrechnungsvariante</code>).
      </p>
      <ScrollArea className='min-h-0 flex-1 rounded-md border'>
        <ul className='divide-y p-2'>
          {rows.map((r) => (
            <li
              key={r.rowNumber}
              className='flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between'
            >
              <div className='min-w-0 text-sm'>
                <span className='font-medium'>Zeile {r.rowNumber}</span>
                <span className='text-muted-foreground'>
                  {' '}
                  · {r.source.kostentraeger} · Familie „
                  {r.variantResolution?.familyName ?? '?'}“
                </span>
              </div>
              <Select
                value={choices[r.rowNumber] ?? ''}
                onValueChange={(v) =>
                  setChoices((prev) => ({ ...prev, [r.rowNumber]: v }))
                }
              >
                <SelectTrigger className='h-9 w-full sm:w-[220px]'>
                  <SelectValue placeholder='Unterart wählen' />
                </SelectTrigger>
                <SelectContent>
                  {(r.variantResolution?.variants ?? []).map((v) => (
                    <SelectItem key={v.id} value={v.id} className='text-xs'>
                      <span className='flex flex-col leading-tight'>
                        <span>{v.name}</span>
                        <span className='text-muted-foreground font-mono text-[10px]'>
                          {v.code}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <div className='flex justify-end gap-2 border-t pt-2'>
        <Button type='button' variant='outline' onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type='button' disabled={!allChosen} onClick={handleContinue}>
          Weiter zum Import
        </Button>
      </div>
    </div>
  );
}
