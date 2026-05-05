import { describe, expect, test } from 'bun:test';

import { buildLineItemsFromTrips } from '@/features/invoices/api/invoice-line-items.api';
import type { TripForInvoice } from '@/features/invoices/types/invoice.types';

const PAYER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TRIP_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const BILL_TYPE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const BILL_VAR = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function minimalTrip(overrides: Partial<TripForInvoice> = {}): TripForInvoice {
  return {
    id: TRIP_ID,
    payer_id: PAYER_ID,
    status: 'completed',
    scheduled_at: '2026-01-15T10:00:00.000Z',
    net_price: null,
    base_net_price: 20,
    approach_fee_net: null,
    manual_gross_price: null,
    manual_distance_km: null,
    driving_distance_km: 10,
    billing_variant_id: BILL_VAR,
    payer: { rechnungsempfaenger_id: null, manual_km_enabled: false },
    billing_variant: {
      id: BILL_VAR,
      code: 'V1',
      name: 'Standard',
      billing_type_id: BILL_TYPE,
      rechnungsempfaenger_id: null,
      billing_type: { name: 'Konsil', rechnungsempfaenger_id: null }
    },
    pickup_address: 'Von A',
    dropoff_address: 'Nach B',
    kts_document_applies: false,
    no_invoice_required: false,
    link_type: null,
    linked_trip_id: null,
    ...overrides
  };
}

describe('buildLineItemsFromTrips — client_name snapshot', () => {
  test('uses trips.client_name when client embed is absent', () => {
    const trips = [
      minimalTrip({
        client: undefined,
        client_name: 'Max Mustermann'
      })
    ];
    const items = buildLineItemsFromTrips(trips, [], [], []);
    expect(items[0]?.client_name).toBe('Max Mustermann');
    expect(items[0]?.description).toContain('Max Mustermann');
  });

  test('Stammdaten client takes precedence over trips.client_name', () => {
    const trips = [
      minimalTrip({
        client_name: 'Ignored Trip String',
        client: {
          id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          first_name: 'Anna',
          last_name: 'Schmidt',
          price_tag: null
        }
      })
    ];
    const items = buildLineItemsFromTrips(trips, [], [], []);
    expect(items[0]?.client_name).toBe('Anna Schmidt');
    expect(items[0]?.description).toContain('Anna Schmidt');
    expect(items[0]?.description).not.toContain('Ignored');
  });

  test('trims whitespace-only trip client_name to null', () => {
    const trips = [
      minimalTrip({
        client: undefined,
        client_name: '   \t  '
      })
    ];
    const items = buildLineItemsFromTrips(trips, [], [], []);
    expect(items[0]?.client_name).toBeNull();
  });
});
