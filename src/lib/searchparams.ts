import {
  createSearchParamsCache,
  createSerializer,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsInteger,
  parseAsString
} from 'nuqs/server';

export const searchParams = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(50),
  search: parseAsString,
  name: parseAsString,
  gender: parseAsString,
  category: parseAsString,
  // trip filters
  status: parseAsString,
  driver_id: parseAsString,
  payer_id: parseAsArrayOf(parseAsString, ','),
  billing_variant_id: parseAsArrayOf(parseAsString, ','),
  /** Effective invoice status for trips list (see trip-invoice-status-badge + RPC). */
  invoice_status: parseAsString,
  /** KTS list filter: comma-separated combination of kts | kts_fehler | no_kts | no_reha | reha; absent = all trips. */
  kts_filter: parseAsArrayOf(parseAsString, ','),
  /** KTS queue filter: comma-separated kts_status enum values; absent = no status filter. */
  kts_status: parseAsArrayOf(parseAsString, ','),
  /** KTS queue: show only in_korrektur trips with open correction older than KTS_OVERDUE_DAYS. */
  overdue: parseAsBoolean.withDefault(false),
  scheduled_at: parseAsString, // for date filtering
  sort: parseAsString,
  view: parseAsString.withDefault('list'),
  /** Roster filter: all | driver | admin (driver-management table). */
  role: parseAsString.withDefault('all')
};

export const searchParamsCache = createSearchParamsCache(searchParams);
export const serialize = createSerializer(searchParams);
