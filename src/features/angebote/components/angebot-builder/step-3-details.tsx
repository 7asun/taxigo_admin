'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-time-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';

import { AngebotTiptapField } from './angebot-tiptap-field';

export interface DetailsValues {
  subject: string;
  offer_date: string; // yyyy-MM-dd
  valid_until: string; // yyyy-MM-dd or ''
  intro_text: string;
  outro_text: string;
}

export interface Step3DetailsProps {
  values: DetailsValues;
  onChange: (patch: Partial<DetailsValues>) => void;
}

export function Step3Details({ values, onChange }: Step3DetailsProps) {
  const { data: textBlocks } = useAllInvoiceTextBlocks();
  const introBlocks =
    textBlocks
      ?.filter((b) => b.type === 'intro')
      .map((b) => ({ id: b.id, label: b.name, content: b.content })) ?? [];
  const outroBlocks =
    textBlocks
      ?.filter((b) => b.type === 'outro')
      .map((b) => ({ id: b.id, label: b.name, content: b.content })) ?? [];

  return (
    <div className='space-y-4'>
      {/* Betreff */}
      <div className='space-y-1.5'>
        <Label htmlFor='subject'>Betreff</Label>
        <Input
          id='subject'
          placeholder='Angebot für Krankentransporte'
          value={values.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
        />
      </div>

      {/* Dates row */}
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

      {/* Angebotsvorlage — single "Standard" preset for now */}
      <div className='space-y-1.5'>
        <Label>Angebotsvorlage</Label>
        <Select value='standard' disabled>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='standard'>
              Standard (Pos / Leistung / Anfahrt / erste 5 km / ab 5 km)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className='text-muted-foreground text-xs'>
          Weitere Vorlagen werden in einem späteren Update verfügbar.
        </p>
      </div>
    </div>
  );
}
