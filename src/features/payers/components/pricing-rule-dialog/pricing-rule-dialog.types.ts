import type {
  PricingStrategy,
  WeekdayKey
} from '@/features/invoices/types/pricing.types';
import type {
  BillingPricingRuleRow,
  PricingRuleScope
} from '@/features/payers/api/billing-pricing-rules.api';

export const WEEKDAY_ORDER: WeekdayKey[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun'
];

export const WEEKDAY_LABEL: Record<WeekdayKey, string> = {
  mon: 'Montag',
  tue: 'Dienstag',
  wed: 'Mittwoch',
  thu: 'Donnerstag',
  fri: 'Freitag',
  sat: 'Samstag',
  sun: 'Sonntag'
};

export const STRATEGY_DESCRIPTION: Record<PricingStrategy, string> = {
  tiered_km: 'Preis je km-Staffel — günstigere Rate ab bestimmter Strecke',
  fixed_below_threshold_then_km: 'Pauschal bis X km, danach km-Staffeln',
  time_based: 'Pauschalpreis außerhalb definierter Arbeitszeiten',
  client_price_tag: 'Fester Brutto-Preis direkt am Fahrgast hinterlegt',
  manual_trip_price: 'Preis wird manuell je Fahrt eingetragen',
  no_price: 'Keine Preisermittlung — Fahrt wird nicht berechnet'
};

export interface KmTierFormValue {
  from_km: number;
  to_km: number | null;
  price_per_km: number;
}

export interface DaySlotFormValue {
  enabled: boolean;
  start: string;
  end: string;
}

export type DaysForm = Record<WeekdayKey, DaySlotFormValue>;

export interface PricingRuleFormValues {
  strategy: PricingStrategy;
  /** Optional net Anfahrtspreis — merged into rule `config` for all strategies (resolver applies per cascade). */
  approach_fee_net: number | null;
  tiers: KmTierFormValue[];
  threshold_km: number;
  fixed_price: number;
  km_tiers: KmTierFormValue[];
  fixed_fee: number;
  holiday_rule: 'closed' | 'normal';
  holidays: string[];
  days: DaysForm;
}

export interface PricingRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Fixed scope for dialogs opened from Kostenträger / Familie / Unterart sheets.
   * Pass null when opening from the global Preisregeln page — triggers the
   * scope picker in Step 2.
   */
  scope: PricingRuleScope | null;
  /** Rule being edited, or null for create mode. */
  editing: BillingPricingRuleRow | null;
  /** Called after a successful save or price tag write. */
  onSaved: () => void;
  /**
   * Pre-selects a strategy in Step 1 (create only).
   * Used by pricing-rules-page.tsx "Bearbeiten" on client rows to open
   * directly into client_price_tag mode.
   */
  initialStrategy?: PricingStrategy;
  /**
   * Pre-selects a Fahrgast for the client_price_tag flow (create only).
   * Populated when editing a client row from the pricing page table.
   */
  initialClientId?: string | null;
}
