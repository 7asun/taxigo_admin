/**
 * invoice-text-blocks.api.ts
 *
 * Supabase API service for the `invoice_text_blocks` table (Baukasten system).
 *
 * Responsibilities:
 *   - List all text blocks for the current company
 *   - Create, update, and delete text blocks
 *   - Set a block as the company default for its type
 *   - Fetch payer with linked text blocks
 *
 * Design rules:
 *   - All operations are scoped to the current user's company (RLS enforced)
 *   - Throws on error (React Query surfaces via isError)
 *   - Defaults are managed via is_default flag with partial unique index
 *
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type {
  InvoiceTextBlock,
  CreateInvoiceTextBlockInput,
  UpdateInvoiceTextBlockInput,
  GroupedTextBlocks
} from '../types/invoice-text-blocks.types';

// ─── List text blocks ────────────────────────────────────────────────────────

/**
 * Fetches all text blocks for the current user's company.
 * Returns blocks grouped by type (intro/outro) for easier UI consumption.
 *
 * @returns Grouped text blocks: { intro: [...], outro: [...] }
 */
export async function listInvoiceTextBlocks(): Promise<GroupedTextBlocks> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('invoice_text_blocks')
    .select('*')
    .order('name');

  if (error) throw toQueryError(error);

  const blocks = (data ?? []) as InvoiceTextBlock[];

  return {
    intro: blocks.filter((b) => b.type === 'intro'),
    outro: blocks.filter((b) => b.type === 'outro')
  };
}

/**
 * Fetches all text blocks as a flat array.
 * Useful for dropdowns where type is shown separately.
 */
export async function listAllInvoiceTextBlocks(): Promise<InvoiceTextBlock[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('invoice_text_blocks')
    .select('*')
    .order('name');

  if (error) throw toQueryError(error);

  return (data ?? []) as InvoiceTextBlock[];
}

// ─── Single text block ───────────────────────────────────────────────────────

/**
 * Fetches a single text block by ID.
 *
 * @param id - Text block UUID.
 * @throws If block not found or query fails.
 */
export async function getInvoiceTextBlock(
  id: string
): Promise<InvoiceTextBlock> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('invoice_text_blocks')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('Text block not found');

  return data as InvoiceTextBlock;
}

// ─── Create text block ───────────────────────────────────────────────────────

/**
 * Creates a new text block for the current company.
 *
 * @param input - The block data (name, type, content, optional is_default).
 * @returns The created block with generated id and timestamps.
 */
export async function createInvoiceTextBlock(
  input: CreateInvoiceTextBlockInput
): Promise<InvoiceTextBlock> {
  const supabase = createClient();

  // Get current user
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('Not authenticated');
  }

  // Get current user's company_id
  const { data: account } = await supabase
    .from('accounts')
    .select('company_id')
    .eq('id', user.id)
    .single();

  if (!account?.company_id) {
    throw new Error('User has no company assigned');
  }

  const { data, error } = await supabase
    .from('invoice_text_blocks')
    .insert({
      company_id: account.company_id,
      name: input.name,
      type: input.type,
      content: input.content,
      is_default: input.is_default ?? false
    })
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('Failed to create text block');

  return data as InvoiceTextBlock;
}

// ─── Update text block ───────────────────────────────────────────────────────

/**
 * Updates an existing text block.
 *
 * @param id - Text block UUID.
 * @param input - Partial update data (name, content, is_default).
 * @returns The updated block.
 */
export async function updateInvoiceTextBlock(
  id: string,
  input: UpdateInvoiceTextBlockInput
): Promise<InvoiceTextBlock> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('invoice_text_blocks')
    .update({
      name: input.name,
      content: input.content,
      is_default: input.is_default,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('Failed to update text block');

  return data as InvoiceTextBlock;
}

// ─── Delete text block ───────────────────────────────────────────────────────

/**
 * Deletes a text block by ID.
 * Note: Payers referencing this block will have their FK set to NULL (ON DELETE SET NULL).
 *
 * @param id - Text block UUID.
 */
export async function deleteInvoiceTextBlock(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('invoice_text_blocks')
    .delete()
    .eq('id', id);

  if (error) throw toQueryError(error);
}

// ─── Set as default ────────────────────────────────────────────────────────────

/**
 * Sets a text block as the company default for its type.
 * Automatically removes default status from any other block of the same type.
 *
 * @param id - Text block UUID.
 */
export async function setInvoiceTextBlockAsDefault(id: string): Promise<void> {
  const supabase = createClient();

  // Get the block's type first
  const { data: block, error: fetchError } = await supabase
    .from('invoice_text_blocks')
    .select('type')
    .eq('id', id)
    .single();

  if (fetchError) throw toQueryError(fetchError);
  if (!block) throw new Error('Text block not found');

  // Set this block as default
  const { error } = await supabase
    .from('invoice_text_blocks')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw toQueryError(error);
}

// ─── Payer text block links ──────────────────────────────────────────────────

/**
 * Fetches a payer with their linked default text blocks.
 *
 * @param payerId - Payer UUID.
 * @returns Payer with joined intro/outro blocks.
 */
export async function getPayerWithTextBlocks(
  payerId: string
): Promise<{
  default_intro_block: InvoiceTextBlock | null;
  default_outro_block: InvoiceTextBlock | null;
}> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from('payers')
    .select(
      `
      default_intro_block_id,
      default_outro_block_id,
      default_intro_block:invoice_text_blocks!default_intro_block_id(*),
      default_outro_block:invoice_text_blocks!default_outro_block_id(*)
    `
    )
    .eq('id', payerId)
    .single();

  if (error) throw toQueryError(error);

  // Supabase joins return arrays; take first element or null
  const introBlock = Array.isArray(data?.default_intro_block)
    ? data.default_intro_block[0]
    : data?.default_intro_block;
  const outroBlock = Array.isArray(data?.default_outro_block)
    ? data.default_outro_block[0]
    : data?.default_outro_block;

  return {
    default_intro_block: (introBlock as InvoiceTextBlock | undefined) ?? null,
    default_outro_block: (outroBlock as InvoiceTextBlock | undefined) ?? null
  };
}

/**
 * Updates a payer's default text block assignments.
 *
 * @param payerId - Payer UUID.
 * @param introBlockId - UUID of intro block, or null to clear.
 * @param outroBlockId - UUID of outro block, or null to clear.
 */
export async function updatePayerTextBlocks(
  payerId: string,
  introBlockId: string | null,
  outroBlockId: string | null
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from('payers')
    .update({
      default_intro_block_id: introBlockId,
      default_outro_block_id: outroBlockId
    })
    .eq('id', payerId);

  if (error) throw toQueryError(error);
}
