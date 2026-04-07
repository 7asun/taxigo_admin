'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { referenceKeys } from '@/query/keys';
import {
  RechnungsempfaengerService,
  type RechnungsempfaengerInsert,
  type RechnungsempfaengerUpdate
} from '../api/rechnungsempfaenger.service';

const ADMIN_KEY = ['rechnungsempfaenger', 'admin', 'all'] as const;

export function useRechnungsempfaengerAdmin() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ADMIN_KEY,
    queryFn: () => RechnungsempfaengerService.listAll(),
    staleTime: 60_000
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ADMIN_KEY });
    void qc.invalidateQueries({
      queryKey: referenceKeys.rechnungsempfaenger()
    });
  };

  const createM = useMutation({
    mutationFn: (row: Omit<RechnungsempfaengerInsert, 'company_id'>) =>
      RechnungsempfaengerService.create(row),
    onSuccess: invalidate
  });

  const updateM = useMutation({
    mutationFn: ({
      id,
      patch
    }: {
      id: string;
      patch: RechnungsempfaengerUpdate;
    }) => RechnungsempfaengerService.update(id, patch),
    onSuccess: invalidate
  });

  return {
    ...query,
    createRecipient: createM.mutateAsync,
    updateRecipient: updateM.mutateAsync,
    isCreating: createM.isPending,
    isUpdating: updateM.isPending
  };
}
