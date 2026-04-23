/**
 * use-invoice-builder.ts
 *
 * Client state for the invoice builder (long-form: all sections visible).
 *
 * Flow:
 *   Section 1 (mode) → merge into step2Values
 *   Section 2 submit → full step2Values → trips query → lineItems
 *   Section 3        → inline edits only
 *   Section 5 submit (form in §4) → createInvoice(..., pdfColumnOverride) → insertLineItems() → navigate
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invoiceKeys, referenceKeys } from '@/query/keys';
import { listPricingRulesForPayer } from '@/features/payers/api/billing-pricing-rules.api';
import {
  fetchTripsForBuilder,
  mapBillingPricingRuleRowsToLike,
  buildLineItemsFromTrips,
  calculateInvoiceTotals,
  insertLineItems
} from '../api/invoice-line-items.api';
import { applyGrossOverrideToResolution } from '../lib/resolve-trip-price';
import { createInvoice } from '../api/invoices.api';
import { tripsService } from '@/features/trips/api/trips.service';
import { pdfColumnOverrideSchema } from '../types/pdf-vorlage.types';
import { hasMissingPrices, validateLineItem } from '../lib/invoice-validators';
import { resolveRechnungsempfaenger } from '../lib/resolve-rechnungsempfaenger';
import type {
  InvoiceBuilderFormValues,
  BuilderLineItem
} from '../types/invoice.types';
import type { PdfColumnOverridePayload } from '../types/pdf-vorlage.types';
import { step2ValuesReadyForTripsFetch } from '../lib/invoice-builder-section-guards';

/** Shape of the builder's step 2 form values (subset of full builder form). */
type Step2Values = Pick<
  InvoiceBuilderFormValues,
  | 'mode'
  | 'payer_id'
  | 'billing_type_id'
  | 'billing_variant_id'
  | 'period_from'
  | 'period_to'
  | 'client_id'
>;

function legacyPriceSourceFromResolution(
  src: string
): 'client_price_tag' | 'trip_price' | null {
  if (src === 'client_price_tag') return 'client_price_tag';
  if (src === 'trip_price') return 'trip_price';
  return null;
}

/**
 * State for the long-form invoice builder (all sections on one page).
 */
