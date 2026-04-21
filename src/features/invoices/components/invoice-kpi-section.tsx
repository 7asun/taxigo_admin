'use client';

/**
 * InvoiceKpiSection
 *
 * Client-side wrapper that renders the billing KPI cards on the
 * Rechnungen list page. Extracted so the parent (InvoicesPage) can
 * remain a server component.
 *
 * Previously these stats lived on /dashboard/abrechnung. They were
 * moved here when Abrechnung was changed to a collapse-only sidebar
 * group (url: '#') like Account/Einstellungen.
 */

import { AbrechnungKpiCards } from './abrechnung-overview/abrechnung-kpi-cards';
import { useAbrechnungKpis } from './abrechnung-overview/use-abrechnung-kpis';

export function InvoiceKpiSection() {
  const kpis = useAbrechnungKpis();
  return <AbrechnungKpiCards kpis={kpis} />;
}
