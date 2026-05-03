# Letters PDF — DIN alignment audit

Read-only audit of `pdf-layout-constants.ts`, `pdf-styles.ts`, and the three PDF roots + cover bodies (invoice, Angebot, letter). No code or other files were modified.

---

## 1. DIN constants vs styles

### Constants that affect the **top** of the page (and “where subject/body starts” indirectly)

**`PDF_PAGE`** (`src/features/invoices/lib/pdf-layout-constants.ts`)

| Constant | Value (pt) | Role |
|----------|------------|------|
| `marginTop` | 57 | Top inset for **flow** content: applied as `paddingTop` on `styles.page` / `styles.angebotPage` (content starts below this, measured from the page’s top edge in the usual box model). |
| `marginLeft` / `marginRight` | 45 | Horizontal rails; **brief** address window uses `left: PDF_PAGE.marginLeft` (not `PDF_DIN5008.addressWindowLeft`). |

**`PDF_DIN5008`** (same file)

| Constant | Value (pt) | Role |
|----------|------------|------|
| `addressWindowTop` | 127.56 (~45 mm) | **Absolute** top edge of the Anschriftfenster, **from the page top** (siblings use `position: 'absolute'`, `top: …` in `InvoicePdfDocument` / `AngebotPdfDocument` / `LetterPdfDocument`). |
| `addressWindowHeight` | 127.56 | `maxHeight` on the window `View` (with `overflow: 'hidden'`). Bottom of the nominal window band ≈ **255.12 pt** from page top if fully used. |
| `addressWindowLeft` | 56.69 | Defined for DIN geometry; **not** used for the brief window `left` in the three documents — they use `PDF_PAGE.marginLeft` (45). |
| `addressWindowWidth` | 240.94 | Defined; window width in documents is **`'52%'`** of page width, not this constant. |
| Fold marks | `fold1`, `lochmarke`, `fold2`, `foldMarkX`, `foldMarkWidth`, `foldMarkStroke` | Decorative; do not position body text. |

**`PDF_ZONES`** — not DIN window geometry, but control **vertical gap before subject** (and related rhythm)

| Constant | Value (pt) | Role |
|----------|------------|------|
| `subjectMarginTopWithReferenceBar` | 6 | Invoice: margin above subject when a reference bar is present. |
| `subjectMarginTopDefault` | 8 | Fallback in `InvoicePdfCoverBody` if parent does not override. |
| `subjectMarginTopOffer` | 12 | Used as **`marginTop` on the first block** in **Angebot** and **letter** cover bodies (“offer has no reference bar” / same spacing as invoice without reference bar). |
| `headerRowMarginBottom` | 2 | Under `InvoicePdfCoverHeaderBrief` row (`styles.headerRow`). |
| `brandStackMarginBottom` | 12 | Under logo/slogan stack in header styles. |
| `recipientBlockMarginTop` | 4 | Nudges **recipient block** text inside the window (`styles.recipientBlock`). |

**There is no named constant** such as “body start below window” or `addressWindowBottom + gap` tying flow text to `addressWindowTop + addressWindowHeight`.

### How these feed `pdf-styles.ts` for page / header / top-of-body area

- **`styles.page`** — `paddingTop: PDF_PAGE.marginTop`, horizontal `paddingLeft` / `paddingRight` from `PDF_PAGE`, `paddingBottom: PDF_PAGE.marginBottom`. Used by **invoice** cover `Page`.
- **`styles.angebotPage`** — **same numeric** `paddingTop` / horizontal / `paddingBottom` as `page`. Used by **Angebot** and **letter** `Page`.
- **`styles.angebotPageBody`** — `flex: 1`, `width: '100%'` only; **no** top margin tied to DIN window.
- **`styles.headerRow`** — `marginBottom: PDF_ZONES.headerRowMarginBottom` (Brief header uses this).
- **`styles.subject` / `styles.salutation`** — use `PDF_ZONES.subjectMarginBottom` and `salutationMarginBottom` for **gaps between** Betreff, Anrede, and following text; they do **not** encode “clear the window”.

