'use client';

/**
 * @deprecated This module is being retired as part of Approach B.
 * useUpdateCredentials and useUpdateStatus have been relocated to
 * src/features/driver-management/api/user-actions.service.ts
 * useUsers remains here for any remaining callers.
 */

import type { CompanyUser } from '@/features/user-management/types';
import { userKeys } from '@/query/keys';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

export {
  useUpdateCredentials,
  useUpdateStatus
} from '@/features/driver-management/api/user-actions.service';

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
