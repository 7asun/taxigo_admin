'use client';

import { useState } from 'react';
import {
  Pencil,
  Plus,
  Receipt,
  Settings2,
  Trash2,
  FileText,
  ExternalLink
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
  const { updatePayer, isUpdating } = usePayers();
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

  const startEditing = () => {
    if (payer) {
      setEditName(payer.name);
      setIsEditing(true);
    }
  };

  const handleSave = async () => {
    if (!payer) return;
    try {
      await updatePayer({
        id: payer.id,
        name: editName,
        number: payer.number as any
      });
      toast.success('Kostenträger aktualisiert');
      setIsEditing(false);
    } catch {
      toast.error('Fehler beim Aktualisieren');
    }
  };

  const handleSaveTextBlocks = async () => {
    if (!payer) return;
    setIsSavingTextBlocks(true);
    try {
      await updatePayerTextBlocks(
        payer.id,
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

  if (!payer) return null;

  return (
    <Sheet
      open={open}
      onOpenChange={(val) => {
        onOpenChange(val);
        if (!val) setIsEditing(false);
      }}
    >
      <SheetContent className='w-[90vw] overflow-y-auto px-8 sm:max-w-xl sm:px-12'>
        <SheetHeader className='mb-6'>
          <div className='flex items-center justify-between'>
            <div className='flex-1'>
              {isEditing ? (
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder='Name'
                  className='focus-visible:border-primary mb-1 h-10 rounded-none border-0 border-b px-0 text-2xl font-semibold focus-visible:ring-0'
                  autoFocus
                />
              ) : (
                <SheetTitle className='flex items-baseline gap-3 text-2xl'>
                  {payer.name}
                  {payer.number && (
                    <span className='text-muted-foreground text-lg font-normal'>
                      {formatPayerNumber(payer.number)}
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

        <div className='space-y-8'>
          <div className='bg-card rounded-xl border p-5 shadow-sm'>
            <div className='flex items-center gap-4'>
              <div className='bg-muted rounded-lg p-3'>
                <Receipt className='text-muted-foreground h-6 w-6' />
              </div>
              <div className='flex-1'>
                <div className='text-foreground text-lg font-bold'>
                  {payer.number || '–'}
                </div>
                <div className='text-muted-foreground text-sm'>
                  Kostenträgernummer
                </div>
              </div>
            </div>
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
                            ...family.billing_variants.map((v) => v.sort_order)
                          ) + 1
                      })
                    }
                    onDeleteVariant={(id) => deleteBillingVariant(id)}
                    onDeleteFamily={() => deleteBillingFamily(family.id)}
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
                  href='/dashboard/settings/invoice-templates'
                  target='_blank'
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
      </SheetContent>

      <AddBillingFamilyDialog
        payerId={payer.id}
        open={isAddFamilyOpen}
        onOpenChange={setIsAddFamilyOpen}
        existingFamilies={families || []}
      />

      {variantDialog && (
        <AddBillingVariantDialog
          payerId={payer.id}
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
        payerId={payer.id}
        billingFamily={behaviorFamily}
        open={!!behaviorFamily}
        onOpenChange={(isOpen) => !isOpen && setBehaviorFamily(null)}
      />

      <EditBillingFamilyDialog
        payerId={payer.id}
        family={editFamily}
        open={!!editFamily}
        onOpenChange={(isOpen) => !isOpen && setEditFamily(null)}
      />

      <EditBillingVariantDialog
        payerId={payer.id}
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
    </Sheet>
  );
}

function FamilyBlock({
  family,
  isDeleting,
  onOpenBehavior,
  onEditFamily,
  onEditVariant,
  onAddVariant,
  onDeleteVariant,
  onDeleteFamily
}: {
  family: BillingFamilyWithVariants;
  isDeleting: boolean;
  onOpenBehavior: () => void;
  onEditFamily: () => void;
  onEditVariant: (v: BillingVariant) => void;
  onAddVariant: () => void;
  onDeleteVariant: (id: string) => Promise<void>;
  onDeleteFamily: () => Promise<void>;
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

      {/* Einzelne Standard-Unterart: Liste ausblenden; „Unterart“ oben legt weitere an. */}
      {variantCount > 1 ? (
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
