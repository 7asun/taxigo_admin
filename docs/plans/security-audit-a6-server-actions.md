# Security Audit A6 — Server Actions Authentication Coverage

Scope (read-only):

- Every `src/` file with top-level `'use server'`
- `src/lib/api/require-admin.ts`
- `src/lib/api/require-session.ts`
- `docs/access-control.md`
- `docs/plans/security-audit-a1-api-routes.md`

Method:

- Searched `src/` for top-level `'use server'` directives.
- Read each matching file fully.
- Traced delegated service functions where the action itself is a thin wrapper.
- Checked current call sites for Server Component / Client Component reachability.

---

## Executive summary

| Metric | Count |
| --- | ---: |
| Top-level `'use server'` files in `src/` | **5** |
| Exported async functions in those files | **29** |
| Functions with direct or delegated admin guard before data access | **24 / 29 (82.8%)** |
| Functions with no internal auth guard | **5 / 29 (17.2%)** |
| Functions using service role directly or indirectly | **4 / 29 (13.8%)** |

**Highest risk:** `createRecurringRule()` and `updateRecurringRule()` in `src/features/trips/api/recurring-rules.actions.ts` are client-reachable Server Actions through recurring-rule UI flows, but they do **not** call `requireAdmin()`, `requireSession()`, or `requireAdminContext()` before geocoding and mutating `recurring_rules` (`:26-43`, `:46-99`). They accept rule data from the client and rely on the session Supabase client/RLS. This is risky because A2 found `recurring_rules` has **no RLS definition in repo**, and these actions perform server-side Google geocoding before any explicit auth check.

**Service role:** No unguarded client-reachable action writes with service role directly. The service-role path for recurring generation is guarded by `requireAdminContext()` + tenant ownership check before calling `generateRecurringTrips()` (`recurring-rules.actions.ts:253-264`; `recurring-trip-generator.ts:61-65`). The driver roster file still exports unguarded helpers that use `createAdminClient()`, but current client usage imports only the guarded `loadDriverForPanel()` (`get-roster.ts:64-87`, `:147-188`; `driver-detail-panel.tsx:23`, `:78`).

**Error handling:** Several Server Actions return raw Supabase/PostgREST messages as strings. No stack traces are intentionally serialized, but `error.message` and `toQueryError()` output can include table/column names, PostgREST codes, and hints (`to-query-error.ts:6-19`).

---

## Q1 — Full Server Action inventory

### Inventory table

