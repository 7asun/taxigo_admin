/**
 * use-invoice-builder.ts
 *
 * State machine hook for the 4-step invoice builder wizard.
 *
 * ─── Step overview ─────────────────────────────────────────────────────────
 *   Step 1 — Mode selection: Monatlich / Einzelfahrt / Fahrgast
 *   Step 2 — Parameters: Payer + billing_type + date range (+ client for per_client)
 *   Step 3 — Line item preview: editable table, warning badges for missing prices
 *   Step 4 — Confirm: invoice number preview, notes, Zahlungsziel, CREATE button
 *
 * ─── Data flow ─────────────────────────────────────────────────────────────
 *   Step 2 form submit → fetchTripsForBuilder() → buildLineItemsFromTrips()
 *   Step 3 edits       → local state (no API call until step 4)
 *   Step 4 submit      → createInvoice() → insertLineItems() → navigate to detail
 *
 * ─── Why local state (not React Query) for builder? ─────────────────────────
 * The builder holds transient in-progress data (edits in step 3) that should
 * NOT be cached or shared with the list page. Using local state + a React Query
 * query for the trips fetch gives us the best of both worlds.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invoiceKeys } from '@/query/keys';
import {
  fetchTripsForBuilder,
  buildLineItemsFromTrips,
  calculateInvoiceTotals,
  insertLineItems
} from '../api/invoice-line-items.api';
import { createInvoice } from '../api/invoices.api';
import { hasMissingPrices } from '../lib/invoice-validators';
import type {
  InvoiceBuilderStep,
  InvoiceBuilderFormValues,
  BuilderLineItem
} from '../types/invoice.types';

/** Shape of the builder's step 2 form values (subset of full builder form). */
type Step2Values = Pick<
  InvoiceBuilderFormValues,
  | 'mode'
  | 'payer_id'
  | 'billing_type_id'
  | 'period_from'
  | 'period_to'
  | 'client_id'
>;

/**
 * Main state machine hook for the invoice builder wizard.
 *
 * @param companyId - The current user's company ID (from auth context).
 * @param onCreated - Callback called with the new invoice ID after creation.
 */
export function useInvoiceBuilder(
  companyId: string,
  onCreated: (invoiceId: string) => void
) {
  const queryClient = useQueryClient();

  // ── Builder state ────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState<InvoiceBuilderStep>(1);
  const [step2Values, setStep2Values] = useState<Step2Values | null>(null);

  // Line items: initially loaded from trips, then editable by user in step 3
  const [lineItems, setLineItems] = useState<BuilderLineItem[]>([]);

  // ── Step 2 — Fetch trips when parameters are set ──────────────────────────
  const tripsQuery = useQuery({
    queryKey: step2Values
      ? invoiceKeys.tripsForBuilder({
          payer_id: step2Values.payer_id,
          billing_type_id: step2Values.billing_type_id,
          period_from: step2Values.period_from,
          period_to: step2Values.period_to,
          client_id: step2Values.client_id
        })
      : ['invoices', 'builder-trips', 'idle'],
    queryFn: async () => {
      const trips = await fetchTripsForBuilder({
        payer_id: step2Values!.payer_id,
        billing_type_id: step2Values?.billing_type_id,
        period_from: step2Values!.period_from,
        period_to: step2Values!.period_to,
        client_id: step2Values?.client_id
      });
      // Convert trips → line items immediately after fetch
      const items = buildLineItemsFromTrips(trips);
      setLineItems(items);
      return items;
    },
    enabled: !!step2Values, // only run after step 2 is submitted
    staleTime: 5 * 60 * 1000 // 5 min — builder trips don't need realtime refresh
  });

  // ── Step 3 — Inline price editing ─────────────────────────────────────────
  /**
   * Updates the unit price of a specific line item (by position).
   * Called from the inline price editor in step 3.
   */
  const updateLineItemPrice = useCallback(
    (position: number, newPrice: number) => {
      setLineItems((prev) =>
        prev.map((item) =>
          item.position === position
            ? {
                ...item,
                unit_price: newPrice,
                // Re-validate: if price is now set, remove 'missing_price' warning
                warnings: item.warnings.filter(
                  (w) =>
                    w !== 'missing_price' &&
                    (newPrice !== 0 || w !== 'zero_price')
                )
              }
            : item
        )
      );
    },
    []
  );

  // ── Step navigation helpers ───────────────────────────────────────────────
  const goToStep = useCallback((step: InvoiceBuilderStep) => {
    setCurrentStep(step);
  }, []);

  /** Called when step 1 (mode selection) is confirmed. */
  const handleStep1Complete = useCallback(
    (mode: InvoiceBuilderFormValues['mode']) => {
      // Store mode in step2Values (will be filled properly in step 2)
      setStep2Values(
        (prev) => ({ ...(prev as Step2Values), mode }) as Step2Values
      );
      setCurrentStep(2);
    },
    []
  );

  /** Called when step 2 (parameters) is confirmed. Triggers the trips fetch. */
  const handleStep2Complete = useCallback((values: Step2Values) => {
    setStep2Values(values);
    setCurrentStep(3);
  }, []);

  /** Called when step 3 (line items review) is confirmed. */
  const handleStep3Complete = useCallback(() => {
    setCurrentStep(4);
  }, []);

  // ── Step 4 — Create the invoice ───────────────────────────────────────────
  const totals = calculateInvoiceTotals(lineItems);
  const missingPrices = hasMissingPrices(lineItems);

  const createMutation = useMutation({
    mutationFn: async (
      step4Values: Pick<
        InvoiceBuilderFormValues,
        'intro_block_id' | 'outro_block_id' | 'payment_due_days'
      >
    ) => {
      if (!step2Values) throw new Error('Schritt 2 nicht abgeschlossen');

      // Convert "none" to null for text block IDs
      const processedValues = {
        ...step4Values,
        intro_block_id:
          step4Values.intro_block_id === 'none'
            ? null
            : step4Values.intro_block_id,
        outro_block_id:
          step4Values.outro_block_id === 'none'
            ? null
            : step4Values.outro_block_id
      };

      const fullValues: InvoiceBuilderFormValues = {
        ...step2Values,
        ...processedValues
      };

      // 1. Create the invoice header row
      const invoice = await createInvoice({
        companyId,
        formValues: fullValues,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total
      });

      // 2. Insert the line items (uses the current in-memory edited state)
      await insertLineItems(invoice.id, lineItems);

      return invoice;
    },

    onSuccess: (invoice) => {
      // Invalidate the list so the new invoice appears immediately
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      toast.success(`Rechnung ${invoice.invoice_number} wurde erstellt.`);
      onCreated(invoice.id);
    },

    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Rechnung konnte nicht erstellt werden: ' + message);
    }
  });

  return {
    // ── State ──────────────────────────────────────────────────────────────
    currentStep,
    step2Values,
    lineItems,
    totals,
    missingPrices, // true = show warning in step 4 header (doesn't block create)

    // ── Trips fetch (step 2 → 3 transition) ───────────────────────────────
    isLoadingTrips: tripsQuery.isLoading,
    isTripsError: tripsQuery.isError,
    tripsCount: lineItems.length,

    // ── Actions ────────────────────────────────────────────────────────────
    goToStep,
    handleStep1Complete,
    handleStep2Complete,
    handleStep3Complete,
    updateLineItemPrice,

    // ── Final create ───────────────────────────────────────────────────────
    createInvoice: createMutation.mutate,
    isCreating: createMutation.isPending
  };
}
