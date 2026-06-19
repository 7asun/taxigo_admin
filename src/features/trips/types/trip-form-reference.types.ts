/**
 * Shared shapes for trip forms and filter bars (payers, drivers, billing variants).
 * Kept separate from hooks so API modules and TanStack Query layers can import safely.
 */

export interface PayerOption {
  id: string;
  name: string;
  /** Kostenträger KTS default; NULL = unset in cascade. */
  kts_default: boolean | null;
  /** NULL = unset in no_invoice cascade. */
  no_invoice_required_default: boolean | null;
  /** When true, trip forms show the Reha-Schein switch (`payers.reha_schein_enabled`). */
  reha_schein_enabled: boolean;
  /**
   * When true, recurring-rule forms show pickup_station / dropoff_station as required
   * route/passenger fields. Payer flag controls visibility only — not billing metadata.
   */
  recurring_rules_station_enabled: boolean;
}

/**
 * One billing variant for trip UI; behavior + color come from the parent `billing_types` row
 * (same trip defaults as the Kostenträger behavior dialog).
 */
export interface BillingVariantOption {
  id: string;
  name: string;
  /** Stable CSV / export key; unique per family — see `docs/billing-families-variants.md`. */
  code: string;
  sort_order: number;
  billing_type_id: string;
  billing_type_name: string;
  color: string;
  behavior_profile?: unknown;
  /** Unterart-level KTS; NULL = inherit. */
  kts_default: boolean | null;
  /** Unterart-level „keine Rechnung“; NULL = inherit. */
  no_invoice_required_default: boolean | null;
}

export type FremdfirmaPaymentMode =
  | 'cash_per_trip'
  | 'monthly_invoice'
  | 'self_payer'
  | 'kts_to_fremdfirma';

export interface FremdfirmaOption {
  id: string;
  name: string;
  number: string | null;
  default_payment_mode: FremdfirmaPaymentMode;
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
  kts_patient_id: string | null;
}
