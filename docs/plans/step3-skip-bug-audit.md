# Audit — Step 3 auto-skip on invoice creation

**Scope:** `src/features/invoices/components/invoice-builder/index.tsx`, `src/features/invoices/hooks/use-invoice-builder.ts`, `src/features/invoices/components/invoice-builder/step-3-line-items.tsx`, and `src/features/invoices/lib/invoice-builder-section-guards.ts` (required for `section3Complete`).

---

## 1. Step navigation logic

### Where is the “current step” tracked?

**File:** `src/features/invoices/components/invoice-builder/index.tsx`  
**Mechanism:** `useState` — not a `useReducer` and not a single numeric “step” index. The UI uses a **record of which accordion-style sections are open:**

```151:157:src/features/invoices/components/invoice-builder/index.tsx
  const [sectionOpen, setSectionOpen] = useState<Record<SectionNum, boolean>>({
    1: true,
    2: false,
    3: false,
    4: false,
    5: false
  });
```

`SectionNum` is `1 | 2 | 3 | 4 | 5` (lines 90, 101–107). The hook `useInvoiceBuilder` separately tracks `step2Values` and `lineItems` in `use-invoice-builder.ts` (lines 69–70) — that is **form/trips state**, not the visible section.

---

### What triggers the transition from “Step 2” (Parameter) → “Step 3” (Positionen)?

**File:** `src/features/invoices/components/invoice-builder/index.tsx`  
**Lines:** 392–401

When `section2Complete` becomes `true` for the **first time** (tracked with `prevSection2Complete`), a `useEffect` closes section 2, opens section 3, and scrolls:

```392:401:src/features/invoices/components/invoice-builder/index.tsx
  useEffect(() => {
    if (section2Complete && !prevSection2Complete.current) {
      setSectionOpen((s) => ({ ...s, 2: false, 3: true }));
      const id = window.setTimeout(() => {
        scrollSectionElementIntoLeftColumn(section3Ref.current, 'smooth');
      }, 300);
      return () => window.clearTimeout(id);
    }
    prevSection2Complete.current = section2Complete;
  }, [section2Complete, scrollSectionElementIntoLeftColumn]);
```

`section2Complete` is derived from `isInvoiceBuilderSection2Complete(step2Values)` (lines 249, and guards at `invoice-builder-section-guards.ts` 30–45).

`handleStep2Complete` in the hook only does `setStep2Values(values)` (`use-invoice-builder.ts` 201–203); the **UI transition** to section 3 is this effect, not the callback alone.

---

### What triggers the transition from “Step 3” (Positionen) → “Step 4” (PDF-Vorlage)?

**File:** `src/features/invoices/components/invoice-builder/index.tsx`  
**Lines:** 403–416 (primary path — **automatic** on first time `section3Complete` becomes true)

```403:416:src/features/invoices/components/invoice-builder/index.tsx
  // Reacts to Section 3 first completing: open PDF-Vorlage (Section 4) and scroll it into view.
  useEffect(() => {
    if (!section3Complete) {
      prevSection3Complete.current = false;
      return undefined;
    }
    if (prevSection3Complete.current) return undefined;
    prevSection3Complete.current = true;
    setSectionOpen((s) => ({ ...s, 3: false, 4: true }));
    const id = window.setTimeout(() => {
      scrollSectionElementIntoLeftColumn(section4Ref.current, 'smooth');
    }, 300);
    return () => window.clearTimeout(id);
  }, [section3Complete, scrollSectionElementIntoLeftColumn]);
```

**Secondary path (manual):** Lines 562–580 — when `section4Unlocked` is true, the footer “Weiter zu PDF-Vorlage” also sets `3: false, 4: true` and scrolls.

---

### Is there any condition that causes a step to be skipped or auto-advanced?

**Yes.** The effect above **auto-closes section 3 and opens section 4** the first time `section3Complete` is true. There are similar “first time complete” auto-scroll effects for 1→2 (381–390) and 2→3 (392–401), and 4→5 when `pdfStepAcknowledged` (418–431).

`section3Complete` is **not** “user clicked done on Step 3” — it is a **derived** boolean (see Q2).

---

## 2. Step 3 “skip” condition

### `useEffect` / handler calling `nextStep` / `setStep` / `goToStep`?

**Finding:** The codebase in these files does **not** use names `nextStep`, `setStep`, or `goToStep`. The equivalent is `setSectionOpen` (and `setSection` which wraps it at lines 271–273). The only automatic advance from section 3 to 4 is the **same** `useEffect` at `index.tsx` 403–416, which sets section 4 open and section 3 closed when `section3Complete` flips to true (first time).

**Hook:** `use-invoice-builder.ts` has **no** `useEffect` that calls any UI navigation. It only `setLineItems` / `setCatalogRecipientId` / `setStep2Values` as described in Q3.

---

### `useEffect` / callback that advances step when `lineItems` is set or when the query resolves?

**Indirect only:** Updating `lineItems` (and `isLoadingTrips` / `isTripsError`) changes `section3Complete` in the **parent** `index.tsx`, which re-runs the effect at 403–416. There is **no** direct “on query success → setSectionOpen” inside the hook.

**Guard used for “section 3 complete”:**

**File:** `src/features/invoices/lib/invoice-builder-section-guards.ts`  
**Lines:** 53–61

```53:61:src/features/invoices/lib/invoice-builder-section-guards.ts
export function isInvoiceBuilderSection3Complete(
  section2Complete: boolean,
  lineItems: BuilderLineItem[],
  isLoadingTrips: boolean,
  isTripsError: boolean
): boolean {
  if (!section2Complete || isLoadingTrips || isTripsError) return false;
  return lineItems.length > 0;
}
```

