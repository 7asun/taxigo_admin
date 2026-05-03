---
name: Letter builder section card UX
overview: Restructure LetterBuilder left panel with three BuilderSectionCard steps (German titles), AddressAutocomplete parity with Angebot step 1, bottom bar for PDF/save; delete LetterForm; docs + comments.
isProject: false
---

# Letter builder — section card UX (Angebot parity)

**Iteration:** UI section titles are **German**. Do **not** use "Kopfdaten". Section 2 card title: **`2. Betreff & Datum`**.

| # | `BuilderSectionCard` `title` (German) |
|---|----------------------------------------|
| 1 | `1. Empfänger` |
| 2 | `2. Betreff & Datum` |
| 3 | `3. Brieftext` |

File and folder names stay **English** (`letter-step-1-recipient.tsx`, etc.).

---

## Preconditions

Read before coding: [`angebot-builder/index.tsx`](src/features/angebote/components/angebot-builder/index.tsx), [`step-1-empfaenger.tsx`](src/features/angebote/components/angebot-builder/step-1-empfaenger.tsx), [`step-3-details.tsx`](src/features/angebote/components/angebot-builder/step-3-details.tsx), [`address-autocomplete.tsx`](src/features/trips/components/trip-address-passenger/address-autocomplete.tsx), [`builder-section-card.tsx`](src/components/ui/builder-section-card.tsx), current [`letter-builder/index.tsx`](src/features/letters/components/letter-builder/index.tsx), [`letter-form.tsx`](src/features/letters/components/letter-form.tsx), [`types.ts`](src/features/letters/types.ts), [`build-draft-letter.ts`](src/features/letters/lib/build-draft-letter.ts), [`angebot-tiptap-field.tsx`](src/features/angebote/components/angebot-builder/angebot-tiptap-field.tsx).

---

## API contract fix: `BuilderSectionCard`

