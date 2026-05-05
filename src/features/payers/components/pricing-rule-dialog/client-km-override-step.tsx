'use client';

/**
 * Step 2 for strategy `client_km_override`: manage `client_km_overrides` rows for one Fahrgast.
 * Scope matches `client_price_tags` (global / Kostenträger / Unterart).
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { clientDisplayName } from '@/features/clients/lib/client-display-name';
import { useClientsForPricing } from '@/features/clients/hooks/use-clients-for-pricing';
import { usePayers } from '@/features/payers/hooks/use-payers';
import { useBillingTypes } from '@/features/payers/hooks/use-billing-types';
import { referenceKeys } from '@/query/keys';
import { createClient } from '@/lib/supabase/client';
import {
  deleteClientKmOverride,
  insertClientKmOverride,
  listClientKmOverridesForManager,
  updateClientKmOverride,
  type ClientKmOverrideManagerRow
} from '@/features/invoices/api/client-km-overrides.api';
import { pricingRulesErrorMessage } from '@/features/payers/api/billing-pricing-rules.api';
import { toast } from 'sonner';
import { Step2ScopePicker } from './step2-scope-picker';
import { cn } from '@/lib/utils';

function kmNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return Number.NaN;
}

function scopeDescription(row: ClientKmOverrideManagerRow): string {
  if (!row.payer_id && !row.billing_variant_id) {
    return 'Global (alle Kostenträger)';
  }
  if (row.billing_variant_id && row.billing_variant) {
    const fam = row.billing_variant.billing_type?.name;
    const parts = [
      row.payer?.name,
      fam ? `${fam} › ${row.billing_variant.name}` : row.billing_variant.name
    ].filter(Boolean);
    return parts.join(' › ');
  }
  if (row.payer_id && row.payer) {
    return row.payer.name;
  }
  return '—';
}

function isGlobalRow(row: ClientKmOverrideManagerRow): boolean {
  return !row.payer_id && !row.billing_variant_id;
}

export interface ClientKmOverrideStepProps {
  busy: boolean;
  initialClientId: string | null;
  lockClientSelection?: boolean;
  onSaved: () => void;
}

export function ClientKmOverrideStep({
  busy: externalBusy,
  initialClientId,
  lockClientSelection = false,
  onSaved
}: ClientKmOverrideStepProps) {
  const qc = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const { data: clients = [] } = useClientsForPricing();
  const { data: payers = [] } = usePayers();

  const [searchQuery, setSearchQuery] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [pickPayerId, setPickPayerId] = useState<string | null>(null);
  const [pickFamilyId, setPickFamilyId] = useState<string | null>(null);
  const [pickVariantId, setPickVariantId] = useState<string | null>(null);
  const [newKm, setNewKm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKm, setEditKm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initialClientId) {
      setClientId(initialClientId);
    }
  }, [initialClientId]);

  const { data: billingFamilies = [] } = useBillingTypes(pickPayerId);
  const selectedFamily = useMemo(
    () => billingFamilies.find((f) => f.id === pickFamilyId) ?? null,
    [billingFamilies, pickFamilyId]
  );

  useEffect(() => {
    setPickFamilyId(null);
    setPickVariantId(null);
  }, [pickPayerId]);
  useEffect(() => {
    setPickVariantId(null);
  }, [pickFamilyId]);

  const overridesQuery = useQuery({
    queryKey: referenceKeys.clientKmOverridesManager(
      clientId ?? '__client_km_override_step_idle__'
    ),
    queryFn: () => listClientKmOverridesForManager(clientId!, supabase),
    enabled: !!clientId
  });

  const q = searchQuery.trim().toLowerCase();
  const filteredClients = useMemo(() => {
    if (!q) return [];
    return clients.filter((c) =>
      clientDisplayName(c).toLowerCase().includes(q)
    );
  }, [clients, q]);

  const selectedName = useMemo(() => {
    if (!clientId) return '';
    const c = clients.find((x) => x.id === clientId);
    return c ? clientDisplayName(c) : '';
  }, [clientId, clients]);

  const invalidateKmCaches = async (cid: string | null) => {
    if (cid) {
      await qc.invalidateQueries({
        queryKey: referenceKeys.clientKmOverridesManager(cid)
      });
    }
    onSaved();
  };

  const deleteMutation = useMutation({
    mutationFn: async (row: ClientKmOverrideManagerRow) => {
      await deleteClientKmOverride(row.id, supabase);
    },
    onSuccess: async (_data, row) => {
      await qc.invalidateQueries({
        queryKey: referenceKeys.clientKmOverridesManager(row.client_id)
      });
      onSaved();
      toast.success('Entfernt');
    },
    onError: (e) => toast.error(pricingRulesErrorMessage(e))
  });

  const busy = externalBusy || saving || deleteMutation.isPending;

  const handleAdd = async () => {
    if (!clientId) return;
    const raw = newKm.trim().replace(',', '.');
    const parsedKm = parseFloat(raw);
    if (Number.isNaN(parsedKm) || parsedKm <= 0) {
      toast.error('Ungültige Distanz.');
      return;
    }
    setSaving(true);
    try {
      if (pickVariantId) {
        await insertClientKmOverride({
          client_id: clientId,
          payer_id: null,
          billing_variant_id: pickVariantId,
          distance_km: parsedKm
        });
      } else if (pickPayerId) {
        await insertClientKmOverride({
          client_id: clientId,
          payer_id: pickPayerId,
          billing_variant_id: null,
          distance_km: parsedKm
        });
      } else {
        await insertClientKmOverride({
          client_id: clientId,
          payer_id: null,
          billing_variant_id: null,
          distance_km: parsedKm
        });
      }
      toast.success('KM-Override gespeichert');
      setNewKm('');
      setShowAddForm(false);
      setPickPayerId(null);
      setPickFamilyId(null);
      setPickVariantId(null);
      await invalidateKmCaches(clientId);
    } catch (e) {
      toast.error(pricingRulesErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: ClientKmOverrideManagerRow) => {
    if (!window.confirm('Diesen KM-Override wirklich entfernen?')) return;
    deleteMutation.mutate(row);
  };

  const startEdit = (row: ClientKmOverrideManagerRow) => {
    setEditingId(row.id);
    setEditKm(String(kmNum(row.distance_km)));
  };

  const saveEdit = async (row: ClientKmOverrideManagerRow) => {
    const raw = editKm.trim().replace(',', '.');
    const parsedKm = parseFloat(raw);
    if (Number.isNaN(parsedKm) || parsedKm <= 0) {
      toast.error('Ungültige Distanz.');
      return;
    }
    setSaving(true);
    try {
      await updateClientKmOverride(row.id, parsedKm);
      toast.success('Gespeichert');
      setEditingId(null);
      await invalidateKmCaches(clientId);
    } catch (e) {
      toast.error(pricingRulesErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='space-y-4'>
      <p className='text-muted-foreground text-sm'>
        {lockClientSelection
          ? 'Abrechnungsstrecken je Kostenträger oder Unterart pflegen. Leer lassen = gilt für alle Kostenträger.'
          : 'Fahrgast wählen und km-Overrides je Kostenträger oder Unterart pflegen. Leer lassen = gilt für alle Kostenträger.'}
      </p>

      {clientId && (
        <div className='bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2'>
          <span className='text-sm font-medium'>
            {selectedName ||
              (lockClientSelection && initialClientId
                ? 'Fahrgast wird geladen…'
                : '')}
          </span>
          {!lockClientSelection && (
            <button
              type='button'
              onClick={() => {
                setClientId(null);
                setSearchQuery('');
                setShowAddForm(false);
              }}
              className='text-muted-foreground hover:text-foreground text-xs'
              disabled={busy}
            >
              Wechseln
            </button>
          )}
        </div>
      )}

      {!clientId && !lockClientSelection && (
        <>
          <Input
            placeholder='Fahrgast suchen…'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={busy}
            autoComplete='off'
          />
          {searchQuery.trim().length > 0 && (
            <ul className='max-h-40 divide-y overflow-y-auto rounded-md border text-sm'>
              {filteredClients.length === 0 ? (
                <li className='text-muted-foreground px-3 py-2'>
                  Kein Treffer.
                </li>
              ) : (
                filteredClients.map((c) => (
                  <li key={c.id}>
                    <button
                      type='button'
                      className='hover:bg-accent w-full px-3 py-2 text-left'
                      onClick={() => {
                        setClientId(c.id);
                        setSearchQuery('');
                      }}
                    >
                      {clientDisplayName(c)}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}

      {clientId && (
        <>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Label className='text-base'>
              KM-Overrides für diesen Fahrgast
            </Label>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='gap-1'
              disabled={busy}
              onClick={() => setShowAddForm((v) => !v)}
            >
              <Plus className='h-3.5 w-3.5' />
              Neu hinzufügen
            </Button>
          </div>

          {showAddForm && (
            <div className='bg-muted/30 space-y-3 rounded-lg border p-3'>
              <Step2ScopePicker
                pickPayerId={pickPayerId}
                pickFamilyId={pickFamilyId}
                pickVariantId={pickVariantId}
                payers={payers}
                billingFamilies={billingFamilies}
                selectedFamily={selectedFamily}
                busy={busy}
                onPayerChange={setPickPayerId}
                onFamilyChange={setPickFamilyId}
                onVariantChange={setPickVariantId}
              />
              <p className='text-muted-foreground text-xs'>
                Leer lassen = globaler Override (alle Kostenträger). Optional
                Kostenträger, dann Unterart für die engste Zuordnung.
              </p>
              <div className='space-y-1.5'>
                <Label>Distanz (km)</Label>
                <Input
                  value={newKm}
                  onChange={(e) => setNewKm(e.target.value)}
                  placeholder='z. B. 12.5'
                  disabled={busy}
                />
              </div>
              <Button
                type='button'
                size='sm'
                disabled={busy}
                onClick={() => void handleAdd()}
              >
                Speichern
              </Button>
            </div>
          )}

          <div className='rounded-md border'>
            {overridesQuery.isLoading ? (
              <p className='text-muted-foreground p-3 text-sm'>Laden…</p>
            ) : (overridesQuery.data?.length ?? 0) === 0 ? (
              <p className='text-muted-foreground p-3 text-sm'>
                Noch keine Einträge. „Neu hinzufügen“ nutzen.
              </p>
            ) : (
              <ul className='divide-y'>
                {overridesQuery.data!.map((row) => (
                  <li
                    key={row.id}
                    className={cn(
                      'flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between',
                      !row.is_active && 'bg-muted/20 opacity-70'
                    )}
                  >
                    <div className='min-w-0 flex-1 space-y-1'>
                      <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                        {isGlobalRow(row) ? 'Global' : 'Zugeordnet'}
                      </p>
                      <p className='text-sm'>{scopeDescription(row)}</p>
                      {editingId === row.id ? (
                        <div className='flex flex-wrap items-end gap-2'>
                          <Input
                            className='w-32'
                            value={editKm}
                            onChange={(e) => setEditKm(e.target.value)}
                            disabled={busy}
                          />
                          <Button
                            type='button'
                            size='sm'
                            disabled={busy}
                            onClick={() => void saveEdit(row)}
                          >
                            OK
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            disabled={busy}
                            onClick={() => setEditingId(null)}
                          >
                            Abbrechen
                          </Button>
                        </div>
                      ) : (
                        <p className='font-mono text-sm'>
                          {kmNum(row.distance_km).toFixed(1)} km
                        </p>
                      )}
                    </div>
                    <div className='flex flex-wrap items-center gap-3 sm:justify-end'>
                      {editingId !== row.id && (
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          disabled={busy}
                          onClick={() => startEdit(row)}
                        >
                          Bearbeiten
                        </Button>
                      )}
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='text-destructive'
                        disabled={busy}
                        onClick={() => handleDelete(row)}
                      >
                        Löschen
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