| File | Function | Guard | Service Role | Data Touched |
| --- | --- | --- | --- | --- |
| `src/features/shift-reconciliations/actions.ts` | `getShiftReconciliationDriversAction()` (`:33-37`) | Delegates to `getDrivers()`; service calls local `requireAdminContext()` first (`shift-reconciliations.service.ts:76-78`) | No | Reads active driver `accounts` for current admin company (`shift-reconciliations.service.ts:78-84`) |
| `src/features/shift-reconciliations/actions.ts` | `getShiftTripsForDateAction()` (`:39-44`) | Delegates to `getTripsForShift()`; guarded (`shift-reconciliations.service.ts:123-128`) | No | Reads `trips` with payer/billing embeds for `company_id`, `driver_id`, date window (`shift-reconciliations.service.ts:130-155`) |
| `src/features/shift-reconciliations/actions.ts` | `getShiftReconciliationRecordAction()` (`:46-51`) | Delegates to `getReconciliation()`; guarded (`shift-reconciliations.service.ts:350-355`) | No | Reads `shift_reconciliations`; reads confirmer `accounts` (`shift-reconciliations.service.ts:356-384`) |
| `src/features/shift-reconciliations/actions.ts` | `getShiftDaySummariesAction()` (`:53-57`) | Delegates to `getShiftDaySummaries()`; guarded (`shift-reconciliations.service.ts:428-432`) | No | Calls RPC `get_shift_day_summaries` with server-derived `companyId` (`shift-reconciliations.service.ts:431-435`) |
| `src/features/shift-reconciliations/actions.ts` | `updateTripManualPriceAction()` (`:59-64`) | Delegates to `updateTripManualPrice()`; guarded (`shift-reconciliations.service.ts:190-195`) | No | Reads `trips.id, company_id`, then updates `trips.manual_gross_price` after tenant check (`shift-reconciliations.service.ts:196-210`) |
| `src/features/shift-reconciliations/actions.ts` | `completeReconciliationAction()` (`:66-89`) | Delegates to `completeReconciliation()`; guarded (`shift-reconciliations.service.ts:244-248`) | No | Reads `shifts`; upserts `shift_reconciliations` with `company_id` and `confirmed_by` from session (`shift-reconciliations.service.ts:247-285`) |
| `src/features/shift-reconciliations/actions.ts` | `reopenReconciliationAction()` (`:91-105`) | Delegates to `reopenReconciliation()`; guarded (`shift-reconciliations.service.ts:291-296`) | No | Updates `shift_reconciliations` scoped by `company_id`, `driver_id`, `date` (`shift-reconciliations.service.ts:297-311`) |
| `src/features/shift-reconciliations/actions.ts` | `saveIstZeitInlineAction()` (`:107-124`) | Delegates to `saveIstZeitInline()` -> `createAdminShiftForDriver()`; guarded before data access in admin shifts service (`admin-shifts.service.ts:174-178`) | No | Inserts/overwrites admin-entered `shifts` + `shift_events` for server-derived company (`admin-shifts.service.ts:174-243`) |
| `src/features/driver-planning/actions.ts` | `getPlanningDriversAction()` (`:30-34`) | Delegates to `getPlanningDrivers()`; guarded (`driver-planning.service.ts:86-88`) | No | Reads active driver `accounts` scoped by `company_id` (`driver-planning.service.ts:88-94`) |
| `src/features/driver-planning/actions.ts` | `getDriverWeekPlanAction()` (`:36-41`) | Delegates to `getDriverWeekPlan()`; guarded (`driver-planning.service.ts:107-112`) | No | Reads `driver_day_plans` + `vehicles` scoped by `company_id`, `driver_id`, week (`driver-planning.service.ts:114-126`) |
| `src/features/driver-planning/actions.ts` | `getCompanyWeekPlanAction()` (`:43-47`) | Delegates to `getCompanyWeekPlan()`; guarded (`driver-planning.service.ts:140-144`) | No | Reads all company `driver_day_plans` + `vehicles` for week (`driver-planning.service.ts:146-158`) |
| `src/features/driver-planning/actions.ts` | `upsertDayPlanAction()` (`:49-53`) | Delegates to `upsertDayPlan()`; guarded (`driver-planning.service.ts:201-205`) | No | Upserts `driver_day_plans`; `company_id` and `created_by` sourced from session (`driver-planning.service.ts:212-230`) |
| `src/features/driver-planning/actions.ts` | `deleteDayPlanAction()` (`:55-57`) | Delegates to `deleteDayPlan()`; guarded (`driver-planning.service.ts:245-248`) | No | Deletes `driver_day_plans` by `id`; relies on RLS for company scope (`driver-planning.service.ts:247-252`) |
| `src/features/driver-planning/actions.ts` | `getAdminShiftForDriverDateAction()` (`:59-64`) | Delegates to `getAdminShiftForDriverDate()` -> `findShiftForDriverDate()`; guarded (`admin-shifts.service.ts:87-99`, `:137-143`) | No | Reads `shifts` + `shift_events` scoped by `company_id`, `driver_id`, Berlin date (`admin-shifts.service.ts:101-122`) |
| `src/features/driver-planning/actions.ts` | `createAdminShiftAction()` (`:66-81`) | Delegates to `createAdminShiftForDriver()`; guarded (`admin-shifts.service.ts:174-178`) | No | Inserts admin-entered `shifts` + `shift_events`; may delete prior ended shift/events (`admin-shifts.service.ts:186-243`) |
| `src/features/driver-planning/actions.ts` | `deleteAdminShiftAction()` (`:83-101`) | Delegates to `deleteAdminShift()`; guarded (`admin-shifts.service.ts:250-255`) | No | Deletes a driver's shift/events scoped by `company_id`; then best-effort reopens reconciliation through guarded action (`driver-planning/actions.ts:87-97`) |
| `src/features/driver-management/api/get-roster.ts` | `mergeLiveEmails()` (`:64-87`) | **No internal guard** | **Yes** — `createAdminClient()` (`:67`) | Reads Supabase Auth users by IDs supplied in `rows` (`:69-84`) |
| `src/features/driver-management/api/get-roster.ts` | `getRoster()` (`:89-142`) | **No internal guard**; current callers pass `auth.companyId` after `requireAdmin()` (`driver-table-listing.tsx:16-39`, `users/route.ts:20-67`) | **Indirect yes** via `mergeLiveEmails()` (`get-roster.ts:137`) | Reads company `accounts`; merges live Auth emails (`:94-141`) |
| `src/features/driver-management/api/get-roster.ts` | `getDriverWithLiveEmail()` (`:147-177`) | **No internal guard**; called by guarded `loadDriverForPanel()` (`:180-188`) | **Yes** — `createAdminClient()` (`:168`) | Reads `accounts`, `driver_profiles`; reads Auth email (`:151-176`) |
| `src/features/driver-management/api/get-roster.ts` | `loadDriverForPanel()` (`:180-188`) | **Direct `requireAdmin()`** before data (`:183-186`) | Indirect yes via `getDriverWithLiveEmail()` (`:187`) | Reads one same-company driver/account + profiles + Auth email (`:147-176`) |
| `src/lib/driver-availability.actions.ts` | `getDriverDayContextAction()` (`:17-22`) | Delegates to `getDriverDayContext()` -> `getDriversDayContext()`; guarded (`driver-availability.server.ts:153-168`) | No | Reads `driver_day_plans` + `shifts` + `shift_events` for one driver/day (`driver-availability.server.ts:173-198`) |
| `src/lib/driver-availability.actions.ts` | `getDriversDayContextAction()` (`:24-29`) | Delegates to guarded `getDriversDayContext()` (`driver-availability.server.ts:161-168`) | No | Reads `driver_day_plans`, `shifts`, `shift_events` for provided driver IDs (`driver-availability.server.ts:173-198`) |
| `src/lib/driver-availability.actions.ts` | `getActiveDriversDayContextAction()` (`:31-35`) | Delegates to `getActiveDriverIds()` + `getDriversDayContext()`; both guarded (`driver-availability.server.ts:223-240`) | No | Reads active driver `accounts`; reads availability rows for those drivers (`driver-availability.server.ts:223-240`) |
| `src/lib/driver-availability.actions.ts` | `getCompanyWeekShiftsMapAction()` (`:37-42`) | Delegates to guarded `getCompanyWeekShiftsMap()` (`driver-availability.server.ts:250-253`) | No | Reads company `shifts` + `shift_events` for a week (`driver-availability.server.ts:253-260`) |
| `src/features/trips/api/recurring-rules.actions.ts` | `createRecurringRule()` (`:26-44`) | **No explicit guard** before geocoding or insert | No | Geocodes pickup/dropoff; inserts client-supplied `recurring_rules` payload (`:29-38`) |
| `src/features/trips/api/recurring-rules.actions.ts` | `updateRecurringRule()` (`:46-100`) | **No explicit guard** before fetch/geocode/update | No | Reads `recurring_rules` by client-supplied `id`; geocodes if addresses changed; updates client-supplied payload (`:50-94`) |
| `src/features/trips/api/recurring-rules.actions.ts` | `deleteFutureTripsAfterDate()` (`:106-125`) | **Direct `requireAdminContext()`** + `assertRuleBelongsToCompany()` (`:110-113`) | No | Deletes future pending `trips` linked to tenant-owned rule (`:114-121`) |
| `src/features/trips/api/recurring-rules.actions.ts` | `resyncFutureRecurringTrips()` (`:149-248`) | **Direct `requireAdminContext()`** + `assertRuleBelongsToCompany()` (`:158-159`) | No | Reads future pending `trips`; reads `recurring_rule_exceptions`; updates `trips.scheduled_at` in chunks (`:163-247`) |
| `src/features/trips/api/recurring-rules.actions.ts` | `triggerGenerationForRule()` (`:253-266`) | **Direct `requireAdminContext()`** + `assertRuleBelongsToCompany()` (`:257-258`) | **Indirect yes** — `generateRecurringTrips()` defaults to `createAdminClient()` (`recurring-trip-generator.ts:61-65`) | Generates recurring `trips`, pricing, geocoding/metrics/cache through generator for a tenant-checked rule (`recurring-trip-generator.ts:76-85`) |

