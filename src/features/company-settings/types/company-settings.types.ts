/**
 * company-settings.types.ts
 *
 * TypeScript interfaces and Zod validation schemas for the
 * company_profiles table. This is the legal/financial identity
 * of the Taxi company (Leistungserbringer) used on all invoices.
 *
 * Keep this file in sync with the DB migrations:
 *   supabase/migrations/20260331110000_create_company_profiles.sql
 *   supabase/migrations/20260401120000_company_profiles_phone_slogan_inhaber.sql
 *   supabase/migrations/20260401140000_company_profiles_email_website.sql
 *
 * Used by:
 *   - company-settings.api.ts   (Supabase queries)
 *   - use-company-settings.ts   (React Query hook)
 *   - company-settings-form.tsx (form validation)
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Raw DB row — mirrors the company_profiles table exactly.
// ---------------------------------------------------------------------------

export interface CompanyProfile {
  id: string;
  company_id: string;

  // Legal identity
  legal_name: string;

  // Postal address (all required for valid German invoices §14 UStG)
  street: string;
  street_number: string;
  zip_code: string;
  city: string;

  // Tax identifiers — at least one must be set for valid invoices
  tax_id: string | null; // Steuernummer (e.g. "123/456/78901")
  vat_id: string | null; // USt-IdNr (e.g. "DE123456789")

  // Bank details — printed in invoice footer for Überweisung payments
  bank_name: string | null;
  bank_iban: string | null;
  bank_bic: string | null;

  // Branding & Kontakt (Rechnung PDF)
  logo_url: string | null; // Supabase Storage URL
  slogan: string | null;
  phone: string | null;
  inhaber: string | null;
  email: string | null;
  website: string | null;

  // Invoice defaults
  default_payment_days: number; // Zahlungsziel in days (default: 14)

  // Timestamps
  created_at: string;
  updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Zod schema — used by the settings form (React Hook Form + zodResolver).
//
// Validation rules:
//   - Street address fields: required, non-empty
//   - Tax IDs: optional individually, but at least one is recommended
//     (enforced as a soft warning in the UI, not a hard schema error,
//      because Supabase allows both to be null in the DB)
//   - IBAN: basic format check (DE + 20 chars or other EU format)
//   - payment_days: 1–90 range (practical limits for Zahlungsziel)
// ---------------------------------------------------------------------------

export const companyProfileSchema = z.object({
  legal_name: z
    .string()
    .min(1, 'Firmenname ist erforderlich')
    .max(200, 'Firmenname ist zu lang'),

  // ── Postal address ──────────────────────────────────────────────────────
  street: z.string().min(1, 'Straße ist erforderlich'),

  street_number: z.string().min(1, 'Hausnummer ist erforderlich'),

  zip_code: z
    .string()
    .min(4, 'Ungültige Postleitzahl')
    .max(10, 'Ungültige Postleitzahl'),

  city: z.string().min(1, 'Stadt ist erforderlich'),

  // ── Tax identifiers ──────────────────────────────────────────────────────
  // NOTE: Use .nullable() only (not .optional()) so the inferred type is
  // `string | null`, matching the explicit null values in form defaultValues.
  // Adding .optional() would produce `string | null | undefined` which breaks
  // the React Hook Form + zodResolver type contract.
  tax_id: z
    .string()
    .max(30, 'Steuernummer zu lang')
    .nullable()
    .transform((v) => v?.trim() || null),

  vat_id: z
    .string()
    .max(20, 'USt-IdNr zu lang')
    .nullable()
    .transform((v) => v?.trim() || null),

  // ── Bank details ─────────────────────────────────────────────────────────
  bank_name: z
    .string()
    .max(100)
    .nullable()
    .transform((v) => v?.trim() || null),

  bank_iban: z
    .string()
    .max(40)
    .nullable()
    .transform((v) => v?.trim().replace(/\s/g, '') || null), // strip spaces

  bank_bic: z
    .string()
    .max(15)
    .nullable()
    .transform((v) => v?.trim().toUpperCase() || null),

  // ── Branding & Kontakt ───────────────────────────────────────────────────
  // logo_url is managed separately via file upload; not part of the text form
  logo_url: z.string().nullable(),

  slogan: z
    .string()
    .max(280, 'Slogan ist zu lang')
    .nullable()
    .transform((v) => v?.trim() || null),

  phone: z
    .string()
    .max(40, 'Telefonnummer zu lang')
    .nullable()
    .transform((v) => v?.trim() || null),

  inhaber: z
    .string()
    .max(120, 'Name zu lang')
    .nullable()
    .transform((v) => v?.trim() || null),

  email: z.preprocess(
    (v) => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string' && v.trim() === '') return null;
      return v;
    },
    z.union([z.string().max(120).email('Ungültige E-Mail'), z.null()])
  ),

  website: z
    .string()
    .max(200)
    .nullable()
    .transform((v) => v?.trim() || null),

  // ── Invoice defaults ──────────────────────────────────────────────────────
  // NOTE: No .default() here — that makes the inferred input type `number | undefined`,
  // breaking React Hook Form's type contract. The 14-day default lives in useForm({ defaultValues })
  default_payment_days: z
    .number({ message: 'Bitte eine Zahl eingeben' })
    .int('Muss eine ganze Zahl sein')
    .min(1, 'Mindestens 1 Tag')
    .max(90, 'Maximal 90 Tage')
});

/** Inferred form value type from the Zod schema. */
export type CompanyProfileFormValues = z.infer<typeof companyProfileSchema>;

/** Payload sent to the API on save — same shape as form values. */
export type CompanyProfileUpsertPayload = CompanyProfileFormValues;
