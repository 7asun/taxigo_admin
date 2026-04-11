'use client';

import { PRICING_STRATEGIES } from '@/features/invoices/types/pricing.types';
import type { PricingStrategy } from '@/features/invoices/types/pricing.types';
import { PRICING_STRATEGY_LABELS_DE } from '@/features/invoices/lib/pricing-strategy-labels-de';
import { cn } from '@/lib/utils';
import { STRATEGY_DESCRIPTION } from './pricing-rule-dialog.types';
import { ClientPriceSearch } from './client-price-search';

export interface Step1StrategyPickerProps {
  strategy: PricingStrategy;
  onStrategyChange: (s: PricingStrategy) => void;
  clientId: string | null;
  priceTagInput: string;
  busy: boolean;
  onClientSelect: (id: string, currentPriceTag: number | null) => void;
  onClientClear: () => void;
  onPriceTagChange: (value: string) => void;
  onRemovePriceTag: () => void;
}

export function Step1StrategyPicker({
  strategy,
  onStrategyChange,
  clientId,
  priceTagInput,
  busy,
  onClientSelect,
  onClientClear,
  onPriceTagChange,
  onRemovePriceTag
}: Step1StrategyPickerProps) {
  return (
    <>
      <div className='grid grid-cols-2 gap-2'>
        {PRICING_STRATEGIES.map((key) => (
          <button
            key={key}
            type='button'
            disabled={busy}
            onClick={() => onStrategyChange(key)}
            className={cn(
              'hover:bg-accent flex min-h-[72px] flex-col gap-1 rounded-lg border p-3 text-left transition-colors',
              strategy === key && 'border-primary bg-accent ring-primary ring-1'
            )}
          >
            <span className='text-sm leading-tight font-medium'>
              {PRICING_STRATEGY_LABELS_DE[key]}
            </span>
            <span className='text-muted-foreground text-xs leading-snug'>
              {STRATEGY_DESCRIPTION[key]}
            </span>
          </button>
        ))}
      </div>

      {strategy === 'client_price_tag' && (
        <ClientPriceSearch
          clientId={clientId}
          priceTagInput={priceTagInput}
          busy={busy}
          onClientSelect={onClientSelect}
          onClientClear={onClientClear}
          onPriceTagChange={onPriceTagChange}
          onRemovePriceTag={onRemovePriceTag}
        />
      )}
    </>
  );
}
