'use client';

import * as React from 'react';
import { Calculator } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';

interface TripPriceTooltipProps {
  baseNetPrice: number | null | undefined;
  approachFeeNet: number | null | undefined;
  netPrice: number | null | undefined;
  taxRate: number | null | undefined;
  grossPrice: number | null | undefined;
  children: React.ReactNode;
}

export function TripPriceTooltip({
  baseNetPrice,
  approachFeeNet,
  netPrice,
  taxRate,
  grossPrice,
  children
}: TripPriceTooltipProps) {
  // If there's no gross price, do not show any tooltip; just render children.
  if (grossPrice === null || grossPrice === undefined) {
    return <>{children}</>;
  }

  const eurFormatter = new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  });

  const percentFormatter = new Intl.NumberFormat('de-DE', {
    style: 'percent',
    maximumFractionDigits: 1
  });

  const calculatedApproachFee = approachFeeNet ?? 0;
  const calculatedNet = netPrice ?? 0;
  const calculatedBaseNet =
    baseNetPrice ?? Math.max(0, calculatedNet - calculatedApproachFee);

  const calculatedTaxRate = taxRate ?? 0;
  const calculatedTaxAmount = calculatedNet * calculatedTaxRate;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex cursor-help'>{children}</span>
        </TooltipTrigger>
        <TooltipContent
          side='top'
          align='end'
          className='bg-primary text-primary-foreground border-primary-foreground/10 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 w-64 rounded-lg border p-3 shadow-lg'
        >
          <div className='space-y-2'>
            <div className='border-primary-foreground/20 flex items-center gap-1.5 border-b pb-1.5'>
              <Calculator className='text-primary-foreground/80 h-3.5 w-3.5' />
              <span className='text-primary-foreground/80 text-[10px] font-bold tracking-wider uppercase'>
                Preisaufschlüsselung
              </span>
            </div>

            <div className='space-y-1 text-xs'>
              <div className='flex justify-between gap-4'>
                <span className='text-primary-foreground/70'>
                  Fahrpreis (Netto):
                </span>
                <span className='font-mono font-semibold'>
                  {eurFormatter.format(calculatedBaseNet)}
                </span>
              </div>

              {calculatedApproachFee > 0 && (
                <div className='flex justify-between gap-4'>
                  <span className='text-primary-foreground/70'>
                    Anfahrt (Netto):
                  </span>
                  <span className='font-mono font-semibold'>
                    {eurFormatter.format(calculatedApproachFee)}
                  </span>
                </div>
              )}

              <div className='border-primary-foreground/20 flex justify-between gap-4 border-t border-dashed pt-1'>
                <span className='text-primary-foreground/80 font-medium'>
                  Netto-Summe:
                </span>
                <span className='font-mono font-bold'>
                  {eurFormatter.format(calculatedNet)}
                </span>
              </div>

              <div className='flex justify-between gap-4'>
                <span className='text-primary-foreground/70'>
                  MwSt. ({percentFormatter.format(calculatedTaxRate)}):
                </span>
                <span className='font-mono font-semibold'>
                  {eurFormatter.format(calculatedTaxAmount)}
                </span>
              </div>

              <div className='border-primary-foreground/30 flex justify-between gap-4 border-t pt-1.5 text-sm font-bold'>
                <span>Brutto:</span>
                <span className='font-mono text-white'>
                  {eurFormatter.format(grossPrice)}
                </span>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
