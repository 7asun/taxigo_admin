import { z } from 'zod';
import { format } from 'date-fns';
import type { ReturnMode } from '@/features/trips/components/create-trip/schema';
import { formatLocalYmd } from '@/features/trips/lib/departure-schedule';

export const CREATE_TRIP_DRAFT_STORAGE_KEY = 'taxigo:create-trip-draft:v2';
export const CREATE_TRIP_DRAFT_SCHEMA_VERSION = 3 as const;

const draftValuesSchemaV3 = z.object({
  payer_id: z.string(),
  billing_variant_id: z.string(),
  departure_date: z.string(),
  departure_time: z.string(),
  return_mode: z.enum(['none', 'time_tbd', 'exact']),
  return_date: z.union([z.string(), z.null()]).optional(),
  return_time: z.string().optional(),
  driver_id: z.string().optional(),
  is_wheelchair: z.boolean(),
  notes: z.string().optional(),
  billing_calling_station: z.string().optional(),
  billing_betreuer: z.string().optional(),
  kts_document_applies: z.boolean().optional()
});

const draftValuesSchemaV2 = z.object({
  payer_id: z.string(),
  billing_variant_id: z.string(),
  scheduled_at: z.string(),
  return_mode: z.enum(['none', 'time_tbd', 'exact']),
  return_date: z.union([z.string(), z.null()]).optional(),
  return_time: z.string().optional(),
  driver_id: z.string().optional(),
  is_wheelchair: z.boolean(),
  notes: z.string().optional()
});

const draftValuesSchemaV1 = z.object({
  payer_id: z.string(),
  billing_type_id: z.string(),
  scheduled_at: z.string(),
  return_mode: z.enum(['none', 'time_tbd', 'exact']),
  return_date: z.union([z.string(), z.null()]).optional(),
  return_time: z.string().optional(),
  driver_id: z.string().optional(),
  is_wheelchair: z.boolean(),
  notes: z.string().optional()
});

const draftV3 = z.object({
  schemaVersion: z.literal(3),
  updatedAt: z.string(),
  values: draftValuesSchemaV3,
  passengers: z.array(z.any()),
  pickupGroups: z.array(z.any()),
  dropoffGroups: z.array(z.any())
});

const draftV2 = z.object({
  schemaVersion: z.literal(2),
  updatedAt: z.string(),
  values: draftValuesSchemaV2,
  passengers: z.array(z.any()),
  pickupGroups: z.array(z.any()),
  dropoffGroups: z.array(z.any())
});

const draftV1 = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  values: draftValuesSchemaV1,
  passengers: z.array(z.any()),
  pickupGroups: z.array(z.any()),
  dropoffGroups: z.array(z.any())
});

export const createTripDraftSchema = z.union([draftV3, draftV2, draftV1]);

export type CreateTripDraftStored = z.infer<typeof createTripDraftSchema>;

export function parseCreateTripDraft(
  raw: string | null
): CreateTripDraftStored | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    const parsed = createTripDraftSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function departureFromScheduledAtIso(iso: string): {
  departure_date: string;
  departure_time: string;
} {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) {
    const now = new Date();
    return {
      departure_date: formatLocalYmd(now),
      departure_time: format(now, 'HH:mm')
    };
  }
  return {
    departure_date: formatLocalYmd(dt),
    departure_time: format(dt, 'HH:mm')
  };
}

export function buildTripFormValuesFromDraft(
  d: CreateTripDraftStored['values']
): {
  payer_id: string;
  billing_variant_id: string;
  departure_date: string;
  departure_time: string;
  return_mode: ReturnMode;
  return_date: Date | undefined;
  return_time: string;
  driver_id: string;
  is_wheelchair: boolean;
  notes: string;
  billing_calling_station: string;
  billing_betreuer: string;
  kts_document_applies: boolean;
} {
  if ('departure_date' in d) {
    return {
      payer_id: d.payer_id,
      billing_variant_id: d.billing_variant_id,
      departure_date: d.departure_date,
      departure_time: d.departure_time ?? '',
      return_mode: d.return_mode,
      return_date: d.return_date ? new Date(d.return_date) : undefined,
      return_time: d.return_time ?? '',
      driver_id: d.driver_id ?? '__none__',
      is_wheelchair: d.is_wheelchair,
      notes: d.notes ?? '',
      billing_calling_station: d.billing_calling_station ?? '',
      billing_betreuer: d.billing_betreuer ?? '',
      kts_document_applies: d.kts_document_applies ?? false
    };
  }

  if ('billing_variant_id' in d) {
    const { departure_date, departure_time } = departureFromScheduledAtIso(
      d.scheduled_at
    );
    return {
      payer_id: d.payer_id,
      billing_variant_id: d.billing_variant_id,
      departure_date,
      departure_time,
      return_mode: d.return_mode,
      return_date: d.return_date ? new Date(d.return_date) : undefined,
      return_time: d.return_time ?? '',
      driver_id: d.driver_id ?? '__none__',
      is_wheelchair: d.is_wheelchair,
      notes: d.notes ?? '',
      billing_calling_station: '',
      billing_betreuer: '',
      kts_document_applies: false
    };
  }

  const { departure_date, departure_time } = departureFromScheduledAtIso(
    d.scheduled_at
  );
  return {
    payer_id: d.payer_id,
    billing_variant_id: d.billing_type_id,
    departure_date,
    departure_time,
    return_mode: d.return_mode,
    return_date: d.return_date ? new Date(d.return_date) : undefined,
    return_time: d.return_time ?? '',
    driver_id: d.driver_id ?? '__none__',
    is_wheelchair: d.is_wheelchair,
    notes: d.notes ?? '',
    billing_calling_station: '',
    billing_betreuer: '',
    kts_document_applies: false
  };
}
