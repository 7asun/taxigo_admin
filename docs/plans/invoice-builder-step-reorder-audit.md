# Invoice Builder Step Reorder — Audit

> Read-only audit. No code changes proposed in this document. All file references point at the actual paths in the repo, not the `-N` suffixes used while pasting files into chat (see §4).

> Files actually live under `src/features/invoices/components/invoice-builder/` (flat — there is no `steps/` sub-folder and the PDF preview hook is co-located with the components, not under `hooks/`).

---

## 0. Spec ambiguity — flag before the senior recommendation

The reorder table in the prompt contains a numbering conflict:

> | Step 3 | Positionen | **Step 3** | Positionen (unchanged) |
> | Step 4 | PDF-Vorlage | → becomes **Step 3** | PDF-Vorlage |
> | Step 5 | Bestätigung | → becomes **Step 4** | Bestätigung + Rechnungsempfänger merged |

Two different sections cannot both occupy "Step 3" in a strict ordering. Three readings are technically consistent and I keep both alive in the findings below; I commit to one in the **Senior Recommendation** at the end:

- **Reading A — 5 → 4 collapse:** PDF-Vorlage merges into the same card as Bestätigung. New flow: `1 Modus → 2 Parameter → 3 Positionen → 4 (PDF-Vorlage + Bestätigung + Rechnungsempfänger)`. "→ becomes Step 3" on the PDF-Vorlage row would be a typo for "Step 4".
- **Reading B — Swap PDF-Vorlage before Positionen:** new order `1 Modus → 2 Parameter → 3 PDF-Vorlage → 4 Positionen → 5 Bestätigung+Rechnungsempfänger`. Then "Step 3 Positionen unchanged" would be the typo.
- **Reading C — Position numbers carry no semantic, only the *label-to-section* mapping matters:** Final order stays `1, 2, 3, 4, 5` but `step-4-confirm.tsx` is renamed `step-5-confirm.tsx` to fix the only real existing mismatch (see §4).

The technical findings in §§1–7 are agnostic to which reading wins.

---

## 1. Step Sequencing in `index.tsx`

`src/features/invoices/components/invoice-builder/index.tsx`

### How steps are ordered & rendered

- **Not an array, not a switch, not a state machine** — steps are five sequential `<BuilderSectionCard>` JSX blocks rendered together in a long scroll column (lines 524–709). All five live in the DOM simultaneously; only their `open` state, `locked` state and footer change.
- This is intentional progressive disclosure, documented in the file header (lines 3–26): "all five sections as a single progressive-disclosure scroll form".

### What controls which step is "active"

- **Numeric index, 1–5.** `type SectionNum = 1 | 2 | 3 | 4 | 5;` (line 90).
- Per-section open state: `sectionOpen: Record<SectionNum, boolean>` initialised at lines 151–157:
  ```
  { 1: true, 2: false, 3: false, 4: false, 5: false }
  ```
- Per-section refs: `section1Ref`–`section5Ref` (lines 175–179).
- Scroll anchors: `SECTION_SCROLL_IDS: Record<SectionNum, string>` at lines 101–107 — keys are literal numbers `1..5`, values are the string DOM ids `invoice-builder-section-1`..`-5`.
- Completion gating: derived flags `section1Complete`, `section2Complete`, `section3Complete`, `section4Unlocked`, `section5Unlocked` (lines 253–264), each computed from named guards in `src/features/invoices/lib/invoice-builder-section-guards.ts` (`isInvoiceBuilderSection1Complete` … `isInvoiceBuilderSection5Unlocked`).
- Lock matrix: `isLocked(n)` (lines 266–275) is a closed switch on `n`:
  ```
  1 → false
  2 → !section1Complete
  3 → !section2Complete
  4 → !section3Complete
  default (5) → !section5Unlocked
  ```

### Step numbers referenced directly (file + line + what it does)

