'use client';

import { FieldPath, FieldValues } from 'react-hook-form';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { BaseFormFieldProps } from '@/types/base-form';

interface FormInputProps<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
> extends BaseFormFieldProps<TFieldValues, TName> {
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
  placeholder?: string;
  step?: string | number;
  min?: string | number;
  max?: string | number;
}

function FormInput<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>
>({
  control,
  name,
  label,
  description,
  required,
  type = 'text',
  placeholder,
  step,
  min,
  max,
  disabled,
  className
}: FormInputProps<TFieldValues, TName>) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          {label && (
            <FormLabel>
              {label}
              {required && <span className='ml-1 text-red-500'>*</span>}
            </FormLabel>
          )}
          <FormControl>
            <Input
              type={type}
              placeholder={placeholder}
              step={step}
              min={min}
              max={max}
              disabled={disabled}
              {...field}
              value={
                type === 'number'
                  ? field.value == null ||
                    (typeof field.value === 'number' &&
                      Number.isNaN(field.value))
                    ? ''
                    : field.value
                  : (field.value ?? '')
              }
              onChange={(e) => {
                if (type === 'number') {
                  const raw = e.target.value;
                  if (raw === '') {
                    field.onChange(null);
                    return;
                  }
                  const parsed = parseFloat(raw);
                  field.onChange(Number.isNaN(parsed) ? null : parsed);
                } else {
                  field.onChange(e.target.value);
                }
              }}
            />
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export { FormInput };