---

## Q2 — Unguarded Server Actions

### Summary

| Function | Current client reachability | Direct `/_next/action` abuse scenario |
| --- | --- | --- |
| `mergeLiveEmails()` | No current direct client import found; called by API route after `requireAdmin()` (`users/route.ts:20-45`) and by `getRoster()` | If ever exposed to a Client Component, caller could submit arbitrary account IDs and use service role to resolve Auth emails (`get-roster.ts:64-84`). |
| `getRoster()` | No current direct client import found; called by guarded RSC (`driver-table-listing.tsx:16-39`) and guarded API route (`users/route.ts:20-67`) | If exposed, `companyId` is client-supplied (`get-roster.ts:38-45`, `:94-100`), so a caller could request another tenant's roster and Auth emails if RLS/service-role merge permits. |
| `getDriverWithLiveEmail()` | No current direct client import found; guarded wrapper `loadDriverForPanel()` is imported by Client Component (`driver-detail-panel.tsx:23`, `:78`) | If exposed, `companyId` is client-supplied (`get-roster.ts:147-157`), enabling cross-tenant driver/profile/Auth-email lookup by forged company ID. |
| `createRecurringRule()` | **Client-reachable** through create/update flows (`recurring-rule-submit-flow.ts:74-87`; `recurring-rule-panel.tsx:51-57`, `:259-260`; `create-recurring-rule-sheet.tsx:30-33`, `:202-203`) | Unauthenticated or non-admin caller can invoke server geocoding before any explicit auth check (`recurring-rules.actions.ts:29-33`), causing Google quota use. Authenticated non-admin may insert rules with forged `client_id`/payer/billing fields if DB grants/RLS allow. |
| `updateRecurringRule()` | **Client-reachable** through update flows (`recurring-rule-submit-flow.ts:109-130`; `recurring-rule-panel.tsx:239-242`, `:286-289`; `recurring-rule-sheet.tsx:211-214`, `:259-262`) | Caller can submit any rule `id` and arbitrary update payload; action reads the rule and updates without tenant check (`recurring-rules.actions.ts:57-94`). With missing/weak RLS, this is cross-tenant rule modification. Address changes also trigger server-side geocoding (`:83-85`). |

