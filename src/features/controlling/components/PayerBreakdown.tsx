'use client';

/**
 * PayerBreakdown — accordion drill-down payer → billing_type → billing_variant.
 *
 * Hierarchy is data-driven from get_controlling_breakdown RPC rows, not hardcoded
 * catalog structure, so sparse historical billing_variant_id data renders correctly.
 */

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { formatEuro, formatInteger, formatKm } from '../lib/controlling-utils';
import type { ControllingBreakdownRow } from '../types/controlling.types';
import type { UseQueryResult } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

interface PayerNode {
  payerId: string;
  payerName: string;
  trip_count: number;
  revenue_net: number;
  revenue_gross: number;
  total_km: number;
  types: Map<string, BillingTypeNode>;
}

interface BillingTypeNode {
  billingTypeId: string;
  billingTypeName: string;
  trip_count: number;
  revenue_net: number;
  revenue_gross: number;
  total_km: number;
  variants: Map<string, BillingVariantNode>;
}

interface BillingVariantNode {
  billingVariantId: string;
  billingVariantName: string;
  trip_count: number;
  revenue_net: number;
  revenue_gross: number;
  total_km: number;
}

function buildPayerTree(rows: ControllingBreakdownRow[]): PayerNode[] {
  const payers = new Map<string, PayerNode>();

  for (const row of rows) {
    const payerId = row.payer_id ?? 'unknown';
    const payerName = row.payer_name ?? 'Unbekannt';
    let payer = payers.get(payerId);
    if (!payer) {
      payer = {
        payerId,
        payerName,
        trip_count: 0,
        revenue_net: 0,
        revenue_gross: 0,
        total_km: 0,
        types: new Map()
      };
      payers.set(payerId, payer);
    }
    payer.trip_count += row.trip_count;
    payer.revenue_net += row.revenue_net;
    payer.revenue_gross += row.revenue_gross;
    payer.total_km += row.total_km;

    if (!row.billing_type_id) continue;

    const typeKey = row.billing_type_id;
    let typeNode = payer.types.get(typeKey);
    if (!typeNode) {
      typeNode = {
        billingTypeId: typeKey,
        billingTypeName: row.billing_type_name ?? '—',
        trip_count: 0,
        revenue_net: 0,
        revenue_gross: 0,
        total_km: 0,
        variants: new Map()
      };
      payer.types.set(typeKey, typeNode);
    }
    typeNode.trip_count += row.trip_count;
    typeNode.revenue_net += row.revenue_net;
    typeNode.revenue_gross += row.revenue_gross;
    typeNode.total_km += row.total_km;

    if (!row.billing_variant_id) continue;

    const variantKey = row.billing_variant_id;
    let variantNode = typeNode.variants.get(variantKey);
    if (!variantNode) {
      variantNode = {
        billingVariantId: variantKey,
        billingVariantName: row.billing_variant_name ?? '—',
        trip_count: 0,
        revenue_net: 0,
        revenue_gross: 0,
        total_km: 0
      };
      typeNode.variants.set(variantKey, variantNode);
    }
    variantNode.trip_count += row.trip_count;
    variantNode.revenue_net += row.revenue_net;
    variantNode.revenue_gross += row.revenue_gross;
    variantNode.total_km += row.total_km;
  }

  return Array.from(payers.values()).sort(
    (a, b) => b.revenue_net - a.revenue_net
  );
}

export interface PayerBreakdownProps {
  breakdown: UseQueryResult<ControllingBreakdownRow[]>;
}

