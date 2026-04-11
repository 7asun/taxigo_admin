import type { ClientForPricing } from '@/features/clients/api/clients-pricing.api';

export function clientDisplayName(
  c: Pick<
    ClientForPricing,
    'first_name' | 'last_name' | 'company_name' | 'is_company'
  >
): string {
  if (c.is_company && c.company_name) return c.company_name;
  const parts = [c.first_name, c.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : '—';
}