### Important distinction

`getRoster()`, `mergeLiveEmails()`, and `getDriverWithLiveEmail()` are exported from a top-level `'use server'` file, but current code only imports the unguarded helpers from **server-side** contexts:

- RSC `DriverTableListing` calls `requireAdmin()` before `getRoster()` (`driver-table-listing.tsx:16-39`).
- `GET /api/users` calls `requireAdmin()` before `mergeLiveEmails()` / `getRoster()` (`users/route.ts:20-67`).
- The Client Component imports only `loadDriverForPanel()`, which calls `requireAdmin()` (`driver-detail-panel.tsx:23`, `:78`; `get-roster.ts:180-188`).

The recurring-rule actions are different: the create/update wrappers are invoked from client-facing form flows and currently have no explicit server-side admin check.

---

## Q3 — Tenant isolation in Server Actions

### Mutations with session-derived tenant context

| Action | Tenant source | Notes |
| --- | --- | --- |
| `updateTripManualPriceAction()` | `requireAdminContext().companyId` in delegated service (`shift-reconciliations.service.ts:190-204`) | Fetches target trip and verifies `trip.company_id === companyId` before update. |
| `completeReconciliationAction()` | `requireAdminContext().companyId` + `userId` (`shift-reconciliations.service.ts:244-285`) | `driverId` comes from client, but row is written with server-derived `company_id`. |
| `reopenReconciliationAction()` | `requireAdminContext().companyId` (`shift-reconciliations.service.ts:291-307`) | Update constrained by server-derived company. |
| `saveIstZeitInlineAction()` / `createAdminShiftAction()` | `requireAdminContext().companyId` + `userId` (`admin-shifts.service.ts:174-205`) | Inserts `shifts.company_id = companyId`, `entered_by = userId`. |
| `deleteAdminShiftAction()` | `requireAdminContext().companyId` (`admin-shifts.service.ts:250-271`) | Delete lookup includes `.eq('company_id', companyId)`. |
| `upsertDayPlanAction()` | `requireAdminContext().companyId` + `userId` (`driver-planning.service.ts:201-230`) | Payload supplies driver/date/status; tenant and creator are server-derived. |
| `deleteDayPlanAction()` | Admin context exists, but delete uses only `id` (`driver-planning.service.ts:245-252`) | Relies on RLS for company scope; stronger pattern would prefetch `.eq('company_id', companyId)` before delete. |
| `deleteFutureTripsAfterDate()` | `requireAdminContext()` + `assertRuleBelongsToCompany()` (`recurring-rules.actions.ts:110-115`) | Tenant is checked through rule -> client -> company before deletion. |
| `resyncFutureRecurringTrips()` | `requireAdminContext()` + `assertRuleBelongsToCompany()` (`recurring-rules.actions.ts:158-159`) | Rule ownership checked before reading/updating trips/exceptions. |
| `triggerGenerationForRule()` | `requireAdminContext()` + `assertRuleBelongsToCompany()` (`recurring-rules.actions.ts:257-260`) | Tenant check happens before service-role generation. |

