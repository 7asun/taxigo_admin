# Pickup time mode feasibility (read-only audit)

Scope: **read-only** audit of recurring rule form + payload + cron generation, compared to the “Neue Fahrt” (trip creation) time input pattern that supports an empty time state.

Date: 2026-04-16

**Phase 1: COMPLETE — 2026-04-17**

---

## Step 1 — Files read (in full unless noted)

### Recurring rules (client feature)

- `src/features/clients/components/recurring-rule-form-body.tsx` (full)
- `src/features/clients/lib/build-recurring-rule-payload.ts` (full)

### Trip creation form (“Neue Fahrt”) time-input pattern

The requested directory `src/features/trips/components/new-trip-form/` **does not exist** in this workspace. The trip creation form lives under `src/features/trips/components/create-trip/`.

- **Directory listing** `src/features/trips/components/create-trip/`:
  - `create-trip-form.tsx`
  - `schema.ts`
  - `sections/schedule-section.tsx`
  - `sections/payer-section.tsx`
  - `sections/pickup-section.tsx`
  - `sections/dropoff-section.tsx`
  - `sections/extras-section.tsx`
  - `trip-form-sections-context.tsx`
  - `form-footer.tsx`
  - `create-trip-dialog.tsx`
  - `mobile-datetime-sheet.tsx`
  - `billing-profile-address-hints.tsx`

Files read for the time pattern + validation:

- `src/features/trips/components/create-trip/create-trip-form.tsx` (full)
- `src/features/trips/components/create-trip/sections/schedule-section.tsx` (full)
- `src/features/trips/components/create-trip/schema.ts` (full)
- `src/features/trips/components/create-trip-form.tsx` (full; re-export)

### Cron outbound leg section (subset referenced)

- `src/app/api/cron/generate-recurring-trips/route.ts` (read for `clockToHhMmSs`, `toScheduledIso`, `buildTripPayload` outbound guard + pickup_time usage)

### DB types (subset referenced)

- `src/types/database.types.ts` (only the `recurring_rules` section for `Row` + `Insert` pickup_time types)

### Docs keyword scan

Searched under `docs/` for keywords: `pickup_time_mode`, `time_mode`, `outbound timeless`, `Zeitabsprache` + `Hinfahrt`.

Hits: **only one**, and it is in a previously authored audit doc:

- `docs/plans/timeless-rules-cron-widget-audit.md` (mentions hypothetical `pickup_time_mode`, no spec)

No other existing spec/decision note was found in `docs/` by this keyword scan.

---

## Step 2 — Answers

### FORM SCHEMA

#### 1) Exact Zod validation on `pickup_time` (ruleFormSchema)

In `ruleFormSchema`, `pickup_time` is a **required string** with a **regex**. There is **no** `.optional()` or `.nullable()`. There is **no** `.transform()` on this field.

Full chain:

```114:120:src/features/clients/components/recurring-rule-form-body.tsx
    pickup_time: z
      .string()
      .regex(
        /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
        'Bitte ein gültiges Zeitformat verwenden (HH:MM)'
      ),
```

`ruleFormSchema` does have a `.superRefine(...)`, but it is used only for:

- requiring `return_time` when `return_mode === 'exact'`
- requiring Fremdfirma fields when `fremdfirma_enabled` is true

```128:156:src/features/clients/components/recurring-rule-form-body.tsx
  .superRefine((data, ctx) => {
    if (data.return_mode === 'exact') {
      // ...
    }
    if (data.fremdfirma_enabled) {
      // ...
    }
  });
```

There is **no** refine/transform path currently present that would allow a “timeless outbound” (`pickup_time` empty/null) without schema changes.

#### 2) `getRuleFormDefaults` — `pickup_time` default

When creating a new rule (`initialData` absent), the default is:

```185:206:src/features/clients/components/recurring-rule-form-body.tsx
      pickup_time: '08:00',
```

When editing (`initialData` present), it reads:

```229:233:src/features/clients/components/recurring-rule-form-body.tsx
    pickup_time: initialData.pickup_time.substring(0, 5),
```

Would `initialData.pickup_time` ever be `null` with the current DB type?

- In this file, the `initialData` parameter type declares `pickup_time: string` (not nullable) in the helper signature.
- In `database.types.ts`, `recurring_rules.Row.pickup_time` is also `string` (not nullable).

