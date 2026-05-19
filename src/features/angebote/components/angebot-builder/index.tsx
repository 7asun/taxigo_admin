'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { BuilderSectionCard } from '@/components/ui/builder-section-card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InvoiceBuilderPdfPanel } from '@/features/invoices/components/invoice-builder/invoice-builder-pdf-panel';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';
import { AlertTriangle, Eye } from 'lucide-react';

import {
  lineItemsFromAngebotRows,
  useAngebotBuilder,
  DEFAULT_TOTALS_LABEL_GROSS,
  DEFAULT_TOTALS_LABEL_NET,
  DEFAULT_TOTALS_LABEL_TAX
} from '../../hooks/use-angebot-builder';
import { useAngebotVorlagenList } from '../../hooks/use-angebot-vorlagen';
import { ANGEBOT_POSITION_COLUMN_ID } from '../../lib/angebot-auto-columns';
import { resolveAngebotPdfColumnSchema } from '../angebot-pdf/AngebotPdfDocument';
import type {
  AngebotColumnDef,
  AngebotWithLineItems,
  UpdateAngebotPayload
} from '../../types/angebot.types';
import type { AngebotColumnPreset } from '../../lib/angebot-column-presets';
import { Step1Empfaenger, type EmpfaengerValues } from './step-1-empfaenger';
import { Step2Positionen } from './step-2-positionen';
import { Step3Details, type DetailsValues } from './step-3-details';
import { useAngebotBuilderPdfPreview } from './use-angebot-builder-pdf-preview';
import { computeRow, isComputedColumn } from '../../lib/angebot-formula-engine';

function defaultEmpfaengerValues(): EmpfaengerValues {
  return {
    recipient_company: '',
    recipient_first_name: '',
    recipient_last_name: '',
    recipient_anrede: '',
    recipient_street: '',
    recipient_street_number: '',
    recipient_zip: '',
    recipient_city: '',
    recipient_email: '',
    recipient_phone: '',
    customer_number: ''
  };
}

function empfaengerFromAngebot(a: AngebotWithLineItems): EmpfaengerValues {
  const ar = a.recipient_anrede;
  return {
    recipient_company: a.recipient_company ?? '',
    recipient_first_name: a.recipient_first_name ?? '',
    recipient_last_name: a.recipient_last_name ?? '',
    recipient_anrede: ar === 'Herr' || ar === 'Frau' ? ar : '',
    recipient_street: a.recipient_street ?? '',
    recipient_street_number: a.recipient_street_number ?? '',
    recipient_zip: a.recipient_zip ?? '',
    recipient_city: a.recipient_city ?? '',
    recipient_email: a.recipient_email ?? '',
    recipient_phone: a.recipient_phone ?? '',
    customer_number: a.customer_number ?? ''
  };
}

function defaultDetailsValues(): DetailsValues {
  return {
    subject: '',
    offer_date: format(new Date(), 'yyyy-MM-dd'),
    valid_until: '',
    intro_text: '',
    outro_text: ''
  };
}

function detailsFromAngebot(a: AngebotWithLineItems): DetailsValues {
  const od = a.offer_date?.slice(0, 10) ?? format(new Date(), 'yyyy-MM-dd');
  const vu = a.valid_until?.slice(0, 10) ?? '';
  return {
    subject: a.subject ?? '',
    offer_date: od,
    valid_until: vu,
    intro_text: a.intro_text ?? '',
    outro_text: a.outro_text ?? ''
  };
}

export interface AngebotBuilderProps {
  companyId: string;
  companyProfile: InvoiceDetail['company_profile'] | null;
  companyProfileMissing?: boolean;
  initialAngebot?: AngebotWithLineItems | null;
}

