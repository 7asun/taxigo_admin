'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PassengerSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  totalCount: number;
  filteredCount: number;
  placeholder?: string;
  className?: string;
}

const DEBOUNCE_MS = 300;

export function PassengerSearchBar({
  value,
  onChange,
  totalCount,
  filteredCount,
  placeholder = 'Fahrgast suchen…',
  className
}: PassengerSearchBarProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local in sync when parent resets it (e.g. trip set reload)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setLocalValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onChange(next);
    }, DEBOUNCE_MS);
  };

  const handleClear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLocalValue('');
    onChange('');
  };

  const isActive = localValue.trim().length > 0;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <div className='relative min-w-0 flex-1'>
        <Search className='text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2' />
        <Input
          type='search'
          inputMode='search'
          className='h-9 pr-9 pl-9 text-sm'
          placeholder={placeholder}
          value={localValue}
          onChange={handleChange}
          aria-label='Fahrgast suchen'
        />
        {isActive && (
          <button
            type='button'
            className='text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors'
            onClick={handleClear}
            aria-label='Suche zurücksetzen'
          >
            <X className='h-4 w-4' />
          </button>
        )}
      </div>
      {/* why: badge uses localValue so count stays in sync with what the user
          sees typed, not the debounced parent value */}
      {isActive && (
        <Badge variant='secondary' className='h-6 shrink-0 tabular-nums'>
          {filteredCount} / {totalCount}
        </Badge>
      )}
    </div>
  );
}
