'use client';

/**
 * ClientDetailPanel
 *
 * Column 2 of the Fahrgäste Miller Columns view. Shows either:
 *   - Create mode (clientId === 'new'): blank ClientForm, no rules list
 *   - Edit mode   (clientId is a UUID): pre-filled ClientForm + RecurringRulesList
 *
 * After a successful save:
 *   - Create mode: URL param is updated to the new client's UUID so Column 2
 *     transitions from "create" to "edit" without a full navigation. The
 *     client list (Column 1) is also refreshed so the new entry appears.
 *   - Edit mode: form state updates in-place; rules list continues to show.
 *
 * The RecurringRulesList is wired with onEditRule/onNewRule so that clicking
 * a rule card or "Regel hinzufügen" opens Column 3 instead of the Sheet overlay.
 *
 * Props:
 *   clientId        — UUID of the client to edit, or 'new' for create mode
 *   selectedRuleId  — currently open rule id (or null); used to highlight the
 *                     active rule card in RecurringRulesList
 *   onClose         — called when the X button is pressed (clears all params)
 *   onSelectRule    — called with a rule's id to open Column 3
 *   onNewRule       — called when "Regel hinzufügen" is clicked
 *   onRuleDeselect  — called to close Column 3 (clear ruleId param)
 */

import {
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useRef,
  useMemo
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Panel,
  PanelHeader,
  PanelBody,
  PanelFooter
} from '@/components/panels';
import { clientsService, Client } from '../api/clients.service';
import {
  recurringRulesService,
  RecurringRuleWithBillingEmbed
} from '@/features/trips/api/recurring-rules.service';
import ClientForm, { ClientFormHandle } from './client-form';
import { RecurringRulesList } from './recurring-rules-list';
import { formatClientNumber } from '@/lib/customer-number';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog';
import { referenceKeys } from '@/query/keys';
import { createClient } from '@/lib/supabase/client';
import {
  listClientPriceTagsForManager,
  type ClientPriceTagManagerRow
} from '@/features/payers/api/client-price-tags.service';
import { PricingRuleDialog } from '@/features/payers/components/pricing-rule-dialog';

const CLIENT_DETAIL_PRICE_TAGS_IDLE = '__client_detail_idle__';

interface ClientDetailPanelProps {
  clientId: string;
  selectedRuleId: string | null;
  onClose: () => void;
  onSelectRule: (id: string) => void;
  onNewRule: () => void;
  onRuleDeselect: () => void;
}

