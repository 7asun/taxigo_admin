'use client';

/**
 * Step 2 for strategy `client_price_tag`: manage all `client_price_tags` rows for one Fahrgast.
 * Global scope syncs `clients.price_tag` via setClientPriceTag for legacy compatibility.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { clientDisplayName } from '@/features/clients/lib/client-display-name';
import { useClientsForPricing } from '@/features/clients/hooks/use-clients-for-pricing';
import { setClientPriceTag } from '@/features/clients/api/clients-pricing.api';
import { usePayers } from '@/features/payers/hooks/use-payers';
import { useBillingTypes } from '@/features/payers/hooks/use-billing-types';
import { referenceKeys } from '@/query/keys';
import { createClient } from '@/lib/supabase/client';
import {
  deleteClientPriceTag,
  insertClientPriceTag,
  listClientPriceTagsForManager,
  updateClientPriceTag,
  type ClientPriceTagManagerRow
} from '@/features/payers/api/client-price-tags.service';
import { pricingRulesErrorMessage } from '@/features/payers/api/billing-pricing-rules.api';
import { toast } from 'sonner';
import { Step2ScopePicker } from './step2-scope-picker';
import { cn } from '@/lib/utils';

function grossNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return Number.NaN;
}

function scopeDescription(row: ClientPriceTagManagerRow): string {
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

function isGlobalRow(row: ClientPriceTagManagerRow): boolean {
  return !row.payer_id && !row.billing_variant_id;
}

export interface ClientPriceTagStepProps {
  busy: boolean;
  initialClientId: string | null;
  /** When true, client cannot be changed (e.g. opened from Fahrgast panel). */
  lockClientSelection?: boolean;
  onSaved: () => void;
}