So **based on types**, it should not be null. (Actual DB constraints are not visible here; see Q9.)

#### 3) `return_mode` Select — UI pattern reference

`return_mode` is rendered as a **shadcn/ui `<Select>`** in `RecurringRuleFormBody`.

Condensed JSX (component names + props only; className strings omitted):

```456:492:src/features/clients/components/recurring-rule-form-body.tsx
          <FormField name='return_mode' render={({ field }) => (
            <FormItem>
              <FormLabel>Rückfahrt</FormLabel>
              <Select
                onValueChange={(v) => {
                  field.onChange(v as RecurringRuleReturnMode);
                  if (v !== 'exact') {
                    form.setValue('return_time', '', { shouldValidate: true });
                  }
                }}
                value={field.value}
                disabled={isReturnModeLocked}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder='Wählen…' />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value='none'>…</SelectItem>
                  <SelectItem value='time_tbd'>…</SelectItem>
                  <SelectItem value='exact'>…</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
```

---

### TIME INPUT PATTERN

#### 4) Empty / “--:--” time input in the trip creation form

The “Neue Fahrt” implementation supports an **empty time** in the form value for **outbound departure time** (`departure_time`) and **return time** (`return_time`), using a native time input.

The relevant files are:

- UI rendering: `src/features/trips/components/create-trip/sections/schedule-section.tsx`
- Validation: `src/features/trips/components/create-trip/schema.ts`

##### 4a) What component / input type is used?

Native time input via the project’s `<Input>` wrapper:

```198:206:src/features/trips/components/create-trip/sections/schedule-section.tsx
                  <Input
                    id='create-trip-departure-time'
                    type='time'
                    step={60}
                    value={field.value}
                    onChange={(e) => field.onChange(e.target.value)}
                    // ...
                  />
```

Return-time also uses `<Input type='time'>`:

```315:321:src/features/trips/components/create-trip/sections/schedule-section.tsx
                            <Input
                              type='time'
                              value={field.value || ''}
                              onChange={field.onChange}
                              // ...
                            />
```

##### 4b) How is the empty state represented in the form value?

As an **empty string** `''`.

- `departure_time` explicitly allows `''` in Zod via `departureTimeSchema = z.union([z.literal(''), z.string().regex(...)])`:

```5:13:src/features/trips/components/create-trip/schema.ts
const departureTimeSchema = z.union([
  z.literal(''),
  z
    .string()
    .regex(
      /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
      'Bitte ein gültiges Zeitformat verwenden (HH:MM)'
    )
]);
```

- The schema uses `departure_time: departureTimeSchema`:

```15:26:src/features/trips/components/create-trip/schema.ts
    /** Empty = no clock time → `scheduled_at` null + `requested_date` only. */
    departure_time: departureTimeSchema,
```

- `return_time` also allows `''` (see 4d).

##### 4c) Is there a visible “--:--” placeholder shown to the user?

For the desktop/native time inputs, the code uses `<input type="time">` behavior; there is **no explicit “--:--” sentinel** wired into these time inputs.

However, the **mobile** “return exact” picker uses a button label that shows a placeholder string:

- If a return date exists but return time is missing, the label becomes **`'Uhrzeit wählen'`**.
- If no return date exists, the time label becomes **`'—'`**.

```64:69:src/features/trips/components/create-trip/sections/schedule-section.tsx
  const timeLabel =
    returnTime && returnTime.length > 0
      ? returnTime
      : returnDate
        ? 'Uhrzeit wählen'
        : '—';
```

The literal string `"--:--"` does exist in the repo, but it appears to be used for **display formatting** in other components, not as the input value for a time field (see “docs keyword scan” section for where it matched).

##### 4d) What Zod schema is used for that field — does it allow empty string or null?

It allows **empty string** `''` (not `null`) via a union.

For `departure_time`:

```5:26:src/features/trips/components/create-trip/schema.ts
const departureTimeSchema = z.union([z.literal(''), z.string().regex(/*...*/)]);
// ...
departure_time: departureTimeSchema,
```

For `return_time`:

```28:38:src/features/trips/components/create-trip/schema.ts
    return_time: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(
            /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/,
            'Bitte ein gültiges Zeitformat verwenden (HH:MM)'
          )
      ])
      .optional(),
```

