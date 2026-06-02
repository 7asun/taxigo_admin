/**
 * Sparkasse / CAMT052 semicolon CSV parsing for Zahlungsabgleich.
 * Pure functions — no Supabase or React.
 */

import Papa from 'papaparse';
import {
  InvalidBankCsvFormatError,
  type BankRow
} from '../types/reconciliation.types';

/** Noon UTC avoids Berlin TZ shifting date-only bank values on display. */
export const NOON_UTC_SUFFIX = 'T12:00:00.000Z';

const CSV_HEADER_AUFTRAGSKONTO = 'Auftragskonto';
const COL_BUCHUNGSTAG = 1;
const COL_VERWENDUNGSZWECK = 4;
const COL_BEGUENSTIGTER = 11;
const COL_BETRAG = 14;

// why: word boundaries prevent partial matches; legacy RE-YYYY-NNNN not handled (see module doc)
export const INVOICE_NUMBER_REGEX = /\bRE-\d{4}-\d{2}-\d{4}\b/g;

export function extractInvoiceNumbers(verwendungszweck: string): string[] {
  const matches = [
    ...verwendungszweck.matchAll(new RegExp(INVOICE_NUMBER_REGEX.source, 'g'))
  ].map((m) => m[0]);
  return [...new Set(matches)];
}

function parseGermanAmount(raw: string): number {
  const normalized = raw.trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(normalized);
}

function parseBuchungstagToIso(raw: string): string {
  const trimmed = raw.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new InvalidBankCsvFormatError(`Ungültiges Buchungsdatum: ${raw}`);
  }
  const day = parts[0].padStart(2, '0');
  const month = parts[1].padStart(2, '0');
  let year = parts[2];
  if (year.length === 2) {
    year = `20${year}`;
  }
  if (year.length !== 4) {
    throw new InvalidBankCsvFormatError(`Ungültiges Buchungsdatum: ${raw}`);
  }
  return `${year}-${month}-${day}${NOON_UTC_SUFFIX}`;
}

function rowToBankRow(cells: string[]): BankRow | null {
  const buchungstag = cells[COL_BUCHUNGSTAG]?.trim() ?? '';
  const verwendungszweck = cells[COL_VERWENDUNGSZWECK]?.trim() ?? '';
  const beguenstigter = cells[COL_BEGUENSTIGTER]?.trim() ?? '';
  const betragRaw = cells[COL_BETRAG]?.trim() ?? '';

  if (!buchungstag && !verwendungszweck && !betragRaw) {
    return null;
  }

  const betrag = parseGermanAmount(betragRaw);
  // why: outflows (Lastschriften, fees) are never inbound invoice payments
  if (!Number.isFinite(betrag) || betrag <= 0) {
    return null;
  }

  return {
    buchungstag,
    buchungstagISO: parseBuchungstagToIso(buchungstag),
    verwendungszweck,
    betrag,
    beguenstigter,
    rawLine: cells.join(';')
  };
}

export function parseBankCsvRows(rows: string[][]): BankRow[] {
  if (rows.length === 0) {
    throw new InvalidBankCsvFormatError();
  }

  const headerFirst = rows[0][0]?.trim();
  if (headerFirst !== CSV_HEADER_AUFTRAGSKONTO) {
    throw new InvalidBankCsvFormatError();
  }

  const dataRows = rows.slice(1);
  const result: BankRow[] = [];

  for (const cells of dataRows) {
    const bankRow = rowToBankRow(cells);
    if (bankRow) {
      result.push(bankRow);
    }
  }

  return result;
}

export function parseBankCsv(file: File): Promise<BankRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      delimiter: ';',
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          resolve(parseBankCsvRows(results.data));
        } catch (err) {
          reject(err);
        }
      },
      error: (err) => {
        reject(err);
      }
    });
  });
}

export function collectExtractedNumbers(bankRows: BankRow[]): string[] {
  const all = bankRows.flatMap((row) =>
    extractInvoiceNumbers(row.verwendungszweck)
  );
  return [...new Set(all)];
}
