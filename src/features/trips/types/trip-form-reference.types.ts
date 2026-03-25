/**
 * Shared shapes for trip forms and filter bars (payers, drivers, billing types).
 * Kept separate from hooks so API modules and TanStack Query layers can import safely.
 */

export interface PayerOption {
  id: string;
  name: string;
}

export interface BillingTypeOption {
  id: string;
  name: string;
  color: string;
  payer_id: string;
  behavior_profile?: unknown;
}

export interface DriverOption {
  id: string;
  name: string;
}

export interface ClientOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  is_company: boolean;
  phone: string | null;
  phone_secondary: string | null;
  email: string | null;
  street: string;
  street_number: string;
  zip_code: string;
  city: string;
  is_wheelchair?: boolean;
}
