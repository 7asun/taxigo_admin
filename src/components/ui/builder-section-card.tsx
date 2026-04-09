'use client';

/**
 * BuilderSectionCard
 *
 * Extracted from invoice-builder/index.tsx — shared by InvoiceBuilder and
 * AngebotBuilder.
 *
 * If you modify this component, verify both builders visually — they share
 * the same shell pattern but have different section counts and labels.
 */

import type { RefObject } from 'react';
import { ChevronDown, Check, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export interface BuilderSectionCardProps {
  id: string;
  sectionRef: RefObject<HTMLElement | null>;
  title: string;
  locked: boolean;
  completed: boolean;
  showFertigBadge: boolean;
  summary: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function BuilderSectionCard({
  id,
  sectionRef,
  title,
  locked,
  completed,
  showFertigBadge,
  summary,
  open,
  onOpenChange,
  children,
  footer
}: BuilderSectionCardProps) {
  const isOpen = locked ? false : open;

  return (
    <section ref={sectionRef} id={id} className='scroll-mt-3'>
      <Collapsible
        open={isOpen}
        onOpenChange={locked ? undefined : onOpenChange}
      >
        <div
          className={cn(
            'bg-card border-border overflow-hidden rounded-xl border shadow-sm'
          )}
        >
          <CollapsibleTrigger asChild disabled={locked}>
            <button
              type='button'
              className={cn(
                'hover:bg-muted/40 flex w-full items-start justify-between gap-3 p-6 text-left transition-colors',
                locked && 'cursor-not-allowed opacity-80 hover:bg-transparent'
              )}
            >
              <div className='min-w-0 flex-1'>
                <p className='text-sm font-semibold'>{title}</p>
                {completed && !isOpen && summary ? (
                  <p className='text-muted-foreground mt-1 text-sm'>
                    {summary}
                  </p>
                ) : null}
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {completed && showFertigBadge ? (
                  <Badge
                    variant='outline'
                    className='border-green-200 bg-green-500/10 text-green-800 dark:border-green-800 dark:bg-green-500/15 dark:text-green-300'
                  >
                    <Check className='h-3 w-3' aria-hidden />
                    Fertig
                  </Badge>
                ) : null}
                {locked ? (
                  <span className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                    <Lock className='h-3.5 w-3.5 shrink-0' aria-hidden />
                    Gesperrt
                  </span>
                ) : null}
                {!locked ? (
                  <ChevronDown
                    className={cn(
                      'text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-200',
                      isOpen && 'rotate-180'
                    )}
                    aria-hidden
                  />
                ) : null}
              </div>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent
            className={cn(
              'data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down'
            )}
          >
            <div className='border-border space-y-4 border-t px-6 pt-4 pb-6'>
              {children}
              {footer}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </section>
  );
}
