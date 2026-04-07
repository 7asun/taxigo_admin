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
  getRuleFormDefaults
} from './recurring-rule-form-body';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { buildRecurringRulePayload } from '@/features/clients/lib/build-recurring-rule-payload';

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

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(ruleFormSchema),
    defaultValues: getRuleFormDefaults(null)
  });

  const payerWatch = form.watch('payer_id');
  const { payers, billingTypes } = useTripFormData(payerWatch);

  // Load the existing rule when opening in edit mode
  React.useEffect(() => {
    if (isNew) {
      setExistingRule(null);
      setLoadingRule(false);
      form.reset(getRuleFormDefaults(null));
      return;
    }

    setLoadingRule(true);
    recurringRulesService
      .getRuleById(ruleId)
      .then((rule) => {
        setExistingRule(rule);
        form.reset(getRuleFormDefaults(rule));
      })
      .catch((err: any) => {
        toast.error('Fehler beim Laden der Regel: ' + err.message);
      })
      .finally(() => setLoadingRule(false));
  }, [ruleId, isNew, form]);

  const handleSubmit = async (values: RuleFormValues) => {
    try {
      setIsSubmitting(true);

      const ruleData = buildRecurringRulePayload(values, {
        clientId,
        payers,
        billingTypes
      });

      if (existingRule) {
        await recurringRulesService.updateRule(existingRule.id, ruleData);
        toast.success('Regel erfolgreich aktualisiert');
      } else {
        await recurringRulesService.createRule(ruleData);
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
              onSubmit={form.handleSubmit(handleSubmit)}
            >
              <RecurringRuleFormBody form={form} showIsActive={!isNew} />
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
      </PanelFooter>
    </Panel>
  );
}
