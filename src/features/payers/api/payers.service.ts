import { createClient } from '@/lib/supabase/client';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type {
  BillingFamilyWithVariants,
  BillingTypeBehavior,
  Payer,
  PayerWithBillingCount
} from '../types/payer.types';
import {
  isValidBillingVariantCode,
  normalizeBillingVariantCodeInput,
  pickUniqueBillingVariantCode,
  suggestBillingVariantCode
} from '../lib/billing-variant-code';

export const DEFAULT_BEHAVIOR: BillingTypeBehavior = {
  returnPolicy: 'none',
  lockReturnMode: false,
  lockPickup: false,
  lockDropoff: false,
  prefillDropoffFromPickup: false,
  requirePassenger: true,
  requirePickupStation: false,
  requireDropoffStation: false,
  askCallingStationAndBetreuer: false,
  defaultPickup: null,
  defaultDropoff: null,
  defaultPickupStreet: null,
  defaultPickupStreetNumber: null,
  defaultPickupZip: null,
  defaultPickupCity: null,
  defaultDropoffStreet: null,
  defaultDropoffStreetNumber: null,
  defaultDropoffZip: null,
  defaultDropoffCity: null
};

export class PayersService {
  static async getPayers(): Promise<PayerWithBillingCount[]> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('payers')
      .select('id, name, number, billing_types(count)')
      .order('name');

    if (error) {
      console.error('Error fetching payers:', error);
      throw toQueryError(error);
    }

