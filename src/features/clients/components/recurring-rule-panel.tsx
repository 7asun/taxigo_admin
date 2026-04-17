'use client';

/**
 * RecurringRulePanel
 *
 * Column 3 of the Fahrgäste Miller Columns view. Renders the recurring rule
 * create/edit form inside a Panel shell that mirrors the visual structure of
 * RecurringRuleSheet — same header text, same scrollable form body, same
 * footer buttons — but as a persistent column instead of a floating overlay.
 *
 * This component is intentionally structurally identical to RecurringRuleSheet.
 * The shared logic lives in RecurringRuleFormBody and getRuleFormDefaults.
 * Persisted fields match the Sheet (including Kostenträger / Unterart).
 *
 * Modes:
 *   ruleId === 'new'  — create a new rule for the given client
 *   ruleId === UUID   — edit the existing rule with that id
 *
 * On success (create or update):
 *   1. Toast notification
 *   2. onSuccess() is called → the orchestrator clears ?ruleId (closes Column 3)
 *      and ClientDetailPanel's fetchRules() re-runs via the RecurringRulesList
 *      onRulesChange callback (triggered by the rule list's own useEffect).
 *
 * Props:
 *   clientId  — UUID of the parent client (used when creating a new rule)
 *   ruleId    — UUID of the rule to edit, or 'new' to create
 *   onClose   — called by the X button (close Column 3 without saving)
 *   onSuccess — called after a successful save (orchestrator closes Column 3)
 */

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Panel,
  PanelHeader,
  PanelBody,
  PanelFooter
} from '@/components/panels';
import { Button } from '@/components/ui/button';
import {
  recurringRulesService,
  RecurringRule
} from '@/features/trips/api/recurring-rules.service';
import {
  RecurringRuleFormBody,
  RuleFormValues,
  ruleFormSchema,
  getRuleFormDefaults,
  NO_BILLING_VARIANT_SENTINEL,
  handleRuleFormInvalid
} from './recurring-rule-form-body';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { buildRecurringRulePayload } from '@/features/clients/lib/build-recurring-rule-payload';
import { formatClientAddress } from '@/features/clients/lib/format-client-address';
import type { ClientOption } from '@/features/trips/types/trip-form-reference.types';
import { DeleteRecurringRuleDialog } from '@/features/recurring-rules/components/delete-recurring-rule-dialog';