---

## 2. Invoice DIN brief: top layout

**File:** `InvoicePdfDocument.tsx`, **brief** (`renderMode === 'brief'`).

### Address window

- **Position:** `View` with `position: 'absolute'`, `top: PDF_DIN5008.addressWindowTop` (127.56 pt from **page top**), `left: PDF_PAGE.marginLeft` (45 pt), `width: '52%'`, `maxHeight: PDF_DIN5008.addressWindowHeight`, `overflow: 'hidden'`.
- **Content:** `InvoicePdfRecipientBlock` (and optional secondary legal recipient on invoices).

### Flow after the window

1. **`InvoicePdfCoverHeaderBrief`** — branding + sender line + meta grid only (no recipient in header). Wrapped in `styles.headerRow` (`flexDirection: 'row'`, `marginBottom: PDF_ZONES.headerRowMarginBottom`).
2. **Optional `InvoicePdfReferenceBar`** — adds vertical space when client reference fields exist.
3. **`InvoicePdfCoverBody`** — first block is `View` with `marginTop: subjectSectionMarginTop`:
   - 6 pt if reference bar present (`PDF_ZONES.subjectMarginTopWithReferenceBar`),
   - 12 pt otherwise (`PDF_ZONES.subjectMarginTopOffer`).

### Where subject / salutation / intro start relative to the window

- They start in **normal flow**, **after** the brief header (and reference bar if any), plus **`subjectSectionMarginTop`**, all measured from the **padded content area** (which itself begins **`PDF_PAGE.marginTop` below the page top**).
- **There is no dedicated `marginTop` or spacer** whose value is `addressWindowTop + addressWindowHeight − …` or otherwise guaranteed to place the Betreff **below** the DIN window band (~127.56–255.12 pt from page top).
- Clearance from the window is **implicit**: it depends on the **rendered height** of the brief header (logo, slogan, sender line, meta box) plus 2 pt (`headerRowMarginBottom`) plus optional reference bar plus 6 or 12 pt. If that stack is **short**, the subject block can begin **vertically inside** the same Y-range as the window.

---

## 3. Angebot DIN brief: top layout

**Files:** `AngebotPdfDocument.tsx`, `AngebotPdfCoverBody.tsx`.

### Same address window + header?

- **Yes** (when `renderMode === 'brief'`): same fold marks, same absolute window (`top`, `left`, `width`, `maxHeight`, `overflow`), same `InvoicePdfCoverHeaderBrief` pattern (with Angebot `metaConfig`).

### Where `AngebotPdfCoverBody` starts

- **`AngebotPdfDocument`** wraps the body in `<View style={styles.angebotPageBody} wrap>` **after** the header (no reference bar on offers).
- **`AngebotPdfCoverBody`** begins with a `View` whose **`marginTop` is `PDF_ZONES.subjectMarginTopOffer` (12 pt)**, then optional subject `Text`, then salutation, then intro HTML, table, outro.

### Vertical start vs invoice cover body (brief mode)

- **Invoice (brief):** `InvoicePdfCoverBody` is **not** wrapped in `angebotPageBody`; it follows the header and optional reference bar directly. First content `marginTop` is **6 or 12 pt** (`subjectSectionMarginTop`).
- **Angebot (brief):** First content `marginTop` is **12 pt** (always `subjectMarginTopOffer` — no reference bar).
- **Extra wrapper:** Angebot has **`styles.angebotPageBody`** around the cover body; that style has **no additional top margin** — it does not by itself lower the subject vs invoice. For a typical invoice **without** reference bar, both use **12 pt** above the subject block; the **invoice header stack height** is the main variable vs Angebot (same header component, so usually the same).

---

## 4. Letter DIN brief: top layout

**Files:** `letter-pdf-document.tsx`, `letter-pdf-cover-body.tsx`.

### Use of `styles.angebotPage` and `PDF_DIN5008`