### Mutations with forgeable client-supplied tenant linkage

| Action | Issue | Reference |
| --- | --- | --- |
| `createRecurringRule()` | Inserts `{ ...rule, ...coords }` with `rule` supplied by the client. No server-side lookup confirms `rule.client_id` belongs to the caller's company before insert. | `recurring-rules.actions.ts:26-38` |
| `updateRecurringRule()` | Updates by client-supplied `id` and client-supplied payload. No `assertRuleBelongsToCompany()` before fetch/update. | `recurring-rules.actions.ts:46-99` |

This is the main tenant isolation gap in the Server Action surface. It is amplified by A2's finding that `recurring_rules` has no RLS definition in repo.

---

## Q4 — `createAdminClient()` in Server Actions

| Function | Service-role path | Guard before service role? | Tenant isolation before service-role call |
| --- | --- | --- | --- |
| `mergeLiveEmails()` | Direct `createAdminClient()` (`get-roster.ts:67`) | **No internal guard** | Relies entirely on caller-supplied `rows`; current API/RSC callers prefilter by `auth.companyId`, but function itself does not enforce it. |
| `getRoster()` | Indirect via `mergeLiveEmails()` (`get-roster.ts:137`) | **No internal guard** | `companyId` is a parameter (`:38-45`) and used in session query (`:94-100`); current callers pass guarded `auth.companyId`. |
| `getDriverWithLiveEmail()` | Direct `createAdminClient()` (`get-roster.ts:168-169`) | **No internal guard** | `companyId` is a parameter and is used in session query (`:147-157`); current guarded wrapper supplies `auth.companyId`. |
| `loadDriverForPanel()` | Indirect via `getDriverWithLiveEmail()` (`get-roster.ts:187`) | **Yes** — `requireAdmin()` (`:183-186`) | Yes — passes server-derived `auth.companyId` (`:187`). |
| `triggerGenerationForRule()` | Indirect: `generateRecurringTrips()` imports and defaults to `createAdminClient()` (`recurring-trip-generator.ts:36`, `:61-65`) | **Yes** — `requireAdminContext()` (`recurring-rules.actions.ts:257`) | Yes — `assertRuleBelongsToCompany()` before service-role generation (`:258-260`; ownership helper `recurring-rules-admin.ts:49-79`). |

`docs/access-control.md` states the service role client should be imported only from `src/app/api/**` or `scripts/**` (`:27-30`). As A4 noted, `get-roster.ts` violates that convention while remaining server-only and mostly caller-guarded.

---

## Q5 — Error handling

### Raw Supabase/PostgREST messages returned to client

