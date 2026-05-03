'use client';

/**
 * Letter body — reuses `AngebotTiptapField` (same toolbar/extensions as offers)
 * so behaviour stays consistent across the app without a second rich-text config.
 */

import { AngebotTiptapField } from '@/features/angebote/components/angebot-builder/angebot-tiptap-field';

import type { LetterFormValues } from '../../types';

export interface LetterStep3BodyProps {
  values: Pick<LetterFormValues, 'bodyHtml'>;
  onChange: (patch: Partial<LetterFormValues>) => void;
}

export function LetterStep3Body({ values, onChange }: LetterStep3BodyProps) {
  return (
    <div className='space-y-4'>
      <AngebotTiptapField
        id='letter-body'
        label='Brieftext'
        value={values.bodyHtml}
        onChange={(html) => onChange({ bodyHtml: html })}
        placeholder='Schreiben Sie hier den Brief…'
      />
    </div>
  );
}
