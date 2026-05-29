'use client';

/**
 * step-3-line-items.tsx
 *
 * Invoice builder — Step 3: Line item preview and gross-first inline editing.
 *
 * Badges: “Taxameter” for persisted `manual_gross_price` (source) or in-session
 * gross override — “Manuell” only for catalog `manual_trip_price` without those.
 *
 * Collapsible card rows (no horizontal table scroll) inside the fixed-width
 * builder column. Bruttopreis is always an `<Input>` in the collapsed row; the
 * detail panel (Anfahrt, breakdown, badges) opens only via the chevron — not on
 * price focus — so quick price edits stay compact.
 *
 * ─── Warning color policy ──────────────────────────────────────────────────
 * Uses theme tokens: text-destructive for errors, text-amber-500 for warnings.
 * Amber is acceptable here as a single semantic warning color per design system.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { AlertTriangle, ChevronDown, Info, Map, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { formatTaxRate } from '../../lib/tax-calculator';
import { getWarningLabel } from '../../lib/invoice-validators';
import {
  lineItemGrossTotalForDisplay,
  cancelledTripGrossTotalForDisplay
} from '../../lib/line-item-net-display';
import type {
  BuilderLineItem,
  BuilderCancelledTripRow
} from '../../types/invoice.types';

type EditingState = {
  position: number;
  grossValue: string;
  approachValue: string;
} | null;

type KmEditingState = { position: number; value: string } | null;

function priceResolutionBadge(
  item: BuilderLineItem
): { label: string; className: string } | null {
  // Taxameter: fare on the trip row (source) or Brutto typed this session (override) — same label.
  const taxameterBadge =
    item.price_resolution.source === 'manual_gross_price' ||
    item.isManualOverride;
  if (taxameterBadge) {
    return {
      label: 'Taxameter',
      className:
        'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
    };
  }
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

// why: currency `formatEur` adds € and is for read-only amounts; inputs need plain de-DE decimals only.
function formatEurInput(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

interface Step3LineItemsProps {
  lineItems: BuilderLineItem[];
  /** Cancelled trips — shown in the Stornierte Fahrten section below normal rows. */
  cancelledTrips: BuilderCancelledTripRow[];
  subtotal: number;
  taxAmount: number;
  total: number;
  missingPrices: boolean;
  /** True when any inclusion reason is missing — gates "Weiter zu PDF-Vorlage". */
  hasInclusionErrors: boolean;
  isLoadingTrips: boolean;
  /** Advances to PDF-Vorlage after review; sets `section3Confirmed` in the builder hook. */
  onConfirm: () => void;
  /** Called when the admin commits a gross override for a line item. */
  onApplyGrossOverride: (
    position: number,
    grossTotal: number,
    approachFeeGross: number
  ) => void;
  /** Called when the admin resets a manual override back to engine-computed price. */
  onResetOverride: (position: number) => void;
  onApplyKmOverride: (position: number, km: number) => void;
  onResetKmOverride: (position: number) => void;
  onLineItemInclusionChange: (
    position: number,
    included: boolean,
    reason: string
  ) => void;
  onCancelledTripInclusionChange: (
    tripId: string,
    included: boolean,
    reason: string
  ) => void;
  onCancelledTripGrossOverride: (
    tripId: string,
    grossTotal: number,
    approachFeeGross: number
  ) => void;
  onCancelledTripKmOverride: (tripId: string, km: number) => void;
  onCancelledTripApproachFeeChange: (tripId: string, include: boolean) => void;
}

/**
 * Step 3: Collapsible line items with gross-first inline price editing.
 */
