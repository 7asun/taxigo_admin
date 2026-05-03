/**
 * TanStack Query key factory for letters — same rules as angebotKeys.
 */

export const letterKeys = {
  all: ['letters'] as const,
  list: () => [...letterKeys.all, 'list'] as const,
  detail: (id: string) => [...letterKeys.all, 'detail', id] as const
};
