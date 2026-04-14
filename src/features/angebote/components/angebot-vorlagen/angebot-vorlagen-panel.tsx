'use client';

import { useMemo, useState } from 'react';
import { Star } from 'lucide-react';

import { PanelList } from '@/components/panels/panel-list';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { AngebotVorlageRow } from '@/features/angebote/types/angebot.types';

interface AngebotVorlagenPanelProps {
  items: AngebotVorlageRow[];
  loading?: boolean;
  selectedId: string | null;
  onSelect: (row: AngebotVorlageRow) => void;
  onNew: () => void;
  className?: string;
}

export function AngebotVorlagenPanel({
  items,
  loading = false,
  selectedId,
  onSelect,
  onNew,
  className
}: AngebotVorlagenPanelProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return items;
    return items.filter(
      (v) =>
        v.name.toLowerCase().includes(t) ||
        (v.description && v.description.toLowerCase().includes(t))
    );
  }, [items, search]);

  return (
    <PanelList<AngebotVorlageRow>
      className={cn('w-[300px] shrink-0', className)}
      items={filtered}
      loading={loading}
      selectedId={selectedId}
      onSelect={onSelect}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder='Vorlagen suchen…'
      emptyMessage='Keine Angebotsvorlagen'
      onNew={onNew}
      newLabel='Neue Vorlage'
      renderItem={(row, isSelected) => (
        <div
          className={cn(
            'flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm',
            isSelected && 'bg-muted/40'
          )}
        >
          <span className='flex w-full items-center gap-2 font-medium'>
            <span className='min-w-0 flex-1 truncate'>{row.name}</span>
            {row.is_default ? (
              <Badge
                variant='secondary'
                className='shrink-0 gap-0.5 px-1.5 py-0 text-[10px]'
              >
                <Star className='h-3 w-3' />
                Std.
              </Badge>
            ) : null}
          </span>
          {row.description ? (
            <span className='text-muted-foreground line-clamp-2 text-xs'>
              {row.description}
            </span>
          ) : null}
        </div>
      )}
    />
  );
}
