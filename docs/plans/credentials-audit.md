# Credentials & email audit

Read-only audit of roster email display, credentials UI, and API behavior. Sources read on 2026-05-21:

- `src/features/driver-management/components/drivers-table/columns.tsx`
- `src/features/driver-management/components/edit-credentials-dialog.tsx`
- `src/features/driver-management/api/user-actions.service.ts`
- `src/app/api/users/[id]/credentials/route.ts`
- `src/app/api/users/route.ts` (paginated path)

---

## 1. `columns.tsx` — email column

**Yes — there is an email column.**

| Property | Value |
|----------|--------|
| Column `id` | `email` |
| `accessorKey` | `email` |
| Header label | `E-Mail` |
| Cell render | `(row.original as { email?: string \| null }).email ?? '-'` |

**What field does it read?**

The column reads the **`email` property on the row object** passed into the table (`DriverWithProfile` / roster row). It does not distinguish “accounts vs Auth” in the UI — it only displays `row.original.email`.

**Where does that value come from in production (table view)?**

1. Paginated `GET /api/users` loads `accounts` **without** `email` in the SQL `select` (see §4).
2. `mergeLiveEmails()` sets `email` from **`auth.admin.getUserById(row.id)`** → `authUserResult?.user?.email ?? null`.
3. `DriverTableListing` passes API `data` into `DriverTable` → columns render that merged value.

**Conclusion:** The table column shows the **live Auth email** from the API merge, not a separately labeled “cached `accounts.email`” field. The property name is still `email` on the row shape.

**All columns currently defined**

| `id` | Header | Notes |
|------|--------|--------|
| `name` | Name | `accessorFn: getDisplayName` (first/last or `name`) |
| `email` | E-Mail | `accessorKey: 'email'` |
| `role` | Rolle | `accessorKey: 'role'` |
| `phone` | Telefon | `accessorKey: 'phone'` |
| `is_active` | Status | Aktiv / Inaktiv |
| `actions` | (none) | `CellAction` only |

---

## 2. `EditCredentialsDialog` — fields and submit

**Fields:** **Yes — both email and password.**

| Field | UI | Behavior |
|-------|-----|----------|
| E-Mail | `Input` `type='email'`, id `edit-user-email` | Pre-filled from `user.email` when dialog opens |
| Passwort | `Input` `type='password'`, id `edit-user-password` | Always empty on open; placeholder “Leer lassen = unverändert” |

**Submit logic**

- Builds `body: { email?: string; password?: string }` only for **changed** values:
  - `email` if trimmed email differs from original (case-insensitive)
  - `password` if non-empty and length ≥ 8 (`MIN_PASSWORD_LENGTH`)
- Calls `useUpdateCredentials().mutateAsync({ id: user.id, body })`.

**Client → server path**

1. `user-actions.service.ts` → `patchCredentials(id, body)`
2. `fetch(\`/api/users/${id}/credentials\`, { method: 'PATCH', body: JSON.stringify(body) })`

**Endpoint:** `PATCH /api/users/[id]/credentials`

---

## 3. `PATCH /api/users/[id]/credentials` — update calls

**Primary update: Supabase Auth Admin API — not accounts-only.**

Exact sequence in `route.ts`:

1. **Tenant guard** (session client): `accounts.select('company_id').eq('id', id)` — no write yet.
2. Build `attrs: { email?: string; password?: string }` from validated body.
3. **Auth update (required when attrs non-empty):**

```ts
const admin = createAdminClient();
const { error: updateAuthError } = await admin.auth.admin.updateUserById(
  id,
  attrs
);
```

4. **Conditional accounts cache sync** — only when email was in `attrs`:

```ts
if (attrs.email !== undefined) {
  const { error: cacheError } = await admin
    .from('accounts')
    .update({ email: attrs.email })
    .eq('id', id);
}
```

**Summary**

| Change | Auth (`updateUserById`) | `accounts` table |
|--------|-------------------------|------------------|
| Email only | `attrs.email` | `.update({ email })` after Auth succeeds |
| Password only | `attrs.password` | **No** accounts write |
| Both | Both in one `updateUserById` call | Email sync only if email present |

Password changes do **not** touch `accounts`. Email changes update Auth first; `accounts.email` is synced only after Auth succeeds (documented as non-transactional in route comment).

---

## 4. Paginated `GET /api/users` — live email in response

**Yes — paginated responses include live Auth email.**

**Activation:** Both `page` and `perPage` query params present.

**SQL select (paginated path)** — `email` is **not** selected from `accounts`:

```ts
.select(
  'id, name, first_name, last_name, role, is_active, created_at, phone',
  { count: 'exact' }
)
```

**Merge** (`mergeLiveEmails`):

```ts
const { data: authUserResult } = await admin.auth.admin.getUserById(row.id);
const email = authUserResult?.user?.email ?? null;
return {
  id: row.id,
  name: row.name,
  first_name: row.first_name,
  last_name: row.last_name,
  email,  // ← live Auth email
  role: row.role,
  is_active: row.is_active,
  created_at: row.created_at,
  phone: row.phone
};
```

**Response shape (paginated only):**

```json
{
  "data": [
    {
      "id": "...",
      "name": "...",
      "first_name": "...",
      "last_name": "...",
      "email": "<live Auth email or null>",
      "role": "driver|admin",
      "is_active": true,
      "created_at": "...",
      "phone": "..."
    }
  ],
  "totalItems": <number>
}
```

**Exact field name:** `email` (string or `null`) on each element of `data[]`.

**Note:** Search filter in paginated mode still uses `email.ilike` on **`accounts`** columns in SQL (`name,first_name,last_name,email`), which can diverge from the displayed live Auth email if `accounts.email` is stale.

---

## Cross-cutting summary

| Layer | Email source |
|-------|----------------|
| Table column | `row.original.email` from API `data[].email` (live Auth) |
| Credentials dialog initial value | `user.email` from same roster row (via `CellAction` → `CompanyUser` mapper) |
| Credentials PATCH | `auth.admin.updateUserById` + optional `accounts.email` sync |
| Paginated list API | `email` on each `CompanyUser` after `getUserById` merge |
