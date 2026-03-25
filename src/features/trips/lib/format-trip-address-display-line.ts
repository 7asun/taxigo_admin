/**
 * Single canonical line for `pickup_address` / `dropoff_address` and form `AddressGroupEntry.address`.
 * Matches manual field edits: "Straße Nr, PLZ Stadt" (optional POI name prefix for establishments).
 */
export function formatTripAddressDisplayLine(input: {
  street?: string | null;
  street_number?: string | null;
  zip_code?: string | null;
  city?: string | null;
  /** Google establishment / POI label — prefixed when present */
  placeName?: string | null;
}): string {
  const streetStr = [input.street?.trim(), input.street_number?.trim()]
    .filter(Boolean)
    .join(' ');
  const cityStr = [input.zip_code?.trim(), input.city?.trim()]
    .filter(Boolean)
    .join(' ');
  const core = [streetStr, cityStr].filter(Boolean).join(', ');
  const name = input.placeName?.trim();
  if (name && core) return `${name}, ${core}`;
  return name || core;
}
