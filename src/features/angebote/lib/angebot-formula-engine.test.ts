import { describe, expect, it } from 'bun:test';

import {
  computeNetAmount,
  computeAngebotTotals,
  computeRow,
  isComputedColumn,
  resolveRoleValues,
  SYNTHETIC_GROSS_KEY,
  SYNTHETIC_NET_KEY,
  SYNTHETIC_TAX_KEY
} from './angebot-formula-engine';
import type { AngebotColumnDef } from '../types/angebot.types';

function col(
  id: string,
  header: string,
  preset: AngebotColumnDef['preset'],
  role: AngebotColumnDef['role']
): AngebotColumnDef {
  return {
    id,
    header,
    preset,
    required: false,
    formula: null,
    role
  };
}

describe('angebot-formula-engine', () => {
  it('computeNetAmount — distance + unit_price only', () => {
    const v = {
      distance_km: 10,
      unit_price: 2
    };
    expect(computeNetAmount(v)).toBe(20);
  });

  it('computeNetAmount — distance + unit_price + quantity (base × quantity)', () => {
    const v = {
      distance_km: 10,
      unit_price: 2,
      quantity: 3
    };
    expect(computeNetAmount(v)).toBe(60);
  });

  it('computeNetAmount — all inputs (distance + unit_price + flat_rate + surcharge) × quantity', () => {
    const v = {
      distance_km: 10,
      unit_price: 2,
      flat_rate: 5,
      surcharge: 1,
      quantity: 3
    };
    // base = 10*2 + 5 + 1 = 26; ×3 = 78
    expect(computeNetAmount(v)).toBe(78);
  });

  it('computeNetAmount — unit_price missing → null', () => {
    const v = {
      distance_km: 10,
      quantity: 2,
      flat_rate: 5
    };
    expect(computeNetAmount(v)).toBeNull();
  });

  it('computeNetAmount — distance_km = 0, unit_price = 50, flat_rate = 20 → net = 20', () => {
    const v = {
      distance_km: 0,
      unit_price: 50,
      flat_rate: 20
    };
    expect(computeNetAmount(v)).toBe(20);
  });

  it('resolveRoleValues — parses per role and returns null for missing/unparseable', () => {
    const columns: AngebotColumnDef[] = [
      col('km', 'Km', 'betrag', 'distance_km'),
      col('unit', 'Preis', 'betrag', 'unit_price'),
      col('qty', 'Anzahl', 'anzahl', 'quantity')
    ];
    const row = { km: '12.5', unit: 'x', qty: null };
    const v = resolveRoleValues(row, columns);
    expect(v.distance_km).toBe(12.5);
    expect(v.unit_price).toBeNull();
    expect(v.quantity).toBeNull();
  });

  it('computeRow — full column set patch includes computed keys + synthetic totals', () => {
    const columns: AngebotColumnDef[] = [
      col('desc', 'Beschreibung', 'beschreibung', 'description'),
      col('km', 'Km', 'betrag', 'distance_km'),
      col('unit', 'Preis', 'betrag', 'unit_price'),
      col('qty', 'Anzahl', 'anzahl', 'quantity'),
      col('tax', 'MwSt', 'percent', 'tax_rate'),
      col('net', 'Netto', 'betrag', 'net_amount'),
      col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
      col('gross', 'Brutto', 'betrag', 'gross_amount')
    ];

    const row = {
      desc: 'X',
      km: 10,
      unit: 2,
      qty: 3,
      tax: 19,
      net: null,
      taxAmt: null,
      gross: null
    };

    const patch = computeRow(row, columns);
    expect(Object.keys(patch).sort()).toEqual(
      [
        'gross',
        'net',
        'taxAmt',
        SYNTHETIC_GROSS_KEY,
        SYNTHETIC_NET_KEY,
        SYNTHETIC_TAX_KEY
      ].sort()
    );
    expect(patch.net).toBe(60);
    expect(patch.taxAmt).toBeCloseTo(11.4);
    expect(patch.gross).toBeCloseTo(71.4);
  });

  it('computeRow — tax_rate = 19 → tax_amount = net × 0.19, gross = net × 1.19', () => {
    const columns: AngebotColumnDef[] = [
      col('km', 'Km', 'betrag', 'distance_km'),
      col('unit', 'Preis', 'betrag', 'unit_price'),
      col('tax', 'MwSt', 'percent', 'tax_rate'),
      col('net', 'Netto', 'betrag', 'net_amount'),
      col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
      col('gross', 'Brutto', 'betrag', 'gross_amount')
    ];

    const row = { km: 10, unit: 10, tax: 19 };
    const patch = computeRow(row, columns);
    expect(patch.net).toBe(100);
    expect(patch.taxAmt).toBeCloseTo(19);
    expect(patch.gross).toBeCloseTo(119);
  });

  it('computeRow — tax_rate = 0 → tax_amount = 0, gross = net', () => {
    const columns: AngebotColumnDef[] = [
      col('km', 'Km', 'betrag', 'distance_km'),
      col('unit', 'Preis', 'betrag', 'unit_price'),
      col('tax', 'MwSt', 'percent', 'tax_rate'),
      col('net', 'Netto', 'betrag', 'net_amount'),
      col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
      col('gross', 'Brutto', 'betrag', 'gross_amount')
    ];

    const row = { km: 10, unit: 10, tax: 0 };
    const patch = computeRow(row, columns);
    expect(patch.net).toBe(100);
    expect(patch.taxAmt).toBe(0);
    expect(patch.gross).toBe(100);
  });

  it('computeRow — net_amount missing inputs → computed patch values are null, not 0', () => {
    const columns: AngebotColumnDef[] = [
      col('tax', 'MwSt', 'percent', 'tax_rate'),
      col('net', 'Netto', 'betrag', 'net_amount'),
      col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
      col('gross', 'Brutto', 'betrag', 'gross_amount')
    ];

    const row = { tax: 19 };
    const patch = computeRow(row, columns);
    expect(patch.net).toBeNull();
    expect(patch.taxAmt).toBeNull();
    expect(patch.gross).toBeNull();
  });

  describe('computeRow — gross input mode', () => {
    it('tax_rate=19: unit_price entered as gross → engine converts to net before computing', () => {
      const columns: AngebotColumnDef[] = [
        col('km', 'Km', 'betrag', 'distance_km'),
        col('unit', 'Preis', 'betrag', 'unit_price'),
        col('tax', 'MwSt', 'percent', 'tax_rate'),
        col('net', 'Netto', 'betrag', 'net_amount'),
        col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
        col('gross', 'Brutto', 'betrag', 'gross_amount')
      ];

      // gross unit_price = 119 €/km with 19% VAT → net unit_price = 100 €/km
      // distance = 1 km → net=100, tax=19, gross=119
      const row = { km: 1, unit: 119, tax: 19 };
      const patch = computeRow(row, columns, 'gross');
      expect(patch.net).toBeCloseTo(100);
      expect(patch.taxAmt).toBeCloseTo(19);
      expect(patch.gross).toBeCloseTo(119);
    });

    it('tax_rate=7: flat_rate entered as gross → engine converts to net before computing', () => {
      const columns: AngebotColumnDef[] = [
        col('flat', 'Pauschale', 'betrag', 'flat_rate'),
        col('unit', 'Preis', 'betrag', 'unit_price'),
        col('tax', 'MwSt', 'percent', 'tax_rate'),
        col('net', 'Netto', 'betrag', 'net_amount'),
        col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
        col('gross', 'Brutto', 'betrag', 'gross_amount')
      ];

      // unit_price required; set 0 so net is computed from flat_rate only.
      // gross flat_rate 107 with 7% VAT → net 100 → tax 7 → gross 107
      const row = { unit: 0, flat: 107, tax: 7 };
      const patch = computeRow(row, columns, 'gross');
      expect(patch.net).toBeCloseTo(100);
      expect(patch.taxAmt).toBeCloseTo(7);
      expect(patch.gross).toBeCloseTo(107);
    });

    it('tax_rate=0 is valid: conversion divisor=1; gross equals net and tax is 0', () => {
      const columns: AngebotColumnDef[] = [
        col('km', 'Km', 'betrag', 'distance_km'),
        col('unit', 'Preis', 'betrag', 'unit_price'),
        col('tax', 'MwSt', 'percent', 'tax_rate'),
        col('net', 'Netto', 'betrag', 'net_amount'),
        col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
        col('gross', 'Brutto', 'betrag', 'gross_amount')
      ];

      const row = { km: 2, unit: 50, tax: 0 };
      const patch = computeRow(row, columns, 'gross');
      expect(patch.net).toBe(100);
      expect(patch.taxAmt).toBe(0);
      expect(patch.gross).toBe(100);
      // Explicit regression guard for Phase 6 semantics: gross === net when tax_rate=0
      expect(patch.gross).toBe(patch.net);
    });

    it('missing tax_rate: conversion is skipped (engine runs on unconverted values)', () => {
      const columns: AngebotColumnDef[] = [
        col('km', 'Km', 'betrag', 'distance_km'),
        col('unit', 'Preis', 'betrag', 'unit_price'),
        col('tax', 'MwSt', 'percent', 'tax_rate'),
        col('net', 'Netto', 'betrag', 'net_amount'),
        col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
        col('gross', 'Brutto', 'betrag', 'gross_amount')
      ];

      // unit_price is interpreted as gross by the UI, but engine cannot convert without tax_rate.
      // Engine therefore computes net_amount from raw inputs (unit_price required), tax_amount null, gross=net (tax defaults to 0).
      const row = { km: 1, unit: 119, tax: null };
      const patch = computeRow(row, columns, 'gross');
      expect(patch.net).toBe(119);
      expect(patch.taxAmt).toBeNull();
      expect(patch.gross).toBe(119);
    });

    it('default inputMode (net) remains unchanged for existing behaviour', () => {
      const columns: AngebotColumnDef[] = [
        col('km', 'Km', 'betrag', 'distance_km'),
        col('unit', 'Preis', 'betrag', 'unit_price'),
        col('tax', 'MwSt', 'percent', 'tax_rate'),
        col('net', 'Netto', 'betrag', 'net_amount'),
        col('taxAmt', 'MwSt-Betrag', 'betrag', 'tax_amount'),
        col('gross', 'Brutto', 'betrag', 'gross_amount')
      ];

      const row = { km: 1, unit: 100, tax: 19 };
      const patch = computeRow(row, columns);
      expect(patch.net).toBe(100);
      expect(patch.taxAmt).toBeCloseTo(19);
      expect(patch.gross).toBeCloseTo(119);
    });
  });

  it('isComputedColumn — true for computed roles, false for input roles', () => {
    expect(isComputedColumn(col('a', 'Netto', 'betrag', 'net_amount'))).toBe(
      true
    );
    expect(isComputedColumn(col('b', 'MwSt', 'betrag', 'tax_amount'))).toBe(
      true
    );
    expect(isComputedColumn(col('c', 'Brutto', 'betrag', 'gross_amount'))).toBe(
      true
    );
    expect(isComputedColumn(col('d', 'Km', 'betrag', 'distance_km'))).toBe(
      false
    );
    expect(isComputedColumn(col('e', '—', 'notiz', null))).toBe(false);
  });

  it('computeAngebotTotals — sums net/tax/gross across rows', () => {
    const columns: AngebotColumnDef[] = [
      col('net', 'Netto', 'betrag', 'net_amount'),
      col('tax', 'MwSt', 'betrag', 'tax_amount'),
      col('gross', 'Brutto', 'betrag', 'gross_amount')
    ];
    const rows = [
      { net: 10, tax: 1.9, gross: 11.9 },
      { net: 20, tax: 3.8, gross: 23.8 },
      { net: 30, tax: 5.7, gross: 35.7 }
    ];
    const totals = computeAngebotTotals(rows, columns);
    expect(totals.netTotal).toBe(60);
    expect(totals.taxTotal).toBeCloseTo(11.4);
    expect(totals.grossTotal).toBeCloseTo(71.4);
  });

  it('computeAngebotTotals — no net_amount column → netTotal null', () => {
    const columns: AngebotColumnDef[] = [
      col('tax', 'MwSt', 'betrag', 'tax_amount'),
      col('gross', 'Brutto', 'betrag', 'gross_amount')
    ];
    const rows = [{ tax: 1.9, gross: 11.9 }];
    const totals = computeAngebotTotals(rows, columns);
    expect(totals.netTotal).toBeNull();
  });

  describe('computeAngebotTotals — schema-independent', () => {
    it('schema without computed-role columns: sums synthetic keys', () => {
      const columns: AngebotColumnDef[] = [
        col('unit', 'Preis', 'betrag', 'unit_price'),
        col('tax', 'MwSt', 'percent', 'tax_rate')
      ];
      const rows = [
        {
          [SYNTHETIC_NET_KEY]: 10,
          [SYNTHETIC_TAX_KEY]: 1.9,
          [SYNTHETIC_GROSS_KEY]: 11.9
        },
        {
          [SYNTHETIC_NET_KEY]: 20,
          [SYNTHETIC_TAX_KEY]: 3.8,
          [SYNTHETIC_GROSS_KEY]: 23.8
        }
      ];
      const totals = computeAngebotTotals(rows, columns);
      expect(totals.netTotal).toBe(30);
      expect(totals.taxTotal).toBeCloseTo(5.7);
      expect(totals.grossTotal).toBeCloseTo(35.7);
    });

    it('schema with role columns: synthetic and role agree', () => {
      const columns: AngebotColumnDef[] = [
        col('net', 'Netto', 'betrag', 'net_amount'),
        col('tax', 'MwSt', 'betrag', 'tax_amount'),
        col('gross', 'Brutto', 'betrag', 'gross_amount')
      ];
      const rows = [
        {
          net: 10,
          tax: 1.9,
          gross: 11.9,
          [SYNTHETIC_NET_KEY]: 10,
          [SYNTHETIC_TAX_KEY]: 1.9,
          [SYNTHETIC_GROSS_KEY]: 11.9
        },
        {
          net: 20,
          tax: 3.8,
          gross: 23.8,
          [SYNTHETIC_NET_KEY]: 20,
          [SYNTHETIC_TAX_KEY]: 3.8,
          [SYNTHETIC_GROSS_KEY]: 23.8
        }
      ];
      const totals = computeAngebotTotals(rows, columns);
      expect(totals.netTotal).toBe(30);
      expect(totals.taxTotal).toBeCloseTo(5.7);
      expect(totals.grossTotal).toBeCloseTo(35.7);
    });

    it('gross-mode: synthetic keys reflect back-calculated values', () => {
      const columns: AngebotColumnDef[] = [
        col('km', 'Km', 'betrag', 'distance_km'),
        col('unit', 'Preis', 'betrag', 'unit_price'),
        col('tax', 'MwSt', 'percent', 'tax_rate')
      ];
      // gross unit_price 119 @19% with distance=1 => net=100, tax=19, gross=119
      const patch = computeRow({ km: 1, unit: 119, tax: 19 }, columns, 'gross');
      expect(patch[SYNTHETIC_NET_KEY]).toBeCloseTo(100);
      expect(patch[SYNTHETIC_TAX_KEY]).toBeCloseTo(19);
      expect(patch[SYNTHETIC_GROSS_KEY]).toBeCloseTo(119);
    });
  });

  /**
   * WHY: documents precedence — fallback applies only when the schema has no
   * `tax_rate` column; per-row finite `tax_rate` always wins.
   */
  it('computeRow — fallbackTaxRate when schema has no tax_rate column', () => {
    const columns: AngebotColumnDef[] = [
      col('km', 'Km', 'betrag', 'distance_km'),
      col('unit', 'Preis', 'betrag', 'unit_price')
    ];
    const row = { km: 10, unit: 2 };
    const fallbackPercent = 10;
    const patch = computeRow(row, columns, 'net', {
      fallbackTaxRate: fallbackPercent
    });
    expect(patch[SYNTHETIC_NET_KEY]).toBe(20);
    expect(patch[SYNTHETIC_TAX_KEY]).toBeCloseTo(2);
    expect(patch[SYNTHETIC_GROSS_KEY]).toBeCloseTo(22);
  });

  it('computeRow — per-row tax_rate beats fallbackTaxRate', () => {
    const columns: AngebotColumnDef[] = [
      col('km', 'Km', 'betrag', 'distance_km'),
      col('unit', 'Preis', 'betrag', 'unit_price'),
      col('tax', 'MwSt', 'percent', 'tax_rate')
    ];
    const row = { km: 10, unit: 2, tax: 7 };
    const higherFallbackPercent = 19;
    const patch = computeRow(row, columns, 'net', {
      fallbackTaxRate: higherFallbackPercent
    });
    expect(patch[SYNTHETIC_TAX_KEY]).toBeCloseTo(1.4);
    expect(patch[SYNTHETIC_GROSS_KEY]).toBeCloseTo(21.4);
  });

  it('computeRow — fallbackTaxRate ignored when tax_rate column exists but cell empty', () => {
    // WHY: documents scenario A — column present, cell null, fallback must not fire.
    const columns: AngebotColumnDef[] = [
      col('unit', 'Preis', 'betrag', 'unit_price'),
      col('km', 'KM', 'anzahl', 'distance_km'),
      col('tax', 'MwSt', 'betrag', 'tax_rate') // column exists
    ];
    const row = { unit: 2, km: 10, tax: null }; // cell empty
    const result = computeRow(row, columns, 'net', { fallbackTaxRate: 19 });
    // fallback must NOT apply — tax column exists, cell just empty
    expect(result[SYNTHETIC_TAX_KEY]).toBeNull();
    expect(result[SYNTHETIC_GROSS_KEY]).toBe(result[SYNTHETIC_NET_KEY]); // gross = net
  });

  it('computeRow — fallbackTaxRate still applies when no tax_rate column (scenario B)', () => {
    // WHY: confirms scenario B is unaffected by the schema check fix.
    const columns: AngebotColumnDef[] = [
      col('unit', 'Preis', 'betrag', 'unit_price'),
      col('km', 'KM', 'anzahl', 'distance_km')
      // no tax_rate column
    ];
    const row = { unit: 2, km: 10 };
    const result = computeRow(row, columns, 'net', { fallbackTaxRate: 19 });
    expect(result[SYNTHETIC_TAX_KEY]).toBeCloseTo(20 * 0.19);
    expect(result[SYNTHETIC_GROSS_KEY]).toBeCloseTo(20 * 1.19);
  });
});
