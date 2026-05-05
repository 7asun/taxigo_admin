# MwSt/Gesamt column ID audit (draft edit schema refresh)

Date: 2026-05-05

This audit answers the 6 questions using **exact code citations** and **direct Supabase query results** (no guessing).

---

## Inputs used (Supabase rows)

All SQL was executed against project `etwluibddvljuhkxjkxs`.

Draft Angebot picked (most recently updated draft):

- `angebote.id`: `c1512ed5-a81e-4fc0-824f-49289c74a1a6`
- `angebote.company_id`: `8df83726-cd59-4fd0-87df-0bd905915fec`
- `angebote.angebot_vorlage_id`: `daef432c-8409-45e2-8703-110d4a1a3ed0`
- `angebote.angebot_number`: `AG-2026-05-0001`

---

## 1) Live Vorlage column IDs (ordered) — MwSt vs Gesamt

Source: Supabase query `public.angebot_vorlagen` for `company_id='8df83726-cd59-4fd0-87df-0bd905915fec'`, returning the Vorlage row with `id='daef432c-8409-45e2-8703-110d4a1a3ed0'` (name: `Katrin Meyer`).

**Live columns in order (id → header):**

1. `col_leistung` → `Leistung`
2. `3b4e8b70-ec31-4ea5-82b1-b5be9cf9ff53` → `Uhrzeit`
3. `317dc004-db51-4778-8940-8be115d80a5d` → `Tage`
4. `col_anfahrtkosten` → `Anfahrt`
5. `495256ee-8e73-4885-8191-95478b6313dc` → `KM`
6. `a6a580b9-3f42-4545-a95b-5db0dd9b8f9c` → `Preis / km`
7. `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4` → `MwSt`
8. `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f` → `Gesamt (brutto)`

So specifically:

- **MwSt column id**: `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`
- **Gesamt column id** (now “Gesamt (brutto)”): `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f`

---

## 2) Saved snapshot column IDs (ordered) — `table_schema_snapshot`

Source: Supabase query of `public.angebote.table_schema_snapshot` for `angebote.id='c1512ed5-a81e-4fc0-824f-49289c74a1a6'`.

**Snapshot columns in order (id → header):**

1. `col_leistung` → `Leistung`
2. `3b4e8b70-ec31-4ea5-82b1-b5be9cf9ff53` → `Uhrzeit`
3. `317dc004-db51-4778-8940-8be115d80a5d` → `Tage`
4. `col_anfahrtkosten` → `Anfahrt`
5. `495256ee-8e73-4885-8191-95478b6313dc` → `KM`
6. `a6a580b9-3f42-4545-a95b-5db0dd9b8f9c` → `Preis / km`
7. `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4` → `Gesamt`

Notably, the snapshot does **not** contain `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f`.

---

## 3) Existing row `data` keys (line items)

Source: Supabase query `public.angebot_line_items.data` for `angebot_id='c1512ed5-a81e-4fc0-824f-49289c74a1a6'`, ordered by `position`.

### Row position 1 (`angebot_line_items.id = ec2c39ec-986d-4b1b-8aed-504757dcce4f`)

Keys present in `data`:

- `col_leistung`
- `col_anfahrtkosten`
- `317dc004-db51-4778-8940-8be115d80a5d`
- `3b4e8b70-ec31-4ea5-82b1-b5be9cf9ff53`
- `495256ee-8e73-4885-8191-95478b6313dc`
- `a6a580b9-3f42-4545-a95b-5db0dd9b8f9c`
- `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`

### Row position 2 (`angebot_line_items.id = 7eb5717d-4415-4e60-b6cc-10cf28e5b0f5`)

Keys present in `data` (same set as row 1):

- `col_leistung`
- `col_anfahrtkosten`
- `317dc004-db51-4778-8940-8be115d80a5d`
- `3b4e8b70-ec31-4ea5-82b1-b5be9cf9ff53`
- `495256ee-8e73-4885-8191-95478b6313dc`
- `a6a580b9-3f42-4545-a95b-5db0dd9b8f9c`
- `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`

---

## 4) Column ID overlap (snapshot vs live Vorlage vs row data)

### 4a) Does any column ID now carry a different `header` label in the live Vorlage?

**Yes.**

- Column id `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`:
  - Snapshot header: **`Gesamt`** (question 2)
  - Live Vorlage header: **`MwSt`** (question 1)

All other shared IDs listed in (1) and (2) have the same headers in both places (Leistung, Uhrzeit, Tage, Anfahrt, KM, Preis / km).

### 4b) Is MwSt a brand new ID or does it reuse an old ID?

**It reuses an old ID.** The MwSt column’s ID in the live Vorlage is `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`, which previously was the **Gesamt** column in the snapshot.

### 4c) Is Gesamt’s ID the same in snapshot and live Vorlage?

**No.** The “Gesamt” concept changed IDs:

- Snapshot “Gesamt”: `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`
- Live Vorlage “Gesamt (brutto)”: `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f` (new vs snapshot)

This exactly matches the reported symptom: the MwSt input (live id `c8fd…`) reads the old “Gesamt” value because row `data` still has a value under key `c8fd…`.

