'use client';

/**
 * Letter meta step — field order mirrors `step-3-details.tsx` (Betreff first, then
 * date pair row) with letter-specific fields (Brief-Nr., Status).
 */

import { format } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-time-picker';

import type { LetterFormValues, LetterStatus } from '../../types';

export interface LetterStep2DetailsProps {
  values: Pick<
    LetterFormValues,
    'letterDate' | 'letterNumber' | 'status' | 'subject'
  >;
  onChange: (patch: Partial<LetterFormValues>) => void;
}

function todayYmd(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function LetterStep2Details({
  values,
  onChange
}: LetterStep2DetailsProps) {
  return (
    <div className='space-y-4'>
      <div className='space-y-1.5'>
        <Label htmlFor='letter_subject'>Betreff</Label>
        <Input
          id='letter_subject'
          value={values.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          placeholder='Betreffzeile'
        />
      </div>

      <div className='flex gap-3'>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='letter_letter_date'>Briefdatum</Label>
          <DatePicker
            id='letter_letter_date'
            value={values.letterDate}
            onChange={(ymd) => onChange({ letterDate: ymd || todayYmd() })}
          />
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          <Label htmlFor='letter_letter_number'>Brief-Nr. (optional)</Label>
          <Input
            id='letter_letter_number'
            value={values.letterNumber}
            onChange={(e) => onChange({ letterNumber: e.target.value })}
            placeholder='z. B. B-2026-001'
          />
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='letter_status'>Status</Label>
        <Select
          value={values.status}
          onValueChange={(v) => onChange({ status: v as LetterStatus })}
        >
          <SelectTrigger id='letter_status'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='draft'>Entwurf</SelectItem>
            <SelectItem value='sent'>Versendet</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
