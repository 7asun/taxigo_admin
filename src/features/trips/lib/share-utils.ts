import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import type { Trip } from '@/features/trips/api/trips.service';

/**
 * Normalizes a single-line address for sharing/copy: drops trailing PLZ+Oldenburg,
 * then trailing "Deutschland", and dangling commas.
 */
export function stripAddressForShare(address: string): string {
  return address
    .replace(/(?:,\s*)?\b\d{5}\s+Oldenburg[\s\S]*$/i, '')
    .replace(/(?:,\s*)?Deutschland\s*$/i, '')
    .replace(/,\s*$/g, '')
    .trim();
}

/**
 * Formats trip details for easy sharing (e.g., via WhatsApp).
 * Format: "HH:mm - Passenger - von pickup_address (pickup_station) - nach dropoff_address (dropoff_station)"
 */
export function formatTripForSharing(trip: Trip): string {
  const time = trip.scheduled_at
    ? format(new Date(trip.scheduled_at), 'HH:mm', { locale: de })
    : '--:--';

  const wheelchairIndicator = trip.is_wheelchair ? ' **Rollstuhl**' : '';

  const passenger = trip.client_name || 'Anonym';

  const formatAddress = (address: string | null | undefined) => {
    if (!address) return '-';
    return stripAddressForShare(address) || '-';
  };

  const from = formatAddress(trip.pickup_address);
  const fromStation = trip.pickup_station ? ` (${trip.pickup_station})` : '';

  const to = formatAddress(trip.dropoff_address);
  const toStation = trip.dropoff_station ? ` (${trip.dropoff_station})` : '';

  let text = `${time}${wheelchairIndicator} - ${passenger} - von ${from}${fromStation} - nach ${to}${toStation}`;

  const anruf = trip.billing_calling_station?.trim();
  const betr = trip.billing_betreuer?.trim();
  if (anruf) {
    text += `\nAnrufstation: ${anruf}`;
  }
  if (betr) {
    text += `\nBetreuer: ${betr}`;
  }

  if (trip.notes) {
    text += `\n\n${trip.notes}`;
  }

  return text;
}

/**
 * Copies the formatted trip string to the clipboard.
 */
export async function copyTripToClipboard(trip: Trip): Promise<boolean> {
  try {
    const text = formatTripForSharing(trip);
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy trip to clipboard:', error);
    return false;
  }
}