And `superRefine` requires it only when `return_mode === 'exact'`:

```53:69:src/features/trips/components/create-trip/schema.ts
  .superRefine((data, ctx) => {
    if (data.return_mode === 'exact') {
      // ...
      if (!data.return_time) {
        ctx.addIssue({ /* ... */ path: ['return_time'] });
      }
    }
  });
```

---

### CRON CRASH SURFACE

#### 5) `clockToHhMmSs` behaviour on null/empty

Full implementation:

```34:43:src/app/api/cron/generate-recurring-trips/route.ts
function clockToHhMmSs(clock: string): string {
  const s = clock.trim();
  if (s.length >= 8 && s[2] === ':') {
    return s.slice(0, 8);
  }
  if (s.length === 5) {
    return `${s}:00`;
  }
  return s;
}
```

Behavior by input:

- **a) `null`**: would throw at runtime (`clock.trim` on `null` ⇒ `TypeError`). Note the function is typed as `(clock: string)`, so `null` is not supported by design.
- **b) empty string `''`**: `''.trim()` → `''`, `s.length` is `0`, so it returns `''` (last line).
- **c) `'00:00'` / `'00:00:00'`**:
  - `'00:00'` length is 5 ⇒ returns `'00:00:00'`.
  - `'00:00:00'` length ≥ 8 and `s[2] === ':'` ⇒ returns `s.slice(0, 8)` which is `'00:00:00'`.

#### 6) `toScheduledIso` behaviour on null/empty time

Full implementation:

```45:48:src/app/api/cron/generate-recurring-trips/route.ts
function toScheduledIso(dateStr: string, timeHhMmSs: string): string {
  const t = clockToHhMmSs(timeHhMmSs);
  return new Date(`${dateStr}T${t}`).toISOString();
}
```

Behavior by input:

- If `timeHhMmSs` is **`null`**: it would throw **before** constructing the Date (because `clockToHhMmSs(null as any)` would throw at `trim()`).
- If `timeHhMmSs` is **`''`**: then `t === ''`, so `new Date(\`\${dateStr}T\`)` is an **Invalid Date**, and `.toISOString()` throws (RangeError: invalid time value).

#### 7) `buildTripPayload` outbound guard (pickup_time presence check)

Exact outbound guard:

```169:175:src/app/api/cron/generate-recurring-trips/route.ts
      if (!isReturnTrip) {
        const pt = exception?.modified_pickup_time || rule.pickup_time;
        if (!pt) return null;
      } else if (returnMode === 'exact') {
        const pt = exception?.modified_pickup_time || rule.return_time;
        if (!pt) return null;
      }
```

If a hypothetical `pickup_time_mode = 'daily_agreement'` “bypasses” this guard, the next failure point **is not necessarily inside `buildTripPayload`** because the cron computes outbound exception key + scheduled ISO **before** calling `buildTripPayload`:

```417:426:src/app/api/cron/generate-recurring-trips/route.ts
        const outboundExceptionKey = clockToHhMmSs(rule.pickup_time);
        const outboundScheduledIso = toScheduledIso(
          dateStr,
          /* exception override OR */ rule.pickup_time
        );
```

So if `rule.pickup_time` were `null` at runtime, the cron would already crash at:

- `clockToHhMmSs(rule.pickup_time)` (TypeError at `trim()`), and/or
- `toScheduledIso(..., rule.pickup_time)` (same).

Meaning: the `if (!pt) return null` guard does **not** protect the cron from `pickup_time` being null, because earlier code assumes `rule.pickup_time` is a string.

---

### DB SCHEMA

#### 8) `recurring_rules.pickup_time` nullability in `database.types.ts`

From the generated types:

- **a) `recurring_rules.Row.pickup_time`**: `string` (not nullable)
- **b) `recurring_rules.Insert.pickup_time`**: `string` (not nullable)

Excerpt:

```720:768:src/types/database.types.ts
      recurring_rules: {
        Row: {
          // ...
          pickup_time: string;
          // ...
        };
        Insert: {
          // ...
          pickup_time: string;
          // ...
        };
```

They are identical with respect to nullability: both are **non-nullable `string`**.

#### 9) Any DB constraints visible in the types file?

