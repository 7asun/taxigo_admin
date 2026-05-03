/**
 * Letters feature types — inline definitions until database.types.ts is regenerated
 * after the letters migration is applied everywhere.
 */

export type LetterStatus = 'draft' | 'sent';

/** Controlled composer fields — owned by `LetterBuilder` step components. */
export interface LetterFormValues {
  letterDate: string;
  letterNumber: string;
  status: LetterStatus;
  subject: string;
  recipientCompany: string;
  recipientSalutation: string;
  recipientFirstName: string;
  recipientLastName: string;
  recipientStreet: string;
  recipientZip: string;
  recipientCity: string;
  recipientCountry: string;
  bodyHtml: string;
}

export interface LetterRecipient {
  recipientCompany?: string | null;
  recipientSalutation?: string | null;
  recipientFirstName?: string | null;
  recipientLastName?: string | null;
  recipientStreet?: string | null;
  recipientZip?: string | null;
  recipientCity?: string | null;
  recipientCountry?: string | null;
}

export interface Letter extends LetterRecipient {
  id: string;
  companyId: string;
  letterNumber?: string | null;
  status: LetterStatus;
  subject?: string | null;
  bodyHtml?: string | null;
  letterDate: string;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload for creating a letter (server assigns id/timestamps). */
export interface LetterInsert extends LetterRecipient {
  companyId: string;
  letterNumber?: string | null;
  status?: LetterStatus;
  subject?: string | null;
  bodyHtml?: string | null;
  letterDate: string;
  createdBy?: string | null;
}

/** Partial update (PATCH); omits companyId — tenant is immutable. */
export type LetterUpdate = Partial<Omit<LetterInsert, 'companyId'>>;