| File | Line | What it references |
|---|---|---|
| `index.tsx` | 90 | `type SectionNum = 1 \| 2 \| 3 \| 4 \| 5` — literal numeric union |
| `index.tsx` | 101–107 | `SECTION_SCROLL_IDS` keyed by `1..5`, values `invoice-builder-section-N` |
| `index.tsx` | 151–157 | `sectionOpen` initial state, keys `1..5` |
| `index.tsx` | 175–179 | `section1Ref..section5Ref` |
| `index.tsx` | 253–264 | `section1Complete..section5Unlocked` derived flags |
| `index.tsx` | 266–275 | `isLocked(n)` switch with literal `1, 2, 3, 4` and a default that means 5 |
| `index.tsx` | 277–279 | `setSection(n, open)` mutates `sectionOpen[n]` |
| `index.tsx` | 322–328 | `if (!section3Complete) { … setSectionOpen((s) => ({ …s, 4: false, 5: false })) }` — explicit literal keys 4 and 5 |
| `index.tsx` | 354–355 | `applyStep4PdfOverlay = section4Unlocked && pdfStepAcknowledged && sectionOpen[5]` — literal `5` (and the variable name is "Step4" even though it overlays Section 5) |
| `index.tsx` | 391–399 | open→close transition section 1→2 (`{ …s, 1: false, 2: true }`) |
| `index.tsx` | 401–410 | section 2→3 (`{ …s, 2: false, 3: true }`) |
| `index.tsx` | 412–425 | section 3→4 (`{ …s, 3: false, 4: true }`) |
| `index.tsx` | 428–440 | section 4→5 (`{ …s, 4: false, 5: true }`) on `pdfStepAcknowledged` |
| `index.tsx` | 442–448 | `sectionCompletionDots` is a 5-tuple |
| `index.tsx` | 499 | `([1, 2, 3, 4, 5] as const).map(...)` — hardcoded dot indices |
| `index.tsx` | 511 | `aria-label={\`Zu Abschnitt ${n} scrollen\`}` — uses 1-based n |
| `index.tsx` | 524–539 | Section 1 card `Abrechnungsmodus` |
| `index.tsx` | 541–559 | Section 2 card `Parameter` |
| `index.tsx` | 561–605 | Section 3 card `Positionen`, footer button `"Weiter zu PDF-Vorlage"` toggles `3: false, 4: true` and scrolls `section4Ref` (lines 576–584) |
| `index.tsx` | 607–644 | Section 4 card `PDF-Vorlage`, footer button `"Weiter zur Bestätigung"` calls `setPdfStepAcknowledged(true)` (lines 622–624) |
| `index.tsx` | 646–709 | Section 5 card `Bestätigung`, footer submit references `form='invoice-step4-form'` and disables on `!section4Unlocked` (lines 661–662, 678) |

### `onConfirm`/`onNext` callback chain

| Step (card) | Child prop | Handler defined in | Effect on shell state |
|---|---|---|---|
| Section 1 (`Step1Mode`) | `onSelect` | `handleStep1Complete` from `useInvoiceBuilder` | Stores `mode` in `step2Values` → triggers `section1Complete` true → autoscrolls to Section 2 (lines 391–399) |
| Section 2 (`Step2Params`) | `onNext` | `handleStep2Complete` from `useInvoiceBuilder` | Stores remaining `step2Values` (payer_id, date range, billing type/variant scope, client_id) → `section2Complete` true → trips query fires → autoscrolls to Section 3 (lines 401–410) |
| Section 3 (`Step3LineItems`) | `onConfirm` | `confirmSection3` from `useInvoiceBuilder` | Sets `section3Confirmed = true` → with line items + no load/error, `section3Complete` becomes true → autoscrolls to Section 4 (lines 412–425). Step 3 also has the in-card primary button `Weiter zu PDF-Vorlage` calling the same handler (`step-3-line-items.tsx` lines 949–956). |
| Section 4 (`Step4Vorlage`) | **No `onConfirm` prop.** Confirmation lives in the section *footer* (lines 617–629) which directly calls `setPdfStepAcknowledged(true)` in the shell. | (inline in shell) | `pdfStepAcknowledged = true` → `isInvoiceBuilderSection5Unlocked` becomes true → autoscrolls to Section 5 (lines 428–440). The data props (`onColumnProfileChange`, `onPdfOverrideChange`, `onPdfColumnsReordered`, `onResolvedVorlageRowChange`) only flow column state, not progression. |
| Section 5 (`Step4Confirm`) | `onConfirm` | Inline lambda (lines 680–700) | Builds `snapshotOverride` from `pdfOverrideRef.current` / `builderColumnProfile` and calls `createInvoice(step4Values, snapshotOverride)`. On success the shell navigates with `router.push(\`/dashboard/invoices/${newId}\`)`. Note: `step4Values` already contains `rechnungsempfaenger_id` from RHF — the shell does not extract it explicitly. |

### Consequences for a reorder

Because every reference to a section is **numeric and literal** (`1..5`), reordering requires editing every numeric occurrence above — not a single rename. There are no named step keys, no enums, no per-step config arrays. This is the dominant blast radius of any reorder.

---

## 2. Rechnungsempfänger Dependency Map

### Where the recipient state actually lives

