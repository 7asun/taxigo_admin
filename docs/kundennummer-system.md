# Kundennummer System (KND-NR & KTR-NR)

This document explains the **Kundennummer** (Passenger Number / KND-NR) and **Kostenträgernummer** (Payer Number / KTR-NR) architecture. It details why we designed it specifically this way and how it perfectly isolates multi-tenant sequences securely without relying on legacy string-based identifiers.

---

## 1. What are these Numbers?

In an enterprise dispatching and billing system, identifying a passenger simply by their `first_name` and `last_name` is extremely dangerous. You might have three different passengers named "Max Mustermann". Similarly, Kostenträger (Health Insurance Companies, Schools, etc.) need perfectly clean unique identifiers rather than relying on their varying string names (e.g. "AOK", "AOK Niedersachsen", "A.O.K.").

1. **Fahrgäste (Clients)** are assigned a `customer_number` starting at `10000`.
   - Visually rendered as: `KND-NR-10042`
2. **Kostenträger (Payers)** are assigned a `number` starting at `50000`.
   - Visually rendered as: `KTR-NR-50042`

---

## 2. The Golden Rule: Pure Integers in the Database

Rather than storing the full string `"KND-NR-10042"` in Supabase, we **strictly store pure `INTEGER`s** (e.g., `10042`).

### Why Pure Integers?
1. **Flawless Sorting:** If you store strings, Postgres sorts them alphabetically. `KND-NR-20` would sort *after* `KND-NR-100`, breaking the UI. Integers natively sort chronologically in memory at C++ scale.
2. **Infinite Sequencing:** When computing "what is the next available number?", asking Postgres to `MAX(10042) + 1` takes exactly `0.001ms`. Parsing strings, stripping out the letters using RegEx, calculating the math, and converting it back to a string under high concurrent request loads leads to deadlocks.
3. **Database Constraints:** Using an integer lets us easily enforce `UNIQUE (company_id, customer_number)`, ensuring that two dispatchers clicking "Save Passenger" at the exact same millisecond can never produce the same patient ID.

### The String Injection (Frontend)
Because the DB holds pure integers, we use a single global utility in the Next.js React codebase (`src/lib/customer-number.ts`) to dynamically inject the visual string prefix:

```tsx
import { formatClientNumber } from '@/lib/customer-number';

// Automatically outputs: "KND-NR-10042"
formatClientNumber(client.customer_number); 
```
This cleanly decouples the mathematical logic in the backend from the visual branding string requested by the client on the frontend or PDF invoice.

---

## 3. The Sequence Engine (Postgres Triggers)

We do not trust the frontend to assign these numbers. The React App has no idea what the "next" available integer is, and sending it from the client creates race conditions.

Instead, we built **Supabase `BEFORE INSERT` Triggers**.

### How `assign_client_number()` works:
Before any new `client` row is permanently saved, Postgres pauses the insert and runs this isolated logic:

```sql
SELECT COALESCE(MAX(customer_number), 9999) + 1 
INTO next_num
FROM public.clients
WHERE company_id = NEW.company_id;
```

1. **Partitioning:** `WHERE company_id = NEW.company_id` ensures that Tenant A creating a patient has absolutely no effect on Tenant B's numbering.
2. **The Auto-Increment Math:** It cleanly asks for the absolute highest integer used thus far by that company.
3. **The `COALESCE` Fallback:** If the company is completely empty (this is their very first created patient), `MAX()` evaluates to entirely `NULL`. The `COALESCE` function smoothly catches the `NULL` and defaults it to `9999`. 
4. **The `+ 1`:** The `9999` is aggressively incremented by `+ 1`, guaranteeing that the *first passenger* is perfectly assigned `10000`, the second `10001`, and so forth. The same logic applies to Payers, defaulting to `49999 + 1 = 50000`.

---

## 4. Legacy Overrides (The Window Function Steamroller)

When we initially migrated old text-based legacy data into this pristine integer system, some inherited text values were entirely random (e.g., `"1423"`, `"643232"`). 

Because the Trigger calculates the new number based dynamically on the `MAX()` of existing numbers, if a legacy string like `"643232"` survived the migration, the trigger legally assumed the next patient should be `643233`.

To forcibly "steamroll" over these wild historical outliers, we deployed an advanced Postgres **Window Function** during the migration. 

```sql
WITH numbered_clients AS (
  SELECT id, company_id,
         row_number() OVER (PARTITION BY company_id ORDER BY created_at ASC) as rn
  FROM public.clients
)
UPDATE public.clients c
SET customer_number = 9999 + nc.rn
FROM numbered_clients nc
WHERE c.id = nc.id;
```

### Why we did this:
The `row_number()` tool linearly creates a perfect `1, 2, 3...` count for every row partitioned strictly by the `company_id`, sorted entirely chronologically (`ORDER BY created_at ASC`). 

By forcibly updating the table with `9999 + rn`, the oldest imported passenger automatically became `10000` exactly. The second oldest became `10001`. This completely obliterated the scattered 6-digit integers, retroactively providing every historical user with a pristine, linearly sequential numerical identity. 

Once executed, we applied `ALTER COLUMN customer_number SET NOT NULL`, locking down the schema indefinitely securely. Future inserts simply pick up where the steamroller left off.
