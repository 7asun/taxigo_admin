'use client';

/**
 * vorlage-editor-panel.tsx
 *
 * Settings UI: edit one **`pdf_vorlagen`** row — name, description, **main_layout** (grouped/flat),
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
import type { PdfVorlageRow } from '@/features/invoices/types/pdf-vorlage.types';

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
    main_layout: 'grouped' | 'flat';
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
  isSaving: boolean;
  isDeleting: boolean;
  isSettingDefault: boolean;
}

export function VorlageEditorPanel({
  vorlage,
  className,
  onSave,
  onDelete,
  onSetDefault,
  isSaving,
  isDeleting,
  isSettingDefault
}: VorlageEditorPanelProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mainKeys, setMainKeys] = useState<PdfColumnKey[]>([]);
  const [appendixKeys, setAppendixKeys] = useState<PdfColumnKey[]>([]);
  const [mainOpen, setMainOpen] = useState(true);
  const [annOpen, setAnnOpen] = useState(true);
  const [mainLayout, setMainLayout] = useState<'grouped' | 'flat'>('grouped');

  const mainColumnPool =
    mainLayout === 'grouped' ? MAIN_GROUPED_COLUMNS : MAIN_FLAT_COLUMNS;

  // Reacts to the selected Vorlage row: reset or hydrate local editor state from server data.
  useEffect(() => {
    if (!vorlage) {
      setName('');
      setDescription('');
      setMainKeys([]);
      setAppendixKeys([]);
      setMainLayout('grouped');
      return;
    }
    setName(vorlage.name);
    setDescription(vorlage.description ?? '');
    setMainLayout(vorlage.main_layout);
    setMainKeys([...vorlage.main_columns]);
    setAppendixKeys([...vorlage.appendix_columns]);
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
        JSON.stringify(vorlage.appendix_columns));

  const handleSave = async () => {
    if (!vorlage) return;
    await onSave({
      id: vorlage.id,
      name: name.trim() || vorlage.name,
      description: description.trim() || null,
      main_columns: mainKeys,
      appendix_columns: appendixKeys,
      main_layout: mainLayout
    });
  };

  const handleMainLayoutChange = (value: string) => {
    const next: 'grouped' | 'flat' = value === 'flat' ? 'flat' : 'grouped';
    setMainLayout(next);

    // Layout switch migrates existing column selection to the new layout's valid pool.
    // Columns incompatible with the new layout are dropped.
    // If no columns survive, reset to sensible layout-appropriate defaults.
    //
    // Important: this is the ONLY place where layout-incompatible columns are
    // deliberately removed from a Vorlage. The resolver and cover renderer only
    // skip them at read/render time — they never rewrite stored JSON.
    const validPool =
      next === 'grouped' ? MAIN_GROUPED_COLUMNS : MAIN_FLAT_COLUMNS;
    const validKeys = new Set(validPool.map((c) => c.key));
    setMainKeys((prev) => {
      const surviving = prev.filter((key) => validKeys.has(key));
      if (surviving.length > 0) {
        return surviving;
      }
      if (next === 'grouped') {
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
            className='flex flex-col gap-2 sm:flex-row sm:gap-6'
            disabled={isSaving}
          >
            <div className='flex items-center gap-2'>
              <RadioGroupItem value='grouped' id='vorlage-ml-grouped' />
              <Label htmlFor='vorlage-ml-grouped' className='font-normal'>
                Gruppiert (Standard)
              </Label>
            </div>
            <div className='flex items-center gap-2'>
              <RadioGroupItem value='flat' id='vorlage-ml-flat' />
              <Label htmlFor='vorlage-ml-flat' className='font-normal'>
                Pro Fahrt (eine Zeile je Fahrt)
              </Label>
            </div>
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
