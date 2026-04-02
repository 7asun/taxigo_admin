/**
 * invoice-templates-settings-page.tsx
 *
 * Settings page for managing invoice text blocks (Baukasten system).
 *
 * Features:
 *   - Display intro and outro text blocks in separate sections
 *   - Create, edit, and delete text blocks
 *   - Set a block as the company default
 *   - Preview blocks in PDF context
 *
 * @example
 * ```tsx
 * <InvoiceTemplatesSettingsPage />
 * ```
 */

'use client';

import { useState } from 'react';
import { Plus, Star, FileText } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';

import {
  useInvoiceTextBlocks,
  useDeleteInvoiceTextBlock,
  useSetDefaultInvoiceTextBlock
} from '@/features/invoices/hooks/use-invoice-text-blocks';
import { TextBlockForm } from './text-block-form';
import { TextBlockCard } from './text-block-card';
import type { InvoiceTextBlock } from '@/features/invoices/types/invoice-text-blocks.types';

/**
 * Main settings page component for invoice text templates.
 * Displays intro and outro sections with CRUD operations.
 */
export function InvoiceTemplatesSettingsPage() {
  const { data: groupedBlocks, isLoading, error } = useInvoiceTextBlocks();
  const deleteMutation = useDeleteInvoiceTextBlock();
  const setDefaultMutation = useSetDefaultInvoiceTextBlock();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState<InvoiceTextBlock | null>(
    null
  );

  const handleDelete = async (id: string) => {
    if (confirm('Möchten Sie diese Vorlage wirklich löschen?')) {
      await deleteMutation.mutateAsync(id);
    }
  };

  const handleSetDefault = async (id: string) => {
    await setDefaultMutation.mutateAsync(id);
  };

  if (isLoading) {
    return <InvoiceTemplatesSkeleton />;
  }

  if (error) {
    return (
      <div className='space-y-4'>
        <h1 className='text-2xl font-bold'>Rechnungsvorlagen</h1>
        <p className='text-destructive'>
          Fehler beim Laden der Vorlagen: {error.message}
        </p>
      </div>
    );
  }

  const introBlocks = groupedBlocks?.intro ?? [];
  const outroBlocks = groupedBlocks?.outro ?? [];

  return (
    <div className='space-y-8'>
      {/* Header */}
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>Rechnungsvorlagen</h1>
          <p className='text-muted-foreground mt-1'>
            Verwalten Sie wiederverwendbare Einleitungen und Schlussformeln für
            Ihre Rechnungen.
          </p>
        </div>

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className='gap-2'>
              <Plus className='h-4 w-4' />
              Neue Vorlage
            </Button>
          </DialogTrigger>
          <DialogContent className='max-w-2xl'>
            <DialogHeader>
              <DialogTitle>Neue Vorlage erstellen</DialogTitle>
              <DialogDescription>
                Erstellen Sie eine neue Einleitung oder Schlussformel für Ihre
                Rechnungen.
              </DialogDescription>
            </DialogHeader>
            <TextBlockForm
              onSuccess={() => setIsCreateDialogOpen(false)}
              onCancel={() => setIsCreateDialogOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Intro Section */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-2'>
            <FileText className='text-muted-foreground h-5 w-5' />
            <CardTitle>Einleitungen</CardTitle>
          </div>
          <CardDescription>
            Texte, die nach der Anrede und vor der Rechnungspositionstabelle
            erscheinen.
            {introBlocks.some((b) => b.is_default) && (
              <Badge variant='secondary' className='ml-2 gap-1'>
                <Star className='h-3 w-3' />
                Standard gesetzt
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {introBlocks.length === 0 ? (
            <EmptyState
              type='intro'
              onCreate={() => setIsCreateDialogOpen(true)}
            />
          ) : (
            introBlocks.map((block) => (
              <TextBlockCard
                key={block.id}
                block={block}
                onEdit={() => setEditingBlock(block)}
                onDelete={() => handleDelete(block.id)}
                onSetDefault={() => handleSetDefault(block.id)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Outro Section */}
      <Card>
        <CardHeader>
          <div className='flex items-center gap-2'>
            <FileText className='text-muted-foreground h-5 w-5' />
            <CardTitle>Schlussformeln</CardTitle>
          </div>
          <CardDescription>
            Texte, die nach der Zahlungsinformation und vor der Grußformel
            erscheinen.
            {outroBlocks.some((b) => b.is_default) && (
              <Badge variant='secondary' className='ml-2 gap-1'>
                <Star className='h-3 w-3' />
                Standard gesetzt
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {outroBlocks.length === 0 ? (
            <EmptyState
              type='outro'
              onCreate={() => setIsCreateDialogOpen(true)}
            />
          ) : (
            outroBlocks.map((block) => (
              <TextBlockCard
                key={block.id}
                block={block}
                onEdit={() => setEditingBlock(block)}
                onDelete={() => handleDelete(block.id)}
                onSetDefault={() => handleSetDefault(block.id)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog
        open={!!editingBlock}
        onOpenChange={(open) => !open && setEditingBlock(null)}
      >
        <DialogContent className='max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Vorlage bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeiten Sie die ausgewählte Vorlage.
            </DialogDescription>
          </DialogHeader>
          {editingBlock && (
            <TextBlockForm
              block={editingBlock}
              onSuccess={() => setEditingBlock(null)}
              onCancel={() => setEditingBlock(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Empty state component shown when no text blocks exist.
 */
function EmptyState({
  type,
  onCreate
}: {
  type: 'intro' | 'outro';
  onCreate: () => void;
}) {
  return (
    <div className='text-muted-foreground flex flex-col items-center justify-center py-8 text-center'>
      <FileText className='mb-2 h-8 w-8 opacity-50' />
      <p className='text-sm'>
        Keine {type === 'intro' ? 'Einleitungen' : 'Schlussformeln'} vorhanden.
      </p>
      <Button variant='link' size='sm' onClick={onCreate} className='mt-2'>
        Erste Vorlage erstellen
      </Button>
    </div>
  );
}

/**
 * Loading skeleton for the settings page.
 */
function InvoiceTemplatesSkeleton() {
  return (
    <div className='space-y-8'>
      <div className='flex items-center justify-between'>
        <div>
          <Skeleton className='h-8 w-48' />
          <Skeleton className='mt-2 h-4 w-72' />
        </div>
        <Skeleton className='h-10 w-32' />
      </div>

      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='h-4 w-96' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton className='h-24 w-full' />
          <Skeleton className='h-24 w-full' />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='h-4 w-96' />
        </CardHeader>
        <CardContent className='space-y-4'>
          <Skeleton className='h-24 w-full' />
        </CardContent>
      </Card>
    </div>
  );
}
