# Security Audit A3 — Sign-Up, User Lifecycle & Auth Configuration

**Audit date:** 2026-06-17  
**Scope (read-only):** Auth UI, auth pages, user-management APIs, account/auth migrations, `supabase/config.toml`, `docs/accounts-table.md`, `docs/user-management.md`.

---

## Executive summary

| Risk area | Severity | Summary |
| --- | --- | --- |
| **Open self-service sign-up** | **Critical** | `sign-up-view.tsx` calls only `supabase.auth.signUp()` — **no `accounts` row** is created. `enable_signup = true` in `config.toml` with **no invite/allowlist**. Orphan `auth.users` rows accumulate. |
| **Orphan account UX** | **High** | Orphan users (auth session, no `accounts`) hit a **sign-in ↔ dashboard redirect loop** via layout guards (`dashboard/layout.tsx:42-43`). |
| **Deactivated user sessions** | **High** | Deactivation sets `accounts.is_active = false` **and** GoTrue `ban_duration` (`status/route.ts:78-95`), but **`requireAdmin()` does not check `is_active`**. A banned user’s **access JWT may remain valid up to `jwt_expiry` (3600s)** with no app-side session revocation. |
| **Admin create path** | **Medium** | `POST /api/drivers/create` has **manual rollback** (not a DB transaction) but **does** delete orphan auth users on `accounts`/`driver_profiles` failure (`route.ts:164-221`). |
| **Password policy split** | **Medium** | Supabase `minimum_password_length = 6`; admin credential API enforces **8** chars; self sign-up enforces **none** client-side. |
| **Last-admin guard** | **Medium** | **Self-deactivation blocked** only (`status/route.ts:41-46`). **No** guard against deactivating the last admin in a company (`docs/user-management.md:62`). |

---

## Q1 — Sign-up flow: orphan accounts

### What happens after `supabase.auth.signUp()` succeeds?

`sign-up-view.tsx` calls sign-up and, on success, **only sets a UI message** — no navigation, no `accounts` insert, no server action:

```26:38:src/features/auth/components/sign-up-view.tsx
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password
    });

    if (signUpError) {
      setError(signUpError.message);
      setIsSubmitting(false);
      return;
    }

    setMessage('Account created. Check your inbox to confirm your email.');
    setIsSubmitting(false);
```

### Is an `accounts` row created atomically?

**No.** Sign-up is a **single client call** to Supabase Auth. There is **no** `accounts` insert in the sign-up flow, no database trigger in repo migrations that creates `accounts` on `auth.users` INSERT, and no API route involved.

The only repo trigger tied to `accounts` is `set_company_id` **AFTER INSERT on `accounts`** — it syncs `company_id` to `auth.users.raw_app_meta_data`, it does **not** create the `accounts` row (`20260524151222_harden_account_triggers.sql:71-75`).

### Rollback if `accounts` insert fails?

**Not applicable to sign-up** — no `accounts` insert is attempted. If sign-up succeeds, an **`auth.users` row exists without a matching `accounts` row** unless created elsewhere (admin API).

### Is `company_id` assigned during sign-up?

**No.** Sign-up collects only `email` and `password` (`sign-up-view.tsx:13-14`, `:49-69`). No `company_id`, `role`, or profile fields.

### Where does a new user land? Missing `accounts` behavior

| Step | Behavior | Reference |
| --- | --- | --- |
| Sign-up success | Stays on `/auth/sign-up` with message (unless session established and user navigates/refreshes) | `sign-up-view.tsx:37-38` |
| Sign-up page (logged in) | Redirects to `/dashboard/overview` **without role check** | `src/app/auth/sign-up/page.tsx:17-18` |
| Sign-in success | Loads `accounts.role`; default target `/dashboard/overview`; driver → `/driver/startseite` | `sign-in-view.tsx:39-52` |
| Proxy (authenticated on `/auth`) | Redirect to dashboard or driver home based on `accounts.role`; **`userRole` is `null` if no row** → treated as non-driver → `/dashboard/overview` | `src/proxy.ts:54-60`, `:82-86` |
| Dashboard layout | If `!account?.role` → **`redirect('/auth/sign-in')`** | `src/app/dashboard/layout.tsx:37-43` |
| Driver layout | Uses `.single()` on `accounts`; missing row → query error (not a clean redirect) | `src/app/driver/layout.tsx:31-35` |

