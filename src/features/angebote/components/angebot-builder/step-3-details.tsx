'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-time-picker';
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';

import { AngebotTiptapField } from './angebot-tiptap-field';

export interface DetailsValues {
  subject: string;
  offer_date: string;
  valid_until: string;
  intro_text: string;
  outro_text: string;
}

export interface Step3DetailsProps {
  values: DetailsValues;
  onChange: (patch: Partial<DetailsValues>) => void;
}

export function Step3Details({ values, onChange }: Step3DetailsProps) {
  const { data: textBlocks } = useAllInvoiceTextBlocks();
  // Guard against non-array: hook may return undefined or object shape during loading — always operate on a safe array.
  const safeBlocks = Array.isArray(textBlocks) ? textBlocks : [];
  const introBlocks = safeBlocks
    .filter((b) => b.type === 'intro')
    .map((b) => ({ id: b.id, label: b.name, content: b.content }));
  const outroBlocks = safeBlocks
    .filter((b) => b.type === 'outro')
    .map((b) => ({ id: b.id, label: b.name, content: b.content }));

  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <Label htmlFor='subject'>Betreff</Label>
        <Input
          id='subject'
          placeholder='Angebot für Krankentransporte'
          value={values.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
        />
      </div>

      <div className='flex gap-3'>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='offer_date'>Angebotsdatum</Label>
          <DatePicker
            id='offer_date'
            value={values.offer_date}
            onChange={(v) => onChange({ offer_date: v })}
          />
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='valid_until'>Gültig bis</Label>
          <DatePicker
            id='valid_until'
            value={values.valid_until}
            onChange={(v) => onChange({ valid_until: v })}
          />
        </div>
      </div>

      <AngebotTiptapField
        id='intro_text'
        label='Einleitung'
        value={values.intro_text}
        onChange={(html) => onChange({ intro_text: html })}
        placeholder='Einleitungstext eingeben…'
        templateBlocks={introBlocks}
      />

      <AngebotTiptapField
        id='outro_text'
        label='Schlussformel'
        value={values.outro_text}
        onChange={(html) => onChange({ outro_text: html })}
        placeholder='Schlussformel eingeben…'
        templateBlocks={outroBlocks}
      />
    </div>
  );
}