- **`Page`** uses **`styles.angebotPage`** — same `paddingTop: PDF_PAGE.marginTop` (57), same horizontal padding and `paddingBottom` as offers/invoices (invoice uses `styles.page`, which matches numerically).
- **Fold marks** and **address window** use the **same** absolute positioning as invoice/Angebot brief: `top: PDF_DIN5008.addressWindowTop`, `left: PDF_PAGE.marginLeft`, `width: '52%'`, `maxHeight: PDF_DIN5008.addressWindowHeight`, `overflow: 'hidden'`.
- **`InvoicePdfCoverHeaderBrief`** with letter-specific `metaConfig` (Briefdaten, status row, etc.).

### Use of `styles.angebotPageBody`

- **`LetterPdfDocument`** renders `<View style={styles.angebotPageBody} wrap><LetterPdfCoverBody … /></View>` **immediately after** the brief header — **same position in the tree as `AngebotPdfDocument`**.

### `LetterPdfCoverBody`

- First block: `View` with **`marginTop: PDF_ZONES.subjectMarginTopOffer` (12 pt)** — **same token** as **`AngebotPdfCoverBody`**.
- Then optional subject, salutation, HTML body, closing.

### Where the subject/salutation block sits (conceptually)

Let **page Y = 0** be the top of the physical page.

- **Padding:** Flow content lives in the area that starts at **Y ≈ `PDF_PAGE.marginTop` = 57** (top inner edge of the content box).
- **Address window (absolute):** Occupies **Y ≈ 127.56 … 255.12** (page coordinates), overlapping the padded region **without** expanding flow layout.
- **First flow row:** `InvoicePdfCoverHeaderBrief` begins **below** the top padding; its **height** depends on logo/slogan/sender/meta.
- **Letter subject `View`:** Starts **after** that header, plus **`headerRowMarginBottom` (2)**, plus **`subjectMarginTopOffer` (12)** on the first inner `View` of `LetterPdfCoverBody`.

**Relation to window:** There is **no explicit rule** in code that the subject’s top ≥ `addressWindowTop + addressWindowHeight`. The subject line is positioned purely by **flow order + fixed small margins**, while the recipient is **absolute** in the window band.

---

## 5. Why letters can overlap at the top (mechanically)

### Geometry (numbers from constants)

- **`PDF_PAGE.marginTop`:** 57 pt.
- **Window (absolute, page Y):** from **127.56** to roughly **127.56 + 127.56 = 255.12** pt if the block used the full `maxHeight`.
- **Flow** starts at **57 pt** + **height(header brief)** + **2 pt** + **12 pt** (letter’s `subjectMarginTopOffer` on the body’s first `View`).

If **`57 + headerHeight + 2 + 12` < 255.12**, the **Betreff / Anrede / start of body** can lie **vertically inside the DIN window band**. The recipient text is still laid out inside the absolute window `View`; the subject/salutation/body are **siblings rendered later** in document order (after folds → window → header → body wrapper). In typical PDF/compositor order, **later paint can sit on top of earlier content** in the same region → **visual collision** (text over text), or crowded overlap depending on engine.

### Recipient vs subject vs body

- **Recipient block:** clipped by **`maxHeight` + `overflow: 'hidden'`** on the window; long addresses truncate rather than pushing flow.
- **Subject / salutation / HTML:** **No** `minY` tied to window bottom; they follow the header. A **tall** meta grid or logo can push them down; a **compact** profile (small logo, no slogan) keeps them **high** → **more overlap risk** with the window band.

### Letters vs Angebot / invoice (wrapper / “skip window” margin)

- **Letter vs Angebot (brief):** Same **`angebotPage`**, same absolute window, same **`InvoicePdfCoverHeaderBrief`**, same **`angebotPageBody`** + **`subjectMarginTopOffer` (12)** on the first body block. **No extra** letter-only spacer and **no missing** Angebot-only spacer in the audited code paths.
- **Letter vs invoice (brief):** Invoice omits the **`angebotPageBody`** wrapper but uses the same header and the same **12 pt** (or 6 pt with reference bar) before the subject. The wrapper **does not add** DIN-window clearance.