export function PayerBreakdown({ breakdown }: PayerBreakdownProps) {
  const [openPayers, setOpenPayers] = useState<Set<string>>(new Set());
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());

  const payers = useMemo(
    () => buildPayerTree(breakdown.data ?? []),
    [breakdown.data]
  );

  if (breakdown.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-40' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-48 w-full' />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Kostenträger</CardTitle>
        <CardDescription>Abrechnungsfamilie und Unterart</CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='pl-4'>Name</TableHead>
              <TableHead className='text-right'>Fahrten</TableHead>
              <TableHead className='text-right'>Netto</TableHead>
              <TableHead className='text-right'>Brutto</TableHead>
              <TableHead className='text-right'>Ø Preis</TableHead>
              <TableHead className='pr-4 text-right'>km</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payers.map((payer) => {
              const avgPrice =
                payer.trip_count > 0 ? payer.revenue_net / payer.trip_count : 0;
              const hasTypes = payer.types.size > 0;
              const payerOpen = openPayers.has(payer.payerId);

              return (
                <Fragment key={payer.payerId}>
                  <TableRow
                    className={cn(
                      'hover:bg-muted/50 font-medium',
                      hasTypes && 'cursor-pointer select-none'
                    )}
                    onClick={() => {
                      if (!hasTypes) return;
                      setOpenPayers((prev) => {
                        const next = new Set(prev);
                        if (payerOpen) next.delete(payer.payerId);
                        else next.add(payer.payerId);
                        return next;
                      });
                    }}
                  >
                    <TableCell className='pl-4'>
                      <span className='inline-flex items-center gap-2'>
                        {hasTypes ? (
                          payerOpen ? (
                            <ChevronDown className='text-muted-foreground h-3.5 w-3.5' />
                          ) : (
                            <ChevronRight className='text-muted-foreground h-3.5 w-3.5' />
                          )
                        ) : null}
                        {payer.payerName}
                      </span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatInteger(payer.trip_count)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatEuro(payer.revenue_net)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatEuro(payer.revenue_gross)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {formatEuro(avgPrice)}
                    </TableCell>
                    <TableCell className='pr-4 text-right tabular-nums'>
                      {formatKm(payer.total_km)}
                    </TableCell>
                  </TableRow>

                  {payerOpen &&
                    Array.from(payer.types.values()).map((typeNode) => {
                      const typeKey = `${payer.payerId}:${typeNode.billingTypeId}`;
                      const hasVariants = typeNode.variants.size > 0;
                      const typeOpen = openTypes.has(typeKey);
                      const typeAvg =
                        typeNode.trip_count > 0
                          ? typeNode.revenue_net / typeNode.trip_count
                          : 0;

                      return (
                        <Fragment key={typeKey}>
                          <TableRow
                            className={cn(
                              'bg-muted/20',
                              hasVariants &&
                                'hover:bg-muted/40 cursor-pointer select-none'
                            )}
                            onClick={() => {
                              if (!hasVariants) return;
                              setOpenTypes((prev) => {
                                const next = new Set(prev);
                                if (typeOpen) next.delete(typeKey);
                                else next.add(typeKey);
                                return next;
                              });
                            }}
                          >
                            <TableCell className='text-muted-foreground pl-8'>
                              <span className='inline-flex items-center gap-2'>
                                {hasVariants ? (
                                  typeOpen ? (
                                    <ChevronDown className='h-3 w-3' />
                                  ) : (
                                    <ChevronRight className='h-3 w-3' />
                                  )
                                ) : null}
                                {typeNode.billingTypeName}
                              </span>
                            </TableCell>
                            <TableCell className='text-muted-foreground text-right tabular-nums'>
                              {formatInteger(typeNode.trip_count)}
                            </TableCell>
                            <TableCell className='text-muted-foreground text-right tabular-nums'>
                              {formatEuro(typeNode.revenue_net)}
                            </TableCell>
                            <TableCell className='text-muted-foreground text-right tabular-nums'>
                              {formatEuro(typeNode.revenue_gross)}
                            </TableCell>
                            <TableCell className='text-muted-foreground text-right tabular-nums'>
                              {formatEuro(typeAvg)}
                            </TableCell>
                            <TableCell className='text-muted-foreground pr-4 text-right tabular-nums'>
                              {formatKm(typeNode.total_km)}
                            </TableCell>
                          </TableRow>

                          {typeOpen &&
                            Array.from(typeNode.variants.values()).map(
                              (variant) => {
                                const variantAvg =
                                  variant.trip_count > 0
                                    ? variant.revenue_net / variant.trip_count
                                    : 0;
                                return (
                                  <TableRow
                                    key={variant.billingVariantId}
                                    className='bg-muted/10'
                                  >
                                    <TableCell className='text-muted-foreground pl-12 text-sm'>
                                      {variant.billingVariantName}
                                    </TableCell>
                                    <TableCell className='text-muted-foreground text-right text-sm tabular-nums'>
                                      {formatInteger(variant.trip_count)}
                                    </TableCell>
                                    <TableCell className='text-muted-foreground text-right text-sm tabular-nums'>
                                      {formatEuro(variant.revenue_net)}
                                    </TableCell>
                                    <TableCell className='text-muted-foreground text-right text-sm tabular-nums'>
                                      {formatEuro(variant.revenue_gross)}
                                    </TableCell>
                                    <TableCell className='text-muted-foreground text-right text-sm tabular-nums'>
                                      {formatEuro(variantAvg)}
                                    </TableCell>
                                    <TableCell className='text-muted-foreground pr-4 text-right text-sm tabular-nums'>
                                      {formatKm(variant.total_km)}
                                    </TableCell>
                                  </TableRow>
                                );
                              }
                            )}
                        </Fragment>
                      );
                    })}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
