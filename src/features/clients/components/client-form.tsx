'use client';

import { FormInput } from '@/components/forms/form-input';
import { FormSwitch } from '@/components/forms/form-switch';
import { FormTextarea } from '@/components/forms/form-textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Client, clientsService } from '@/features/clients/api/clients.service';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import {
  forwardRef,
  useImperativeHandle,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { RecurringRulesList } from './recurring-rules-list';
import {
  recurringRulesService,
  RecurringRuleWithBillingEmbed
} from '@/features/trips/api/recurring-rules.service';
import {
  AddressAutocomplete,
  type AddressResult
} from '@/features/trips/components/address-autocomplete';

const formSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company_name: z.string().optional(),
  street: z.string().min(1, { message: 'Straße ist erforderlich.' }),
  street_number: z.string().min(1, { message: 'Hausnummer ist erforderlich.' }),
  zip_code: z.string().min(1, { message: 'PLZ ist erforderlich.' }),
  city: z.string().min(1, { message: 'Stadt ist erforderlich.' }),
  phone: z.string().optional(),
  phone_secondary: z.string().optional(),
  email: z
    .string()
    .optional()
    .refine(
      (val) =>
        !val ||
        val.trim() === '' ||
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim()),
      { message: 'Ungültige E-Mail-Adresse.' }
    ),
  relation: z.string().optional(),
  greeting_style: z.string().optional(),
  notes: z.string().optional(),
  is_wheelchair: z.boolean(),
  // Price tag: Default price for all trips of this client.
  // Takes precedence over manually entered trip prices during invoicing.
  // Nullable: not all clients have fixed pricing.
  price_tag: z.number().min(0).nullable().default(null)
});

/** Imperative handle exposed via forwardRef — used by ClientDetailPanel */
export interface ClientFormHandle {
  /** Programmatically trigger form submission (equivalent to clicking the submit button) */
  submit: () => void;
  /** Sync Rollstuhl with the panel header switch (noCard / column view) */
  setWheelchair: (value: boolean) => void;
}

