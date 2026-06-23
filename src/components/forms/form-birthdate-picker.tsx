'use client';

import * as React from 'react';
import {
  FieldPath,
  FieldValues,
  UseFormReturn,
  ControllerRenderProps
} from 'react-hook-form';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { BaseFormFieldProps } from '@/types/base-form';
import { cn } from '@/lib/utils';

/**
 * Parses German date strings in forms:
 * - DD.MM.YYYY (full date)
 * - DD.MM. (year unknown, maps to leap year 1904 as a sentinel)
 * - DDMMYYYY (no dots, full date)
 * - DDMM (no dots, year unknown, maps to leap year 1904 as a sentinel)
 * - YYYY-MM-DD (ISO date)
 */
function parseGermanBirthdateString(str: string): Date | null {
  const clean = str.trim();
  if (!clean) return null;

  // DD.MM.YYYY
  const dmyMatch = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    if (y < 1900 || y > new Date().getFullYear()) {
      return null;
    }
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
  }

  // DD.MM. (year unknown)
  const dmMatch = clean.match(/^(\d{1,2})\.(\d{1,2})\.?$/);
  if (dmMatch) {
    const d = parseInt(dmMatch[1], 10);
    const m = parseInt(dmMatch[2], 10);
    const y = 1904; // Sentinel leap year for unknown birth years
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
  }

  // DDMMYYYY
  const dmyNoDotMatch = clean.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (dmyNoDotMatch) {
    const d = parseInt(dmyNoDotMatch[1], 10);
    const m = parseInt(dmyNoDotMatch[2], 10);
    const y = parseInt(dmyNoDotMatch[3], 10);
    if (y < 1900 || y > new Date().getFullYear()) {
      return null;
    }
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
  }

  // DDMM (year unknown)
  const dmNoDotMatch = clean.match(/^(\d{2})(\d{2})$/);
  if (dmNoDotMatch) {
    const d = parseInt(dmNoDotMatch[1], 10);
    const m = parseInt(dmNoDotMatch[2], 10);
    const y = 1904; // Sentinel leap year for unknown birth years
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
  }

  // YYYY-MM-DD
  const ymdMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    const y = parseInt(ymdMatch[1], 10);
    const m = parseInt(ymdMatch[2], 10);
    const d = parseInt(ymdMatch[3], 10);
    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d
    ) {
      return date;
    }
  }

  return null;
}

/**
 * Format helper for input display:
 * - If year is 1904 (sentinel), shows DD.MM.
 * - Otherwise, shows DD.MM.YYYY
 */
function formatBirthdateForInput(date: Date | null | undefined): string {
  if (!date) return '';
  if (date.getFullYear() === 1904) {
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
  }
  return format(date, 'dd.MM.yyyy');
}

interface FormBirthdatePickerProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> extends Omit<BaseFormFieldProps<TFieldValues, TName>, 'control'> {
  form: UseFormReturn<TFieldValues>;
}

function BirthdateFieldControl<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({
  form,
  name,
  label,
  description,
  required,
  disabled,
  className,
  field
}: FormBirthdatePickerProps<TFieldValues, TName> & {
  field: ControllerRenderProps<TFieldValues, TName>;
}) {
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');

  React.useEffect(() => {
    if ((field.value as unknown) instanceof Date) {
      setInputValue(formatBirthdateForInput(field.value as Date));
    } else {
      setInputValue('');
    }
  }, [field.value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    const parsed = parseGermanBirthdateString(val);
    if (parsed) {
      field.onChange(parsed);
      form.clearErrors(name);
    } else if (val.trim() === '') {
      field.onChange(null);
      form.clearErrors(name);
    }
  };

  const handleBlur = () => {
    const val = inputValue.trim();
    if (val === '') {
      field.onChange(null);
      form.clearErrors(name);
      return;
    }
    const parsed = parseGermanBirthdateString(val);
    if (parsed) {
      field.onChange(parsed);
      setInputValue(formatBirthdateForInput(parsed));
      form.clearErrors(name);
    } else {
      form.setError(name, {
        type: 'manual',
        message: 'Ungültiges Datum (z. B. 15.05.1990 oder 15.05.)'
      });
    }
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    field.onChange(date || null);
    form.clearErrors(name);
    setPopoverOpen(false);
  };

  return (
    <FormItem className={cn('flex flex-col', className)}>
      {label && (
        <FormLabel>
          {label}
          {required && <span className='ml-1 text-red-500'>*</span>}
        </FormLabel>
      )}
      <div className='relative flex items-center'>
        <Input
          type='text'
          placeholder='TT.MM.JJJJ oder TT.MM.'
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleBlur}
          disabled={disabled}
          className='h-10 pr-10 md:h-9'
        />
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen} modal={false}>
          <PopoverTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              disabled={disabled}
              className='text-muted-foreground hover:text-foreground absolute top-0 right-0 h-full w-10 hover:bg-transparent'
            >
              <CalendarIcon className='h-4 w-4 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-auto p-0' align='end'>
            <Calendar
              mode='single'
              selected={(field.value as Date | null) || undefined}
              onSelect={handleCalendarSelect}
              captionLayout='dropdown'
              fromYear={1900}
              toYear={new Date().getFullYear()}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      {description && <FormDescription>{description}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}

export function FormBirthdatePicker<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({
  form,
  name,
  label,
  description,
  required,
  disabled,
  className
}: FormBirthdatePickerProps<TFieldValues, TName>) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <BirthdateFieldControl
          form={form}
          name={name}
          label={label}
          description={description}
          required={required}
          disabled={disabled}
          className={className}
          field={field}
        />
      )}
    />
  );
}
