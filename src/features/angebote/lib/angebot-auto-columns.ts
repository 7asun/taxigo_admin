import type { AngebotColumnDef } from '../types/angebot.types';

/**
 * The "Pos." column is always injected as the first column at render time.
 * It is NEVER stored in angebot_vorlagen.columns or table_schema_snapshot.
 * It is auto-numbered from the row's index (1-based) and requires no user input.
 */
export const ANGEBOT_POSITION_COLUMN_ID = 'col_position' as const;

// Pos. column — fixed 28pt (calibrated 2026-04-15, was 48pt). Fits 2-digit integers with right alignment. Injected at render time only, never stored.
export const ANGEBOT_POSITION_COLUMN: AngebotColumnDef = {
  id: ANGEBOT_POSITION_COLUMN_ID,
  header: 'Pos.',
  preset: 'anzahl',
  required: false
};
