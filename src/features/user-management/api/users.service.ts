'use client';

import type { CompanyUser } from '@/features/user-management/types';
import { referenceKeys, userKeys } from '@/query/keys';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';

async function fetchUsers(): Promise<CompanyUser[]> {
  const res = await fetch('/api/users', { credentials: 'same-origin' });
  const data = (await res.json()) as { error?: string } | CompanyUser[];
  if (!res.ok) {
    throw new Error(
      'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Benutzer konnten nicht geladen werden'
    );
  }
  return data as CompanyUser[];
}

export function useUsers(): UseQueryResult<CompanyUser[], Error> {
  return useQuery({
    queryKey: userKeys.list(),
    queryFn: fetchUsers
  });
}

type CredentialsPatch = { email?: string; password?: string };

async function patchCredentials(
  id: string,
  body: CredentialsPatch
): Promise<void> {
  const res = await fetch(`/api/users/${id}/credentials`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(
      data.error ?? 'Zugangsdaten konnten nicht aktualisiert werden'
    );
  }
}

export function useUpdateCredentials(): UseMutationResult<
  void,
  Error,
  { id: string; body: CredentialsPatch }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => patchCredentials(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.list() });
    }
  });
}

async function patchStatus(id: string, is_active: boolean): Promise<void> {
  const res = await fetch(`/api/users/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ is_active })
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? 'Status konnte nicht geändert werden');
  }
}

export function useUpdateStatus(): UseMutationResult<
  void,
  Error,
  { id: string; is_active: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_active }) => patchStatus(id, is_active),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: referenceKeys.drivers()
      });
    }
  });
}
