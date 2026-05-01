import {
  billingFamilyFromEmbed,
  isStandardVariantDisplayName
} from './format-billing-display-label';

/**
 * Minimal trip shape for resolving a passenger display label from persisted trip data
 * (optional billing embeds from Supabase selects).
 */
export interface TripWithBillingContext {
  client_name?: string | null;
  billing_variant?: {
    name?: string | null;
    billing_types?: {
      name?: string | null;
    } | null;
  } | null;
}

/**
 * Single source of truth for “who is this trip for?” in list/card/share copy when
 * `client_name` may be empty (e.g. Kostenträger that do not require a passenger name).
 */
export function resolvePassengerLabel(trip: TripWithBillingContext): string {
  // Saved passenger name wins whenever the trip stores one — it is what drivers/admins entered.
  const fromClient = trip.client_name?.trim();
  if (fromClient) return fromClient;

  // Unterart (billing variant): skip empty and the DB sentinel "Standard" (same rule as formatBillingDisplayLabel).
  const variantName = trip.billing_variant?.name?.trim();
  const fromVariant =
    variantName && !isStandardVariantDisplayName(variantName)
      ? variantName
      : undefined;
  if (fromVariant) return fromVariant;

  // Abrechnungsfamilie — normalise PostgREST object vs one-element array via billingFamilyFromEmbed.
  const fromFamily = billingFamilyFromEmbed(
    trip.billing_variant?.billing_types
  )?.name?.trim();
  if (fromFamily) return fromFamily;

  // Guarantees a non-empty German label everywhere we render or copy trip text.
  return 'Unbekannter Fahrgast';
}
