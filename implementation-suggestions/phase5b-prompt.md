# Phase 5b — Invoice Builder Shell Redesign (Panel Layout)

Phase 5 is complete and verified. Please proceed with **Phase 5b — Invoice Builder Panel Layout Redesign**.

This phase is a **pure layout and UX change** — no business logic, no resolver changes, no new DB columns. The invoice creation logic, pricing, PDF generation, and snapshot capture from Phases 1–5 remain completely untouched.

---

## Before writing any code

1. Confirm `bun run build` is passing.
2. Read `src/features/invoices/components/invoice-builder/index.tsx` in full — understand how the current wizard shell passes state between steps before touching it.
3. Read `src/features/invoices/components/invoice-builder/step-4-confirm.tsx` — the live PDF preview panel currently lives here. In the new layout it moves to the persistent right panel.
4. Do not touch any resolver, API, or type file. Layout only.

---

## The Target Layout

### Desktop (≥ 1024px)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Neue Rechnung erstellen                                [X schließen]│
├────────────────────────────────┬────────────────────────────────────┤
│  LEFT PANEL (scrollable)       │  RIGHT PANEL (sticky, fixed height)│
│                                │                                    │
│  ● 1  Abrechnungsmodus  ✓      │                                    │
│  ● 2  Parameter         ✓      │      Live PDF Vorschau             │
│  ● 3  Positionen    ◀ active   │                                    │
│  ● 4  Bestätigung              │      (updates debounced 600ms)     │
│  ────────────────────          │                                    │
│  [active step content]         │      Placeholder when no data:     │
│                                │      „Wähle einen Kostenträger     │
│                                │       um die Vorschau zu starten"  │
│  [Zurück]    [Weiter →]        │                                    │
└────────────────────────────────┴────────────────────────────────────┘
```

**Left panel:**
- Fixed width: `w-full max-w-[520px]` — gives the form enough room without crowding
- Full height, independently scrollable: `overflow-y-auto`
- Contains: vertical step indicator + active step content + navigation buttons
- Step indicator: vertical progress rail on the left edge of the panel — completed steps show a filled circle + checkmark, active step shows filled accent circle, future steps show empty circle — muted text for incomplete, full weight for active
- Navigation buttons (`Zurück` / `Weiter`) are sticky at the bottom of the left panel — always reachable without scrolling to the bottom of a long Step 3 line item list

**Right panel:**
- Takes remaining width: `flex-1`
- Sticky: `sticky top-0 h-screen` — never scrolls with the left panel
- Contains: the PDF preview iframe (from Phase 5 `usePDF` implementation)
- Visible from Step 1 with placeholder state (see below)
- From Step 3 onwards: live PDF renders as line items load

**Placeholder states (right panel):**
- Step 1 (no data yet): `„Wähle einen Abrechnungsmodus um die Vorschau zu starten"`
- Step 2 (mode chosen, no trips yet): `„Parameter auswählen um Fahrten zu laden"`
- Step 3+ (trips loaded): live PDF renders
- All placeholder states: centered, muted text, subtle invoice icon — same tone as empty states elsewhere in the app

---

### Mobile (< 1024px)

Single column layout. The PDF preview does **not** appear inline — it is accessible via a sticky floating button at the bottom of the screen:

```
[📄 Vorschau anzeigen]   ← sticky bottom-right FAB or bottom bar
```

Tapping opens the existing Phase 5 `Sheet` component with the PDF preview. This is consistent with the Phase 5 mobile pattern — no new mobile behavior needed, just ensure it still works in the new shell.

---

## Step Indicator Design

Vertical rail, left edge of the left panel. Requirements:

- **Completed step:** filled circle with `✓`, label in muted foreground, clickable to go back (same as current wizard back navigation)
- **Active step:** filled accent-colored circle with step number, label in full foreground weight
- **Future step:** empty circle with step number, label in muted foreground, not clickable
- Rail line connecting circles: muted, completed segments filled with accent color
- No horizontal tab bar — remove the existing horizontal step indicator entirely
- Step labels (German):
  - Step 1: `Abrechnungsmodus`
  - Step 2: `Parameter`
  - Step 3: `Positionen`
  - Step 4: `Bestätigung`

---

## Navigation Buttons

Sticky at the bottom of the left panel content area (not the bottom of the page):