**Orphan with session:** Sign-in succeeds → routed to `/dashboard/overview` → layout sees no `role` → back to sign-in → **redirect loop** for users who can authenticate but have no `accounts` row.

**Note:** `enable_confirmations = false` (`supabase/config.toml:219`) means sign-up can establish a **session immediately** (no inbox step required), despite UI text saying “Check your inbox” (`sign-up-view.tsx:37`).

---

## Q2 — Sign-up reachability

### Is `/auth/sign-up` publicly reachable?

**Yes.**

- **Proxy:** Auth routes are **not blocked** for unauthenticated users. Only authenticated users on `/auth/*` are redirected away (`src/proxy.ts:82-87`). Unauthenticated users can access `/auth/sign-up`.
- **Auth layout:** No guard — passes children through (`src/app/auth/layout.tsx:10-16`).
- **Sign-up page:** Only redirects if **already** logged in (`src/app/auth/sign-up/page.tsx:17-18`).

Sign-in page links to sign-up (`sign-in-view.tsx:96-99`).

### Invite token / allowlist / admin pre-approval?

**None found.** No invite flow, allowlist, or approval gate in sign-up UI, auth pages, or `config.toml` auth hooks (`before_user_created` is commented out at `config.toml:271-274`).

### `signups_enabled` in `config.toml`

Supabase uses **`enable_signup`** (not `signups_enabled`):

| Setting | Value | Reference |
| --- | --- | --- |
| `[auth] enable_signup` | **`true`** | `supabase/config.toml:169` |
| `[auth.email] enable_signup` | **`true`** | `supabase/config.toml:214` |
| `enable_anonymous_sign_ins` | `false` | `config.toml:171` |

### Unlimited `auth.users` via repeated `signUp()`?

**Yes, within rate limits.** Any external actor can call the public Supabase Auth sign-up endpoint (via the app UI or direct Auth API with the anon key). Rate limit: **`sign_in_sign_ups = 30` per 5 minutes per IP** (`config.toml:199-200`). No CAPTCHA configured (`config.toml:206-210` commented out).

---

## Q3 — Account creation via admin API (`POST /api/drivers/create`)

### Transaction wrapping `createUser` + `accounts` insert?

**No database transaction.** The handler performs **sequential** service-role calls in the Node process:

1. `requireAdmin()` → `companyId` from session (`route.ts:67-75`)
2. `auth.admin.createUser()` (`:128-133`)
3. `accounts.insert()` (`:152-162`)
4. Optional `driver_profiles.insert()` for drivers (`:181-189`)

There is no `BEGIN`/`COMMIT` or Supabase RPC wrapping these steps.

### Orphan cleanup if `accounts` insert fails?

**Yes — best-effort rollback:**

```164:170:src/app/api/drivers/create/route.ts
      if (userError) {
        try {
          await supabaseAdmin.auth.admin.deleteUser(newAuthUser.user.id);
        } catch (rollbackErr: unknown) {
          logStepError('rollback.auth.admin.deleteUser', rollbackErr);
        }
        return stepErrorResponse('accounts.insert', userError, 500);
```

Same pattern on thrown errors (`:173-178`). If `driver_profiles.insert` fails, rollback deletes **`accounts` row and auth user** (`:191-205`, `:208-221`).

**Residual risk:** If `deleteUser` rollback fails (logged, not re-thrown), an orphan `auth.users` row can remain.

### Source of `company_id`

**Exclusively from `requireAdmin()` session** — not from client body:

```75:75:src/app/api/drivers/create/route.ts
    const companyId = auth.companyId;
```

```152:161:src/app/api/drivers/create/route.ts
      const { error: userError } = await supabaseAdmin.from('accounts').insert({
        id: newAuthUser.user.id,
        ...
        company_id: companyId,
```

`CreateDriverBody` has no `company_id` field (`route.ts:17-27`). Documented in route header (`:7-8`) and `docs/user-management.md:248`.

### Password validation on create

Route requires non-empty `password` (`:107-111`) but **no minimum length** server-side. Client form uses Zod `.min(6)` (`driver-form-body.tsx:51`).

---

## Q4 — Account deactivation / deletion

### What does deactivation do?

`PATCH /api/users/[id]/status` performs **both**:

1. **`accounts.is_active`** update via service role (`status/route.ts:78-81`)
2. **GoTrue ban** via `auth.admin.updateUserById` with `ban_duration`:
   - Deactivate: `AUTH_BAN_DURATION_PERMANENT` (`876000h`) (`ban-constants.ts:7`, `status/route.ts:88-90`)
   - Reactivate: `AUTH_BAN_DURATION_UNBAN` (`0s`) (`ban-constants.ts:10`, `status/route.ts:88-89`)

**Does not** call `deleteUser` (`status/route.ts:4-8`, `docs/user-management.md:50`).

On ban failure, **`accounts.is_active` is rolled back** (`status/route.ts:97-106`).

### Can a deactivated user still authenticate?

**New sign-in:** Blocked by GoTrue ban (`docs/user-management.md:50`).

**Existing session:** Not explicitly invalidated in app code. Supabase typically **rejects refresh** for banned users; the **access token (JWT) may remain valid until expiry** (see Q7).

### Can a deactivated user call APIs with a pre-ban JWT?

**Partially yes — gap.**

- `requireAdmin()` checks `role === 'admin'` and `company_id` but **does not check `is_active`** (`src/lib/api/require-admin.ts:29-48`).
- `requireSession()` checks auth user only (`src/lib/api/require-session.ts:16-29`).
- A deactivated **admin** whose JWT is still valid could call admin APIs until token expiry if GoTrue does not reject the token on `getUser()`.

Driver roster and reference queries filter `is_active = true` in many places, but **auth guards do not**.

### Last-admin / self-deactivation guards

| Guard | Present? | Reference |
| --- | --- | --- |
| **Self-deactivation** | **Yes** — returns 400 | `status/route.ts:41-46` |
| **Last admin in company** | **No** | Explicitly deferred: `docs/user-management.md:62` |
| **Deactivate all admins** | **No** — only self blocked | UI uses `isSelf` check (`cell-action.tsx:140`) but API allows deactivating other admins freely |

---

## Q5 — Auth triggers and hooks

### Triggers / functions in migrations

| Function | SECURITY DEFINER | Trigger in repo | Fires on |
| --- | --- | --- | --- |
| `handle_new_user()` | Yes (`:9`) | **No `CREATE TRIGGER` in repo** | — (function only) |
| `handle_user_company_claim()` | Yes (`:28`) | **No `CREATE TRIGGER` in repo** | — (function only) |
| `set_company_id()` | Yes (`:55`) | **Yes** | `AFTER INSERT ON public.accounts` (`:71-75`) |

All three update `auth.users.raw_app_meta_data.company_id` from `NEW.company_id` (`20260524151222_harden_account_triggers.sql:13-19`, `:32-38`, `:59-65`).

Comment notes `set_company_id` was dashboard-created originally (`:45-49`).

### Callable by unprivileged callers?

Trigger functions run as **SECURITY DEFINER** on **`accounts` INSERT** only (`set_company_id`). They are **not** exposed as RPCs. An unprivileged user cannot invoke them directly unless they can **INSERT into `accounts`** (RLS restricts that to admin flows / service role).

