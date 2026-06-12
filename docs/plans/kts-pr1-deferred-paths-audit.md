# KTS PR1 — Deferred Paths Audit

**Date:** 2026-06-10  
**Scope:** Verify whether five files deferred from PR1 (`kts.service.ts` / `normalizeKtsPatch`) can safely remain outside the service layer.  
**Context:** PR1 introduces `normalizeKtsPatch()` as the single point of truth for KTS cascade rules:

1. `kts_document_applies: false` → cascade `kts_fehler: false`, `kts_fehler_beschreibung: null`
2. `kts_fehler: false` → cascade `kts_fehler_beschreibung: null`
3. `kts_document_applies: true` + no `kts_source` in patch → add `kts_source: 'manual'`
4. `kts_fehler_beschreibung` present → trim; empty string → `null`

**Files audited:**

- [`src/features/trips/components/create-trip/create-trip-form.tsx`](../../src/features/trips/components/create-trip/create-trip-form.tsx)
- [`src/features/trips/components/create-trip/schema.ts`](../../src/features/trips/components/create-trip/schema.ts)
- [`src/features/trips/lib/duplicate-trips.ts`](../../src/features/trips/lib/duplicate-trips.ts)
- [`src/features/trips/lib/build-return-trip-insert.ts`](../../src/features/trips/lib/build-return-trip-insert.ts)
- [`src/lib/recurring-trip-generator.ts`](../../src/lib/recurring-trip-generator.ts)
- [`src/features/trips/components/bulk-upload-dialog.tsx`](../../src/features/trips/components/bulk-upload-dialog.tsx)

---

## Summary table

| File | Defer from PR1 safe? | `normalizeKtsPatch` needed? |
|------|----------------------|---------------------------|
| `create-trip-form.tsx` (+ `schema.ts`) | **Yes** | Optional follow-up (belt-and-suspenders) |
| `duplicate-trips.ts` | **Conditional** | Follow-up cleanup PR on insert payload |
| `build-return-trip-insert.ts` | **Conditional** | Follow-up cleanup PR (sanitize only) |
| `recurring-trip-generator.ts` | **Yes** | No |
| `bulk-upload-dialog.tsx` | **Yes** | No |

---

## 1. `create-trip-form.tsx` (+ `schema.ts`)

### 1a. KTS toggle on/off before submit — form-state cascade?

**Yes, the user can toggle KTS on and off** via the switch in [`payer-section.tsx`](../../src/features/trips/components/create-trip/sections/payer-section.tsx) (lines 244–264). There is **no** `kts_fehler` or `kts_fehler_beschreibung` UI in Neue Fahrt.

When KTS is turned off, the switch handler only calls `field.onChange(c)` — it does **not** clear `kts_fehler` or `kts_fehler_beschreibung` in form state (unlike the detail sheet, which clears fehler drafts on KTS off).

**However**, under normal use those fields never leave defaults:

- `defaultValues` in `create-trip-form.tsx` (lines 197–200): `kts_fehler: false`, `kts_fehler_beschreibung: null`
- No form control exposes fehler fields

**Edge case:** localStorage draft restore ([`use-create-trip-draft.ts`](../../src/features/trips/hooks/use-create-trip-draft.ts) lines 39–42) can rehydrate `kts_fehler` / `kts_fehler_beschreibung` if they were ever persisted. A user could then toggle KTS off while stale fehler values remain **in React state** until submit.

**Cascade today:** **submit path only**, not on toggle.

### 1b. Submit guard — inconsistent insert?

**Submit explicitly prevents inconsistent DB rows** (`create-trip-form.tsx` lines 1305–1309):

```ts
const ktsFehlerForDb =
  !!values.kts_document_applies && !!values.kts_fehler;
const ktsFehlerBeschreibungForDb = ktsFehlerForDb
  ? values.kts_fehler_beschreibung?.trim() || null
  : null;
```

`baseTrip` (lines 1319–1321) uses these normalized values, not raw form fields. **A trip with `kts_document_applies: false` cannot be inserted with `kts_fehler: true` or non-null beschreibung** via the current submit path.

**Schema guard** ([`schema.ts`](../../src/features/trips/components/create-trip/schema.ts) lines 77–87): rejects beschreibung text when `kts_fehler` is false. It does **not** reject `kts_fehler: true` when `kts_document_applies` is false (that case is handled only on submit).

### 1c. Need `normalizeKtsPatch` on create submit?

**Not required for correctness today.** Submit normalization + DB defaults are sufficient.

**Optional follow-up:** wrap `baseTrip` KTS fields through `normalizeKtsPatch` for a single SSOT and to align with PR1 cascade semantics (e.g. rule 4 trim on beschreibung if fehler were ever editable in Neue Fahrt).

### `kts_source` on create

