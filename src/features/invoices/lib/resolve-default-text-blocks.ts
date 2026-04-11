/**
 * resolveDefaultTextBlockIds
 *
 * Resolves the default intro/outro text block IDs for a new invoice being
 * drafted in the builder. This is for UI DEFAULT PRE-SELECTION ONLY.
 *
 * Priority order (highest → lowest):
 *   1. resolvedVorlage.intro_block_id / outro_block_id  (Vorlage-level — Phase 10)
 *   2. payer.default_intro_block_id / default_outro_block_id  (payer-level)
 *   3. companyDefaultBlocks (invoice_text_blocks WHERE is_default = true)
 *   4. null (no pre-selection; hardcoded fallback text used at PDF render time)
 *
 * IMPORTANT: This function is used only for pre-populating builder Step 4/5
 * defaults. It does NOT affect already-issued invoices. Issued invoices freeze
 * their own intro_block_id / outro_block_id snapshot at creation time per
 * §14 UStG — those are immutable and must never be derived from this function.
 */

import type { PdfVorlageRow } from '@/features/invoices/types/pdf-vorlage.types';
import type { GroupedTextBlocks } from '@/features/invoices/types/invoice-text-blocks.types';

export function resolveDefaultTextBlockIds(
  resolvedVorlage: PdfVorlageRow | null,
  payer: {
    default_intro_block_id: string | null;
    default_outro_block_id: string | null;
  } | null,
  companyDefaultBlocks: GroupedTextBlocks
): { introBlockId: string | null; outroBlockId: string | null } {
  const companyIntroDefault =
    companyDefaultBlocks.intro.find((b) => b.is_default)?.id ?? null;
  const companyOutroDefault =
    companyDefaultBlocks.outro.find((b) => b.is_default)?.id ?? null;

  const introBlockId =
    resolvedVorlage?.intro_block_id ??
    payer?.default_intro_block_id ??
    companyIntroDefault ??
    null;

  const outroBlockId =
    resolvedVorlage?.outro_block_id ??
    payer?.default_outro_block_id ??
    companyOutroDefault ??
    null;

  return { introBlockId, outroBlockId };
}