Authoritative recipient state for the builder is **not** in `index.tsx` directly; it is `catalogRecipientId`, returned by `useInvoiceBuilder(...)` (destructured at `index.tsx` line 206). `useInvoiceBuilder` sets it from the **first loaded trip's** joined `billing_variant.rechnungsempfaenger_id → billing_type.rechnungsempfaenger_id → payer.rechnungsempfaenger_id` cascade (see `src/features/invoices/hooks/use-invoice-builder.ts` lines 105 and 366; design rationale in `docs/rechnungsempfaenger.md`). The shell does **not** maintain a separate `rechnungsempfaengerId` variable.

`catalogRecipientId` is consumed by three call sites in `index.tsx`:

- `useInvoiceBuilderPdfPreview({ catalogRecipientId, … })` — line 366
- `<Step4Confirm defaultRechnungsempfaengerId={catalogRecipientId} catalogRecipientId={catalogRecipientId} … />` — lines 703–704

### Step 2 — read-only preview, no upward writes

`step-2-params.tsx` lines 446–475 / 813–850 (`step2RecipientPreview` block):

- Reads `useRechnungsempfaengerOptions()` and `resolveRechnungsempfaenger({ billingVariantRechnungsempfaengerId: null, billingTypeRechnungsempfaengerId, payerRechnungsempfaengerId })`.
- The "preview" runs **without trips data** (variant id is always `null` here) — it can only resolve via Abrechnungsfamilie/Kostenträger tiers; the final cascade (which includes Unterart) only happens after Section 3 loads trips.
- **No callback prop is emitted.** Step 2 does not push the resolved id upward — it is rendered inline for the dispatcher as informational UI (`Voreingestellt aus … Die endgültige Zuordnung kann sich nach Unterart der ersten Fahrt unterscheiden.`).
- The component has no `onRecipientPreview` or similar prop. It is fully read-only with respect to recipient state.

### Step 5 (`step-4-confirm.tsx`) — the editable selector

- Form field defined by the local Zod schema:
  - `step4Schema` line 76: `rechnungsempfaenger_id: z.string().optional()` (`'none'` is the sentinel for "Automatisch — Katalog").
- Default value: `defaultRechnungsempfaengerId || 'none'` (lines 178–184).
- Effective value computation (lines 222–225):
  ```
  effectiveRecipientId = (empSelectRaw === 'none' | undefined | '') ? catalogRecipientId : empSelectRaw
  ```
- Manual override flag (lines 231–235): selected value differs from `catalogRecipientId`.
- The editable `<Select>` is rendered at lines 475–509 (`name='rechnungsempfaenger_id'`).
- The form's `onSubmit` calls `props.onConfirm(step4Values)`. The Step 5 form does **not** explicitly emit `rechnungsempfaenger_id` separately — it lives inside `step4Values`.
- `index.tsx` (lines 680–700) consumes `step4Values` only to (a) compute the column snapshot override and (b) hand the whole object to `createInvoice(step4Values, snapshotOverride)`. So `rechnungsempfaenger_id` is implicit and never read by name in the shell.
- The recipient also drives the live PDF preview through the Step 5 overlay: `onStep4PdfOverlayChange({ … recipientRow: effectiveRow })` at lines 258–273. That overlay is only applied when `applyStep4PdfOverlay` is true (lines 354–355 of the shell), gated on `sectionOpen[5]`.

### References in Step 3, Step 4 (Vorlage), and the PDF preview hook

- `step-3-line-items.tsx`: **0** references to recipient state. Confirmed via grep — no `rechnungsempfaeng*` matches in the file.
- `step-4-vorlage.tsx`: **0** references. Confirmed.
- `use-invoice-builder-pdf-preview.tsx`: references `catalogRecipientId` (param), uses it to compute `defaultRecipientRow` (lines 158–161) for when the Step 5 overlay is inactive, and consumes `step4Overlay.recipientRow` (lines 176–178) when active. PDF preview is therefore **agnostic to which section number** the recipient lives in — it only cares about the overlay flag.

### Ordering dependency

There is **no technical dependency** between Rechnungsempfänger and PDF-Vorlage. Both consume `catalogRecipientId` independently of each other; neither reads the other's outputs. Merging Rechnungsempfänger into the same card as Bestätigung (Reading A) or moving PDF-Vorlage before/after the recipient selector (Reading B) are both unblocked by any code-level coupling.

The only knock-on effects of moving the editable selector are:

1. **The `applyStep4PdfOverlay` gate** in `index.tsx` line 355 currently keys on `sectionOpen[5]`. If Bestätigung becomes Section 4, this literal `5` must change to `4`.
2. **The `<Step4Confirm onStep4PdfOverlayChange>` payload** is fired from inside Step 5's form; if the recipient `<Select>` moved into a different card, that card's component would need to own the overlay emission.

---

## 3. PDF-Vorlage Unlock Logic

### Current unlock condition

- `step-4-vorlage.tsx` declares `unlocked: boolean` as a prop (line 77, JSDoc: "Section 4 unlocks after Positionen (Section 3) is complete.").
- In `index.tsx`:
  - Line 262: `const section4Unlocked = isInvoiceBuilderSection4Unlocked(section3Complete);`
  - `isInvoiceBuilderSection4Unlocked(section3Complete)` (lib/section-guards.ts lines 65–69) is a one-liner: `return section3Complete;`
  - `section3Complete` itself is **a named state flag** derived from `isInvoiceBuilderSection3Complete(section2Complete, lineItems, isLoadingTrips, isTripsError, section3Confirmed)` (guards.ts lines 53–63).
- So the unlock condition does **not** depend on the step number — it depends on `section3Confirmed` (which becomes true when the dispatcher clicks `Weiter zu PDF-Vorlage` in `Step3LineItems`).

### After the reorder

Under any of Readings A/B/C the unlock condition `section3Complete` continues to mean "Positionen has been confirmed". As long as Positionen stays on Section 3 (true in Readings A and C) the existing `isInvoiceBuilderSection4Unlocked` logic still holds verbatim. If Reading B wins (PDF-Vorlage swaps in front of Positionen as Step 3) the unlock condition is *wrong* — PDF-Vorlage would unlock as soon as `section2Complete` is true, not `section3Complete`. Reading B therefore requires either renaming `isInvoiceBuilderSection4Unlocked` or inverting which guard each section uses.

Under Reading A (5→4 collapse), the merged Section 4 card unlocks on `section3Complete` exactly as today and the existing guard is reusable as-is — the only changes are inside that single combined card. The `isInvoiceBuilderSection5Unlocked(pdfStepAcknowledged)` guard becomes dead code (no separate Bestätigung gate exists). Whether to keep `pdfStepAcknowledged` as an intra-card sub-gate is a UX decision, not a technical one.

---

## 4. File Name Blast Radius

### The "suffix mismatch" claim is a chat artefact, not a repo problem

The audit prompt lists files like `step-1-mode-4.tsx`, `step-4-vorlage-8.tsx`, `index-2.tsx` and asks about the `-N` suffixes. **Those suffixes do not exist in the repository.** They appear in the prompt because the user pasted the files into chat where the editor appends a `-N` upload counter. Verified by `Glob src/features/invoices/components/invoice-builder/**/*.tsx`:

```
src/features/invoices/components/invoice-builder/index.tsx
src/features/invoices/components/invoice-builder/invoice-builder-pdf-panel.tsx
src/features/invoices/components/invoice-builder/step-1-mode.tsx
src/features/invoices/components/invoice-builder/step-2-params.tsx
src/features/invoices/components/invoice-builder/step-3-line-items.tsx
src/features/invoices/components/invoice-builder/step-4-confirm.tsx
src/features/invoices/components/invoice-builder/step-4-vorlage.tsx
src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx
```

There is one **real** naming mismatch on disk: `step-4-confirm.tsx` (the Bestätigung step) lives at **Section 5** in the UI, not Section 4. So the prefix `step-4-` collides — two files share it (`step-4-vorlage.tsx` for Section 4, `step-4-confirm.tsx` for Section 5).

### Per-file rename impact

For each file: **current name → proposed clean name under each reading → all importers**.

| Current path | Reading A (5→4 collapse) | Reading B (Vorlage before Positionen) | Reading C (only fix existing mismatch) |
|---|---|---|---|
| `step-1-mode.tsx` | unchanged | unchanged | unchanged |
| `step-2-params.tsx` | unchanged | unchanged | unchanged |
| `step-3-line-items.tsx` | unchanged | rename to `step-4-line-items.tsx` (Positionen now Section 4) | unchanged |
| `step-4-vorlage.tsx` | rename to `step-4-vorlage-pdf.tsx` or fold into a combined `step-4-bestaetigung.tsx` (no separate file) | rename to `step-3-vorlage.tsx` | unchanged |
| `step-4-confirm.tsx` | rename to `step-4-bestaetigung.tsx` (now actually Section 4) — and absorb Vorlage if collapsing the file too | rename to `step-5-confirm.tsx` (Section 5 unchanged in B) | rename to `step-5-confirm.tsx` (resolves the existing mismatch) |
| `use-invoice-builder-pdf-preview.tsx` | unchanged | unchanged | unchanged |
| `invoice-builder-pdf-panel.tsx` | unchanged | unchanged | unchanged |
| `index.tsx` | unchanged (path) — only its internal imports/numbers update | same | same |

