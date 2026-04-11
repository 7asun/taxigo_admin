'use client';

/**
 * Kostenträger-Detail: liest Stammdaten bevorzugt aus dem TanStack-Cache (`usePayers`),
 * damit nach Mutation + `invalidateQueries` (siehe `src/query/README.md`) KTS, Name u. a.
 * sofort stimmen — nicht nur der Klick-Snapshot aus der Elternliste.
 */
import { useMemo, useState } from 'react';
import {
  Pencil,
  Plus,
  Receipt,
  Settings2,
  Trash2,
  FileText,
  ExternalLink,
  CircleDollarSign
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatPayerNumber } from '@/lib/customer-number';
import { useBillingTypes } from '../hooks/use-billing-types';
import { usePayers } from '../hooks/use-payers';
import { AddBillingFamilyDialog } from './add-billing-family-dialog';
import { AddBillingVariantDialog } from './add-billing-variant-dialog';
import { BillingTypeBehaviorDialog } from './billing-type-behavior-dialog';
import { EditBillingFamilyDialog } from './edit-billing-family-dialog';
import { EditBillingVariantDialog } from './edit-billing-variant-dialog';
import type {
  PayerWithBillingCount,
  BillingFamilyWithVariants,
  BillingVariant
} from '../types/payer.types';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { toast } from 'sonner';
import Link from 'next/link';
import { useAllInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';
import { updatePayerTextBlocks } from '@/features/invoices/api/invoice-text-blocks.api';
import { useBillingPricingRules } from '../hooks/use-billing-pricing-rules';
import { PricingRuleDialog } from './pricing-rule-dialog';
import { PricingRuleDeleteButton } from './pricing-rule-delete-button';
import { useRechnungsempfaengerOptions } from '@/features/rechnungsempfaenger/hooks/use-rechnungsempfaenger-options';
import { usePdfVorlagenList } from '@/features/invoices/hooks/use-pdf-vorlagen';
import {
  APPENDIX_LANDSCAPE_THRESHOLD,
  PDF_COLUMN_MAP
} from '@/features/invoices/lib/pdf-column-catalog';
import type {
  BillingPricingRuleRow,
  PricingRuleScope
} from '../api/billing-pricing-rules.api';

interface PayerDetailsSheetProps {
  payer: PayerWithBillingCount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PayerDetailsSheet({
  payer,
  open,
  onOpenChange
}: PayerDetailsSheetProps) {
  const {
    data: families,
    isLoading,
    deleteBillingVariant,
    deleteBillingFamily,
    isDeleting
  } = useBillingTypes(payer?.id);
  const { data: payersList, updatePayer, isUpdating } = usePayers();
  const [isAddFamilyOpen, setIsAddFamilyOpen] = useState(false);
  const [variantDialog, setVariantDialog] = useState<{
    familyId: string;
    familyName: string;
    nextSort: number;
  } | null>(null);
  const [behaviorFamily, setBehaviorFamily] =
    useState<BillingFamilyWithVariants | null>(null);
  const [editFamily, setEditFamily] =
    useState<BillingFamilyWithVariants | null>(null);
  const [editVariant, setEditVariant] = useState<{
    familyName: string;
    variant: BillingVariant;
  } | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNumber, setEditNumber] = useState('');

  // Text blocks state
  const { data: textBlocks, isLoading: isLoadingTextBlocks } =
    useAllInvoiceTextBlocks();
  const [selectedIntroBlockId, setSelectedIntroBlockId] = useState<
    string | null
  >(null);
  const [selectedOutroBlockId, setSelectedOutroBlockId] = useState<
    string | null
  >(null);
  const [isSavingTextBlocks, setIsSavingTextBlocks] = useState(false);

  const {
    data: pricingRules = [],
    refetch: refetchPricing,
    deleteRule,
    isDeleting: isDeletingRule
  } = useBillingPricingRules(payer?.id);
  const { data: recipients = [], isLoading: recipientsLoading } =
    useRechnungsempfaengerOptions();

  const [pricingDialog, setPricingDialog] = useState<{
    scope: PricingRuleScope;
    editing: BillingPricingRuleRow | null;
  } | null>(null);

  const displayPayer = useMemo((): PayerWithBillingCount | null => {
    if (!payer) return null;
    const fromCache = payersList?.find((p) => p.id === payer.id);
    return fromCache ?? payer;
  }, [payer, payersList]);

  const { data: pdfVorlagen = [], isLoading: pdfVorlagenLoading } =
    usePdfVorlagenList(displayPayer?.company_id ?? '');

  const selectedPdfVorlage = useMemo(
    () => pdfVorlagen.find((v) => v.id === displayPayer?.pdf_vorlage_id),
    [pdfVorlagen, displayPayer?.pdf_vorlage_id]
  );

  const pdfColumnPreview = useMemo(() => {
    if (!selectedPdfVorlage) {
      return {
        main: 'Unternehmens-Standard oder System-Standard',
        ann: '—'
      };
    }
    const main = selectedPdfVorlage.main_columns
      .map((k) => PDF_COLUMN_MAP[k]?.uiLabel ?? k)
      .join(' · ');
    const ann = selectedPdfVorlage.appendix_columns
      .map((k) => PDF_COLUMN_MAP[k]?.uiLabel ?? k)
      .join(' · ');
    const landscape =
      selectedPdfVorlage.appendix_columns.length > APPENDIX_LANDSCAPE_THRESHOLD
        ? ' (Querformat)'
        : '';
    return { main, ann: `${ann}${landscape}` };
  }, [selectedPdfVorlage]);

  const startEditing = () => {
    if (displayPayer) {
      setEditName(displayPayer.name);
      setEditNumber(displayPayer.number ?? '');
      setIsEditing(true);
    }
  };

  const handleSave = async () => {
    if (!displayPayer) return;
    try {
      await updatePayer({
        id: displayPayer.id,
        name: editName,
        number: editNumber || displayPayer.number || '',
        kts_default: displayPayer.kts_default ?? null,
        no_invoice_required_default:
          displayPayer.no_invoice_required_default ?? null,
        rechnungsempfaenger_id: displayPayer.rechnungsempfaenger_id ?? null,
        pdf_vorlage_id: displayPayer.pdf_vorlage_id ?? null
      });
      toast.success('Kostenträger aktualisiert');
      setIsEditing(false);
    } catch {
      toast.error('Fehler beim Aktualisieren');
    }
  };

  const handleKtsDefaultChange = async (v: 'unset' | 'yes' | 'no') => {
    if (!displayPayer) return;
    try {
      await updatePayer({
        id: displayPayer.id,
        name: displayPayer.name,
        number: displayPayer.number ?? '',
        kts_default: v === 'unset' ? null : v === 'yes',
        no_invoice_required_default:
          displayPayer.no_invoice_required_default ?? null,
        rechnungsempfaenger_id: displayPayer.rechnungsempfaenger_id ?? null,
        pdf_vorlage_id: displayPayer.pdf_vorlage_id ?? null
      });
      toast.success('KTS-Standard gespeichert');
    } catch {
      toast.error('KTS-Standard konnte nicht gespeichert werden');
    }
  };

  const handleNoInvoiceDefaultChange = async (v: 'unset' | 'yes' | 'no') => {
    if (!displayPayer) return;
    try {
      await updatePayer({
        id: displayPayer.id,
        name: displayPayer.name,
        number: displayPayer.number ?? '',
        kts_default: displayPayer.kts_default ?? null,
        no_invoice_required_default: v === 'unset' ? null : v === 'yes',
        rechnungsempfaenger_id: displayPayer.rechnungsempfaenger_id ?? null,
        pdf_vorlage_id: displayPayer.pdf_vorlage_id ?? null
      });
      toast.success('Standard „Keine Rechnung“ gespeichert');
    } catch {
      toast.error('Speichern fehlgeschlagen');
    }
  };

  const handleSaveTextBlocks = async () => {
    if (!displayPayer) return;
    setIsSavingTextBlocks(true);
    try {
      await updatePayerTextBlocks(
        displayPayer.id,
        selectedIntroBlockId,
        selectedOutroBlockId
      );
      toast.success('Rechnungsvorlagen aktualisiert');
    } catch {
      toast.error('Fehler beim Speichern der Vorlagen');
    } finally {
      setIsSavingTextBlocks(false);
    }
  };

  if (!displayPayer) {
    return null;
  }

  const ktsSelectValue =
    displayPayer.kts_default === true
      ? 'yes'
      : displayPayer.kts_default === false
        ? 'no'
        : 'unset';

  const noInvoiceSelectValue =
    displayPayer.no_invoice_required_default === true
      ? 'yes'
      : displayPayer.no_invoice_required_default === false
        ? 'no'
        : 'unset';

  const payerLevelRules = pricingRules.filter(
    (r) =>
      r.payer_id === displayPayer.id &&
      !r.billing_type_id &&
      !r.billing_variant_id
  );

  const ruleForBillingType = (typeId: string) =>
    pricingRules.find(
      (r) => r.billing_type_id === typeId && !r.billing_variant_id
    ) ?? null;

  const ruleForVariant = (variantId: string) =>
    pricingRules.find((r) => r.billing_variant_id === variantId) ?? null;

  const handleRechnungsempfaengerPayer = async (value: string) => {
    try {
      await updatePayer({
        id: displayPayer.id,
        name: displayPayer.name,
        number: displayPayer.number ?? '',
        kts_default: displayPayer.kts_default ?? null,
        no_invoice_required_default:
          displayPayer.no_invoice_required_default ?? null,
        rechnungsempfaenger_id: value === '__none__' ? null : value,
        pdf_vorlage_id: displayPayer.pdf_vorlage_id ?? null
      });
      toast.success('Rechnungsempfänger gespeichert');
    } catch {
      toast.error('Speichern fehlgeschlagen');
    }
  };

  const handlePdfVorlageChange = async (value: string) => {
    if (!displayPayer) return;
    try {
      await updatePayer({
        id: displayPayer.id,
        name: displayPayer.name,
        number: displayPayer.number ?? '',
        kts_default: displayPayer.kts_default ?? null,
        no_invoice_required_default:
          displayPayer.no_invoice_required_default ?? null,
        rechnungsempfaenger_id: displayPayer.rechnungsempfaenger_id ?? null,
        pdf_vorlage_id: value === '__none__' ? null : value
      });
      toast.success('PDF-Vorlage gespeichert');
    } catch {
      toast.error('Speichern fehlgeschlagen');
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(val) => {
        onOpenChange(val);
        if (!val) setIsEditing(false);
      }}
    >
      <SheetContent className='flex h-full max-h-[100dvh] w-[90vw] flex-col gap-0 overflow-hidden px-8 sm:max-w-xl sm:px-12'>
        <SheetHeader className='mb-6 shrink-0'>
          <div className='flex items-center justify-between'>
            <div className='flex-1'>
              {isEditing ? (
                <div className='space-y-3'>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder='Name'
                    className='focus-visible:border-primary h-10 rounded-none border-0 border-b px-0 text-2xl font-semibold focus-visible:ring-0'
                    autoFocus
                  />
                </div>
              ) : (
                <SheetTitle className='flex items-baseline gap-3 text-2xl'>
                  {displayPayer.name}
                  {displayPayer.number && (
                    <span className='text-muted-foreground text-lg font-normal'>
                      {formatPayerNumber(displayPayer.number)}
                    </span>
                  )}
                </SheetTitle>
              )}
              <SheetDescription>
                Abrechnungsfamilien und Unterarten verwalten.
              </SheetDescription>
            </div>
            <div className='flex gap-2'>
              {isEditing ? (
                <>
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setIsEditing(false)}
                    disabled={isUpdating}
                  >
                    Abbrechen
                  </Button>
                  <Button size='sm' onClick={handleSave} disabled={isUpdating}>
                    {isUpdating ? 'Lädt...' : 'Speichern'}
                  </Button>
                </>
              ) : (
                <Button variant='outline' size='sm' onClick={startEditing}>
                  Bearbeiten
                </Button>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className='min-h-0 flex-1 overflow-y-auto pb-8'>
          <div className='space-y-8'>
            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <div className='flex items-center gap-4'>
                <div className='bg-muted rounded-lg p-3'>
                  <Receipt className='text-muted-foreground h-6 w-6' />
                </div>
                <div className='flex-1'>
                  <div className='text-foreground text-lg font-bold'>
                    {displayPayer.number || '–'}
                  </div>
                  <div className='text-muted-foreground text-sm'>
                    Kostenträgernummer
                  </div>
                </div>
              </div>
            </div>

            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <label className='text-muted-foreground mb-2 block text-xs font-medium tracking-wide uppercase'>
                KTS-Standard (Kostenträger)
              </label>
              <Select
                value={ktsSelectValue}
                onValueChange={(v) =>
                  void handleKtsDefaultChange(v as 'unset' | 'yes' | 'no')
                }
                disabled={isUpdating}
              >
                <SelectTrigger className='h-9 w-full max-w-sm'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='unset'>
                    Nicht festlegen (vererbt)
                  </SelectItem>
                  <SelectItem value='yes'>Ja — KTS voreinstellen</SelectItem>
                  <SelectItem value='no'>Nein</SelectItem>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground mt-2 text-xs'>
                Gilt nur wenn Abrechnungsfamilie und Unterart kein eigenes KTS
                setzen (Kaskade in Verhalten / Unterart). Wird sofort
                gespeichert.
              </p>
            </div>

            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <label className='text-muted-foreground mb-2 block text-xs font-medium tracking-wide uppercase'>
                Keine Rechnung (Kostenträger)
              </label>
              <Select
                value={noInvoiceSelectValue}
                onValueChange={(v) =>
                  void handleNoInvoiceDefaultChange(v as 'unset' | 'yes' | 'no')
                }
                disabled={isUpdating}
              >
                <SelectTrigger className='h-9 w-full max-w-sm'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='unset'>
                    Nicht festlegen (vererbt)
                  </SelectItem>
                  <SelectItem value='yes'>
                    Ja — „Keine Rechnung“ voreinstellen
                  </SelectItem>
                  <SelectItem value='no'>Nein</SelectItem>
                </SelectContent>
              </Select>
              <p className='text-muted-foreground mt-2 text-xs'>
                Kaskade wie KTS: Unterart und Familie können überschreiben. Wird
                sofort gespeichert.
              </p>
            </div>

            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <label className='text-muted-foreground mb-2 block text-xs font-medium tracking-wide uppercase'>
                Rechnungsempfänger (Kostenträger)
              </label>
              {recipientsLoading ? (
                <Skeleton className='h-9 w-full max-w-sm' />
              ) : (
                <Select
                  value={
                    displayPayer.rechnungsempfaenger_id
                      ? displayPayer.rechnungsempfaenger_id
                      : '__none__'
                  }
                  onValueChange={(v) => void handleRechnungsempfaengerPayer(v)}
                  disabled={isUpdating}
                >
                  <SelectTrigger className='h-9 w-full max-w-sm'>
                    <SelectValue placeholder='Keiner' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__none__'>Keiner</SelectItem>
                    {recipients.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className='text-muted-foreground mt-2 text-xs'>
                Wird von Familie/Unterart überschrieben. Stammdaten unter
                Account → Rechnungsempfänger.
              </p>
            </div>

            {/*
              PDF-Spalten: Auflösung bei Rechnungserstellung —
              1) Rechnungs-Override (Builder) → 2) diese Kostenträger-Vorlage →
              3) Unternehmens-Standard-Vorlage → 4) System-Standard.
            */}
            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <label className='text-muted-foreground mb-2 block text-xs font-medium tracking-wide uppercase'>
                PDF-Vorlage
              </label>
              {pdfVorlagenLoading ? (
                <Skeleton className='h-9 w-full max-w-sm' />
              ) : (
                <Select
                  value={
                    displayPayer.pdf_vorlage_id
                      ? displayPayer.pdf_vorlage_id
                      : '__none__'
                  }
                  onValueChange={(v) => void handlePdfVorlageChange(v)}
                  disabled={isUpdating}
                >
                  <SelectTrigger className='h-9 w-full max-w-sm'>
                    <SelectValue placeholder='Standard (Kaskade)' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='__none__'>
                      Standard (Unternehmen / System)
                    </SelectItem>
                    {pdfVorlagen.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                        {v.is_default ? ' (Unternehmens-Standard)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className='text-muted-foreground mt-3 space-y-1 text-xs leading-relaxed'>
                <p>
                  <span className='text-foreground font-medium'>
                    Hauptrechnung:{' '}
                  </span>
                  {pdfColumnPreview.main}
                </p>
                <p>
                  <span className='text-foreground font-medium'>Anhang: </span>
                  {pdfColumnPreview.ann}
                </p>
              </div>
            </div>

            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <div className='mb-3 flex items-center justify-between'>
                <h3 className='text-lg font-semibold'>
                  Preisregeln (Kostenträger)
                </h3>
                <Button
                  size='sm'
                  variant='outline'
                  className='gap-1'
                  onClick={() =>
                    setPricingDialog({
                      scope: { kind: 'payer', payerId: displayPayer.id },
                      editing: payerLevelRules[0] ?? null
                    })
                  }
                >
                  <CircleDollarSign className='h-3.5 w-3.5' />
                  {payerLevelRules[0] ? 'Bearbeiten' : 'Neu'}
                </Button>
              </div>
              {payerLevelRules.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  Keine Kostenträger-Preisregel — es gilt Preis-Tag / Fahrpreis
                  / Abrechnungsfamilie.
                </p>
              ) : (
                <ul className='space-y-2 text-sm'>
                  {payerLevelRules.map((r) => (
                    <li
                      key={r.id}
                      className='flex items-center justify-between gap-2 border-b pb-2'
                    >
                      <span>
                        <Badge variant='secondary'>{r.strategy}</Badge>
                        {r.is_active ? null : (
                          <span className='text-muted-foreground ml-2'>
                            inaktiv
                          </span>
                        )}
                      </span>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() =>
                            setPricingDialog({
                              scope: {
                                kind: 'payer',
                                payerId: displayPayer.id
                              },
                              editing: r
                            })
                          }
                        >
                          Bearbeiten
                        </Button>
                        <PricingRuleDeleteButton
                          rule={r}
                          deleteRule={deleteRule}
                          isDeleting={isDeletingRule}
                          onDeleted={() => {
                            if (pricingDialog?.editing?.id === r.id) {
                              setPricingDialog(null);
                            }
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className='mb-4 flex items-center justify-between'>
                <h3 className='text-lg font-semibold'>Abrechnungsfamilien</h3>
                <Button
                  size='sm'
                  className='h-8 gap-1'
                  onClick={() => setIsAddFamilyOpen(true)}
                >
                  <Plus className='h-3.5 w-3.5' />
                  Neue Familie
                </Button>
              </div>

              <div className='space-y-4'>
                {isLoading ? (
                  <>
                    <Skeleton className='h-24 w-full rounded-xl' />
                    <Skeleton className='h-24 w-full rounded-xl' />
                  </>
                ) : !families?.length ? (
                  <div className='flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center'>
                    <div className='bg-muted mb-3 flex h-12 w-12 items-center justify-center rounded-full'>
                      <Receipt className='text-muted-foreground/50 h-6 w-6' />
                    </div>
                    <h4 className='text-muted-foreground/80 mb-1 font-medium'>
                      Noch keine Familien
                    </h4>
                    <p className='text-muted-foreground max-w-[240px] text-xs'>
                      „Neue Familie“ legt die Abrechnungsart + erste Unterart
                      inkl. CSV-Code an.
                    </p>
                  </div>
                ) : (
                  families.map((family) => (
                    <FamilyBlock
                      key={family.id}
                      family={family}
                      isDeleting={isDeleting}
                      typeRule={ruleForBillingType(family.id)}
                      ruleForVariant={ruleForVariant}
                      onOpenBehavior={() => setBehaviorFamily(family)}
                      onEditFamily={() => setEditFamily(family)}
                      onEditVariant={(v) =>
                        setEditVariant({ familyName: family.name, variant: v })
                      }
                      onAddVariant={() =>
                        setVariantDialog({
                          familyId: family.id,
                          familyName: family.name,
                          nextSort:
                            Math.max(
                              0,
                              ...family.billing_variants.map(
                                (v) => v.sort_order
                              )
                            ) + 1
                        })
                      }
                      onDeleteVariant={(id) => deleteBillingVariant(id)}
                      onDeleteFamily={() => deleteBillingFamily(family.id)}
                      onOpenPricingFamily={() =>
                        setPricingDialog({
                          scope: {
                            kind: 'billing_type',
                            payerId: displayPayer.id,
                            billingTypeId: family.id
                          },
                          editing: ruleForBillingType(family.id)
                        })
                      }
                      onOpenPricingVariant={(v) =>
                        setPricingDialog({
                          scope: {
                            kind: 'billing_variant',
                            payerId: displayPayer.id,
                            billingVariantId: v.id
                          },
                          editing: ruleForVariant(v.id)
                        })
                      }
                    />
                  ))
                )}
              </div>
            </div>

            {/* Invoice Text Templates Section */}
            <div className='bg-card rounded-xl border p-5 shadow-sm'>
              <div className='mb-4 flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <FileText className='text-muted-foreground h-5 w-5' />
                  <h3 className='text-lg font-semibold'>Rechnungsvorlagen</h3>
                </div>
                <Button variant='outline' size='sm' asChild className='gap-1'>
                  <Link
                    href='/dashboard/abrechnung/vorlagen'
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    <ExternalLink className='h-3.5 w-3.5' />
                    Vorlagen verwalten
                  </Link>
                </Button>
              </div>

              <div className='space-y-4'>
                {/* Intro Block Selector */}
                <div className='space-y-2'>
                  <label className='text-sm font-medium'>
                    Standard Einleitung
                  </label>
                  {isLoadingTextBlocks ? (
                    <Skeleton className='h-10 w-full' />
                  ) : (
                    <Select
                      value={selectedIntroBlockId ?? 'default'}
                      onValueChange={(value) =>
                        setSelectedIntroBlockId(
                          value === 'default' ? null : value
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Unternehmens-Standard verwenden...' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='default'>
                          Unternehmens-Standard
                        </SelectItem>
                        {textBlocks
                          ?.filter((b) => b.type === 'intro')
                          .map((block) => (
                            <SelectItem key={block.id} value={block.id}>
                              {block.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    Einleitungstext für Rechnungen an diesen Kostenträger.
                  </p>
                </div>

                {/* Outro Block Selector */}
                <div className='space-y-2'>
                  <label className='text-sm font-medium'>
                    Standard Schlussformel
                  </label>
                  {isLoadingTextBlocks ? (
                    <Skeleton className='h-10 w-full' />
                  ) : (
                    <Select
                      value={selectedOutroBlockId ?? 'default'}
                      onValueChange={(value) =>
                        setSelectedOutroBlockId(
                          value === 'default' ? null : value
                        )
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Unternehmens-Standard verwenden...' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='default'>
                          Unternehmens-Standard
                        </SelectItem>
                        {textBlocks
                          ?.filter((b) => b.type === 'outro')
                          .map((block) => (
                            <SelectItem key={block.id} value={block.id}>
                              {block.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  )}
                  <p className='text-muted-foreground text-xs'>
                    Schlussformel für Rechnungen an diesen Kostenträger.
                  </p>
                </div>

                <Button
                  onClick={handleSaveTextBlocks}
                  disabled={isSavingTextBlocks || isLoadingTextBlocks}
                  size='sm'
                  className='mt-2'
                >
                  {isSavingTextBlocks ? 'Speichern...' : 'Vorlagen speichern'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>

      <AddBillingFamilyDialog
        payerId={displayPayer.id}
        open={isAddFamilyOpen}
        onOpenChange={setIsAddFamilyOpen}
        existingFamilies={families || []}
      />

      {variantDialog && (
        <AddBillingVariantDialog
          payerId={displayPayer.id}
          familyId={variantDialog.familyId}
          familyName={variantDialog.familyName}
          existingVariantCodes={
            families
              ?.find((f) => f.id === variantDialog.familyId)
              ?.billing_variants.map((v) => v.code) ?? []
          }
          open={!!variantDialog}
          onOpenChange={(o) => !o && setVariantDialog(null)}
          nextSortOrder={variantDialog.nextSort}
        />
      )}

      <BillingTypeBehaviorDialog
        payerId={displayPayer.id}
        billingFamily={behaviorFamily}
        open={!!behaviorFamily}
        onOpenChange={(isOpen) => !isOpen && setBehaviorFamily(null)}
      />

      <EditBillingFamilyDialog
        payerId={displayPayer.id}
        family={editFamily}
        open={!!editFamily}
        onOpenChange={(isOpen) => !isOpen && setEditFamily(null)}
      />

      <EditBillingVariantDialog
        payerId={displayPayer.id}
        familyName={editVariant?.familyName ?? ''}
        variant={editVariant?.variant ?? null}
        peerVariantCodes={
          editVariant
            ? ((families ?? [])
                .find((f) => f.id === editVariant.variant.billing_type_id)
                ?.billing_variants.filter(
                  (v) => v.id !== editVariant.variant.id
                )
                .map((v) => v.code) ?? [])
            : []
        }
        open={!!editVariant}
        onOpenChange={(isOpen) => !isOpen && setEditVariant(null)}
      />

      {pricingDialog && (
        <PricingRuleDialog
          open={!!pricingDialog}
          onOpenChange={(o) => !o && setPricingDialog(null)}
          scope={pricingDialog.scope}
          editing={pricingDialog.editing}
          onSaved={() => void refetchPricing()}
        />
      )}
    </Sheet>
  );
}

function FamilyBlock({
  family,
  isDeleting,
  typeRule,
  ruleForVariant,
  onOpenBehavior,
  onEditFamily,
  onEditVariant,
  onAddVariant,
  onDeleteVariant,
  onDeleteFamily,
  onOpenPricingFamily,
  onOpenPricingVariant
}: {
  family: BillingFamilyWithVariants;
  isDeleting: boolean;
  typeRule: BillingPricingRuleRow | null;
  ruleForVariant: (variantId: string) => BillingPricingRuleRow | null;
  onOpenBehavior: () => void;
  onEditFamily: () => void;
  onEditVariant: (v: BillingVariant) => void;
  onAddVariant: () => void;
  onDeleteVariant: (id: string) => Promise<void>;
  onDeleteFamily: () => Promise<void>;
  onOpenPricingFamily: () => void;
  onOpenPricingVariant: (v: BillingVariant) => void;
}) {
  const variantCount = family.billing_variants?.length ?? 0;

  return (
    <div className='bg-card overflow-hidden rounded-xl border shadow-sm'>
      <div
        className='flex items-center justify-between border-b px-4 py-3'
        style={{
          borderLeftWidth: 4,
          borderLeftColor: family.color
        }}
      >
        <div className='flex min-w-0 items-center gap-3'>
          <div
            className='h-8 w-8 shrink-0 rounded-full border'
            style={{ backgroundColor: `${family.color}22` }}
          >
            <div
              className='mx-auto mt-1.5 h-5 w-5 rounded-full'
              style={{ backgroundColor: family.color }}
            />
          </div>
          <div className='min-w-0'>
            <h4 className='truncate font-semibold'>{family.name}</h4>
            <p className='text-muted-foreground text-xs'>
              Abrechnungsart (Familie) · CSV-Spalte{' '}
              <code className='text-[10px]'>abrechnungsart</code>
            </p>
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-foreground h-8 w-8'
            onClick={onEditFamily}
            title='Name und Farbe bearbeiten'
          >
            <Pencil className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-foreground h-8 w-8'
            onClick={onOpenBehavior}
            title='Verhalten (gilt für alle Unterarten)'
          >
            <Settings2 className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground hover:text-foreground h-8 w-8'
            onClick={onOpenPricingFamily}
            title={
              typeRule
                ? `Preisregel: ${typeRule.strategy}`
                : 'Preisregel (Familie)'
            }
          >
            <CircleDollarSign className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='sm'
            className='h-8 gap-1 px-2'
            onClick={onAddVariant}
          >
            <Plus className='h-3.5 w-3.5' />
            Unterart
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='text-muted-foreground hover:text-destructive h-8 w-8'
                disabled={isDeleting}
                title='Familie löschen'
              >
                <Trash2 className='h-4 w-4' />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Familie löschen?</AlertDialogTitle>
                <AlertDialogDescription>
                  „{family.name}“ und alle Unterarten werden entfernt. Fahrten
                  behalten Kostenträger, verlieren aber die
                  Abrechnungs-Zuordnung (Variante).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => void onDeleteFamily()}
                  className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                >
                  Löschen
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Mehrere Unterarten: Liste. Eine Unterart: eine Zeile mit Preis + Bearbeiten. */}
      {variantCount === 1 ? (
        <ul className='divide-y'>
          {(family.billing_variants || []).map((v) => (
            <li
              key={v.id}
              className='flex items-center justify-between gap-2 px-4 py-2.5 text-sm'
            >
              <div className='min-w-0 flex-1'>
                <span className='font-medium'>{v.name}</span>
                <span className='text-muted-foreground ml-2 text-xs'>
                  <code className='text-[10px]'>{v.code}</code>
                </span>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground h-8 w-8'
                  onClick={() => onOpenPricingVariant(v)}
                  title='Preisregel (Unterart)'
                >
                  <CircleDollarSign className='h-3.5 w-3.5' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground h-8 w-8'
                  onClick={() => onEditVariant(v)}
                >
                  <Pencil className='h-3.5 w-3.5' />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : variantCount > 1 ? (
        <ul className='divide-y'>
          {(family.billing_variants || []).map((v) => (
            <li
              key={v.id}
              className='flex items-center justify-between gap-2 px-4 py-2.5 text-sm'
            >
              <div className='min-w-0 flex-1'>
                <span className='font-medium'>{v.name}</span>
                <span className='text-muted-foreground ml-2 text-xs'>
                  · CSV-Code für{' '}
                  <code className='text-[10px]'>abrechnungsvariante</code>
                </span>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <Badge
                  variant='secondary'
                  className='font-mono text-xs tracking-wide uppercase'
                >
                  {v.code}
                </Badge>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground hover:text-foreground h-8 w-8'
                  onClick={() => onOpenPricingVariant(v)}
                  title={
                    ruleForVariant(v.id)
                      ? `Preisregel: ${ruleForVariant(v.id)?.strategy}`
                      : 'Preisregel (Unterart)'
                  }
                >
                  <CircleDollarSign className='h-3.5 w-3.5' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-muted-foreground hover:text-foreground h-8 w-8'
                  onClick={() => onEditVariant(v)}
                  title='Unterart bearbeiten'
                >
                  <Pencil className='h-3.5 w-3.5' />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='text-muted-foreground hover:text-destructive h-8 w-8'
                      disabled={isDeleting || variantCount <= 1}
                      title={
                        variantCount <= 1
                          ? 'Mindestens eine Unterart behalten'
                          : 'Unterart löschen'
                      }
                    >
                      <Trash2 className='h-3.5 w-3.5' />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Unterart löschen?</AlertDialogTitle>
                      <AlertDialogDescription>
                        „{v.name}“ ({v.code}) — betroffene Fahrten verlieren
                        diese Zuordnung.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void onDeleteVariant(v.id)}
                        className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      >
                        Löschen
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
