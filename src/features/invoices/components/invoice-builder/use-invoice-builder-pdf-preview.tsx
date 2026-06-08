'use client';

/**
 * use-invoice-builder-pdf-preview.tsx
 *
 * Debounced @react-pdf hook for the invoice builder’s live preview. Composes
 * draft InvoiceDetail from trips + Step 2 snapshot + optional Step 5 meta overlay.
 *
 * Must not call createInvoice or mutate TanStack Query caches — read-only hooks only.
 *
 * Related: {@link build-draft-invoice-detail-for-pdf.ts}, {@link InvoicePdfDocument.tsx}.
 *
 * ── Preview trigger classification (threshold-gated contract) ───────────────
 *
 * Below MANUAL_PREVIEW_TRIP_THRESHOLD: Category A auto-renders (600 ms debounce;
 * 0 ms on column reorder); initial load auto-renders once.
 * At/above threshold: Category A and initial load mark isDirty only — manual refresh.
 * Category B — trip data: sets isDirty when fingerprint changes (manual refresh).
 *
 * Explicit render triggers (all trip counts):
 *   - Admin clicks Aktualisieren / Vorschau laden → requestPreviewUpdate()
 *   - Mobile preview sheet opens (wired in index.tsx)
 *
 * draftInvoice useMemo deps:
 *   Gate: livePreviewActive
 *   A: companyId, companyProfileForDraft, step2Values, payers, clients,
 *      paymentDueDays, introText, outroText, recipientRow, placeholderInvoiceNumber,
 *      columnProfile
 *   B: includedLineItemsForDraft, billedCancelledTrips
 *
 * Hook params / related:
 *   B: lineItems (raw — Category B fingerprint; source for includedLineItemsForDraft)
 *   B fingerprint: buildPreviewDirtyFingerprint(lineItems, …) in preview-dirty-fingerprint.ts
 *   A: logo URL effect (companyProfile?.logo_path / logo_url)
 *   Preview QR: always null — placeholder in InvoicePdfCoverBody for draft id
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePDF } from '@react-pdf/renderer';

import { resolveCompanyAssetUrl } from '@/features/storage/resolve-company-asset-url';
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';
import { useRechnungsempfaengerOptions } from '@/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options';
import type { RechnungsempfaengerRow } from '@/features/rechnungsempfaenger/api/rechnungsempfaenger.service';
import {
  buildDraftInvoiceDetailForPdf,
  type InvoiceBuilderStep2Snapshot
} from '@/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf';
import { InvoicePdfDocument } from '@/features/invoices/components/invoice-pdf/InvoicePdfDocument';
import { billingIncludedLineItems } from '@/features/invoices/lib/billing-inclusion';
import { buildPreviewDirtyFingerprint } from '@/features/invoices/lib/preview-dirty-fingerprint';
import type {
  BuilderCancelledTripRow,
  BuilderLineItem,
  ExcludedTripRow,
  InvoiceDetail
} from '@/features/invoices/types/invoice.types';
import type { PdfColumnProfile } from '@/features/invoices/types/pdf-vorlage.types';

/** why: main-thread PDF layout becomes a crash risk above this trip count over
 *  long sessions (~90 min). Below the threshold the live preview UX is preserved.
 *  Above it, all renders are manual to protect browser memory. */
export const MANUAL_PREVIEW_TRIP_THRESHOLD = 90;

/** why: coalesce rapid Category A (layout) edits without flooding react-pdf layout. */
const PREVIEW_CATEGORY_A_DEBOUNCE_MS = 600;
/** why: column drag-reorder must feel instant — same as today. */
const PREVIEW_COLUMN_REORDER_DELAY_MS = 0;

interface PreviewPayload {
  draftInvoice: InvoiceDetail | null;
  introText: string | null | undefined;
  outroText: string | null | undefined;
  paymentQrDataUrl: null;
  columnProfile: PdfColumnProfile;
  passiveCancelledTrips: BuilderCancelledTripRow[];
  excludedTrips: ExcludedTripRow[];
}

export interface InvoiceBuilderStep4PdfOverlay {
  paymentDueDays: number;
  introText: string | null;
  outroText: string | null;
  recipientRow: RechnungsempfaengerRow | null | undefined;
}

