'use client';

/**
 * company-settings-form.tsx
 *
 * The main settings form. Divided into clearly labeled sections
 * that can be extended in the future (e.g. notifications, team settings)
 * without touching existing code.
 *
 * Sections:
 *   1. Logo & Slogan           — branding top-left on PDF
 *   2. Rechtliche Angaben      — legal name, address, Telefon, Inhaber
 *   3. Steuerliche Angaben     — Steuernummer + USt-IdNr
 *   4. Bankverbindung          — IBAN, BIC, bank name
 *   5. Rechnungsstandards      — default payment days
 *
 * Design system:
 *   - shadcn/ui: Card, Form, Input, Button, Separator, Badge, Alert
 *   - Colors: theme tokens only (bg-card, bg-muted, text-muted-foreground, etc.)
 *   - No hardcoded palette values
 */

import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  Building2,
  CreditCard,
  BadgeCheck,
  FileText,
  ImageIcon,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Upload,
  X,
  MapPin,
  Phone,
  UserCircle,
  Quote,
  Mail,
  Globe
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@/components/ui/form';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

import {
  AddressAutocomplete,
  type AddressResult
} from '@/features/trips/components/address-autocomplete';
import { useCompanySettings } from '../hooks/use-company-settings';
import {
  companyProfileSchema,
  type CompanyProfileFormValues
} from '../types/company-settings.types';