| Location | Pattern | Risk |
| --- | --- | --- |
| `createRecurringRule()` | Returns `error.message` directly (`recurring-rules.actions.ts:40-42`) | May expose relation/column/constraint names from `recurring_rules`. |
| `updateRecurringRule()` | Returns `fetchError?.message` and `error.message` (`recurring-rules.actions.ts:64-68`, `:96-98`) | Same schema disclosure risk. |
| `deleteFutureTripsAfterDate()` | Returns `error.message` and caught `Error.message` (`recurring-rules.actions.ts:118-124`) | Could expose trip/delete policy or schema details. |
| `triggerGenerationForRule()` | Returns caught `Error.message` (`recurring-rules.actions.ts:262-264`) | Generator errors may include table or Google/internal messages. |
| `completeReconciliationAction()` | Returns `err.message` for unknown errors (`shift-reconciliations/actions.ts:83-87`) | Delegated service uses `toQueryError()`; message can include PostgREST code/hint (`to-query-error.ts:6-19`). |
| Unguarded read actions that throw | `getRoster()` throws `rowsError.message` (`get-roster.ts:131-135`); many delegated services throw `toQueryError()` | Next.js/client hooks may surface messages in toasts or error boundaries. |

### Safer patterns observed

| Location | Pattern |
| --- | --- |
| `createAdminShiftAction()` | Maps known errors to stable codes and otherwise returns `UNKNOWN` (`driver-planning/actions.ts:71-80`) |
| `deleteAdminShiftAction()` | Generic `UNKNOWN` on catch (`driver-planning/actions.ts:87-100`) |
| `reopenReconciliationAction()` / `saveIstZeitInlineAction()` | Stable error codes only (`shift-reconciliations/actions.ts:95-123`) |

### Stack traces

No Server Action explicitly returns `error.stack`. The main exposure is stringified `Error.message`, not stack traces.

---

## Additions to remediation list

These are new Server Action findings not fully covered by A1-A5.

### Critical / High — Guard recurring-rule create/update Server Actions

**Files:** `src/features/trips/api/recurring-rules.actions.ts`, `src/features/trips/api/recurring-rules-admin.ts`

**Problem:**

- `createRecurringRule()` calls server-side geocoding and inserts client-supplied rule data without `requireAdminContext()` (`recurring-rules.actions.ts:26-38`).
- `updateRecurringRule()` reads and updates by client-supplied `id` without `assertRuleBelongsToCompany()` (`:46-99`).
- Client flows call these actions through `runCreateWithGeneration()` and `runUpdateWithCleanup()` (`recurring-rule-submit-flow.ts:74-91`, `:109-153`), including Client Components (`recurring-rule-panel.tsx:51-57`, `:239-260`; `create-recurring-rule-sheet.tsx:30-33`, `:202-203`).

**Immediate fix:**

1. In `createRecurringRule()`, call `requireAdminContext()` first.
2. Verify `rule.client_id` belongs to `ctx.companyId` before geocoding or insert.
3. Insert only an allowlisted payload, and set/derive any tenant linkage server-side.
4. In `updateRecurringRule()`, call `requireAdminContext()` + `assertRuleBelongsToCompany(ctx, id)` before reading, geocoding, or updating.
5. Return generic user-safe errors; log raw Supabase/Google details server-side.

### High — Add repo RLS for `recurring_rules` / `recurring_rule_exceptions`

This was identified in A2, but A6 shows why it is action-critical: current client-reachable Server Actions rely on the session Supabase client and therefore on RLS for tenant isolation. Add tracked RLS policies for admin company-scoped CRUD before relying on these actions as a security boundary.

### Medium — Split guarded Server Actions from unguarded service helpers

**File:** `src/features/driver-management/api/get-roster.ts`

`mergeLiveEmails()`, `getRoster()`, and `getDriverWithLiveEmail()` are exported from a top-level `'use server'` file and two of them use the service role directly (`:64-87`, `:147-177`). Current call sites are guarded, but future client imports would expose action-capable unguarded helpers.

**Fix:** Move non-action helpers to a server-only module without top-level `'use server'`, keep only guarded Server Actions in the action file, and make all service-role helpers require server-derived `companyId`.

### Low–Medium — Normalize Server Action error responses

Replace raw `error.message` returns in recurring-rule actions with stable error codes/messages. Keep `toQueryError()` output in server logs only.

