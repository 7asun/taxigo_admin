'use client';

import { useState } from 'react';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { PeriodPicker } from '@/features/controlling/components/PeriodPicker';
import { KpiCards } from '@/features/controlling/components/KpiCards';
import { RevenueTimeSeries } from '@/features/controlling/components/RevenueTimeSeries';
import { PrimetimeHeatmap } from '@/features/controlling/components/PrimetimeHeatmap';
import { HourlyDistribution } from '@/features/controlling/components/HourlyDistribution';
import { DriverTable } from '@/features/controlling/components/DriverTable';
import { DriverRevenueChart } from '@/features/controlling/components/DriverRevenueChart';
import { PayerBreakdown } from '@/features/controlling/components/PayerBreakdown';
import { PayerComparisonChart } from '@/features/controlling/components/PayerComparisonChart';
import { PayerBillingTreemap } from '@/features/controlling/components/PayerBillingTreemap';
import { WheelchairStats } from '@/features/controlling/components/WheelchairStats';
import { InvoiceKpis } from '@/features/controlling/components/InvoiceKpis';
import { OperationalFlags } from '@/features/controlling/components/OperationalFlags';
import { useControllingData } from '@/features/controlling/hooks/use-controlling-data';
import { buildControllingPeriod } from '@/features/controlling/lib/controlling-utils';
import type { ControllingPeriod } from '@/features/controlling/types/controlling.types';

export default function ControllingPage() {
  const [period, setPeriod] = useState<ControllingPeriod>(() =>
    buildControllingPeriod('this_month')
  );

  const {
    operational,
    operationalPrevious,
    breakdown,
    breakdownPrevious,
    heatmap,
    invoiceKpis,
    monthlyRevenue,
    isError
  } = useControllingData(period);

  if (isError) {
    return (
      <div className='flex min-h-0 w-full flex-1 flex-col overflow-y-auto'>
        <div className='space-y-6 p-4 md:p-6'>
          <h1 className='text-xl font-semibold tracking-tight'>Controlling</h1>
          <Card>
            <CardHeader>
              <CardTitle>Daten konnten nicht geladen werden</CardTitle>
              <CardDescription>
                Bitte Seite neu laden oder später erneut versuchen.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className='flex min-h-0 w-full flex-1 flex-col overflow-y-auto'>
      <div className='flex flex-col gap-6 p-6'>
        <div className='flex flex-col gap-1'>
          <h1 className='text-xl font-semibold tracking-tight'>Controlling</h1>
          <p className='text-muted-foreground text-sm'>
            Operative und finanzielle Kennzahlen
          </p>
        </div>

        <PeriodPicker defaultPeriod='this_month' onPeriodChange={setPeriod} />

        <KpiCards
          operational={operational}
          operationalPrevious={operationalPrevious}
        />

        <RevenueTimeSeries
          operational={operational}
          monthlyRevenue={monthlyRevenue}
        />

        <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
          <HourlyDistribution heatmap={heatmap} />
          <PrimetimeHeatmap heatmap={heatmap} />
        </div>

        <DriverRevenueChart
          breakdown={breakdown}
          breakdownPrevious={breakdownPrevious}
        />
        <DriverTable breakdown={breakdown} />

        <PayerComparisonChart
          breakdown={breakdown}
          breakdownPrevious={breakdownPrevious}
        />
        <PayerBillingTreemap breakdown={breakdown} />
        <PayerBreakdown breakdown={breakdown} />

        <WheelchairStats
          operational={operational}
          operationalPrevious={operationalPrevious}
          breakdown={breakdown}
        />

        <InvoiceKpis invoiceKpis={invoiceKpis} />

        <OperationalFlags operational={operational} />
      </div>
    </div>
  );
}