Submit sets `kts_source` explicitly (lines 1281–1282, 1322): `manual` when user touched the KTS switch (`ktsUserLockedRef` via `markKtsUserTouched` at line 154–156), otherwise resolver tier. Rule 3 (`manual` when KTS on without source) does not apply to create — source is always computed.

### Verdict

| Question | Answer |
|----------|--------|
| Defer safe? | **Yes** |
| Risk | Stale form state if draft ever contained fehler fields; **DB insert remains consistent** |
| `normalizeKtsPatch` in PR1? | **No** |
| Follow-up? | Optional: call on `baseTrip` KTS slice + clear fehler drafts when KTS toggled off in payer section |

---

## 2. `duplicate-trips.ts`

### Behaviour

[`copyRouteAndPassengerFields`](../../src/features/trips/lib/duplicate-trips.ts) (lines 298–301) copies KTS fields from source **verbatim** (with boolean coercion):

| Field | Copy behaviour |
|-------|----------------|
| `kts_document_applies` | `!!source.kts_document_applies` |
| `kts_fehler` | `!!source.kts_fehler` |
| `kts_fehler_beschreibung` | `source.kts_fehler_beschreibung ?? null` |
| `kts_source` | **Always** `'manual'` (line 301) — not copied from source |

`kts_source` is **always** forced to `'manual'` on every duplicate (documented in [`docs/kts-architecture.md`](../../docs/kts-architecture.md) §3.2).

### Can duplicate insert `kts_document_applies: false` + `kts_fehler: true`?

**Yes, if the source trip has that inconsistent combination in the database.**

Normal edit paths (inline cells, detail sheet) cascade fehler off when KTS is turned off, so **well-maintained data** should not have this state. It could exist from:

- Legacy rows before cascade was implemented
- Direct DB manipulation
- A future bug outside normalized write paths

The duplicate path **does not** run cascade rules — it mirrors source flags.

### Valid intentional copy

If source has `kts_document_applies: true` and `kts_fehler: true` (open correction), duplicate **should** copy both — that is correct for “duplicate this trip mid-workflow.”

### Verdict

| Question | Answer |
|----------|--------|
| Defer safe? | **Conditional** |
| Risk | Propagates **corrupt** source state (`kts` off + `fehler` on); does not create corrupt state from valid source |
| `normalizeKtsPatch` in PR1? | **No** — out of PR1 scope |
| Follow-up? | **Yes** — apply `normalizeKtsPatch` to duplicate insert payload in a small cleanup PR (sanitizes corrupt source without changing valid KTS+fehler copies) |

---

## 3. `build-return-trip-insert.ts`

### Behaviour

Lines 96–100 copy from outbound leg:

```ts
kts_document_applies: outbound.kts_document_applies,
kts_fehler: outbound.kts_fehler ?? false,
kts_fehler_beschreibung: outbound.kts_fehler_beschreibung ?? null,
kts_source: outbound.kts_source ?? 'manual',
```

**Verbatim copy** from outbound (with nullish defaults). No cascade when outbound has KTS off.

### Open correction on return leg

If outbound has `kts_fehler: true` with KTS on, the return leg **inherits** fehler + beschreibung. This matches **paired-trip sync** semantics (detail sheet mirrors KTS/fehler to Gegenfahrt) and is **intentional**, not a bug.

### Inconsistent outbound

Same as duplicate: if outbound has `kts_document_applies: false` but `kts_fehler: true`, return inherits the inconsistency.

### Verdict

| Question | Answer |
|----------|--------|
| Defer safe? | **Conditional** |
| Risk | Same as duplicate for corrupt source; **correct** for valid KTS+fehler outbound |
| `normalizeKtsPatch` in PR1? | **No** |
| Follow-up? | **Yes** — `normalizeKtsPatch` on return insert payload (cleanup PR); do not strip fehler when both KTS and fehler are true on outbound |

**Note:** Bulk CSV return trips use a separate `buildReturnTrip` in [`bulk-upload-dialog.tsx`](../../src/features/trips/components/bulk-upload-dialog.tsx) (line 533) that spreads `...outbound` — see §5; outbound rows never set fehler fields.

---

## 4. `recurring-trip-generator.ts`

### Behaviour

[`buildTripPayload`](../../src/lib/recurring-trip-generator.ts) (lines 289–291) copies from `recurring_rules` only:

- `kts_document_applies: rule.kts_document_applies ?? false`
- `kts_source: rule.kts_source ?? null`

**`kts_fehler` and `kts_fehler_beschreibung` are not in the payload.**

### Can a recurring rule have `kts_fehler: true`?

**No.** [`recurring_rules`](../../src/types/database.types.ts) Row (lines 911–912) has only `kts_document_applies` and `kts_source` — no fehler columns. Client recurring rule forms ([`recurring-rule-form-body.tsx`](../../src/features/clients/components/recurring-rule-form-body.tsx)) do not set fehler.

