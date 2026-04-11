'use client';

/**
 * vorlage-editor-panel.tsx
 *
 * Settings UI: edit one **`pdf_vorlagen`** row — name, description, **main_layout** (grouped / single_row / flat),
 * ordered **main** and **appendix** column keys.
 *
 * **Catalog as SSOT:** labels and allowed keys come only from `pdf-column-catalog.ts` (`PDF_COLUMN_MAP`,
 * `MAIN_GROUPED_COLUMNS` / `MAIN_FLAT_COLUMNS`, `APPENDIX_COLUMNS`). **SortablePdfColumnList** uses
 * @dnd-kit (vertical list) for reorder; **ColumnPicker** adds from the pool.
 *
 * **Persist:** parent calls `updatePdfVorlage` / `setDefaultVorlage`; on success, React Query invalidates
 * `invoiceKeys.pdfVorlagen.list(companyId)` so lists and payer pickers refresh.
 */

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Star, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Panel } from '@/components/panels/panel';
import { PanelBody } from '@/components/panels/panel-body';
import { PanelFooter } from '@/components/panels/panel-footer';
import { PanelHeader } from '@/components/panels/panel-header';
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
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';

import {
  APPENDIX_COLUMNS,
  APPENDIX_LANDSCAPE_THRESHOLD,
  MAIN_FLAT_COLUMNS,
  MAIN_GROUPED_COLUMNS,
  PDF_COLUMN_MAP,
  SYSTEM_DEFAULT_MAIN_COLUMNS,
  type PdfColumnKey
} from '@/features/invoices/lib/pdf-column-catalog';
import type {
  MainLayout,
  PdfVorlageRow
} from '@/features/invoices/types/pdf-vorlage.types';
import { useInvoiceTextBlocks } from '@/features/invoices/hooks/use-invoice-text-blocks';
import { VorlageTextSection } from '@/features/invoices/components/vorlagen/vorlage-text-section';

import { ColumnPicker } from './column-picker';
import { SortablePdfColumnList } from './sortable-pdf-column-list';

