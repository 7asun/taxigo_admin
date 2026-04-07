'use client';

/**
 * step-3-line-items.tsx
 *
 * Invoice builder — Step 3: Line item preview and inline editing.
 *
 * Shows the trips that will be invoiced in an editable table.
 * Key features:
 *   - Warning badges (⚠️) for missing prices or distances
 *   - Inline price editor: click the price cell to edit it
 *   - Running total shown in the table footer
 *   - Items with 'missing_price' are highlighted in amber
 *
 * The user can:
 *   1. Edit unit prices inline before confirming
 *   2. See which items still need attention via warning badges
 *   3. Confirm all items and proceed to step 4
 *
 * ─── Warning color policy ──────────────────────────────────────────────────
 * Uses theme tokens: text-destructive for errors, text-amber-500 for warnings.
 * Amber is acceptable here as a single semantic warning color per design system.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, Info } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatTaxRate } from '../../lib/tax-calculator';
import { getWarningLabel } from '../../lib/invoice-validators';
import {
  lineItemNetAmountForDisplay,
  unitNetFromEditedLineNet
} from '../../lib/line-item-net-display';
import type { BuilderLineItem } from '../../types/invoice.types';

function priceResolutionBadge(
  item: BuilderLineItem
): { label: string; className: string } | null {
  const s = item.price_resolution.strategy_used;
  if (s === 'kts_override') {
    return {
      label: 'KTS · 0 €',
      className:
        'border-blue-500/30 bg-blue-500/10 text-blue-800 dark:text-blue-200'
    };
  }
  if (s === 'client_price_tag') {
    return {
      label: 'Kunden-Preis',
      className:
        'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300'
    };
  }
  if (s === 'trip_price_fallback') {
    return {
      label: 'Fahrt-Preis',
      className:
        'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'
    };
  }
  if (s === 'manual_trip_price') {
    return {
      label: 'Manuell',
      className: 'border-muted-foreground/30 bg-muted/50 text-muted-foreground'
    };
  }
  if (s === 'tiered_km') {
    return {
      label: 'Staffel km',
      className: 'border-violet-500/30 bg-violet-500/10 text-violet-800'
    };
  }
  if (s === 'fixed_below_threshold_then_km') {
    return {
      label: 'Fix + km',
      className: 'border-violet-500/30 bg-violet-500/10 text-violet-800'
    };
  }
  if (s === 'time_based') {
    return {
      label: 'Zeit',
      className: 'border-amber-500/30 bg-amber-500/10 text-amber-900'
    };
  }
  if (s === 'no_price') {
    return null;
  }
  return {
    label: 'Regel',
    className: 'border-muted-foreground/30 bg-muted/40 text-muted-foreground'
  };
}

/** Formats a number as a Euro currency string in German locale. */
function formatEur(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: 'EUR'
  }).format(value);
}

interface Step3LineItemsProps {
  lineItems: BuilderLineItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  missingPrices: boolean;
  isLoadingTrips: boolean;
  /** Called when the user edits a price inline. */
  onUpdatePrice: (position: number, price: number) => void;
}

/**
 * Step 3: Editable line items table with warning badges and running totals.
 */
