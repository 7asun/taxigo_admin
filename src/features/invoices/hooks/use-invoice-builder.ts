/**
 * use-invoice-builder.ts
 *
 * Client state for the invoice builder (long-form: all sections visible).
 *
 * Flow:
 *   Section 1 (mode) → merge into step2Values
 *   Section 2 submit → full step2Values → trips queries (billing + cancelled) → lineItems + cancelledTrips
 *   Section 3        → inline edits only
 *   Section 5 submit (form in §4) → createInvoice(..., pdfColumnOverride) → insertLineItems() → navigate
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { invoiceKeys, referenceKeys } from '@/query/keys';
import { listPricingRulesForPayer } from '@/features/payers/api/billing-pricing-rules.api';
import {
  fetchTripsForBuilder,
  fetchCancelledTripsForBuilder,
  mapBillingPricingRuleRowsToLike,
  buildLineItemsFromTrips,
  buildCancelledTripBillingState,
  calculateInvoiceTotals,
  insertLineItems,
  lineItemToInsertRow,
  cancelledTripToInsertRow
} from '../api/invoice-line-items.api';
import {
  mapLineItemRowToBuilderLineItem,
  mapLineItemRowToBuilderCancelledTrip
} from '../utils/map-line-item-row-to-builder-line-item';
import {
  applyGrossOverrideToResolution,
  resolveTripPrice as resolveTripPricePure,
  type TripPriceInput
} from '../lib/resolve-trip-price';
import {
  createInvoice,
  getInvoiceDetail,
  updateDraftInvoice
} from '../api/invoices.api';
import { tripsService } from '@/features/trips/api/trips.service';
import { pdfColumnOverrideSchema } from '../types/pdf-vorlage.types';
import {
  hasMissingPrices,
  hasInclusionReasonErrors,
  validateLineItem
} from '../lib/invoice-validators';
import { resolveTaxRate } from '../lib/tax-calculator';
import { resolveRechnungsempfaenger } from '../lib/resolve-rechnungsempfaenger';
import type {
  InvoiceBuilderFormValues,
  BuilderLineItem,
  BuilderCancelledTripRow
} from '../types/invoice.types';
import type { PdfColumnOverridePayload } from '../types/pdf-vorlage.types';
import { step2ValuesReadyForTripsFetch } from '../lib/invoice-builder-section-guards';
import { tripsBuilderParamsFromStep2 } from '../lib/trips-builder-params';
import type {
  BillingPricingRuleLike,
  ClientPriceTagLike
} from '../types/pricing.types';
import type { ClientKmOverrideLike } from '../lib/resolve-effective-distance';

/** Shape of the builder's step 2 form values (subset of full builder form). */
type Step2Values = Pick<
  InvoiceBuilderFormValues,
  | 'mode'
  | 'payer_id'
  | 'billing_type_id'
  | 'billing_type_ids'
  | 'billing_variant_id'
  | 'billing_variant_ids'
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
 * Minimal trip shape for repricing after KM edit. Legacy `client.price_tag` is omitted —
 * client tag gross lives on `resolved_rule._price_gross` when applicable.
 */
function tripInputFromLineItem(item: BuilderLineItem): TripPriceInput {
  return {
    kts_document_applies: item.kts_document_applies,
    net_price: null,
    base_net_price: null,
    manual_gross_price:
      item.price_resolution.source === 'manual_gross_price' &&
      item.price_resolution.gross != null
        ? item.price_resolution.gross
        : null,
    driving_distance_km: null,
    scheduled_at: item.line_date,
    client: undefined
  };
}

/**
 * State for the long-form invoice builder (all sections on one page).
 *
 * @param invoiceId - When provided, the builder enters EDIT mode: it hydrates
 *   its state from the existing DRAFT invoice instead of fetching trips. Create
 *   mode (invoiceId undefined) is unchanged.
 */