`handle_new_user` / `handle_user_company_claim` have **no bound triggers in repo** — if attached in production on `auth.users` or `accounts` UPDATE, behavior depends on dashboard state not captured here.

### `company_id` sync: insert vs update

| Event | Synced in repo? |
| --- | --- |
| **`accounts` INSERT** | Yes — `set_company_id` AFTER INSERT trigger |
| **`accounts` UPDATE** (company change) | **No trigger in repo** for `handle_user_company_claim` — function exists but **not attached** in migration file |

If `company_id` changes on an existing `accounts` row, **`raw_app_meta_data` may become stale** unless `handle_user_company_claim` is attached in production separately.

### Auth hooks in `config.toml`

`[auth.hook.before_user_created]` is **commented out** (`config.toml:271-274`) — no server-side rejection of sign-ups at user creation time.

---

## Q6 — Password security

### Minimum length / complexity

| Layer | Enforcement | Reference |
| --- | --- | --- |
| **Supabase (local config)** | `minimum_password_length = 6`; `password_requirements = ""` (no complexity) | `config.toml:174-178` |
| **Self sign-up UI** | HTML `required` only — **no min length** | `sign-up-view.tsx:62-68` |
| **Sign-in UI** | No validation beyond `required` | `sign-in-view.tsx:75-83` |
| **Admin create driver (client)** | Zod `.min(6)` | `driver-form-body.tsx:51` |
| **Admin create driver (API)** | Non-empty only | `drivers/create/route.ts:107-111` |
| **Admin credentials PATCH** | **Min 8 characters** | `credentials/route.ts:18`, `:79-87` |

### Sign-in rate limiting (brute force)

Configured under `[auth.rate_limit]` in `config.toml`:

- **`sign_in_sign_ups = 30`** per 5 minutes per IP (`:199-200`)
- **`token_refresh = 150`** per 5 minutes per IP (`:197-198`)

No application-level lockout beyond Supabase Auth limits.

### Password reset / magic link flows

**No reset-password or magic-link UI** in `src/features/auth/` (grep: no `resetPassword`, `signInWithOtp`, `forgot` in auth components).

`config.toml` has OTP/magic-link rate limits (`token_verifications = 30`, `:201-202`) but **no app routes** implement those flows.

Redirect allow-list for auth callbacks:

- `site_url = "http://127.0.0.1:3000"` (`config.toml:154`)
- `additional_redirect_urls = ["https://127.0.0.1:3000"]` (`:156`)

Production must configure equivalent URLs in the Supabase project dashboard (not in this repo).

---

## Q7 — Session security

### JWT expiry

```158:158:supabase/config.toml
jwt_expiry = 3600
```

**3600 seconds (1 hour)** for access tokens.

### Refresh token reuse interval

```164:167:supabase/config.toml
enable_refresh_token_rotation = true
...
refresh_token_reuse_interval = 10
```

**10 seconds** reuse window when rotation is enabled.

### Session invalidation after ban

| Mechanism | Behavior |
| --- | --- |
| **Deactivation API** | Sets GoTrue `ban_duration` ≈ permanent (`status/route.ts:88-95`) |
| **Proactive revocation** | **None** in app — no `signOut` of other sessions, no admin “revoke all sessions” call |
| **`requireAdmin` / layouts** | **Do not check `is_active`** or ban status |
| **Practical effect** | Banned user **cannot sign in again** or likely **refresh**; **existing access JWT may work until `jwt_expiry`** (up to 1 hour). No documented instant global invalidation in this codebase. |

`supabase.auth.getUser()` on the server validates the JWT with Supabase; behavior for banned users during the access-token window depends on GoTrue version/settings — **treat as a gap** and assume up to 1h exposure for admin API calls.

---

## Ordered fix list

### Critical

