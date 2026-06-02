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
 * ── Preview trigger classification (manual-only contract) ─────────────────
 *
 * Category A — layout/template: marks isDirty; no auto-render.
 * Category B — trip data: marks isDirty after first completed render; no auto-render.
 *
 * Explicit render triggers only:
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
 *   B: lineItems (source for includedLineItemsForDraft)
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
import type {
  BuilderCancelledTripRow,
  BuilderLineItem,
  ExcludedTripRow,
  InvoiceDetail
} from '@/features/invoices/types/invoice.types';
import type { PdfColumnProfile } from '@/features/invoices/types/pdf-vorlage.types';

interface PreviewPayload {
  draftInvoice: InvoiceDetail | null;
  introText: string | null | undefined;
  outroText: string | null | undefined;
  paymentQrDataUrl: null;
  columnProfile: PdfColumnProfile;
  passiveCancelledTrips: BuilderCancelledTripRow[];
  excludedTrips: ExcludedTripRow[];
}

/** why: JSON.stringify on 160 rows runs on every keystroke
 *  and accumulates CPU pressure over long sessions.
 *  A numeric hash is ~100x cheaper with identical dirty
 *  detection for the KM/inclusion changes we care about. */
function buildCategoryBSignature(
  included: BuilderLineItem[],
  billed: BuilderCancelledTripRow[],
  passive: BuilderCancelledTripRow[],
  excluded: ExcludedTripRow[]
): string {
  const hashIncluded = (rows: BuilderLineItem[]) =>
    rows.reduce(
      (acc, r) =>
        acc +
        (r.position ?? 0) * 1000 +
        Math.round((r.effective_distance_km ?? 0) * 100) +
        (r.billingInclusion.included ? 1 : 0),
      0
    );

  const hashCancelled = (rows: BuilderCancelledTripRow[]) =>
    rows.reduce((acc, r) => {
      const idFold = r.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      return (
        acc +
        idFold * 1000 +
        Math.round((r.effective_distance_km ?? 0) * 100) +
        (r.billingInclusion.included ? 1 : 0)
      );
    }, 0);

  const hashExcluded = (rows: ExcludedTripRow[]) =>
    rows.reduce((acc, r) => {
      let reasonFold = 0;
      for (let i = 0; i < r.billing_exclusion_reason.length; i++) {
        reasonFold += r.billing_exclusion_reason.charCodeAt(i);
      }
      return acc + (r.client_name?.length ?? 0) * 1000 + reasonFold;
    }, 0);

  return `${hashIncluded(included)}_${hashCancelled(billed)}_${hashCancelled(passive)}_${hashExcluded(excluded)}`;
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
  const hasCompletedFirstRenderRef = useRef(false);
  const prevCategoryBSignatureRef = useRef<string | null>(null);
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

  // why: draft PDF cover table must show only billing-included normal trips (identical filter to InvoicePdfDocument)
  const includedLineItemsForDraft = useMemo(
    () => lineItems.filter((li) => li.billingInclusion.included),
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
    // why: QR generation ran on every draftInvoice change (every trip edit),
    // adding async work throughout the session. The QR is not scannable in a
    // preview — it is only meaningful in the final saved PDF. Pass null here;
    // InvoicePdfCoverBody renders a placeholder instead.
    paymentQrDataUrl: null,
    columnProfile,
    passiveCancelledTrips,
    excludedTrips
  };

  const commitPreviewUpdate = useCallback(() => {
    const p = previewPayloadRef.current;
    if (!p.draftInvoice) return;
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

  // why: first completed blob URL marks the session as having shown a preview —
  // Category B dirty tracking only starts after this point.
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
    prevCategoryBSignatureRef.current = null;
  }, [livePreviewActive]);

  // why: first draft available — mark dirty instead of auto-rendering. Admin clicks
  // Aktualisieren (or opens mobile sheet) for their first render; prevents silent
  // background layout at session start on large invoices.
  useEffect(() => {
    if (!draftInvoice) return;
    if (hasCompletedFirstRenderRef.current) return;
    setCategoryBDirty(true);
  }, [draftInvoice]);

  // why: Category A auto-render was removed — layout/template changes previously
  // triggered debounced react-pdf layout on every edit, accumulating memory and
  // causing tab crashes at 160+ trips. Now they mark dirty and wait for explicit
  // admin refresh (Aktualisieren or mobile sheet open).
  useEffect(() => {
    if (!livePreviewActive) return;
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
    livePreviewActive
  ]);

  // why: trip data edits must not auto-render — flag dirty for manual refresh only.
  useEffect(() => {
    const sig = buildCategoryBSignature(
      includedLineItemsForDraft,
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
    if (hasCompletedFirstRenderRef.current) {
      setCategoryBDirty(true);
    }
  }, [
    includedLineItemsForDraft,
    billedCancelledTrips,
    passiveCancelledTrips,
    excludedTrips
  ]);

  const requestPreviewUpdate = useCallback(() => {
    setCategoryBDirty(false);
    commitPreviewUpdate();
  }, [commitPreviewUpdate]);

  return {
    pdf,
    draftInvoice,
    livePreviewActive,
    isDirty: categoryBDirty,
    requestPreviewUpdate
  };
}