interface ClientFormProps {
  initialData: Client | null;
  pageTitle: string;
  /**
   * When provided, called with the saved Client instead of navigating to
   * /dashboard/clients. Used by ClientDetailPanel in the column view so the
   * panel can stay open and refresh its state after a successful save.
   */
  onSuccess?: (client: Client) => void;
  /**
   * When true, renders the form fields directly without the Card/CardHeader
   * wrapper and hides the internal submit button (the panel header provides it).
   */
  noCard?: boolean;
  /**
   * Called whenever form.formState.isDirty changes. Used by ClientDetailPanel
   * to enable/disable the header "Aktualisieren" button reactively.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className='flex items-center gap-2'>
      <span className='text-muted-foreground text-[11px] font-semibold tracking-[0.14em] uppercase'>
        {children}
      </span>
    </div>
  );
}

const ClientForm = forwardRef<ClientFormHandle, ClientFormProps>(
  function ClientForm(
    {
      initialData,
      pageTitle,
      onSuccess,
      noCard = false,
      onDirtyChange
    }: ClientFormProps,
    ref
  ) {
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const [rules, setRules] = useState<RecurringRuleWithBillingEmbed[]>([]);
    const [companyFieldVisible, setCompanyFieldVisible] = useState(
      () => !!initialData?.company_name?.trim()
    );

    const fetchRules = async () => {
      if (!initialData) return;
      try {
        const data = await recurringRulesService.getClientRules(initialData.id);
        setRules(data);
      } catch (error: any) {
        toast.error('Fehler beim Laden der Regelfahrten: ' + error.message);
      }
    };

    useEffect(() => {
      fetchRules();
    }, [initialData]);

    useEffect(() => {
      setCompanyFieldVisible(!!initialData?.company_name?.trim());
    }, [initialData?.id]);

    const defaultValues = {
      first_name: initialData?.first_name || '',
      last_name: initialData?.last_name || '',
      company_name: initialData?.company_name || '',
      street: initialData?.street || '',
      street_number: initialData?.street_number || '',
      zip_code: initialData?.zip_code || '',
      city: initialData?.city || '',
      phone: initialData?.phone || '',
      phone_secondary: initialData?.phone_secondary || '',
      email: initialData?.email || '',
      relation: initialData?.relation || '',
      greeting_style: initialData?.greeting_style || '',
      notes: initialData?.notes || '',
      is_wheelchair: initialData?.is_wheelchair ?? false,
      // Default price for all trips of this client. Takes precedence over trip.price.
      price_tag: initialData?.price_tag ?? null
    };

    const form = useForm<z.infer<typeof formSchema>>({
      resolver: zodResolver(formSchema),
      defaultValues
    });

    // Expose submit() + setWheelchair for panel header Rollstuhl switch
    useImperativeHandle(
      ref,
      () => ({
        submit: () => void form.handleSubmit(onSubmit)(),
        setWheelchair: (value: boolean) => {
          form.setValue('is_wheelchair', value, { shouldDirty: true });
        }
      }),
      [form]
    );

    // Notify parent when dirty state changes so the header button can react
    const isDirty = form.formState.isDirty;
    const onDirtyChangeRef = useRef(onDirtyChange);
    onDirtyChangeRef.current = onDirtyChange;
    useEffect(() => {
      onDirtyChangeRef.current?.(isDirty);
    }, [isDirty]);

    async function onSubmit(values: z.infer<typeof formSchema>) {
      try {
        setLoading(true);
        const isCompany =
          !!values.company_name && !values.first_name && !values.last_name;

        let companyIdStr: string = initialData?.company_id || '';
        if (!companyIdStr) {
          const { createClient } = await import('@/lib/supabase/client');
          const supabase = createClient();
          const {
            data: { user }
          } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase
              .from('accounts')
              .select('company_id')
              .eq('id', user.id)
              .single();
            companyIdStr =
              profile?.company_id || '00000000-0000-0000-0000-000000000000';
          } else {
            companyIdStr = '00000000-0000-0000-0000-000000000000';
          }
        }

        const emailTrimmed = values.email?.trim() ?? '';
        const phoneSecondaryTrimmed = values.phone_secondary?.trim() ?? '';

        const payload = {
          ...(values as any),
          is_company: isCompany,
          company_id: companyIdStr,
          email: emailTrimmed ? emailTrimmed : null,
          phone_secondary: phoneSecondaryTrimmed ? phoneSecondaryTrimmed : null,
          // Preserve existing lat/lng when editing; rely on AddressAutocomplete to have
          // populated them on the values object when a suggestion was selected.
          lat: (initialData as any)?.lat ?? (values as any).lat ?? null,
          lng: (initialData as any)?.lng ?? (values as any).lng ?? null
        };

        if (initialData) {
          const updated = await clientsService.updateClient(
            initialData.id,
            payload
          );
          toast.success('Fahrgast erfolgreich aktualisiert.');
          // Reset form with the saved values so isDirty → false and the header
          // button returns to its disabled state until the next change.
          form.reset(values);
          if (onSuccess) {
            onSuccess(updated);
            return;
          }
        } else {
          const created = await clientsService.createClient(payload);
          toast.success('Fahrgast erfolgreich erstellt.');
          form.reset(values);
          if (onSuccess) {
            onSuccess(created);
            return;
          }
        }
        // Default behaviour when used outside the column view: navigate back
        router.push('/dashboard/clients');
        router.refresh();
      } catch (error: any) {
        toast.error(error.message || 'Ein Fehler ist aufgetreten.');
      } finally {
        setLoading(false);
      }
    }

    const formFields = (
      <Form
        form={form}
        onSubmit={form.handleSubmit(onSubmit)}
        className='space-y-0'
      >
        <div
          className={cn('w-full space-y-10', !noCard && 'mx-auto max-w-3xl')}
        >
          {/* Kontakt */}
          <section className='space-y-5'>
            <SectionLabel>Kontakt</SectionLabel>
            <div className='grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4'>
              <FormInput
                control={form.control}
                name='greeting_style'
                label='Anrede'
                placeholder='z. B. Herr, Frau, Dr.'
              />
              <FormInput
                control={form.control}
                name='first_name'
                label='Vorname'
                placeholder='Vorname'
              />
              <FormInput
                control={form.control}
                name='last_name'
                label='Nachname'
                placeholder='Nachname'
              />
              <FormInput
                control={form.control}
                name='phone'
                label='Telefon'
                placeholder='Telefon'
                type='tel'
              />
            </div>

            <div className='grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2'>
              <FormInput
                control={form.control}
                name='email'
                label='E-Mail'
                placeholder='name@beispiel.de'
                type='email'
              />
              <FormInput
                control={form.control}
                name='phone_secondary'
                label='Telefon 2'
                placeholder='Optional — zweite Rufnummer.'
                type='tel'
              />
            </div>

            {companyFieldVisible ? (
              <div className='space-y-2'>
                <FormInput
                  control={form.control}
                  name='company_name'
                  label='Firma'
                  description='Nur bei geschäftlichem oder organisatorischem Bezug.'
                  placeholder='z. B. Klinik, Wohnheim, Firma'
                  className='max-w-xl'
                />
                <button
                  type='button'
                  className='text-muted-foreground hover:text-foreground text-xs underline-offset-4 transition-colors hover:underline'
                  onClick={() => {
                    form.setValue('company_name', '', { shouldDirty: true });
                    setCompanyFieldVisible(false);
                  }}
                >
                  Ausblenden
                </button>
              </div>
            ) : (
              <button
                type='button'
                className='text-muted-foreground hover:text-foreground -ml-0.5 text-left text-xs underline-offset-4 transition-colors hover:underline'
                onClick={() => setCompanyFieldVisible(true)}
              >
                Firma hinzufügen
              </button>
            )}
          </section>

          <Separator className='bg-border/80' />

          {/* Adresse */}
          <section className='space-y-5'>
            <SectionLabel>Adresse</SectionLabel>
            <div className='grid grid-cols-1 gap-x-5 gap-y-4 md:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_minmax(0,1fr)]'>
              <FormField
                control={form.control}
                name='street'
                render={({ field }) => (
                  <FormItem className='min-w-0 md:col-span-1'>
                    <FormLabel>
                      Straße<span className='ml-1 text-red-500'>*</span>
                    </FormLabel>
                    <FormControl>
                      <AddressAutocomplete
                        value={field.value}
                        onChange={(result: AddressResult | string) => {
                          if (typeof result === 'string') {
                            field.onChange(result);
                          } else {
                            if (!result.street) {
                              field.onChange(result.address);
                              return;
                            }
                            field.onChange(result.street || result.address);
                            form.setValue(
                              'street_number',
                              result.street_number || ''
                            );
                            form.setValue('zip_code', result.zip_code || '');
                            form.setValue('city', result.city || '');
                          }
                        }}
                        placeholder='Straße eingeben'
                        className='h-8 text-[11px]'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormInput
                control={form.control}
                name='street_number'
                label='Nr.'
                placeholder='Nr.'
                required
                className='min-w-0 md:w-full'
              />
              <FormField
                control={form.control}
                name='zip_code'
                render={({ field }) => (
                  <FormItem className='min-w-0 md:w-full'>
                    <FormLabel>
                      PLZ<span className='ml-1 text-red-500'>*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode='numeric'
                        maxLength={5}
                        autoComplete='postal-code'
                        placeholder='12345'
                        className='h-8 font-mono text-[11px] tracking-widest'
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormInput
                control={form.control}
                name='city'
                label='Stadt'
                placeholder='Stadt eingeben'
                required
                className='min-w-0'
              />
            </div>
          </section>

          <Separator className='bg-border/80' />

          <section className='space-y-4'>
            <SectionLabel>Weitere Angaben</SectionLabel>
            <FormInput
              control={form.control}
              name='relation'
              label='Beziehung'
              placeholder='z. B. Angehörige, Betreuer'
              className='max-w-md'
            />
            {/* Standardpreis: Default price for all trips of this client.
                Takes precedence over manually entered trip prices during invoicing.
                If set, all trips for this client will use this price automatically. */}
            <FormInput
              control={form.control}
              name='price_tag'
              label='Standardpreis (€)'
              type='number'
              step='0,01'
              min='0'
              placeholder='z. B. 25,00'
              description='Wird für Rechnungen verwendet. Fahrpreis bitte in Brutto.'
              className='max-w-xs'
            />
            <FormTextarea
              control={form.control}
              name='notes'
              label='Notizen'
              placeholder='Interne Hinweise, Besonderheiten am Einstieg …'
              config={{
                maxLength: 500,
                showCharCount: true,
                rows: 4
              }}
            />
          </section>

          <Separator className='bg-border/80' />

          <section className='space-y-4'>
            <SectionLabel>Einstellungen</SectionLabel>
            <div className='border-border/80 bg-muted/15 overflow-hidden rounded-xl border shadow-sm'>
              {!noCard && (
                <>
                  <FormSwitch
                    control={form.control}
                    name='is_wheelchair'
                    label='Rollstuhl'
                    description='Vorauswahl bei neuer Fahrt, wenn dieser Fahrgast verknüpft wird.'
                    className='rounded-none border-0 bg-transparent shadow-none'
                  />
                  <div className='bg-border/60 mx-4 h-px' />
                </>
              )}
            </div>
          </section>
        </div>

        {/* In noCard mode the panel header provides the submit button */}
        {!noCard && (
          <div className='mx-auto mt-10 max-w-3xl'>
            <Button
              type='submit'
              disabled={loading}
              size='lg'
              className='min-w-[10rem]'
            >
              {initialData ? 'Fahrgast aktualisieren' : 'Fahrgast hinzufügen'}
            </Button>
          </div>
        )}
      </Form>
    );

    // noCard=true: render bare form fields (column view — Panel provides the container)
    if (noCard) {
      return formFields;
    }

    // Default: wrap in Card with title header + recurring rules list below
    return (
      <>
        <Card className='border-border/60 mx-auto w-full max-w-4xl shadow-sm'>
          <CardHeader className='border-border/40 space-y-1 border-b px-6 pt-8 pb-6 sm:px-10'>
            <CardTitle className='text-foreground text-left text-xl font-semibold tracking-tight sm:text-2xl'>
              {pageTitle}
            </CardTitle>
            <p className='text-muted-foreground text-sm font-normal'>
              Stammdaten für Abholung, Fahrtenbuch und Suche.
            </p>
          </CardHeader>
          <CardContent className='px-6 py-8 sm:px-10 sm:pb-10'>
            {formFields}
          </CardContent>
        </Card>

        {initialData && (
          <div className='mt-8'>
            <RecurringRulesList
              clientId={initialData.id}
              rules={rules}
              onRulesChange={fetchRules}
            />
          </div>
        )}
      </>
    );
  }
);

export default ClientForm;
