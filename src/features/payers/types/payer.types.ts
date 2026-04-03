export interface BillingTypeBehavior {
  returnPolicy: 'none' | 'time_tbd' | 'exact';
  lockReturnMode: boolean;
  lockPickup: boolean;
  lockDropoff: boolean;
  prefillDropoffFromPickup: boolean;
  requirePassenger: boolean;
  /** When true (Fahrgast flow), Abhol-Station per passenger is required on create. */
  requirePickupStation: boolean;
  /** When true (Fahrgast flow), Ziel-Station per passenger is required on create. */
  requireDropoffStation: boolean;
  /**
   * When true, Neue Fahrt shows optional `billing_calling_station` + `billing_betreuer` in Kostenträger.
   * Distinct from passenger pickup/dropoff_station (route stops).
   */
  askCallingStationAndBetreuer?: boolean;
  /** KTS default for all Unterarten in this Familie unless variant sets `kts_default`. */
  kts_default?: 'yes' | 'no' | 'unset';
  // Legacy single-string defaults (kept for backward compatibility)
  defaultPickup?: string | null;
  defaultDropoff?: string | null;
  // Structured defaults for better prefilling
  defaultPickupStreet?: string | null;
  defaultPickupStreetNumber?: string | null;
  defaultPickupZip?: string | null;
  defaultPickupCity?: string | null;
  defaultDropoffStreet?: string | null;
  defaultDropoffStreetNumber?: string | null;
  defaultDropoffZip?: string | null;
  defaultDropoffCity?: string | null;
}

/**
 * One Abrechnungsfamilie — row in `billing_types` (behavior + color live here).
 * Table name stays legacy `billing_types`; conceptually this is the family, not the CSV leaf.
 */
export interface BillingFamily {
  id: string;
  payer_id: string;
  name: string;
  color: string;
  behavior_profile: BillingTypeBehavior;
  created_at: string;
}

/** Unterart row under `billing_types`; `code` is stable for CSV / future invoicing. */
export interface BillingVariant {
  id: string;
  billing_type_id: string;
  name: string;
  code: string;
  sort_order: number;
  created_at: string;
  /** NULL = inherit from familie / payer cascade. */
  kts_default?: boolean | null;
}

/** Admin tree: `billing_types` rows with nested variants (sorted in the service). */
export interface BillingFamilyWithVariants extends BillingFamily {
  billing_variants: BillingVariant[];
}

export interface Payer {
  id: string;
  company_id: string;
  name: string;
  number: string;
  created_at: string;
  /** NULL = inherit (only variant + familie apply). */
  kts_default?: boolean | null;
}

export interface PayerWithBillingCount extends Payer {
  /** Count of Abrechnungsfamilien (`billing_types` rows, not individual variants). */
  billing_types: { count: number }[];
}