export function ClientPriceTagStep({
  busy: externalBusy,
  initialClientId,
  lockClientSelection = false,
  onSaved
}: ClientPriceTagStepProps) {
  const qc = useQueryClient();
  const supabase = useMemo(() => createClient(), []);
  const { data: clients = [] } = useClientsForPricing();
  const { data: payers = [] } = usePayers();

  const [searchQuery, setSearchQuery] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [pickPayerId, setPickPayerId] = useState<string | null>(null);
  const [pickFamilyId, setPickFamilyId] = useState<string | null>(null);
  const [pickVariantId, setPickVariantId] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
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

  const tagsQuery = useQuery({
    queryKey: referenceKeys.clientPriceTagsManager(
      clientId ?? '__client_price_tag_step_idle__'
    ),
    queryFn: () => listClientPriceTagsForManager(clientId!, supabase),
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

  const eur = useMemo(
    () =>
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }),
    []
  );

  const invalidateTagCaches = async (cid: string | null) => {
    if (cid) {
      await qc.invalidateQueries({
        queryKey: referenceKeys.clientPriceTagsManager(cid)
      });
    }
    await qc.invalidateQueries({
      queryKey: referenceKeys.allClientPriceTags()
    });
    await qc.invalidateQueries({ queryKey: referenceKeys.clients() });
    onSaved();
  };

  const deleteTagMutation = useMutation({
    mutationFn: async (row: ClientPriceTagManagerRow) => {
      if (isGlobalRow(row)) {
        await setClientPriceTag(row.client_id, null);
      } else {
        await deleteClientPriceTag(row.id, supabase);
      }
    },
    onSuccess: async (_data, row) => {
      // Invalidate both the manager view (dialog list) and the page table
      // so the deletion is immediately reflected in both places.
      await qc.invalidateQueries({
        queryKey: referenceKeys.clientPriceTagsManager(row.client_id)
      });
      await qc.invalidateQueries({
        queryKey: referenceKeys.allClientPriceTags()
      });
      await qc.invalidateQueries({ queryKey: referenceKeys.clients() });
      onSaved();
      toast.success('Entfernt');
    },
    onError: (e) => toast.error(pricingRulesErrorMessage(e))
  });

  const busy = externalBusy || saving || deleteTagMutation.isPending;

  const handleAdd = async () => {
    if (!clientId) return;
    const raw = newPrice.trim().replace(',', '.');
    const priceGross = parseFloat(raw);
    if (Number.isNaN(priceGross) || priceGross < 0) {
      toast.error('Ungültiger Preis.');
      return;
    }
    setSaving(true);
    try {
      if (pickVariantId) {
        await insertClientPriceTag({
          client_id: clientId,
          payer_id: null,
          billing_variant_id: pickVariantId,
          price_gross: priceGross
        });
      } else if (pickPayerId) {
        await insertClientPriceTag({
          client_id: clientId,
          payer_id: pickPayerId,
          billing_variant_id: null,
          price_gross: priceGross
        });
      } else {
        await setClientPriceTag(clientId, priceGross);
      }
      toast.success('Kunden-Preis gespeichert');
      setNewPrice('');
      setShowAddForm(false);
      setPickPayerId(null);
      setPickFamilyId(null);
      setPickVariantId(null);
      await invalidateTagCaches(clientId);
    } catch (e) {
      toast.error(pricingRulesErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (
    row: ClientPriceTagManagerRow,
    active: boolean
  ) => {
    setSaving(true);
    try {
      if (!active) {
        if (isGlobalRow(row)) {
          await setClientPriceTag(row.client_id, null);
        } else {
          await updateClientPriceTag(row.id, { is_active: false });
        }
      } else {
        await updateClientPriceTag(row.id, { is_active: true });
        if (isGlobalRow(row)) {
          const g = grossNum(row.price_gross);
          if (!Number.isNaN(g) && g > 0) {
            await setClientPriceTag(row.client_id, g);
          }
        }
      }
      toast.success(active ? 'Aktiviert' : 'Deaktiviert');
      await invalidateTagCaches(row.client_id);
    } catch (e) {
      toast.error(pricingRulesErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: ClientPriceTagManagerRow) => {
    if (!window.confirm('Diesen Kunden-Preis wirklich entfernen?')) return;
    deleteTagMutation.mutate(row);
  };

  const startEdit = (row: ClientPriceTagManagerRow) => {
    setEditingId(row.id);
    setEditPrice(String(grossNum(row.price_gross)));
  };

  const saveEdit = async (row: ClientPriceTagManagerRow) => {
    const raw = editPrice.trim().replace(',', '.');
    const priceGross = parseFloat(raw);
    if (Number.isNaN(priceGross) || priceGross < 0) {
      toast.error('Ungültiger Preis.');
      return;
    }
    setSaving(true);
    try {
      await updateClientPriceTag(row.id, { price_gross: priceGross });
      if (isGlobalRow(row)) {
        await setClientPriceTag(row.client_id, priceGross);
      }
      toast.success('Gespeichert');
      setEditingId(null);
      await invalidateTagCaches(clientId);
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
          ? 'Preise je Kostenträger oder Unterart pflegen. Global gilt für alle Kostenträger und bleibt mit dem Stammdaten-Feld synchron.'
          : 'Fahrgast wählen und Preise je Kostenträger oder Unterart pflegen. Global gilt für alle Kostenträger und bleibt mit dem Stammdaten-Feld synchron.'}
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
            <Label className='text-base'>Preise für diesen Fahrgast</Label>
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
                Leer lassen = globaler Preis (alle Kostenträger). Optional
                Kostenträger, dann Unterart für die engste Zuordnung.
              </p>
              <div className='space-y-1.5'>
                <Label>Preis brutto (€)</Label>
                <Input
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder='z. B. 32,60'
                  disabled={busy}
                />
              </div>
              <Button
                type='button'
                size='sm'
                disabled={busy}
                onClick={handleAdd}
              >
                Speichern
              </Button>
            </div>
          )}

          <div className='rounded-md border'>
            {tagsQuery.isLoading ? (
              <p className='text-muted-foreground p-3 text-sm'>Laden…</p>
            ) : (tagsQuery.data?.length ?? 0) === 0 ? (
              <p className='text-muted-foreground p-3 text-sm'>
                Noch keine Einträge. „Neu hinzufügen“ oder globalen Preis
                anlegen.
              </p>
            ) : (
              <ul className='divide-y'>
                {tagsQuery.data!.map((row) => (
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
                            value={editPrice}
                            onChange={(e) => setEditPrice(e.target.value)}
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
                          {eur.format(grossNum(row.price_gross))} brutto
                        </p>
                      )}
                    </div>
                    <div className='flex flex-wrap items-center gap-3 sm:justify-end'>
                      <div className='flex items-center gap-2'>
                        <span className='text-muted-foreground text-xs'>
                          Aktiv
                        </span>
                        <Switch
                          checked={row.is_active}
                          disabled={busy}
                          onCheckedChange={(v) =>
                            void handleToggleActive(row, v)
                          }
                        />
                      </div>
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