```
┌──────────────────────────────────┐
│  [← Zurück]          [Weiter →]  │  ← sticky bottom of left panel
└──────────────────────────────────┘
```

- Step 1: no `Zurück` button
- Step 4: `Weiter` becomes `Rechnung erstellen` (existing label — do not change)
- Buttons stay above the fold even when Step 3 has 50+ line items — this eliminates the current UX problem of having to scroll to the bottom to advance

---

## PDF Preview Panel — Migration from Step 4

Currently the live PDF preview only appears in Step 4 (`step-4-confirm.tsx`). In the new layout it moves to the **persistent right panel** and is visible throughout all steps.

**Migration plan:**
- Extract the `usePDF` / debounce / iframe logic from `step-4-confirm.tsx` into a new standalone component: `src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx`
- The new component accepts the same props as the current Step 4 preview (builder state, company profile, draft invoice data)
- `step-4-confirm.tsx` removes its local preview section — the right panel handles it
- The right panel component is mounted once in `invoice-builder/index.tsx` (the shell) and receives live builder state — it does not remount between steps
- This ensures the PDF does not re-render from scratch on every step transition — only when the debounced content actually changes

**Placeholder → live transition:**
- Before trips are loaded (Steps 1–2): pass `null` trips to the preview component → shows placeholder
- After trips load (Step 3+): pass live `BuilderLineItem[]` → PDF renders
- Use the existing `buildDraftInvoiceDetailForPdf` adapter already built in Phase 5

---

## Shell Architecture Change

The current `invoice-builder/index.tsx` renders one step at a time inside a single container. The new shell needs two persistent columns.

**New shell structure:**
```tsx
<div className="flex h-screen overflow-hidden">
  {/* Left panel */}
  <div className="flex flex-col w-full max-w-[520px] border-r overflow-hidden">
    <div className="flex-1 overflow-y-auto p-6">
      <InvoiceBuilderStepIndicator currentStep={step} onStepClick={goToStep} />
      <div className="mt-6">
        {/* active step content — unchanged components */}
        {step === 1 && <Step1ModeSelection ... />}
        {step === 2 && <Step2Params ... />}
        {step === 3 && <Step3LineItems ... />}
        {step === 4 && <Step4Confirm ... />}
      </div>
    </div>
    {/* Sticky nav */}
    <div className="shrink-0 border-t bg-background p-4 flex justify-between">
      {step > 1 && <Button variant="outline" onClick={goBack}>← Zurück</Button>}
      <Button onClick={goNext} className="ml-auto">
        {step === 4 ? 'Rechnung erstellen' : 'Weiter →'}
      </Button>
    </div>
  </div>

  {/* Right panel — sticky PDF preview */}
  <div className="hidden lg:flex flex-1 sticky top-0 h-screen overflow-hidden">
    <InvoiceBuilderPdfPanel
      builderState={builderState}
      companyProfile={companyProfile}
      step={step}
    />
  </div>
</div>
```

The individual step components (`Step1`, `Step2`, `Step3`, `Step4`) do **not** change their internal logic — only the shell wrapping them changes.

---

## New Files

```
src/features/invoices/components/invoice-builder/
  invoice-builder-pdf-panel.tsx     (extracted + extended from step-4 preview)
  invoice-builder-step-indicator.tsx (new vertical step rail component)
```

---

## Files to Modify

```
src/features/invoices/components/invoice-builder/index.tsx     (shell redesign)
src/features/invoices/components/invoice-builder/step-4-confirm.tsx  (remove local preview section)
```

No changes to: `step-1-*.tsx`, `step-2-*.tsx`, `step-3-*.tsx`, any API file, any resolver, any type file.

---

## Standards

- Use existing shadcn/ui primitives — no new UI library additions
- `cn()` utility for conditional class merging
- All new components get a file-level comment explaining their role
- The step indicator uses `StyleSheet`-free Tailwind — no inline styles
- `bun run build` must pass
- Test manually with Step 3 containing 20+ line items — confirm sticky nav buttons are always visible and left panel scrolls independently

---

## Completion deliverable

1. Files created
2. Files modified
3. Confirm the PDF panel is mounted once in the shell (not per-step)
4. Confirm sticky nav buttons are visible with 20+ line items in Step 3
5. Confirm mobile "Vorschau anzeigen" button still works
6. `bun run build` passed
