/**
 * Resolves the column schema for an Angebot (PDF + detail UI) from snapshot / legacy override / defaults.
 */

import { ANGEBOT_LEGACY_COLUMN_IDS } from '@/features/angebote/lib/angebot-legacy-column-ids';
import { ANGEBOT_COLUMN_MAP } from '@/features/angebote/components/angebot-pdf/angebot-pdf-columns';
import { LEGACY_TYPE_TO_PRESET } from '@/features/angebote/lib/angebot-column-presets';
import type {
  AngebotColumnDef,
  AngebotColumnKey,
  AngebotColumnProfile
} from '@/features/angebote/types/angebot.types';
import type { AngebotPdfCatalogColumnDef } from '@/features/angebote/components/angebot-pdf/angebot-pdf-columns';
import { ANGEBOT_POSITION_COLUMN_ID } from '@/features/angebote/lib/angebot-auto-columns';

function catalogFormatToPreset(
  format: AngebotPdfCatalogColumnDef['format'],
  defaultTextPreset: 'beschreibung' | 'notiz' = 'beschreibung'
): AngebotColumnDef['preset'] {
  if (format === 'integer') return 'anzahl';
  if (format === 'currency') return LEGACY_TYPE_TO_PRESET.currency;
  if (format === 'currency_per_km')
    return LEGACY_TYPE_TO_PRESET.currency_per_km;
  return defaultTextPreset;
}

function angebotKeyToSchemaColumnId(key: AngebotColumnKey): string {
  switch (key) {
    case 'position':
      return ANGEBOT_POSITION_COLUMN_ID;
    case 'leistung':
      return ANGEBOT_LEGACY_COLUMN_IDS.leistung;
    case 'anfahrtkosten':
      return ANGEBOT_LEGACY_COLUMN_IDS.anfahrtkosten;
    case 'price_first_5km':
      return ANGEBOT_LEGACY_COLUMN_IDS.price_first_5km;
    case 'price_per_km_after_5':
      return ANGEBOT_LEGACY_COLUMN_IDS.price_per_km_after_5;
    case 'notes':
      return ANGEBOT_LEGACY_COLUMN_IDS.notes;
  }
}

/** Maps a legacy stored column-key profile to dynamic schema defs (stable ids + catalog labels). */
export function profileToAngebotColumnDefs(
  profile: AngebotColumnProfile
): AngebotColumnDef[] {
  return profile.columns.map((key) => {
    const cat = ANGEBOT_COLUMN_MAP[key];
    return {
      id: angebotKeyToSchemaColumnId(key),
      header: cat.label,
      preset: catalogFormatToPreset(
        cat.format,
        key === 'leistung' ? 'beschreibung' : 'notiz'
      ),
      required: false
    };
  });
}
