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

  /**
   * Slim payer list for trip forms / filters (`id`, `name`, `kts_default`).
   * Kostenträger admin page uses `['payers']` + full rows — see `src/query/README.md`.
   */
  payers: () => [...referenceKeys.root, 'payers'] as const,

  /**
   * Slim client list for Abrechnung → Preisregeln (`listClientsForPricing`).
   */
  clients: () => [...referenceKeys.root, 'clients'] as const,

  /**
   * Flat billing variant list for trip create + filters (`fetchBillingVariantsForPayer` in
   * `trip-reference-data.ts`): each row includes `billing_type_id`, `code`, and family `behavior_profile`.
   * Invalidate via `useBillingTypes` after Kostenträger admin edits families/variants.
   */
  billingVariants: (payerId: string) =>
    [...referenceKeys.root, 'billingVariants', payerId] as const,

  /** Active Fremdfirmen (`is_active = true`) for trip + recurring forms. */
  fremdfirmen: () => [...referenceKeys.root, 'fremdfirmen'] as const,

  /** Rechnungsempfänger catalog for Kostenträger + invoice builder. */
  rechnungsempfaenger: () =>
    [...referenceKeys.root, 'rechnungsempfaenger'] as const,

  /** Pricing rules shown in Kostenträger admin for one payer. */
  billingPricingRules: (payerId: string) =>
    [...referenceKeys.root, 'billingPricingRules', payerId] as const,

  /**
   * All pricing rules for the company (Abrechnung → Preisregeln catalog).
   * @see useAllPricingRules
   */
  allBillingPricingRules: () =>
    [...referenceKeys.root, 'allBillingPricingRules'] as const
};