1. **Disable or gate public sign-up**  
   Set `enable_signup = false` in production Supabase (and `[auth.email] enable_signup`), remove or hide `/auth/sign-up` link, and route all provisioning through `POST /api/drivers/create`. Until then, any actor can create orphan `auth.users` rows at scale (rate-limited to 30/5min/IP).

2. **Create `accounts` atomically with auth user (or block sign-up entirely)**  
   If self-serve is ever needed, use a `before_user_created` hook or server-side sign-up that creates `auth.users` + `accounts` in one controlled path with `company_id` and `role`. Never leave `signUp()` as the sole step (`sign-up-view.tsx:26-29`).

### High

3. **Check `is_active` (and optionally ban status) in `requireAdmin()` and `requireSession()`**  
   Deactivated users with a live JWT must receive 403 on all admin APIs. Today `requireAdmin()` only checks `role` and `company_id` (`require-admin.ts:41-48`).

4. **Orphan session handling**  
   After sign-in, if `accounts` row is missing, show a dedicated error (“contact administrator”) instead of bouncing between sign-in and dashboard (`dashboard/layout.tsx:42-43`, `sign-in-view.tsx:52`).

5. **Align sign-up UX with `enable_confirmations = false`**  
   Remove misleading “check your inbox” copy (`sign-up-view.tsx:37`) or enable confirmations in production if email verification is required.

6. **Attach `handle_user_company_claim` on `accounts` UPDATE** (if `company_id` can change)  
   Repo defines the function but only wires INSERT trigger (`20260524151222_harden_account_triggers.sql:25-42` vs `:71-75`). Stale JWT claims otherwise.

### Medium

7. **Last-admin guard on `PATCH /api/users/[id]/status`**  
   Before deactivating an admin, count remaining active admins in `company_id`; reject if zero would remain (`docs/user-management.md:62` deferred item).

8. **Unified password policy (min 8+ everywhere)**  
   Raise `minimum_password_length` in Supabase config, add server-side min length to `drivers/create`, and add client validation to `sign-up-view.tsx` to match `credentials/route.ts:18`.

9. **Server-side password rules on `POST /api/drivers/create`**  
   Mirror `MIN_PASSWORD_LENGTH = 8` from credentials route; client-only Zod `.min(6)` is insufficient (`driver-form-body.tsx:51`).

10. **Proactive session invalidation on deactivation**  
    After successful ban, consider Supabase admin APIs to revoke refresh tokens / sessions for the user id, not only set `ban_duration`.

11. **Verify production trigger inventory**  
    Confirm whether `handle_new_user` is attached to `auth.users` in production (not in repo) and document expected behavior for admin-created vs self-sign-up users.

### Low

12. **Remove `GRANT SELECT, UPDATE ON accounts TO anon`** if unused (`20260318130000_rename_users_to_accounts.sql:112-113`) — reduces attack surface for keyless/anon edge cases.

13. **Driver layout: use `maybeSingle()` for missing account**  
    Avoid hard errors when `accounts` row absent (`driver/layout.tsx:31-35`).

---

## Files reviewed (index)

| Area | Paths |
| --- | --- |
| Auth UI | `src/features/auth/components/sign-up-view.tsx`, `sign-in-view.tsx` |
| Auth pages | `src/app/auth/sign-up/page.tsx`, `sign-in/page.tsx`, `page.tsx`, `layout.tsx` |
| Admin create | `src/app/api/drivers/create/route.ts` |
| User APIs | `src/app/api/users/route.ts`, `[id]/status/route.ts`, `[id]/credentials/route.ts` |
| Guards | `src/lib/api/require-admin.ts`, `src/proxy.ts`, `src/app/dashboard/layout.tsx`, `src/app/driver/layout.tsx` |
| Migrations | `20260524151222_harden_account_triggers.sql`, `20260318130000_rename_users_to_accounts.sql` |
| Config | `supabase/config.toml` |
| Docs | `docs/accounts-table.md`, `docs/user-management.md` |

**No application or migration code was modified** during this audit except creation of this document.
