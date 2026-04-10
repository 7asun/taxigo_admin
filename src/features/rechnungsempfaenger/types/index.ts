/**
 * Rechnungsempfänger feature types — re-export DB-aligned shapes from the service layer.
 * Keeps `api/` as the Supabase boundary; components import from here or the service.
 */
export type {
  RechnungsempfaengerRow,
  RechnungsempfaengerInsert,
  RechnungsempfaengerUpdate
} from '../api/rechnungsempfaenger.service';
