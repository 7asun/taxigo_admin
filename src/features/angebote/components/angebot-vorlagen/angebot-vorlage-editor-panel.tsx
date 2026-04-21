'use client';

/**
 * Settings UI for one `angebot_vorlagen` row: name, ordered column defs, default flag.
 *
 * Editing or deleting a template does not affect existing offers — each offer holds its own table_schema_snapshot.
 */

import { useEffect, useMemo, useState } from 'react';
import { Lock, Star, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type {
  AngebotColumnDef,
  AngebotVorlageRow
} from '@/features/angebote/types/angebot.types';
import {
  ANGEBOT_PDF_AVAILABLE_WIDTH,
  calcAngebotColumnWidths
} from '@/features/angebote/components/angebot-pdf/angebot-pdf-columns';
import {
  ANGEBOT_POSITION_COLUMN,
  ANGEBOT_POSITION_COLUMN_ID
} from '@/features/angebote/lib/angebot-auto-columns';
import type { AngebotColumnPreset } from '@/features/angebote/lib/angebot-column-presets';
import {
  COLUMN_PRESET_UI,
  defaultHeaderForPreset,
  resolveColumnLayout
} from '@/features/angebote/lib/angebot-column-presets';

import { SortableAngebotColumnList } from './sortable-angebot-column-list';

const ADMIN_PRESETS = (
  Object.keys(COLUMN_PRESET_UI) as AngebotColumnPreset[]
).filter((p) => COLUMN_PRESET_UI[p].adminSelectable);

interface AngebotVorlageEditorPanelProps {
  vorlage: AngebotVorlageRow | null;
  className?: string;
  onSave: (args: {
    id: string;
    name: string;
    description: string | null;
    columns: AngebotColumnDef[];
    is_default?: boolean;
  }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
  isSaving: boolean;
  isDeleting: boolean;
  isSettingDefault: boolean;
}

export function AngebotVorlageEditorPanel({
  vorlage,
  className,
  onSave,
  onDelete,
  onSetDefault,
  isSaving,
  isDeleting,
  isSettingDefault
}: AngebotVorlageEditorPanelProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [columns, setColumns] = useState<AngebotColumnDef[]>([]);
  const [markDefault, setMarkDefault] = useState(false);

  const [newHeader, setNewHeader] = useState('');
  const [newPreset, setNewPreset] =
    useState<AngebotColumnPreset>('beschreibung');
  const [newRequired, setNewRequired] = useState(false);

  useEffect(() => {
    if (!vorlage) {
      setName('');
      setDescription('');
      setColumns([]);
      setMarkDefault(false);
      return;
    }
    setName(vorlage.name);
    setDescription(vorlage.description ?? '');
    setColumns(
      vorlage.columns
        .filter((c) => c.id !== ANGEBOT_POSITION_COLUMN_ID)
        .map((c) => ({ ...c }))
    );
    setMarkDefault(vorlage.is_default);
  }, [vorlage]);

  const editableColumns = useMemo(
    () =>
      // Defensive filter — col_position must never be stored in columns but guard against legacy data.
      columns.filter((c) => c.id !== ANGEBOT_POSITION_COLUMN_ID),
    [columns]
  );

  const widthPreview = useMemo(
    () =>
      calcAngebotColumnWidths([ANGEBOT_POSITION_COLUMN, ...editableColumns]),
    [editableColumns]
  );

  const fixedTotal = useMemo(() => {
    const effective = [ANGEBOT_POSITION_COLUMN, ...editableColumns];
    return effective.reduce((sum, col) => {
      const w = resolveColumnLayout(col).width;
      return sum + (w.mode === 'fixed' ? w.pt : 0);
    }, 0);
  }, [editableColumns]);

  const hasFlex = useMemo(() => {
    const effective = [ANGEBOT_POSITION_COLUMN, ...editableColumns];
    return effective.some(
      (col) => resolveColumnLayout(col).width.mode === 'flex'
    );
  }, [editableColumns]);
  const fixedWarn = fixedTotal >= 455 && hasFlex;
  const fixedHardBlock = fixedTotal >= 487 && hasFlex;

  if (!vorlage) {
    return (
      <Panel className={cn('min-w-0 flex-1', className)}>
        <PanelBody>
          <p className='text-muted-foreground text-sm'>
            Wählen Sie links eine Vorlage oder legen Sie eine neue an.
          </p>
        </PanelBody>
      </Panel>
    );
  }

  const reservedPosHeaderError =
    newHeader.trim() !== '' && /^pos\.?$/i.test(newHeader.trim());

  const editableReservedPosErrors = editableColumns.some((c) =>
    /^pos\.?$/i.test(c.header.trim())
  );

  const editableHeaderTooLong = editableColumns.some(
    (c) => c.header.length > 20
  );

  const hasTwoFill =
    editableColumns.filter((c) => c.preset === 'beschreibung').length >= 2;

  const hasSixOrMore = editableColumns.length + 1 >= 6;

  const canSave =
    !isSaving &&
    Boolean(name.trim()) &&
    editableColumns.length > 0 &&
    !editableReservedPosErrors &&
    !editableHeaderTooLong &&
    !fixedHardBlock;

  function handleAddColumn() {
    const h = newHeader.trim();
    if (!h) return;
    // col_position is a reserved auto-column — prevent admins from creating a manual duplicate.
    if (reservedPosHeaderError) return;
    setColumns((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        header: h.slice(0, 20),
        preset: newPreset,
        required: newRequired
      }
    ]);
    setNewHeader('');
    setNewPreset('beschreibung');
    setNewRequired(false);
  }

  return (
    <Panel className={cn('min-w-0 flex-1', className)}>
      <PanelHeader title={name || 'Angebotsvorlage'} />
      <PanelBody className='space-y-4'>
        <div className='space-y-2'>
          <Label htmlFor='av-name'>Name</Label>
          <Input
            id='av-name'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='av-desc'>Beschreibung</Label>
          <Textarea
            id='av-desc'
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className='flex items-center gap-2'>
          <Checkbox
            id='av-default'
            checked={markDefault}
            onCheckedChange={(v) => setMarkDefault(v === true)}
          />
          <Label htmlFor='av-default' className='font-normal'>
            Als Standard für neue Angebote
          </Label>
        </div>

        <div className='space-y-2'>
          <Label>Spalten (Reihenfolge per Drag &amp; Drop)</Label>
          {/* Locked Pos. row — injected at render time only, never persisted. */}
          <div className='bg-muted/40 border-border flex items-center gap-2 rounded-md border px-3 py-2'>
            <Lock className='text-muted-foreground h-4 w-4' />
            <span className='text-sm font-medium'>Pos.</span>
            <span className='text-muted-foreground ml-auto text-xs'>
              {(() => {
                const w = resolveColumnLayout(ANGEBOT_POSITION_COLUMN).width;
                return w.mode === 'fixed' ? `${w.pt} pt` : null;
              })()}
            </span>
          </div>
          <SortableAngebotColumnList
            columns={editableColumns}
            onReorder={setColumns}
            onRemove={(id) => {
              // Cannot delete last column — every template needs at least one column.
              if (editableColumns.length <= 1) return;
              setColumns((prev) => prev.filter((c) => c.id !== id));
            }}
            renderItem={(col) => {
              const counterClass =
                col.header.length >= 18
                  ? 'text-destructive'
                  : 'text-muted-foreground';
              const presetUi = COLUMN_PRESET_UI[col.preset];
              return (
                <div className='flex flex-wrap items-center gap-2'>
                  <div className='min-w-[220px] flex-1 space-y-1'>
                    <div className='flex items-center justify-between gap-2'>
                      <Label className='text-xs font-normal'>Spaltenname</Label>
                      <span
                        className={cn('text-xs tabular-nums', counterClass)}
                      >
                        {col.header.length}/20
                      </span>
                    </div>
                    <Input
                      value={col.header}
                      maxLength={20}
                      aria-invalid={/^pos\.?$/i.test(col.header.trim())}
                      onChange={(e) => {
                        const nextHeader = e.target.value.slice(0, 20);
                        setColumns((prev) =>
                          prev.map((c) =>
                            c.id === col.id ? { ...c, header: nextHeader } : c
                          )
                        );
                      }}
                    />
                    {/^pos\.?$/i.test(col.header.trim()) ? (
                      <p className='text-destructive text-xs'>
                        {'\u201ePos.\u201c ist reserviert.'}
                      </p>
                    ) : null}
                  </div>
                  <div className='w-[220px] space-y-1'>
                    <Label className='text-xs font-normal'>Preset</Label>
                    <Select
                      value={col.preset}
                      onValueChange={(v) => {
                        const nextPreset = v as AngebotColumnPreset;
                        setColumns((prev) =>
                          prev.map((c) => {
                            if (c.id !== col.id) return c;
                            const oldDefault = defaultHeaderForPreset(c.preset);
                            const nextDefault =
                              defaultHeaderForPreset(nextPreset);
                            const shouldAutoRename =
                              c.header.trim() === oldDefault;
                            return {
                              ...c,
                              preset: nextPreset,
                              header: shouldAutoRename ? nextDefault : c.header
                            };
                          })
                        );
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder='Preset wählen…' />
                      </SelectTrigger>
                      <SelectContent>
                        {ADMIN_PRESETS.map((p) => (
                          <SelectItem key={p} value={p}>
                            {COLUMN_PRESET_UI[p].emoji}{' '}
                            {COLUMN_PRESET_UI[p].label}
                          </SelectItem>
                        ))}
                        {/* percent is first-class for rendering legacy data, but not admin-selectable */}
                        {col.preset === 'percent' ? (
                          <SelectItem value='percent'>
                            {presetUi.emoji} {presetUi.label} (Legacy)
                          </SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            }}
          />
          {hasTwoFill ? (
            <p className='text-muted-foreground text-sm'>
              Zwei Füll-Spalten teilen den verfügbaren Platz gleichmäßig.
            </p>
          ) : null}
          {hasSixOrMore ? (
            <p className='text-muted-foreground text-sm'>
              Mit 6 Spalten wird der Platz sehr eng — prüfe die Vorschau.
            </p>
          ) : null}
        </div>

        <div className='border-border space-y-3 rounded-md border p-3'>
          <p className='text-sm font-medium'>Spalte hinzufügen</p>
          <div className='grid gap-2 sm:grid-cols-2'>
            <div className='space-y-1'>
              <Label className='text-xs'>Spaltenname</Label>
              <Input
                value={newHeader}
                maxLength={20}
                onChange={(e) => setNewHeader(e.target.value.slice(0, 20))}
                placeholder='Spaltenname…'
                aria-invalid={reservedPosHeaderError}
              />
              {reservedPosHeaderError ? (
                <p className='text-destructive text-xs'>
                  {'\u201ePos.\u201c ist reserviert.'}
                </p>
              ) : null}
            </div>
            <div className='space-y-1'>
              <Label className='text-xs'>Preset</Label>
              <Select
                value={newPreset}
                onValueChange={(v) => {
                  const p = v as AngebotColumnPreset;
                  setNewPreset(p);
                  if (newHeader.trim() === '') {
                    setNewHeader(defaultHeaderForPreset(p));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder='Preset wählen…' />
                </SelectTrigger>
                <SelectContent>
                  {ADMIN_PRESETS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {COLUMN_PRESET_UI[p].emoji} {COLUMN_PRESET_UI[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='flex items-end gap-2 pb-1'>
              <Checkbox
                id='av-req'
                checked={newRequired}
                onCheckedChange={(v) => setNewRequired(v === true)}
              />
              <Label htmlFor='av-req' className='text-xs font-normal'>
                Pflichtfeld
              </Label>
            </div>
          </div>
          <Button
            type='button'
            size='sm'
            variant='secondary'
            disabled={reservedPosHeaderError || newHeader.trim() === ''}
            onClick={handleAddColumn}
          >
            Übernehmen
          </Button>
        </div>

        <div className='bg-muted/40 space-y-2 rounded-md p-3'>
          <p className='text-xs font-medium'>Breiten-Vorschau</p>
          {fixedHardBlock ? (
            <p className='text-destructive text-sm'>
              Zu viele feste Spalten — kein Platz für Flex-Spalten.
            </p>
          ) : fixedWarn ? (
            <p className='text-muted-foreground text-sm'>
              Viele feste Spalten — Flex-Spalten werden sehr schmal.
            </p>
          ) : null}
          <div
            className={cn(
              'flex h-10 w-full overflow-hidden rounded-sm border',
              fixedHardBlock && 'border-destructive'
            )}
          >
            {[ANGEBOT_POSITION_COLUMN, ...editableColumns].map((col) => {
              const pt = widthPreview[col.id] ?? 20;
              const pct = (pt / ANGEBOT_PDF_AVAILABLE_WIDTH) * 100;
              return (
                <div
                  key={col.id}
                  className={cn(
                    'bg-primary/15 flex items-center justify-center border-r px-1 text-[10px] leading-tight last:border-r-0'
                  )}
                  style={{ width: `${pct}%` }}
                  title={`${col.header}: ${pt.toFixed(0)} pt`}
                >
                  <span className='truncate'>
                    {col.header} · {pt.toFixed(0)}pt
                  </span>
                </div>
              );
            })}
          </div>
          <div className='flex items-center justify-between text-sm'>
            <span className='text-muted-foreground'>
              Summe:{' '}
              {Object.values(widthPreview)
                .reduce((s, v) => s + v, 0)
                .toFixed(0)}{' '}
              / {ANGEBOT_PDF_AVAILABLE_WIDTH} pt
            </span>
            <span
              className={cn(
                'font-medium',
                Math.abs(
                  Object.values(widthPreview).reduce((s, v) => s + v, 0) -
                    ANGEBOT_PDF_AVAILABLE_WIDTH
                ) < 0.5
                  ? 'text-emerald-600'
                  : 'text-muted-foreground'
              )}
            >
              {Math.abs(
                Object.values(widthPreview).reduce((s, v) => s + v, 0) -
                  ANGEBOT_PDF_AVAILABLE_WIDTH
              ) < 0.5
                ? '✓'
                : '⚠️'}
            </span>
          </div>
        </div>
      </PanelBody>
      <PanelFooter className='flex flex-wrap items-center gap-2'>
        <Button
          type='button'
          disabled={!canSave}
          onClick={() =>
            void onSave({
              id: vorlage.id,
              name: name.trim(),
              description: description.trim() || null,
              columns: editableColumns,
              is_default: markDefault ? true : undefined
            })
          }
        >
          {isSaving ? 'Speichern…' : 'Speichern'}
        </Button>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={isSettingDefault || vorlage.is_default}
          onClick={() => void onSetDefault(vorlage.id)}
        >
          <Star className='mr-1 h-3.5 w-3.5' />
          Als Standard setzen
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type='button'
              variant='destructive'
              size='sm'
              disabled={isDeleting}
              className='ml-auto'
            >
              <Trash2 className='mr-1 h-3.5 w-3.5' />
              Löschen
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Vorlage löschen?</AlertDialogTitle>
              <AlertDialogDescription>
                Diese Aktion kann nicht rückgängig gemacht werden. Bestehende
                Angebote behalten ihre gespeicherte Tabellenstruktur.
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
      </PanelFooter>
    </Panel>
  );
}
