# Audit — Angebot (Quote) Builder Intro/Outro List Rendering

**Status:** **Done (v3/v4)** — see [Resolution](#resolution) (`preprocessHtmlForPdf` + Tiptap `<li><p>` handling).

**Date:** 2026-05-18  
**Scope:** Original audit was read-only; follow-ups changed Angebot PDF intro/outro list rendering only (`AngebotPdfCoverBody.tsx`).

**Naming note:** There is no symbol or filename containing `QuoteWizard`. The offer/quote flow is the **Angebot** builder: `src/features/angebote/components/angebot-builder/`. Related `app/` routes: `src/app/dashboard/angebote/new/page.tsx`, `[id]/edit/page.tsx`, `[id]/page.tsx`.

---

## Files reviewed (intro / outro / Step 3 / builder / PDF)

| Area | Path |
|------|------|
| Wizard shell | `src/features/angebote/components/angebot-builder/index.tsx` |
| Step 3 (Details) | `src/features/angebote/components/angebot-builder/step-3-details.tsx` |
| Rich text field | `src/features/angebote/components/angebot-builder/angebot-tiptap-field.tsx` |
| PDF preview hook | `src/features/angebote/components/angebot-builder/use-angebot-builder-pdf-preview.tsx` |
| PDF document root | `src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx` |
| PDF body (intro/outro) | `src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx` |
| Shared PDF panel (iframe) | `src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx` |
| Detail page (no intro HTML) | `src/features/angebote/components/angebot-detail-view.tsx` |
| Types | `src/features/angebote/types/angebot.types.ts` |
| API mapping | `src/features/angebote/api/angebote.api.ts` |
| Shared PDF styles | `src/features/invoices/components/invoice-pdf/pdf-styles.ts` |
| Global CSS (Tiptap placeholder) | `src/styles/globals.css` |
| DB | `supabase/migrations/20260409150000_create_angebote.sql`, `20260401190000_create_invoice_text_blocks.sql` |

---

## 1. Data format

**Format:** Intro/outro are stored as **HTML strings** produced by Tiptap (`editor.getHTML()`), not ProseMirror JSON, not a separate structured document type in the database.

**TypeScript** (`AngebotRow`):

```144:145:src/features/angebote/types/angebot.types.ts
  intro_text: string | null;
  outro_text: string | null;
```

**Supabase / PostgreSQL** (`angebote` table):

```41:43:supabase/migrations/20260409150000_create_angebote.sql
  -- Text content (shared invoice_text_blocks table for intro/outro)
  intro_text              TEXT,
  outro_text              TEXT,
```

**API layer** coerces DB values to string or null:

```157:158:src/features/angebote/api/angebote.api.ts
    intro_text: raw.intro_text == null ? null : String(raw.intro_text),
    outro_text: raw.outro_text == null ? null : String(raw.outro_text),
```

**Template library:** `invoice_text_blocks.content` is also `TEXT` (plain/HTML at discretion of UI; Angebot Step 3 injects template `content` into Tiptap via `templateContentToHtml`):

```39:41:supabase/migrations/20260401190000_create_invoice_text_blocks.sql
  -- The actual text content. Rendered as-is in PDF (with salutation prefix).
  -- Max practical length enforced by UI (2000 chars), no DB limit for flexibility.
  content               TEXT          NOT NULL,
```

---

## 2. Editor component (Step 3)

**Component:** **Tiptap** — `@tiptap/react` (`useEditor`, `EditorContent`) with `StarterKit` (lists not disabled), `@tiptap/extension-underline`, `@tiptap/extension-placeholder`.

**Serialisation on save / change:** `onUpdate` calls `editor.getHTML()` and passes that string up — standard HTML for bullet/ordered lists (`<ul>`, `<ol>`, `<li>`).

```55:80:src/features/angebote/components/angebot-builder/angebot-tiptap-field.tsx
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
```

**Step 3 wiring:**

```65:80:src/features/angebote/components/angebot-builder/step-3-details.tsx
      <AngebotTiptapField
        id='intro_text'
        label='Einleitung'
        value={values.intro_text}
        onChange={(html) => onChange({ intro_text: html })}
        placeholder='Einleitungstext eingeben…'
        templateBlocks={introBlocks}
      />

      <AngebotTiptapField
        id='outro_text'
        label='Schlussformel'
        value={values.outro_text}
        onChange={(html) => onChange({ outro_text: html })}
        placeholder='Schlussformel eingeben…'
        templateBlocks={outroBlocks}
      />
```

---

## 3. Quote preview rendering (intro/outro)

**Important:** The builder’s right-hand **“Vorschau”** is **not** a React HTML preview of intro/outro. It is a **PDF blob URL** from `@react-pdf/renderer`’s `usePDF`, rendered in an `<iframe>` (same as invoice PDF panel).

**Preview hook:**

```75:88:src/features/angebote/components/angebot-builder/use-angebot-builder-pdf-preview.tsx
  useEffect(() => {
    if (!draftAngebot || !companyProfileForDraft) return undefined;

    const t = window.setTimeout(() => {
      updatePdf(
        <AngebotPdfDocument
          angebot={draftAngebot}
          companyProfile={companyProfileForDraft}
        />
      );
    }, 600);

    return () => window.clearTimeout(t);
  }, [draftAngebot, companyProfileForDraft, updatePdf]);
```

**Intro/outro passed into the PDF body:**

```142:145:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
  const columnSchema = resolveAngebotPdfColumnSchema(angebot);

  const resolvedIntroText = introText ?? angebot.intro_text ?? null;
  const resolvedOutroText = outroText ?? angebot.outro_text ?? null;
```

```271:282:src/features/angebote/components/angebot-pdf/AngebotPdfDocument.tsx
          <AngebotPdfCoverBody
            subject={angebot.subject}
            recipientAnrede={angebot.recipient_anrede}
            recipientFirstName={angebot.recipient_first_name}
            recipientLastName={angebot.recipient_last_name}
            recipientLegacyName={angebot.recipient_name}
            lineItems={angebot.line_items}
            columnSchema={columnSchema}
            introText={resolvedIntroText}
            outroText={resolvedOutroText}
            totalsData={totalsData}
          />
```

**Angebot detail page (`AngebotDetailView`):** The UI **does not** render `intro_text` / `outro_text` as HTML or plain text in the main layout. The only `dangerouslySetInnerHTML` in that file is for **line-item table cells** when the cell value looks like rich HTML — not for intro/outro.

---

## 4. List styles in “preview” (Tailwind `prose`, `ul`/`ol`, padding)

**Builder PDF preview:** Styling is entirely **inside the PDF pipeline** (`react-pdf-html` + `StyleSheet`-like stylesheet), not Tailwind `prose` on a DOM wrapper.

**Intro/outro PDF stylesheet** (`ANGEBOT_HTML_STYLESHEET`) defines `ul` / `ol` **paddingLeft** and `li` margins, but **does not** set an explicit bullet/number **list-style** (e.g. `listStyleType`) on `ul`/`ol`:

```51:72:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
const ANGEBOT_HTML_STYLESHEET: HtmlStyles = {
  body: { ...HTML_PROSE, marginBottom: 0 },
  div: { ...HTML_PROSE, marginBottom: 0 },
  p: {
    ...HTML_PROSE,
    marginTop: 0,
    marginBottom: 8
  },
  li: {
    ...HTML_PROSE,
    marginBottom: 4
  },
  ul: { marginBottom: 8, paddingLeft: 10 },
  ol: { marginBottom: 8, paddingLeft: 10 },
  strong: { ...HTML_PROSE, fontWeight: 'bold' },
  ...
};
```

**Tailwind / global CSS:** `src/styles/globals.css` has **no** `prose` utilities for this flow. It only adds a placeholder rule for `.angebot-tiptap .ProseMirror`:

```53:60:src/styles/globals.css
/* Angebot builder — Tiptap @tiptap/extension-placeholder (emptyNodeClass: is-empty) */
.angebot-tiptap .ProseMirror p.is-empty::before {
  color: var(--muted-foreground);
  content: attr(data-placeholder);
  float: left;
  height: 0;
  pointer-events: none;
}
```

**Conclusion for “bullets merging” vs global reset:** A **Tailwind preflight stripping list markers in the PDF iframe** is not the mechanism — the preview is a **PDF**, not themed HTML. If list markers or indentation look wrong in the preview, the first place to interrogate is **`react-pdf-html` + `ANGEBOT_HTML_STYLESHEET`**, not a missing `prose` wrapper in the React tree.

---

## 5. PDF rendering (`@react-pdf/renderer` + intro/outro)

**Mechanism:** `react-pdf-html`’s `<Html>` component parses the **HTML string** and maps it to `@react-pdf/renderer` primitives (`View` / `Text` etc.) using the supplied `stylesheet` (and `resetStyles` on intro/outro).

**Intro:**

```319:334:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
      {introHtml ? (
        <View
          wrap
          style={[
            styles.htmlBlock,
            {
              marginBottom:
                PDF_ZONES.bodyMarginBottom /* spacing from intro prose to table — matches invoice bodyText */
            }
          ]}
        >
          {/* Matches invoice bodyText.marginBottom = 16 — consistent spacing before table */}
          <Html resetStyles stylesheet={ANGEBOT_HTML_STYLESHEET}>
            {introHtml}
          </Html>
        </View>
      ) : null}
```

**Outro:**

```483:498:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
      {outroHtml ? (
        <View
          wrap
          style={[
            styles.bodyOutroSection,
            styles.htmlBlock,
            {
              marginTop:
                PDF_ZONES.outroMarginTop /* matches invoice bodyOutroSection.marginTop via PDF_ZONES */
            }
          ]}
        >
          <Html resetStyles stylesheet={ANGEBOT_HTML_STYLESHEET}>
            {outroHtml}
          </Html>
        </View>
      ) : null}
```

**Wrapper style `htmlBlock`:** width only — no `overflow: hidden` / `padding: 0` that would obviously clip list markers:

```62:65:src/features/invoices/components/invoice-pdf/pdf-styles.ts
  /** react-pdf-html — full width; parent `View` should use `wrap` for pagination. */
  htmlBlock: {
    width: '100%'
  },
```

---

## 6. Padding regression (overflow / reset wrappers)

**Intro/outro containers:** `<View wrap style={[styles.htmlBlock, …margins]}>` — **`htmlBlock` is only `width: '100%'`** (see above). No `overflow: 'hidden'` on those intro/outro wrappers.

**Elsewhere in the same file:** Table **cells** use `overflow: 'hidden'` when **not** using HTML rendering — that applies to numeric/text layout cells, not the intro/outro blocks:

```401:414:src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx
                  <View
                    key={col.id}
                    style={{
                      width: w,
                      minWidth: 0,
                      ...(useHtmlForCell
                        ? { flexWrap: 'wrap' as const }
                        : {
                            overflow: 'hidden',
                            flexWrap: 'nowrap' as const
                          }),
```

**Tiptap wrapper:** Outer div uses `angebot-tiptap` + border; inner scroll area `max-h-[280px] overflow-y-auto` — could clip visually in the **editor panel** if content is tall, but that is unrelated to Tailwind list reset for PDF.

---

## 7. Scope — files to touch for list padding / bullet visibility

### (a) Live preview (builder)

The preview **is** the PDF. Fixing list appearance there means fixing the same path as PDF export:

- **`src/features/angebote/components/angebot-pdf/AngebotPdfCoverBody.tsx`** — `ANGEBOT_HTML_STYLESHEET` (`ul` / `ol` / `li`), optional `react-pdf-html` options if needed.
- Possibly **`src/features/invoices/components/invoice-pdf/pdf-styles.ts`** only if shared `htmlBlock` or shared section styles must change (currently minimal).

If the problem is observed **only in the Tiptap editor**, the styles already live in **`angebot-tiptap-field.tsx`** (`[&_ul]` / `[&_ol]`); global CSS is unlikely to be the fix.

### (b) PDF output (download / same as preview)

Same as (a), plus verify consistency for **table cell** HTML (`ANGEBOT_TABLE_CELL_HTML_STYLESHEET` in the same file) if line-item rich cells should match intro/outro list styling.

### Optional / separate product work

- **`src/features/angebote/components/angebot-detail-view.tsx`** — if product later adds an HTML readout of intro/outro, it would need an explicit rich-text container (e.g. `prose` or targeted `[&_ul]` rules); today intro/outro are **omitted** from the HTML detail view.

**Not required for quote intro/outro:** `invoice-pdf-cover-body.tsx` still uses plain `<Text>` for invoice intro/outro (see file comment about future HTML parity); that is the **invoice** path, not the Angebot quote path.

---

## Senior recommendation

- **This is not a one-file global Tailwind/CSS fix** for “preview,” because the quote preview is **PDF pixels in an iframe**, not a `prose`-styled DOM subtree.
- **Serialization is unlikely to be the root issue:** Tiptap persists **normal HTML**; the DB stores **TEXT**; the pipeline is consistent end-to-end for offers.
- The most plausible fix class is a **PDF rendering-layer adjustment**: tighten **`ANGEBOT_HTML_STYLESHEET`** for lists (and validate what `react-pdf-html` actually supports for markers/indentation — it may ignore or partially emulate CSS `list-style`). If the library cannot render bullets reliably, the “deeper” approach would be **custom HTML parsing** for lists into explicit `View`/`Text` rows (higher effort), not switching storage format.
- **Editor-side** list appearance is already explicitly styled in **`AngebotTiptapField`**; if bugs appear there, compare against **`globals.css`** / parent flex only after confirming the issue is DOM-side, not PDF-side.

---

## Resolution

### v3 (current): strip Tiptap’s outer `<p>` inside each `<li>`

**Root cause:** Tiptap serialises list items as `<li><p>content</p></li>`. The v2 preprocessor wrapped the full `<li>` body in a new `<p style="…">• …</p>`, producing nested block `<p>` (`•` / `N.` plus inner `<p>…</p>`). **react-pdf-html** then split that into separate nodes — bullet or number on one line, body text on the next.

**Fix:** Inside `preprocessHtmlForPdf`, for each `<li>` capture, apply `content.trim().replace(/^<p[^>]*>([\s\S]*?)<\/p>$/i, '$1')` so only the **outermost** `<p>…</p>` wrapper is removed when present. Inline markup (`<strong>`, `<em>`, `<u>`, etc.) stays intact. Plain `<li>text</li>` (no leading `<p>`) is unchanged because the anchored regex does not match. The **ul** and **ol** branches use the same stripping logic before prefixing with `•` or `${olCounter}. `.

v4: margin-bottom:3pt added inline to list item `<p>` to override stylesheet body paragraph spacing.

### v2: manual prefix + hanging indent — `preprocessHtmlForPdf`

At runtime, `listStyleType` on `ul` / `ol` in **`react-pdf-html`** did not reliably place outside markers. The stable approach is to **rewrite list HTML before `<Html>`**:

- **`preprocessHtmlForPdf(html)`**: non-greedy matches for `<li>` bodies; `<ul>` / `<ol>` blocks become `<div>` + one hanging-indent `<p>` per item (see JSDoc for 14pt / 10pt).
- **`ANGEBOT_HTML_STYLESHEET`**: no `ul` / `ol` / `li` — lists are flattened upstream; **`resetStyles`** stays `true` on intro/outro `<Html>`.
- **Wiring:** `preprocessHtmlForPdf(introHtml)` / `(outroHtml)` inlined in `<Html>` for correct `string` typing.

**v1 (superseded):** Stylesheet-only `listStyleType` + padding tuning.

**Explicitly unchanged (v3/v4):** Only `preprocessHtmlForPdf` changes across these iterations; `ANGEBOT_HTML_STYLESHEET`, `angebot-tiptap-field.tsx`, `pdf-styles.ts`, invoice PDF, and table-cell HTML stylesheet untouched.

**Verification**

- `bun run build` — required after each change (v3 included).
- **Manual:** Builder intro with paragraphs before/after lists, `<ul>` / `<ol>` with 2+ items (one item with **bold**), confirm one line for marker + text, bold preserved, wrap indents to text column.

---

### Historical note (v1 table)

| Rule | v1 (stylesheet-only) | v2+ |
|------|----------------------|-----|
| Lists | `listStyleType` / padding on `ul`/`ol`, `li` margins | Lists flattened to `<div>`/`<p>` + prefix + hanging indent; **v3** unwraps Tiptap `<li><p>` |
| `ANGEBOT_HTML_STYLESHEET` | included `ul`/`ol`/`li` | **no** `ul`/`ol`/`li` (preprocessor handles lists) |
