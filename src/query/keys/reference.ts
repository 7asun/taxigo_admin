/**
 * Query keys for small, reusable reference lists (drivers, payers, billing types).
 *
 * Rows are already scoped by Supabase RLS to the current workspace; the key does not
 * duplicate `company_id` because the browser client session implies one tenant. If you
 * ever reuse one QueryClient across org switches without remounting, call
 * `queryClient.removeQueries({ queryKey: referenceKeys.root })` when the active org changes.
 */
export const referenceKeys = {
  /** Prefix for `invalidateQueries` when reference data must be dropped globally. */
  root: ['reference'] as const,

  /**
   * Active driver accounts (`accounts.role = driver`, `is_active = true`), ordered by name.
   * Shared by Fahrten filters, Kanban, trip form, and every list-row `DriverSelectCell`.
   */
  drivers: () => [...referenceKeys.root, 'drivers'] as const,

  /** All payers the user can see, ordered by name (filter dropdowns, forms). */
  payers: () => [...referenceKeys.root, 'payers'] as const,

  /**
   * Billing types for one real payer UUID. Never call with URL sentinels like `'all'`;
   * use `enabled: false` in `useQuery` when the payer filter is not a concrete id.
   */
  billingTypes: (payerId: string) =>
    [...referenceKeys.root, 'billingTypes', payerId] as const
};