export interface UseInvoiceBuilderPdfPreviewParams {
  companyId: string;
  companyProfile: InvoiceDetail['company_profile'] | null;
  step2Values: InvoiceBuilderStep2Snapshot | null;
  /** Line items fed from `fetchTripsForBuilder`; billing-only. */
  lineItems: BuilderLineItem[];
  /**
   * Passive cancelled trips (opted-out, €0) — pre-split in index.tsx with useMemo.
   * Gated by show_cancelled_trips profile flag in InvoicePdfDocument.
   * Must be a stable reference (useMemo in caller) to avoid re-firing the PDF useEffect.
   */
  passiveCancelledTrips: BuilderCancelledTripRow[];
  /** Opted-in cancelled trips with real billing prices — always shown in billed block when non-empty. */
  billedCancelledTrips?: BuilderCancelledTripRow[];
  /** Opted-out normal trips with exclusion reasons — gated by show_excluded_trips profile flag. */
  excludedTrips?: ExcludedTripRow[];
  payers: NonNullable<InvoiceDetail['payer']>[];
  clients: NonNullable<InvoiceDetail['client']>[];
  defaultPaymentDays: number;
  catalogRecipientId: string | null;
  payerIntroBlockId?: string | null;
  payerOutroBlockId?: string | null;
  step4Overlay: InvoiceBuilderStep4PdfOverlay | null;
  /** When true, Step 5 (Bestätigung) form fields override draft PDF meta inputs. */
  applyStep4Overlay: boolean;
  /**
   * columnProfile — resolved PDF column profile from Section 4 (PDF-Vorlage).
   * Passed into buildDraftInvoiceDetailForPdf so the live preview reflects
   * the dispatcher’s Vorlage/column selection in real time.
   * Initialized to system default in index.tsx so this value is never null.
   */
  columnProfile: PdfColumnProfile;
  /**
   * Incremented when the user drag-reorders PDF columns in Section 4 so the next preview update
   * is not delayed by the usual debounce.
   */
  columnReorderGeneration?: number;
}

/**
 * Returns a debounced PDF instance and the current draft invoice for the builder preview.
 *
 * @param params — builder snapshot + overlay flags + column profile
 * @returns pdf handle, draft row or null when preview inactive, livePreviewActive flag
 */
