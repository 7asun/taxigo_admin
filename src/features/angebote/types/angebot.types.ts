/**
 * angebot.types.ts
 *
 * TypeScript types for the Angebote (Offers) module.
 * Mirrors the shape of the angebote + angebot_line_items DB tables.
 */

import { z } from 'zod';

export type AngebotStatus = 'draft' | 'sent' | 'accepted' | 'declined';

import type { AngebotColumnPreset } from '../lib/angebot-column-presets';

/**
 * @deprecated — removed from stored schema; exists only for legacy normalization.
 * Remove after migration verified on all environments.
 */
export type AngebotColumnType =
  | 'text'
  | 'integer'
  | 'currency'
  | 'currency_per_km'
  | 'percent';

const angebotColumnPresetSchema = z.enum([
  'beschreibung',
  'betrag',
  'preis_km',
  'notiz',
  'anzahl',
  'percent'
]);

export const angebotColumnDefSchema = z.object({
  id: z.string().min(1),
  header: z.string().max(20),
  preset: angebotColumnPresetSchema,
  required: z.boolean().optional(),
  /** Reserved for Phase 2b+ calculated columns. Not evaluated in Phase 2a — store null. */
  formula: z.string().nullable().optional()
});

export const angebotColumnDefArraySchema = z.array(angebotColumnDefSchema);

/**
 * Column definition in an offer table template or frozen snapshot.
 *
 * Stored shape — never contains type/weight/minWidth after migration. Those are derived at runtime via resolveColumnLayout.
 *
 * @property formula - Reserved for Phase 2b+ calculated columns. Not evaluated in Phase 2a — store null.
 */
export type AngebotColumnDef = z.infer<typeof angebotColumnDefSchema> & {
  preset: AngebotColumnPreset;
};

export interface AngebotVorlageRow {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  columns: AngebotColumnDef[];
  created_at: string;
  updated_at: string;
}

export interface AngebotVorlageCreatePayload {
  companyId: string;
  name: string;
  description?: string | null;
  /** When true, clears other defaults for the company after insert. */
  is_default?: boolean;
  columns: AngebotColumnDef[];
}

export interface AngebotVorlageUpdatePayload {
  name?: string;
  description?: string | null;
  columns?: AngebotColumnDef[];
  is_default?: boolean;
}

export interface AngebotRow {
  id: string;
  company_id: string;
  angebot_number: string;
  status: AngebotStatus;
  recipient_company: string | null;
  recipient_name: string | null;
  recipient_first_name: string | null;
  recipient_last_name: string | null;
  recipient_anrede: 'Herr' | 'Frau' | null;
  recipient_street: string | null;
  recipient_street_number: string | null;
  recipient_zip: string | null;
  recipient_city: string | null;
  recipient_email: string | null;
  recipient_phone: string | null;
  customer_number: string | null;
  subject: string | null;
  valid_until: string | null; // ISO date
  offer_date: string; // ISO date
  intro_text: string | null;
  outro_text: string | null;
  angebot_vorlage_id: string | null;
  /**
   * Frozen copy of angebot_vorlagen.columns written at creation time. Immutable after create — updateAngebot must never overwrite this field.
   */
  table_schema_snapshot: AngebotColumnDef[] | null;
  /**
   * @deprecated Use table_schema_snapshot. Only present on offers created before Phase 2a migration.
   */
  pdf_column_override: AngebotColumnProfile | null;
  created_at: string;
  updated_at: string;
}

export interface AngebotLineItemRow {
  id: string;
  angebot_id: string;
  position: number;
  /** Keys are {@link AngebotColumnDef.id} from the parent offer snapshot. */
  data: Record<string, string | number | null>;
  leistung: string;
  anfahrtkosten: number | null;
  price_first_5km: number | null;
  price_per_km_after_5: number | null;
  notes: string | null;
  created_at: string;
}

export interface AngebotWithLineItems extends AngebotRow {
  line_items: AngebotLineItemRow[];
}

/** Column keys for Angebot PDF tables (legacy profile). Fixed set — maps to typed line-item fields. */
export type AngebotColumnKey =
  | 'position'
  | 'leistung'
  | 'anfahrtkosten'
  | 'price_first_5km'
  | 'price_per_km_after_5'
  | 'notes';

/** Column profile for Angebot PDFs. Simplified vs invoice PdfColumnProfile — single columns array. */
export interface AngebotColumnProfile {
  columns: AngebotColumnKey[];
}

/*
 * Legacy fallback. Used by AngebotPdfDocument when table_schema_snapshot is null (pre-Phase-2a offers). Do not remove until all offers have a snapshot.
 */
export const ANGEBOT_STANDARD_COLUMN_PROFILE: AngebotColumnProfile = {
  columns: [
    'position',
    'leistung',
    'anfahrtkosten',
    'price_first_5km',
    'price_per_km_after_5'
  ]
};

/** One persisted line row for create / replace APIs — `data` is the source of truth for new rows. */
export interface AngebotLineItemPayload {
  position: number;
  data: Record<string, string | number | null>;
}

/** Payload for creating a new Angebot (header + line items). */
export interface CreateAngebotPayload {
  companyId: string;
  recipient_company?: string | null;
  recipient_first_name?: string | null;
  recipient_last_name?: string | null;
  recipient_name?: string | null;
  recipient_anrede?: 'Herr' | 'Frau' | null;
  recipient_street?: string | null;
  recipient_street_number?: string | null;
  recipient_zip?: string | null;
  recipient_city?: string | null;
  recipient_email?: string | null;
  recipient_phone?: string | null;
  customer_number?: string | null;
  subject?: string | null;
  valid_until?: string | null;
  offer_date: string;
  intro_text?: string | null;
  outro_text?: string | null;
  angebotVorlageId?: string | null;
  tableSchemaSnapshot: AngebotColumnDef[];
  line_items: AngebotLineItemPayload[];
}

/**
 * Payload for updating an existing Angebot.
 * Template id, snapshot, and pdf_column_override are intentionally omitted — they are immutable after create (Phase 2a).
 */
export type UpdateAngebotPayload = Partial<
  Omit<
    AngebotRow,
    | 'id'
    | 'company_id'
    | 'angebot_number'
    | 'created_at'
    | 'updated_at'
    | 'angebot_vorlage_id'
    | 'table_schema_snapshot'
    | 'pdf_column_override'
  >
>;