[`BuilderSectionCard`](src/components/ui/builder-section-card.tsx) requires **`id`**, **`sectionRef`**, and **`summary: string | null`** (not `undefined`). The user’s JSX snippet omitted `id` / `sectionRef` — add three `useRef<HTMLElement | null>(null)` in `LetterBuilder` and pass stable `id` strings (e.g. `section-letter-recipient`), mirroring [`angebot-builder/index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **146–148**, **447–450**.

Pass `summary={recipientSummary ?? null}` (and same for details); section 3 may use `summary={null}` always.

---

## Step 1 — `letter-step-1-recipient.tsx`

Create [`src/features/letters/components/letter-builder/letter-step-1-recipient.tsx`](src/features/letters/components/letter-builder/letter-step-1-recipient.tsx).

- **Props:** `Pick<LetterFormValues, recipient…>` + `onChange: (patch: Partial<LetterFormValues>) => void` as specified.
- **Layout:** Root `space-y-4`; company block; salutation + names `flex gap-3` (`w-36` / `flex-1 min-w-0`) — mirror [`step-1-empfaenger.tsx`](src/features/angebote/components/angebot-builder/step-1-empfaenger.tsx) lines **49–102**.
- **AddressAutocomplete:** Same pattern as lines **104–131** (local `addressSearch` state, `onSelectCallback`). **Field mapping:** `LetterFormValues` has **`recipientStreet` only** (no `recipient_street_number`). Merge Google `street` + `street_number` into one string for `recipientStreet` (e.g. trim join with space), and set `recipientZip`, `recipientCity`; leave `recipientCountry` to manual inputs unless product adds logic later.
- **Below autocomplete:** Letter product needs explicit **Straße**, **PLZ** + **Ort**, **Land** — **Angebot step 1 does not show these after autocomplete**; this is letter-specific. Use labels **exactly** from current [`letter-form.tsx`](src/features/letters/components/letter-form.tsx) (Firma, Anrede, Vorname, Nachname, Straße, PLZ, Ort, Land). Layout: full-width Straße; `flex gap-3` with PLZ `w-32 shrink-0`, Ort `flex-1 min-w-0`; Land full width — mirror spacing classes from current letter-form where applicable.

**Do not modify** [`AddressAutocomplete`](src/features/trips/components/trip-address-passenger/address-autocomplete.tsx).

---

## Step 2 — `letter-step-2-details.tsx`

Create [`src/features/letters/components/letter-builder/letter-step-2-details.tsx`](src/features/letters/components/letter-builder/letter-step-2-details.tsx).

- Mirror [`step-3-details.tsx`](src/features/angebote/components/angebot-builder/step-3-details.tsx): root `space-y-4`; **Betreff** (`subject`) full width first; then **`letterDate` + `letterNumber`** in `flex gap-3` with `min-w-0 flex-1` each; then **Status** `Select` with German labels from letter-form (`Entwurf` / `Versendet`); `DatePicker` import path unchanged from letter-form.
- **Labels:** Copy exact German strings from letter-form for Briefdatum, Brief-Nr., Status, Betreff.

---

## Step 3 — `letter-step-3-body.tsx`

Create [`src/features/letters/components/letter-builder/letter-step-3-body.tsx`](src/features/letters/components/letter-builder/letter-step-3-body.tsx).

- `Pick<LetterFormValues, 'bodyHtml'>` + `onChange`; root `space-y-4`; single `AngebotTiptapField` — label **Brieftext** (same as letter-form).

**Completion:** `bodyHtml` stripped of tags has non-empty trim — as in user spec.

---

## Step 4 — `LetterBuilder` refactor

Modify [`letter-builder/index.tsx`](src/features/letters/components/letter-builder/index.tsx).

- **`openSections`:** `{ recipient: true, details: false, body: false }` — parent-controlled like Angebot lines **139–143**.
- **Scroll column:** `flex-1 overflow-y-auto p-4` → inner `mx-auto max-w-lg space-y-3` (**not** `max-w-3xl`).
- Optional **`companyProfile` missing** copy: keep behaviour; place **inside** scroll stack above cards like Angebot **437–445** (if still product-relevant).
- **Three `BuilderSectionCard`s** with German titles above, `completed` / `showFertigBadge` / `summary` per user spec; wire `LetterStep1Recipient`, `LetterStep2Details`, `LetterStep3Body`.
- **Bottom bar:** Exact classes from Angebot lines **521**: `border-border bg-background flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3`. **Left:** PDF button — `variant='secondary'` (or match letter-form: secondary + `FileDown`) — move `pdf().toBlob()` logic from letter-form; **Right:** primary save — German strings: create vs edit (`Brief erstellen` / `Änderungen speichern` or match existing letter-form “Speichern” + create toast flow). **Loading:** `Loader2` + disabled while `isSaving`, mirror Angebot pending pattern lines **540–544**.
- **Angebot mobile:** left slot is “Vorschau” on mobile — **deferred** per user; letter bottom bar can use **empty left `<span />` on desktop** and optionally reserve left for future Sheet (same as Angebot lines **532–533** when not mobile).

**Retention not in user snippet:**

- **Zur Übersicht:** Add `Button variant='outline' asChild` + `Link` to `/dashboard/letters` — place **above** the three cards inside the scroll column (first row), so nothing is lost from current letter-form.
- **Edit delete:** Keep destructive delete for edit mode — e.g. **below the last section card** inside scroll (full width) or a tertiary control in the bottom bar; mirror destructive styling from current letter-form.

- **Remove** all `LetterForm` imports/usages.
- **Right panel + `useLetterBuilderPdfPreview`:** unchanged.

**Do not modify** `BuilderSectionCard`, Angebot files, invoice files, `InvoiceBuilderPdfPanel`.

---

## Step 5 — Delete `letter-form.tsx` + exports

- Grep `LetterForm` / `letter-form` (only [`letter-builder/index.tsx`](src/features/letters/components/letter-builder/index.tsx), [`build-draft-letter.ts`](src/features/letters/lib/build-draft-letter.ts) comment, docs — fix).
- Delete [`letter-form.tsx`](src/features/letters/components/letter-form.tsx).
- [`src/features/letters/index.ts`](src/features/letters/index.ts): ensure **no** `LetterForm` export (already absent if grep clean).
- Update [`types.ts`](src/features/letters/types.ts) comment: state owned by `LetterBuilder`, not `LetterForm`.

**Gates:** `bun run build`, `bun test`.

---

## Step 6 — Docs + inline comments

- [`docs/letters-module.md`](docs/letters-module.md): three step files, German section titles, `AddressAutocomplete` path, completion rules, remove `letter-form` from tree.
- Why-comments: builder (`max-w-lg`, bottom bar, `openSections`), step-1 (shared trips autocomplete), step-3 (shared Tiptap).

---

## Deferred

Mobile preview Sheet; `BuilderSplitShell`; `bun run db:types`.