### Importers of each renameable file (whole `src/` tree)

`step-1-mode.tsx`, `step-2-params.tsx`, `step-3-line-items.tsx`, `step-4-vorlage.tsx`, `step-4-confirm.tsx`:

- **Only one importer** for all five step files — `src/features/invoices/components/invoice-builder/index.tsx` lines 63–67:

```63:67:src/features/invoices/components/invoice-builder/index.tsx
import { Step1Mode } from './step-1-mode';
import { Step2Params } from './step-2-params';
import { Step3LineItems } from './step-3-line-items';
import { Step4Confirm } from './step-4-confirm';
import { Step4Vorlage } from './step-4-vorlage';
```

`use-invoice-builder-pdf-preview.tsx`:

- One importer: `src/features/invoices/components/invoice-builder/index.tsx` lines 69–72 (imports `useInvoiceBuilderPdfPreview` and the type `InvoiceBuilderStep4PdfOverlay`).

`invoice-builder-pdf-panel.tsx` — **shared across other features:**

- `src/features/invoices/components/invoice-builder/index.tsx` line 68
- `src/features/angebote/components/angebot-builder/index.tsx` line 17:
  ```
  import { InvoiceBuilderPdfPanel } from '@/features/invoices/components/invoice-builder/invoice-builder-pdf-panel';
  ```
- `src/features/letters/components/letter-builder/index.tsx` line 20: same import.
- Also referenced in docs/README: `src/features/invoices/lib/README.md` line 34, `docs/invoices-module.md`, `docs/letters-module.md`, `docs/plans/letter-panel-audit.md`, etc.

`index.tsx` and `invoice-builder-pdf-panel.tsx` are imported by external features (Angebote, Letters) — but only `invoice-builder-pdf-panel.tsx` is imported by name from outside this folder. Renaming `index.tsx` is **not** under consideration here.

### Component identifiers (independent of filenames)

Class-name grep for `\bStep1Mode\b|\bStep2Params\b|\bStep3LineItems\b|\bStep4Vorlage\b|\bStep4Confirm\b` returns only the five files in `src/features/invoices/components/invoice-builder/` plus historical references in `docs/` and `.cursor/plans/`. No other `src/` consumer references these exports by name. Renaming the exported components is therefore also a single-file change inside `index.tsx`.

### Doc references that would need updating on rename

Production docs that name the step files (`docs/`):

- `docs/invoices-module.md`
- `docs/plans/manual-km-audit.md`
- `docs/plans/monthly-multi-billing-type-audit.md`
- `docs/plans/monthly-multi-variant-audit.md`
- `docs/plans/step3-amount-audit.md`
- `docs/plans/step3-skip-bug-audit.md`
- `docs/plans/step3-ui-redesign-audit.md`
- `docs/plans/cancelled-trips-invoice-audit.md`
- `docs/plans/invoice-price-override-audit.md`
- `docs/plans/invoice-description-edit-audit.md`
- `docs/plans/left-panel-net-source-audit.md`
- `docs/plans/schichtzettel-audit.md`
- `docs/pdf-vorlagen.md`
- `docs/kts-architecture.md`

History (`.cursor/plans/` — read-only historical plans, never edit):

- 10+ `.cursor/plans/*.plan.md` files reference these filenames. Not a concern for renames; treat as immutable history.

---

## 5. PDF Preview Hook Coupling

`src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx`

- **No numeric step indices.** The hook references "Step 2", "Step 5", "Section 4" only in JSDoc strings (lines 7, 55, 58, 65, 235) — none of those are guards or conditionals.
- The hook is gated purely by **flags it receives**:
  - `applyStep4Overlay: boolean` (lines 56, 166) — toggled by the shell on `section4Unlocked && pdfStepAcknowledged && sectionOpen[5]`. Note the variable name "Step4" actually refers to the *overlay coming from `Step4Confirm` (Section 5)*, not Section 4.
  - `step4Overlay: InvoiceBuilderStep4PdfOverlay | null` (line 54).
