/**
 * Supabase API for public.letters — mirrors angebote.api error handling (throw toQueryError).
 * Row mapping lives here (not in `database.types.ts`) because generated DB types are not
 * regenerated in this PR; duplicating the row shape avoids importing a stale `letters` table
 * type that would not exist until `bun run db:types` runs post-migration.
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';

import type {
  Letter,
  LetterInsert,
  LetterStatus,
  LetterUpdate
} from '../types';

function mapLetterFromDb(raw: Record<string, unknown>): Letter {
  return {
    id: String(raw.id),
    companyId: String(raw.company_id),
    letterNumber: raw.letter_number == null ? null : String(raw.letter_number),
    status: (raw.status === 'sent' ? 'sent' : 'draft') as LetterStatus,
    recipientCompany:
      raw.recipient_company == null ? null : String(raw.recipient_company),
    recipientSalutation:
      raw.recipient_salutation == null
        ? null
        : String(raw.recipient_salutation),
    recipientFirstName:
      raw.recipient_first_name == null
        ? null
        : String(raw.recipient_first_name),
    recipientLastName:
      raw.recipient_last_name == null ? null : String(raw.recipient_last_name),
    recipientStreet:
      raw.recipient_street == null ? null : String(raw.recipient_street),
    recipientZip: raw.recipient_zip == null ? null : String(raw.recipient_zip),
    recipientCity:
      raw.recipient_city == null ? null : String(raw.recipient_city),
    recipientCountry:
      raw.recipient_country == null ? null : String(raw.recipient_country),
    subject: raw.subject == null ? null : String(raw.subject),
    bodyHtml: raw.body_html == null ? null : String(raw.body_html),
    letterDate: String(raw.letter_date),
    createdBy: raw.created_by == null ? null : String(raw.created_by),
    createdAt: String(raw.created_at),
    updatedAt: String(raw.updated_at)
  };
}

function toInsertRow(payload: LetterInsert): Record<string, unknown> {
  return {
    company_id: payload.companyId,
    letter_number: payload.letterNumber ?? null,
    status: payload.status ?? 'draft',
    recipient_company: payload.recipientCompany ?? null,
    recipient_salutation: payload.recipientSalutation ?? null,
    recipient_first_name: payload.recipientFirstName ?? null,
    recipient_last_name: payload.recipientLastName ?? null,
    recipient_street: payload.recipientStreet ?? null,
    recipient_zip: payload.recipientZip ?? null,
    recipient_city: payload.recipientCity ?? null,
    recipient_country: payload.recipientCountry ?? null,
    subject: payload.subject ?? null,
    body_html: payload.bodyHtml ?? null,
    letter_date: payload.letterDate,
    created_by: payload.createdBy ?? null
  };
}

function toUpdateRow(patch: LetterUpdate): Record<string, unknown> {
  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };
  if (patch.letterNumber !== undefined) row.letter_number = patch.letterNumber;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.recipientCompany !== undefined)
    row.recipient_company = patch.recipientCompany;
  if (patch.recipientSalutation !== undefined)
    row.recipient_salutation = patch.recipientSalutation;
  if (patch.recipientFirstName !== undefined)
    row.recipient_first_name = patch.recipientFirstName;
  if (patch.recipientLastName !== undefined)
    row.recipient_last_name = patch.recipientLastName;
  if (patch.recipientStreet !== undefined)
    row.recipient_street = patch.recipientStreet;
  if (patch.recipientZip !== undefined) row.recipient_zip = patch.recipientZip;
  if (patch.recipientCity !== undefined)
    row.recipient_city = patch.recipientCity;
  if (patch.recipientCountry !== undefined)
    row.recipient_country = patch.recipientCountry;
  if (patch.subject !== undefined) row.subject = patch.subject;
  if (patch.bodyHtml !== undefined) row.body_html = patch.bodyHtml;
  if (patch.letterDate !== undefined) row.letter_date = patch.letterDate;
  return row;
}

export async function listLetters(): Promise<Letter[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('letters')
    .select('*')
    .order('letter_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw toQueryError(error);
  return (data ?? []).map((r) => mapLetterFromDb(r as Record<string, unknown>));
}

export async function getLetter(id: string): Promise<Letter> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('letters')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error(`Letter ${id} not found`);
  return mapLetterFromDb(data as Record<string, unknown>);
}

export async function createLetter(payload: LetterInsert): Promise<Letter> {
  const supabase = createClient();
  if (!payload.companyId) {
    throw new Error('companyId is required to create a letter.');
  }

  const { data, error } = await supabase
    .from('letters')
    .insert(toInsertRow(payload))
    .select('*')
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('Letter insert returned no row');
  return mapLetterFromDb(data as Record<string, unknown>);
}

export async function updateLetter(
  id: string,
  patch: LetterUpdate
): Promise<Letter> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('letters')
    .update(toUpdateRow(patch))
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error(`Letter ${id} not found after update`);
  return mapLetterFromDb(data as Record<string, unknown>);
}

export async function deleteLetter(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('letters').delete().eq('id', id);
  if (error) throw toQueryError(error);
}
