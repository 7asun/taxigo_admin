'use client';

import { parseAsInteger, parseAsString, useQueryState } from 'nuqs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RosterRoleFilter } from '@/features/driver-management/types';

const SEGMENTS: { value: RosterRoleFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'driver', label: 'Fahrer' },
  { value: 'admin', label: 'Admins' }
];

export function RosterRoleFilter() {
  const [role, setRole] = useQueryState(
    'role',
    parseAsString.withDefault('all').withOptions({ shallow: false })
  );
  const [, setPage] = useQueryState(
    'page',
    parseAsInteger.withDefault(1).withOptions({ shallow: false })
  );

  const handleChange = (value: RosterRoleFilter) => {
    void setRole(value);
    void setPage(1);
  };

  return (
    <div className='flex items-center rounded-md border p-0.5'>
      {SEGMENTS.map((seg) => (
        <Button
          key={seg.value}
          type='button'
          variant='ghost'
          size='sm'
          className={cn('h-7 px-2.5 text-xs', role === seg.value && 'bg-muted')}
          onClick={() => handleChange(seg.value)}
          aria-pressed={role === seg.value}
        >
          {seg.label}
        </Button>
      ))}
    </div>
  );
}
