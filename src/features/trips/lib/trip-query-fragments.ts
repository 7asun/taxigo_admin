// Single source of truth for Supabase join fragments.
// Import these constants in every query that needs to display assignee info.
// Never inline the join string — if the fremdfirmen schema changes, fix it here.
export const DRIVER_JOIN_FRAGMENT =
  'driver:accounts!trips_driver_id_fkey(name)';

export const FREMDFIRMA_JOIN_FRAGMENT =
  'fremdfirma:fremdfirmen(id, name, default_payment_mode)';

export const ASSIGNEE_JOIN_FRAGMENT = `${DRIVER_JOIN_FRAGMENT}, ${FREMDFIRMA_JOIN_FRAGMENT}`;