interface VorlageEditorPanelProps {
  vorlage: PdfVorlageRow | null;
  className?: string;
  onSave: (args: {
    id: string;
    name: string;
    description: string | null;
    main_columns: PdfColumnKey[];
    appendix_columns: PdfColumnKey[];
    main_layout: MainLayout;
    intro_block_id: string | null;
    outro_block_id: string | null;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
  isSaving: boolean;
  isDeleting: boolean;
  isSettingDefault: boolean;
  /** Unified Vorlagen page: jump to Textbausteine tab. */
  onOpenTextBlocks?: () => void;
}

export function VorlageEditorPanel({
  vorlage,
  className,
  onSave,
  onDelete,
  onSetDefault,
  isSaving,
  isDeleting,
  isSettingDefault,
  onOpenTextBlocks
}: VorlageEditorPanelProps) {
  const { data: groupedTextBlocks, isLoading: isLoadingTextBlocks } =
    useInvoiceTextBlocks();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mainKeys, setMainKeys] = useState<PdfColumnKey[]>([]);
  const [appendixKeys, setAppendixKeys] = useState<PdfColumnKey[]>([]);
  const [mainOpen, setMainOpen] = useState(true);
  const [annOpen, setAnnOpen] = useState(true);
  const [textOpen, setTextOpen] = useState(true);
  const [introBlockId, setIntroBlockId] = useState<string | null>(null);
  const [outroBlockId, setOutroBlockId] = useState<string | null>(null);
  const [mainLayout, setMainLayout] = useState<MainLayout>('grouped');

  const mainColumnPool =
    mainLayout === 'flat' ? MAIN_FLAT_COLUMNS : MAIN_GROUPED_COLUMNS;

  // Reacts to the selected Vorlage row: reset or hydrate local editor state from server data.
  useEffect(() => {
    if (!vorlage) {
      setName('');
      setDescription('');
      setMainKeys([]);
      setAppendixKeys([]);
      setMainLayout('grouped');
      setIntroBlockId(null);
      setOutroBlockId(null);
      return;
    }
    setName(vorlage.name);
    setDescription(vorlage.description ?? '');
    setMainLayout(vorlage.main_layout);
    setMainKeys([...vorlage.main_columns]);
    setAppendixKeys([...vorlage.appendix_columns]);
    setIntroBlockId(vorlage.intro_block_id ?? null);
    setOutroBlockId(vorlage.outro_block_id ?? null);
  }, [vorlage]);

  const getLabel = (key: string) => PDF_COLUMN_MAP[key]?.uiLabel ?? key;

  const availableMain = useMemo(
    () =>
      mainColumnPool.filter((c) => !mainKeys.includes(c.key as PdfColumnKey)),
    [mainKeys, mainColumnPool]
  );

  const availableAppendix = useMemo(
    () =>
      APPENDIX_COLUMNS.filter(
        (c) => !appendixKeys.includes(c.key as PdfColumnKey)
      ),
    [appendixKeys]
  );

  const appendixLandscape = appendixKeys.length > APPENDIX_LANDSCAPE_THRESHOLD;

  const dirty =
    vorlage &&
    (name !== vorlage.name ||
      (description || '') !== (vorlage.description ?? '') ||
      mainLayout !== vorlage.main_layout ||
      JSON.stringify(mainKeys) !== JSON.stringify(vorlage.main_columns) ||
      JSON.stringify(appendixKeys) !==
        JSON.stringify(vorlage.appendix_columns) ||
      introBlockId !== (vorlage.intro_block_id ?? null) ||
      outroBlockId !== (vorlage.outro_block_id ?? null));

  const handleSave = async () => {
    if (!vorlage) return;
    await onSave({
      id: vorlage.id,
      name: name.trim() || vorlage.name,
      description: description.trim() || null,
      main_columns: mainKeys,
      appendix_columns: appendixKeys,
      main_layout: mainLayout,
      intro_block_id: introBlockId,
      outro_block_id: outroBlockId
    });
  };

  const handleMainLayoutChange = (value: string) => {
    // Preserve grouped_by_billing_type explicitly — do not collapse into 'grouped'
    // All non-flat layouts use MAIN_GROUPED_COLUMNS pool (see column pool logic below)
    const next: MainLayout =
      value === 'flat'
        ? 'flat'
        : value === 'single_row'
          ? 'single_row'
          : value === 'grouped_by_billing_type'
            ? 'grouped_by_billing_type'
            : 'grouped';
    setMainLayout(next);

    // Layout switch migrates existing column selection to the new layout's valid pool.
    // Columns incompatible with the new layout are dropped.
    // If no columns survive, reset to sensible layout-appropriate defaults.
    //
    // Important: this is the ONLY place where layout-incompatible columns are
    // deliberately removed from a Vorlage. The resolver and cover renderer only
    // skip them at read/render time — they never rewrite stored JSON.
    // `single_row` uses the same column pool as `grouped` (summary row shape).
    const validPool =
      next === 'flat' ? MAIN_FLAT_COLUMNS : MAIN_GROUPED_COLUMNS;
    const validKeys = new Set(validPool.map((c) => c.key));
    setMainKeys((prev) => {
      const surviving = prev.filter((key) => validKeys.has(key));
      if (surviving.length > 0) {
        return surviving;
      }
      if (next !== 'flat') {
        return SYSTEM_DEFAULT_MAIN_COLUMNS.filter((k) => validKeys.has(k));
      }
      return [
        'trip_date',
        'client_name',
        'billing_variant',
        'net_price',
        'gross_price'
      ] as PdfColumnKey[];
    });
  };

  if (!vorlage) {
    return (
      <Panel className={cn('min-w-0 flex-1', className)}>
        <PanelBody className='text-muted-foreground flex flex-1 items-center justify-center p-8 text-sm'>
          Wählen Sie eine Vorlage oder legen Sie eine neue an.
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel className={cn('min-w-0 flex-1', className)}>
      <PanelHeader title={vorlage.name} className='shrink-0' />
      <PanelBody className='min-h-0 flex-1 space-y-4 overflow-y-auto'>
        <div className='space-y-2'>
          <Label htmlFor='vorlage-name'>Name</Label>
          <Input
            id='vorlage-name'
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='vorlage-desc'>Beschreibung</Label>
          <Textarea
            id='vorlage-desc'
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            disabled={isSaving}
          />
        </div>

        <div className='flex items-center gap-2'>
          <Checkbox
            id='vorlage-default'
            checked={vorlage.is_default}
            disabled={isSettingDefault || vorlage.is_default}
            onCheckedChange={(v) => {
              if (v === true) void onSetDefault(vorlage.id);
            }}
          />
          <Label htmlFor='vorlage-default' className='font-normal'>
            Standard-Vorlage für das Unternehmen
          </Label>
          {vorlage.is_default ? (
            <Badge variant='secondary' className='gap-1'>
              <Star className='h-3 w-3' />
              Standard
            </Badge>
          ) : null}
        </div>

        <div className='space-y-2'>
          <Label>Haupttabelle</Label>
          <RadioGroup
            value={mainLayout}
            onValueChange={handleMainLayoutChange}
            className='grid grid-cols-2 gap-2'
            disabled={isSaving}
          >
            <Label
              htmlFor='layout-grouped'
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal',
                'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'
              )}
            >
              <RadioGroupItem value='grouped' id='layout-grouped' />
              Gruppiert
            </Label>
            <Label
              htmlFor='layout-flat'
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal',
                'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'
              )}
            >
              <RadioGroupItem value='flat' id='layout-flat' />
              Einzeln
            </Label>
            <Label
              htmlFor='layout-single-row'
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal',
                'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'
              )}
            >
              <RadioGroupItem value='single_row' id='layout-single-row' />
              Zusammengefasst
            </Label>
            <Label
              htmlFor='layout-billing-type'
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal',
                'has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'
              )}
            >
              <RadioGroupItem
                value='grouped_by_billing_type'
                id='layout-billing-type'
              />
              Nach Abrechnungsart
            </Label>
          </RadioGroup>
        </div>

        <Collapsible open={mainOpen} onOpenChange={setMainOpen}>
          <CollapsibleTrigger className='flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-medium'>
            Hauptrechnung
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform',
                mainOpen && 'rotate-180'
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className='space-y-3 pt-3'>
            <div className='flex flex-wrap items-center gap-2'>
              <ColumnPicker
                available={availableMain}
                disabled={isSaving}
                onAdd={(key) =>
                  setMainKeys((prev) => [...prev, key as PdfColumnKey])
                }
              />
            </div>
            <SortablePdfColumnList
              columnKeys={mainKeys}
              getLabel={getLabel}
              disabled={isSaving}
              onReorder={setMainKeys}
              onRemove={(key) =>
                setMainKeys((prev) => prev.filter((k) => k !== key))
              }
            />
          </CollapsibleContent>
        </Collapsible>

        <Collapsible open={annOpen} onOpenChange={setAnnOpen}>
          <CollapsibleTrigger className='flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-medium'>
            Anhang
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform',
                annOpen && 'rotate-180'
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className='space-y-3 pt-3'>
            {appendixLandscape ? (
              <Badge variant='outline' className='mb-1 font-normal'>
                Querformat wird automatisch aktiviert ({appendixKeys.length}{' '}
                Spalten)
              </Badge>
            ) : null}
            <div className='flex flex-wrap items-center gap-2'>
              <ColumnPicker
                available={availableAppendix}
                disabled={isSaving}
                onAdd={(key) =>
                  setAppendixKeys((prev) => [...prev, key as PdfColumnKey])
                }
              />
            </div>
            <SortablePdfColumnList
              columnKeys={appendixKeys}
              getLabel={getLabel}
              disabled={isSaving}
              onReorder={setAppendixKeys}
              onRemove={(key) =>
                setAppendixKeys((prev) => prev.filter((k) => k !== key))
              }
            />
          </CollapsibleContent>
        </Collapsible>

        <VorlageTextSection
          introBlockId={introBlockId}
          outroBlockId={outroBlockId}
          textBlocks={groupedTextBlocks}
          isLoading={isLoadingTextBlocks}
          onChange={(field, id) => {
            if (field === 'intro_block_id') setIntroBlockId(id);
            else setOutroBlockId(id);
          }}
          onOpenTextBlocks={onOpenTextBlocks}
          open={textOpen}
          onOpenChange={setTextOpen}
        />
      </PanelBody>
      <PanelFooter className='border-border flex shrink-0 flex-wrap items-center justify-between gap-2 border-t'>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type='button'
              variant='destructive'
              size='sm'
              disabled={isDeleting || isSaving}
            >
              <Trash2 className='mr-1 h-4 w-4' />
              Löschen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Vorlage löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Die PDF-Vorlage wird dauerhaft entfernt. Kostenträger mit dieser
                Zuordnung sollten vorher umgestellt werden.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void onDelete(vorlage.id)}
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
              >
                Löschen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          type='button'
          onClick={() => void handleSave()}
          disabled={
            isSaving ||
            !dirty ||
            mainKeys.length === 0 ||
            appendixKeys.length === 0
          }
        >
          {isSaving ? 'Speichern…' : 'Speichern'}
        </Button>
      </PanelFooter>
    </Panel>
  );
}