**Conclusion:** The overlap class of bugs is **not letter-specific** in this codebase: it comes from **absolute window + flow body** without a **window-bottom-aware** offset. Letters **always** use brief layout; Angebote/invoices often use **digital** mode in the UI, where the recipient sits in **flow** under the header — a **different** geometry — so problems are easier to notice on **letters**.

---

## 6. Is DIN logic actually identical between Angebot and letters?

### Shared (letters ↔ Angebot brief)

- **`PDF_DIN5008`:** fold marks, `addressWindowTop`, `addressWindowHeight`, stroke/position for marks (same usage pattern).
- **`PDF_PAGE.marginLeft`** for window `left` (same as invoice brief).
- **`styles.angebotPage`** on `Page`.
- **`InvoicePdfCoverHeaderBrief`** + **`styles.headerRow`** / **`headerLeft`** / **`headerRight`** from `pdf-styles.ts`.
- **`styles.angebotPageBody`** wrapping the cover body.
- **First body block `marginTop`:** **`PDF_ZONES.subjectMarginTopOffer` (12)** in both `AngebotPdfCoverBody` and `LetterPdfCoverBody`.

### Differences (not DIN geometry)

- **Tree content:** `AngebotPdfCoverBody` vs `LetterPdfCoverBody` (table vs HTML-only, different props).
- **`metaConfig`** on the brief header differs (Angebotsdaten vs Briefdaten).
- **Letters** have no reference bar (invoice-only).
- **Constants `PDF_DIN5008.addressWindowLeft` / `addressWindowWidth`** are **not** applied to the window `View` in any of the three — all use **`marginLeft` + `52%`**; letters are not unique here.

**Verdict:** For **brief mode**, **Angebot** and **letters** share the **same** DIN-related positioning strategy and the **same** body wrapper + **12 pt** subject offset. There is **no** extra Angebot-only DIN skip that letters lack in the listed files.

---

## 7. Minimal alignment options

### Option A — Single “flow body starts after window” constant (geometry-based)

- **Idea:** In `pdf-layout-constants.ts`, define e.g. `briefFlowMinTopFromPageTop = PDF_DIN5008.addressWindowTop + PDF_DIN5008.addressWindowHeight + gapPt` (or a named gap in `PDF_ZONES`), then compute a **minimum `marginTop`** on the **first body block** so that (in page coordinates) the subject does not start above that line.
- **Catch:** The first body block’s Y also depends on **header height** (variable). So either:
  - use a **conservative fixed** extra margin (simple, may over-space for large logos), or
  - pass **`renderMode`** into cover bodies and add **brief-only** spacing derived from a **documented assumed header height** (fragile), or
  - measure header (not available declaratively in current components).
- **Touches:** New constant(s); **`LetterPdfCoverBody`**, **`AngebotPdfCoverBody`**, and likely **`InvoicePdfCoverBody`** (brief branch) — **all brief PDFs** if applied consistently.
- **Affects:** **Invoices (brief), Angebote (brief), letters** if applied everywhere; **letters only** if you branch only in `LetterPdfCoverBody` (then **not** identical to Angebot).

### Option B — Reuse one wrapper + `paddingTop` on `angebotPageBody` for brief only

- **Idea:** For `renderMode === 'brief'`, set `paddingTop` (or `marginTop`) on **`styles.angebotPageBody`** or a variant style so the **entire** cover body column starts lower — single place for Angebot + letter.
- **Touches:** `pdf-styles.ts` (new style or dynamic style), **`AngebotPdfDocument`**, **`LetterPdfDocument`**; invoice would need an equivalent wrapper around **`InvoicePdfCoverBody`** for parity (today there is none).
- **Affects:** **Angebot + letter** trivially; **invoice brief** only if you add a wrapper — changes **invoice** layout if shipped.

