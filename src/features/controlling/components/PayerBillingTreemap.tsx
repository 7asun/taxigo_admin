'use client';

/**
 * PayerBillingTreemap — two-level Nivo treemap navigation.
 *
 * Level 1: all payers — area encodes revenue share at a glance (better than bar
 * length when there are many Kostenträger).
 * Level 2: billing types within one payer — same visual language as level 1.
 * Tab switcher adds a stacked bar view (recharts) alongside the treemap.
 * Billing variant level is deferred — too granular for this overview.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { ResponsiveTreeMap } from '@nivo/treemap';
import type { TooltipProps } from '@nivo/treemap';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { aggregatePayerTreemap, formatEuro } from '../lib/controlling-utils';
import type {
  ControllingBreakdownRow,
  ControllingPayerTreemapItem
} from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';

interface TreemapDatum {
  name: string;
  value?: number;
  payerId?: string;
  hasBillingTypes?: boolean;
  trips?: number;
  tripPct?: number;
  revenuePct?: number;
  children?: TreemapDatum[];
}

// 5-slot design system palette — vercel.css and all themes define
// distinct hues for all 5 slots. mono/notebook themes use greyscale
// by design. Never hardcode oklch() values here.
const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)'
] as const;

const treemapLabelTheme = {
  labels: {
    text: {
      fill: 'var(--color-foreground)',
      fontSize: 12,
      fontWeight: 500
    }
  }
} as const;

export interface PayerBillingTreemapProps {
  breakdown: UseQueryResult<ControllingBreakdownRow[]>;
}

export function PayerBillingTreemap({ breakdown }: PayerBillingTreemapProps) {
  const [activeTab, setActiveTab] = useState<'treemap' | 'barchart'>('treemap');
  const [selectedPayer, setSelectedPayer] =
    useState<ControllingPayerTreemapItem | null>(null);
  const [resolvedChartColors, setResolvedChartColors] = useState<string[]>([]);

  const payerMix = useMemo(
    () => aggregatePayerTreemap(breakdown.data ?? []),
    [breakdown.data]
  );

  const grandTotalTrips = useMemo(
    () => payerMix.reduce((sum, p) => sum + p.total_trip_count, 0),
    [payerMix]
  );

  const grandTotalRevenue = useMemo(
    () => payerMix.reduce((sum, p) => sum + p.total_revenue_net, 0),
    [payerMix]
  );

  const allBillingTypes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const payer of payerMix) {
      for (const bt of payer.billing_types) {
        seen.set(bt.billing_type_id, bt.billing_type_name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [payerMix]);

  const stackedBarData = useMemo(
    () =>
      payerMix.map((payer) => {
        const row: Record<string, string | number> = {
          name: payer.payer_name
        };
        for (const { id } of allBillingTypes) {
          const match = payer.billing_types.find(
            (bt) => bt.billing_type_id === id
          );
          row[id] = match?.revenue_net ?? 0;
        }
        return row;
      }),
    [payerMix, allBillingTypes]
  );

  const stackedChartConfig = useMemo(() => {
    const config: ChartConfig = {};
    allBillingTypes.forEach(({ id, name }, i) => {
      config[id] = {
        label: name,
        color: CHART_COLORS[i % CHART_COLORS.length]
      };
    });
    return config;
  }, [allBillingTypes]);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setResolvedChartColors([
      style.getPropertyValue('--chart-1').trim(),
      style.getPropertyValue('--chart-2').trim(),
      style.getPropertyValue('--chart-3').trim(),
      style.getPropertyValue('--chart-4').trim(),
      style.getPropertyValue('--chart-5').trim()
    ]);
  }, []);

  useEffect(() => {
    setSelectedPayer(null);
  }, [breakdown.data]);

  const allPayersTreemapData = useMemo(
    (): TreemapDatum => ({
      name: 'Kostenträger',
      children: payerMix.map((payer) => ({
        name: payer.payer_name,
        value: payer.total_revenue_net,
        payerId: payer.payer_id,
        hasBillingTypes: payer.billing_types.some(
          (bt) => bt.billing_type_id !== '__untyped__'
        ),
        tripPct:
          grandTotalTrips > 0
            ? (payer.total_trip_count / grandTotalTrips) * 100
            : 0,
        revenuePct:
          grandTotalRevenue > 0
            ? (payer.total_revenue_net / grandTotalRevenue) * 100
            : 0
      }))
    }),
    [payerMix, grandTotalTrips, grandTotalRevenue]
  );

  const billingTypesTreemapData = useMemo((): TreemapDatum | null => {
    if (!selectedPayer) return null;
    return {
      name: selectedPayer.payer_name,
      children: selectedPayer.billing_types.map((bt) => ({
        name: bt.billing_type_name,
        value: bt.revenue_net,
        trips: bt.trip_count,
        tripPct:
          selectedPayer.total_trip_count > 0
            ? (bt.trip_count / selectedPayer.total_trip_count) * 100
            : 0,
        revenuePct:
          selectedPayer.total_revenue_net > 0
            ? (bt.revenue_net / selectedPayer.total_revenue_net) * 100
            : 0
      }))
    };
  }, [selectedPayer]);

  function handlePayerClick(node: { data: TreemapDatum; isLeaf: boolean }) {
    if (!node.isLeaf) return;
    const payerId = node.data.payerId;
    if (!payerId) return;
    const payer = payerMix.find((p) => p.payer_id === payerId);
    // '__untyped__' is a synthetic fallback for null billing_type_id — it
    // does not represent a configured Abrechnungsart, so it must not count
    // as a drillable billing type
    if (
      payer &&
      payer.billing_types.some((bt) => bt.billing_type_id !== '__untyped__')
    ) {
      setSelectedPayer(payer);
    }
  }

  if (breakdown.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-56' />
          <Skeleton className='h-4 w-64' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-[320px] w-full' />
        </CardContent>
      </Card>
    );
  }

  if (payerMix.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Umsatz nach Kostenträger</CardTitle>
          <CardDescription>
            Klicken für Aufschlüsselung nach Abrechnungsfamilie
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className='text-muted-foreground py-8 text-center text-sm'>
            Keine Kostenträgerdaten im gewählten Zeitraum
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <CardTitle>
              {activeTab === 'treemap' && selectedPayer
                ? selectedPayer.payer_name
                : 'Umsatz nach Kostenträger'}
            </CardTitle>
            <CardDescription>
              {activeTab === 'treemap' && selectedPayer
                ? 'Umsatz nach Abrechnungsfamilie'
                : activeTab === 'treemap'
                  ? 'Klicken für Aufschlüsselung nach Abrechnungsfamilie'
                  : 'Netto-Umsatz gestapelt nach Abrechnungsfamilie'}
            </CardDescription>
          </div>
          <div className='flex shrink-0 items-center gap-3'>
            {activeTab === 'treemap' && selectedPayer ? (
              <button
                type='button'
                onClick={() => setSelectedPayer(null)}
                className='text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors'
              >
                <ChevronLeft className='h-4 w-4' />
                Alle Kostenträger
              </button>
            ) : null}
            <Tabs
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v as 'treemap' | 'barchart');
                setSelectedPayer(null);
              }}
            >
              <TabsList className='h-8'>
                <TabsTrigger value='treemap' className='px-3 text-xs'>
                  Treemap
                </TabsTrigger>
                <TabsTrigger value='barchart' className='px-3 text-xs'>
                  Balken
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {activeTab === 'treemap' ? (
          selectedPayer && billingTypesTreemapData ? (
            <div style={{ height: 320 }}>
              <ResponsiveTreeMap<TreemapDatum>
                data={billingTypesTreemapData}
                identity='name'
                value='value'
                valueFormat={(value) => formatEuro(Number(value))}
                label={(node) => {
                  const pct = node.data.tripPct;
                  if (typeof pct !== 'number') return String(node.id);
                  return `${node.id} · ${pct.toFixed(1)}%`;
                }}
                labelSkipSize={60}
                labelTextColor='var(--color-foreground)'
                orientLabel={false}
                colors={(node) => {
                  const idx = selectedPayer!.billing_types.findIndex(
                    (bt) =>
                      bt.billing_type_name === node.id ||
                      String(node.id).endsWith(bt.billing_type_name)
                  );
                  const safeIdx = idx >= 0 ? idx : 0;
                  return (
                    resolvedChartColors[safeIdx % resolvedChartColors.length] ||
                    'var(--chart-1)'
                  );
                }}
                borderWidth={2}
                borderColor='var(--color-border)'
                theme={treemapLabelTheme}
                tooltip={BillingTypeTreemapTooltip}
              />
            </div>
          ) : (
            <>
              <div style={{ height: 320 }}>
                <ResponsiveTreeMap<TreemapDatum>
                  data={allPayersTreemapData}
                  identity='name'
                  value='value'
                  valueFormat={(value) => formatEuro(Number(value))}
                  label={(node) => {
                    const pct = node.data.tripPct;
                    if (typeof pct !== 'number') return String(node.id);
                    return `${node.id} · ${pct.toFixed(1)}%`;
                  }}
                  labelSkipSize={60}
                  labelTextColor='var(--color-foreground)'
                  orientLabel={false}
                  colors={(node) => {
                    const idx = payerMix.findIndex(
                      (p) => p.payer_id === node.data.payerId
                    );
                    const safeIdx = idx >= 0 ? idx : 0;
                    return (
                      resolvedChartColors[
                        safeIdx % resolvedChartColors.length
                      ] || 'var(--chart-1)'
                    );
                  }}
                  borderWidth={2}
                  borderColor='var(--color-border)'
                  theme={treemapLabelTheme}
                  onClick={(node) => handlePayerClick(node)}
                  tooltip={PayerTreemapTooltip}
                />
              </div>
              <p className='text-muted-foreground mt-2 text-xs'>
                Klicken Sie auf einen Kostenträger um die Abrechnungsarten zu
                sehen.
              </p>
            </>
          )
        ) : (
          <ChartContainer
            config={stackedChartConfig}
            className='aspect-auto w-full'
            style={{ height: 280 }}
          >
            <BarChart data={stackedBarData}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey='name'
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
              />
              <YAxis
                tickFormatter={(v) => formatEuro(v)}
                tickLine={false}
                axisLine={false}
                width={80}
                tick={{ className: 'tabular-nums' }}
              />
              <ChartTooltip
                cursor={{ fill: 'var(--primary)', opacity: 0.05 }}
                content={(props) => (
                  <ChartTooltipContent
                    active={props.active}
                    label={props.label}
                    payload={props.payload?.filter(
                      (p) => Number(p.value) !== 0
                    )}
                    indicator='dashed'
                    formatter={(value, name) => [
                      <span key='value' className='font-medium tabular-nums'>
                        {formatEuro(Number(value))}
                      </span>,
                      stackedChartConfig[name as string]?.label ?? String(name)
                    ]}
                  />
                )}
              />
              {allBillingTypes.map(({ id }, i) => (
                <Bar
                  key={id}
                  dataKey={id}
                  stackId='mix'
                  fill={`var(--color-${id})`}
                  radius={
                    i === allBillingTypes.length - 1
                      ? [4, 4, 0, 0]
                      : [0, 0, 0, 0]
                  }
                />
              ))}
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function PayerTreemapTooltip({ node }: TooltipProps<TreemapDatum>) {
  const hasBillingTypes = node.data.hasBillingTypes ?? false;
  return (
    <div className='bg-background rounded-lg border px-3 py-2 text-sm shadow-md'>
      <p className='font-medium'>{node.id}</p>
      <p className='text-muted-foreground tabular-nums'>
        {formatEuro(node.value)}
      </p>
      <p className='text-muted-foreground tabular-nums'>
        {node.data.revenuePct?.toFixed(1)}% des Umsatzes
      </p>
      <p className='text-muted-foreground tabular-nums'>
        {node.data.tripPct?.toFixed(1)}% der Fahrten
      </p>
      {!hasBillingTypes ? (
        <p className='text-muted-foreground mt-1 text-xs'>
          Keine Abrechnungsarten im Zeitraum
        </p>
      ) : null}
    </div>
  );
}

function BillingTypeTreemapTooltip({ node }: TooltipProps<TreemapDatum>) {
  const trips = node.data.trips ?? 0;
  return (
    <div className='bg-background rounded-lg border px-3 py-2 text-sm shadow-md'>
      <p className='font-medium'>{node.id}</p>
      <p className='text-muted-foreground tabular-nums'>
        {formatEuro(node.value)}
      </p>
      <p className='text-muted-foreground tabular-nums'>
        {node.data.revenuePct?.toFixed(1)}% des Umsatzes
      </p>
      <p className='text-muted-foreground tabular-nums'>
        {node.data.tripPct?.toFixed(1)}% der Fahrten
      </p>
      <p className='text-muted-foreground tabular-nums'>{trips} Fahrten</p>
    </div>
  );
}
