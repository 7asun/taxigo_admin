'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import type { BillingPricingRuleRow } from '@/features/payers/api/billing-pricing-rules.api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const CONFIRM_COPY =
  'Preisregel wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.';

export interface PricingRuleDeleteButtonProps {
  rule: BillingPricingRuleRow;
  deleteRule: (id: string) => Promise<void>;
  isDeleting: boolean;
  /** e.g. close nested pricing editor if it was showing this rule */
  onDeleted?: () => void;
  className?: string;
}

export function PricingRuleDeleteButton({
  rule,
  deleteRule,
  isDeleting,
  onDeleted,
  className
}: PricingRuleDeleteButtonProps) {
  const [open, setOpen] = useState(false);

  async function handleConfirm() {
    try {
      await deleteRule(rule.id);
      setOpen(false);
      onDeleted?.();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Preisregel konnte nicht gelöscht werden: ${err.message}`
          : 'Preisregel konnte nicht gelöscht werden.'
      );
    }
  }

  return (
    <Popover open={open} onOpenChange={(o) => !isDeleting && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type='button'
          variant='destructive'
          size='sm'
          className={cn(className)}
          disabled={isDeleting}
        >
          Preisregel löschen
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' side='bottom' className='z-[100] w-80'>
        <p className='text-sm'>{CONFIRM_COPY}</p>
        <div className='mt-4 flex justify-end gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={isDeleting}
            onClick={() => setOpen(false)}
          >
            Abbrechen
          </Button>
          <Button
            type='button'
            variant='destructive'
            size='sm'
            disabled={isDeleting}
            onClick={() => void handleConfirm()}
          >
            {isDeleting ? 'Wird gelöscht…' : 'Löschen'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
