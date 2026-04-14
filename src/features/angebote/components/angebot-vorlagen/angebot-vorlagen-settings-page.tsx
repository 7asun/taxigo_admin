'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  useAngebotVorlagenList,
  useAngebotVorlagenMutations
} from '@/features/angebote/hooks/use-angebot-vorlagen';
import type { AngebotColumnDef } from '@/features/angebote/types/angebot.types';

import { AngebotVorlagenPanel } from './angebot-vorlagen-panel';
import { AngebotVorlageEditorPanel } from './angebot-vorlage-editor-panel';

/** Same five-column seed as migration `20260413120000_angebot_flexible_table.sql` (IDs match legacy constants). */
const SYSTEM_DEFAULT_ANGEBOT_COLUMNS: AngebotColumnDef[] = [
  {
    id: 'col_leistung',
    header: 'Leistung',
    preset: 'beschreibung',
    required: false
  },
  {
    id: 'col_anfahrtkosten',
    header: 'Anfahrtkosten',
    preset: 'betrag',
    required: false
  },
  {
    id: 'col_price_first_5km',
    header: 'erste 5 km (je km)',
    preset: 'preis_km',
    required: false
  },
  {
    id: 'col_price_per_km_after_5',
    header: 'ab 5 km (je km)',
    preset: 'preis_km',
    required: false
  },
  {
    id: 'col_notes',
    header: 'Hinweis',
    preset: 'notiz',
    required: false
  }
];

interface AngebotVorlagenSettingsPageProps {
  companyId: string;
}

export function AngebotVorlagenSettingsPage({
  companyId
}: AngebotVorlagenSettingsPageProps) {
  const { data: list = [], isLoading } = useAngebotVorlagenList(companyId);
  const {
    createVorlage,
    updateVorlage,
    deleteVorlage,
    setDefaultVorlage,
    isCreating,
    isUpdating,
    isDeleting,
    isSettingDefault
  } = useAngebotVorlagenMutations(companyId);

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
      name: 'Neue Angebotsvorlage',
      description: null,
      columns: SYSTEM_DEFAULT_ANGEBOT_COLUMNS.map((c) => ({ ...c })),
      is_default: list.length === 0
    });
    setSelectedId(row.id);
  }, [companyId, createVorlage, list.length]);

  return (
    <div className='space-y-4'>
      <div>
        <h1 className='text-2xl font-bold'>Angebotsvorlagen</h1>
        <p className='text-muted-foreground mt-1 text-sm'>
          Tabellenschema für Angebote — Spalten, Typen und Breiten. Pro Angebot
          wird eine Kopie des Schemas beim Erstellen gespeichert.
        </p>
      </div>

      <div className='border-border flex h-[min(720px,calc(100vh-12rem))] min-h-[420px] overflow-hidden rounded-lg border'>
        <AngebotVorlagenPanel
          items={list}
          loading={isLoading}
          selectedId={selectedId}
          onSelect={(v) => setSelectedId(v.id)}
          onNew={() => void handleNew()}
        />
        <AngebotVorlageEditorPanel
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
                columns: args.columns,
                is_default: args.is_default
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
