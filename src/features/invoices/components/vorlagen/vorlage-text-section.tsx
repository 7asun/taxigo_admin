/**
 * VorlageTextSection
 *
 * Section for the unified Vorlage editor: two Selects (Einleitung, Schlussformel)
 * assigning invoice_text_blocks to this pdf_vorlage row.
 *
 * Null option "Keine (Kostenträger-Standard)" — uses payer-level defaults in the
 * builder resolution chain when Vorlage FKs are null.
 *
 * Props onChange updates local editor state; parent persists on "Speichern"
 * together with column layout fields.
 */

'use client';

import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { GroupedTextBlocks } from '@/features/invoices/types/invoice-text-blocks.types';
import { cn } from '@/lib/utils';

const NONE = '__none__';

function previewTitle(content: string): string {
  const t = content.trim().replace(/\s+/g, ' ');
  return t.length <= 80 ? t : `${t.slice(0, 80)}…`;
}

interface VorlageTextSectionProps {
  introBlockId: string | null;
  outroBlockId: string | null;
  textBlocks: GroupedTextBlocks | undefined;
  isLoading: boolean;
  onChange: (
    field: 'intro_block_id' | 'outro_block_id',
    id: string | null
  ) => void;
  /** Switches the unified Vorlagen page to the Textbausteine tab. */
  onOpenTextBlocks?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VorlageTextSection({
  introBlockId,
  outroBlockId,
  textBlocks,
  isLoading,
  onChange,
  onOpenTextBlocks,
  open,
  onOpenChange
}: VorlageTextSectionProps) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className='flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-medium'>
        Brieftext (Einleitung & Schlussformel)
        <ChevronDown
          className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className='space-y-4 pt-3'>
        <div className='space-y-2'>
          <Label>Einleitung</Label>
          {isLoading ? (
            <Skeleton className='h-10 w-full' />
          ) : (
            <Select
              value={introBlockId ?? NONE}
              onValueChange={(v) =>
                onChange('intro_block_id', v === NONE ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder='Keine (Kostenträger-Standard)' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  Keine (Kostenträger-Standard)
                </SelectItem>
                {(textBlocks?.intro ?? []).map((block) => (
                  <SelectItem
                    key={block.id}
                    value={block.id}
                    title={previewTitle(block.content)}
                  >
                    {block.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className='text-muted-foreground text-xs'>
            Verwendet den Standard-Text des Kostenträgers, wenn „Keine“ gewählt
            ist.
          </p>
        </div>

        <div className='space-y-2'>
          <Label>Schlussformel</Label>
          {isLoading ? (
            <Skeleton className='h-10 w-full' />
          ) : (
            <Select
              value={outroBlockId ?? NONE}
              onValueChange={(v) =>
                onChange('outro_block_id', v === NONE ? null : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder='Keine (Kostenträger-Standard)' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  Keine (Kostenträger-Standard)
                </SelectItem>
                {(textBlocks?.outro ?? []).map((block) => (
                  <SelectItem
                    key={block.id}
                    value={block.id}
                    title={previewTitle(block.content)}
                  >
                    {block.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className='text-muted-foreground text-xs'>
            Verwendet den Standard-Text des Kostenträgers, wenn „Keine“ gewählt
            ist.
          </p>
        </div>

        {onOpenTextBlocks ? (
          <Button
            type='button'
            variant='link'
            className='h-auto px-0'
            onClick={() => onOpenTextBlocks()}
          >
            Textbausteine verwalten →
          </Button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