export function ClientDetailPanel({
  clientId,
  selectedRuleId,
  onClose,
  onSelectRule,
  onNewRule
}: ClientDetailPanelProps) {
  const isNew = clientId === 'new';
  const queryClient = useQueryClient();

  const formRef = useRef<ClientFormHandle>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  /** Mirrors form `is_wheelchair` for the header switch (synced from `client` on load/save) */
  const [headerWheelchair, setHeaderWheelchair] = useState(false);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [rules, setRules] = useState<RecurringRuleWithBillingEmbed[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [priceTagDialogOpen, setPriceTagDialogOpen] = useState(false);

  // After creating a new client, we receive the saved Client object and update
  // the active clientId to the real UUID. We store it locally here and also
  // trigger a URL update via the onSuccess callback chain.
  const [activeClientId, setActiveClientId] = useState<string | null>(
    isNew ? null : clientId
  );

  // Fetch client data when the clientId changes (edit mode only)
  useEffect(() => {
    if (isNew) {
      setClient(null);
      setLoading(false);
      setActiveClientId(null);
      return;
    }

    setActiveClientId(clientId);
    setLoading(true);

    clientsService
      .getClientById(clientId)
      .then((data) => {
        setClient(data);
      })
      .catch((err: any) => {
        toast.error('Fehler beim Laden des Fahrgasts: ' + err.message);
      })
      .finally(() => setLoading(false));
  }, [clientId, isNew]);

  useEffect(() => {
    if (!activeClientId) setPriceTagDialogOpen(false);
  }, [activeClientId]);

  useEffect(() => {
    setPriceTagDialogOpen(false);
  }, [clientId]);

  const handlePriceTagDialogSaved = useCallback(() => {
    if (!activeClientId) return;
    void queryClient.invalidateQueries({
      queryKey: referenceKeys.clientPriceTagsManager(activeClientId)
    });
    void queryClient.invalidateQueries({
      queryKey: referenceKeys.allClientPriceTags()
    });
  }, [queryClient, activeClientId]);

  const fetchRules = useCallback(async () => {
    if (!activeClientId) return;
    try {
      const data = await recurringRulesService.getClientRules(activeClientId);
      setRules(data);
    } catch (err: any) {
      toast.error('Fehler beim Laden der Regelfahrten: ' + err.message);
    }
  }, [activeClientId]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const supabase = useMemo(() => createClient(), []);

  const priceTagsQuery = useQuery({
    queryKey: referenceKeys.clientPriceTagsManager(
      activeClientId ?? CLIENT_DETAIL_PRICE_TAGS_IDLE
    ),
    queryFn: () =>
      listClientPriceTagsForManager(activeClientId as string, supabase),
    enabled: !!activeClientId
  });

  const eur = useMemo(
    () =>
      new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }),
    []
  );

  useLayoutEffect(() => {
    if (isNew) {
      setHeaderWheelchair(false);
      return;
    }
    if (client && client.id === clientId) {
      setHeaderWheelchair(client.is_wheelchair);
    }
  }, [isNew, client, clientId]);

  // Derive display name for the panel header
  const displayName = getDisplayName(client, isNew);

  const handleFormSuccess = (savedClient: Client) => {
    setClient(savedClient);
    setActiveClientId(savedClient.id);

    if (isNew) {
      // Refresh Column 1 list so the new entry appears immediately
      if (typeof (window as any).__refreshClientList === 'function') {
        (window as any).__refreshClientList();
      }
      // Update URL to the real UUID — the orchestrator (ClientsColumnView)
      // will re-render Column 2 in edit mode with the correct id.
      // We trigger this by pushing the new id into the URL manually.
      const url = new URL(window.location.href);
      url.searchParams.set('clientId', savedClient.id);
      window.history.replaceState(null, '', url.toString());
    }
  };

  const handleDelete = async () => {
    if (!clientId || isNew) return;
    try {
      setIsDeleting(true);
      await clientsService.deleteClient(clientId);
      toast.success('Fahrgast erfolgreich gelöscht');

      // Refresh Column 1 list so the entry is removed immediately
      if (typeof (window as any).__refreshClientList === 'function') {
        (window as any).__refreshClientList();
      }

      onClose();
    } catch (err: any) {
      toast.error('Fehler beim Löschen des Fahrgasts: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Panel className='flex-1'>
        <PanelHeader
          title={displayName}
          titleAfter={
            !loading ? (
              <div className='flex shrink-0 items-center gap-2'>
                <Switch
                  id='client-detail-wheelchair'
                  checked={headerWheelchair}
                  onCheckedChange={(v) => {
                    setHeaderWheelchair(v);
                    formRef.current?.setWheelchair(v);
                  }}
                  aria-label='Rollstuhl'
                />
                <label
                  htmlFor='client-detail-wheelchair'
                  className='text-muted-foreground cursor-pointer text-xs whitespace-nowrap select-none'
                >
                  Rollstuhl
                </label>
              </div>
            ) : undefined
          }
          description={isNew ? 'Neuen Fahrgast anlegen' : 'Fahrgast bearbeiten'}
          onClose={onClose}
          actions={
            !loading && (
              <Button
                size='sm'
                variant={isFormDirty ? 'default' : 'ghost'}
                className='h-6 px-2 text-xs'
                disabled={!isFormDirty}
                onClick={() => formRef.current?.submit()}
              >
                {isNew ? 'Fahrgast hinzufügen' : 'Fahrgast aktualisieren'}
              </Button>
            )
          }
        />

        <PanelBody padded>
          {loading ? (
            <div className='flex h-24 items-center justify-center'>
              <Loader2 className='text-muted-foreground h-4 w-4 animate-spin' />
            </div>
          ) : (
            <div className='space-y-8'>
              {/* Client form — noCard strips the Card wrapper since Panel provides it */}
              <ClientForm
                key={isNew ? 'new' : clientId}
                ref={formRef}
                initialData={client}
                pageTitle=''
                noCard
                onSuccess={handleFormSuccess}
                onDirtyChange={setIsFormDirty}
              />

              {activeClientId && !isNew && client && (
                <section className='space-y-2' aria-label='Kunden-Preise'>
                  <div className='flex items-center justify-between gap-2'>
                    <h3 className='text-sm font-medium tracking-tight'>
                      Kunden-Preise
                    </h3>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 gap-1 px-2 text-xs'
                      type='button'
                      onClick={() => setPriceTagDialogOpen(true)}
                    >
                      <Pencil className='mr-1 h-3 w-3' />
                      Bearbeiten
                    </Button>
                  </div>
                  {priceTagsQuery.isLoading ? (
                    <div className='text-muted-foreground flex h-10 items-center text-xs'>
                      <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                      Preise werden geladen…
                    </div>
                  ) : priceTagsQuery.isError ? (
                    <p className='text-destructive text-xs'>
                      Preise konnten nicht geladen werden.
                    </p>
                  ) : (
                    <ClientPriceTagsPanelBody
                      rows={priceTagsQuery.data ?? []}
                      legacyPriceTag={client.price_tag}
                      eur={eur}
                    />
                  )}
                </section>
              )}

              {/* Recurring rules — only shown when editing an existing client */}
              {activeClientId && (
                <RecurringRulesList
                  clientId={activeClientId}
                  rules={rules}
                  onRulesChange={fetchRules}
                  onEditRule={(rule) => onSelectRule(rule.id)}
                  onNewRule={onNewRule}
                />
              )}
            </div>
          )}
        </PanelBody>

        {!isNew && !loading && (
          <PanelFooter className='justify-between border-t'>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant='ghost'
                  size='sm'
                  className='text-destructive hover:text-destructive hover:bg-destructive/10 h-8 gap-2 px-2 text-xs font-medium'
                >
                  <Trash2 className='h-3.5 w-3.5' />
                  Fahrgast löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Fahrgast löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Möchten Sie diesen Fahrgast wirklich unwiderruflich löschen?
                    Diese Aktion kann nicht rückgängig gemacht werden. Damit
                    verbundene Regelfahrten werden ebenfalls entfernt.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDelete}
                    className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    disabled={isDeleting}
                  >
                    {isDeleting ? 'Wird gelöscht...' : 'Endgültig löschen'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </PanelFooter>
        )}
      </Panel>

      {activeClientId && !isNew && (
        <PricingRuleDialog
          open={priceTagDialogOpen}
          onOpenChange={setPriceTagDialogOpen}
          scope={null}
          editing={null}
          initialStrategy='client_price_tag'
          initialClientId={activeClientId}
          lockClientSelection
          onSaved={handlePriceTagDialogSaved}
        />
      )}
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function grossFromTag(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return Number.NaN;
}

function panelScopeLabel(row: ClientPriceTagManagerRow): string {
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

interface ClientPriceTagsPanelBodyProps {
  rows: ClientPriceTagManagerRow[];
  legacyPriceTag: number | null;
  eur: Intl.NumberFormat;
}

function ClientPriceTagsPanelBody({
  rows,
  legacyPriceTag,
  eur
}: ClientPriceTagsPanelBodyProps) {
  const active = rows.filter((r) => r.is_active);
  const showLegacyFallback =
    active.length === 0 &&
    legacyPriceTag !== null &&
    legacyPriceTag !== undefined &&
    legacyPriceTag > 0;

  if (active.length === 0 && !showLegacyFallback) {
    return (
      <p className='text-muted-foreground text-xs'>Kein Preis-Tag hinterlegt</p>
    );
  }

  const displayRows: { label: string; price: number; key: string }[] =
    active.map((r) => ({
      key: r.id,
      label: panelScopeLabel(r),
      price: grossFromTag(r.price_gross)
    }));

  if (showLegacyFallback) {
    displayRows.push({
      key: 'legacy-clients-price-tag',
      label: 'Global (alle Kostenträger)',
      price: legacyPriceTag as number
    });
  }

  return (
    <div className='rounded-md border'>
      <table className='w-full text-sm'>
        <thead>
          <tr className='text-muted-foreground border-b text-left text-xs'>
            <th className='px-3 py-2 font-medium'>Geltungsbereich</th>
            <th className='px-3 py-2 text-right font-medium'>Brutto</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map((d) => (
            <tr key={d.key} className='border-b last:border-0'>
              <td className='text-foreground px-3 py-2'>{d.label}</td>
              <td className='px-3 py-2 text-right font-mono text-xs'>
                {eur.format(d.price)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getDisplayName(client: Client | null, isNew: boolean): string {
  if (isNew) return 'Neuer Fahrgast';
  if (!client) return '...';

  const nameParts = [client.first_name, client.last_name].filter(Boolean);
  const name =
    nameParts.length > 0
      ? nameParts.join(' ')
      : client.company_name || 'Unbekannt';

  const c = client as Client & { customer_number?: number };
  if (c.customer_number) {
    return `${name} (${formatClientNumber(c.customer_number)})`;
  }
  return name;
}
