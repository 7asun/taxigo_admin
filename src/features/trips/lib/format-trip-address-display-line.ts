/**
 * Oldenburg (NI) — DB / Google often use the official name "Oldenburg (Oldb)".
 * Must not match "Oldenburg in Holstein" (different municipality).
 */
function isOldenburgCity(city: string | null | undefined): boolean {
  if (!city?.trim()) return false;
  const t = city.trim();
  return /^oldenburg(\s*\(oldb\))?$/i.test(t);
}

function isOldenburgZipCityLine(
  zipCityLine: string | null | undefined
): boolean {
  if (!zipCityLine?.trim()) return false;
  const m = zipCityLine.match(/^\d{5}\s+(.+)$/);
  if (!m) return false;
  return isOldenburgCity(m[1].trim());
}

function parseBundledAddressLine(raw: string): {
  streetPart: string;
  zipCityLine: string | null;
} {
  const match = raw.match(/^(.*?)\s*,?\s*(\d{5}\s+.+)$/);
  if (match) {
    return {
      streetPart: match[1].trim(),
      zipCityLine: match[2].trim()
    };
  }
  return { streetPart: raw, zipCityLine: null };
}

function formatBundledAddressHidingOldenburg(
  raw: string | null | undefined
): string {
  if (!raw?.trim()) return '';
  const { streetPart, zipCityLine } = parseBundledAddressLine(raw.trim());
  if (zipCityLine && isOldenburgZipCityLine(zipCityLine)) {
    return streetPart;
  }
  return raw.trim();
}

/**
 * Single canonical line for `pickup_address` / `dropoff_address` and form `AddressGroupEntry.address`.
 * Matches manual field edits: "Straße Nr, PLZ Stadt" (optional POI name prefix for establishments).
 *
 * When **city** is Oldenburg (case-insensitive), PLZ and city are omitted — local default.
 */
export function formatTripAddressDisplayLine(input: {
  street?: string | null;
  street_number?: string | null;
  zip_code?: string | null;
  city?: string | null;
  /** Google establishment / POI label — prefixed when present */
  placeName?: string | null;
}): string {
  const cityTrim = input.city?.trim();
  const omitPostal = cityTrim ? isOldenburgCity(cityTrim) : false;
  const zip = omitPostal ? null : input.zip_code;
  const city = omitPostal ? null : input.city;

  const streetStr = [input.street?.trim(), input.street_number?.trim()]
    .filter(Boolean)
    .join(' ');
  const cityStr = [zip?.trim(), city?.trim()].filter(Boolean).join(' ');
  const core = [streetStr, cityStr].filter(Boolean).join(', ');
  const name = input.placeName?.trim();
  if (name && core) return `${name}, ${core}`;
  return name || core;
}

/**
 * Split a bundled `*_address` into street vs "PLZ Stadt" for tables/cards.
 * When the city after PLZ is Oldenburg, `cityLine` is **null** (ZIP and city hidden).
 */
export function parseTripAddressForDisplay(raw: string | null | undefined): {
  street: string | null;
  cityLine: string | null;
} {
  if (!raw?.trim()) return { street: null, cityLine: null };
  const trimmed = raw.trim();
  const { streetPart, zipCityLine } = parseBundledAddressLine(trimmed);
  if (!zipCityLine) {
    return { street: streetPart || null, cityLine: null };
  }
  if (isOldenburgZipCityLine(zipCityLine)) {
    return { street: streetPart || null, cityLine: null };
  }
  return { street: streetPart || null, cityLine: zipCityLine };
}

type KanbanAddressTripSlice = {
  pickup_address?: string | null;
  dropoff_address?: string | null;
  pickup_street?: string | null;
  pickup_street_number?: string | null;
  pickup_zip_code?: string | null;
  pickup_city?: string | null;
  dropoff_street?: string | null;
  dropoff_street_number?: string | null;
  dropoff_zip_code?: string | null;
  dropoff_city?: string | null;
};

/**
 * Kanban card line: uses structured columns when any pickup/dropoff field is set;
 * otherwise parses the bundled `*_address` string (Oldenburg hides PLZ + city).
 */
export function formatKanbanTripAddressLine(
  trip: KanbanAddressTripSlice,
  kind: 'pickup' | 'dropoff'
): string {
  const isPickup = kind === 'pickup';
  const street = isPickup ? trip.pickup_street : trip.dropoff_street;
  const streetNumber = isPickup
    ? trip.pickup_street_number
    : trip.dropoff_street_number;
  const zip = isPickup ? trip.pickup_zip_code : trip.dropoff_zip_code;
  const city = isPickup ? trip.pickup_city : trip.dropoff_city;
  const bundled = isPickup ? trip.pickup_address : trip.dropoff_address;

  const hasStructuredFields = Boolean(
    street?.trim() || streetNumber?.trim() || zip?.trim() || city?.trim()
  );

  if (hasStructuredFields) {
    const line = formatTripAddressDisplayLine({
      street,
      street_number: streetNumber,
      zip_code: zip,
      city,
      placeName: null
    });
    if (line.trim()) return line;
  }

  return formatBundledAddressHidingOldenburg(bundled);
}
