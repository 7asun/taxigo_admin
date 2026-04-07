'use client';

/**
 * pdf-vorlagen-settings-page.tsx
 *
 * Two-column admin UI: list + editor. Company ID comes from the parent (server
 * resolved). Creates new Vorlagen with system default column arrays from the catalog.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  usePdfVorlagenList,
  usePdfVorlagenMutations
} from '@/features/invoices/hooks/use-pdf-vorlagen';
import {
  SYSTEM_DEFAULT_APPENDIX_COLUMNS,
  SYSTEM_DEFAULT_MAIN_COLUMNS
} from '@/features/invoices/lib/pdf-column-catalog';

import { PdfVorlagenPanel } from './pdf-vorlagen-panel';
import { VorlageEditorPanel } from './vorlage-editor-panel';

interface PdfVorlagenSettingsPageProps {
  companyId: string;
}

export function PdfVorlagenSettingsPage({
  companyId
}: PdfVorlagenSettingsPageProps) {
  const { data: list = [], isLoading } = usePdfVorlagenList(companyId);
  const {
    createVorlage,
    updateVorlage,
    deleteVorlage,
    setDefaultVorlage,
    isCreating,
    isUpdating,
    isDeleting,
    isSettingDefault
  } = usePdfVorlagenMutations(companyId);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = list.find((v) => v.id === selectedId) ?? null;

  useEffect(() => {
    if (list.length === 0) {
      setSelectedId(null);
      return;
    }
    if (selectedId && !list.some((v) => v.id === selectedId)) {
      setSelectedId(list[0]?.id ?? null);
    } else if (!selectedId && list[0]) {
      setSelectedId(list[0].id);
    }
  }, [list, selectedId]);

  const handleNew = useCallback(async () => {
    const row = await createVorlage({
      companyId,
      name: 'Neue PDF-Vorlage',
      description: null,
      main_columns: [...SYSTEM_DEFAULT_MAIN_COLUMNS],
      appendix_columns: [...SYSTEM_DEFAULT_APPENDIX_COLUMNS],
      is_default: list.length === 0
    });
    setSelectedId(row.id);
  }, [companyId, createVorlage, list.length]);

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold'>PDF-Vorlagen</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Spaltenprofile für Rechnung und Anhang — Zuweisung je Kostenträger
          oder pro Rechnung im Builder.
        </p>
      </div>

      <div className='border-border flex h-[min(720px,calc(100vh-12rem))] min-h-[420px] overflow-hidden rounded-lg border'>
        <PdfVorlagenPanel
          items={list}
          loading={isLoading}
          selectedId={selectedId}
          onSelect={(v) => setSelectedId(v.id)}
          onNew={() => void handleNew()}
        />
        <VorlageEditorPanel
          vorlage={selected}
          isSaving={isUpdating}
          isDeleting={isDeleting}
          isSettingDefault={isSettingDefault}
          onSave={async (args) => {
            await updateVorlage({
              id: args.id,
              payload: {
                name: args.name,
                description: args.description,
                main_columns: args.main_columns,
                appendix_columns: args.appendix_columns,
                main_layout: args.main_layout
              }
            });
          }}
          onDelete={async (id) => {
            await deleteVorlage(id);
            setSelectedId(null);
          }}
          onSetDefault={async (id) => {
            await setDefaultVorlage({ id });
          }}
        />
      </div>
      {isCreating ? (
        <p className='text-muted-foreground text-xs'>Vorlage wird erstellt…</p>
      ) : null}
    </div>
  );
}
