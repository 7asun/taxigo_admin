import { ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { PayerWithBillingCount } from '../types/payer.types';
import { cn } from '@/lib/utils';
import { formatPayerNumber } from '@/lib/customer-number';

interface PayerCardProps {
  payer: PayerWithBillingCount;
  onClick: (payer: PayerWithBillingCount) => void;
}

export function PayerCard({ payer, onClick }: PayerCardProps) {
  const billingCount =
    payer.billing_types && payer.billing_types.length > 0
      ? payer.billing_types[0]?.count || 0
      : 0;

  const hasCases = billingCount > 0;
  const initial = payer.name.charAt(0).toUpperCase();

  return (
    <Card
      className={cn(
        'group hover:bg-muted/50 flex cursor-pointer !flex-row flex-nowrap items-center gap-6 p-4 transition-all hover:shadow-md',
        'border-border/50'
      )}
      onClick={() => onClick(payer)}
    >
      <Avatar className='group-hover:bg-background h-12 w-12 shrink-0 border transition-colors'>
        <AvatarFallback className='text-foreground/80 text-lg font-semibold'>
          {initial}
        </AvatarFallback>
      </Avatar>

      <div className='flex min-w-0 flex-1 flex-col items-start'>
        <h3 className='mb-2 truncate text-base font-semibold'>{payer.name}</h3>
        {payer.number && (
          <span className='text-muted-foreground text-sm'>
            {formatPayerNumber(payer.number)}
          </span>
        )}
      </div>

      <Badge
        variant={hasCases ? 'default' : 'secondary'}
        className={cn(
          'shrink-0 self-end rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
          hasCases
            ? 'border-teal-500/20 bg-teal-500/15 text-teal-700 hover:bg-teal-500/25'
            : 'text-muted-foreground bg-muted hover:bg-muted'
        )}
      >
        {hasCases ? `${billingCount} Arten` : 'Keine'}
      </Badge>

      <ChevronRight className='text-muted-foreground/30 group-hover:text-muted-foreground ml-2 h-5 w-5 shrink-0 self-center transition-transform group-hover:translate-x-0.5' />
    </Card>
  );
}
