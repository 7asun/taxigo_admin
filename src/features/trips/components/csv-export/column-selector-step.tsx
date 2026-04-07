'use client';

import { useState, useMemo } from 'react';
import { ChevronRight, ChevronLeft, Check, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import {
  EXPORT_COLUMNS,
  COLUMN_CATEGORIES,
  CATEGORY_ORDER
} from './csv-export-constants';
import type { ExportStep } from '@/features/trips/types/csv-export.types';

interface ColumnSelectorStepProps {
  selectedColumns: string[];
  onColumnsChange: (columns: string[]) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Step 4: Column Selector
 *
 * Allows users to select which columns to include in the CSV export.
 * Columns are grouped by category for better organization.
 * All columns are unchecked by default (opt-in selection).
 * "Weiter" button navigates to preview step.
 */
export function ColumnSelectorStep({
  selectedColumns,
  onColumnsChange,
  onNext,
  onBack
}: ColumnSelectorStepProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(CATEGORY_ORDER)
  );

  // Group columns by category
  const groupedColumns = useMemo(() => {
    const groups: Record<string, typeof EXPORT_COLUMNS> = {};
    EXPORT_COLUMNS.forEach((col) => {
      if (!groups[col.category]) {
        groups[col.category] = [];
      }
      groups[col.category].push(col);
    });
    return groups;
  }, []);

  // Check if a category is fully selected
  const isCategoryFullySelected = (category: string): boolean => {
    const categoryCols = groupedColumns[category] || [];
    return categoryCols.every((col) => selectedColumns.includes(col.key));
  };

  // Check if a category is partially selected
  const isCategoryPartiallySelected = (category: string): boolean => {
    const categoryCols = groupedColumns[category] || [];
    const selectedCount = categoryCols.filter((col) =>
      selectedColumns.includes(col.key)
    ).length;
    return selectedCount > 0 && selectedCount < categoryCols.length;
  };

  // Toggle category expansion
  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Toggle all columns in a category
  const toggleCategorySelection = (category: string) => {
    const categoryCols = groupedColumns[category] || [];
    const categoryKeys = categoryCols.map((col) => col.key);

    if (isCategoryFullySelected(category)) {
      // Remove all from this category
      onColumnsChange(
        selectedColumns.filter((key) => !categoryKeys.includes(key))
      );
    } else {
      // Add all from this category
      const newColumns = new Set([...selectedColumns, ...categoryKeys]);
      onColumnsChange(Array.from(newColumns));
    }
  };

  // Toggle single column
  const toggleColumn = (key: string) => {
    if (selectedColumns.includes(key)) {
      onColumnsChange(selectedColumns.filter((k) => k !== key));
    } else {
      onColumnsChange([...selectedColumns, key]);
    }
  };

  // Select all columns
  const selectAll = () => {
    onColumnsChange(EXPORT_COLUMNS.map((col) => col.key));
  };

  // Deselect all columns
  const deselectAll = () => {
    onColumnsChange([]);
  };

  return (
    <div className='space-y-4'>
      {/* Header with actions */}
      <div className='flex items-center justify-between'>
        <div className='space-y-1'>
          <h3 className='text-sm font-medium'>Spalten auswählen</h3>
          <p className='text-muted-foreground text-xs'>
            {selectedColumns.length} von {EXPORT_COLUMNS.length} Spalten
            ausgewählt
          </p>
        </div>
        <div className='flex gap-2'>
          <Button type='button' variant='outline' size='sm' onClick={selectAll}>
            Alle
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={deselectAll}
            disabled={selectedColumns.length === 0}
          >
            Keine
          </Button>
        </div>
      </div>

      {/* Column categories */}
      <ScrollArea className='h-[320px] pr-4'>
        <div className='space-y-3'>
          {CATEGORY_ORDER.map((category) => {
            const columns = groupedColumns[category] || [];
            const isExpanded = expandedCategories.has(category);
            const isFullySelected = isCategoryFullySelected(category);
            const isPartiallySelected = isCategoryPartiallySelected(category);

            return (
              <div key={category} className='border-border rounded-lg border'>
                {/* Category header */}
                <div className='flex items-center gap-2 p-3'>
                  <Checkbox
                    id={`cat-${category}`}
                    checked={isFullySelected}
                    data-state={
                      isPartiallySelected ? 'indeterminate' : undefined
                    }
                    onCheckedChange={() => toggleCategorySelection(category)}
                  />
                  <button
                    type='button'
                    onClick={() => toggleCategory(category)}
                    className='flex flex-1 items-center gap-2 text-left'
                  >
                    <span className='flex-1 text-sm font-medium'>
                      {COLUMN_CATEGORIES[category]}
                    </span>
                    <span className='text-muted-foreground text-xs'>
                      {
                        columns.filter((col) =>
                          selectedColumns.includes(col.key)
                        ).length
                      }
                      /{columns.length}
                    </span>
                    {isExpanded ? (
                      <ChevronRight className='text-muted-foreground h-4 w-4 rotate-90 transition-transform' />
                    ) : (
                      <ChevronRight className='text-muted-foreground h-4 w-4 transition-transform' />
                    )}
                  </button>
                </div>

                {/* Category columns */}
                {isExpanded && (
                  <div className='border-t px-3 py-2'>
                    <div className='grid gap-2'>
                      {columns.map((col) => (
                        <div key={col.key} className='flex items-center gap-2'>
                          <Checkbox
                            id={`col-${col.key}`}
                            checked={selectedColumns.includes(col.key)}
                            onCheckedChange={() => toggleColumn(col.key)}
                          />
                          <Label
                            htmlFor={`col-${col.key}`}
                            className='text-muted-foreground flex-1 cursor-pointer text-xs font-normal'
                          >
                            {col.label}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Warning if no columns selected */}
      {selectedColumns.length === 0 && (
        <p className='text-destructive text-xs'>
          Bitte wählen Sie mindestens eine Spalte aus.
        </p>
      )}

      {/* Navigation buttons */}
      <div className='flex gap-2'>
        <Button
          type='button'
          variant='outline'
          className='flex-1'
          onClick={onBack}
        >
          <ChevronLeft className='mr-1 h-4 w-4' />
          Zurück
        </Button>
        <Button
          type='button'
          className='flex-1'
          onClick={onNext}
          disabled={selectedColumns.length === 0}
        >
          <span>Weiter</span>
          <ChevronRight className='ml-1 h-4 w-4' />
        </Button>
      </div>
    </div>
  );
}
