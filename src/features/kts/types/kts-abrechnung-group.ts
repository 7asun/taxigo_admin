import type { AbrechnungGroupStatus } from '@/lib/kts-status';

export type { AbrechnungGroupStatus };

/** Row shape returned by get_kts_abrechnung_groups RPC. */
export interface KtsAbrechnungGroup {
  kts_belegnummer: string;
  trip_count: number;
  gesamtbetrag: number;
  eigenanteil_gesamt: number;
  earliest_trip: string | null;
  latest_trip: string | null;
  import_id: string | null;
  source_filename: string | null;
  imported_at: string | null;
  import_count: number;
  has_multiple_imports: boolean;
  group_status: AbrechnungGroupStatus;
}

/** Trip slice loaded client-side in Abrechnung expand rows. */
export interface AbrechnungTripRow {
  id: string;
  scheduled_at: string | null;
  client_name: string | null;
  kts_patient_id: string | null;
  kts_invoice_amount: number | null;
  kts_eigenanteil: number | null;
  kts_status: AbrechnungGroupStatus | null;
  kts_ruecklaufer_reason: string | null;
}
