import type {
  AngebotColumnDef,
  AngebotColumnType
} from '../types/angebot.types';

export type AngebotColumnPreset =
  | 'beschreibung'
  | 'betrag'
  | 'preis_km'
  | 'notiz'
  | 'anzahl'
  | 'percent';

export interface AngebotColumnLayoutSpec {
  width:
    | { mode: 'fill' }
    | { mode: 'fixed'; pt: number }
    | { mode: 'auto'; flex: number };
  align: 'left' | 'right' | 'center';
  pdfRenderType:
    | 'text'
    | 'integer'
    | 'currency'
    | 'currency_per_km'
    | 'percent';
  inputStep?: number;
  inputMin?: number;
  inputMax?: number;
}

export const COLUMN_PRESET_SPECS: Record<
  AngebotColumnPreset,
  AngebotColumnLayoutSpec
> = {
  beschreibung: {
    width: { mode: 'fill' },
    align: 'left',
    pdfRenderType: 'text'
  },
  betrag: {
    width: { mode: 'fixed', pt: 80 },
    align: 'right',
    pdfRenderType: 'currency',
    inputStep: 0.01,
    inputMin: 0
  },
  preis_km: {
    width: { mode: 'fixed', pt: 80 },
    align: 'right',
    pdfRenderType: 'currency_per_km',
    inputStep: 0.01,
    inputMin: 0
  },
  notiz: {
    width: { mode: 'auto', flex: 2 },
    align: 'left',
    pdfRenderType: 'text'
  },
  anzahl: {
    width: { mode: 'fixed', pt: 48 },
    align: 'right',
    pdfRenderType: 'integer',
    inputStep: 1,
    inputMin: 0
  },
  percent: {
    width: { mode: 'fixed', pt: 60 },
    align: 'right',
    pdfRenderType: 'percent',
    inputStep: 0.1,
    inputMin: 0,
    inputMax: 100
  }
};

export const COLUMN_PRESET_UI: Record<
  AngebotColumnPreset,
  {
    label: string;
    emoji: string;
    description: string;
    adminSelectable: boolean;
  }
> = {
  beschreibung: {
    label: 'Beschreibung',
    emoji: '📝',
    description: 'Links ausgerichtet, füllt den restlichen Platz.',
    adminSelectable: true
  },
  betrag: {
    label: 'Betrag (€)',
    emoji: '💶',
    description: 'Rechts ausgerichtet, feste Breite 80pt.',
    adminSelectable: true
  },
  preis_km: {
    label: 'Preis / km',
    emoji: '📍',
    description: 'Rechts ausgerichtet, feste Breite 80pt.',
    adminSelectable: true
  },
  notiz: {
    label: 'Notiz',
    emoji: '💬',
    description: 'Links ausgerichtet, mittlere automatische Breite (flex 2).',
    adminSelectable: true
  },
  anzahl: {
    label: 'Anzahl',
    emoji: '#',
    description: 'Rechts ausgerichtet, feste Breite 48pt.',
    adminSelectable: true
  },
  percent: {
    label: 'Prozent',
    emoji: '%',
    description: 'Rechts ausgerichtet, feste Breite 60pt (Legacy).',
    adminSelectable: false
  }
};

export function defaultHeaderForPreset(preset: AngebotColumnPreset): string {
  switch (preset) {
    case 'beschreibung':
      return 'Beschreibung';
    case 'betrag':
      return 'Betrag (€)';
    case 'preis_km':
      return 'Preis / km';
    case 'notiz':
      return 'Notiz';
    case 'anzahl':
      return 'Anzahl';
    case 'percent':
      return 'Prozent';
  }
}

export function resolveColumnLayout(
  col: AngebotColumnDef
): AngebotColumnLayoutSpec {
  // All callers must use this function — never switch on col.preset directly for layout or formatting.
  return COLUMN_PRESET_SPECS[col.preset];
}

export const LEGACY_TYPE_TO_PRESET: Record<string, AngebotColumnPreset> = {
  currency: 'betrag',
  currency_per_km: 'preis_km',
  integer: 'anzahl',
  percent: 'percent'
};

function clampHeader20(header: string): string {
  const h = header.trim();
  if (!h) return h;
  return h.length <= 20 ? h : h.slice(0, 20);
}

/**
 * Normalizes a raw column object from the DB that may still contain legacy fields:
 * { type, weight, minWidth }. Converts into the stored preset shape.
 */
export function normalizeLegacyColumn(raw: unknown): AngebotColumnDef {
  const rec =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const id = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : '';
  const headerRaw =
    typeof rec.header === 'string' && rec.header.trim()
      ? rec.header.trim()
      : '';

  // Already migrated?
  const presetRaw = rec.preset;
  if (typeof presetRaw === 'string') {
    const preset = presetRaw as AngebotColumnPreset;
    if (preset in COLUMN_PRESET_SPECS) {
      return {
        id,
        header: clampHeader20(headerRaw),
        preset,
        required: rec.required === true ? true : undefined,
        formula:
          rec.formula === null
            ? null
            : typeof rec.formula === 'string'
              ? rec.formula
              : undefined
      };
    }
  }

  const legacyType = rec.type as AngebotColumnType | undefined;
  const weight = typeof rec.weight === 'number' ? rec.weight : null;

  let preset: AngebotColumnPreset = 'notiz';
  if (legacyType === 'text') {
    preset = (weight ?? 0) >= 3 ? 'beschreibung' : 'notiz';
  } else if (
    typeof legacyType === 'string' &&
    legacyType in LEGACY_TYPE_TO_PRESET
  ) {
    preset = LEGACY_TYPE_TO_PRESET[String(legacyType)];
  }

  return {
    id,
    header: clampHeader20(headerRaw || defaultHeaderForPreset(preset)),
    preset,
    required: rec.required === true ? true : undefined,
    formula:
      rec.formula === null
        ? null
        : typeof rec.formula === 'string'
          ? rec.formula
          : undefined
  };
}
