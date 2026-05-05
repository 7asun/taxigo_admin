/**
 * Server-only: geocodes recurring-rule address lines for Plan C coordinate
 * stabilisation. Import only from Server Actions or Route Handlers — not from
 * client components (`GOOGLE_MAPS_API_KEY` is server-side).
 */
import { geocodeAddressLineToStructured } from '@/lib/google-geocoding';

export interface RuleCoordinates {
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
}

/**
 * WHY: geocode rule addresses once at save time so the cron can use
 * stable coordinates across runs. Returns null for any leg that fails
 * to resolve — the cron will fall back to live geocoding for null legs.
 * Failures are logged but never throw — a geocoding failure must not
 * block a rule from being saved.
 */
export async function geocodeRuleAddresses(
  pickupAddress: string,
  dropoffAddress: string
): Promise<RuleCoordinates> {
  const [pickup, dropoff] = await Promise.allSettled([
    geocodeAddressLineToStructured(pickupAddress.trim()),
    geocodeAddressLineToStructured(dropoffAddress.trim())
  ]);

  const pickupResult = pickup.status === 'fulfilled' ? pickup.value : null;
  const dropoffResult = dropoff.status === 'fulfilled' ? dropoff.value : null;

  if (pickup.status === 'rejected') {
    console.error('[plan-c] Failed to geocode pickup address for rule', {
      address: pickupAddress,
      error: pickup.reason
    });
  }
  if (dropoff.status === 'rejected') {
    console.error('[plan-c] Failed to geocode dropoff address for rule', {
      address: dropoffAddress,
      error: dropoff.reason
    });
  }

  return {
    pickup_lat: pickupResult?.lat ?? null,
    pickup_lng: pickupResult?.lng ?? null,
    dropoff_lat: dropoffResult?.lat ?? null,
    dropoff_lng: dropoffResult?.lng ?? null
  };
}
