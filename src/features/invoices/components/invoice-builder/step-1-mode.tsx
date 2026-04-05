'use client';

/**
 * step-1-mode.tsx
 *
 * Invoice builder — Step 1: Mode selection.
 *
 * The user picks one of three billing modes:
 *   Monatlich    → monthly billing run for a payer
 *   Einzelfahrt  → one specific trip
 *   Fahrgast     → all trips for one client within a payer
 *
 * Design: three large clickable cards — prominent icon, title, and description.
 * The card UI is more intuitive than a radio button for this decision.
 */

import { Calendar, Car, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { InvoiceMode } from '../../types/invoice.types';

interface ModeCard {
  mode: InvoiceMode;
  icon: React.ElementType;
  title: string;
  description: string;
}

/** Visual card config for each billing mode. */
const MODES: ModeCard[] = [
  {
    mode: 'monthly',
    icon: Calendar,
    title: 'Monatliche Abrechnung',
    description:
      'Alle Fahrten eines Kostenträgers in einem Zeitraum (z. B. ganzer Monat). Häufigster Fall.'
  },
  {
    mode: 'single_trip',
    icon: Car,
    title: 'Einzelfahrt',
    description:
      'Rechnung für genau eine Fahrt — z. B. für Sofortabrechnung oder Nachberechnung.'
  },
  {
    mode: 'per_client',
    icon: User,
    title: 'Fahrgast',
    description:
      'Alle Fahrten eines bestimmten Fahrgastes bei einem Kostenträger in einem Zeitraum.'
  }
];

interface Step1ModeProps {
  /** Currently selected mode (highlighted card). */
  selectedMode: InvoiceMode | null;
  onSelect: (mode: InvoiceMode) => void;
}

/**
 * Step 1 of the invoice builder: mode selection via clickable cards.
 */
export function Step1Mode({ selectedMode, onSelect }: Step1ModeProps) {
  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-3'>
        {MODES.map(({ mode, icon: Icon, title, description }) => (
          <button
            key={mode}
            type='button'
            onClick={() => onSelect(mode)}
            className={cn(
              'bg-card border-border flex min-w-0 flex-row items-center gap-3 rounded-xl border p-3 text-left transition-all',
              'hover:bg-muted',
              selectedMode === mode
                ? 'border-primary bg-primary/5 ring-primary ring-1'
                : 'cursor-pointer'
            )}
          >
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                selectedMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              <Icon className='h-4 w-4' />
            </div>
            <div className='min-w-0'>
              <p className='text-xs leading-tight font-semibold'>{title}</p>
              <p className='text-muted-foreground mt-1 text-[11px] leading-snug'>
                {description}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
