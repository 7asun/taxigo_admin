import { describe, expect, test } from 'vitest';

import {
  CANCELLED_TRIP_APPENDIX_STATUS_LINE,
  cancelledTripAppendixCell,
  getCanceledReasonNote
} from '@/features/invoices/components/invoice-pdf/lib/cancelled-trip-appendix-cells';
import {
  SYSTEM_DEFAULT_APPENDIX_COLUMNS,
  SYSTEM_DEFAULT_MAIN_COLUMNS,
  PDF_COLUMN_MAP
} from '@/features/invoices/lib/pdf-column-catalog';
import { resolvePdfColumnProfile } from '@/features/invoices/lib/resolve-pdf-column-profile';
import { pdfColumnOverrideSchema } from '@/features/invoices/types/pdf-vorlage.types';

describe('pdf_column_override schema + PdfColumnProfile (cancelled trips)', () => {
  test('missing show_cancelled_trips parses as false', () => {
    const out = pdfColumnOverrideSchema.parse({
      main_columns: SYSTEM_DEFAULT_MAIN_COLUMNS,
      appendix_columns: SYSTEM_DEFAULT_APPENDIX_COLUMNS,
      main_layout: 'grouped'
    });
    expect(out.show_cancelled_trips).toBe(false);
  });

  test('resolvePdfColumnProfile reads show_cancelled_trips from invoice override tier', () => {
    const profile = resolvePdfColumnProfile(
      {
        main_columns: SYSTEM_DEFAULT_MAIN_COLUMNS,
        appendix_columns: SYSTEM_DEFAULT_APPENDIX_COLUMNS,
        show_cancelled_trips: true,
        show_excluded_trips: false
      },
      null,
      null
    );
    expect(profile.source).toBe('invoice_override');
    expect(profile.show_cancelled_trips).toBe(true);
  });

  test('resolvePdfColumnProfile with null override sets show_cancelled_trips false', () => {
    const profile = resolvePdfColumnProfile(null, null, null);
    expect(profile.show_cancelled_trips).toBe(false);
  });

  test('cancelledTripAppendixCell gross_price renders € zero', () => {
    const col = PDF_COLUMN_MAP.gross_price;
    expect(col).toBeDefined();
    const row = {
      id: 't1',
      scheduled_at: '2026-03-01T08:00:00.000Z',
      pickup_address: 'A Straße 1',
      dropoff_address: 'B Weg 2',
      canceled_reason_notes: null as string | null,
      client: null,
      driver: null
    };
    const cell = cancelledTripAppendixCell(row, col!);
    expect(cell).toMatch(/0,?00\s*€/);
  });

  test('getCanceledReasonNote returns null for blank or whitespace', () => {
    expect(
      getCanceledReasonNote({
        id: '1',
        scheduled_at: null,
        pickup_address: null,
        dropoff_address: null,
        canceled_reason_notes: null,
        client: null,
        driver: null
      })
    ).toBeNull();
    expect(
      getCanceledReasonNote({
        id: '1',
        scheduled_at: null,
        pickup_address: null,
        dropoff_address: null,
        canceled_reason_notes: '   ',
        client: null,
        driver: null
      })
    ).toBeNull();
    expect(
      getCanceledReasonNote({
        id: '1',
        scheduled_at: null,
        pickup_address: null,
        dropoff_address: null,
        canceled_reason_notes: '  Krank  ',
        client: null,
        driver: null
      })
    ).toBe('Krank');
  });

  test('cancelledTripAppendixCell description uses fixed German status line', () => {
    const col = PDF_COLUMN_MAP.description;
    expect(col).toBeDefined();
    const row = {
      id: 't1',
      scheduled_at: null,
      pickup_address: null,
      dropoff_address: null,
      canceled_reason_notes: null,
      client: null,
      driver: null
    };
    expect(cancelledTripAppendixCell(row, col!)).toBe(
      CANCELLED_TRIP_APPENDIX_STATUS_LINE
    );
  });
});