export function useInvoiceBuilderPdfPreview(
  params: UseInvoiceBuilderPdfPreviewParams
): {
  pdf: ReturnType<typeof usePDF>[0];
  draftInvoice: InvoiceDetail | null;
  livePreviewActive: boolean;
  isDirty: boolean;
  requestPreviewUpdate: () => void;
} {
  const {
    companyId,
    companyProfile,
    step2Values,
    lineItems,
    passiveCancelledTrips = [],
    billedCancelledTrips = [],
    excludedTrips = [],
    payers,
    clients,
    defaultPaymentDays,
    catalogRecipientId,
    payerIntroBlockId,
    payerOutroBlockId,
    step4Overlay,
    applyStep4Overlay,
    columnProfile,
    columnReorderGeneration = 0
  } = params;

  const { data: textBlocks } = useAllInvoiceTextBlocks();
  const { data: empfaengerOptions } = useRechnungsempfaengerOptions();
  const [pdf, updatePdf] = usePDF();
  const lastColumnReorderGen = useRef(0);
  const hasCompletedFirstRenderRef = useRef(false);
  const initialRenderScheduledRef = useRef(false);
  const prevCategoryBSignatureRef = useRef<string | null>(null);
  const categoryADebounceTimerRef = useRef<number | null>(null);
  const previewPayloadRef = useRef<PreviewPayload>({
    draftInvoice: null,
    introText: null,
    outroText: null,
    paymentQrDataUrl: null,
    columnProfile: columnProfile,
    passiveCancelledTrips: [],
    excludedTrips: []
  });
  const [categoryBDirty, setCategoryBDirty] = useState(false);
  /** Same as invoice detail PDF preview: @react-pdf fetches the logo; private bucket needs a signed URL. */
  const [pdfLogoUrl, setPdfLogoUrl] = useState<string | null>(null);

  const isLargeInvoice = lineItems.length >= MANUAL_PREVIEW_TRIP_THRESHOLD;

  // Reacts to company logo path/url: resolves a short-lived signed URL for the PDF renderer.
  useEffect(() => {
    if (!companyProfile) {
      setPdfLogoUrl(null);
      return;
    }
    const logoPath = companyProfile.logo_path ?? null;
    const legacyUrl = companyProfile.logo_url ?? null;
    if (!logoPath && !legacyUrl) {
      setPdfLogoUrl(null);
      return;
    }
    let cancelled = false;
    void resolveCompanyAssetUrl({
      path: logoPath,
      url: legacyUrl,
      expiresInSeconds: 60 * 60
    }).then((resolved) => {
      if (!cancelled) setPdfLogoUrl(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [companyProfile?.logo_path, companyProfile?.logo_url]);

  const companyProfileForDraft = useMemo(() => {
    if (!companyProfile) return null;
    if (pdfLogoUrl) {
      return { ...companyProfile, logo_url: pdfLogoUrl };
    }
    return companyProfile;
  }, [companyProfile, pdfLogoUrl]);

  const placeholderInvoiceNumber = useMemo(() => {
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, '0');
    return `RE-${y}-${m}-XXXX`;
  }, []);

  const introDefault = useMemo(() => {
    if (!textBlocks || !payerIntroBlockId) return null;
    return textBlocks.find((b) => b.id === payerIntroBlockId)?.content ?? null;
  }, [textBlocks, payerIntroBlockId]);

  const outroDefault = useMemo(() => {
    if (!textBlocks || !payerOutroBlockId) return null;
    return textBlocks.find((b) => b.id === payerOutroBlockId)?.content ?? null;
  }, [textBlocks, payerOutroBlockId]);

  const defaultRecipientRow = useMemo(() => {
    if (!catalogRecipientId || !empfaengerOptions?.length) return undefined;
    return empfaengerOptions.find((r) => r.id === catalogRecipientId);
  }, [catalogRecipientId, empfaengerOptions]);

  const livePreviewActive =
    lineItems.length > 0 && !!step2Values && !!companyProfile;

  const useStep4Overlay = applyStep4Overlay && step4Overlay !== null;

  const paymentDueDays = useStep4Overlay
    ? step4Overlay!.paymentDueDays
    : defaultPaymentDays;

  const introText = useStep4Overlay ? step4Overlay!.introText : introDefault;

  const outroText = useStep4Overlay ? step4Overlay!.outroText : outroDefault;

  const recipientRow = useStep4Overlay
    ? step4Overlay!.recipientRow
    : defaultRecipientRow;

  // why: draft building uses billable-only slice; dirty detection uses raw
  // lineItems via buildPreviewDirtyFingerprint — different inputs, different jobs
  const includedLineItemsForDraft = useMemo(
    () => billingIncludedLineItems(lineItems),
    [lineItems]
  );

  const draftInvoice = useMemo(() => {
    if (!livePreviewActive || !companyProfileForDraft || !step2Values)
      return null;
    return buildDraftInvoiceDetailForPdf({
      companyId,
      companyProfile: companyProfileForDraft,
      step2: step2Values,
      lineItems: includedLineItemsForDraft,
      billedCancelledTrips,
      payers,
      clients,
      paymentDueDays,
      introText,
      outroText,
      recipientRow,
      placeholderInvoiceNumber,
      columnProfile
    });
  }, [
    livePreviewActive,
    companyId,
    companyProfileForDraft,
    step2Values,
    includedLineItemsForDraft,
    billedCancelledTrips,
    payers,
    clients,
    paymentDueDays,
    introText,
    outroText,
    recipientRow,
    placeholderInvoiceNumber,
    columnProfile
  ]);

  previewPayloadRef.current = {
    draftInvoice,
    introText,
    outroText,
    // why: QR generation is deferred to invoice save for all preview sessions
    // regardless of trip count — the preview QR is never scannable and generation
    // on every draftInvoice change adds unnecessary async work.
    paymentQrDataUrl: null,
    columnProfile,
    passiveCancelledTrips,
    excludedTrips
  };

  const commitPreviewUpdate = useCallback(() => {
    const p = previewPayloadRef.current;
    if (!p.draftInvoice) return;
    // why: QR generation is deferred to invoice save for all preview sessions
    // regardless of trip count — the preview QR is never scannable and generation
    // on every draftInvoice change adds unnecessary async work.
    updatePdf(
      <InvoicePdfDocument
        invoice={p.draftInvoice}
        introText={p.introText}
        outroText={p.outroText}
        paymentQrDataUrl={p.paymentQrDataUrl}
        columnProfile={p.columnProfile}
        cancelledTrips={p.passiveCancelledTrips}
        excludedTrips={p.excludedTrips}
        // why: the builder only ever previews a draft (unsaved or saved-draft),
        // and this preview is the most likely to be screenshotted/printed before
        // saving — always stamp ENTWURF, no status check needed here.
        showDraftWatermark={true}
      />
    );
  }, [updatePdf]);

  const scheduleCategoryAUpdate = useCallback(
    (delayMs: number) => {
      if (categoryADebounceTimerRef.current !== null) {
        window.clearTimeout(categoryADebounceTimerRef.current);
      }
      categoryADebounceTimerRef.current = window.setTimeout(() => {
        categoryADebounceTimerRef.current = null;
        commitPreviewUpdate();
      }, delayMs);
    },
    [commitPreviewUpdate]
  );

  // why: first completed blob URL — gates Category A auto-render and initial
  // scheduling only; Category B dirty uses buildPreviewDirtyFingerprint directly.
  useEffect(() => {
    if (pdf.url) {
      hasCompletedFirstRenderRef.current = true;
    }
  }, [pdf.url]);

  // why: without reset, draftInvoice becomes null but categoryBDirty stays true,
  // leaving "Vorschau veraltet" over an outdated PDF with no way to clear it.
  useEffect(() => {
    if (livePreviewActive) return;
    setCategoryBDirty(false);
    hasCompletedFirstRenderRef.current = false;
    initialRenderScheduledRef.current = false;
    prevCategoryBSignatureRef.current = null;
    if (categoryADebounceTimerRef.current !== null) {
      window.clearTimeout(categoryADebounceTimerRef.current);
      categoryADebounceTimerRef.current = null;
    }
  }, [livePreviewActive]);

  // why: first preview when trips load — auto-render below threshold; mark dirty
  // above threshold so admin must click Aktualisieren or open mobile sheet.
  useEffect(() => {
    if (!draftInvoice) return;
    if (hasCompletedFirstRenderRef.current) return;
    if (initialRenderScheduledRef.current) return;
    if (isLargeInvoice) {
      // why: first render deferred to manual above threshold
      setCategoryBDirty(true);
      return;
    }
    initialRenderScheduledRef.current = true;
    scheduleCategoryAUpdate(PREVIEW_CATEGORY_A_DEBOUNCE_MS);
  }, [draftInvoice, isLargeInvoice, scheduleCategoryAUpdate]);

  // why: Category A only — must not depend on draftInvoice (changes on B edits);
  // payload ref stays current at render time. Gated above trip threshold — large
  // invoices use the dirty-only effect below instead of silent background layout.
  useEffect(() => {
    if (!livePreviewActive) return;
    if (!hasCompletedFirstRenderRef.current) return;
    if (isLargeInvoice) return;

    const reorderBumped =
      columnReorderGeneration !== lastColumnReorderGen.current;
    if (reorderBumped) {
      lastColumnReorderGen.current = columnReorderGeneration;
      scheduleCategoryAUpdate(PREVIEW_COLUMN_REORDER_DELAY_MS);
      return;
    }

    scheduleCategoryAUpdate(PREVIEW_CATEGORY_A_DEBOUNCE_MS);
  }, [
    livePreviewActive,
    isLargeInvoice,
    introText,
    outroText,
    columnProfile,
    columnReorderGeneration,
    companyProfileForDraft,
    step2Values,
    paymentDueDays,
    recipientRow,
    payers,
    clients,
    companyId,
    scheduleCategoryAUpdate
  ]);

  // why: above MANUAL_PREVIEW_TRIP_THRESHOLD, Category A changes mark dirty
  // instead of auto-rendering — prevents silent background layout at scale.
  // Below the threshold auto-render handles Category A; this effect is skipped.
  useEffect(() => {
    if (!livePreviewActive) return;
    if (!isLargeInvoice) return;
    setCategoryBDirty(true);
  }, [
    introText,
    outroText,
    columnProfile,
    columnReorderGeneration,
    companyProfileForDraft,
    step2Values,
    paymentDueDays,
    recipientRow,
    payers,
    clients,
    companyId,
    livePreviewActive,
    isLargeInvoice
  ]);

  // why: trip data edits must not auto-render — flag dirty for manual refresh only.
  useEffect(() => {
    // why: raw lineItems so opt-out toggles and price edits on excluded rows
    // are visible; pre-filtered includedLineItemsForDraft hid those changes.
    const sig = buildPreviewDirtyFingerprint(
      lineItems,
      billedCancelledTrips,
      passiveCancelledTrips,
      excludedTrips
    );
    if (prevCategoryBSignatureRef.current === null) {
      prevCategoryBSignatureRef.current = sig;
      return;
    }
    if (prevCategoryBSignatureRef.current === sig) return;
    prevCategoryBSignatureRef.current = sig;
    // why: do not gate on hasCompletedFirstRenderRef — edits during first PDF
    // load must set dirty or the banner never appears after render completes.
    setCategoryBDirty(true);
  }, [lineItems, billedCancelledTrips, passiveCancelledTrips, excludedTrips]);

  const requestPreviewUpdate = useCallback(() => {
    setCategoryBDirty(false);
    // why: if a layout change was queued and the user clicks Aktualisieren immediately,
    // clearing the timer prevents a double render — commitPreviewUpdate already uses
    // the latest draftInvoice including the layout change.
    if (categoryADebounceTimerRef.current !== null) {
      window.clearTimeout(categoryADebounceTimerRef.current);
      categoryADebounceTimerRef.current = null;
    }
    commitPreviewUpdate();
  }, [commitPreviewUpdate]);

  useEffect(() => {
    return () => {
      if (categoryADebounceTimerRef.current !== null) {
        window.clearTimeout(categoryADebounceTimerRef.current);
      }
    };
  }, []);

  return {
    pdf,
    draftInvoice,
    livePreviewActive,
    isDirty: categoryBDirty,
    requestPreviewUpdate
  };
}
