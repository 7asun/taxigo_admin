/**
 * invoice-keys.ts
 *
 * TanStack Query key factory for all invoice-related queries.
 *
 * Rules:
 *   - ALWAYS use these factories in useQuery() and invalidateQueries()
 *   - Never use inline string arrays in invoice query calls
 *   - Use the broadest key that makes sense for invalidation:
 *     e.g. after creating an invoice, invalidate invoiceKeys.all
 *          after updating status, invalidate invoiceKeys.detail(id)
 */

/** Filter shape used for the invoice list query. */
export interface InvoiceListFilter {
  status?: string;
  payer_id?: string;
  from?: string; // yyyy-MM-dd; list API filters created_at (business TZ)
  to?: string; // yyyy-MM-dd
  /** Optional cap on rows (e.g. Abrechnung recent list). */
  limit?: number;
  /**
   * Abrechnung KPI deep-link: client-side slice of the fetched list.
   * `open` / `overdue` expect `status: 'sent'` from the API.
   */
  kpi_bucket?: 'open' | 'overdue' | 'this_month';
}

export const invoiceKeys = {
  /** Root — invalidate to refetch all invoice queries. */
  all: ['invoices'] as const,

  /**
   * Invoice list with optional filters.
   * Each unique filter object gets its own cache entry.
   */
  list: (filter?: InvoiceListFilter) =>
    ['invoices', 'list', filter ?? {}] as const,

  /**
   * Single invoice row (no line items).
   * Used where only the header is needed.
   */
  detail: (id: string) => ['invoices', 'detail', id] as const,

  /**
   * Full invoice detail: row + line items + payer + company_profile.
   * Fetched for detail page and PDF generation.
   */
  full: (id: string) => ['invoices', 'full', id] as const,

  /**
   * Line items for a given invoice.
   * Separated so they can be invalidated independently after editing.
   */
  lineItems: (invoiceId: string) =>
    ['invoices', 'line-items', invoiceId] as const,

  /**
   * Trips eligible for inclusion in an invoice.
   * Keyed by payer + optional billing_type + date range.
   */
  tripsForBuilder: (params: {
    payer_id: string;
    billing_type_id?: string | null;
    billing_variant_id?: string | null;
    period_from: string;
    period_to: string;
    client_id?: string | null;
  }) => ['invoices', 'builder-trips', params] as const,

  /**
   * Invoice text blocks (Baukasten) for template management.
   */
  textBlocks: {
    /** Root — invalidate to refetch all text block queries. */
    all: ['invoice-text-blocks'] as const,

    /** Grouped list (intro / outro). Must not share cache with `flatList()` (different result shape). */
    list: () => ['invoice-text-blocks', 'list'] as const,

    /** Flat array for dropdowns. Must not share `list()` key (grouped vs flat cache shape). */
    flatList: () => ['invoice-text-blocks', 'flat-list'] as const,

    /** Single text block by ID. */
    detail: (id: string) => ['invoice-text-blocks', 'detail', id] as const
  },

  /** PDF column Vorlagen (pdf_vorlagen) for settings + builder. */
  pdfVorlagen: {
    all: ['pdf-vorlagen'] as const,
    list: (companyId: string) => ['pdf-vorlagen', 'list', companyId] as const
  },

  /**
   * Aggregate revenue total for issued invoices (status: sent | paid).
   * Used by the dashboard overview stat card.
   */
  revenueTotal: ['invoices', 'revenue-total'] as const
};