Generated trips omit fehler fields → Postgres applies column defaults (`kts_fehler false`, `kts_fehler_beschreibung null` per migration `20260504130000_kts_fehler.sql`).

### Verdict

| Question | Answer |
|----------|--------|
| Defer safe? | **Yes** |
| Risk | None for fehler/cascade rules |
| `normalizeKtsPatch` in PR1? | **No** |
| Follow-up? | Optional only if rules later gain fehler fields (not planned) |

---

## 5. `bulk-upload-dialog.tsx`

### Behaviour

Per-row KTS resolution (lines 861–880):

- CSV explicit cell → `ktsDocumentApplies` + `kts_source: 'manual'`
- Otherwise → `resolveKtsDefault()` → `ktsDocumentApplies` + catalog `kts_source`

Insert payload (lines 1020–1021) sets **only**:

- `kts_document_applies`
- `kts_source`

**`kts_fehler` and `kts_fehler_beschreibung` are never set** on staged or inserted trips. DB defaults apply (`false` / `null`).

CSV types ([`bulk-upload-types.ts`](../../src/features/trips/components/bulk-upload/bulk-upload-types.ts)) expose no fehler columns.

### Return trips in bulk upload

`buildReturnTrip` (lines 533–573) spreads `...outbound` then overrides route/link fields. Outbound `InsertTrip` objects do not include fehler fields, so returns inherit the same absence → DB defaults.

### Can bulk produce `kts_document_applies: false` + fehler set?

**No** for fehler/beschreibung (always defaulted).

For `kts_document_applies: false` with fehler defaulted false — consistent.

CSV can set `kts_document_applies: false` explicitly (`ktsParsed === 'false'`) with `kts_source: 'manual'` — still no fehler fields.

### Verdict

| Question | Answer |
|----------|--------|
| Defer safe? | **Yes** |
| Risk | None for cascade rules 1–2 and 4 |
| `normalizeKtsPatch` in PR1? | **No** |
| Follow-up? | Optional: rule 3 irrelevant (source always set); could normalize for consistency if CSV adds fehler columns in a future module |

---

## Cross-cutting: when deferral is unsafe

The deferred paths share one real gap: **copy/insert paths trust source data** and do not run cascade rule 1. That matters only when the **source row is already inconsistent** (`kts_document_applies: false` with `kts_fehler: true` or stale beschreibung).

| Path | Creates inconsistency? | Propagates existing inconsistency? |
|------|------------------------|-----------------------------------|
| Neue Fahrt submit | No (submit guard) | N/A |
| Duplicate | No (from valid source) | Yes (from corrupt source) |
| Rückfahrt insert | No (from valid outbound) | Yes (from corrupt outbound) |
| Recurring cron | No | No (fehler not copied) |
| Bulk CSV | No | No (fehler not set) |

PR1 edit paths (inline + detail + paired sync) will enforce cascades on **updates**. Copy paths should adopt `normalizeKtsPatch` in a **follow-up cleanup PR** (post-PR1, pre-Module A if desired) — not required to ship PR1.

---

## Recommendations

### PR1 (current scope)

Keep all five files deferred. The PR1 argument — *“these paths copy or insert rather than edit, so cascade rules do not apply”* — is:

- **Fully correct** for: create-trip submit, recurring generator, bulk upload
- **Mostly correct** for: duplicate and return insert (copy is intentional for valid KTS+fehler; cascade only matters for corrupt source)

### Follow-up cleanup PR (suggested: PR1.5 or early PR2)

Single small PR after `kts.service.ts` lands:

1. [`duplicate-trips.ts`](../../src/features/trips/lib/duplicate-trips.ts) — run `normalizeKtsPatch` on KTS fields before insert
2. [`build-return-trip-insert.ts`](../../src/features/trips/lib/build-return-trip-insert.ts) — same
3. Optional: [`create-trip-form.tsx`](../../src/features/trips/components/create-trip/create-trip-form.tsx) — `normalizeKtsPatch` on `baseTrip` KTS slice + clear fehler on KTS-off toggle in payer section

### Do not defer to Module A/B

`normalizeKtsPatch` on copy paths is unrelated to `kts_corrections` schema work — keep it as a hygiene PR between PR1 and PR2.

---

## References

- PR1 plan: [`.cursor/plans/kts_service_pr1_503c5297.plan.md`](../../.cursor/plans/kts_service_pr1_503c5297.plan.md)
- Architecture audit: [`docs/plans/kts-module-a-architecture-audit.md`](./kts-module-a-architecture-audit.md)
- Canonical KTS docs: [`docs/kts-architecture.md`](../kts-architecture.md)
