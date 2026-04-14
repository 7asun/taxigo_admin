/** Stable ids for legacy 5-column offers; must match supabase/migrations/20260413120000_angebot_flexible_table.sql */
export const ANGEBOT_LEGACY_COLUMN_IDS = {
  leistung: 'col_leistung',
  anfahrtkosten: 'col_anfahrtkosten',
  price_first_5km: 'col_price_first_5km',
  price_per_km_after_5: 'col_price_per_km_after_5',
  notes: 'col_notes'
} as const;
