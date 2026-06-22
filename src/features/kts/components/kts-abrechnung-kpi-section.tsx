'use client';

/**
 * Abrechnung tab KPI stat cards — client-side counts via get_kts_abrechnung_kpis RPC.
 */
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { StatsCard } from '@/features/dashboard/components/stats-card';
import { useKtsAbrechnungKpis } from '@/features/kts/hooks/use-kts-abrechnung-kpis';

function formatEuroAmount(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

export interface KtsAbrechnungKpiSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KtsAbrechnungKpiSection({
  open,
  onOpenChange
}: KtsAbrechnungKpiSectionProps) {
  const { data, isLoading } = useKtsAbrechnungKpis();

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className='shrink-0'>
      <CollapsibleContent>
        <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
          <StatsCard
            title='Belege gesamt'
            value={data?.total_belege ?? 0}
            isLoading={isLoading}
          />
          <StatsCard
            title='Invoiced'
            value={formatEuroAmount(data?.total_invoiced ?? 0)}
            description='Summe aller Beleggruppen'
            isLoading={isLoading}
          />
          <StatsCard
            title='Bezahlt'
            value={formatEuroAmount(data?.total_bezahlt ?? 0)}
            description='Bestätigte Zahlungen'
            isLoading={isLoading}
          />
          <StatsCard
            title='Offen'
            value={data?.total_offen ?? 0}
            description='Abgerechnet + Rückläufer'
            isLoading={isLoading}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
