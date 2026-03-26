const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

export interface GeocodedLocation {
  lat: number;
  lng: number;
  zip_code?: string | null;
  city?: string | null;
}

/** Full structured result from geocoding a single display line (recurring cron, backfills). */
export interface GeocodedAddressLineResult {
  lat: number;
  lng: number;
  street: string | null;
  street_number: string | null;
  zip_code: string | null;
  city: string | null;
  /** Google’s formatted string; optional display upgrade over the input line. */
  formatted_address: string | null;
}

function needsGermanPostalFallback(zip: string | null | undefined): boolean {
  if (!zip?.trim()) return true;
  return !/^\d{5}$/.test(zip.trim());
}

/**
 * Forward-geocode one address line (e.g. `recurring_rules.pickup_address`) into coordinates
 * and structured fields. Uses the same Geocoding API key as structured geocode; biases Germany.
 * Applies reverse-geocode PLZ fallback when the response lacks a valid five-digit German code.
 */
export async function geocodeAddressLineToStructured(
  addressLine: string
): Promise<GeocodedAddressLineResult | null> {
  const trimmed = addressLine?.trim();
  if (!trimmed) return null;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY is not set');
    return null;
  }

  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set('address', trimmed);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('language', 'de');
  url.searchParams.set('components', 'country:DE');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error('Geocoding API HTTP error', res.status, res.statusText);
      return null;
    }

    const data = await res.json();

    if (
      data.status !== 'OK' ||
      !Array.isArray(data.results) ||
      !data.results[0]
    ) {
      return null;
    }

    const result = data.results[0];
    const location = result.geometry?.location;
    if (
      !location ||
      typeof location.lat !== 'number' ||
      typeof location.lng !== 'number'
    ) {
      return null;
    }

    const components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }> = Array.isArray(result.address_components)
      ? result.address_components
      : [];

    let street: string | null = null;
    let street_number: string | null = null;
    let zipCode: string | null = null;
    let city: string | null = null;

    for (const component of components) {
      if (component.types.includes('street_number')) {
        street_number = component.long_name || null;
      }
      if (component.types.includes('route')) {
        street = component.long_name || null;
      }
      if (component.types.includes('postal_code')) {
        zipCode = component.long_name || null;
      }
      if (
        component.types.includes('locality') ||
        component.types.includes('postal_town')
      ) {
        city = component.long_name || null;
      }
    }

    if (!city) {
      for (const component of components) {
        if (
          component.types.includes('sublocality') ||
          component.types.includes('sublocality_level_1')
        ) {
          city = component.long_name || null;
          break;
        }
      }
    }

    let lat = location.lat;
    let lng = location.lng;

    if (needsGermanPostalFallback(zipCode)) {
      const geoZip = await reverseGeocodeLatLngToPostalCode({ lat, lng });
      if (geoZip && /^\d{5}$/.test(geoZip)) {
        zipCode = geoZip;
      }
    }

    const formatted =
      typeof result.formatted_address === 'string'
        ? result.formatted_address
        : null;

    return {
      lat,
      lng,
      street,
      street_number,
      zip_code: zipCode,
      city,
      formatted_address: formatted
    };
  } catch (error) {
    console.error('Error geocoding address line', error);
    return null;
  }
}

export async function geocodeStructuredAddressToLatLng(params: {
  street?: string | null;
  street_number?: string | null;
  zip_code?: string | null;
  city?: string | null;
}): Promise<GeocodedLocation | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY is not set');
    return null;
  }

  const parts: string[] = [];

  const streetLine = [params.street, params.street_number]
    .filter(Boolean)
    .join(' ');
  if (streetLine) parts.push(streetLine);

  const cityLine = [params.zip_code, params.city].filter(Boolean).join(' ');
  if (cityLine) parts.push(cityLine);

  if (parts.length === 0) {
    return null;
  }

  const address = parts.join(', ');

  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set('address', address);
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error('Geocoding API HTTP error', res.status, res.statusText);
      return null;
    }

    const data = await res.json();

    if (
      data.status !== 'OK' ||
      !Array.isArray(data.results) ||
      !data.results[0]
    ) {
      console.error(
        'Geocoding API status/error',
        data.status,
        data.error_message
      );
      return null;
    }

    const result = data.results[0];
    const location = result.geometry?.location;
    if (
      !location ||
      typeof location.lat !== 'number' ||
      typeof location.lng !== 'number'
    ) {
      console.error('Geocoding API missing location');
      return null;
    }

    let zipCode: string | null = null;
    let city: string | null = null;

    const components: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }> = Array.isArray(result.address_components)
      ? result.address_components
      : [];

    for (const component of components) {
      if (component.types.includes('postal_code')) {
        zipCode = component.long_name;
      }
      if (
        component.types.includes('locality') ||
        component.types.includes('postal_town')
      ) {
        city = component.long_name;
      }
    }

    return {
      lat: location.lat,
      lng: location.lng,
      zip_code: zipCode,
      city
    };
  } catch (error) {
    console.error('Error calling Geocoding API', error);
    return null;
  }
}

/**
 * Reverse-geocode coordinates to a postal code (Geocoding API).
 * Used when Places Details returns an incomplete `postal_code` (e.g. some route centroids).
 * Requires `GOOGLE_MAPS_API_KEY` and Geocoding API enabled on the GCP project.
 */
export async function reverseGeocodeLatLngToPostalCode(params: {
  lat: number;
  lng: number;
}): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return null;
  }

  const url = new URL(GEOCODE_ENDPOINT);
  url.searchParams.set('latlng', `${params.lat},${params.lng}`);
  url.searchParams.set('key', apiKey);
  // Prefer German component labels; does not override geometry, only formatting of address_components.
  url.searchParams.set('language', 'de');

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error('Reverse geocode HTTP error', res.status, res.statusText);
      return null;
    }

    const data = await res.json();

    if (
      data.status !== 'OK' ||
      !Array.isArray(data.results) ||
      !data.results[0]
    ) {
      return null;
    }

    const components: Array<{
      long_name: string;
      types: string[];
    }> = Array.isArray(data.results[0].address_components)
      ? data.results[0].address_components
      : [];

    // Match `geocodeStructuredAddressToLatLng`: use `long_name` for postal_code, not `short_name`.
    for (const component of components) {
      if (component.types.includes('postal_code')) {
        return component.long_name?.trim() || null;
      }
    }

    return null;
  } catch (error) {
    console.error('Error in reverse geocode', error);
    return null;
  }
}
