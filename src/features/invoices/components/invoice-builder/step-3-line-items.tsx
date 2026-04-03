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
import { AlertTriangle, ArrowLeft, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import type { BuilderLineItem } from '../../types/invoice.types';

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
  onBack: () => void;
  onNext: () => void;
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
  onBack,
  onNext,
  onUpdatePrice
}: Step3LineItemsProps) {
  // Track which position is being edited (only one at a time)
  const [editingPosition, setEditingPosition] = useState<number | null>(null);
  // Local input value during edit
  const [editValue, setEditValue] = useState('');

  const startEdit = (position: number, currentPrice: number | null) => {
    setEditingPosition(position);
    setEditValue(currentPrice !== null ? String(currentPrice) : '');
  };

  const commitEdit = (position: number) => {
    const parsed = parseFloat(editValue.replace(',', '.'));
    if (!isNaN(parsed)) {
      onUpdatePrice(position, parsed);
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

  return (
    <div className='space-y-4'>
      <div>
        <h2 className='text-lg font-semibold'>Rechnungspositionen prüfen</h2>
        <p className='text-muted-foreground text-sm'>
          {lineItems.length} Fahrten gefunden. Preise können inline bearbeitet
          werden.
        </p>
      </div>

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

      {/* Line items table */}
      <div className='relative max-h-[55vh] overflow-y-auto rounded-md border'>
        <Table>
          <TableHeader className='bg-muted/50 sticky top-0 z-10'>
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
            {lineItems.map((item) => (
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
                  <div className='text-sm font-medium'>{item.description}</div>
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
                  {(item.billing_variant_name || item.kts_document_applies) && (
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
                      onClick={() => startEdit(item.position, item.unit_price)}
                    >
                      {item.unit_price !== null ? (
                        <div className='flex flex-col items-end gap-0.5'>
                          <span>{formatEur(item.unit_price)}</span>
                          {/* Price source badge — shows which source was used
                              'client_price_tag' = from clients.price_tag (highest priority)
                              'trip_price' = from trips.price (fallback) */}
                          {item.price_source && (
                            <Badge
                              variant='outline'
                              className={`px-1.5 py-0 text-[10px] font-normal ${
                                item.price_source === 'client_price_tag'
                                  ? 'border-green-500/30 bg-green-500/10 text-green-700'
                                  : 'border-blue-500/30 bg-blue-500/10 text-blue-700'
                              }`}
                            >
                              {item.price_source === 'client_price_tag'
                                ? 'Kunden-Preis'
                                : 'Fahrt-Preis'}
                            </Badge>
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
                                {w === 'missing_price' ? (
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
            ))}
          </TableBody>

          {/* Running totals */}
          <TableFooter className='sticky bottom-0 z-10'>
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

      {/* Navigation */}
      <div className='flex justify-between'>
        <Button
          type='button'
          variant='ghost'
          onClick={onBack}
          className='gap-2'
        >
          <ArrowLeft className='h-4 w-4' />
          Zurück
        </Button>
        <Button onClick={onNext}>Weiter zur Bestätigung</Button>
      </div>
    </div>
  );
}
