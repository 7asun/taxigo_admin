/**
 * text-block-form.tsx
 *
 * Form component for creating and editing invoice text blocks.
 *
 * Features:
 *   - Name input (required, max 100 chars)
 *   - Type selection (intro/outro) - only for create mode
 *   - Content textarea with character count
 *   - Default checkbox
 *   - Validation with React Hook Form + Zod
 *
 * @example
 * ```tsx
 * // Create mode
 * <TextBlockForm onSuccess={() => setIsOpen(false)} />
 *
 * // Edit mode
 * <TextBlockForm block={existingBlock} onSuccess={() => setIsOpen(false)} />
 * ```
 */

'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';

import {
  useCreateInvoiceTextBlock,
  useUpdateInvoiceTextBlock
} from '@/features/invoices/hooks/use-invoice-text-blocks';
import { usePayers } from '@/features/payers/hooks/use-payers';
import { createClient } from '@/lib/supabase/client';
import type { InvoiceTextBlock } from '@/features/invoices/types/invoice-text-blocks.types';

/**
 * Validation schema for text block form.
 * Enforces minimum content length and maximum name length.
 */
const formSchema = z.object({
  name: z
    .string()
    .min(1, 'Name ist erforderlich')
    .max(100, 'Maximal 100 Zeichen'),
  type: z.enum(['intro', 'outro']),
  content: z
    .string()
    .min(10, 'Mindestens 10 Zeichen')
    .max(2000, 'Maximal 2000 Zeichen'),
  is_default: z.boolean(),
  link_to_payer_id: z.string().optional()
});

type FormValues = z.infer<typeof formSchema>;

interface TextBlockFormProps {
  /** Existing block for edit mode. If undefined, form is in create mode. */
  block?: InvoiceTextBlock;

  /** Called when form submission succeeds. */
  onSuccess: () => void;

  /** Called when user cancels the form. */
  onCancel: () => void;
}

/**
 * Form for creating or editing invoice text blocks.
 */
export function TextBlockForm({
  block,
  onSuccess,
  onCancel
}: TextBlockFormProps) {
  const createMutation = useCreateInvoiceTextBlock();
  const updateMutation = useUpdateInvoiceTextBlock();
  const { data: payers, isLoading: isLoadingPayers } = usePayers();

  const isEditMode = !!block;
  const isPending = createMutation.isPending || updateMutation.isPending;

  const form = useForm<FormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(formSchema) as any,
    defaultValues: {
      name: block?.name ?? '',
      type: block?.type ?? 'intro',
      content: block?.content ?? '',
      is_default: block?.is_default ?? false,
      link_to_payer_id: ''
    }
  });

  const contentValue = form.watch('content');
  const contentLength = contentValue?.length ?? 0;

  async function onSubmit(values: FormValues) {
    try {
      if (isEditMode && block) {
        await updateMutation.mutateAsync({
          id: block.id,
          input: {
            name: values.name,
            content: values.content,
            is_default: values.is_default
          }
        });
      } else {
        // Create the text block
        const newBlock = await createMutation.mutateAsync({
          name: values.name,
          type: values.type,
          content: values.content,
          is_default: values.is_default
        });

        // Link to payer if selected
        if (values.link_to_payer_id) {
          const supabase = createClient();
          const updateData =
            values.type === 'intro'
              ? { default_intro_block_id: newBlock.id }
              : { default_outro_block_id: newBlock.id };

          await supabase
            .from('payers')
            .update(updateData)
            .eq('id', values.link_to_payer_id);
        }
      }
      onSuccess();
    } catch {
      // Error is handled by the mutation's onError callback
    }
  }

  return (
    <Form
      form={form}
      onSubmit={form.handleSubmit(onSubmit)}
      className='space-y-6'
    >
      {/* Name Field */}
      <FormField
        control={form.control}
        name='name'
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                placeholder='z. B. Standard, Förmlich-Behörde...'
                maxLength={100}
                {...field}
              />
            </FormControl>
            <FormDescription>
              Ein aussagekräftiger Name zur Unterscheidung im Dropdown.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Type Field - Only in create mode */}
      {!isEditMode && (
        <FormField
          control={form.control}
          name='type'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Typ</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder='Typ wählen...' />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value='intro'>Einleitung</SelectItem>
                  <SelectItem value='outro'>Schlussformel</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                Einleitungen erscheinen vor den Positionen, Schlussformeln
                danach.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {/* Content Field */}
      <FormField
        control={form.control}
        name='content'
        render={({ field }) => (
          <FormItem>
            <FormLabel>Text</FormLabel>
            <FormControl>
              <Textarea
                placeholder='Geben Sie hier den Text ein...'
                className='min-h-[150px] resize-y'
                maxLength={2000}
                {...field}
              />
            </FormControl>
            <div className='flex items-center justify-between'>
              <FormDescription>
                Der Text wird unverändert in die Rechnung eingefügt (nach der
                Anrede).
              </FormDescription>
              <span
                className={`text-xs ${
                  contentLength > 1900
                    ? 'text-destructive'
                    : 'text-muted-foreground'
                }`}
              >
                {contentLength}/2000
              </span>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Default Checkbox */}
      <FormField
        control={form.control}
        name='is_default'
        render={({ field }) => (
          <FormItem className='flex flex-row items-start space-y-0 space-x-3 rounded-md border p-4'>
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </FormControl>
            <div className='space-y-1 leading-none'>
              <FormLabel>Als Standard verwenden</FormLabel>
              <FormDescription>
                Diese Vorlage wird verwendet, wenn bei einem Kostenträger keine
                spezifische Vorlage hinterlegt ist.
              </FormDescription>
            </div>
          </FormItem>
        )}
      />

      {/* Link to Payer - Only in create mode */}
      {!isEditMode && (
        <FormField
          control={form.control}
          name='link_to_payer_id'
          render={({ field }) => (
            <FormItem>
              <FormLabel className='flex items-center gap-2'>
                <Users className='h-4 w-4' />
                Kostenträger zuweisen
              </FormLabel>
              <FormControl>
                <Select
                  value={field.value || 'none'}
                  onValueChange={(val) =>
                    field.onChange(val === 'none' ? '' : val)
                  }
                  disabled={isLoadingPayers || isPending}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder='Kostenträger wählen (optional)' />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='none'>Keiner</SelectItem>
                    {payers?.map((payer) => (
                      <SelectItem key={payer.id} value={payer.id}>
                        {payer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormDescription>
                Diese Vorlage wird direkt dem Kostenträger als Standard
                zugewiesen.
              </FormDescription>
            </FormItem>
          )}
        />
      )}

      {/* Actions */}
      <div className='flex justify-end gap-3 pt-2'>
        <Button
          type='button'
          variant='outline'
          onClick={onCancel}
          disabled={isPending}
        >
          Abbrechen
        </Button>
        <Button type='submit' disabled={isPending}>
          {isPending && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {isEditMode ? 'Speichern' : 'Erstellen'}
        </Button>
      </div>
    </Form>
  );
}