export function Step3LineItems({
  lineItems,
  cancelledTrips,
  subtotal,
  taxAmount,
  total,
  missingPrices,
  hasInclusionErrors,
  isLoadingTrips,
  onConfirm,
  onApplyGrossOverride,
  onResetOverride,
  onApplyKmOverride,
  onResetKmOverride,
  onLineItemInclusionChange,
  onCancelledTripInclusionChange,
  onCancelledTripGrossOverride,
  onCancelledTripKmOverride,
  onCancelledTripApproachFeeChange
}: Step3LineItemsProps) {
  const [editing, setEditing] = useState<EditingState>(null);
  const [kmEditing, setKmEditing] = useState<KmEditingState>(null);
  /** Controlled editing state for gross input on opted-in cancelled trip rows. */
  const [cancelledGrossEditing, setCancelledGrossEditing] = useState<{
    tripId: string;
    value: string;
  } | null>(null);
  /** Opt-out dialog state for normal trips. */
  const [optOutDialog, setOptOutDialog] = useState<{
    item: BuilderLineItem;
    reason: string;
  } | null>(null);
  /** Cancelled trips section open/close state. */
  const [cancelledOpen, setCancelledOpen] = useState(false);
  // Per-row `Collapsible` + `Set`: multiple rows may stay open so the admin
  // can compare two trips side-by-side. Accordion `type="single"` would close
  // the other row and is intentionally avoided.
  const [openRows, setOpenRows] = useState<Set<number>>(() => new Set());
  const [showScrollFade, setShowScrollFade] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const editingRef = useRef<EditingState>(null);
  const kmEditingRef = useRef<KmEditingState>(null);
  const kmCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const update = () => {
      setShowScrollFade(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    };

    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [lineItems, openRows]);

  // Guard: same-row only — defer commit on blur so Bruttopreis ↔ Anfahrt tabbing
  // does not commit mid-edit; clearing the timer on focus **must** be gated by row
  // position, otherwise focusing another row's input cancels row A's pending commit.
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginKmEditing = (item: BuilderLineItem) => {
    const value =
      item.effective_distance_km != null
        ? String(item.effective_distance_km)
        : '';
    const newState = { position: item.position, value };
    kmEditingRef.current = newState;
    setKmEditing(newState);
  };

  const cancelKmEdit = () => {
    if (kmCommitTimerRef.current) clearTimeout(kmCommitTimerRef.current);
    kmEditingRef.current = null;
    setKmEditing(null);
  };

  const commitKmEdit = (state: KmEditingState) => {
    if (!state) return;
    const parsed = parseFloat(state.value.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      cancelKmEdit();
      return;
    }
    onApplyKmOverride(state.position, parsed);
    kmEditingRef.current = null;
    setKmEditing(null);
  };

  const handleKmBlur = (state: KmEditingState) => {
    kmCommitTimerRef.current = setTimeout(() => {
      commitKmEdit(state);
    }, 0);
  };

  const handleKmFocus = (focusedPosition: number) => {
    if (
      kmCommitTimerRef.current &&
      kmEditingRef.current?.position === focusedPosition
    ) {
      clearTimeout(kmCommitTimerRef.current);
    }
  };

  const blurKmIfThisRow = (position: number) => {
    const snap = kmEditingRef.current;
    if (snap?.position === position) handleKmBlur(snap);
  };

  const commitKmIfThisRow = (position: number) => {
    if (kmCommitTimerRef.current) clearTimeout(kmCommitTimerRef.current);
    const snap = kmEditingRef.current;
    if (snap?.position === position) commitKmEdit(snap);
  };

  // Blur reads `editingRef.current`, kept in sync synchronously with `setEditing`
  // so the first focus→blur before paint never sees a stale null.
  const ensureRowOpen = (position: number) => {
    setOpenRows((prev) => {
      if (prev.has(position)) return prev;
      const next = new Set(prev);
      next.add(position);
      return next;
    });
  };

  const beginEditing = (item: BuilderLineItem) => {
    const grossDisplay = lineItemGrossTotalForDisplay(item);
    const grossValue =
      grossDisplay !== null ? formatEurInput(grossDisplay) : '';
    const approachValue =
      item.approach_fee_gross != null && item.approach_fee_gross !== undefined
        ? formatEurInput(item.approach_fee_gross)
        : '';
    const newState = {
      position: item.position,
      grossValue,
      approachValue
    };
    editingRef.current = newState;
    setEditing(newState);
  };

  const cancelEdit = () => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    editingRef.current = null;
    setEditing(null);
  };

  const commitEdit = (state: EditingState) => {
    if (!state) return;
    const { position, grossValue, approachValue } = state;
    const gross = parseFloat(grossValue.replace(',', '.'));
    const approach = parseFloat(approachValue.replace(',', '.'));
    if (!isNaN(gross)) {
      onApplyGrossOverride(position, gross, isNaN(approach) ? 0 : approach);
    }
    editingRef.current = null;
    setEditing(null);
  };

  const handleBlur = (state: EditingState) => {
    commitTimerRef.current = setTimeout(() => {
      commitEdit(state);
    }, 0);
  };

  const handleFocus = (focusedPosition: number) => {
    if (
      commitTimerRef.current &&
      editingRef.current?.position === focusedPosition
    ) {
      clearTimeout(commitTimerRef.current);
    }
  };

  const blurIfThisRow = (position: number) => {
    const snap = editingRef.current;
    if (snap?.position === position) handleBlur(snap);
  };

  const commitIfThisRow = (position: number) => {
    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    const snap = editingRef.current;
    if (snap?.position === position) commitEdit(snap);
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
    <TooltipProvider>
      <div className='space-y-4'>
        {lineItems.length > 0 ? (
          <p className='text-muted-foreground text-sm'>
            {lineItems.length} Fahrten gefunden. Bruttopreis und Anfahrt können
            bearbeitet werden.
          </p>
        ) : null}

        {missingPrices && (
          <Alert>
            <AlertTriangle className='h-4 w-4' />
            <AlertDescription>
              <strong>Preise fehlen:</strong> Einige Positionen haben noch
              keinen Preis. Bitte fehlende Preise eintragen, bevor Sie
              fortfahren.
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
              Rechnung" markiert. Bitte prüfen, ob diese Positionen wirklich auf
              die Rechnung gehören.
            </AlertDescription>
          </Alert>
        )}

        <div className='flex flex-col overflow-hidden rounded-md border'>
          <div className='relative'>
            <div
              ref={scrollContainerRef}
              className='divide-border max-h-[calc(100vh-20rem)] divide-y overflow-x-hidden overflow-y-auto'
            >
              {lineItems.map((item) => {
                const isEditingThisRow = editing?.position === item.position;
                const isKmEditingThisRow =
                  kmEditing?.position === item.position;
                const grossDisplay = lineItemGrossTotalForDisplay(item);
                const badge = priceResolutionBadge(item);
                // Chevron only: editing Bruttopreis in the collapsed row does not
                // open the panel — expand first when Anfahrt or full detail is needed.
                const expanded = openRows.has(item.position);

                // Radix passes the desired open state; we only drop from `openRows`
                // on close when not editing price/Anfahrt and not editing KM — otherwise
                // draft values would desync from controlled `open`.
                const handleCollapsibleOpenChange = (next: boolean) => {
                  if (next) {
                    ensureRowOpen(item.position);
                  } else if (!isEditingThisRow && !isKmEditingThisRow) {
                    setOpenRows((prev) => {
                      const n = new Set(prev);
                      n.delete(item.position);
                      return n;
                    });
                  }
                };

                const grossInputValue =
                  isEditingThisRow && editing
                    ? editing.grossValue
                    : grossDisplay !== null
                      ? formatEurInput(grossDisplay)
                      : '';
                const approachInputValue =
                  isEditingThisRow && editing
                    ? editing.approachValue
                    : item.approach_fee_gross != null &&
                        item.approach_fee_gross !== undefined
                      ? formatEurInput(item.approach_fee_gross)
                      : '';

                const kmInputValue =
                  isKmEditingThisRow && kmEditing
                    ? kmEditing.value
                    : item.effective_distance_km != null
                      ? String(item.effective_distance_km)
                      : '';

                // why: three border states so missing price (destructive) wins over manual amber, not just override vs default.
                const leftBorderClass =
                  grossDisplay === null || grossDisplay === undefined
                    ? 'border-destructive'
                    : item.isManualOverride
                      ? 'border-amber-400'
                      : 'border-transparent';

                const isOptedOut = !item.billingInclusion.included;

                return (
                  <Collapsible
                    key={item.position}
                    open={expanded}
                    onOpenChange={handleCollapsibleOpenChange}
                  >
                    <div
                      className={cn(
                        'relative',
                        item.warnings.includes('missing_price') &&
                          !isOptedOut &&
                          'bg-amber-500/5',
                        isOptedOut && 'opacity-60',
                        // Always reserve border width so toggling override does not shift layout.
                        'border-l-2',
                        leftBorderClass
                      )}
                    >
                      <div
                        className={cn(
                          'grid grid-cols-[auto_1fr_auto_auto] items-start gap-x-3 px-4 py-2.5 pr-9 transition-colors'
                        )}
                      >
                        {/* Opt-out checkbox — leftmost column */}
                        <div className='flex items-center pt-0.5'>
                          <Checkbox
                            checked={item.billingInclusion.included}
                            aria-label={
                              isOptedOut
                                ? 'Fahrt wieder einschließen'
                                : 'Fahrt aus Rechnung ausschließen'
                            }
                            onClick={(e) => e.stopPropagation()}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                // Re-include immediately — no dialog
                                onLineItemInclusionChange(
                                  item.position,
                                  true,
                                  ''
                                );
                              } else {
                                // Open dialog for mandatory reason
                                setOptOutDialog({ item, reason: '' });
                              }
                            }}
                          />
                        </div>

                        <div className='flex min-w-0 flex-col'>
                          <div className='flex items-center gap-1.5'>
                            <span className='text-foreground text-sm font-medium tabular-nums'>
                              #{item.position}
                            </span>
                            {item.pickup_address != null &&
                            item.pickup_address !== '' &&
                            item.dropoff_address != null &&
                            item.dropoff_address !== '' ? (
                              // why: client-side Google Maps directions URL — no API key; only when both addresses exist
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <a
                                    href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(item.pickup_address)}&destination=${encodeURIComponent(item.dropoff_address)}`}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    aria-label='Route in Google Maps öffnen'
                                    className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors'
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Map className='h-3.5 w-3.5' />
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className='text-xs'>
                                    Route in Google Maps öffnen
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                          <span className='text-muted-foreground truncate text-xs'>
                            {item.client_name ?? '—'}
                          </span>
                          <span className='text-muted-foreground text-xs'>
                            {item.line_date
                              ? format(
                                  new Date(item.line_date),
                                  'EEE, dd.MM.yyyy',
                                  { locale: de }
                                )
                              : '—'}
                          </span>
                          {isOptedOut && (
                            <div className='mt-0.5 flex items-center gap-1'>
                              <Badge
                                variant='outline'
                                className='h-4 border-amber-400 px-1 text-[10px] text-amber-700'
                              >
                                Ausgeschlossen
                              </Badge>
                              {item.billingInclusion.reason && (
                                <span className='truncate text-[10px] text-amber-600'>
                                  {item.billingInclusion.reason}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className='flex min-w-24 flex-col items-end gap-1'>
                          {/* why: same min-h as price column meta row so both inputs start at the same y. */}
                          <div className='flex min-h-4 w-full items-center justify-end'>
                            <span className='text-muted-foreground text-[10px] whitespace-nowrap tabular-nums'>
                              {item.original_distance_km != null
                                ? `${item.original_distance_km.toFixed(1)} km`
                                : item.distance_km != null
                                  ? `${item.distance_km.toFixed(1)} km`
                                  : '—'}
                            </span>
                          </div>
                          {item.manual_km_enabled ? (
                            <div className='flex items-center gap-1'>
                              <Input
                                type='text'
                                inputMode='decimal'
                                aria-label='Manuelle Distanz in km'
                                className='h-7 w-24 shrink-0 text-right text-sm tabular-nums'
                                value={kmInputValue}
                                placeholder='km'
                                onFocus={() => {
                                  handleKmFocus(item.position);
                                  if (!isKmEditingThisRow) beginKmEditing(item);
                                }}
                                onChange={(e) => {
                                  if (isKmEditingThisRow) {
                                    setKmEditing((prev) => {
                                      const next = prev
                                        ? { ...prev, value: e.target.value }
                                        : prev;
                                      kmEditingRef.current = next;
                                      return next;
                                    });
                                  } else {
                                    const next = {
                                      position: item.position,
                                      value: e.target.value
                                    };
                                    kmEditingRef.current = next;
                                    setKmEditing(next);
                                  }
                                }}
                                onBlur={() => blurKmIfThisRow(item.position)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitKmIfThisRow(item.position);
                                  }
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    cancelKmEdit();
                                  }
                                }}
                              />
                              <span className='text-muted-foreground shrink-0 text-[10px]'>
                                km
                              </span>
                            </div>
                          ) : null}
                          {item.isManualKmOverride ? (
                            <div className='flex items-center gap-1'>
                              <Badge
                                variant='outline'
                                className='h-4 border-amber-400 px-1 text-[10px] text-amber-600'
                              >
                                KM manuell
                              </Badge>
                              <button
                                type='button'
                                aria-label='Manuellen KM zurücksetzen'
                                className='text-muted-foreground hover:text-foreground'
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelKmEdit();
                                  onResetKmOverride(item.position);
                                }}
                              >
                                <X className='h-3 w-3' />
                              </button>
                            </div>
                          ) : null}
                        </div>

                        <div className='flex shrink-0 flex-col items-end gap-1'>
                          <div className='flex min-h-4 items-center justify-end gap-1'>
                            {(item.isManualOverride ||
                              item.price_resolution.source ===
                                'manual_gross_price') && (
                              <>
                                <Badge
                                  variant='outline'
                                  className='h-4 border-amber-400 px-1 text-[10px] text-amber-600'
                                >
                                  Taxameter
                                </Badge>
                                {item.isManualOverride && (
                                  <button
                                    type='button'
                                    aria-label='Taxameter-Preis zurücksetzen'
                                    className='text-muted-foreground hover:text-foreground'
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onResetOverride(item.position);
                                    }}
                                  >
                                    <X className='h-3 w-3' />
                                  </button>
                                )}
                              </>
                            )}
                            {item.warnings.length > 0 && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type='button'
                                    className='text-amber-500'
                                    aria-label='Hinweise zu dieser Position'
                                  >
                                    <AlertTriangle className='h-3.5 w-3.5 shrink-0' />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className='text-xs'>
                                    {item.warnings
                                      .map((w) => getWarningLabel(w))
                                      .join(' · ')}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>

                          {/* why: `type="number"` rejects comma decimals in HTML; text + inputMode keeps de-DE typing and we parse in commitEdit. */}
                          <Input
                            type='text'
                            inputMode='decimal'
                            aria-label='Bruttopreis'
                            className='h-7 w-24 shrink-0 text-right text-sm tabular-nums'
                            value={grossInputValue}
                            placeholder='Betrag'
                            onFocus={() => {
                              handleFocus(item.position);
                              if (!isEditingThisRow) beginEditing(item);
                            }}
                            onChange={(e) => {
                              if (isEditingThisRow) {
                                setEditing((prev) => {
                                  const next = prev
                                    ? { ...prev, grossValue: e.target.value }
                                    : prev;
                                  editingRef.current = next;
                                  return next;
                                });
                              } else {
                                const next = {
                                  position: item.position,
                                  grossValue: e.target.value,
                                  approachValue:
                                    item.approach_fee_gross != null &&
                                    item.approach_fee_gross !== undefined
                                      ? formatEurInput(item.approach_fee_gross)
                                      : ''
                                };
                                editingRef.current = next;
                                setEditing(next);
                              }
                            }}
                            onBlur={() => blurIfThisRow(item.position)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitIfThisRow(item.position);
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                cancelEdit();
                              }
                            }}
                          />
                        </div>
                      </div>

                      <CollapsibleTrigger asChild>
                        <button
                          type='button'
                          aria-label={
                            expanded ? 'Weniger anzeigen' : 'Mehr anzeigen'
                          }
                          aria-expanded={expanded}
                          className='text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded p-0.5'
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 transition-transform duration-200',
                              expanded && 'rotate-180'
                            )}
                          />
                        </button>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className='bg-muted/30 border-border space-y-2 border-t px-4 pt-2 pb-3'>
                          <div className='text-muted-foreground grid grid-cols-2 gap-x-3 border-b pb-3 text-sm'>
                            <span className='truncate'>
                              {item.pickup_address ?? '—'}
                            </span>
                            <span className='truncate'>
                              {item.dropoff_address ?? '—'}
                            </span>
                          </div>
                          <div className='flex flex-wrap items-center gap-2'>
                            {item.line_date && (
                              <span className='text-muted-foreground text-xs'>
                                {format(new Date(item.line_date), 'HH:mm')} Uhr
                              </span>
                            )}
                            {badge && (
                              <Badge
                                variant='outline'
                                className={cn(
                                  'h-4 px-1 text-[10px]',
                                  badge.className
                                )}
                                title={
                                  item.price_resolution.note
                                    ? item.price_resolution.note
                                    : undefined
                                }
                              >
                                {badge.label}
                              </Badge>
                            )}
                            <span className='text-muted-foreground text-xs'>
                              MwSt {formatTaxRate(item.tax_rate)}
                            </span>
                          </div>

                          {(item.billing_variant_name ||
                            item.kts_document_applies ||
                            item.no_invoice_warning) && (
                            <div className='flex flex-wrap gap-1'>
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

                          <div className='flex flex-wrap items-center gap-2'>
                            <span className='text-muted-foreground w-36 shrink-0 text-xs'>
                              Anfahrtskosten (brutto)
                            </span>
                            <Input
                              type='text'
                              inputMode='decimal'
                              aria-label='Anfahrtskosten brutto'
                              className='h-7 w-24 text-right text-sm tabular-nums'
                              value={approachInputValue}
                              placeholder='0,00'
                              onFocus={() => {
                                handleFocus(item.position);
                                if (!isEditingThisRow) beginEditing(item);
                              }}
                              onChange={(e) => {
                                if (isEditingThisRow) {
                                  setEditing((prev) => {
                                    const next = prev
                                      ? {
                                          ...prev,
                                          approachValue: e.target.value
                                        }
                                      : prev;
                                    editingRef.current = next;
                                    return next;
                                  });
                                } else {
                                  const next = {
                                    position: item.position,
                                    grossValue:
                                      grossDisplay !== null
                                        ? formatEurInput(grossDisplay)
                                        : '',
                                    approachValue: e.target.value
                                  };
                                  editingRef.current = next;
                                  setEditing(next);
                                }
                              }}
                              onBlur={() => blurIfThisRow(item.position)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  commitIfThisRow(item.position);
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  cancelEdit();
                                }
                              }}
                            />
                            {item.isManualOverride &&
                              item.originalPriceResolution?.gross != null && (
                                <span className='text-muted-foreground text-[10px]'>
                                  War:{' '}
                                  {formatEur(
                                    item.originalPriceResolution.gross
                                  )}
                                </span>
                              )}
                          </div>

                          {expanded &&
                            (() => {
                              // why: show net/VAT receipt whenever the row is open for review, not only while the user is typing.
                              const g =
                                isEditingThisRow && editing
                                  ? parseFloat(
                                      editing.grossValue.replace(',', '.')
                                    )
                                  : (lineItemGrossTotalForDisplay(item) ?? 0);
                              const a =
                                isEditingThisRow && editing
                                  ? parseFloat(
                                      editing.approachValue.replace(',', '.')
                                    )
                                  : (item.approach_fee_gross ?? 0);

                              if (isNaN(g) || g === 0) return null;

                              const rate = item.tax_rate;
                              const approachGross = isNaN(a) ? 0 : a;
                              const transportNet =
                                item.price_resolution?.net !== null &&
                                item.price_resolution?.net !== undefined
                                  ? item.price_resolution.net
                                  : (g - approachGross) / (1 + rate);
                              // why: price_resolution.net is the authoritative transport net
                              // from the resolver (e.g. tieredNetTotal). Back-deriving from the
                              // cent-rounded line gross loses precision: (48.52 − 4.07) / 1.07
                              // = 41.542, not the resolver's 41.55. Net must be read directly,
                              // never reverse-engineered from gross.
                              const approachNet = approachGross / (1 + rate);
                              const totalNet = transportNet + approachNet;
                              const vat = g - totalNet;

                              return (
                                <div className='bg-muted/40 mt-2 space-y-0.5 rounded-md px-3 py-2 text-xs'>
                                  <div className='flex justify-between'>
                                    <span className='text-muted-foreground'>
                                      Netto (Fahrt)
                                    </span>
                                    <span>{formatEur(transportNet)}</span>
                                  </div>
                                  {approachGross > 0 && (
                                    <div className='flex justify-between'>
                                      <span className='text-muted-foreground'>
                                        Netto (Anfahrt)
                                      </span>
                                      <span>{formatEur(approachNet)}</span>
                                    </div>
                                  )}
                                  <div className='flex justify-between'>
                                    <span className='text-muted-foreground'>
                                      MwSt ({formatTaxRate(item.tax_rate)})
                                    </span>
                                    <span>{formatEur(vat)}</span>
                                  </div>
                                  <div className='border-border flex justify-between border-t pt-1 font-medium'>
                                    <span>Gesamt brutto</span>
                                    <span>{formatEur(g)}</span>
                                  </div>
                                </div>
                              );
                            })()}

                          {item.warnings.length > 0 && (
                            <div className='flex flex-wrap gap-1'>
                              {item.warnings.map((w) => (
                                <span
                                  key={w}
                                  className='inline-flex items-center gap-1 text-[10px] text-amber-600'
                                >
                                  <AlertTriangle className='h-3 w-3 shrink-0' />
                                  {getWarningLabel(w)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
            {showScrollFade && (
              <div
                className='from-background pointer-events-none absolute right-0 bottom-0 left-0 h-8 bg-gradient-to-t to-transparent'
                aria-hidden
              />
            )}
          </div>

          <div className='bg-background/95 border-border flex shrink-0 justify-end gap-6 border-t px-4 py-2 text-sm tabular-nums backdrop-blur-sm'>
            <span className='text-muted-foreground'>
              Netto{' '}
              <span className='text-foreground font-medium'>
                {formatEur(subtotal)}
              </span>
            </span>
            <span className='text-muted-foreground'>
              MwSt{' '}
              <span className='text-foreground font-medium'>
                {formatEur(taxAmount)}
              </span>
            </span>
            <span className='text-muted-foreground'>
              Brutto{' '}
              <span className='text-foreground font-semibold'>
                {formatEur(total)}
              </span>
            </span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              {/* why: disabled buttons don't fire mouse events, so the trigger must wrap a non-disabled element. */}
              <span
                className={cn(
                  'mt-3 block w-full',
                  (missingPrices || hasInclusionErrors) && 'cursor-not-allowed'
                )}
              >
                <Button
                  type='button'
                  onClick={onConfirm}
                  className='w-full'
                  disabled={
                    missingPrices ||
                    hasInclusionErrors ||
                    lineItems.length === 0
                  }
                >
                  Weiter zu PDF-Vorlage
                </Button>
              </span>
            </TooltipTrigger>
            {hasInclusionErrors ? (
              <TooltipContent>
                Bitte Begründung für alle ausgeschlossenen / stornierten Fahrten
                eintragen.
              </TooltipContent>
            ) : missingPrices ? (
              <TooltipContent>
                Bitte alle fehlenden Preise eintragen, bevor Sie fortfahren.
              </TooltipContent>
            ) : null}
          </Tooltip>
        </div>

        {/* ── Stornierte Fahrten section ─────────────────────────────────── */}
        {cancelledTrips.length > 0 && (
          <Collapsible open={cancelledOpen} onOpenChange={setCancelledOpen}>
            <div className='rounded-md border'>
              <CollapsibleTrigger asChild>
                <button
                  type='button'
                  className='flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium'
                >
                  <span>Stornierte Fahrten ({cancelledTrips.length})</span>
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 transition-transform',
                      cancelledOpen && 'rotate-180'
                    )}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className='divide-border divide-y border-t'>
                  {cancelledTrips.map((trip) => {
                    const isOptedIn = trip.billingInclusion.included;
                    const clientName = trip.client
                      ? [trip.client.first_name, trip.client.last_name]
                          .filter(Boolean)
                          .join(' ')
                      : trip.client_name?.trim() || null;

                    return (
                      <div key={trip.id} className='space-y-2 px-4 py-2.5'>
                        <div className='flex items-start gap-3'>
                          <Checkbox
                            checked={isOptedIn}
                            aria-label={
                              isOptedIn
                                ? 'Fahrt nicht mehr abrechnen'
                                : 'Stornierte Fahrt abrechnen'
                            }
                            onCheckedChange={(checked) => {
                              onCancelledTripInclusionChange(
                                trip.id,
                                checked === true,
                                ''
                              );
                            }}
                            className='mt-0.5 shrink-0'
                          />
                          <div className='min-w-0 flex-1 space-y-0.5'>
                            <p className='text-sm font-medium'>
                              {clientName ?? '—'}
                            </p>
                            <p className='text-muted-foreground text-xs'>
                              {trip.scheduled_at
                                ? format(
                                    new Date(trip.scheduled_at),
                                    'EEE, dd.MM.yyyy',
                                    { locale: de }
                                  )
                                : '—'}
                            </p>
                            {(trip.pickup_address || trip.dropoff_address) && (
                              <p className='text-muted-foreground truncate text-xs'>
                                {trip.pickup_address ?? '—'} →{' '}
                                {trip.dropoff_address ?? '—'}
                              </p>
                            )}
                            {trip.canceled_reason_notes && (
                              <p className='text-muted-foreground text-xs italic'>
                                {trip.canceled_reason_notes}
                              </p>
                            )}
                          </div>
                        </div>

                        {isOptedIn && (
                          <div className='space-y-2 pl-7'>
                            {/* Billing reason — amber styling, required */}
                            <div className='space-y-1'>
                              <Label className='text-xs font-normal text-amber-700'>
                                Begründung für Abrechnung (Pflichtfeld)
                              </Label>
                              <Textarea
                                className='min-h-[60px] border-amber-400 text-xs text-amber-900 placeholder:text-amber-400 focus-visible:ring-amber-400'
                                placeholder='Warum wird diese stornierte Fahrt abgerechnet?'
                                value={trip.billingInclusion.reason}
                                onChange={(e) => {
                                  onCancelledTripInclusionChange(
                                    trip.id,
                                    true,
                                    e.target.value
                                  );
                                }}
                              />
                            </div>

                            {/* Gross price input — controlled so km / approach-fee reprices
                                reflect immediately when the admin is not actively typing. */}
                            {(() => {
                              const isCancelledGrossEditing =
                                cancelledGrossEditing?.tripId === trip.id;
                              const cancelledGrossDisplay =
                                cancelledTripGrossTotalForDisplay(trip);
                              const cancelledGrossValue =
                                isCancelledGrossEditing
                                  ? cancelledGrossEditing.value
                                  : cancelledGrossDisplay != null
                                    ? formatEurInput(cancelledGrossDisplay)
                                    : '';
                              return (
                                <div className='flex items-center gap-2'>
                                  <span className='text-muted-foreground w-36 shrink-0 text-xs'>
                                    Bruttopreis
                                  </span>
                                  <Input
                                    type='text'
                                    inputMode='decimal'
                                    aria-label='Bruttopreis stornierte Fahrt'
                                    className='h-7 w-24 text-right text-sm tabular-nums'
                                    placeholder='0,00'
                                    value={cancelledGrossValue}
                                    onFocus={() => {
                                      if (!isCancelledGrossEditing) {
                                        setCancelledGrossEditing({
                                          tripId: trip.id,
                                          value:
                                            cancelledGrossDisplay != null
                                              ? formatEurInput(
                                                  cancelledGrossDisplay
                                                )
                                              : ''
                                        });
                                      }
                                    }}
                                    onChange={(e) => {
                                      setCancelledGrossEditing((prev) =>
                                        prev?.tripId === trip.id
                                          ? { ...prev, value: e.target.value }
                                          : prev
                                      );
                                    }}
                                    onBlur={(e) => {
                                      const gross = parseFloat(
                                        e.target.value.replace(',', '.')
                                      );
                                      if (!isNaN(gross)) {
                                        onCancelledTripGrossOverride(
                                          trip.id,
                                          gross,
                                          0
                                        );
                                      }
                                      setCancelledGrossEditing(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        (e.target as HTMLInputElement).blur();
                                      }
                                    }}
                                  />
                                </div>
                              );
                            })()}

                            {/* Approach fee checkbox */}
                            <div className='flex items-center gap-2'>
                              {trip.isManualOverride ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className='inline-flex items-center gap-2'>
                                      <Checkbox
                                        checked={
                                          trip.includeApproachFee !== false
                                        }
                                        disabled
                                        aria-label='Anfahrtskosten berechnen'
                                      />
                                      <Label className='text-muted-foreground cursor-not-allowed text-xs font-normal'>
                                        Anfahrtskosten berechnen
                                      </Label>
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className='text-xs'>
                                      Manueller Preis aktiv — Anfahrtskosten
                                      haben keinen Einfluss
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <>
                                  <Checkbox
                                    id={`approach-fee-${trip.id}`}
                                    checked={trip.includeApproachFee !== false}
                                    onCheckedChange={(checked) => {
                                      onCancelledTripApproachFeeChange(
                                        trip.id,
                                        checked === true
                                      );
                                    }}
                                    aria-label='Anfahrtskosten berechnen'
                                  />
                                  <Label
                                    htmlFor={`approach-fee-${trip.id}`}
                                    className='cursor-pointer text-xs font-normal'
                                  >
                                    Anfahrtskosten berechnen
                                    {trip.approach_fee_gross != null &&
                                    trip.approach_fee_gross !== undefined ? (
                                      <span className='text-muted-foreground ml-1'>
                                        (
                                        {formatEurInput(
                                          trip.approach_fee_gross
                                        )}
                                        )
                                      </span>
                                    ) : trip.price_resolution
                                        ?.approach_fee_net != null ? (
                                      <span className='text-muted-foreground ml-1'>
                                        (
                                        {formatEurInput(
                                          Math.round(
                                            trip.price_resolution
                                              .approach_fee_net *
                                              (1 + (trip.tax_rate ?? 0)) *
                                              100
                                          ) / 100
                                        )}
                                        )
                                      </span>
                                    ) : null}
                                  </Label>
                                </>
                              )}
                            </div>

                            {/* KM input — only when payer.manual_km_enabled */}
                            {trip.payer?.manual_km_enabled && (
                              <div className='flex items-center gap-2'>
                                <span className='text-muted-foreground w-36 shrink-0 text-xs'>
                                  Distanz (km)
                                </span>
                                <Input
                                  type='text'
                                  inputMode='decimal'
                                  aria-label='Distanz stornierte Fahrt'
                                  className='h-7 w-24 text-right text-sm tabular-nums'
                                  placeholder='km'
                                  defaultValue={
                                    trip.effective_distance_km != null
                                      ? String(trip.effective_distance_km)
                                      : ''
                                  }
                                  onBlur={(e) => {
                                    const km = parseFloat(
                                      e.target.value.replace(',', '.')
                                    );
                                    if (!isNaN(km) && km > 0) {
                                      onCancelledTripKmOverride(trip.id, km);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      (e.target as HTMLInputElement).blur();
                                    }
                                  }}
                                />
                                <span className='text-muted-foreground text-xs'>
                                  km
                                </span>
                              </div>
                            )}

                            {(() => {
                              const resolvedGross =
                                cancelledTripGrossTotalForDisplay(trip);
                              if (resolvedGross == null) return null;
                              return (
                                <p className='text-muted-foreground text-xs'>
                                  Aufgelöster Preis:{' '}
                                  <span className='font-medium tabular-nums'>
                                    {formatEur(resolvedGross)}
                                  </span>
                                </p>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        )}

        {/* ── Opt-out dialog ──────────────────────────────────────────────── */}
        <Dialog
          open={optOutDialog !== null}
          onOpenChange={(open) => {
            if (!open) setOptOutDialog(null);
          }}
        >
          <DialogContent
            onInteractOutside={(e) => {
              // why: prevent accidental close when the admin has typed a reason
              if (
                optOutDialog?.reason &&
                optOutDialog.reason.trim().length > 0
              ) {
                e.preventDefault();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>Fahrt ausschließen</DialogTitle>
            </DialogHeader>
            {optOutDialog && (
              <div className='space-y-3 py-2 text-sm'>
                <p className='text-muted-foreground'>
                  {optOutDialog.item.client_name ?? '—'} ·{' '}
                  {optOutDialog.item.line_date
                    ? format(
                        new Date(optOutDialog.item.line_date),
                        'dd.MM.yyyy',
                        { locale: de }
                      )
                    : '—'}
                </p>
                <div className='space-y-1.5'>
                  <Label htmlFor='opt-out-reason'>
                    Begründung (Pflichtfeld)
                  </Label>
                  <Textarea
                    id='opt-out-reason'
                    autoFocus
                    placeholder='Warum wird diese Fahrt ausgeschlossen?'
                    value={optOutDialog.reason}
                    onChange={(e) =>
                      setOptOutDialog((prev) =>
                        prev ? { ...prev, reason: e.target.value } : prev
                      )
                    }
                    className='min-h-[80px]'
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                type='button'
                variant='ghost'
                onClick={() => setOptOutDialog(null)}
              >
                Abbrechen
              </Button>
              <Button
                type='button'
                variant='destructive'
                disabled={
                  !optOutDialog?.reason ||
                  optOutDialog.reason.trim().length === 0
                }
                onClick={() => {
                  if (!optOutDialog) return;
                  onLineItemInclusionChange(
                    optOutDialog.item.position,
                    false,
                    optOutDialog.reason.trim()
                  );
                  setOptOutDialog(null);
                }}
              >
                Fahrt ausschließen
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
