/**
 * Slim client API for the Preisregeln pricing page.
 *
 * Intentionally separate from clients.service.ts — this module selects only
 * the fields needed for display and price_tag management. The full client
 * service (with pagination, search, and all fields) is not used here to avoid
 * over-fetching on a reference query that runs on every dialog open.
 */

import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { getSessionCompanyId } from '@/features/payers/lib/session-company-id';

export type ClientForPricing = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  is_company: boolean;
  price_tag: number | null;
};

export async function listClientsForPricing(): Promise<ClientForPricing[]> {
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const { data, error } = await supabase
    .from('clients')
    .select('id, first_name, last_name, company_name, is_company, price_tag')
    .eq('company_id', companyId)
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('first_name', { ascending: true, nullsFirst: false });

  if (error) throw toQueryError(error);
  return (data ?? []) as ClientForPricing[];
}

/**
 * Writes a gross brutto price tag directly to clients.price_tag.
 * Pass null to remove the price tag (client falls back to billing rules).
 *
 * This is the write side of the P1 price resolution path in resolveTripPrice().
 * No approach fee is applied to client price tags — see docs/preisregeln.md.
 */
export async function setClientPriceTag(
  clientId: string,
  priceTagGross: number | null
): Promise<void> {
  const companyId = await getSessionCompanyId();
  const supabase = createClient();

  const { error } = await supabase
    .from('clients')
    .update({
      price_tag: priceTagGross,
      updated_at: new Date().toISOString()
    })
    .eq('id', clientId)
    .eq('company_id', companyId);

  if (error) throw toQueryError(error);
}