interface RecurringRulePanelProps {
  clientId: string;
  ruleId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function RecurringRulePanel({
  clientId,
  ruleId,
  onClose,
  onSuccess
}: RecurringRulePanelProps) {
  const isNew = ruleId === 'new';

  const [existingRule, setExistingRule] = React.useState<RecurringRule | null>(
    null
  );
  const [loadingRule, setLoadingRule] = React.useState(!isNew);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const [client, setClient] = React.useState<ClientOption | null>(null);
  const [homeRole, setHomeRole] = React.useState<'pickup' | 'dropoff'>(
    'pickup'
  );
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: getRuleFormDefaults(null)
  });
  const { reset, setValue, getValues, watch } = form;

  const payerWatch = watch('payer_id');
  const { payers, billingTypes, searchClientsById } =
    useTripFormData(payerWatch);

  const payerHasNoVariants = !!payerWatch && billingTypes.length === 0;

  const formattedHomeAddress = React.useMemo(
    () => formatClientAddress(client),
    [client]
  );

  // Load the client and existing rule when opening
  React.useEffect(() => {
    // If the selected payer has no variants (Unterart), keep a sentinel in the
    // form state so the shared schema does not block submit.
    const current = getValues('billing_variant_id');
    if (payerHasNoVariants) {
      if (current !== NO_BILLING_VARIANT_SENTINEL) {
        setValue('billing_variant_id', NO_BILLING_VARIANT_SENTINEL, {
          shouldValidate: false,
          shouldDirty: false
        });
      }
      return;
    }

    // If we move back to a payer that *does* have variants, clear the sentinel
    // so the user must pick a real Unterart.
    if (current === NO_BILLING_VARIANT_SENTINEL) {
      setValue('billing_variant_id', '', {
        shouldValidate: false,
        shouldDirty: false
      });
    }
  }, [payerHasNoVariants, getValues, setValue]);

  // Load the client and existing rule when opening
  React.useEffect(() => {
    // 1. Fetch Client info (for address selection)
    searchClientsById(clientId).then((data) => {
      setClient(data);
    });

    // 2. Fetch Rule info
    if (isNew) {
      setExistingRule(null);
      setLoadingRule(false);
      setHomeRole('pickup');

      // Initialize with home address as pickup by default for new rules
      searchClientsById(clientId).then((clientData) => {
        const defaults = getRuleFormDefaults(null);
        reset({
          ...defaults,
          pickup_address:
            formatClientAddress(clientData) || defaults.pickup_address
        });
      });
      return;
    }

    setLoadingRule(true);
    recurringRulesService
      .getRuleById(ruleId)
      .then((rule) => {
        if (!rule) {
          // Rule might have been deleted just now, or URL is invalid.
          // Don't show an error toast here to avoid "Fehler beim Laden"
          // during deletion transitions.
          return;
        }
        setExistingRule(rule);
        reset(getRuleFormDefaults(rule));
      })
      .catch((err: any) => {
        toast.error('Fehler beim Laden der Regel: ' + err.message);
      })
      .finally(() => setLoadingRule(false));
  }, [ruleId, isNew, reset, clientId, searchClientsById]);

  const handleHomeRoleChange = (role: 'pickup' | 'dropoff') => {
    setHomeRole(role);
    if (role === 'pickup') {
      form.setValue('pickup_address', formattedHomeAddress, {
        shouldValidate: true
      });
      form.setValue('dropoff_address', '', { shouldValidate: true });
    } else {
      form.setValue('dropoff_address', formattedHomeAddress, {
        shouldValidate: true
      });
      form.setValue('pickup_address', '', { shouldValidate: true });
    }
  };

  const handleSubmit = async (values: RuleFormValues) => {
    try {
      setIsSubmitting(true);

      const ruleData = buildRecurringRulePayload(values, {
        clientId,
        payers,
        billingTypes
      });

      if (existingRule) {
        const payload = { ...ruleData };
        // Coerce sentinel to null for DB consistency
        if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
          payload.billing_variant_id = null;
        }
        await recurringRulesService.updateRule(existingRule.id, payload);
        toast.success('Regel erfolgreich aktualisiert');
      } else {
        const payload = { ...ruleData };
        if (values.billing_variant_id === NO_BILLING_VARIANT_SENTINEL) {
          payload.billing_variant_id = null;
        }
        await recurringRulesService.createRule(payload);
        toast.success('Regel erfolgreich erstellt');
      }

      onSuccess();
    } catch (error: any) {
      toast.error(`Fehler: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const panelTitle = isNew ? 'Neue wiederkehrende Fahrt' : 'Regel bearbeiten';
  const panelDescription =
    'Konfigurieren Sie die Wochentage und Zeiten für diese Regelfahrt.';

  return (
    <Panel className='flex-1'>
      <PanelHeader
        title={panelTitle}
        description={panelDescription}
        onClose={onClose}
      />

      <PanelBody padded={false}>
        {loadingRule ? (
          <div className='flex h-24 items-center justify-center'>
            <Loader2 className='text-muted-foreground h-4 w-4 animate-spin' />
          </div>
        ) : (
          <div className='px-6'>
            {/* id links the submit button in PanelFooter to this form via the
                HTML `form` attribute — no nested <form> elements needed */}
            <form
              id='recurring-rule-panel-form'
              onSubmit={form.handleSubmit(handleSubmit, handleRuleFormInvalid)}
            >
              <RecurringRuleFormBody
                form={form}
                showIsActive={!isNew}
                addressRoleSelection={{
                  homeRole,
                  formattedHomeAddress,
                  onRoleChange: handleHomeRoleChange
                }}
              />
            </form>
          </div>
        )}
      </PanelBody>

      {/* Fixed footer — always visible, never scrolls away */}
      <PanelFooter>
        <Button
          type='button'
          variant='outline'
          onClick={onClose}
          disabled={isSubmitting}
        >
          Abbrechen
        </Button>
        <Button
          type='submit'
          form='recurring-rule-panel-form'
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {isNew ? 'Hinzufügen' : 'Speichern'}
        </Button>
        {!isNew && (
          <Button
            type='button'
            variant='ghost'
            onClick={() => setShowDeleteDialog(true)}
            className='text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0'
            disabled={isSubmitting}
          >
            Löschen
          </Button>
        )}
      </PanelFooter>

      <DeleteRecurringRuleDialog
        ruleId={ruleId}
        isOpen={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onSuccess={onSuccess}
      />
    </Panel>
  );
}