**Not present:** There is no `if (allPricesResolved) advance()`. **`missingPrices` does not affect `section3Complete`.** A successful fetch that returns at least one line item is enough for `section3Complete === true` as soon as `isLoadingTrips` is false and there is no error.

**Not present:** No `if (lineItems.length === 0) skip()` that advances **past** Step 3 — the opposite: `lineItems.length === 0` keeps `section3Complete` false, so the auto-advance to PDF-Vorlage **does not** run.

---

### `updateLineItemPrice` in step transition logic? Rename issues?

**Files searched:** The three in-scope files + repo grep.

- **`index.tsx`:** passes `applyGrossOverride` as `onApplyGrossOverride` to Step 3 (lines 197, 590–591). No `updateLineItemPrice`.
- **`use-invoice-builder.ts`:** exports `applyGrossOverride` (131–158), not `updateLineItemPrice`.
- **`step-3-line-items.tsx`:** props are `onApplyGrossOverride` and `onResetOverride` (123–137, 150–151); no old name.

**Remaining reference to `updateLineItemPrice`:** a **comment** in `line-item-net-display.ts` (not in the three audited files) — not executable code, so **no** runtime `ReferenceError` from a renamed prop in step transition logic.

**Conclusion:** There is no evidence of an undefined `updateLineItemPrice` causing a silent failure in the step flow in these paths.

---

## 3. `buildLineItemsFromTrips` query path in `use-invoice-builder.ts`

**File:** `src/features/invoices/hooks/use-invoice-builder.ts`  
**Lines:** 83–129

The trips query is a `useQuery` with `queryFn` that:

1. Fetches pricing rules, trips, and builds items with `buildLineItemsFromTrips` (line 110).
2. **Side effect inside `queryFn`:** `setLineItems(items)` (line 111).
3. Resolves `catalogRecipientId` via `setCatalogRecipientId` (lines 113–123).
4. `return items` (line 125).

There is **no** `onSuccess` callback on this `useQuery` in the current file. There is **no** `useEffect` in the hook that watches query result and calls navigation. **The hook does not advance the invoice builder section.**

**Separate:** `setLineItems([])` in a `useEffect` when `step2Values` is not ready for fetch (76–80) also does not call navigation.

---

## 4. Props / render of Step 3 in `index.tsx`

### Condition for `<Step3LineItems>` vs “skipped”?

**Finding:** `<Step3LineItems>` is **always** rendered as the child of the “Positionen” `BuilderSectionCard` (no ternary that omits the component). **Lines:** 552–593

```552:593:src/features/invoices/components/invoice-builder/index.tsx
          <BuilderSectionCard
            id={SECTION_SCROLL_IDS[3]}
            sectionRef={section3Ref}
            title='Positionen'
            ...
          >
            <Step3LineItems
              lineItems={lineItems}
              subtotal={totals.subtotal}
              taxAmount={totals.taxAmount}
              total={totals.total}
              missingPrices={missingPrices}
              isLoadingTrips={isLoadingTrips}
              onApplyGrossOverride={applyGrossOverride}
              onResetOverride={resetLineItemOverride}
            />
          </BuilderSectionCard>
```

The only top-level **early return** that skips the whole builder is `companyProfileMissing` (lines 449–468), not Step 3 specifically.

**What can “feel” like a skip:** `sectionOpen[3]` can become `false` when the effect at 411 runs (`3: false, 4: true`), so the **Positionen** card **collapses** while Step 3’s component is still mounted inside it — the user’s attention is scrolled to section 4.

---

## Senior-level diagnosis (most likely cause)

| Hypothesis | Verdict |
|------------|---------|
| **A step auto-advance in a `useEffect` or query callback** | **Primary match.** `index.tsx` **lines 403–416**: on the **first** transition to `section3Complete === true`, the effect **automatically** sets `sectionOpen` to close section 3 and open section 4 and scrolls to the PDF-Vorlage card. That runs as soon as: section 2 is complete, trips are not loading, there is no trips error, and **`lineItems.length > 0`** (`invoice-builder-section-guards.ts` 53–61). Filling/finalizing prices is **not** required. The query in `use-invoice-builder.ts` only feeds `lineItems` / loading / error; the **auto-advance is entirely in the shell’s `useEffect`**, not in `onSuccess`. |
| **A conditional render that is no longer matching** | **Not supported** for “Step 3 not mounted”: `Step3LineItems` is unconditionally rendered. The visible “skip” is **accordion state** (section 3 closed, 4 open), not unmounting Step 3. |
| **Old `updateLineItemPrice` reference → silent failure** | **Not supported** in these files: wiring uses `applyGrossOverride` / `onApplyGrossOverride` consistently; leftover name appears only in an unrelated comment elsewhere. |
| **Something else** | Possible UX confusion (user expects to stay on Positionen until explicit confirmation) vs intentional “progressive” auto-open of PDF-Vorlage once data exists — but the **mechanism** in code is the `section3Complete` + `useEffect` at 403–416, not the trip hook’s callback by name. |

**Bottom line:** The **most likely cause** of “Step 3 was skipped on invoice creation” is the **`useEffect` in `index.tsx` (lines 403–416)** that **auto-advances from Positionen to PDF-Vorlage** the first time `isInvoiceBuilderSection3Complete` becomes true — which happens when the trips query has finished successfully with at least one line item, **regardless of missing prices** or user review of Step 3.