    return (data || []) as PayerWithBillingCount[];
  }

  static async createPayer(
    companyId: string,
    name: string,
    number: string
  ): Promise<void> {
    if (!companyId) throw new Error('Company ID is required');

    const supabase = createClient();
    const { error } = await supabase.from('payers').insert({
      company_id: companyId,
      name,
      number
    });

    if (error) {
      console.error('Error creating payer:', error);
      throw toQueryError(error);
    }
  }

  static async updatePayer(
    id: string,
    name: string,
    number: string
  ): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('payers')
      .update({ name, number })
      .eq('id', id);

    if (error) {
      console.error('Error updating payer:', error);
      throw toQueryError(error);
    }
  }

  /**
   * Full tree for Kostenträger sheet: each family with its variants (ordered).
   */
  static async getBillingFamiliesWithVariants(
    payerId: string
  ): Promise<BillingFamilyWithVariants[]> {
    if (!payerId) return [];

    const supabase = createClient();
    const { data, error } = await supabase
      .from('billing_types')
      .select(
        `
        id,
        payer_id,
        name,
        color,
        behavior_profile,
        created_at,
        billing_variants (
          id,
          billing_type_id,
          name,
          code,
          sort_order,
          created_at
        )
      `
      )
      .eq('payer_id', payerId)
      .order('name');

    if (error) {
      console.error('Error fetching billing families:', error);
      throw toQueryError(error);
    }

    const rows = (data || []) as BillingFamilyWithVariants[];
    // Sort variants inside each family (DB may not guarantee nested order).
    for (const f of rows) {
      f.billing_variants = [...(f.billing_variants || [])].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return a.name.localeCompare(b.name);
      });
    }
    return rows;
  }

  /**
   * Creates a new Abrechnungsfamilie plus an initial variant (required for trips/CSV).
   */
  static async createBillingFamilyWithDefaultVariant(
    payerId: string,
    familyName: string,
    color: string,
    options?: {
      /** Default "Standard"; shown as Unterart name. */
      initialVariantName?: string;
      /** Optional override; otherwise derived from Unterart + Familie. */
      initialVariantCode?: string;
    }
  ): Promise<void> {
    if (!payerId) throw new Error('Payer ID is required');

    const initialName = options?.initialVariantName?.trim() || 'Standard';
    const manual =
      options?.initialVariantCode != null
        ? normalizeBillingVariantCodeInput(options.initialVariantCode)
        : '';
    const code =
      manual.length >= 2 && isValidBillingVariantCode(manual)
        ? manual
        : pickUniqueBillingVariantCode(
            suggestBillingVariantCode(initialName, familyName.trim()),
            []
          );

    const supabase = createClient();

    const { data: familyRow, error: famErr } = await supabase
      .from('billing_types')
      .insert({
        payer_id: payerId,
        name: familyName.trim(),
        color,
        behavior_profile: DEFAULT_BEHAVIOR as unknown as Record<string, unknown>
      })
      .select('id')
      .single();

    if (famErr || !familyRow) {
      console.error('Error creating billing family:', famErr);
      throw famErr
        ? toQueryError(famErr)
        : new Error('Familie konnte nicht angelegt werden');
    }

    const { error: varErr } = await supabase.from('billing_variants').insert({
      billing_type_id: familyRow.id,
      name: initialName,
      code,
      sort_order: 0
    });

    if (varErr) {
      console.error('Error creating default billing variant:', varErr);
      throw toQueryError(varErr);
    }
  }

  /** Rename / recolor a family (`billing_types` row); behavior stays in behavior_profile. */
  static async updateBillingFamily(
    familyId: string,
    name: string,
    color: string
  ): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('billing_types')
      .update({ name: name.trim(), color })
      .eq('id', familyId);

    if (error) {
      console.error('Error updating billing family:', error);
      throw toQueryError(error);
    }
  }

  /**
   * Inserts a variant. If `rawCode` is missing or invalid, code is generated from
   * Unterart + `billing_types.name` and made unique within the family.
   */
  static async createBillingVariant(
    familyId: string,
    name: string,
    rawCode: string | null | undefined,
    sortOrder?: number
  ): Promise<void> {
    const supabase = createClient();
    const trimmedName = name.trim();

    const manual =
      rawCode != null ? normalizeBillingVariantCodeInput(rawCode) : '';
    let code: string;
    if (manual.length >= 2 && isValidBillingVariantCode(manual)) {
      code = manual;
    } else {
      const { data: fam, error: famErr } = await supabase
        .from('billing_types')
        .select('name')
        .eq('id', familyId)
        .single();
      if (famErr) {
        console.error('Error loading billing family for code:', famErr);
        throw toQueryError(famErr);
      }
      const { data: rows, error: listErr } = await supabase
        .from('billing_variants')
        .select('code')
        .eq('billing_type_id', familyId);
      if (listErr) {
        console.error('Error listing variant codes:', listErr);
        throw toQueryError(listErr);
      }
      const existing = (rows ?? []).map((r) => r.code);
      code = pickUniqueBillingVariantCode(
        suggestBillingVariantCode(trimmedName, fam?.name ?? ''),
        existing
      );
    }

    const { error } = await supabase.from('billing_variants').insert({
      billing_type_id: familyId,
      name: trimmedName,
      code,
      sort_order: sortOrder ?? 0
    });

    if (error) {
      console.error('Error creating billing variant:', error);
      throw toQueryError(error);
    }
  }

  static async updateBillingVariant(
    variantId: string,
    name: string,
    rawCode: string
  ): Promise<void> {
    const code = normalizeBillingVariantCodeInput(rawCode);
    if (!isValidBillingVariantCode(code)) {
      throw new Error('Ungültiger Varianten-Code (2–6 Zeichen, A–Z und 0–9).');
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('billing_variants')
      .update({ name: name.trim(), code })
      .eq('id', variantId);

    if (error) {
      console.error('Error updating billing variant:', error);
      throw toQueryError(error);
    }
  }

  static async deleteBillingVariant(id: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('billing_variants')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting billing variant:', error);
      throw toQueryError(error);
    }
  }

  /** Removes family and all variants (trips lose billing_variant_id via ON DELETE SET NULL). */
  static async deleteBillingFamily(id: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('billing_types')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting billing family:', error);
      throw toQueryError(error);
    }
  }

  static async updateBillingFamilyBehavior(
    familyId: string,
    behavior: BillingTypeBehavior
  ): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase
      .from('billing_types')
      .update({
        behavior_profile: behavior as unknown as Record<string, unknown>
      })
      .eq('id', familyId);

    if (error) {
      console.error('Error updating billing family behavior:', error);
      throw toQueryError(error);
    }
  }

  static async countVariantsInFamily(familyId: string): Promise<number> {
    const supabase = createClient();
    const { count, error } = await supabase
      .from('billing_variants')
      .select('id', { count: 'exact', head: true })
      .eq('billing_type_id', familyId);

    if (error) throw toQueryError(error);
    return count ?? 0;
  }
}
