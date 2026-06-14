'use client';

/**
 * KTS queue KPI stat cards — client-side counts via get_kts_queue_kpis RPC.
 */
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { StatsCard } from '@/features/dashboard/components/stats-card';
import { useKtsKpis } from '@/features/kts/hooks/use-kts-kpis';

export interface KtsKpiSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KtsKpiSection({ open, onOpenChange }: KtsKpiSectionProps) {
  const { data, isLoading } = useKtsKpis();

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className='shrink-0'>
      <CollapsibleContent>
        <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
          <StatsCard
            title='KTS Gesamt'
            value={data?.gesamt ?? 0}
            isLoading={isLoading}
          />
          <StatsCard
            title='Ungeprüft'
            value={data?.ungeprueft ?? 0}
            description='Noch nicht geprüfte Belege'
            isLoading={isLoading}
          />
          <StatsCard
            title='Fehler aktiv'
            value={data?.fehler_aktiv ?? 0}
            description='Fehlerhaft + In Korrektur'
            isLoading={isLoading}
          />
          <StatsCard
            title='Überfällig'
            value={data?.ueberfaellig ?? 0}
            description='> 10 Tage ohne Rückmeldung'
            isLoading={isLoading}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
