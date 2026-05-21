/**
 * Query keys for /dashboard/users (company-scoped user list via GET /api/users).
 */
export const userKeys = {
  root: ['users'] as const,
  list: () => [...userKeys.root, 'list'] as const
};
