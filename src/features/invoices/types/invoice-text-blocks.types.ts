/**
 * invoice-text-blocks.types.ts
 *
 * TypeScript types for the invoice text blocks (Baukasten) system.
 *
 * This module defines the shape of reusable intro/outro text blocks
 * stored in the `invoice_text_blocks` table.
 *
 * Fallback chain for PDF generation:
 *   1. Payer-specific block (if set on payers.default_intro_block_id / default_outro_block_id)
 *   2. Company default block (invoice_text_blocks.is_default = true)
 *   3. Hardcoded fallback text in InvoicePdfCoverBody
 *
 * @example
 * ```typescript
 * const block: InvoiceTextBlock = {
 *   id: 'uuid',
 *   company_id: 'uuid',
 *   name: 'Standard',
 *   type: 'intro',
 *   content: 'Sehr geehrte Damen und Herren...',
 *   is_default: true
 * };
 * ```
 */

/**
 * A reusable text block for invoice PDFs.
 * Stored in the `invoice_text_blocks` table.
 */
export interface InvoiceTextBlock {
  /** Primary key. Unique identifier for the text block. */
  id: string;

  /** FK to company_profiles. Multi-tenant scope: each block belongs to one company. */
  company_id: string;

  /** Human-readable template name (e.g., "Standard", "Förmlich-Behörde"). Shown in dropdowns. */
  name: string;

  /** Block type: 'intro' for Einleitung, 'outro' for Schlussformel. */
  type: 'intro' | 'outro';

  /** The actual text content rendered in PDF (with salutation prefix). */
  content: string;

  /** If true, this is the company-wide default for its type. */
  is_default: boolean;

  /** Timestamp when the block was created. */
  created_at: string;

  /** Timestamp when the block was last modified. NULL if never updated. */
  updated_at: string | null;
}

/**
 * Payload for creating a new text block.
 * Excludes auto-generated fields (id, created_at, updated_at).
 */
export interface CreateInvoiceTextBlockInput {
  /** Human-readable template name. Must be unique per type per company. */
  name: string;

  /** Block type: 'intro' or 'outro'. */
  type: 'intro' | 'outro';

  /** The actual text content. UI enforces max 2000 chars. */
  content: string;

  /** If true, set as company default for this type. */
  is_default?: boolean;
}

/**
 * Payload for updating an existing text block.
 * All fields are optional partial updates.
 */
export interface UpdateInvoiceTextBlockInput {
  /** Human-readable template name. Must be unique per type per company. */
  name?: string;

  /** The actual text content. UI enforces max 2000 chars. */
  content?: string;

  /** If true, set as company default for this type (removes default from others). */
  is_default?: boolean;
}

/**
 * Extended payer type with linked text blocks.
 * Used when fetching payer details with their preferred intro/outro blocks.
 */
export interface PayerWithTextBlocks {
  /** FK to invoice_text_blocks. Preferred intro text for invoices to this payer. NULL = use company default. */
  default_intro_block_id: string | null;

  /** FK to invoice_text_blocks. Preferred outro text for invoices to this payer. NULL = use company default. */
  default_outro_block_id: string | null;

  /** The linked intro block (joined). NULL if not set or not found. */
  default_intro_block?: InvoiceTextBlock | null;

  /** The linked outro block (joined). NULL if not set or not found. */
  default_outro_block?: InvoiceTextBlock | null;
}

/**
 * Grouped text blocks by type.
 * Useful for displaying intro/outro sections separately in the UI.
 */
export interface GroupedTextBlocks {
  /** All intro (Einleitung) text blocks for the company. */
  intro: InvoiceTextBlock[];

  /** All outro (Schlussformel) text blocks for the company. */
  outro: InvoiceTextBlock[];
}