export function Step3LineItems({
  lineItems,
  subtotal,
  taxAmount,
  total,
  missingPrices,
  isLoadingTrips,
  onUpdatePrice
}: Step3LineItemsProps) {
  // Track which position is being edited (only one at a time)
  const [editingPosition, setEditingPosition] = useState<number | null>(null);
  // Local input value during edit
  const [editValue, setEditValue] = useState('');

  const startEdit = (position: number, item: BuilderLineItem) => {
    setEditingPosition(position);
    const display = lineItemNetAmountForDisplay(item);
    setEditValue(display !== null ? String(display) : '');
  };

  const commitEdit = (position: number) => {
    const item = lineItems.find((i) => i.position === position);
    const parsed = parseFloat(editValue.replace(',', '.'));
    if (!isNaN(parsed) && item) {
      onUpdatePrice(position, unitNetFromEditedLineNet(item, parsed));
    }
    setEditingPosition(null);
  };

  if (isLoadingTrips) {
    return (
      <div className='text-muted-foreground py-12 text-center text-sm'>
        Fahrten werden geladen…
      </div>
    );
  }

  const ktsLineCount = lineItems.filter((i) => i.kts_document_applies).length;
  const noInvLineCount = lineItems.filter((i) => i.no_invoice_warning).length;

  return (
    <div className='space-y-4'>
      {lineItems.length > 0 ? (
        <p className='text-muted-foreground text-sm'>
          {lineItems.length} Fahrten gefunden. Preise können inline bearbeitet
          werden.
        </p>
      ) : null}

      {/* Missing price warning banner */}
      {missingPrices && (
        <Alert>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>
            <strong>Preise fehlen:</strong> Einige Positionen haben noch keinen
            Preis. Bitte fehlende Preise eintragen, bevor Sie fortfahren.
          </AlertDescription>
        </Alert>
      )}

      {ktsLineCount > 0 && (
        <Alert className='border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30'>
          <Info className='h-4 w-4 text-blue-600 dark:text-blue-400' />
          <AlertDescription className='text-blue-900 dark:text-blue-100'>
            <strong>Krankentransportschein (KTS):</strong> Diese Rechnung
            enthält {ktsLineCount} {ktsLineCount === 1 ? 'Fahrt' : 'Fahrten'},
            die im System als KTS-relevant markiert sind. Bitte prüfen Sie
            Bescheinigung und Abrechnung vor dem Versand.
          </AlertDescription>
        </Alert>
      )}

      {noInvLineCount > 0 && (
        <Alert className='border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30'>
          <AlertTriangle className='h-4 w-4 text-amber-600 dark:text-amber-400' />
          <AlertDescription>
            <strong>Keine Rechnung:</strong> {noInvLineCount}{' '}
            {noInvLineCount === 1 ? 'Fahrt ist' : 'Fahrten sind'} als „keine
            Rechnung“ markiert. Bitte prüfen, ob diese Positionen wirklich auf
            die Rechnung gehören.
          </AlertDescription>
        </Alert>
      )}

      {/* Line items table */}
      <div className='max-h-[320px] overflow-x-auto overflow-y-auto rounded-md border'>
        <Table>
          <TableHeader className='bg-muted'>
            <TableRow>
              <TableHead className='w-8'>#</TableHead>
              <TableHead>Beschreibung</TableHead>
              <TableHead>Strecke</TableHead>
              <TableHead>MwSt</TableHead>
              <TableHead className='text-right'>Preis</TableHead>
              <TableHead className='w-16'></TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {lineItems.map((item) => {
              const displayNet = lineItemNetAmountForDisplay(item);
              return (
                <TableRow
                  key={item.position}
                  // Amber highlight for items still missing a price
                  className={
                    item.warnings.includes('missing_price')
                      ? 'bg-amber-500/5'
                      : undefined
                  }
                >
                  {/* Position number */}
                  <TableCell className='text-muted-foreground text-xs'>
                    {item.position}
                  </TableCell>

                  {/* Description + date + addresses */}
                  <TableCell>
                    <div className='text-sm font-medium'>
                      {item.description}
                    </div>
                    {item.line_date && (
                      <div className='text-muted-foreground text-xs'>
                        {format(new Date(item.line_date), 'EEE, dd.MM.yyyy', {
                          locale: de
                        })}
                      </div>
                    )}
                    {item.pickup_address && item.dropoff_address && (
                      <div className='text-muted-foreground bg-muted/40 mt-1 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs'>
                        <span className='max-w-[150px] truncate'>
                          {item.pickup_address}
                        </span>
                        <span className='opacity-50'>→</span>
                        <span className='max-w-[150px] truncate'>
                          {item.dropoff_address}
                        </span>
                      </div>
                    )}
                    {(item.billing_variant_name ||
                      item.kts_document_applies ||
                      item.no_invoice_warning) && (
                      <div className='mt-1 flex flex-wrap gap-1'>
                        {item.billing_variant_name && (
                          <Badge
                            variant='outline'
                            className='px-1.5 py-0 text-[10px] font-normal'
                          >
                            {item.billing_variant_name}
                          </Badge>
                        )}
                        {item.kts_document_applies && (
                          <Badge
                            variant='secondary'
                            className='px-1.5 py-0 text-[10px] font-normal'
                            title='Krankentransportschein (KTS) — laut Fahrt markiert'
                          >
                            KTS
                          </Badge>
                        )}
                        {item.no_invoice_warning && (
                          <Badge
                            variant='outline'
                            className='border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-normal text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
                            title='Fahrt: keine Rechnung erforderlich'
                          >
                            Keine Rechn.
                          </Badge>
                        )}
                      </div>
                    )}
                  </TableCell>

                  {/* Distance */}
                  <TableCell className='text-sm'>
                    {item.distance_km !== null
                      ? `${item.distance_km.toFixed(1)} km`
                      : '—'}
                  </TableCell>

                  {/* Tax rate */}
                  <TableCell className='text-sm'>
                    {formatTaxRate(item.tax_rate)}
                  </TableCell>

                  {/* Price — shows source badge when resolved automatically */}
                  <TableCell className='text-right'>
                    {editingPosition === item.position ? (
                      <Input
                        autoFocus
                        type='number'
                        step='0.01'
                        min='0'
                        value={editValue}
                        className='h-7 w-24 text-right text-sm'
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitEdit(item.position)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit(item.position);
                          if (e.key === 'Escape') setEditingPosition(null);
                        }}
                      />
                    ) : (
                      <button
                        type='button'
                        className='hover:bg-muted rounded px-2 py-0.5 text-right text-sm'
                        onClick={() => startEdit(item.position, item)}
                      >
                        {displayNet !== null ? (
                          <div className='flex flex-col items-end gap-0.5'>
                            <span>{formatEur(displayNet)}</span>
                            {(() => {
                              const b = priceResolutionBadge(item);
                              return b ? (
                                <Badge
                                  variant='outline'
                                  className={`px-1.5 py-0 text-[10px] font-normal ${b.className}`}
                                  title={
                                    item.price_resolution.note
                                      ? item.price_resolution.note
                                      : undefined
                                  }
                                >
                                  {b.label}
                                </Badge>
                              ) : null;
                            })()}
                            {item.approach_fee_net != null &&
                              item.approach_fee_net > 0 && (
                                <span
                                  className='text-muted-foreground text-xs'
                                  title='Anfahrtspreis gemäß Abrechnungsregel'
                                >
                                  + {formatEur(item.approach_fee_net)} Anfahrt
                                </span>
                              )}
                          </div>
                        ) : (
                          <span className='font-medium text-amber-500'>
                            Fehlt
                          </span>
                        )}
                      </button>
                    )}
                  </TableCell>

                  {/* Warning badges */}
                  <TableCell>
                    {item.warnings.length > 0 && (
                      <TooltipProvider>
                        <div className='flex gap-1'>
                          {item.warnings.map((w) => (
                            <Tooltip key={w}>
                              <TooltipTrigger asChild>
                                <div className='cursor-help text-amber-500'>
                                  {w === 'missing_price' ||
                                  w === 'no_invoice_trip' ? (
                                    <AlertTriangle className='h-4 w-4' />
                                  ) : (
                                    <Info className='h-4 w-4' />
                                  )}
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className='text-xs'>{getWarningLabel(w)}</p>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </div>
                      </TooltipProvider>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>

          {/* Running totals */}
          <TableFooter className='bg-muted'>
            <TableRow>
              <TableCell colSpan={4} className='text-sm font-medium'>
                Netto
              </TableCell>
              <TableCell className='text-right text-sm font-medium'>
                {formatEur(subtotal)}
              </TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell colSpan={4} className='text-muted-foreground text-sm'>
                MwSt
              </TableCell>
              <TableCell className='text-muted-foreground text-right text-sm'>
                {formatEur(taxAmount)}
              </TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell colSpan={4} className='text-base font-bold'>
                Brutto
              </TableCell>
              <TableCell className='text-right text-base font-bold'>
                {formatEur(total)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
