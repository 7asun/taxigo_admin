'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Underline as UnderlineIcon
} from 'lucide-react';

import { Label } from '@/components/ui/label';
import { Toggle } from '@/components/ui/toggle';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface AngebotTiptapFieldProps {
  id?: string;
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholder: string;
  templateBlocks?: { id: string; label: string; content: string }[];
}

/** Wrap plain template text as HTML for Tiptap; leave existing HTML as-is. */
export function templateContentToHtml(content: string): string {
  const t = content.trim();
  if (!t) return '<p></p>';
  if (/<[a-z][\s\S]*>/i.test(t)) return t;
  const escaped = t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n/g, '<br />')}</p>`;
}

export function AngebotTiptapField({
  id,
  label,
  value,
  onChange,
  placeholder,
  templateBlocks = []
}: AngebotTiptapFieldProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false
      }),
      Underline,
      Placeholder.configure({ placeholder })
    ],
    content: value?.trim() ? value : '<p></p>',
    editorProps: {
      attributes: {
        class: cn(
          'max-w-none px-3 py-2 text-sm leading-relaxed outline-none',
          'min-h-[120px] [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5',
          '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0'
        )
      }
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    }
  });

  return (
    <div className='space-y-1.5'>
      <div className='flex items-center justify-between gap-2'>
        <Label htmlFor={id}>{label}</Label>
        {templateBlocks.length > 0 && editor ? (
          <TemplatePickerButton
            blocks={templateBlocks}
            onSelect={(content) => {
              const html = templateContentToHtml(content);
              editor.chain().focus().setContent(html).run();
              onChange(html);
            }}
          />
        ) : null}
      </div>
      <div
        className={cn(
          'angebot-tiptap border-input bg-background ring-offset-background rounded-md border shadow-xs',
          'focus-within:border-ring focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-2'
        )}
      >
        {editor ? (
          <>
            <div
              role='toolbar'
              aria-label='Formatierung'
              className='border-border flex flex-wrap items-center gap-0.5 border-b p-1'
            >
              <Toggle
                size='sm'
                pressed={editor.isActive('bold')}
                onPressedChange={() =>
                  editor.chain().focus().toggleBold().run()
                }
                aria-label='Fett'
              >
                <Bold className='h-3.5 w-3.5' />
              </Toggle>
              <Toggle
                size='sm'
                pressed={editor.isActive('italic')}
                onPressedChange={() =>
                  editor.chain().focus().toggleItalic().run()
                }
                aria-label='Kursiv'
              >
                <Italic className='h-3.5 w-3.5' />
              </Toggle>
              <Toggle
                size='sm'
                pressed={editor.isActive('underline')}
                onPressedChange={() =>
                  editor.chain().focus().toggleUnderline().run()
                }
                aria-label='Unterstrichen'
              >
                <UnderlineIcon className='h-3.5 w-3.5' />
              </Toggle>
              <Toggle
                size='sm'
                pressed={editor.isActive('bulletList')}
                onPressedChange={() =>
                  editor.chain().focus().toggleBulletList().run()
                }
                aria-label='Aufzählung'
              >
                <List className='h-3.5 w-3.5' />
              </Toggle>
              <Toggle
                size='sm'
                pressed={editor.isActive('orderedList')}
                onPressedChange={() =>
                  editor.chain().focus().toggleOrderedList().run()
                }
                aria-label='Nummerierte Liste'
              >
                <ListOrdered className='h-3.5 w-3.5' />
              </Toggle>
            </div>
            <div className='max-h-[280px] overflow-y-auto'>
              <EditorContent editor={editor} />
            </div>
          </>
        ) : (
          <div className='bg-muted/30 min-h-[120px] animate-pulse rounded-b-md' />
        )}
      </div>
    </div>
  );
}

interface TemplatePickerButtonProps {
  blocks: { id: string; label: string; content: string }[];
  onSelect: (content: string) => void;
}

function TemplatePickerButton({ blocks, onSelect }: TemplatePickerButtonProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type='button' variant='ghost' size='sm' className='h-7 text-xs'>
          Vorlage verwenden
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-64 p-1' align='end'>
        {blocks.map((block) => (
          <button
            key={block.id}
            type='button'
            className='hover:bg-accent text-foreground w-full rounded-sm px-3 py-2 text-left text-sm transition-colors'
            onClick={() => onSelect(block.content)}
          >
            {block.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