- Dependencies on `rechnungsempfaengerId` / `pdfVorlage`: there is **no order sensitivity** in the hook. When `applyStep4Overlay` is false, the hook composes the draft from `payerIntroBlockId`, `payerOutroBlockId`, `defaultPaymentDays`, and `defaultRecipientRow` (derived from `catalogRecipientId`). When `applyStep4Overlay` is true, those are replaced field-for-field by the overlay (lines 168–178). Both branches always produce a valid `draftInvoice`.
- `columnProfile: PdfColumnProfile` is required (initialised in `index.tsx` line 167 to `resolvePdfColumnProfile(null, null, null)` so the preview is valid before Step 4 even opens). The preview therefore renders happily whether or not the Vorlage card has been visited.
- `columnReorderGeneration` debounce override is independent of step ordering.
- Renaming Sections 4 ↔ 5 in the UI does **not** affect this hook structurally; only the shell-side gate `applyStep4PdfOverlay = … && sectionOpen[5]` needs to track the section number.

---

## 6. Type Name Impact — `InvoiceBuilderStep4PdfOverlay`

Exported from `use-invoice-builder-pdf-preview.tsx` line 33:

```
export interface InvoiceBuilderStep4PdfOverlay {
  paymentDueDays: number;
  introText: string | null;
  outroText: string | null;
  recipientRow: RechnungsempfaengerRow | null | undefined;
}
```

The shape carries **Bestätigung** form fields (Zahlungsziel, intro/outro text blocks, Empfänger row) — i.e. data that today lives in **Section 5**, not Section 4. The "Step4" in the name has always been misleading; the type belongs to the Bestätigung step regardless of how it's numbered.

References to this type by name (grep `InvoiceBuilderStep4PdfOverlay`):

- `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx` (export + parameter type on line 54).
- `src/features/invoices/components/invoice-builder/index.tsx` line 71 (import), line 149 (state generic), line 340 (callback type).
- `src/features/invoices/components/invoice-builder/step-4-confirm.tsx` line 63 (import), line 136 (prop type), line 260 (call site).

Two un-related references that **must not be confused with this type**:

- `InvoiceBuilderStep` (no "4") in `src/features/invoices/types/invoice.types.ts` line 396: `export type InvoiceBuilderStep = 1 | 2 | 3 | 4;` — a 4-valued numeric union. **Stale**: the builder has had five sections since the progressive-disclosure rewrite. This type is currently unused by the new builder (grep confirms no callers in `src/features/invoices/components/invoice-builder/`). It's a legacy from the wizard era. Reading A makes it accidentally correct again; Readings B and C leave it stale.
- `InvoiceBuilderStep2Snapshot` (in `src/features/invoices/components/invoice-pdf/build-draft-invoice-detail-for-pdf.ts`) — refers to Section 2 form data. Step number is correct under all three readings.

**Naming recommendation regardless of reading:** rename `InvoiceBuilderStep4PdfOverlay` to something content-named, e.g. `InvoiceBuilderBestaetigungOverlay` or `InvoiceBuilderConfirmOverlay`, so the name stops carrying a step number. This is also a single-file rename if you batch the four occurrences above.

---

## 7. Inline Comment & Section Label Inventory

Comments/JSDoc/labels containing literal `Section N` or `Step N` that become incorrect under a reorder. Indexed by which reading invalidates them.

### `src/features/invoices/components/invoice-builder/index.tsx`

| Line | Content | A | B | C |
|---|---|---|---|---|
| 9–14 | File-header section list: `① Abrechnungsmodus … ⑤ Bestätigung` (incl. `④ PDF-Vorlage`) | A: ⑤ disappears; ④ becomes "PDF-Vorlage + Bestätigung" | B: ③ becomes Vorlage, ④ Positionen | unchanged |
| 13 | "④ PDF-Vorlage — unlocks when Section 3 is complete (line items loaded, admin confirmed)" | A: card merged | B: source section changes | unchanged |
| 14 | "⑤ Bestätigung — unlocks after the user clicks 'Weiter zur Bestätigung' on Section 4" | A: no separate ⑤ | unchanged | unchanged |
| 20–23 | "Lifted from Section 4 (`Step4Vorlage` → `onColumnProfileChange`) …" | A: section number changes | B: section number changes | unchanged |
| 159 | `// True after 'Weiter zur Bestätigung' on PDF-Vorlage; unlocks Section 5 and drives dot 5.` | A: no Section 5 | unchanged | unchanged |
| 162–164 | `// Lifted from Section 4 (PDF-Vorlage). … before the dispatcher opens Section 4.` | A/B: number changes | unchanged |
| 168 | `// Phase 10: Vorlage row from Section 4 dropdown …` | A/B: number changes | unchanged |
| 321 | `// Reacts to Section 3 becoming incomplete: close downstream sections and clear override ack.` | unchanged | B: source section changes | unchanged |
| 353 | `// Meta fields (Zahlungsziel, Textblöcke) apply only while Bestätigung (Section 5) is open.` | A: 5→4 | unchanged | unchanged |
| 412 | `// Reacts to Section 3 first completing: open PDF-Vorlage (Section 4) …` | A: 4 disappears | B: numbers swap | unchanged |
| 427 | `// Reacts to user advancing from PDF-Vorlage: open Bestätigung (Section 5) …` | A: 5→4 | unchanged | unchanged |

