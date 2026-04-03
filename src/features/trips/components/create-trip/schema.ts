import * as z from 'zod';

export type ReturnMode = 'none' | 'time_tbd' | 'exact';

const departureTimeSchema = z.union([
  z.literal(''),
  z
    .string()
    .regex(
      /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      'Bitte ein gültiges Zeitformat verwenden (HH:MM)'
    )
]);

export const tripFormSchema = z
  .object({
    payer_id: z.string().min(1, 'Kostenträger ist erforderlich'),
    billing_variant_id: z.string().optional(),
    /** Local calendar day `yyyy-MM-dd` (same contract as `DatePicker`). */
    departure_date: z
      .string()
      .min(1, 'Datum ist erforderlich')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ungültiges Datum'),
    /** Empty = no clock time → `scheduled_at` null + `requested_date` only. */
    departure_time: departureTimeSchema,
    return_mode: z.enum(['none', 'time_tbd', 'exact']).default('none'),
    return_date: z.date().optional(),
    return_time: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(
            /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
            'Bitte ein gültiges Zeitformat verwenden (HH:MM)'
          )
      ])
      .optional(),
    driver_id: z.string().optional(),
    is_wheelchair: z.boolean(),
    notes: z.string().optional(),
    /**
     * Billing metadata when family has `askCallingStationAndBetreuer`; persisted as
     * `trips.billing_calling_station` / `trips.billing_betreuer` (not route stations).
     */
    billing_calling_station: z.string().optional(),
    billing_betreuer: z.string().optional(),
    /** Krankentransportschein / KTS — see `resolveKtsDefault` + `trips.kts_source`. */
    kts_document_applies: z.boolean().default(false)
  })
  .superRefine((data, ctx) => {
    if (data.return_mode === 'exact') {
      if (!data.return_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Bitte Rückfahrt-Datum auswählen.',
          path: ['return_date']
        });
      }
      if (!data.return_time) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Bitte Rückfahrt-Uhrzeit auswählen.',
          path: ['return_time']
        });
      }
    }
  });

export type TripFormValues = z.infer<typeof tripFormSchema>;