// ---------------------------------------------------------------------------
// Section header — reusable labeled section divider
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
  description
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  return (
    <div className='flex items-start gap-3 pb-4'>
      <div className='bg-primary/10 text-primary mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg'>
        <Icon className='h-4 w-4' />
      </div>
      <div>
        <h3 className='text-sm font-semibold'>{title}</h3>
        <p className='text-muted-foreground text-xs'>{description}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Logo upload widget
// ---------------------------------------------------------------------------

function LogoUploadField({
  currentLogoUrl,
  companyId,
  onUpload,
  isUploading
}: {
  currentLogoUrl: string | null;
  companyId: string | null;
  onUpload: (args: { file: File; companyId: string }) => Promise<string>;
  isUploading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;

    // Basic client-side validation before uploading
    if (!file.type.startsWith('image/')) {
      toast.error('Bitte wählen Sie eine Bilddatei aus (PNG, JPG, SVG).');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo darf maximal 2 MB groß sein.');
      return;
    }

    try {
      await onUpload({ file, companyId });
      toast.success('Logo wurde hochgeladen.');
    } catch {
      toast.error('Logo konnte nicht hochgeladen werden.');
    }
  };

  return (
    <div className='flex items-center gap-4'>
      {/* Logo preview */}
      <div className='border-border bg-muted flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border'>
        {currentLogoUrl ? (
          <img
            src={currentLogoUrl}
            alt='Firmenlogo'
            className='h-full w-full object-contain p-1'
          />
        ) : (
          <ImageIcon className='text-muted-foreground h-8 w-8' />
        )}
      </div>

      <div className='space-y-2'>
        <p className='text-muted-foreground text-xs'>
          PNG, JPG oder SVG · max. 2 MB
          <br />
          Empfohlen: 200 × 200 px oder größer
        </p>
        <input
          ref={inputRef}
          type='file'
          accept='image/png,image/jpeg,image/svg+xml,image/webp'
          className='hidden'
          onChange={handleFileChange}
        />
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='gap-2'
          disabled={isUploading || !companyId}
          onClick={() => inputRef.current?.click()}
        >
          {isUploading ? (
            <Loader2 className='h-3.5 w-3.5 animate-spin' />
          ) : (
            <Upload className='h-3.5 w-3.5' />
          )}
          {isUploading ? 'Lädt hoch...' : 'Logo hochladen'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — shown while profile data is being fetched
// ---------------------------------------------------------------------------

function FormSkeleton() {
  return (
    <div className='space-y-6'>
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className='h-5 w-40' />
            <Skeleton className='h-3 w-64' />
          </CardHeader>
          <CardContent className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            {[1, 2, 3, 4].map((j) => (
              <div key={j} className='space-y-2'>
                <Skeleton className='h-3 w-24' />
                <Skeleton className='h-9 w-full' />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form component
// ---------------------------------------------------------------------------

export function CompanySettingsForm() {
  const {
    profile,
    isLoading,
    isError,
    saveProfile,
    isSaving,
    uploadLogo,
    isUploadingLogo
  } = useCompanySettings();

  // Track whether at least one tax ID is present (soft warning, not a hard error)
  const [showTaxWarning, setShowTaxWarning] = useState(false);

  // Controlled string value for AddressAutocomplete input field.
  // Keeps the display string separate from the structured RHF form state.
  const [addressQuery, setAddressQuery] = useState('');

  const form = useForm<CompanyProfileFormValues>({
    // zodResolver returns Resolver<Input, Output> which differs from RHF's Resolver<TFieldValues>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(companyProfileSchema) as any,
    defaultValues: {
      legal_name: '',
      street: '',
      street_number: '',
      zip_code: '',
      city: '',
      tax_id: null,
      vat_id: null,
      bank_name: null,
      bank_iban: null,
      bank_bic: null,
      logo_url: null,
      slogan: null,
      phone: null,
      inhaber: null,
      email: null,
      website: null,
      default_payment_days: 14
    }
  });

  // Populate form once the profile loads from the server
  useEffect(() => {
    if (!profile) return;
    const street = profile.street ?? '';
    const nr = profile.street_number ?? '';
    const zip = profile.zip_code ?? '';
    const city = profile.city ?? '';

    // Reconstruct the display string for the autocomplete input
    if (street) {
      setAddressQuery([street, nr, zip, city].filter(Boolean).join(' · '));
    }

    form.reset({
      legal_name: profile.legal_name ?? '',
      street,
      street_number: nr,
      zip_code: zip,
      city,
      tax_id: profile.tax_id ?? null,
      vat_id: profile.vat_id ?? null,
      bank_name: profile.bank_name ?? null,
      bank_iban: profile.bank_iban ?? null,
      bank_bic: profile.bank_bic ?? null,
      logo_url: profile.logo_url ?? null,
      slogan: profile.slogan ?? null,
      phone: profile.phone ?? null,
      inhaber: profile.inhaber ?? null,
      email: profile.email ?? null,
      website: profile.website ?? null,
      default_payment_days: profile.default_payment_days ?? 14
    });
  }, [profile, form]);

  /**
   * Called when the user selects a suggestion from AddressAutocomplete.
   * Auto-fills the 4 structured address fields in the RHF form.
   */
  const handleAddressSelect = (result: AddressResult) => {
    if (result.street)
      form.setValue('street', result.street, { shouldValidate: true });
    if (result.street_number)
      form.setValue('street_number', result.street_number, {
        shouldValidate: true
      });
    if (result.zip_code)
      form.setValue('zip_code', result.zip_code, { shouldValidate: true });
    if (result.city)
      form.setValue('city', result.city, { shouldValidate: true });

    // Update the display string to reflect the resolved address
    setAddressQuery(
      [result.street, result.street_number, result.zip_code, result.city]
        .filter(Boolean)
        .join(' · ')
    );
  };

  const onSubmit = async (values: CompanyProfileFormValues) => {
    // Soft check: warn if no tax ID is present before saving
    const hasTaxId = !!(values.tax_id?.trim() || values.vat_id?.trim());
    setShowTaxWarning(!hasTaxId);

    try {
      await saveProfile(values);
      toast.success('Unternehmenseinstellungen gespeichert.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
      toast.error('Fehler beim Speichern: ' + message);
    }
  };

  if (isLoading) return <FormSkeleton />;

  if (isError) {
    return (
      <Alert variant='destructive'>
        <X className='h-4 w-4' />
        <AlertDescription>
          Einstellungen konnten nicht geladen werden. Bitte Seite neu laden.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Form
      form={form}
      onSubmit={form.handleSubmit(onSubmit)}
      className='space-y-6'
    >
      {/* ── Tax ID warning ──────────────────────────────────────────────── */}
      {showTaxWarning && (
        <Alert>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>
            <strong>Hinweis:</strong> Für gültige Rechnungen (§14 UStG) wird
            mindestens eine <strong>Steuernummer</strong> oder{' '}
            <strong>USt-IdNr</strong> benötigt.
          </AlertDescription>
        </Alert>
      )}

      {/* ══════════════════════════════════════════════════════════════════
            Section 1 — Logo & Slogan (PDF links oben)
        ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className='pb-2'>
          <SectionHeader
            icon={ImageIcon}
            title='Logo & Slogan'
            description='Logo und Slogan erscheinen links oben auf der Rechnung. Die Absenderzeile über der Empfängeradresse setzt sich aus den Angaben unter „Rechtliche Angaben“ und Telefon zusammen.'
          />
        </CardHeader>
        <CardContent className='space-y-6'>
          <LogoUploadField
            currentLogoUrl={profile?.logo_url ?? null}
            companyId={profile?.company_id ?? null}
            onUpload={uploadLogo}
            isUploading={isUploadingLogo}
          />
          <FormField
            control={form.control}
            name='slogan'
            render={({ field }) => (
              <FormItem>
                <FormLabel className='flex items-center gap-1.5'>
                  <Quote className='text-muted-foreground h-3.5 w-3.5' />
                  Slogan (optional)
                </FormLabel>
                <FormControl>
                  <Textarea
                    placeholder='z. B. Zuverlässig. Pünktlich. Für Sie unterwegs.'
                    rows={2}
                    className='min-h-[72px] resize-y'
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormDescription>
                  Kurzer Text unter dem Logo (max. zwei Zeilen empfohlen).
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
            Section 2 — Rechtliche Angaben
        ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className='pb-2'>
          <SectionHeader
            icon={Building2}
            title='Rechtliche Angaben'
            description='Erscheinen in der Absenderzeile und im Rechnungskopf (§14 UStG).'
          />
        </CardHeader>
        <CardContent className='space-y-4'>
          {/* Legal name — full width */}
          <FormField
            control={form.control}
            name='legal_name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Firmenname (rechtlich){' '}
                  <span className='text-destructive'>*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder='z. B. Mustermann Taxibetrieb GmbH'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Vollständiger eingetragener Firmenname.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='phone'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='flex items-center gap-1.5'>
                    <Phone className='text-muted-foreground h-3.5 w-3.5' />
                    Telefon
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder='z. B. 0441 12345678'
                      type='tel'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormDescription>
                    Für die Absenderzeile auf der Rechnung.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='inhaber'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='flex items-center gap-1.5'>
                    <UserCircle className='text-muted-foreground h-3.5 w-3.5' />
                    Inhaber / Vertretung
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder='z. B. Max Mustermann (bei Einzelunternehmen)'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormDescription>
                    Optional, z. B. bei e. K. oder GmbH-Geschäftsführer.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='email'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='flex items-center gap-1.5'>
                    <Mail className='text-muted-foreground h-3.5 w-3.5' />
                    E-Mail
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder='info@beispiel.de'
                      type='email'
                      autoComplete='email'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormDescription>
                    Erscheint unter „Kontakt“ in der Rechnungsfußzeile.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='website'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='flex items-center gap-1.5'>
                    <Globe className='text-muted-foreground h-3.5 w-3.5' />
                    Webseite
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder='https://www.beispiel.de'
                      type='url'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormDescription>
                    Vollständige URL oder Domain — Fußzeile der Rechnung.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* ── Address autocomplete ────────────────────────────────────── */}
          {/*
              AddressAutocomplete (Google Places) auto-fills the 4 structured
              fields below. The individual inputs remain editable for corrections.
            */}
          <FormItem>
            <FormLabel className='flex items-center gap-1.5'>
              <MapPin className='text-muted-foreground h-3.5 w-3.5' />
              Adresse suchen
            </FormLabel>
            <FormControl>
              <AddressAutocomplete
                value={addressQuery}
                onChange={(result) => {
                  // Keep the typed string in sync
                  if (typeof result === 'string') {
                    setAddressQuery(result);
                  } else {
                    setAddressQuery(result.address ?? '');
                  }
                }}
                onSelectCallback={handleAddressSelect}
                placeholder='Straße, Hausnummer, PLZ, Ort suchen…'
                className='h-9 text-sm'
              />
            </FormControl>
            <FormDescription>
              Wählen Sie eine Adresse — die Felder unten werden automatisch
              ausgefüllt.
            </FormDescription>
          </FormItem>

          {/* ── Individual address fields (manual override) ─────────────── */}
          <div className='space-y-3 rounded-md border p-3'>
            <p className='text-muted-foreground text-xs font-medium'>
              Manuelle Eingabe / Korrektur
            </p>

            {/* Street + house number */}
            <div className='grid grid-cols-1 gap-3 md:grid-cols-12'>
              <div className='md:col-span-8'>
                <FormField
                  control={form.control}
                  name='street'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Straße <span className='text-destructive'>*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder='Musterstraße' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className='md:col-span-4'>
                <FormField
                  control={form.control}
                  name='street_number'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Nr. <span className='text-destructive'>*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder='12a' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            {/* PLZ + City */}
            <div className='grid grid-cols-1 gap-3 md:grid-cols-12'>
              <div className='md:col-span-4'>
                <FormField
                  control={form.control}
                  name='zip_code'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        PLZ <span className='text-destructive'>*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder='26122' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className='md:col-span-8'>
                <FormField
                  control={form.control}
                  name='city'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Stadt <span className='text-destructive'>*</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder='Oldenburg' {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
            Section 3 — Steuerliche Angaben
        ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className='pb-2'>
          <SectionHeader
            icon={BadgeCheck}
            title='Steuerliche Angaben'
            description='Steuernummer und/oder USt-IdNr. — beide werden auf Rechnungen ausgegeben.'
          />
        </CardHeader>
        <CardContent>
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='tax_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='flex items-center gap-2'>
                    Steuernummer
                    <Badge variant='secondary' className='text-xs font-normal'>
                      Finanzamt
                    </Badge>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder='123/456/78901'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormDescription>
                    Format variiert je nach Bundesland.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='vat_id'
              render={({ field }) => (
                <FormItem>
                  <FormLabel className='flex items-center gap-2'>
                    USt-IdNr.
                    <Badge variant='secondary' className='text-xs font-normal'>
                      EU
                    </Badge>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder='DE123456789'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormDescription>
                    DE + 9 Ziffern (z. B. DE123456789).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
            Section 4 — Bankverbindung
        ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className='pb-2'>
          <SectionHeader
            icon={CreditCard}
            title='Bankverbindung'
            description='Wird im Rechnungsfooter angezeigt, damit Kunden per Überweisung zahlen können.'
          />
        </CardHeader>
        <CardContent className='space-y-4'>
          <FormField
            control={form.control}
            name='bank_name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Bank</FormLabel>
                <FormControl>
                  <Input
                    placeholder='Sparkasse Oldenburg'
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <FormField
              control={form.control}
              name='bank_iban'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>IBAN</FormLabel>
                  <FormControl>
                    <Input
                      placeholder='DE89 3704 0044 0532 0130 00'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='bank_bic'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>BIC / SWIFT</FormLabel>
                  <FormControl>
                    <Input
                      className='uppercase'
                      placeholder='COBADEFFXXX'
                      {...field}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value || null)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════
            Section 5 — Rechnungsstandards
        ══════════════════════════════════════════════════════════════════ */}
      <Card>
        <CardHeader className='pb-2'>
          <SectionHeader
            icon={FileText}
            title='Rechnungsstandards'
            description='Standardwerte für neue Rechnungen — pro Rechnung überschreibbar.'
          />
        </CardHeader>
        <CardContent>
          <FormField
            control={form.control}
            name='default_payment_days'
            render={({ field }) => (
              <FormItem className='max-w-xs'>
                <FormLabel>Zahlungsziel (Tage)</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={1}
                    max={90}
                    {...field}
                    // Convert string input back to number for Zod
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormDescription>
                  Standard: 14 Tage · Erlaubt: 1–90 Tage
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </CardContent>
      </Card>

      {/* ── Save button ─────────────────────────────────────────────────── */}
      <div className='flex items-center justify-between'>
        {/* Completeness indicator */}
        {profile?.legal_name && profile?.tax_id ? (
          <p className='text-muted-foreground flex items-center gap-1.5 text-xs'>
            <CheckCircle2 className='h-3.5 w-3.5 text-green-500' />
            Bereit für Rechnungsstellung
          </p>
        ) : (
          <p className='text-muted-foreground text-xs'>
            Pflichtfelder mit <span className='text-destructive'>*</span>{' '}
            ausfüllen.
          </p>
        )}

        <Button type='submit' disabled={isSaving} className='gap-2'>
          {isSaving ? (
            <>
              <Loader2 className='h-4 w-4 animate-spin' />
              Speichern...
            </>
          ) : (
            'Einstellungen speichern'
          )}
        </Button>
      </div>
    </Form>
  );
}
