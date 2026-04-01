/**
 * Address → canonical "place" for PDF route grouping and labels.
 *
 * Trip pickup/dropoff strings are messy (missing PLZ, inconsistent punctuation).
 * We build a hint map from all addresses on the invoice so a bare street line
 * can inherit zip/city when it uniquely matches one stem. Airports get a
 * dedicated display label. Used by the cover summary table and the appendix.
 *
 * KEY NORMALIZATION STRATEGY:
 * - Place keys use cityStem (city without zip) to ensure consistent matching
 * - Example: "Taubenstraße 17, 26122 Oldenburg (Oldb)" → key: "taubenstraße 17|oldenburg oldb"
 * - This ensures incomplete addresses like "Taubenstraße 17" that get hints
 *   will match complete addresses with the same canonical key
 * - Without this normalization, we'd create 3 route groups instead of 2 for
 *   Hinfahrt/Rückfahrt pairs when some trips have incomplete addresses
 */

export interface CanonicalPlace {
  key: string;
  primary: string;
  secondary: string;
}

export type InvoicePdfPlaceHintMap = Map<string, CanonicalPlace>;

function normalizeCompareText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split "Street, 12345 City" style strings into street vs PLZ+city tail. */
function extractZipCityParts(address: string): {
  street: string;
  zipCity: string;
} {
  const compact = address.replace(/\s+/g, ' ').trim();
  const match = compact.match(/^(.*?)(?:,\s*)?(\d{5}\s+.+)$/);

  if (!match) {
    return { street: compact, zipCity: '' };
  }

  return {
    street: match[1].trim().replace(/,\s*$/, ''),
    zipCity: match[2].trim()
  };
}

const PLACE_NOISE_WORDS = new Set([
  'gmbh',
  'mbh',
  'kg',
  'ug',
  'co',
  'bre',
  'terminal',
  'halle',
  'ankunft',
  'abflug'
]);

function toDisplayCase(value: string): string {
  return value.replace(/\w\S*/g, (part) => {
    const lower = part.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}

function buildPlaceStem(value: string): string {
  return normalizeCompareText(value)
    .split(' ')
    .filter((token) => token && !PLACE_NOISE_WORDS.has(token))
    .join(' ');
}

/**
 * For each street stem that appears with exactly one full (street+PLZ+city)
 * identity, map stem → that place. Lets incomplete lines reuse zip/city.
 */
export function buildInvoicePdfPlaceHintMap(
  addresses: string[]
): InvoicePdfPlaceHintMap {
  const candidates = new Map<string, CanonicalPlace[]>();

  addresses.forEach((rawAddress) => {
    const normalized = normalizeCompareText(rawAddress);
    if (!normalized) return;

    const { street, zipCity } = extractZipCityParts(rawAddress);
    const streetStem = buildPlaceStem(street);
    if (!streetStem || !zipCity) return;

    // Extract city from zipCity (e.g., "26122 Oldenburg (Oldb)" -> "Oldenburg (Oldb)")
    const zipMatch = zipCity.match(/^(\d{5})\s+(.+)$/);
    const city = zipMatch?.[2]?.trim() ?? zipCity;
    const cityStem = buildPlaceStem(city);

    const place: CanonicalPlace = {
      // Normalize key to use cityStem (without zip) for consistent matching
      // This ensures incomplete addresses that get hints match complete addresses
      key: `${streetStem}|${cityStem || normalizeCompareText(zipCity)}`,
      primary: street || rawAddress.trim(),
      secondary: zipCity
    };

    const existing = candidates.get(streetStem) ?? [];
    existing.push(place);
    candidates.set(streetStem, existing);
  });

  const resolved = new Map<string, CanonicalPlace>();

  candidates.forEach((places, stem) => {
    const uniqueKeys = new Set(places.map((place) => place.key));
    if (uniqueKeys.size === 1) {
      resolved.set(stem, places[0]);
    }
  });

  return resolved;
}

export function canonicalizeInvoicePdfPlace(
  rawAddress: string,
  placeHints: InvoicePdfPlaceHintMap
): CanonicalPlace {
  const normalized = normalizeCompareText(rawAddress);
  const { street, zipCity } = extractZipCityParts(rawAddress);
  const zipMatch = zipCity.match(/^(\d{5})\s+(.+)$/);
  const zipCode = zipMatch?.[1] ?? '';
  const city = zipMatch?.[2]?.trim() ?? '';
  const cityStem = buildPlaceStem(city);
  const streetStem = buildPlaceStem(street);
  const hintedPlace = streetStem ? placeHints.get(streetStem) : undefined;

  const isAirport =
    normalized.includes('flughafen') || normalized.includes('airport');

  if (isAirport) {
    const airportKeyBase = [zipCode, cityStem || streetStem]
      .filter(Boolean)
      .join('|');
    const displayCity = city || toDisplayCase(streetStem);

    return {
      key: `airport:${airportKeyBase || streetStem || normalized}`,
      primary: displayCity ? `Flughafen ${displayCity}` : 'Flughafen',
      secondary: zipCity
    };
  }

  if (!zipCity && hintedPlace) {
    // Return the hinted place directly - key is already normalized to cityStem format
    return hintedPlace;
  }

  return {
    key: `${streetStem || normalizeCompareText(street)}|${cityStem || normalizeCompareText(zipCity)}`,
    primary: street || rawAddress.trim(),
    secondary: zipCity
  };
}

export function buildInvoicePdfRouteSecondaryLine(
  from: CanonicalPlace,
  to: CanonicalPlace
): string {
  if (from.secondary && to.secondary) {
    return `${from.secondary} -> ${to.secondary}`;
  }

  return from.secondary || to.secondary || '';
}
