'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { cn } from '@/lib/utils';
import {
  isEffectivelyEmptyRichText,
  looksLikeRichTextHtml
} from '@/features/angebote/lib/angebot-rich-text';
import { templateContentToHtml } from './angebot-tiptap-field';

export interface AngebotPositionTextFieldProps {
  value: string | null | undefined;
  onChange: (html: string | null) => void;
  className?: string;
  'aria-label'?: string;
}

function normalizeInitialHtml(stored: string | null | undefined): string {
  const s = stored != null ? String(stored) : '';
  if (!s.trim()) return '<p></p>';
  if (looksLikeRichTextHtml(s)) return s;
  return templateContentToHtml(s);
}

/**
 * Single-line–sized Tiptap surface for table text columns. Bold via ⌘B / Ctrl+B
 * (StarterKit); no toolbar. Stored value is HTML like intro/outro.
 */
export function AngebotPositionTextField({
  value,
  onChange,
  className,
  'aria-label': ariaLabel
}: AngebotPositionTextFieldProps) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        bulletList: false,
        orderedList: false,
        strike: false,
        code: false,
        italic: false
      })
    ],
    content: normalizeInitialHtml(value),
    editorProps: {
      attributes: {
        class: cn(
          'max-w-none px-2 py-1 text-sm outline-none',
          '[&_p]:my-0 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0'
        ),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {})
      }
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      onChange(isEffectivelyEmptyRichText(html) ? null : html);
    }
  });

  return (
    <div
      className={cn(
        'angebot-position-text border-input bg-background ring-offset-background rounded-md border shadow-xs',
        'focus-within:border-ring focus-within:ring-ring focus-within:ring-2 focus-within:ring-offset-2',
        'min-h-8',
        className
      )}
    >
      {editor ? (
        <EditorContent editor={editor} />
      ) : (
        <div className='bg-muted/30 min-h-8 animate-pulse rounded-md' />
      )}
    </div>
  );
}
