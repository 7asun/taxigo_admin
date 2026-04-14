/**
 * angebote.ts
 *
 * TanStack Query key factory for all Angebote-related queries.
 *
 * Rules:
 *   - ALWAYS use these factories in useQuery() and invalidateQueries()
 *   - Never use inline string arrays in Angebot query calls
 *   - Use the broadest key that makes sense for invalidation:
 *     e.g. after creating an Angebot, invalidate angebotKeys.all
 *          after updating status, invalidate angebotKeys.detail(id)
 */

export const angebotKeys = {
  /** Root — invalidate to refetch all Angebot queries. */
  all: ['angebote'] as const,

  /**
   * Angebot list (all for company, or filtered by status).
   */
  list: () => ['angebote', 'list'] as const,

  /**
   * Full Angebot detail: header + line items.
   * Used on the detail page and for PDF generation.
   */
  detail: (id: string) => ['angebote', 'detail', id] as const,

  vorlagen: {
    /** Invalidate all angebot-vorlagen queries for a company. */
    all: ['angebot-vorlagen'] as const,
    /** Query key from angebotKeys.vorlagen — see src/query/keys/angebote.ts */
    list: (companyId: string) =>
      ['angebot-vorlagen', 'list', companyId] as const,
    detail: (id: string) => ['angebot-vorlagen', 'detail', id] as const
  }
};