---

## 5) Reconciliation result (builder state keys after the `useEffect`)

### 5a) What the reconciliation effect does

In draft edit mode, `AngebotBuilder` uses the live schema and applies a one-time reconciliation effect.

Relevant code:

- Live schema derivation:
  - `isDraftEdit` gating: `src/features/angebote/components/angebot-builder/index.tsx` lines **111–153**
  - `columnSchema` prefers `liveEditColumnSchema`: lines **155–162**
- Reconciliation effect:
  - lines **219–248**, specifically the missing-key detection and patching at **238–246**

Citation:

```219:248:src/features/angebote/components/angebot-builder/index.tsx
  useEffect(() => {
    if (!liveEditColumnSchema) return;
    if (liveSchemaApplied.current) return;
    liveSchemaApplied.current = true;

    const ids = liveEditColumnSchema
      .map((c) => c.id)
      .filter((id) => id !== ANGEBOT_POSITION_COLUMN_ID);
    const items = lineItemsRef.current;
    const patchRow = updateLineItemRef.current;

    items.forEach((item, idx) => {
      const missing = ids.filter((id) => !(id in item.data));
      if (missing.length === 0) return;
      const patch: Record<string, null> = {};
      missing.forEach((k) => {
        patch[k] = null;
      });
      patchRow(idx, { data: { ...item.data, ...patch } });
    });
  }, [liveEditColumnSchema]);
```

### 5b) What keys `lineItems[0].data` will contain after reconciliation (based on DB inputs)

Given:

- Live schema IDs include both:
  - MwSt: `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`
  - Gesamt (brutto): `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f`
- Existing row `data` already contains a key for `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4` (question 3), but does **not** contain `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f`

Therefore, the reconciliation effect will add the missing key:

- `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f: null`

…and it will **not** remove or rename any existing keys (it only adds missing keys).

So after reconciliation, `lineItems[0].data` contains:

- all existing keys from question (3), **plus**
- `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f` (initialized to `null`)

Answering the explicit checks:

- **Is the new MwSt column ID present?** Yes — `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4` is already present from persisted data.
- **Is the Gesamt column ID present?** Yes — after reconciliation it will be present as `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f: null`.

---

## 6) Input `onChange` wiring — is `col.id` the live Vorlage id at render time?

The Step 2 inputs always write values back under the **currently rendered** `col.id`:

- File: `src/features/angebote/components/angebot-builder/step-2-positionen.tsx`
- Lines: **141–165** (text) and **166–184 / 185–208 / 209–232** (numeric variants)

Example (text):

```141:163:src/features/angebote/components/angebot-builder/step-2-positionen.tsx
          {columnSchema
            .filter((col) => col.id !== ANGEBOT_POSITION_COLUMN_ID)
            .map((col) => {
              const raw = item.data[col.id];
              // ...
                  {layout.pdfRenderType === 'text' ? (
                    <Input
                      // ...
                      value={raw != null ? String(raw) : ''}
                      onChange={(e) =>
                        onUpdate({
                          data: {
                            ...item.data,
                            [col.id]: e.target.value || null
                          }
                        })
                      }
                    />
                  ) : null}
```

So the write key is exactly `col.id` from the rendered `columnSchema`.

In draft edit mode, the builder passes `columnSchema` from `liveEditColumnSchema` (live Vorlage) as shown here:

- File: `src/features/angebote/components/angebot-builder/index.tsx`
- Lines: **155–162** and the `Step2Positionen` call at **552–564**

Key citation:

```155:162:src/features/angebote/components/angebot-builder/index.tsx
  const columnSchema = useMemo<AngebotColumnDef[]>(() => {
    if (isEdit && initialAngebot) {
      return liveEditColumnSchema ?? resolveAngebotPdfColumnSchema(initialAngebot);
    }
    return createColumnSchema;
  }, [isEdit, initialAngebot, createColumnSchema, liveEditColumnSchema]);
```

Therefore:

- At render time, for MwSt, `col.id` is the **live MwSt ID** `c8fdc62d-6572-4d04-aaa2-0b6a415a9ec4`.
- At render time, for Gesamt (brutto), `col.id` is the **live Gesamt ID** `4dc8f66c-4165-4cae-9f7d-8e2a0d09633f`.

This matches the observed behaviour:

- MwSt displays the old Gesamt value because `item.data[c8fd…]` contains the persisted numeric (33.1 / etc.), and `c8fd…` is now labeled MwSt.
- Typing into “Gesamt (brutto)” would write to `item.data[4dc8…]`; if the UI appears to have “no visible effect”, that suggests either:
  - the user is actually typing into the MwSt field (still showing the old Gesamt value), or
  - the “Gesamt (brutto)” column is rendered with a different preset/type expectation than the value being entered (but the code above should still display it), or
  - a later state overwrite (not visible in these files) resets `item.data[4dc8…]` (not evidenced here).

The **ID/header reuse** (`c8fd…` switching from “Gesamt” → “MwSt”) is fully confirmed by (1)-(4) and is the primary root cause of the swap.

