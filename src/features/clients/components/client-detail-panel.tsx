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
  useRef
} from 'react';
import { Loader2, Trash2 } from 'lucide-react';
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

  const formRef = useRef<ClientFormHandle>(null);
  const [isFormDirty, setIsFormDirty] = useState(false);
  /** Mirrors form `is_wheelchair` for the header switch (synced from `client` on load/save) */
  const [headerWheelchair, setHeaderWheelchair] = useState(false);

  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [rules, setRules] = useState<RecurringRuleWithBillingEmbed[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

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
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