export function useInvoiceBuilder(
  companyId: string,
  onCreated: (invoiceId: string) => void,
  invoiceId?: string
) {
  const queryClient = useQueryClient();

  // why: edit mode re-opens a persisted draft; create mode builds from trips.
  const isEditMode = !!invoiceId;

  const [step2Values, setStep2Values] = useState<Step2Values | null>(null);
  const [lineItems, setLineItems] = useState<BuilderLineItem[]>([]);
  /** Cancelled rows with per-trip billing inclusion state. Default opted-out. */
  const [cancelledTrips, setCancelledTrips] = useState<
    BuilderCancelledTripRow[]
  >([]);
  /** Pricing rules cached from last fetch — needed for cancelled trip opt-in repricing. */
  const [cachedRules, setCachedRules] = useState<BillingPricingRuleLike[]>([]);
  const [cachedClientPriceTags, setCachedClientPriceTags] = useState<
    ClientPriceTagLike[]
  >([]);
  const [cachedClientKmOverrides, setCachedClientKmOverrides] = useState<
    ClientKmOverrideLike[]
  >([]);
  const [section3Confirmed, setSection3Confirmed] = useState(false);
  /** Catalog cascade (variant → type → payer) from the first fetched trip. */
  const [catalogRecipientId, setCatalogRecipientId] = useState<string | null>(
    null
  );

  const confirmSection3 = useCallback(() => setSection3Confirmed(true), []);

  /** Invoice number of the draft being edited — shown in the edit-mode banner. */
  const [editInvoiceNumber, setEditInvoiceNumber] = useState<string | null>(
    null
  );
  /**
   * Set true on the first successful hydration seed and never reset.
   * why: a React Query background/window-focus refetch must never overwrite
   * in-progress admin edits after the initial load.
   */
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    // why: in edit mode step2Values is seeded from the invoice; the create-mode
    // "reset when params incomplete" behaviour must not clobber hydrated state.
    if (isEditMode) return;
    if (!step2ValuesReadyForTripsFetch(step2Values)) {
      setLineItems([]);
      setCancelledTrips([]);
      setCatalogRecipientId(null);
      setSection3Confirmed(false);
    }
  }, [step2Values, isEditMode]);

  // ── Edit-mode hydration ───────────────────────────────────────────────────
  // why: pin the cache so a background/focus refetch cannot re-emit invoice data
  // after the admin starts editing (paired with hasHydratedRef below).
  const hydrationQuery = useQuery({
    queryKey: invoiceKeys.full(invoiceId ?? '__none__'),
    queryFn: () => getInvoiceDetail(invoiceId!),
    enabled: isEditMode,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false
  });

  useEffect(() => {
    if (!isEditMode) return;
    // why: seed exactly once; never overwrite in-progress edits on any re-emit.
    if (hasHydratedRef.current) return;
    const detail = hydrationQuery.data;
    if (!detail) return;
    hasHydratedRef.current = true;

    const rows = detail.line_items ?? [];
    // why: cancelled-trip line items hydrate into the cancelled-trip block;
    // normal lines into the main positions list.
    const normalRows = rows.filter((r) => r.is_cancelled_trip !== true);
    const cancelledRows = rows.filter((r) => r.is_cancelled_trip === true);
    // why: payers.manual_km_enabled is not on the invoice detail join; default
    // false here (KM-input visibility is UI-only). Refined when the edit route
    // threads payer context — deferred to the save-path phase.
    const mapCtx = { manualKmEnabled: false };

    setLineItems(
      normalRows.map((r) => mapLineItemRowToBuilderLineItem(r, mapCtx))
    );
    setCancelledTrips(
      cancelledRows.map((r) => mapLineItemRowToBuilderCancelledTrip(r, mapCtx))
    );
    setStep2Values({
      mode: detail.mode,
      payer_id: detail.payer_id,
      billing_type_id: detail.billing_type_id,
      // why: billing_type_ids / billing_variant_ids are fetch-only (never on the
      // invoice row); edit mode does not re-fetch trips, so null is correct.
      billing_type_ids: null,
      billing_variant_id: detail.billing_variant_id,
      billing_variant_ids: null,
      period_from: detail.period_from,
      period_to: detail.period_to,
      client_id: detail.client_id
    });
    setCatalogRecipientId(detail.rechnungsempfaenger_id ?? null);
    // why: the draft was already confirmed once; re-open with all sections
    // navigable instead of forcing the admin to re-confirm Section 3.
    setSection3Confirmed(true);
    setEditInvoiceNumber(detail.invoice_number);
  }, [isEditMode, hydrationQuery.data]);

  const tripsQuery = useQuery({
    queryKey: step2Values
      ? invoiceKeys.tripsForBuilder(tripsBuilderParamsFromStep2(step2Values))
      : ['invoices', 'builder-trips', 'idle'],
    queryFn: async () => {
      const payerId = step2Values!.payer_id;
      const rulesRows = await queryClient.fetchQuery({
        queryKey: referenceKeys.billingPricingRules(payerId),
        queryFn: () => listPricingRulesForPayer(payerId),
        staleTime: 30_000
      });
      const rules = mapBillingPricingRuleRowsToLike(rulesRows);
      const tripsParams = tripsBuilderParamsFromStep2(step2Values!);
      const [
        { trips, clientPriceTags, clientKmOverrides },
        {
          trips: cancelled,
          clientPriceTags: cancelledClientPriceTags,
          clientKmOverrides: cancelledClientKmOverrides
        }
      ] = await Promise.all([
        fetchTripsForBuilder(tripsParams),
        fetchCancelledTripsForBuilder(tripsParams)
      ]);
      // why: merge cancelled-trip client pricing data with normal-trip data so that
      // buildCancelledTripBillingState sees rules for clients whose only trips in
      // this period are cancelled (they would otherwise be missing from the cache).
      // Duplicate entries for shared clients are harmless — resolvePricingRule uses
      // .filter().find() and returns the first match.
      const allClientPriceTags = [
        ...clientPriceTags,
        ...cancelledClientPriceTags
      ];
      const allClientKmOverrides = [
        ...clientKmOverrides,
        ...cancelledClientKmOverrides
      ];
      const items = buildLineItemsFromTrips(
        trips,
        rules,
        clientPriceTags,
        clientKmOverrides
      );
      // why: default opted-out; billingInclusion is set at fetch-time so the hook
      // never holds CancelledTripRow without billingInclusion.
      const cancelledWithInclusion: BuilderCancelledTripRow[] = cancelled.map(
        (t) => ({ ...t, billingInclusion: { included: false, reason: '' } })
      );
      setCancelledTrips(cancelledWithInclusion);
      setCachedRules(rules);
      setCachedClientPriceTags(allClientPriceTags);
      setCachedClientKmOverrides(allClientKmOverrides);
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
    // why: in edit mode we hydrate from the persisted draft and must NOT fetch
    // trips — re-running buildLineItemsFromTrips would silently recompute prices
    // from current (mutable) trips on load.
    enabled: !isEditMode && step2ValuesReadyForTripsFetch(step2Values),
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

  const applyKmOverride = useCallback((position: number, km: number) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.position !== position) return item;
        // why: non-positive distance is not billable — matches resolveEffectiveDistanceKm.
        if (!Number.isFinite(km) || km <= 0) return item;
        const { rate: newTaxRate } = resolveTaxRate(km);
        const approachNet = item.approach_fee_net;

        // why: Taxameter gross is all-in; changing KM must not re-run tiered pricing on that gross.
        if (item.price_resolution.source === 'manual_gross_price') {
          const patched: BuilderLineItem = {
            ...item,
            effective_distance_km: km,
            manualDistanceKm: km,
            isManualKmOverride: true,
            tax_rate: newTaxRate,
            approach_fee_gross:
              approachNet != null
                ? Math.round(approachNet * (1 + newTaxRate) * 100) / 100
                : null,
            price_resolution: {
              ...item.price_resolution,
              tax_rate: newTaxRate
            }
          };
          return { ...patched, warnings: validateLineItem(patched) };
        }

        const newPriceResolution = item.resolved_rule
          ? resolveTripPricePure(
              {
                ...tripInputFromLineItem(item),
                driving_distance_km: km
              },
              newTaxRate,
              item.resolved_rule
            )
          : {
              ...item.price_resolution,
              tax_rate: newTaxRate
            };

        const nextApproachNet = newPriceResolution.approach_fee_net ?? null;
        const patched: BuilderLineItem = {
          ...item,
          effective_distance_km: km,
          manualDistanceKm: km,
          isManualKmOverride: true,
          tax_rate: newTaxRate,
          unit_price: newPriceResolution.unit_price_net ?? item.unit_price,
          quantity: newPriceResolution.quantity,
          approach_fee_net: nextApproachNet,
          approach_fee_gross:
            nextApproachNet != null
              ? Math.round(nextApproachNet * (1 + newTaxRate) * 100) / 100
              : null,
          price_resolution: newPriceResolution,
          kts_override: newPriceResolution.strategy_used === 'kts_override',
          price_source: legacyPriceSourceFromResolution(
            newPriceResolution.source
          )
        };
        return { ...patched, warnings: validateLineItem(patched) };
      })
    );
  }, []);

  const resetKmOverride = useCallback((position: number) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.position !== position) return item;
        const orig = item.originalPriceResolution ?? item.price_resolution;
        const restoredRate = resolveTaxRate(item.original_distance_km).rate;
        const approachNet = orig.approach_fee_net ?? null;
        const patched: BuilderLineItem = {
          ...item,
          effective_distance_km: item.original_distance_km,
          manualDistanceKm: null,
          isManualKmOverride: false,
          tax_rate: restoredRate,
          unit_price: orig.unit_price_net,
          quantity: orig.quantity,
          approach_fee_net: approachNet,
          approach_fee_gross:
            approachNet != null
              ? Math.round(approachNet * (1 + restoredRate) * 100) / 100
              : null,
          price_resolution: orig,
          kts_override: orig.strategy_used === 'kts_override',
          price_source: legacyPriceSourceFromResolution(orig.source)
        };
        return { ...patched, warnings: validateLineItem(patched) };
      })
    );
  }, []);

  // ── Billing inclusion handlers ────────────────────────────────────────────────

  /** why: admin opts a normal trip out of (or back into) billing in Step 3. */
  const handleLineItemInclusionChange = useCallback(
    (position: number, included: boolean, reason: string) => {
      setLineItems((prev) =>
        prev.map((item) =>
          item.position === position
            ? { ...item, billingInclusion: { included, reason } }
            : item
        )
      );
    },
    []
  );

  /** why: admin opts a cancelled trip in or out of billing in Step 3. */
  const handleCancelledTripInclusionChange = useCallback(
    (tripId: string, included: boolean, reason: string) => {
      setCancelledTrips((prev) =>
        prev.map((trip) => {
          if (trip.id !== tripId) return trip;
          if (included) {
            // Run pricing cascade same as normal trips
            const billingState = buildCancelledTripBillingState(
              trip,
              cachedRules,
              cachedClientPriceTags,
              cachedClientKmOverrides
            );
            return {
              ...trip,
              ...billingState,
              includeApproachFee: true,
              billingInclusion: { included: true, reason }
            };
          }
          // Opt out: clear all pricing state
          return {
            ...trip,
            price_resolution: undefined,
            resolved_rule: undefined,
            unit_price: undefined,
            tax_rate: undefined,
            quantity: undefined,
            approach_fee_net: undefined,
            approach_fee_gross: undefined,
            effective_distance_km: undefined,
            original_distance_km: undefined,
            kts_override: undefined,
            manualGrossTotal: undefined,
            manualApproachFeeGross: undefined,
            isManualOverride: undefined,
            manualDistanceKm: undefined,
            isManualKmOverride: undefined,
            includeApproachFee: undefined,
            billingInclusion: { included: false, reason: '' }
          };
        })
      );
    },
    [cachedRules, cachedClientPriceTags, cachedClientKmOverrides]
  );

  /** why: mirrors applyGrossOverride for opted-in cancelled trips. */
  const handleCancelledTripGrossOverride = useCallback(
    (tripId: string, grossTotal: number, approachFeeGross: number) => {
      setCancelledTrips((prev) =>
        prev.map((trip) => {
          if (trip.id !== tripId || !trip.price_resolution || !trip.tax_rate) {
            return trip;
          }
          const nextRes = applyGrossOverrideToResolution(
            trip.price_resolution,
            grossTotal,
            approachFeeGross,
            trip.tax_rate
          );
          return {
            ...trip,
            unit_price: nextRes.unit_price_net,
            approach_fee_net: nextRes.approach_fee_net ?? null,
            approach_fee_gross: approachFeeGross,
            price_resolution: nextRes,
            kts_override: false,
            manualGrossTotal: grossTotal,
            manualApproachFeeGross: approachFeeGross,
            isManualOverride: true
          };
        })
      );
    },
    []
  );

  /** why: mirrors applyKmOverride for opted-in cancelled trips. */
  const handleCancelledTripKmOverride = useCallback(
    (tripId: string, km: number) => {
      setCancelledTrips((prev) =>
        prev.map((trip) => {
          if (
            trip.id !== tripId ||
            !trip.price_resolution ||
            !Number.isFinite(km) ||
            km <= 0
          ) {
            return trip;
          }
          const { rate: newTaxRate } = resolveTaxRate(km);
          const approachNet = trip.approach_fee_net ?? null;

          // why: preserve gross when Taxameter-originated or admin typed a gross override
          if (
            trip.price_resolution.source === 'manual_gross_price' ||
            trip.isManualOverride === true
          ) {
            return {
              ...trip,
              effective_distance_km: km,
              manualDistanceKm: km,
              isManualKmOverride: true,
              tax_rate: newTaxRate,
              approach_fee_gross:
                approachNet != null
                  ? Math.round(approachNet * (1 + newTaxRate) * 100) / 100
                  : null,
              price_resolution: {
                ...trip.price_resolution,
                tax_rate: newTaxRate
              }
            };
          }

          const kmRule =
            trip.resolved_rule && trip.includeApproachFee === false
              ? {
                  ...trip.resolved_rule,
                  config: {
                    ...(trip.resolved_rule.config as Record<string, unknown>),
                    approach_fee_net: 0
                  }
                }
              : (trip.resolved_rule ?? null);

          const newPriceResolution = kmRule
            ? resolveTripPricePure(
                {
                  kts_document_applies: trip.kts_document_applies ?? false,
                  net_price: null,
                  base_net_price: null,
                  manual_gross_price: null,
                  driving_distance_km: km,
                  scheduled_at: trip.scheduled_at,
                  client: undefined
                },
                newTaxRate,
                kmRule
              )
            : { ...trip.price_resolution, tax_rate: newTaxRate };

          const nextApproachNet = newPriceResolution.approach_fee_net ?? null;
          return {
            ...trip,
            effective_distance_km: km,
            manualDistanceKm: km,
            isManualKmOverride: true,
            tax_rate: newTaxRate,
            unit_price: newPriceResolution.unit_price_net ?? trip.unit_price,
            quantity: newPriceResolution.quantity,
            approach_fee_net: nextApproachNet,
            approach_fee_gross:
              nextApproachNet != null
                ? Math.round(nextApproachNet * (1 + newTaxRate) * 100) / 100
                : null,
            price_resolution: newPriceResolution,
            kts_override: newPriceResolution.strategy_used === 'kts_override'
          };
        })
      );
    },
    []
  );

  /** Toggle approach fee inclusion on an opted-in cancelled trip. */
  const handleCancelledTripApproachFeeChange = useCallback(
    (tripId: string, include: boolean) => {
      setCancelledTrips((prev) =>
        prev.map((trip) => {
          if (trip.id !== tripId || !trip.price_resolution || !trip.tax_rate) {
            return trip;
          }
          if (trip.isManualOverride) {
            return { ...trip, includeApproachFee: include };
          }
          const baseRule = trip.resolved_rule ?? null;
          const effectiveRule =
            !include && baseRule
              ? {
                  ...baseRule,
                  config: {
                    ...(baseRule.config as Record<string, unknown>),
                    approach_fee_net: 0
                  }
                }
              : baseRule;
          const { rate: taxRate } = resolveTaxRate(
            trip.effective_distance_km ?? 0
          );
          const newPriceResolution = resolveTripPricePure(
            {
              kts_document_applies: trip.kts_document_applies ?? false,
              net_price: null,
              base_net_price: null,
              manual_gross_price: null,
              driving_distance_km: trip.effective_distance_km ?? null,
              scheduled_at: trip.scheduled_at,
              client: trip.client
                ? { price_tag: trip.client.price_tag ?? null }
                : null
            },
            taxRate,
            effectiveRule
          );
          const nextApproachNet = newPriceResolution.approach_fee_net ?? null;
          return {
            ...trip,
            price_resolution: newPriceResolution,
            unit_price: newPriceResolution.unit_price_net,
            approach_fee_net: nextApproachNet,
            approach_fee_gross:
              nextApproachNet != null
                ? Math.round(nextApproachNet * (1 + taxRate) * 100) / 100
                : null,
            quantity: newPriceResolution.quantity,
            kts_override: newPriceResolution.strategy_used === 'kts_override',
            includeApproachFee: include
          };
        })
      );
    },
    []
  );

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

  // why: totals must reflect only billing-included rows; opted-out normal trips and
  // opted-out cancelled trips are excluded from subtotal/tax/total.
  const includedNormal = lineItems.filter((i) => i.billingInclusion.included);
  const includedCancelled = cancelledTrips.filter(
    (c) => c.billingInclusion.included && c.price_resolution != null
  );
  const totals = calculateInvoiceTotals([
    ...includedNormal,
    ...includedCancelled.map((c) => ({
      price_resolution: c.price_resolution!,
      tax_rate: c.tax_rate ?? 0,
      quantity: c.quantity ?? 1,
      approach_fee_net: c.approach_fee_net ?? null,
      unit_price: c.unit_price ?? null,
      manualGrossTotal: c.manualGrossTotal ?? null
    }))
  ]);
  const missingPrices = hasMissingPrices(lineItems);
  const excludedTripCount = lineItems.filter(
    (i) => !i.billingInclusion.included
  ).length;
  const hasInclusionErrors = hasInclusionReasonErrors(
    lineItems,
    cancelledTrips
  );

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

      const optedInCancelled = cancelledTrips.filter(
        (c) => c.billingInclusion.included && c.price_resolution != null
      );
      await insertLineItems(invoice.id, lineItems, optedInCancelled);

      // Fire-and-forget: failed writeback must never block the invoice.
      // price_resolution.net is transport-only; Anfahrt on approach_fee_net.
      // Phase 2: `trips.net_price` is a generated column — never write it here; DB combines base + approach.
      // why: persist admin KM for future resolveEffectiveDistanceKm; never write driving_distance_km.
      void Promise.allSettled(
        lineItems
          .filter((item) => item.trip_id !== null)
          .map((item) => {
            const baseNet = item.price_resolution.net;
            const approachNet = item.approach_fee_net ?? 0;
            return tripsService.updateTrip(item.trip_id!, {
              gross_price: item.manualGrossTotal ?? item.price_resolution.gross,
              tax_rate: item.tax_rate,
              base_net_price: baseNet,
              approach_fee_net: approachNet,
              ...(item.isManualOverride && item.manualGrossTotal !== null
                ? { manual_gross_price: item.manualGrossTotal }
                : {}),
              ...(item.isManualKmOverride && item.manualDistanceKm != null
                ? { manual_distance_km: item.manualDistanceKm }
                : {})
            });
          })
      );

      return invoice;
    },

    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      // Invalidate revenue total to refresh "Rechnungsumsatz" stat on dashboard
      // since invoice creation (and subsequent status changes) affect the revenue calculation
      void queryClient.invalidateQueries({
        queryKey: invoiceKeys.revenueTotal
      });
      toast.success(`Rechnung ${invoice.invoice_number} wurde erstellt.`);
      onCreated(invoice.id);
    },

    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Rechnung konnte nicht erstellt werden: ' + message);
    }
  });

  // ── Edit-mode save (draft re-open, Phase C) ───────────────────────────────
  // why: parallels createMutation but routes through updateDraftInvoice so the
  // RPC owns the status='draft' guard + server-side totals recompute. The create
  // flow above is left untouched.
  const updateMutation = useMutation({
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
      // why: invoiceId is guaranteed present in edit mode (this path is only
      // wired through updateInvoice, which the shell calls only when isEditMode).
      if (!invoiceId) throw new Error('Keine Rechnung zum Bearbeiten');

      const { step4Values, pdfColumnOverride } = args;

      // Step-4 meta resolution is identical to create: 'none' sentinel -> null,
      // recipient falls back to the catalog-derived recipient.
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

      let pdfPayload: Record<string, unknown> | null = null;
      if (pdfColumnOverride) {
        pdfPayload = pdfColumnOverrideSchema.parse(
          pdfColumnOverride
        ) as unknown as Record<string, unknown>;
      }

      // why: serialize ALL normal items (incl. excluded — they persist for audit)
      // + opted-in cancelled trips appended after lineItems.length, exactly as
      // insertLineItems does. The RPC ignores each row's invoice_id (it uses
      // p_invoice_id), so reusing these serializers is safe.
      const normalRows = lineItems.map((item) =>
        lineItemToInsertRow(invoiceId, item)
      );
      const optedInCancelled = cancelledTrips.filter(
        (c) => c.billingInclusion.included && c.price_resolution != null
      );
      const cancelledRows = optedInCancelled.map((trip, i) =>
        cancelledTripToInsertRow(invoiceId, trip, lineItems.length + i + 1)
      );

      await updateDraftInvoice({
        invoiceId,
        introBlockId: intro_block_id ?? null,
        outroBlockId: outro_block_id ?? null,
        paymentDueDays: step4Values.payment_due_days,
        rechnungsempfaengerId: rechnungsempfaengerId ?? null,
        pdfColumnOverride: pdfPayload,
        lineItemRows: [...normalRows, ...cancelledRows]
      });

      // why: same fire-and-forget trip writeback as create so re-saving a draft
      // keeps trip pricing in sync; a failed writeback must never block the save.
      void Promise.allSettled(
        lineItems
          .filter((item) => item.trip_id !== null)
          .map((item) => {
            const baseNet = item.price_resolution.net;
            const approachNet = item.approach_fee_net ?? 0;
            return tripsService.updateTrip(item.trip_id!, {
              gross_price: item.manualGrossTotal ?? item.price_resolution.gross,
              tax_rate: item.tax_rate,
              base_net_price: baseNet,
              approach_fee_net: approachNet,
              ...(item.isManualOverride && item.manualGrossTotal !== null
                ? { manual_gross_price: item.manualGrossTotal }
                : {}),
              ...(item.isManualKmOverride && item.manualDistanceKm != null
                ? { manual_distance_km: item.manualDistanceKm }
                : {})
            });
          })
      );

      return invoiceId;
    },

    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: invoiceKeys.all });
      // why: the edited draft's full detail is cached (hydration query) — drop it
      // so the detail page re-reads the freshly persisted lines + totals.
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.full(id) });
      void queryClient.invalidateQueries({
        queryKey: invoiceKeys.revenueTotal
      });
      toast.success('Änderungen wurden gespeichert.');
      // why: onCreated is a navigation-only callback (index.tsx passes
      // router.push('/dashboard/invoices/' + id)). The edit-success target is the
      // same detail page, so reuse is functionally correct; NOT renamed to onSaved
      // because that would change the hook signature shared with the create flow.
      onCreated(id);
    },

    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Änderungen konnten nicht gespeichert werden: ' + message);
    }
  });

  return {
    step2Values,
    lineItems,
    cancelledTrips,
    section3Confirmed,
    catalogRecipientId,
    totals,
    missingPrices,
    excludedTripCount,
    hasInclusionErrors,

    // Edit mode (draft re-open) — undefined invoiceId keeps these inert.
    isEditMode,
    editInvoiceNumber,
    isHydrating: isEditMode && hydrationQuery.isLoading,

    isLoadingTrips: tripsQuery.isLoading,
    isTripsError: tripsQuery.isError,
    tripsCount: lineItems.length,

    handleStep1Complete,
    handleStep2Complete,
    confirmSection3,
    applyGrossOverride,
    resetLineItemOverride,
    applyKmOverride,
    resetKmOverride,
    handleLineItemInclusionChange,
    handleCancelledTripInclusionChange,
    handleCancelledTripGrossOverride,
    handleCancelledTripKmOverride,
    handleCancelledTripApproachFeeChange,

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
    isCreating: createMutation.isPending,

    // Edit-mode save (draft re-open). Inert in create mode (never invoked there).
    updateInvoice: (
      step4Values: Pick<
        InvoiceBuilderFormValues,
        | 'intro_block_id'
        | 'outro_block_id'
        | 'payment_due_days'
        | 'rechnungsempfaenger_id'
      >,
      pdfColumnOverride: PdfColumnOverridePayload | null
    ) => updateMutation.mutate({ step4Values, pdfColumnOverride }),
    isSaving: updateMutation.isPending
  };
}