### `src/features/invoices/components/invoice-builder/step-4-vorlage.tsx`

| Line | Content | A | B | C |
|---|---|---|---|---|
| 4 | `* step-4-vorlage.tsx` (filename header) | A: file renames/folds | B: file renames | unchanged |
| 6 | `Invoice builder **Section 4 (PDF-Vorlage)** — appears before **Bestätigung** so …` | A: section number changes | B: section number changes | unchanged |
| 14 | `live PDF preview sits in **\`index.tsx\`**, not in this rail` | unchanged | unchanged | unchanged |
| 76 | `/** Section 4 unlocks after Positionen (Section 3) is complete. */` | A: number changes | B: number changes | unchanged |

### `src/features/invoices/components/invoice-builder/step-4-confirm.tsx`

| Line | Content | A | B | C |
|---|---|---|---|---|
| 4 | `* step-4-confirm.tsx` (filename header) | A: rename | B: rename to step-5 | C: rename to step-5 |
| 6 | `* Invoice builder — Section 5 (Bestätigung): meta fields, recap, and submit.` | A: 5→4 | unchanged | unchanged |
| 8 | `Renders inside the shell's fifth BuilderSectionCard …` | A: "fifth" wrong | unchanged | unchanged |
| 10 | `the form id stays \`invoice-step4-form\` for accessibility.` | renaming form id from `invoice-step4-form` is a doc-only choice; the string is grepped only here and `index.tsx` line 661 | same | same |
| 66 | `/** Step 4 local schema — only the invoice meta fields. */` | A: still "Step 4" but content unchanged | unchanged | unchanged |
| 141 | `/** When true, the submit button is omitted (e.g. submit lives in Step 5). */` | A: 5→4 | unchanged | unchanged |
| 146 | `* Step 4: Summary display + notes/payment days form + create button.` | A: ambiguous (now Step 4 again) | unchanged | unchanged |

### `src/features/invoices/components/invoice-builder/use-invoice-builder-pdf-preview.tsx`

| Line | Content | A | B | C |
|---|---|---|---|---|
| 7 | `* draft InvoiceDetail from trips + Step 2 snapshot + optional Step 5 meta overlay.` | A: 5→4 | unchanged | unchanged |
| 55 | `/** When true, Step 5 (Bestätigung) form fields override draft PDF meta inputs. */` | A: 5→4 | unchanged | unchanged |
| 58 | `* columnProfile — resolved PDF column profile from Section 4 (PDF-Vorlage).` | A/B: section number changes | unchanged |
| 65–66 | `* Incremented when the user drag-reorders PDF columns in Section 4 …` | A/B: section number changes | unchanged |
| 235 | `// Drag-reorder bumps \`columnReorderGeneration\` for an immediate refresh (Section 4).` | A/B: section number changes | unchanged |

### `src/features/invoices/lib/invoice-builder-section-guards.ts`

| Line | Content | A | B | C |
|---|---|---|---|---|
| 5 | `Section indices match invoice-builder/index.tsx: ④ PDF-Vorlage, ⑤ Bestätigung.` | A: no ⑤ | B: numbers swap | unchanged |
| 65–69 | Function `isInvoiceBuilderSection4Unlocked` and its doc | A/B: rename | unchanged |
| 71–82 | `isInvoiceBuilderSection5Unlocked` + JSDoc referencing "Section 5 (Bestätigung)" + `Weiter zur Bestätigung` on Section 4 | A: dead code | B: numbers swap | unchanged |

### `docs/rechnungsempfaenger.md`

