/**
 * Single assembly point for a `Letter` row shape used by:
 * - live `usePDF` preview
 * - one-shot PDF download (`pdf().toBlob()` in `LetterBuilder`)
 * - save payloads (same trimmed fields as before the builder split)
 */

import type { Letter, LetterFormValues } from '../types';

const PLACEHOLDER_LETTER_ID = '00000000-0000-4000-8000-000000000000';

export interface BuildDraftLetterContext {
  companyId: string;
  /** Loaded row in edit mode; null in create mode. */
  existing: Letter | null;
}

export function buildDraftLetter(
  values: LetterFormValues,
  ctx: BuildDraftLetterContext
): Letter {
  const { existing, companyId } = ctx;
  const id = existing?.id ?? PLACEHOLDER_LETTER_ID;
  return {
    id,
    companyId,
    letterNumber: values.letterNumber.trim() || null,
    status: values.status,
    subject: values.subject.trim() || null,
    bodyHtml: values.bodyHtml,
    letterDate: values.letterDate,
    recipientCompany: values.recipientCompany.trim() || null,
    recipientSalutation: values.recipientSalutation.trim() || null,
    recipientFirstName: values.recipientFirstName.trim() || null,
    recipientLastName: values.recipientLastName.trim() || null,
    recipientStreet: values.recipientStreet.trim() || null,
    recipientZip: values.recipientZip.trim() || null,
    recipientCity: values.recipientCity.trim() || null,
    recipientCountry: values.recipientCountry.trim() || null,
    createdBy: existing?.createdBy ?? null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: existing?.updatedAt ?? new Date().toISOString()
  };
}
