# Audit: Angebot builder left panel UX vs letters (read-only)

## Directory note

`src/features/angebote/components/angebot-builder/` contains **six** files: `index.tsx`, `step-1-empfaenger.tsx`, `step-2-positionen.tsx`, `step-3-details.tsx`, `angebot-tiptap-field.tsx`, `use-angebot-builder-pdf-preview.tsx`. There is **no** `step-2-details.tsx` (details are `step-3-details.tsx`).

---

## 1. Expandable card / accordion pattern

The left panel uses **`BuilderSectionCard`**, not shadcn `Accordion` and not a raw `Card` toggle.

- **Import in builder:** `import { BuilderSectionCard } from '@/components/ui/builder-section-card'` — [`src/features/angebote/components/angebot-builder/index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **8**, **447–517** (three usages).
- **Implementation:** [`src/components/ui/builder-section-card.tsx`](src/components/ui/builder-section-card.tsx) wraps **shadcn/ui `Collapsible`**, `CollapsibleTrigger`, and `CollapsibleContent` — lines **17–21**, **55–118**.

So the pattern is: **custom `BuilderSectionCard` + Radix/shadcn `Collapsible`** (accordion-style open/close, not the `Accordion` primitive).

---

## 2. Section / step structure

There are **three** expandable sections:

| # | Label (title prop) | Step component file | Default open? |
|---|-------------------|---------------------|---------------|
| 1 | `1. Empfänger` | [`step-1-empfaenger.tsx`](src/features/angebote/components/angebot-builder/step-1-empfaenger.tsx) | **Open** (`empfaenger: true`) |
| 2 | `2. Positionen` | [`step-2-positionen.tsx`](src/features/angebote/components/angebot-builder/step-2-positionen.tsx) | **Closed** (`positionen: false`) |
| 3 | `3. Details` | [`step-3-details.tsx`](src/features/angebote/components/angebot-builder/step-3-details.tsx) | **Closed** (`details: false`) |

Initial state: [`index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **139–143**:

```ts
const [openSections, setOpenSections] = useState({
  empfaenger: true,
  positionen: false,
  details: false
});
```

Titles are passed explicitly, e.g. `title='1. Empfänger'` — lines **450**, **475**, **503**.

---

## 3. Section header anatomy

Defined entirely in [`builder-section-card.tsx`](src/components/ui/builder-section-card.tsx) **lines 54–106** (trigger) and **108–117** (content wrapper).

**Structure (conceptually):**

- **`<section>`** with `id`, `sectionRef`, `scroll-mt-3` — line **54**.
- **Trigger** is a full-width **`<button>`** (via `CollapsibleTrigger asChild`) — lines **64–106**.
- **Left column (title + optional summary):**
  - **Title:** single `<p className='text-sm font-semibold'>{title}</p>` — line **73**. The step number is **part of the `title` string** from the parent (e.g. `"1. Empfänger"`), not a separate badge component.
  - **Summary (subtitle when collapsed):** Shown only when `completed && !isOpen && summary` — lines **74–78**: muted `text-sm` paragraph.
- **Right column (badges / icons):**
  - **“Fertig” badge:** If `completed && showFertigBadge` — green-styled `Badge` with **Check** icon — lines **81–88**.
  - **Locked:** `Lock` + “Gesperrt” text when `locked` — lines **90–94** (Angebot passes `locked={false}` — [`index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **451**, **476**, **504**).
  - **Chevron:** `ChevronDown` rotates 180° when open — lines **96–103**.

There is **no** separate step-number chip beyond the title text; **no** icon in the title row except Check (in badge), Lock (when locked), Chevron.

---

## 4. Controlled vs uncontrolled expansion

**Fully controlled by the parent** `AngebotBuilder`.

- State: `openSections` — [`index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **139–143**.
- Each card gets `open={openSections.empfaenger}` (etc.) and `onOpenChange` that updates **only that key** — e.g. lines **459–462**, **480–483**, **508–509**:

```ts
onOpenChange={(o) =>
  setOpenSections((s) => ({ ...s, empfaenger: o }))
}
```

**Independently togglable:** opening one section does **not** close others (no accordion “single open” mode). Each section’s open flag is updated in isolation.

`BuilderSectionCard` passes `open`/`onOpenChange` into `Collapsible` — [`builder-section-card.tsx`](src/components/ui/builder-section-card.tsx) lines **55–57**.

---

## 5. Field layout inside sections

### `step-1-empfaenger.tsx`

- **Root container:** `<div className='space-y-4'>` — line **49** (vertical stack).
- **Mix of single column and horizontal flex rows:**
  - Single field blocks: `space-y-1.5` — e.g. lines **51–52**, **105–106**, **159–160**.
  - **Two-column-ish row:** `flex gap-3` for Anrede + Vorname + Nachname — lines **62–63** (Anrede fixed `w-36`, names `flex-1`).
  - **Two equal columns:** E-Mail + Telefon — `flex gap-3` with `min-w-0 flex-1` — lines **135–136**.

### `step-3-details.tsx`

- **Root:** `<div className='space-y-4'>` — line **35**.
- Betreff: full width — lines **36–44**.
- Dates: **`flex gap-3`** with two `min-w-0 flex-1` columns — lines **46–47**.
- Tiptap blocks: full width stack (`AngebotTiptapField`).

### `step-2-positionen.tsx`

- **Root:** `<div className='space-y-4'>` — line **318**.
- Inner template area: `bg-muted/40 … rounded-lg border p-4` — lines **320–321**.
- Line item cards: `space-y-2` / per-card `space-y-2 rounded-md border p-3` — see **lines 96–103** (`SortableCard`).
- **Nested** `Collapsible` for “Spaltenvorschau” inside step 2 — lines **322–451** (separate from `BuilderSectionCard`).

### Letter form (contrast)

[`letter-form.tsx`](src/features/letters/components/letter-form.tsx): outer **`mx-auto max-w-3xl space-y-8`** — line **84**; meta block **`grid gap-4 sm:grid-cols-2`** — line **112**; Empfänger **`space-y-3`** + inner **`grid gap-4 sm:grid-cols-2`** — lines **153–155**.

---

## 6. Section footer / action bar (Weiter / Fertig inside section)

**No** “Weiter” / “Fertig” button inside each `BuilderSectionCard` for Angebot.

- `BuilderSectionCard` supports an optional **`footer`** slot — [`builder-section-card.tsx`](src/components/ui/builder-section-card.tsx) lines **35**, **49**, **115**.
- **Angebot** does **not** pass `footer` to any of the three cards — [`index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **447–517**.

The user **manually** opens/closes sections via the card header. Completion is indicated by the **“Fertig”** badge and optional **summary** when collapsed, not by a button that advances the wizard.

---

## 7. Top action bar (left panel)

**No** dedicated fixed header inside the left column (no back link, no page title, no top save bar).

The scrollable stack is:

1. Optional **destructive Alert** for `companyProfileMissing` — [`index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **437–445**.
2. **`mx-auto max-w-lg space-y-3`** column of section cards — lines **436**, **447–517**.

Structure/classes for the scroll region — lines **434–436**:

```tsx
<div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
  <div className='flex-1 overflow-y-auto p-4'>
    <div className='mx-auto max-w-lg space-y-3'>
```

---

## 8. Bottom action bar (left panel)

**Yes** — fixed **footer** strip below the scroll area, same parent as the scroll column — [`index.tsx`](src/features/angebote/components/angebot-builder/index.tsx) lines **521–546**:

- **Container:** `className='border-border bg-background flex shrink-0 items-center justify-between gap-3 border-t px-4 py-3'`
- **Left (mobile):** “Vorschau” `Button` with `Eye` icon — lines **522–531**.
- **Left (desktop):** empty `<span />` — lines **532–533**.
- **Right:** primary submit — “Angebot erstellen” / “Änderungen speichern” / loading text — lines **535–545** (`disabled={!canConfirm || isPending || companyProfileMissing}`).

---

## 9. Letter-specific mapping (natural fit to Angebot sections)

Current letter fields ([`letter-form.tsx`](src/features/letters/components/letter-form.tsx)):

- **Meta:** `letterDate`, `letterNumber`, `status`, `subject`
- **Recipient:** `recipientCompany`, `recipientSalutation`, `recipientFirstName`, `recipientLastName`, `recipientStreet`, `recipientZip`, `recipientCity`, `recipientCountry`
- **Body:** `bodyHtml` (Tiptap)

**Mapping to Angebot’s three-step *concept*:**

| Angebot section | Letter fields that fit |
|-----------------|------------------------|
| 1. Empfänger | All recipient fields (company, salutation, names, street, PLZ, Ort, Land) — mirrors Step 1’s CRM/window-style data (letters omit email/phone unless added later). |
| 2. Positionen | *No line items.* Either **omit** this section or **repurpose** for something letter-specific (e.g. “Anlagen / Hinweise” placeholder) — **not** recommended for parity. Prefer **three sections** with a different middle or only **two** collapsible sections. |
| 3. Details | `letterDate`, `letterNumber`, `status`, `subject`, plus `bodyHtml` as the long-form editor (like intro/outro Tiptap in Step 3). |

A **clean** mirror without a fake “Positionen”:

- **1. Empfänger** — recipient block only.
- **2. Briefkopf & Betreff** (or **Metadaten**) — date, number, status, subject (similar density to Step 3’s subject + dates).
- **3. Brieftext** — single `AngebotTiptapField` (like Einleitung/Schlussformel stack in Step 3).

---

## Docs cross-check (`docs/angebote-module.md`)

The file has **no** top-level sections literally titled **“Builder”**, **“Steps”**, **“UI”**, or **“Components”**. Closest material:

- **Architecture / builder flow:** “Architecture overview”, “Folder layout”, “Data flow” — lines **7–56** (lists `AngebotBuilder`, steps, preview).
- **Shared UI:** “Shared infrastructure” table — lines **176–183** lists `BuilderSectionCard` and `InvoiceBuilderPdfPanel`.

---

## ASCII: Angebot left column (simplified)

```
┌─────────────────────────────────────┐
│  [scroll] p-4                       │
│  ┌───────────────────────────────┐  │
│  │ ▼ 1. Empfänger        [Fertig?]│  │
│  │ ─────────────────────────────│  │
│  │   (Step1Empfaenger fields)    │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ▶ 2. Positionen      [Fertig?]│  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ▶ 3. Details         [Fertig?]│  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│ [Vorschau?]          [Angebot …]    │  ← border-t footer
└─────────────────────────────────────┘
```

---

## Letter builder today (contrast)

[`letter-builder/index.tsx`](src/features/letters/components/letter-builder/index.tsx) **lines 197–214**: left panel is **only** scroll + `LetterForm` — **no** `BuilderSectionCard`, **no** bottom submit strip (save/PDF live **inside** `LetterForm` top row — [`letter-form.tsx`](src/features/letters/components/letter-form.tsx) lines **85–103**). Max width inside form is **`max-w-3xl`** vs Angebot’s **`max-w-lg`** column.

---

## Recommended Letter Builder section map

Goal: **same feel** as Angebot — `BuilderSectionCard`, numbered titles, Fertig badge + summary, parent-controlled `openSections`, **`max-w-lg`** in the scroll column to match Angebot, and optionally a **bottom bar** for primary save (and mobile preview) like Angebot.

| Section | Title | Fields | Default open | Summary when collapsed (example) |
|---------|-------|--------|--------------|----------------------------------|
| 1 | `1. Empfänger` | `recipientCompany`, `recipientSalutation`, `recipientFirstName`, `recipientLastName`, `recipientStreet`, `recipientZip`, `recipientCity`, `recipientCountry` | **Open** | Company or last name |
| 2 | `2. Kopfdaten` | `letterDate`, `letterNumber`, `status`, `subject` | Closed | Subject line or date |
| 3 | `3. Brieftext` | `bodyHtml` (`AngebotTiptapField`) | Closed | Optional: first plain line truncated, or “Brieftext” placeholder |

**Completion rules (for `completed` / `showFertigBadge` / summary):**

- **Section 1:** e.g. `recipientCompany || recipientLastName` (align with Angebot section 1 logic).
- **Section 2:** e.g. `subject.trim() && letterDate` (align with Angebot section 3 subject + date).
- **Section 3:** e.g. `bodyHtml` has non-empty text beyond `<p></p>` / min length (product decision).

**Header look:** Reuse **`BuilderSectionCard`** as-is — same title line, Fertig badge, summary line, chevron ([`builder-section-card.tsx`](src/components/ui/builder-section-card.tsx) **64–106**).

**Layout inside sections:** Match step files — outer **`space-y-4`**, use **`flex gap-3`** for pairs (date + number, PLZ + Ort), **`grid sm:grid-cols-2`** where the letter form already grids recipients.

**Chrome:**

- Move **Zur Übersicht / PDF / Speichern** into a pattern closer to Angebot: e.g. **bottom bar** for **Speichern** (+ mobile **Vorschau**), keep **PDF** secondary in header or footer row.
- Or keep top actions but wrap **field groups** in `BuilderSectionCard` only — slightly less parity with Angebot’s footer primary.

This map **drops** a “Positionen”-style section unless you add future letter-specific structured blocks (attachments list, etc.).
