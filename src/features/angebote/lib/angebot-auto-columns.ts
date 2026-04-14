import type { AngebotColumnDef } from '../types/angebot.types';

/**
 * The "Pos." column is always injected as the first column at render time.
 * It is NEVER stored in angebot_vorlagen.columns or table_schema_snapshot.
 * It is auto-numbered from the row's index (1-based) and requires no user input.
 */
export const ANGEBOT_POSITION_COLUMN_ID = 'col_position' as const;

// Pos. column — injected at render time only, never stored. Uses anzahl preset: fixed 48pt.
// Note: previous minWidth was 32pt — +16pt visual delta on existing offers is accepted per product decision 2026-04-14.
export const ANGEBOT_POSITION_COLUMN: AngebotColumnDef = {
  id: ANGEBOT_POSITION_COLUMN_ID,
  header: 'Pos.',
  preset: 'anzahl',
  required: false
};