export function AngebotBuilder({
  companyId,
  companyProfile,
  companyProfileMissing = false,
  initialAngebot = null
}: AngebotBuilderProps) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const isEdit = !!initialAngebot;
  const isDraftEdit = isEdit && initialAngebot?.status === 'draft';

  // Fetch Vorlagen here as well (in addition to Step 2). React Query caches the result,
  // and the builder needs access to live columns in draft edit mode.
  const { data: vorlagen = [] } = useAngebotVorlagenList(companyId);

  const [selectedVorlageId, setSelectedVorlageId] = useState<string | null>(
    null
  );
  const [createColumnSchema, setCreateColumnSchema] = useState<
    AngebotColumnDef[]
  >([]);

  useEffect(() => {
    if (!companyId) {
      console.warn(
        '[AngebotBuilder] companyId is missing — Vorlagen query is disabled and templates cannot load.'
      );
    }
  }, [companyId]);

  useEffect(() => {
    if (!isEdit) return;
    const vid = initialAngebot?.angebot_vorlage_id;
    if (vid) setSelectedVorlageId(vid);
  }, [isEdit, initialAngebot?.angebot_vorlage_id]);

  /**
   * Draft edit: resolve the live Vorlage columns so that any columns added to the template
   * after the offer was created become visible. Falls back to the saved snapshot if the
   * Vorlage is gone or has no columns.
   */
  const liveEditColumnSchema = useMemo<AngebotColumnDef[] | null>(() => {
    if (!isDraftEdit) return null;
    const vorlageId = initialAngebot?.angebot_vorlage_id;
    if (!vorlageId) return null;
    const vorlage = vorlagen.find((v) => v.id === vorlageId);
    if (!vorlage) return null;
    const cols = Array.isArray(vorlage.columns) ? vorlage.columns : [];
    const safeCols = cols.filter((c) => c.id !== ANGEBOT_POSITION_COLUMN_ID);
    return safeCols.length > 0 ? safeCols : null;
  }, [isDraftEdit, initialAngebot?.angebot_vorlage_id, vorlagen]);

  const columnSchema = useMemo<AngebotColumnDef[]>(() => {
    // Draft edit: prefer live Vorlage columns so any new template columns are visible.
    // Falls back to snapshot (or legacy/standard profile via resolver) if Vorlage is unavailable.
    if (isEdit && initialAngebot) {
      return (
        liveEditColumnSchema ?? resolveAngebotPdfColumnSchema(initialAngebot)
      );
    }
    return createColumnSchema;
  }, [isEdit, initialAngebot, createColumnSchema, liveEditColumnSchema]);

  const [openSections, setOpenSections] = useState({
    empfaenger: true,
    positionen: false,
    details: false
  });
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  const section1Ref = useRef<HTMLElement | null>(null);
  const section2Ref = useRef<HTMLElement | null>(null);
  const section3Ref = useRef<HTMLElement | null>(null);

  const [empfaengerValues, setEmpfaengerValues] = useState<EmpfaengerValues>(
    () =>
      initialAngebot
        ? empfaengerFromAngebot(initialAngebot)
        : defaultEmpfaengerValues()
  );

  const [detailsValues, setDetailsValues] = useState<DetailsValues>(() =>
    initialAngebot ? detailsFromAngebot(initialAngebot) : defaultDetailsValues()
  );

  const {
    lineItems,
    inputMode,
    setInputMode,
    showTotalsBlock,
    setShowTotalsBlock,
    totalsLabelNet,
    setTotalsLabelNet,
    totalsLabelTax,
    setTotalsLabelTax,
    totalsLabelGross,
    setTotalsLabelGross,
    defaultTaxRate,
    setDefaultTaxRate,
    addLineItem,
    deleteLineItem,
    updateLineItem,
    reorderLineItems,
    resetLineItems,
    createAngebotMutation,
    saveEditMutation,
    isPending
  } = useAngebotBuilder({
    mode: isEdit ? 'edit' : 'create',
    angebotId: initialAngebot?.id,
    initialLineItems: initialAngebot
      ? lineItemsFromAngebotRows(initialAngebot.line_items ?? [])
      : undefined,
    initialShowTotalsBlock: initialAngebot?.show_totals_block ?? false,
    initialInputMode: (initialAngebot?.input_mode ?? 'net') as 'net' | 'gross',
    initialTotalsLabelNet: initialAngebot?.totals_label_net ?? null,
    initialTotalsLabelTax: initialAngebot?.totals_label_tax ?? null,
    initialTotalsLabelGross: initialAngebot?.totals_label_gross ?? null,
    initialDefaultTaxRate: initialAngebot?.default_tax_rate ?? null,
    columnSchema,
    // Draft edit only: tell the hook what live schema to persist back to the snapshot on save.
    liveColumnSchema: liveEditColumnSchema ?? undefined,
    onSuccess: (id) => {
      router.push(`/dashboard/angebote/${id}`);
    }
  });

  /**
   * Wraps updateLineItem to automatically recompute derived columns after
   * every manual input change. This is what makes the builder behave like
   * a live spreadsheet — computed cells update on every keystroke without
   * the dispatcher needing to trigger anything explicitly.
   *
   * WHY: computed columns must always reflect the latest inputs while keeping
   * persistence and row operations (add/delete/reorder) on the existing code path.
   */
  const updateLineItemWithComputed = useCallback(
    (index: number, patch: Partial<(typeof lineItems)[number]>) => {
      const currentItem = lineItems[index];
      if (!currentItem) return;
      // Merge the incoming patch first, then run the engine on the full row.
      const mergedData = { ...currentItem.data, ...(patch.data ?? {}) };
      const computedPatch = computeRow(mergedData, columnSchema, inputMode, {
        fallbackTaxRate: defaultTaxRate
      });
      // Merge computed values on top — input values always win over computed
      // for non-computed columns; computed columns are overwritten by engine.
      updateLineItem(index, {
        ...patch,
        data: { ...mergedData, ...computedPatch }
      });
    },
    [lineItems, columnSchema, updateLineItem, inputMode, defaultTaxRate]
  );

  // Keep the latest row state available to the reconciliation effect without depending on lineItems,
  // so we can intentionally omit it from deps and avoid feedback loops.
  const lineItemsRef = useRef(lineItems);
  const updateLineItemRef = useRef(updateLineItem);
  useEffect(() => {
    lineItemsRef.current = lineItems;
    updateLineItemRef.current = updateLineItem;
  }, [lineItems, updateLineItem]);

  const defaultTaxRateRef = useRef(defaultTaxRate);
  useEffect(() => {
    defaultTaxRateRef.current = defaultTaxRate;
  }, [defaultTaxRate]);

  /**
   * WHY: quote-level `defaultTaxRate` participates in `computeRow` — changing it must re-materialise
   * synthetic keys on every row without requiring an interactive cell edit (same idea as schema/inputMode).
   */
  useEffect(() => {
    const items = lineItemsRef.current;
    items.forEach((item, idx) => {
      const mergedData = item.data;
      const computedPatch = computeRow(mergedData, columnSchema, inputMode, {
        fallbackTaxRate: defaultTaxRateRef.current
      });
      updateLineItemRef.current(idx, {
        data: { ...mergedData, ...computedPatch }
      });
    });
  }, [defaultTaxRate, inputMode, columnSchema]);

  /**
   * Once the live schema has loaded in draft edit mode, patch each existing row's data to include
   * null entries for any new column IDs. Existing values are never touched; orphaned keys are kept.
   *
   * Dependency note:
   * - This effect must depend ONLY on liveEditColumnSchema. Depending on lineItems/updateLineItem would loop.
   */
  const liveSchemaApplied = useRef(false);
  useEffect(() => {
    if (!liveEditColumnSchema) return;
    if (liveSchemaApplied.current) return;
    liveSchemaApplied.current = true;

    const ids = liveEditColumnSchema
      .map((c) => c.id)
      .filter((id) => id !== ANGEBOT_POSITION_COLUMN_ID);
    const items = lineItemsRef.current;
    const patchRow = updateLineItemRef.current;

    items.forEach((item, idx) => {
      const missing = ids.filter((id) => !(id in item.data));
      if (missing.length === 0) return;
      const patch: Record<string, null> = {};
      missing.forEach((k) => {
        patch[k] = null;
      });
      patchRow(idx, { data: { ...item.data, ...patch } });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEditColumnSchema]);

  const handleVorlageChange = useCallback(
    (id: string, columns: AngebotColumnDef[]) => {
      if (isEdit) return;
      const dirty = lineItems.some((row) =>
        Object.values(row.data).some((v) => {
          if (v == null) return false;
          if (typeof v === 'string') return v.trim().length > 0;
          if (typeof v === 'number') return !Number.isNaN(v);
          return true;
        })
      );
      if (dirty) {
        toast.warning(
          'Vorlage gewechselt — bestehende Zeilendaten wurden zurückgesetzt.'
        );
      }
      // Switching schema clears all line item data — column IDs from the old schema are incompatible with the new schema.
      setSelectedVorlageId(id);
      setCreateColumnSchema(Array.isArray(columns) ? columns : []);
      resetLineItems();
    },
    [isEdit, lineItems, resetLineItems]
  );

  const handleColumnPresetChange = useCallback(
    (columnId: string, preset: AngebotColumnPreset) => {
      if (isEdit) return;
      setCreateColumnSchema((prev) =>
        prev.map((c) => (c.id === columnId ? { ...c, preset } : c))
      );
    },
    [isEdit]
  );

  const section1Complete = !!(
    empfaengerValues.recipient_company || empfaengerValues.recipient_last_name
  );

  const section2Complete = useMemo(() => {
    if (columnSchema.length === 0) return false;
    const firstNonAnzahl = columnSchema.find((c) => c.preset !== 'anzahl');
    // section2Complete skips anzahl (positional/count) columns when checking for content — mirrors previous integer-type check.
    if (firstNonAnzahl) {
      return lineItems.some((row) => {
        const v = row.data[firstNonAnzahl.id];
        if (v == null) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'number') return !Number.isNaN(v);
        return true;
      });
    }
    return lineItems.some((row) =>
      Object.values(row.data).some((v) => {
        if (v == null) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'number') return !Number.isNaN(v);
        return true;
      })
    );
  }, [columnSchema, lineItems]);

  const section3Complete = !!(
    detailsValues.subject.trim() && detailsValues.offer_date
  );
  const canConfirm =
    section2Complete &&
    detailsValues.offer_date &&
    columnSchema.length > 0 &&
    Boolean(selectedVorlageId);

  const draftAngebot: AngebotWithLineItems | null = useMemo(() => {
    if (!companyId) return null;
    const base = initialAngebot;
    const legacyProfileKey = ['pdf', 'column', 'override'].join('_');

    const row = {
      id: base?.id ?? '',
      company_id: companyId,
      angebot_number:
        base?.angebot_number ?? `AG-${format(new Date(), 'yyyy-MM')}-XXXX`,
      status: base?.status ?? 'draft',
      // WHY: Fix 1 reads angebot.input_mode; without this the live preview always
      // falls back to 'net' even when the dispatcher is in Brutto-Eingabe mode.
      input_mode: inputMode,
      // WHY: draft preview must reflect the per-quote opt-in setting.
      show_totals_block: showTotalsBlock,
      // WHY: draft preview should reflect the current editable label inputs, even before persistence.
      totals_label_net: totalsLabelNet,
      totals_label_tax: totalsLabelTax,
      totals_label_gross: totalsLabelGross,
      // WHY: PDF totals materialisation reads `angebot.default_tax_rate` as `computeRow` fallback.
      default_tax_rate: defaultTaxRate,
      recipient_company: empfaengerValues.recipient_company || null,
      recipient_first_name: empfaengerValues.recipient_first_name || null,
      recipient_last_name: empfaengerValues.recipient_last_name || null,
      recipient_name:
        [
          empfaengerValues.recipient_first_name,
          empfaengerValues.recipient_last_name
        ]
          .filter(Boolean)
          .join(' ') || null,
      recipient_anrede: (empfaengerValues.recipient_anrede || null) as
        | 'Herr'
        | 'Frau'
        | null,
      recipient_street: empfaengerValues.recipient_street || null,
      recipient_street_number: empfaengerValues.recipient_street_number || null,
      recipient_zip: empfaengerValues.recipient_zip || null,
      recipient_city: empfaengerValues.recipient_city || null,
      recipient_email: empfaengerValues.recipient_email || null,
      recipient_phone: empfaengerValues.recipient_phone || null,
      customer_number: empfaengerValues.customer_number || null,
      subject: detailsValues.subject || null,
      valid_until: detailsValues.valid_until || null,
      offer_date: detailsValues.offer_date,
      intro_text: detailsValues.intro_text || null,
      outro_text: detailsValues.outro_text || null,
      angebot_vorlage_id: isEdit
        ? (base?.angebot_vorlage_id ?? null)
        : (selectedVorlageId ?? null),
      // Use columnSchema unconditionally so the live PDF preview stays in sync with the active builder session schema.
      table_schema_snapshot: columnSchema.length > 0 ? columnSchema : null,
      created_at: base?.created_at ?? new Date().toISOString(),
      updated_at: base?.updated_at ?? new Date().toISOString(),
      line_items: lineItems.map((item, idx) => ({
        id: `draft-${idx}`,
        angebot_id: base?.id ?? '',
        position: idx + 1,
        data: item.data,
        leistung: '',
        anfahrtkosten: null,
        price_first_5km: null,
        price_per_km_after_5: null,
        notes: null,
        created_at: new Date().toISOString()
      }))
    } as Record<string, unknown>;
    row[legacyProfileKey] = isEdit
      ? ((base as unknown as Record<string, unknown> | undefined)?.[
          legacyProfileKey
        ] ?? null)
      : null;
    return row as unknown as AngebotWithLineItems;
  }, [
    companyId,
    initialAngebot,
    empfaengerValues,
    detailsValues,
    lineItems,
    columnSchema,
    isEdit,
    selectedVorlageId,
    inputMode,
    showTotalsBlock,
    totalsLabelNet,
    totalsLabelTax,
    totalsLabelGross,
    defaultTaxRate
  ]);

  const { pdf, livePreviewActive } = useAngebotBuilderPdfPreview({
    companyProfile,
    draftAngebot
  });

  const lineItemsPayload = useCallback(
    () =>
      lineItems.map((item, idx) => ({
        position: idx + 1,
        data: item.data
      })),
    [lineItems]
  );

  const handleConfirm = useCallback(() => {
    if (!companyId) return;

    const totalsLabelNetPayload =
      totalsLabelNet === DEFAULT_TOTALS_LABEL_NET ? undefined : totalsLabelNet;
    const totalsLabelTaxPayload =
      totalsLabelTax === DEFAULT_TOTALS_LABEL_TAX ? undefined : totalsLabelTax;
    const totalsLabelGrossPayload =
      totalsLabelGross === DEFAULT_TOTALS_LABEL_GROSS
        ? undefined
        : totalsLabelGross;

    if (isEdit && initialAngebot) {
      const header: UpdateAngebotPayload = {
        recipient_company: empfaengerValues.recipient_company || null,
        recipient_first_name: empfaengerValues.recipient_first_name || null,
        recipient_last_name: empfaengerValues.recipient_last_name || null,
        recipient_name:
          [
            empfaengerValues.recipient_first_name,
            empfaengerValues.recipient_last_name
          ]
            .filter(Boolean)
            .join(' ') || null,
        recipient_anrede: (empfaengerValues.recipient_anrede || null) as
          | 'Herr'
          | 'Frau'
          | null,
        recipient_street: empfaengerValues.recipient_street || null,
        recipient_street_number:
          empfaengerValues.recipient_street_number || null,
        recipient_zip: empfaengerValues.recipient_zip || null,
        recipient_city: empfaengerValues.recipient_city || null,
        recipient_email: empfaengerValues.recipient_email || null,
        recipient_phone: empfaengerValues.recipient_phone || null,
        customer_number: empfaengerValues.customer_number || null,
        subject: detailsValues.subject || null,
        valid_until: detailsValues.valid_until || null,
        offer_date: detailsValues.offer_date,
        intro_text: detailsValues.intro_text || null,
        outro_text: detailsValues.outro_text || null,
        // WHY: this is a per-quote PDF output setting, saved on the Angebot header.
        showTotalsBlock,
        totalsLabelNet: totalsLabelNetPayload,
        totalsLabelTax: totalsLabelTaxPayload,
        totalsLabelGross: totalsLabelGrossPayload
      };
      saveEditMutation({ header, rows: lineItemsPayload() });
      return;
    }

    if (!selectedVorlageId || columnSchema.length === 0) {
      toast.error('Bitte eine Angebotsvorlage wählen.');
      return;
    }

    createAngebotMutation({
      companyId,
      recipient_company: empfaengerValues.recipient_company || null,
      recipient_first_name: empfaengerValues.recipient_first_name || null,
      recipient_last_name: empfaengerValues.recipient_last_name || null,
      recipient_name:
        [
          empfaengerValues.recipient_first_name,
          empfaengerValues.recipient_last_name
        ]
          .filter(Boolean)
          .join(' ') || null,
      recipient_anrede: (empfaengerValues.recipient_anrede || null) as
        | 'Herr'
        | 'Frau'
        | null,
      recipient_street: empfaengerValues.recipient_street || null,
      recipient_street_number: empfaengerValues.recipient_street_number || null,
      recipient_zip: empfaengerValues.recipient_zip || null,
      recipient_city: empfaengerValues.recipient_city || null,
      recipient_email: empfaengerValues.recipient_email || null,
      recipient_phone: empfaengerValues.recipient_phone || null,
      customer_number: empfaengerValues.customer_number || null,
      subject: detailsValues.subject || null,
      valid_until: detailsValues.valid_until || null,
      offer_date: detailsValues.offer_date,
      intro_text: detailsValues.intro_text || null,
      outro_text: detailsValues.outro_text || null,
      angebotVorlageId: selectedVorlageId,
      tableSchemaSnapshot: columnSchema,
      inputMode,
      // WHY: default is false; opt-in enables Netto/MwSt/Brutto summary on the PDF.
      showTotalsBlock,
      totalsLabelNet: totalsLabelNetPayload,
      totalsLabelTax: totalsLabelTaxPayload,
      totalsLabelGross: totalsLabelGrossPayload,
      defaultTaxRate,
      line_items: lineItemsPayload()
    });
  }, [
    companyId,
    isEdit,
    initialAngebot,
    empfaengerValues,
    detailsValues,
    selectedVorlageId,
    columnSchema,
    lineItemsPayload,
    showTotalsBlock,
    totalsLabelNet,
    totalsLabelTax,
    totalsLabelGross,
    inputMode,
    defaultTaxRate,
    saveEditMutation,
    createAngebotMutation
  ]);

  const leftPanel = (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-y-auto p-4'>
        <div className='mx-auto max-w-lg space-y-3'>
          {companyProfileMissing ? (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>
                Firmenprofil unvollständig. Bitte zuerst Firmenname und
                Steuernummer hinterlegen.
              </AlertDescription>
            </Alert>
          ) : null}

          <BuilderSectionCard
            id='section-empfaenger'
            sectionRef={section1Ref}
            title='1. Empfänger'
            locked={false}
            completed={section1Complete}
            showFertigBadge={section1Complete}
            summary={
              empfaengerValues.recipient_company ||
              empfaengerValues.recipient_last_name ||
              null
            }
            open={openSections.empfaenger}
            onOpenChange={(o) =>
              setOpenSections((s) => ({ ...s, empfaenger: o }))
            }
          >
            <Step1Empfaenger
              values={empfaengerValues}
              onChange={(patch) =>
                setEmpfaengerValues((v) => ({ ...v, ...patch }))
              }
            />
          </BuilderSectionCard>

          <BuilderSectionCard
            id='section-positionen'
            sectionRef={section2Ref}
            title='2. Positionen'
            locked={false}
            completed={section2Complete}
            showFertigBadge={section2Complete}
            summary={section2Complete ? `${lineItems.length} Zeile(n)` : null}
            open={openSections.positionen}
            onOpenChange={(o) =>
              setOpenSections((s) => ({ ...s, positionen: o }))
            }
          >
            <Step2Positionen
              companyId={companyId}
              selectedVorlageId={selectedVorlageId}
              onVorlageChange={handleVorlageChange}
              onColumnPresetChange={handleColumnPresetChange}
              isEditMode={isEdit}
              columnSchema={columnSchema}
              items={lineItems}
              onUpdate={updateLineItemWithComputed}
              onDelete={deleteLineItem}
              onReorder={reorderLineItems}
              onAdd={addLineItem}
              inputMode={inputMode}
              onInputModeChange={setInputMode}
              showTotalsBlock={showTotalsBlock}
              onShowTotalsBlockChange={setShowTotalsBlock}
              totalsLabelNet={totalsLabelNet}
              totalsLabelTax={totalsLabelTax}
              totalsLabelGross={totalsLabelGross}
              onTotalsLabelNetChange={setTotalsLabelNet}
              onTotalsLabelTaxChange={setTotalsLabelTax}
              onTotalsLabelGrossChange={setTotalsLabelGross}
              defaultTaxRate={defaultTaxRate}
              onDefaultTaxRateChange={setDefaultTaxRate}
            />
          </BuilderSectionCard>

          <BuilderSectionCard
            id='section-details'
            sectionRef={section3Ref}
            title='3. Details'
            locked={false}
            completed={section3Complete}
            showFertigBadge={section3Complete}
            summary={detailsValues.subject || null}
            open={openSections.details}
            onOpenChange={(o) => setOpenSections((s) => ({ ...s, details: o }))}
          >
            <Step3Details
              values={detailsValues}
              onChange={(patch) =>
                setDetailsValues((v) => ({ ...v, ...patch }))
              }
            />
          </BuilderSectionCard>
        </div>
      </div>

      <div className='border-border bg-background flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3'>
        {isMobile ? (
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setMobilePreviewOpen(true)}
          >
            <Eye className='mr-1.5 h-4 w-4' />
            Vorschau
          </Button>
        ) : (
          <span />
        )}
        <Button
          type='button'
          disabled={!canConfirm || isPending || companyProfileMissing}
          onClick={handleConfirm}
        >
          {isPending
            ? 'Wird gespeichert…'
            : isEdit
              ? 'Änderungen speichern'
              : 'Angebot erstellen'}
        </Button>
      </div>
    </div>
  );

  return (
    <div
      className={cn('flex min-h-0 flex-1 overflow-hidden', 'flex-row gap-0')}
    >
      <div className='border-border flex w-full shrink-0 flex-col overflow-hidden border-r lg:w-[480px]'>
        {leftPanel}
      </div>

      <div className='hidden h-full min-w-0 flex-1 flex-col overflow-hidden lg:flex'>
        <InvoiceBuilderPdfPanel
          lineItemCount={lineItems.length}
          isLoadingTrips={false}
          section2Complete={livePreviewActive}
          draftInvoice={livePreviewActive ? ({} as InvoiceDetail) : null}
          pdf={{ loading: pdf.loading, url: pdf.url ?? null }}
        />
      </div>

      <Sheet open={mobilePreviewOpen} onOpenChange={setMobilePreviewOpen}>
        <SheetContent
          side='right'
          className='flex w-full flex-col p-0 sm:max-w-lg'
        >
          <SheetHeader className='shrink-0 px-4 pt-4'>
            <SheetTitle>Vorschau</SheetTitle>
          </SheetHeader>
          <div className='relative min-h-0 flex-1 overflow-hidden'>
            {pdf.url ? (
              <iframe
                title='Angebot Vorschau'
                src={pdf.url}
                className='absolute inset-0 h-full w-full border-0'
              />
            ) : (
              <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
                Vorschau wird geladen…
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
