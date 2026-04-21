import type { ClientOption } from '@/features/trips/types/trip-form-reference.types';

/**
 * Formats a client's address into a single string: "Street Num, ZIP City"
 */
export function formatClientAddress(
  client: Pick<
    ClientOption,
    'street' | 'street_number' | 'zip_code' | 'city'
  > | null
): string {
  if (!client) return '';
  const { street, street_number, zip_code, city } = client;
  const line1 = [street, street_number].filter(Boolean).join(' ');
  const line2 = [zip_code, city].filter(Boolean).join(' ');
  return [line1, line2].filter(Boolean).join(', ');
}
