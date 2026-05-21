'use client';

// Credential and status mutation hooks for company accounts.
// Relocated from user-management as part of Approach B (unified roster).
// These hooks remain coupled to userKeys and referenceKeys intentionally —
// userKeys.list() is the canonical company roster cache key.

import { referenceKeys, userKeys } from '@/query/keys';
import {
  useMutation,
  useQueryClient,
  type UseMutationResult
} from '@tanstack/react-query';
import { useRouter } from 'next/navigation';

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
  const router = useRouter();
  return useMutation({
    mutationFn: ({ id, body }) => patchCredentials(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.list() });
      router.refresh();
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
  const router = useRouter();
  return useMutation({
    mutationFn: ({ id, is_active }) => patchStatus(id, is_active),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: userKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: referenceKeys.drivers()
      });
      router.refresh();
    }
  });
}
