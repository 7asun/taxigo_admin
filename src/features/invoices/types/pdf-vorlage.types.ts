/**
 * pdf-vorlage.types.ts
 *
 * Row and payload types for PDF column Vorlagen (templates) and the resolved
 * in-memory profile used by the PDF pipeline.
 *
 * Must NOT duplicate column keys — Zod schemas import VALID_COLUMN_KEYS from
 * {@link pdf-column-catalog.ts} only.
 */

import { z } from 'zod';

import {
  VALID_COLUMN_KEYS,
  type PdfColumnKey
} from '@/features/invoices/lib/pdf-column-catalog';

export type MainLayout =
  | 'grouped'
  | 'flat'
  | 'single_row'
  | 'grouped_by_billing_type';

/** DB row: pdf_vorlagen */
export interface PdfVorlageRow {
  /** pdf_vorlagen.id */
  id: string;
  /** pdf_vorlagen.company_id — FK company_profiles.company_id */
  company_id: string;
  /** pdf_vorlagen.name */
  name: string;
  /** pdf_vorlagen.description */
  description: string | null;
  /** pdf_vorlagen.main_columns — ordered PdfColumnKey[] */
  main_columns: PdfColumnKey[];
  /** pdf_vorlagen.appendix_columns — ordered PdfColumnKey[] */
  appendix_columns: PdfColumnKey[];
  /** pdf_vorlagen.main_layout — grouped, single summary row, or flat per trip (appendix always flat) */
  main_layout: MainLayout;
  /** pdf_vorlagen.is_default — at most one true per company (partial unique index) */
  is_default: boolean;
  /**
   * Optional FK to `invoice_text_blocks` (type intro). Builder default only;
   * null falls back to payer then company default text blocks.
   */
  intro_block_id: string | null;
  /**
   * Optional FK to `invoice_text_blocks` (type outro). Same resolution order as
   * `intro_block_id`.
   */
  outro_block_id: string | null;
  /** pdf_vorlagen.created_at */
  created_at: string;
  /** pdf_vorlagen.updated_at */
  updated_at: string;
}

const pdfColumnKeySchema = z.enum(VALID_COLUMN_KEYS);

export const pdfColumnKeyArraySchema = z
  .array(pdfColumnKeySchema)
  .min(1, 'Mindestens eine Spalte erforderlich');

const mainLayoutSchema = z.enum([
  'grouped',
  'flat',
  'single_row',
  'grouped_by_billing_type'
]);

/** Validates invoices.pdf_column_override JSON before persist. */
export const pdfColumnOverrideSchema = z.object({
  main_columns: pdfColumnKeyArraySchema,
  appendix_columns: pdfColumnKeyArraySchema,
  main_layout: mainLayoutSchema.optional()
});

export type PdfColumnOverridePayload = z.infer<typeof pdfColumnOverrideSchema>;

/** Resolved profile — not stored; computed at read/build time. */
export interface PdfColumnProfile {
  main_columns: PdfColumnKey[];
  appendix_columns: PdfColumnKey[];
  /** Main page table mode — from Vorlage, override, or 'grouped' for system fallback. */
  main_layout: MainLayout;
  /** True when appendix column count exceeds APPENDIX_LANDSCAPE_THRESHOLD */
  appendix_is_landscape: boolean;
  /** Which step in the 4-level chain supplied the columns */
  source: 'invoice_override' | 'payer_vorlage' | 'company_default' | 'system';
}

export interface PdfVorlageCreatePayload {
  companyId: string;
  name: string;
  description?: string | null;
  main_columns: PdfColumnKey[];
  appendix_columns: PdfColumnKey[];
  is_default?: boolean;
}

export interface PdfVorlageUpdatePayload {
  name?: string;
  description?: string | null;
  main_columns?: PdfColumnKey[];
  appendix_columns?: PdfColumnKey[];
  main_layout?: MainLayout;
  is_default?: boolean;
  intro_block_id?: string | null;
  outro_block_id?: string | null;
}
