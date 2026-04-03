import {
  dateRangePickerDefaultPresets,
  type DateRangePreset
} from '@/components/ui/date-time-picker';

/** Invoice UIs omit "Nächste Woche" — billing periods are not chosen in advance. */
export const invoiceDateRangePresets: DateRangePreset[] =
  dateRangePickerDefaultPresets.filter((p) => p.label !== 'Nächste Woche');