`database.types.ts` is a TypeScript projection of table shapes; it does **not** expose CHECK constraints or NOT NULL markers beyond what is implied by the TS types.

If there are DB-level constraints beyond what the types imply, they would typically be visible in migration files / SQL schema, which were **not part of the requested scope** for this audit.

---

### DOCS

#### 10) Existing docs/spec for `pickup_time_mode` / time modes / outbound timeless?

Keyword scan results in `docs/` returned **no spec/decision note** for `pickup_time_mode`, time modes, or “timeless outbound” behavior.

The only hit was:

- `docs/plans/timeless-rules-cron-widget-audit.md` (a plan/audit doc) mentioning that the cron does not implement `pickup_time_mode`.

---

## Step 3 — Senior recommendation stub (based only on findings above)

### A) Reuse of the trip-form empty-time pattern in the recurring rule form

The “Neue Fahrt” empty-time pattern is **not directly reusable** in the recurring rule form as-is, because:

- The rule form Zod schema requires `pickup_time` to match `HH:MM` (no `''`, no `null`).
- The payload builder always serializes `pickup_time` as `\`${values.pickup_time}:00\`` (would produce `':00'` if `values.pickup_time === ''`).

Evidence:

```114:120:src/features/clients/components/recurring-rule-form-body.tsx
pickup_time: z.string().regex(/^...$/, ...)
```

```82:96:src/features/clients/lib/build-recurring-rule-payload.ts
    pickup_time: `${values.pickup_time}:00`,
```

What would need to change (purely mechanically, not proposing code here):

- **Zod**: make `pickup_time` accept an empty state (the trip form uses `z.union([z.literal(''), z.string().regex(...)])`).
- **Payload builder**: emit `pickup_time: null` (or omit) when the form value is empty, instead of always appending `:00`.

### B) Crash points in the cron if `pickup_time` is null at runtime (no other changes)

All in `src/app/api/cron/generate-recurring-trips/route.ts`:

1) **`clockToHhMmSs`** — crashes immediately if called with null:
   - Function: `clockToHhMmSs(clock: string)`
   - Behavior: `clock.trim()` throws if `clock` is null.

```34:36:src/app/api/cron/generate-recurring-trips/route.ts
function clockToHhMmSs(clock: string): string {
  const s = clock.trim();
```

2) **Outbound occurrence loop** — calls `clockToHhMmSs(rule.pickup_time)` before any guarding:

```417:417:src/app/api/cron/generate-recurring-trips/route.ts
        const outboundExceptionKey = clockToHhMmSs(rule.pickup_time);
```

3) **Outbound scheduled ISO** — passes potentially null time into `toScheduledIso`, which will call `clockToHhMmSs` internally:

```418:426:src/app/api/cron/generate-recurring-trips/route.ts
        const outboundScheduledIso = toScheduledIso(
          dateStr,
          /* exception override OR */ rule.pickup_time
        );
```

4) **`buildTripPayload` outbound guard** is *not* a crash point itself, but it would be reached only if the earlier steps didn’t already throw. If reached with `rule.pickup_time === null` and no exception override, then:
   - `const pt = exception?.modified_pickup_time || rule.pickup_time;`
   - `if (!pt) return null;` would return null (safe), but again: earlier code already assumed `rule.pickup_time` is a string.

### C) Is a `pickup_time_mode` column necessary vs `pickup_time IS NULL` as the signal?

Based strictly on the audited code:

- Today, **all layers assume `recurring_rules.pickup_time` is a non-null string**:
  - DB types: `string`
  - Rule form: required `HH:MM` regex
  - Payload builder: always formats `HH:MM:00`
  - Cron: unconditionally uses `rule.pickup_time` to compute outbound schedule

So `pickup_time IS NULL` is **not sufficient “as-is”** because it would require coordinated changes across:

- Form schema + defaults + UI
- Payload builder output type (`null` vs string)
- Cron logic (must branch before calling `clockToHhMmSs/toScheduledIso`)

Trade-off (from code evidence):

- **Using `pickup_time IS NULL` as the only signal** can be viable, but only if every dependent layer is updated to handle null safely.
- A dedicated `pickup_time_mode` column would provide an explicit mode signal, but the current codebase has **no existing plumbing** for it (no docs, no type, no branching), so it would also require multi-layer work.

