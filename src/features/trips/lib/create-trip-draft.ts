import { z } from 'zod';
import type { ReturnMode } from '@/features/trips/components/create-trip/schema';

export const CREATE_TRIP_DRAFT_STORAGE_KEY = 'taxigo:create-trip-draft:v2';
export const CREATE_TRIP_DRAFT_SCHEMA_VERSION = 2 as const;

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

export const createTripDraftSchema = z.union([draftV2, draftV1]);

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

export function buildTripFormValuesFromDraft(
  d: CreateTripDraftStored['values']
): {
  payer_id: string;
  billing_variant_id: string;
  scheduled_at: Date;
  return_mode: ReturnMode;
  return_date: Date | undefined;
  return_time: string;
  driver_id: string;
  is_wheelchair: boolean;
  notes: string;
} {
  if ('billing_variant_id' in d) {
    return {
      payer_id: d.payer_id,
      billing_variant_id: d.billing_variant_id,
      scheduled_at: new Date(d.scheduled_at),
      return_mode: d.return_mode,
      return_date: d.return_date ? new Date(d.return_date) : undefined,
      return_time: d.return_time ?? '',
      driver_id: d.driver_id ?? '__none__',
      is_wheelchair: d.is_wheelchair,
      notes: d.notes ?? ''
    };
  }
  return {
    payer_id: d.payer_id,
    billing_variant_id: d.billing_type_id,
    scheduled_at: new Date(d.scheduled_at),
    return_mode: d.return_mode,
    return_date: d.return_date ? new Date(d.return_date) : undefined,
    return_time: d.return_time ?? '',
    driver_id: d.driver_id ?? '__none__',
    is_wheelchair: d.is_wheelchair,
    notes: d.notes ?? ''
  };
}
