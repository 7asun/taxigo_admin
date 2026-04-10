'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { referenceKeys } from '@/query/keys';
import {
  FremdfirmenService,
  type FremdfirmaInsert,
  type FremdfirmaUpdate
} from '../api/fremdfirmen.service';

const ADMIN_KEY = ['fremdfirmen', 'admin', 'all'] as const;

export function useFremdfirmenAdmin() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ADMIN_KEY,
    queryFn: () => FremdfirmenService.listAll(),
    staleTime: 60_000
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ADMIN_KEY });
    void qc.invalidateQueries({ queryKey: referenceKeys.fremdfirmen() });
  };

  const createM = useMutation({
    mutationFn: (row: FremdfirmaInsert) => FremdfirmenService.create(row),
    onSuccess: invalidate
  });

  const updateM = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FremdfirmaUpdate }) =>
      FremdfirmenService.update(id, patch),
    onSuccess: invalidate
  });

  return {
    ...query,
    createFremdfirma: createM.mutateAsync,
    updateFremdfirma: updateM.mutateAsync,
    isCreating: createM.isPending,
    isUpdating: updateM.isPending
  };
}
