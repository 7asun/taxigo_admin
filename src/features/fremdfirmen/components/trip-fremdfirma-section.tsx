'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Trip } from '@/features/trips/api/trips.service';
import { tripsService } from '@/features/trips/api/trips.service';
import { useFremdfirmenQuery } from '@/features/trips/hooks/use-trip-reference-queries';
import { getStatusWhenDriverChanges } from '@/features/trips/lib/trip-status';
import type { FremdfirmaPaymentMode } from '@/features/trips/types/trip-form-reference.types';
import { tripKeys } from '@/query/keys';
import { toast } from 'sonner';
import { FREMDFIRMA_PAYMENT_MODE_OPTIONS } from '@/features/fremdfirmen/lib/fremdfirma-payment-mode-labels';

export interface TripFremdfirmaSectionProps {
  trip: Trip;
  /** Live draft from detail sheet (KTS switch). */
  ktsActive: boolean;
  /** Live draft: „Keine Rechnung“. */
  noInvoiceRequired: boolean;
  runWithRecurringScope: (fn: () => Promise<void>) => void;
  onAfterSave?: () => void | Promise<void>;
  disabled?: boolean;
}

function parseCost(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function TripFremdfirmaSection({
  trip,
  ktsActive,
  noInvoiceRequired,
  runWithRecurringScope,
  onAfterSave,
  disabled = false
}: TripFremdfirmaSectionProps) {
  const qc = useQueryClient();
  const { data: vendors = [], isPending } = useFremdfirmenQuery();

  const [fremdOn, setFremdOn] = useState(!!trip.fremdfirma_id);
  const [vendorId, setVendorId] = useState(trip.fremdfirma_id ?? '');
  const [paymentMode, setPaymentMode] = useState<FremdfirmaPaymentMode | ''>(
    (trip.fremdfirma_payment_mode as FremdfirmaPaymentMode) || ''
  );
  const [costStr, setCostStr] = useState(
    trip.fremdfirma_cost != null ? String(trip.fremdfirma_cost) : ''
  );
  const paymentUserPickedRef = useRef(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFremdOn(!!trip.fremdfirma_id);
    setVendorId(trip.fremdfirma_id ?? '');
    setPaymentMode(
      (trip.fremdfirma_payment_mode as FremdfirmaPaymentMode) || ''
    );
    setCostStr(
      trip.fremdfirma_cost != null ? String(trip.fremdfirma_cost) : ''
    );
    paymentUserPickedRef.current = false;
  }, [
    trip.id,
    trip.fremdfirma_id,
    trip.fremdfirma_payment_mode,
    trip.fremdfirma_cost
  ]);

  const selectedVendor = vendors.find((v) => v.id === vendorId);

  useEffect(() => {
    if (!fremdOn || !vendorId) return;
    if (paymentUserPickedRef.current) return;
    if (noInvoiceRequired && paymentMode !== 'self_payer') {
      setPaymentMode('self_payer');
    }
  }, [noInvoiceRequired, fremdOn, vendorId, paymentMode]);

  useEffect(() => {
    if (!fremdOn || !vendorId || paymentUserPickedRef.current) return;
    if (!paymentMode && selectedVendor?.default_payment_mode) {
      setPaymentMode(
        selectedVendor.default_payment_mode as FremdfirmaPaymentMode
      );
    }
  }, [fremdOn, vendorId, paymentMode, selectedVendor?.default_payment_mode]);

  const showCostField =
    fremdOn &&
    !!vendorId &&
    (paymentMode === 'cash_per_trip' || paymentMode === 'monthly_invoice');

  const persist = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      await tripsService.updateTrip(trip.id, patch);
      toast.success('Fremdfirma gespeichert');
      void qc.invalidateQueries({ queryKey: tripKeys.detail(trip.id) });
      await onAfterSave?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const applyFremdfirmaPayload = (next: {
    fremdfirma_id: string | null;
    fremdfirma_payment_mode: FremdfirmaPaymentMode | null;
    fremdfirma_cost: number | null;
  }) => {
    const payload: Record<string, unknown> = {
      fremdfirma_id: next.fremdfirma_id,
      fremdfirma_payment_mode: next.fremdfirma_payment_mode,
      fremdfirma_cost: next.fremdfirma_cost,
      driver_id: next.fremdfirma_id ? null : trip.driver_id,
      needs_driver_assignment: next.fremdfirma_id
        ? false
        : !(trip.driver_id ?? null)
    };
    const derived = getStatusWhenDriverChanges(
      trip.status,
      next.fremdfirma_id ? null : (trip.driver_id ?? null),
      { fremdfirmaId: next.fremdfirma_id }
    );
    if (derived) payload.status = derived;
    return payload;
  };

  const handleToggleFremd = (on: boolean) => {
    runWithRecurringScope(async () => {
      if (!on) {
        paymentUserPickedRef.current = false;
        if (trip.fremdfirma_id) {
          setFremdOn(false);
          setVendorId('');
          setPaymentMode('');
          setCostStr('');
          await persist(
            applyFremdfirmaPayload({
              fremdfirma_id: null,
              fremdfirma_payment_mode: null,
              fremdfirma_cost: null
            })
          );
          return;
        }
        setFremdOn(false);
        setVendorId('');
        setPaymentMode('');
        setCostStr('');
        return;
      }
      if (vendors.length === 0) {
        toast.error(
          'Keine Fremdfirma angelegt — bitte unter Fremdfirmen anlegen.'
        );
        return;
      }
      setFremdOn(true);
      paymentUserPickedRef.current = false;
      if (vendors.length === 1) {
        const id = vendors[0]!.id;
        setVendorId(id);
        const mode = (vendors[0]!.default_payment_mode ||
          'monthly_invoice') as FremdfirmaPaymentMode;
        const effMode =
          noInvoiceRequired && mode !== 'self_payer' ? 'self_payer' : mode;
        setPaymentMode(effMode);
        await persist(
          applyFremdfirmaPayload({
            fremdfirma_id: id,
            fremdfirma_payment_mode: effMode,
            fremdfirma_cost: parseCost(costStr)
          })
        );
      }
    });
  };

  const saveVendorAndMode = () => {
    if (!vendorId || !paymentMode) {
      toast.error('Fremdfirma und Abrechnungsart wählen');
      return;
    }
    runWithRecurringScope(async () => {
      await persist(
        applyFremdfirmaPayload({
          fremdfirma_id: vendorId,
          fremdfirma_payment_mode: paymentMode,
          fremdfirma_cost: showCostField ? parseCost(costStr) : null
        })
      );
    });
  };

  return (
    <div className='col-span-2 space-y-3 rounded-lg border border-dashed p-3'>
      <div className='flex flex-row items-center justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <Label className='text-muted-foreground text-xs font-medium'>
            Fremdfirma
          </Label>
          <p className='text-muted-foreground text-[11px]'>
            Externe Durchführung — Kostenträger/Abrechnung unverändert.
          </p>
        </div>
        <Switch
          checked={fremdOn}
          onCheckedChange={handleToggleFremd}
          disabled={disabled || saving || isPending}
        />
      </div>

      {noInvoiceRequired && fremdOn ? (
        <Alert>
          <AlertDescription className='text-xs'>
            Keine Rechnung aktiv — Fremdfirma erhält Zahlung direkt vom
            Patienten.
          </AlertDescription>
        </Alert>
      ) : null}

      {ktsActive && fremdOn ? (
        <Alert>
          <AlertDescription className='text-xs'>
            KTS aktiv — bitte Abrechnungsart mit Fremdfirma prüfen.
          </AlertDescription>
        </Alert>
      ) : null}

      {paymentMode === 'kts_to_fremdfirma' && fremdOn ? (
        <Alert>
          <AlertDescription className='text-xs'>
            Fremdfirma erhält KTS-Zahlung direkt — kein Betrag an TaxiGo.
          </AlertDescription>
        </Alert>
      ) : null}

      {fremdOn ? (
        <div className='space-y-3'>
          <div className='space-y-1'>
            <Label className='text-xs'>Partner</Label>
            <Select
              value={vendorId || undefined}
              onValueChange={(v) => {
                setVendorId(v);
                paymentUserPickedRef.current = false;
                const nv = vendors.find((x) => x.id === v);
                const nextMode = (nv?.default_payment_mode ||
                  'monthly_invoice') as FremdfirmaPaymentMode;
                const eff =
                  noInvoiceRequired && nextMode !== 'self_payer'
                    ? 'self_payer'
                    : nextMode;
                setPaymentMode(eff);
              }}
              disabled={disabled || saving}
            >
              <SelectTrigger className='h-8 text-xs'>
                <SelectValue placeholder='Fremdfirma wählen' />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-1'>
            <Label className='text-xs'>Abrechnungsart Fremdfirma</Label>
            <Select
              value={paymentMode || undefined}
              onValueChange={(v) => {
                paymentUserPickedRef.current = true;
                setPaymentMode(v as FremdfirmaPaymentMode);
              }}
              disabled={disabled || saving || !vendorId}
            >
              <SelectTrigger className='h-8 text-xs'>
                <SelectValue placeholder='Modus' />
              </SelectTrigger>
              <SelectContent>
                {FREMDFIRMA_PAYMENT_MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showCostField ? (
            <div className='space-y-1'>
              <Label className='text-xs'>Vereinbarter Betrag (optional)</Label>
              <Input
                className='h-8 text-xs'
                value={costStr}
                onChange={(e) => setCostStr(e.target.value)}
                placeholder='z. B. 45.00'
                disabled={disabled || saving}
              />
            </div>
          ) : null}

          <Button
            type='button'
            variant='secondary'
            size='sm'
            className='h-8 text-xs'
            disabled={
              disabled || saving || !vendorId || !paymentMode || !fremdOn
            }
            onClick={() => saveVendorAndMode()}
          >
            Fremdfirma-Zuweisung speichern
          </Button>
        </div>
      ) : null}
    </div>
  );
}
