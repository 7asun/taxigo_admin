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
 * Writes gross price to `clients.price_tag` and keeps the global row in
 * `client_price_tags` (payer and variant null) in sync for invoice STEP 0.
 * Pass null to clear both. Payer/variant-scoped tags are managed only via
 * `client_price_tags` APIs — not here.
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
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('clients')
    .update({
      price_tag: priceTagGross,
      updated_at: now
    })
    .eq('id', clientId)
    .eq('company_id', companyId);

  if (error) throw toQueryError(error);

  if (priceTagGross !== null && priceTagGross > 0) {
    const { data: existing, error: selErr } = await supabase
      .from('client_price_tags')
      .select('id')
      .eq('client_id', clientId)
      .is('payer_id', null)
      .is('billing_variant_id', null)
      .eq('is_active', true)
      .maybeSingle();

    if (selErr) throw toQueryError(selErr);

    if (existing?.id) {
      const { error: uErr } = await supabase
        .from('client_price_tags')
        .update({
          price_gross: priceTagGross,
          updated_at: now
        })
        .eq('id', existing.id);
      if (uErr) throw toQueryError(uErr);
    } else {
      const { error: iErr } = await supabase.from('client_price_tags').insert({
        company_id: companyId,
        client_id: clientId,
        payer_id: null,
        billing_variant_id: null,
        price_gross: priceTagGross,
        is_active: true
      });
      if (iErr) throw toQueryError(iErr);
    }
  } else {
    const { error: dErr } = await supabase
      .from('client_price_tags')
      .delete()
      .eq('client_id', clientId)
      .is('payer_id', null)
      .is('billing_variant_id', null);
    if (dErr) throw toQueryError(dErr);
  }
}
