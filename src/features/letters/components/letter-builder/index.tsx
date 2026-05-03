'use client';

/**
 * Letter builder shell — left column matches `AngebotBuilder` feel: `max-w-lg` scroll
 * stack, `BuilderSectionCard` sections with parent-controlled `openSections`, and a
 * fixed bottom bar for PDF + save (primary actions leave the scroll area like offers).
 * Right column still reuses `InvoiceBuilderPdfPanel` + debounced preview hook unchanged.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { pdf } from '@react-pdf/renderer';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { BuilderSectionCard } from '@/components/ui/builder-section-card';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { InvoiceBuilderPdfPanel } from '@/features/invoices/components/invoice-builder/invoice-builder-pdf-panel';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';

import { companyProfileForLetterPdf } from '../../lib/company-profile-for-letter-pdf';
import { buildDraftLetter } from '../../lib/build-draft-letter';
import {
  useLetter,
  useCreateLetter,
  useUpdateLetter,
  useDeleteLetter
} from '../../hooks/use-letters';
import type { LetterFormValues } from '../../types';
import { LetterPdfDocument } from '../letter-pdf/letter-pdf-document';
import { LetterStep1Recipient } from './letter-step-1-recipient';
import { LetterStep2Details } from './letter-step-2-details';
import { LetterStep3Body } from './letter-step-3-body';
import { useLetterBuilderPdfPreview } from './use-letter-builder-pdf-preview';

export interface LetterBuilderProps {
  mode: 'create' | 'edit';
  letterId?: string;
  companyId: string;
  companyProfile: InvoiceDetail['company_profile'] | null;
}

function todayYmd(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function defaultLetterFormValues(): LetterFormValues {
  return {
    letterDate: todayYmd(),
    letterNumber: '',
    status: 'draft',
    subject: '',
    recipientCompany: '',
    recipientSalutation: '',
    recipientFirstName: '',
    recipientLastName: '',
    recipientStreet: '',
    recipientZip: '',
    recipientCity: '',
    recipientCountry: '',
    bodyHtml: '<p></p>'
  };
}

function bodyHasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim().length > 0;
}

export function LetterBuilder({
  mode,
  letterId,
  companyId,
  companyProfile
}: LetterBuilderProps) {
  const router = useRouter();
  const isEdit = mode === 'edit' && !!letterId;
  const { data: existing, isLoading: loadingLetter } = useLetter(
    isEdit ? letterId : null
  );

  const createMut = useCreateLetter();
  const updateMut = useUpdateLetter();
  const deleteMut = useDeleteLetter();

  const [values, setValues] = useState<LetterFormValues>(
    defaultLetterFormValues
  );
  const [openSections, setOpenSections] = useState({
    recipient: true,
    details: false,
    body: false
  });

  const sectionRecipientRef = useRef<HTMLElement | null>(null);
  const sectionDetailsRef = useRef<HTMLElement | null>(null);
  const sectionBodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isEdit || !existing) return;
    setValues({
      letterDate: existing.letterDate,
      letterNumber: existing.letterNumber ?? '',
      status: existing.status,
      subject: existing.subject ?? '',
      recipientCompany: existing.recipientCompany ?? '',
      recipientSalutation: existing.recipientSalutation ?? '',
      recipientFirstName: existing.recipientFirstName ?? '',
      recipientLastName: existing.recipientLastName ?? '',
      recipientStreet: existing.recipientStreet ?? '',
      recipientZip: existing.recipientZip ?? '',
      recipientCity: existing.recipientCity ?? '',
      recipientCountry: existing.recipientCountry ?? '',
      bodyHtml: existing.bodyHtml?.trim() ? existing.bodyHtml : '<p></p>'
    });
  }, [isEdit, existing]);

  const onChange = useCallback((patch: Partial<LetterFormValues>) => {
    setValues((prev) => ({ ...prev, ...patch }));
  }, []);

  const draftLetter = useMemo(
    () => buildDraftLetter(values, { companyId, existing: existing ?? null }),
    [values, companyId, existing]
  );

  const letterForPreview = companyProfile ? draftLetter : null;

  const { pdf: previewPdf } = useLetterBuilderPdfPreview({
    companyProfile,
    draftLetter: letterForPreview
  });

  const previewPanelActive = !!companyProfile;

  const recipientComplete = !!(
    values.recipientCompany.trim() || values.recipientLastName.trim()
  );
  const detailsComplete = !!(values.subject.trim() && values.letterDate);
  const bodyComplete = bodyHasText(values.bodyHtml);

  const recipientSummary =
    values.recipientCompany.trim() ||
    [values.recipientFirstName, values.recipientLastName]
      .filter(Boolean)
      .join(' ')
      .trim() ||
    null;
  const detailsSummary = values.subject.trim() || null;

  const handleSave = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    const createdBy = user?.id ?? null;

    const base = {
      companyId,
      letterDate: values.letterDate,
      letterNumber: values.letterNumber.trim() || null,
      status: values.status,
      subject: values.subject.trim() || null,
      bodyHtml: values.bodyHtml,
      recipientCompany: values.recipientCompany.trim() || null,
      recipientSalutation: values.recipientSalutation.trim() || null,
      recipientFirstName: values.recipientFirstName.trim() || null,
      recipientLastName: values.recipientLastName.trim() || null,
      recipientStreet: values.recipientStreet.trim() || null,
      recipientZip: values.recipientZip.trim() || null,
      recipientCity: values.recipientCity.trim() || null,
      recipientCountry: values.recipientCountry.trim() || null
    };

    try {
      if (isEdit && letterId) {
        await updateMut.mutateAsync({
          id: letterId,
          patch: base
        });
        toast.success('Brief gespeichert.');
      } else {
        const row = await createMut.mutateAsync({
          ...base,
          createdBy
        });
        toast.success('Brief erstellt.');
        router.replace(`/dashboard/letters/${row.id}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    }
  }, [companyId, values, isEdit, letterId, createMut, updateMut, router]);

  const handlePdf = useCallback(async () => {
    if (!companyProfile) {
      toast.error('Unternehmensprofil fehlt — PDF nicht möglich.');
      return;
    }
    try {
      // Same logo/header resolution as preview — docs/plans/letters-pdf-preview-vs-download-audit.md
      const resolvedCompanyProfile =
        await companyProfileForLetterPdf(companyProfile);
      if (!resolvedCompanyProfile) {
        toast.error('Unternehmensprofil fehlt — PDF nicht möglich.');
        return;
      }
      const blob = await pdf(
        <LetterPdfDocument
          letter={draftLetter}
          companyProfile={resolvedCompanyProfile}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${values.letterNumber.trim() || 'Brief'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF fehlgeschlagen.');
    }
  }, [companyProfile, draftLetter, values.letterNumber]);

  const handleDelete = useCallback(async () => {
    if (!letterId) return;
    if (!confirm('Brief wirklich löschen?')) return;
    try {
      await deleteMut.mutateAsync(letterId);
      toast.success('Brief gelöscht.');
      router.push('/dashboard/letters');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Löschen fehlgeschlagen.');
    }
  }, [letterId, deleteMut, router]);

  if (isEdit && loadingLetter) {
    return (
      <div className='text-muted-foreground flex min-h-[200px] items-center justify-center gap-2 text-sm'>
        <Loader2 className='h-4 w-4 animate-spin' />
        Brief wird geladen…
      </div>
    );
  }

  if (isEdit && !loadingLetter && !existing) {
    return (
      <p className='text-destructive p-4 text-sm'>Brief nicht gefunden.</p>
    );
  }

  const isSaving = createMut.isPending || updateMut.isPending;

  const leftPanel = (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
      <div className='flex-1 overflow-y-auto p-4'>
        <div className='mx-auto max-w-lg space-y-3'>
          {!companyProfile ? (
            <p className='text-muted-foreground text-sm'>
              Unternehmensprofil unvollständig — PDF-Vorschau/Download ist
              eingeschränkt.
            </p>
          ) : null}

          <BuilderSectionCard
            id='section-letter-recipient'
            sectionRef={sectionRecipientRef}
            title='1. Empfänger'
            locked={false}
            completed={recipientComplete}
            showFertigBadge={recipientComplete}
            summary={recipientSummary}
            open={openSections.recipient}
            onOpenChange={(o) =>
              setOpenSections((s) => ({ ...s, recipient: o }))
            }
          >
            <LetterStep1Recipient values={values} onChange={onChange} />
          </BuilderSectionCard>

          <BuilderSectionCard
            id='section-letter-details'
            sectionRef={sectionDetailsRef}
            title='2. Betreff & Datum'
            locked={false}
            completed={detailsComplete}
            showFertigBadge={detailsComplete}
            summary={detailsSummary}
            open={openSections.details}
            onOpenChange={(o) => setOpenSections((s) => ({ ...s, details: o }))}
          >
            <LetterStep2Details values={values} onChange={onChange} />
          </BuilderSectionCard>

          <BuilderSectionCard
            id='section-letter-body'
            sectionRef={sectionBodyRef}
            title='3. Brieftext'
            locked={false}
            completed={bodyComplete}
            showFertigBadge={bodyComplete}
            summary={null}
            open={openSections.body}
            onOpenChange={(o) => setOpenSections((s) => ({ ...s, body: o }))}
          >
            <LetterStep3Body values={values} onChange={onChange} />
          </BuilderSectionCard>

          {isEdit && letterId ? (
            <div className='pt-2'>
              <Button
                type='button'
                variant='destructive'
                disabled={deleteMut.isPending}
                onClick={() => void handleDelete()}
              >
                Brief löschen
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className='border-border bg-background flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3'>
        <span />
        <div className='flex gap-2'>
          <Button
            type='button'
            variant='secondary'
            size='sm'
            disabled={!companyProfile}
            onClick={() => void handlePdf()}
          >
            <FileDown className='mr-1.5 h-4 w-4' />
            PDF
          </Button>
          <Button
            type='button'
            disabled={isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? (
              <Loader2 className='mr-1.5 h-4 w-4 animate-spin' />
            ) : null}
            {isEdit ? 'Änderungen speichern' : 'Brief erstellen'}
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className='flex min-h-0 flex-1 flex-row gap-0 overflow-hidden'>
      <div className='border-border flex w-full shrink-0 flex-col overflow-hidden border-r lg:w-[480px]'>
        {leftPanel}
      </div>

      <div className='hidden h-full min-w-0 flex-1 flex-col overflow-hidden lg:flex'>
        <InvoiceBuilderPdfPanel
          lineItemCount={previewPanelActive ? 1 : 0}
          isLoadingTrips={false}
          section2Complete={previewPanelActive}
          draftInvoice={previewPanelActive ? ({} as InvoiceDetail) : null}
          pdf={{
            loading: previewPdf.loading,
            url: previewPdf.url ?? null
          }}
        />
      </div>
    </div>
  );
}
