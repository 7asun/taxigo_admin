/**
 * angebot.types.ts
 *
 * TypeScript types for the Angebote (Offers) module.
 * Mirrors the shape of the angebote + angebot_line_items DB tables.
 */

export type AngebotStatus = 'draft' | 'sent' | 'accepted' | 'declined';

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
  pdf_column_override: AngebotColumnProfile | null;
  created_at: string;
  updated_at: string;
}

export interface AngebotLineItemRow {
  id: string;
  angebot_id: string;
  position: number;
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

/** Column keys for Angebot PDF tables. Fixed set for now — no Vorlagen system yet. */
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

/** The standard 5-column preset used until a full Vorlagen system is built. */
export const ANGEBOT_STANDARD_COLUMN_PROFILE: AngebotColumnProfile = {
  columns: [
    'position',
    'leistung',
    'anfahrtkosten',
    'price_first_5km',
    'price_per_km_after_5'
  ]
};

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
  pdf_column_override?: AngebotColumnProfile | null;
  line_items: Omit<AngebotLineItemRow, 'id' | 'angebot_id' | 'created_at'>[];
}

/** Payload for updating an existing Angebot. */
export type UpdateAngebotPayload = Partial<
  Omit<
    AngebotRow,
    'id' | 'company_id' | 'angebot_number' | 'created_at' | 'updated_at'
  >
>;
