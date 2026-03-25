import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

/**
 * Hard-delete trips: assignments, unlink, then row delete.
 * Caller must supply a client that is allowed to perform these operations (e.g. service role).
 */
export async function hardDeleteTripsByIds(
  supabase: SupabaseClient<Database>,
  ids: string[]
): Promise<{ deletedIds: string[] }> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) {
    return { deletedIds: [] };
  }

  const { error: assignmentsError } = await supabase
    .from('trip_assignments')
    .delete()
    .in('trip_id', unique);

  if (assignmentsError) throw assignmentsError;

  const { error: clearOutboundError } = await supabase
    .from('trips')
    .update({ linked_trip_id: null })
    .in('id', unique);

  if (clearOutboundError) throw clearOutboundError;

  const { error: unlinkError } = await supabase
    .from('trips')
    .update({ linked_trip_id: null })
    .in('linked_trip_id', unique);

  if (unlinkError) throw unlinkError;

  const { data: deletedRows, error: deleteError } = await supabase
    .from('trips')
    .delete()
    .in('id', unique)
    .select('id');

  if (deleteError) throw deleteError;

  const deletedIds = deletedRows?.map((r) => r.id) ?? [];
  if (deletedIds.length !== unique.length) {
    throw new Error(
      `Löschen unvollständig: ${deletedIds.length} von ${unique.length} Fahrten entfernt.`
    );
  }

  return { deletedIds };
}