### Option C — Letter-only spacer (pragmatic under “do not change invoice/Angebot”)

- **Idea:** Add **`marginTop`** (or `paddingTop` on the inner first `View`) **only** in **`LetterPdfCoverBody`** (or the letter’s `angebotPageBody` wrapper), using a constant derived from `PDF_DIN5008` + a safe fudge factor so subject clears ~255 pt from page top given a **typical** header height assumption.
- **Touches:** Prefer **`letter-pdf-cover-body.tsx`** or **`letter-pdf-document.tsx`** only.
- **Affects:** **Letters only** — **violates strict pixel parity** with Angebot brief but satisfies **“invoice & Angebot unchanged.”**

---

## 8. Recommended approach

### Constraint recap

You asked for options that make letters **behave like** Angebot/invoice at the top, while **keeping current invoice and Angebot PDF output**. Those goals **conflict** if the root cause is **shared** (no window-bottom clearance): a **correct** shared fix **changes** brief Angebot and brief invoice pixels too.

### Best path **now**

1. **Treat the issue as shared geometry** (absolute window vs flow) and **confirm** whether **`AngebotPdfDocument` with `renderMode='brief'`** shows the same overlap class as letters for a **small logo / no slogan** profile. If yes, letter-specific-only fixes are **papering over** inconsistency between **digital** (default) and **brief** paths.
2. **Under strict “no invoice/Angebot visual change”:** implement **Option C** (letter-only extra top margin or padding on the body column), driven by a **new constant** in `pdf-layout-constants.ts` (e.g. `letterBriefBodyExtraMarginTop`) so the hack is **documented and tunable**, with a comment that it compensates for missing global `brief` body offset.
3. **Next phase (when PDF changes are allowed):** promote to **Option A** for **all** `renderMode === 'brief'` documents (invoice, Angebot, letter) with a single derived spacing rule, and remove the letter-only fudge.

### Implementation sequence (3–4 steps)

1. **Reproduce** with brief layout: minimal header (no slogan, small logo) + short subject; export **letter PDF** and, if possible, **Angebot PDF** with `renderMode='brief'` for comparison.
2. **Add** a documented constant for extra clearance (either letter-only or brief-global per policy).
3. **Apply** the margin in the chosen component(s); **avoid** changing `styles.page` / `styles.angebotPage` shared padding unless all products agree.
4. **Regression-check** digital invoice/Angebot (default `renderMode`) and fixed footer/page numbers unchanged.

---

## 9. Implementation (Option 2 — letter-only extra top offset)

**Status:** Shipped as a temporary, letter-specific compensation for the missing global brief-body offset described in §5–7.

- **Export:** `PDF_ZONES_LETTER` in [`src/features/invoices/lib/pdf-layout-constants.ts`](../../src/features/invoices/lib/pdf-layout-constants.ts), with:
  - `briefBodySafetyBufferPt` — gap below the DIN window band (page Y).
  - `briefHeaderFlowReservePt` — stand-in for typical `InvoicePdfCoverHeaderBrief` flow height (pt); tune after visual QA.
  - `briefBodyExtraMarginTop` — `Math.max(0, …)` incremental `marginTop` on the letter body wrapper, derived from `PDF_DIN5008.addressWindowTop` + `addressWindowHeight`, `PDF_PAGE.marginTop`, and `PDF_ZONES.headerRowMarginBottom` / `subjectMarginTopOffer`.
- **Application:** Only [`src/features/letters/components/letter-pdf/letter-pdf-document.tsx`](../../src/features/letters/components/letter-pdf/letter-pdf-document.tsx) imports `PDF_ZONES_LETTER`; the value is merged into the `angebotPageBody` wrapper `View` as `marginTop`. Invoice and Angebot PDFs are unchanged.
- **Follow-up:** Replace with a shared `renderMode === 'brief'` body offset for invoice, Angebot, and letter when product allows one consistent brief layout.

---

*End of audit.*
