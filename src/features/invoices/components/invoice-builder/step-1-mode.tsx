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
  /** Called when the user confirms the selection and moves to step 2. */
  onNext: (mode: InvoiceMode) => void;
}

/**
 * Step 1 of the invoice builder: mode selection via clickable cards.
 */
export function Step1Mode({ selectedMode, onSelect, onNext }: Step1ModeProps) {
  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-lg font-semibold'>Abrechnungsart wählen</h2>
        <p className='text-muted-foreground text-sm'>
          Wie soll diese Rechnung strukturiert sein?
        </p>
      </div>

      {/* Mode selection cards */}
      <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
        {MODES.map(({ mode, icon: Icon, title, description }) => (
          <button
            key={mode}
            type='button'
            onClick={() => onSelect(mode)}
            className={cn(
              // Base card styles — uses only theme tokens
              'bg-card border-border flex flex-col items-start gap-3 rounded-xl border p-5 text-left transition-all',
              // Hover: subtle background shift
              'hover:bg-muted',
              // Selected: primary border + primary background tint
              selectedMode === mode
                ? 'border-primary bg-primary/5 ring-primary ring-1'
                : 'cursor-pointer'
            )}
          >
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-lg',
                selectedMode === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              <Icon className='h-5 w-5' />
            </div>
            <div>
              <p className='text-sm font-semibold'>{title}</p>
              <p className='text-muted-foreground mt-1 text-xs leading-relaxed'>
                {description}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Next button — only enabled when a mode is selected */}
      <div className='flex justify-end'>
        <button
          type='button'
          disabled={!selectedMode}
          onClick={() => selectedMode && onNext(selectedMode)}
          className={cn(
            'bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm font-medium transition-opacity',
            !selectedMode && 'cursor-not-allowed opacity-40'
          )}
        >
          Weiter
        </button>
      </div>
    </div>
  );
}