export function useInvoiceBuilder(
  companyId: string,
  onCreated: (invoiceId: string) => void
) {
  const queryClient = useQueryClient();

  const [step2Values, setStep2Values] = useState<Step2Values | null>(null);
  const [lineItems, setLineItems] = useState<BuilderLineItem[]>([]);
  const [section3Confirmed, setSection3Confirmed] = useState(false);
  /** Catalog cascade (variant → type → payer) from the first fetched trip. */
  const [catalogRecipientId, setCatalogRecipientId] = useState<string | null>(
    null
  );

  const confirmSection3 = useCallback(() => setSection3Confirmed(true), []);

  useEffect(() => {
    if (!step2ValuesReadyForTripsFetch(step2Values)) {
      setLineItems([]);
      setCatalogRecipientId(null);
      setSection3Confirmed(false);
    }
  }, [step2Values]);

  const tripsQuery = useQuery({
    queryKey: step2Values
      ? invoiceKeys.tripsForBuilder({
          payer_id: step2Values.payer_id,
          billing_type_id: step2Values.billing_type_id,
          billing_variant_id: step2Values.billing_variant_id,
          period_from: step2Values.period_from,
          period_to: step2Values.period_to,
          client_id: step2Values.client_id
        })
      : ['invoices', 'builder-trips', 'idle'],
    queryFn: async () => {
      const payerId = step2Values!.payer_id;
      const rulesRows = await queryClient.fetchQuery({
        queryKey: referenceKeys.billingPricingRules(payerId),
        queryFn: () => listPricingRulesForPayer(payerId),
        staleTime: 30_000
      });
      const rules = mapBillingPricingRuleRowsToLike(rulesRows);
      const { trips, clientPriceTags } = await fetchTripsForBuilder({
        payer_id: payerId,
        billing_type_id: step2Values?.billing_type_id,
        billing_variant_id: step2Values?.billing_variant_id,
        period_from: step2Values!.period_from,
        period_to: step2Values!.period_to,
        client_id: step2Values?.client_id
      });
      const items = buildLineItemsFromTrips(trips, rules, clientPriceTags);
      setLineItems(items);

      const t0 = trips[0];
      const resolved = t0
        ? resolveRechnungsempfaenger({
            billingVariantRechnungsempfaengerId:
              t0.billing_variant?.rechnungsempfaenger_id,
            billingTypeRechnungsempfaengerId:
              t0.billing_variant?.billing_type?.rechnungsempfaenger_id,
            payerRechnungsempfaengerId: t0.payer?.rechnungsempfaenger_id
          })
        : { rechnungsempfaengerId: null };
      setCatalogRecipientId(resolved.rechnungsempfaengerId);

      return items;
    },
    enabled: step2ValuesReadyForTripsFetch(step2Values),
    staleTime: 5 * 60 * 1000
  });

  const applyGrossOverride = useCallback(
    (position: number, grossTotal: number, approachFeeGross: number) => {
      setLineItems((prev) =>
        prev.map((item) => {
          if (item.position !== position) return item;
          const nextRes = applyGrossOverrideToResolution(
            item.price_resolution,
            grossTotal,
            approachFeeGross,
            item.tax_rate
          );
          const patched: BuilderLineItem = {
            ...item,
            unit_price: nextRes.unit_price_net,
            approach_fee_net: nextRes.approach_fee_net ?? null,
            approach_fee_gross: approachFeeGross,
            price_resolution: nextRes,
            kts_override: false,
            price_source: null,
            manualGrossTotal: grossTotal,
            manualApproachFeeGross: approachFeeGross,
            isManualOverride: true
          };
          return { ...patched, warnings: validateLineItem(patched) };
        })
      );
    },
    []
  );

  const resetLineItemOverride = useCallback((position: number) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.position !== position) return item;
        const orig = item.originalPriceResolution ?? item.price_resolution;
        const patched: BuilderLineItem = {
          ...item,
          unit_price: orig.unit_price_net,
          approach_fee_net: orig.approach_fee_net ?? null,
          approach_fee_gross:
            orig.approach_fee_net != null
              ? Math.round(orig.approach_fee_net * (1 + item.tax_rate) * 100) /
                100
              : null,
          price_resolution: orig,
          kts_override: orig.strategy_used === 'kts_override',
          price_source: legacyPriceSourceFromResolution(orig.source),
          manualGrossTotal: null,
          manualApproachFeeGross: null,
          isManualOverride: false
        };
        return { ...patched, warnings: validateLineItem(patched) };
      })
    );
  }, []);

  const handleStep1Complete = useCallback(
    (mode: InvoiceBuilderFormValues['mode']) => {
      setStep2Values((prev) => {
        if (prev?.mode !== undefined && prev.mode !== mode) {
          return { mode } as Step2Values;
        }
        return { ...(prev || {}), mode } as Step2Values;
      });
    },
    []
  );

  const handleStep2Complete = useCallback((values: Step2Values) => {
    setSection3Confirmed(false);
    setStep2Values(values);
  }, []);

  const totals = calculateInvoiceTotals(lineItems);
  const missingPrices = hasMissingPrices(lineItems);

  const createMutation = useMutation({
    mutationFn: async (args: {
      step4Values: Pick<
        InvoiceBuilderFormValues,
        | 'intro_block_id'
        | 'outro_block_id'
        | 'payment_due_days'
        | 'rechnungsempfaenger_id'
      >;
      pdfColumnOverride: PdfColumnOverridePayload | null;
    }) => {
      if (!step2Values) throw new Error('Schritt 2 nicht abgeschlossen');

      const { step4Values, pdfColumnOverride } = args;

      const intro_block_id =
        step4Values.intro_block_id === 'none'
          ? null
          : step4Values.intro_block_id;
      const outro_block_id =
        step4Values.outro_block_id === 'none'
          ? null
          : step4Values.outro_block_id;

      const empRaw = step4Values.rechnungsempfaenger_id;
      const rechnungsempfaengerId =
        empRaw === 'none' || empRaw === undefined || empRaw === null
          ? catalogRecipientId
          : empRaw;

      const fullValues: InvoiceBuilderFormValues = {
        ...step2Values,
        intro_block_id,
        outro_block_id,
        payment_due_days: step4Values.payment_due_days,
        rechnungsempfaenger_id: rechnungsempfaengerId ?? null
      };

      let pdfPayload: Record<string, unknown> | null = null;
      if (pdfColumnOverride) {
        pdfPayload = pdfColumnOverrideSchema.parse(
          pdfColumnOverride
        ) as unknown as Record<string, unknown>;
      }

      const invoice = await createInvoice({
        companyId,
        formValues: fullValues,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        rechnungsempfaengerId: rechnungsempfaengerId ?? null,
        pdfColumnOverride: pdfPayload
      });

      await insertLineItems(invoice.id, lineItems);

      // Fire-and-forget: failed writeback must never block the invoice.
      // net_price = total transport net (not per-km unit); gross_price = total gross incl. Anfahrt.
      void Promise.allSettled(
        lineItems
          .filter((item) => item.trip_id !== null)
          .map((item) =>
            tripsService.updateTrip(item.trip_id!, {
              net_price: item.price_resolution.net,
              gross_price: item.manualGrossTotal ?? item.price_resolution.gross,
              tax_rate: item.tax_rate,
              ...(item.isManualOverride && item.manualGrossTotal !== null
                ? { manual_gross_price: item.manualGrossTotal }
                : {})
            })
          )
      );

      return invoice;
    },

    onSuccess: (invoice) => {
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
    step2Values,
    lineItems,
    section3Confirmed,
    catalogRecipientId,
    totals,
    missingPrices,

    isLoadingTrips: tripsQuery.isLoading,
    isTripsError: tripsQuery.isError,
    tripsCount: lineItems.length,

    handleStep1Complete,
    handleStep2Complete,
    confirmSection3,
    applyGrossOverride,
    resetLineItemOverride,

    createInvoice: (
      step4Values: Pick<
        InvoiceBuilderFormValues,
        | 'intro_block_id'
        | 'outro_block_id'
        | 'payment_due_days'
        | 'rechnungsempfaenger_id'
      >,
      pdfColumnOverride: PdfColumnOverridePayload | null
    ) => createMutation.mutate({ step4Values, pdfColumnOverride }),
    isCreating: createMutation.isPending
  };
}
