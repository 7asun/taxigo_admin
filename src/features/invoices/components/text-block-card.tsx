/**
 * text-block-card.tsx
 *
 * Card component displaying a single text block with actions.
 *
 * Features:
 *   - Shows name, content preview, and default badge
 *   - Edit, delete, and "set as default" actions
 *   - Visual distinction for default blocks
 *
 * @example
 * ```tsx
 * <TextBlockCard
 *   block={textBlock}
 *   onEdit={() => setEditingBlock(block)}
 *   onDelete={() => handleDelete(block.id)}
 *   onSetDefault={() => handleSetDefault(block.id)}
 * />
 * ```
 */

'use client';

import { Star, Pencil, Trash2, MoreVertical } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { InvoiceTextBlock } from '@/features/invoices/types/invoice-text-blocks.types';

interface TextBlockCardProps {
  /** The text block to display. */
  block: InvoiceTextBlock;

  /** Called when user clicks edit. */
  onEdit: () => void;

  /** Called when user clicks delete. */
  onDelete: () => void;

  /** Called when user clicks "set as default". */
  onSetDefault: () => void;
}

/**
 * Card component for a text block with preview and actions.
 */
export function TextBlockCard({
  block,
  onEdit,
  onDelete,
  onSetDefault
}: TextBlockCardProps) {
  const contentPreview = block.content.slice(0, 150);
  const hasMore = block.content.length > 150;

  return (
    <div
      className={`relative rounded-lg border p-4 ${
        block.is_default
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card'
      }`}
    >
      {/* Default Badge */}
      {block.is_default && (
        <Badge className='absolute top-4 right-4 gap-1' variant='default'>
          <Star className='h-3 w-3' />
          Standard
        </Badge>
      )}

      {/* Header */}
      <div className='mb-2 pr-24'>
        <h3 className='font-semibold'>{block.name}</h3>
        <p className='text-muted-foreground text-xs'>
          {block.type === 'intro' ? 'Einleitung' : 'Schlussformel'}
        </p>
      </div>

      {/* Content Preview */}
      <p className='text-muted-foreground text-sm leading-relaxed'>
        {contentPreview}
        {hasMore && '...'}
      </p>

      {/* Actions */}
      <div className='mt-4 flex items-center justify-between'>
        {!block.is_default && (
          <Button
            variant='outline'
            size='sm'
            onClick={onSetDefault}
            className='gap-1'
          >
            <Star className='h-3 w-3' />
            Als Standard setzen
          </Button>
        )}
        {block.is_default && <div />}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon'>
              <MoreVertical className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={onEdit} className='gap-2'>
              <Pencil className='h-4 w-4' />
              Bearbeiten
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className='text-destructive gap-2'
            >
              <Trash2 className='h-4 w-4' />
              Löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