Contains "step 4 defaults" / "step 4 form" phrasing aligned with the **current** numbering (which calls Bestätigung "Step 4" colloquially even though it's the 5th card). Words "step 4" appear at lines 27 and 38 (approximate; see file). Reading A leaves the doc accidentally correct; Readings B/C may need updates.

### Form id and DOM scroll ids

- `id='invoice-step4-form'` in `step-4-confirm.tsx` line 384 and referenced by the shell submit button (`index.tsx` line 661) — the literal string "step4". Renaming under any reading is a two-line change and not technically required for the reorder to work.
- `SECTION_SCROLL_IDS` values (`invoice-builder-section-1`..`-5`) — under Reading A the `-5` id disappears or gets reused; under Readings B/C the numbers stay 1–5.

---

## Senior Recommendation

Given (i) the ambiguity flagged in §0, (ii) the literal-numeric coupling in `index.tsx` exposed by §1, and (iii) the cross-feature consumer of `invoice-builder-pdf-panel.tsx` shown in §4, I recommend the following sequencing.

### Pick the reading first

The reorder PR must start by **resolving §0**. My best read of the prompt's intent — "Bestätigung + Rechnungsempfänger merged" plus a desire to drop a step — is **Reading A: a 5→4 collapse** in which PDF-Vorlage merges visually into the same card as Bestätigung+Rechnungsempfänger. That matches the spirit of "merge" in the new Step 4 label and avoids the contradiction in the table. Confirm with the requester before any code change.

If the requester actually wants Reading B (Vorlage swaps in front of Positionen) the unlock logic in §3 inverts and the changeset roughly doubles in size; that should be a separate PR.

### Rename files in a second PR, not the same one

The reorder PR should be **strictly behavioural** — change literal `4`s and `5`s, the `sectionOpen` keys, the `SECTION_SCROLL_IDS` map, the closed switch in `isLocked`, the JSDoc/comment inventory in §7, and (under Reading A) collapse the two cards into one. Do **not** rename files in the same PR. Reasons:

1. The only external consumer of any file in this folder is `invoice-builder-pdf-panel.tsx` (imported by Angebote and Letters). All five step files have a **single importer** (`index.tsx`) — so file renames have a trivial blast radius for that importer, but each rename is still a diff line you don't want mixing with the behavioural change.
2. The only existing on-disk mismatch is `step-4-confirm.tsx` carrying the "step-4" prefix while occupying Section 5. Under Reading A that mismatch resolves on its own (the file's content becomes Section 4). Under Reading B the file becomes "step-5-confirm.tsx". Under Reading C only the rename ships and the section order is unchanged.
3. `InvoiceBuilderStep4PdfOverlay` is the one type whose name actively misleads regardless of reading (§6) — fold the rename into the same follow-up PR as the file renames, *not* the reorder.

### Minimal safe rename strategy (the file-rename follow-up PR)

Keep all file names **content-named, not step-numbered**, so the next reorder is free:

- `step-1-mode.tsx` → `mode-step.tsx` (or leave; "1" is unlikely to ever move)
- `step-2-params.tsx` → `params-step.tsx`
- `step-3-line-items.tsx` → `line-items-step.tsx`
- `step-4-vorlage.tsx` → `pdf-vorlage-step.tsx`
- `step-4-confirm.tsx` → `bestaetigung-step.tsx` (or `confirm-step.tsx`)
- `InvoiceBuilderStep4PdfOverlay` → `InvoiceBuilderBestaetigungOverlay`
- `invoice-step4-form` → `invoice-bestaetigung-form` (form `id` + the one `form='…'` reference)

Each rename touches **one importer** (`index.tsx`) and one self-reference per file. There is no risk of breaking Angebote or Letters because they import `invoice-builder-pdf-panel.tsx` only, which is not being renamed.

### What about the stale `InvoiceBuilderStep` numeric union in `invoice.types.ts`?

The `export type InvoiceBuilderStep = 1 | 2 | 3 | 4;` (line 396 in `src/features/invoices/types/invoice.types.ts`) is unused by the current builder (grep confirms zero callers in `src/features/invoices/components/invoice-builder/`). Delete it — or, if any prod doc still leans on it, update to `1 | 2 | 3 | 4 | 5` until the reorder ships and back to `1 | 2 | 3 | 4` after Reading A lands. Easiest: delete in the same follow-up PR.

### Net summary

- The reorder is **mechanically simple but pervasive**: ~30 numeric occurrences in `index.tsx` plus the section-guards module. No new abstractions are needed.
- The reorder is **independent of file naming** — keep the renames in a separate PR.
- The hook (`use-invoice-builder-pdf-preview.tsx`) and the panel (`invoice-builder-pdf-panel.tsx`) need **no code changes**; only JSDoc/comments.
- The biggest risk in a reorder PR is **forgetting one literal `5`** (the `sectionOpen[5]` gate in `applyStep4PdfOverlay`, line 355, is the single highest-impact one — silently disabling the live PDF overlay for Bestätigung if missed). Audit any reorder diff against §7's inventory before merging.
