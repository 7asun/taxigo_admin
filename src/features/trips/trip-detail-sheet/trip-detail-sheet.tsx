'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent,
  type ReactNode
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClientAutoSuggest } from '@/components/ui/client-auto-suggest';
import { Switch } from '@/components/ui/switch';
import { DatePicker } from '@/components/ui/date-time-picker';
import {
  AddressAutocomplete,
  type AddressResult
} from '@/features/trips/components/trip-address-passenger';
import {
  usePayersQuery,
  useBillingVariantsForPayerQuery
} from '@/features/trips/hooks/use-trip-reference-queries';
import { useBillingUiForPayer } from '@/features/trips/hooks/use-billing-ui-for-payer';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import type { ClientOption } from '@/features/trips/hooks/use-trip-form-data';
import { useTripDetailSaveRefresh } from '@/features/trips/trip-detail-sheet/hooks/use-trip-detail-save-refresh';
import { applyTimeToScheduledDate } from '@/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled';
import {
  buildTripDetailsPatch,
  clientDisplayNameFromParts
} from '@/features/trips/trip-detail-sheet/lib/build-trip-details-patch';
import {
  buildPartnerSyncPatchFromDrafts,
  finalizePartnerPatchWithDrivingMetrics,
  shouldOfferPairedSyncForDetailsSave,
  shouldOfferPairedSyncForNotesOnlySave
} from '@/features/trips/trip-detail-sheet/lib/paired-trip-sync';
import { TripSheetTopCallouts } from '@/features/trips/trip-detail-sheet/components/trip-sheet-top-callouts';
import { RecurringTripEditScopeDialog } from '@/features/trips/trip-detail-sheet/dialogs/recurring-trip-edit-scope-dialog';
import { PairedTripSyncDialog } from '@/features/trips/trip-detail-sheet/dialogs/paired-trip-sync-dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter
} from '@/components/ui/sheet';
import * as VisuallyHidden from '@radix-ui/react-visually-hidden';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { useTripQuery } from '@/features/trips/hooks/use-trips';
import { useUpdateTripMutation } from '@/features/trips/hooks/use-update-trip-mutation';
import { useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Phone,
  User2,
  Briefcase,
  AlertCircle,
  AlertTriangle,
  CreditCard,
  Trash2,
  Share2,
  ArrowLeftRight,
  CalendarRange,
  Copy,
  PenLine,
  Layers,
  ChevronDown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import type { Trip, UpdateTrip } from '@/features/trips/api/trips.service';
import { useTripCancellation } from '@/features/trips/hooks/use-trip-cancellation';
import {
  hasPairedLeg,
  findPairedTrip
} from '@/features/trips/api/recurring-exceptions.actions';
import { RecurringTripCancelDialog } from '@/features/trips/components/recurring-trip-cancel-dialog';
import {
  copyTripToClipboard,
  stripAddressForShare
} from '@/features/trips/lib/share-utils';
import {
  getCancelledPartnerLabel,
  getTripDirection
} from '@/features/trips/lib/trip-direction';
import { shouldShowCreateReturnTripButton } from '@/features/trips/lib/can-create-linked-return';
import { CreateReturnTripDialog } from '@/features/trips/components/return-trip';
import { DuplicateTripsDialog } from '@/features/trips/components/trips-tables/duplicate-trips-dialog';
import {
  TripRescheduleDialog,
  canRescheduleTrip,
  getRescheduleDisabledReason
} from '@/features/trips/trip-reschedule';
import { tripsService } from '@/features/trips/api/trips.service';
import { getStatusWhenDriverChanges } from '@/features/trips/lib/trip-status';
import {
  tripStatusBadge,
  tripStatusLabels,
  type TripStatus
} from '@/lib/trip-status';
import {
  billingFamilyFromEmbed,
  formatBillingVariantOptionLabel
} from '@/features/trips/lib/format-billing-display-label';
import { normalizeBillingTypeBehavior } from '@/features/trips/lib/normalize-billing-type-behavior-profile';
import {
  resolveKtsDefault,
  type TripKtsSource
} from '@/features/trips/lib/resolve-kts-default';
import type { TripDirection } from '@/features/trips/lib/trip-direction';

/**
 * `POST /api/trips/duplicate` returns ids in insert order: for Hin+Rück, `[outboundId, returnId]`
 * (`executeDuplicateTrips`). Pick the id that corresponds to the leg the user had open.
 */
function pickNewTripIdAfterDuplicate(
  createdIds: string[],
  openedLegDirection: TripDirection
): string | undefined {
  if (createdIds.length === 0) return undefined;
  if (createdIds.length === 1) return createdIds[0];
  if (openedLegDirection === 'rueckfahrt') return createdIds[1];
  return createdIds[0];
}

interface TripDetailSheetProps {
  tripId: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Switch the sheet to another trip (e.g. linked Hinfahrt/Rückfahrt). */
  onNavigateToTrip?: (tripId: string) => void;
}

export function TripDetailSheet({
  tripId,
  isOpen,
  onOpenChange,
  onNavigateToTrip
}: TripDetailSheetProps) {
  const { trip, isLoading: isTripLoading } = useTripQuery(tripId);
  const queryClient = useQueryClient();
  const updateTripMutation = useUpdateTripMutation();
  const { refreshAfterTripSave } = useTripDetailSaveRefresh();
  const payersQuery = usePayersQuery();
  const payers = payersQuery.data ?? [];
  const [payerDraft, setPayerDraft] = useState<string>('');
  const billingVariantsQuery = useBillingVariantsForPayerQuery(
    payerDraft || undefined
  );
  const billingVariants = billingVariantsQuery.data ?? [];
  const [billingVariantDraft, setBillingVariantDraft] = useState<string>('');
  /** When the payer has multiple Abrechnungsfamilien, mirrors `billingFamilyId` in Neue Fahrt. */
  const [billingFamilyDraft, setBillingFamilyDraft] = useState<string>('');
  const [wheelchairDraft, setWheelchairDraft] = useState(false);
  const [clientIdDraft, setClientIdDraft] = useState<string | null>(null);
  const [clientFirstDraft, setClientFirstDraft] = useState('');
  const [clientLastDraft, setClientLastDraft] = useState('');
  const [clientPhoneDraft, setClientPhoneDraft] = useState('');
  const { searchClients, searchClientsById } = useTripFormData(payerDraft);
  const [pickupAddressDraft, setPickupAddressDraft] = useState('');
  const [pickupStationDraft, setPickupStationDraft] = useState('');
  const [dropoffAddressDraft, setDropoffAddressDraft] = useState('');
  const [dropoffStationDraft, setDropoffStationDraft] = useState('');
  /** `trips.billing_*` — Abrechnungs-Metadaten, not Fahrgast-Stationen. */
  const [billingCallingStationDraft, setBillingCallingStationDraft] =
    useState('');
  const [billingBetreuerDraft, setBillingBetreuerDraft] = useState('');
  const [ktsDocumentAppliesDraft, setKtsDocumentAppliesDraft] = useState(false);
  const [ktsCatalogHint, setKtsCatalogHint] = useState<string | null>(null);
  const ktsUserLockedRef = useRef(false);
  const [pickupRouteExpanded, setPickupRouteExpanded] = useState(false);
  const [dropoffRouteExpanded, setDropoffRouteExpanded] = useState(false);
  const [dateYmdDraft, setDateYmdDraft] = useState<string>('');
  const [recurringScopeOpen, setRecurringScopeOpen] = useState(false);
  /**
   * After recurring scope: optional “Nur diese Fahrt / Diese Fahrt + Gegenfahrt”
   * (`PairedTripSyncDialog`). Never stacked with recurring scope.
   */
  const [pairSyncOpen, setPairSyncOpen] = useState(false);
  const [pairSyncVariant, setPairSyncVariant] = useState<'details' | 'notes'>(
    'details'
  );
  const pendingDetailsPatchRef = useRef<Record<string, unknown> | null>(null);
  const pendingNotesTrimmedRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const lastPickupResolved = useRef<AddressResult | null>(null);
  const lastDropoffResolved = useRef<AddressResult | null>(null);
  const [groupTrips, setGroupTrips] = useState<any[]>([]);
  const [isLoadingGroup, setIsLoadingGroup] = useState(false);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [isUpdatingDriver, setIsUpdatingDriver] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [hasPair, setHasPair] = useState(false);
  const [linkedPartner, setLinkedPartner] = useState<Trip | null>(null);
  const [isCreateReturnOpen, setIsCreateReturnOpen] = useState(false);
  const [isRescheduleDialogOpen, setIsRescheduleDialogOpen] = useState(false);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  /** `HH:mm` for header time field; empty when the row has no `scheduled_at` yet (date-only). */
  const [timeDraft, setTimeDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const { cancelTrip, isLoading: isCancelling } = useTripCancellation();

  const billingUi = useBillingUiForPayer(
    payerDraft || undefined,
    billingVariants,
    billingFamilyDraft
  );
  const {
    families,
    effectiveFamilyId,
    variantsInEffectiveFamily,
    showFamilySelect,
    needVariantDropdown
  } = billingUi;

  const selectedBillingType = billingVariants.find(
    (b) => b.id === billingVariantDraft
  );

  const billingChangedFromTrip = useMemo(
    () =>
      !!trip &&
      (payerDraft !== (trip.payer_id ?? '') ||
        billingVariantDraft !== (trip.billing_variant_id ?? '')),
    [trip, payerDraft, billingVariantDraft]
  );

  useEffect(() => {
    if (ktsUserLockedRef.current) return;
    if (!billingChangedFromTrip) return;
    if (!payerDraft || !billingVariantDraft) {
      setKtsCatalogHint(null);
      return;
    }
    const payer = payers.find((p) => p.id === payerDraft);
    const variant = billingVariants.find((b) => b.id === billingVariantDraft);
    if (!payer || !variant) return;
    const r = resolveKtsDefault({
      payerKtsDefault: payer.kts_default,
      familyBehaviorProfile: variant.behavior_profile,
      variantKtsDefault: variant.kts_default
    });
    setKtsDocumentAppliesDraft(r.value);
    if (!r.value) {
      setKtsCatalogHint(null);
    } else if (r.source === 'variant') {
      setKtsCatalogHint(`Voreingestellt aus Unterart: ${variant.name}`);
    } else if (r.source === 'familie') {
      setKtsCatalogHint(
        `Voreingestellt aus Abrechnungsfamilie: ${variant.billing_type_name}`
      );
    } else if (r.source === 'payer') {
      setKtsCatalogHint(`Voreingestellt aus Kostenträger: ${payer.name}`);
    } else {
      setKtsCatalogHint(null);
    }
  }, [
    billingChangedFromTrip,
    payerDraft,
    billingVariantDraft,
    payers,
    billingVariants
  ]);

  /** Kostenträger billing extras: show when family asks, or row already has data, or user typed in session. */
  const showBillingMetadataHeader = useMemo(() => {
    if (!trip) return false;
    const { askCallingStationAndBetreuer } = normalizeBillingTypeBehavior(
      selectedBillingType?.behavior_profile
    );
    const stored = !!(
      trip.billing_calling_station?.trim() || trip.billing_betreuer?.trim()
    );
    const draft = !!(
      billingCallingStationDraft.trim() || billingBetreuerDraft.trim()
    );
    return askCallingStationAndBetreuer || stored || draft;
  }, [
    trip,
    selectedBillingType?.behavior_profile,
    billingCallingStationDraft,
    billingBetreuerDraft
  ]);

  const handleTripClientSelect = (client: ClientOption | null) => {
    if (client) {
      setClientIdDraft(client.id);
      setClientFirstDraft(client.first_name ?? '');
      setClientLastDraft(client.last_name ?? '');
      setClientPhoneDraft(client.phone ?? '');
      if (client.is_wheelchair !== undefined) {
        setWheelchairDraft(!!client.is_wheelchair);
      }
    } else {
      setClientIdDraft(null);
    }
  };

  const billingFamEmbed = trip
    ? billingFamilyFromEmbed(trip.billing_variant?.billing_types)
    : null;
  /** Sheet header stripe: draft pick wins so edits preview the correct Familienfarbe. */
  const billingAccentColor =
    selectedBillingType?.color ?? billingFamEmbed?.color;

  // Time draft: only treat as "live" while the sheet is open. Closing discards
  // unsaved edits by resetting from `trip.scheduled_at` (server / cache).
  useEffect(() => {
    if (!isOpen) {
      if (trip?.scheduled_at) {
        setTimeDraft(format(new Date(trip.scheduled_at), 'HH:mm'));
      } else {
        setTimeDraft('');
      }
      return;
    }
    if (!trip?.scheduled_at) {
      setTimeDraft('');
      return;
    }
    setTimeDraft(format(new Date(trip.scheduled_at), 'HH:mm'));
  }, [isOpen, trip?.id, trip?.scheduled_at]);

  useEffect(() => {
    if (!isOpen || !trip) {
      return;
    }
    setNotesDraft(trip.notes ?? '');
  }, [isOpen, trip?.id, trip?.notes]);

  useEffect(() => {
    if (!trip) return;
    setPayerDraft(trip.payer_id ?? '');
    setBillingVariantDraft(trip.billing_variant_id ?? '');
    const bv = trip.billing_variant as
      | { billing_type_id?: string }
      | null
      | undefined;
    setBillingFamilyDraft(bv?.billing_type_id ?? '');
    setWheelchairDraft(!!trip.is_wheelchair);
    const embed = trip.clients;
    if (
      embed &&
      typeof embed === 'object' &&
      !Array.isArray(embed) &&
      'id' in embed
    ) {
      const cl = embed as ClientOption;
      setClientIdDraft(trip.client_id ?? cl.id ?? null);
      setClientFirstDraft(cl.first_name ?? '');
      setClientLastDraft(cl.last_name ?? '');
    } else {
      setClientIdDraft(trip.client_id ?? null);
      const parts = (trip.client_name ?? '').trim().split(/\s+/);
      setClientFirstDraft(parts[0] ?? '');
      setClientLastDraft(parts.slice(1).join(' ') ?? '');
    }
    setClientPhoneDraft(trip.client_phone ?? '');
    setPickupAddressDraft(trip.pickup_address ?? '');
    setPickupStationDraft(trip.pickup_station ?? '');
    setDropoffAddressDraft(trip.dropoff_address ?? '');
    setDropoffStationDraft(trip.dropoff_station ?? '');
    setBillingCallingStationDraft(trip.billing_calling_station ?? '');
    setBillingBetreuerDraft(trip.billing_betreuer ?? '');
    setKtsDocumentAppliesDraft(!!trip.kts_document_applies);
    ktsUserLockedRef.current = false;
    setKtsCatalogHint(null);
    if (trip.scheduled_at) {
      setDateYmdDraft(format(new Date(trip.scheduled_at), 'yyyy-MM-dd'));
    } else if (trip.requested_date) {
      setDateYmdDraft(trip.requested_date);
    } else {
      setDateYmdDraft('');
    }
    lastPickupResolved.current = null;
    lastDropoffResolved.current = null;
    setPickupRouteExpanded(false);
    setDropoffRouteExpanded(false);
  }, [trip?.id]);

  // Align Abrechnungsfamilie with the selected Unterart (same as Neue Fahrt `payer-section`).
  useEffect(() => {
    if (!billingVariantDraft) return;
    const v = billingVariants.find((b) => b.id === billingVariantDraft);
    if (v) setBillingFamilyDraft(v.billing_type_id);
  }, [billingVariantDraft, billingVariants]);

  /**
   * Exactly one Unterart under the effective family → set `billing_variant_id` (FK must point
   * at a leaf row; no Unterart dropdown in this case — parity with create-trip).
   */
  const soleVariantId =
    variantsInEffectiveFamily.length === 1
      ? variantsInEffectiveFamily[0]?.id
      : undefined;

  useEffect(() => {
    if (!payerDraft || !effectiveFamilyId || !soleVariantId) return;
    setBillingVariantDraft(soleVariantId);
  }, [payerDraft, effectiveFamilyId, soleVariantId]);

  const handleBillingFamilyChange = useCallback(
    (familyId: string) => {
      setBillingFamilyDraft(familyId);
      const stillOk = billingVariants.some(
        (v) => v.id === billingVariantDraft && v.billing_type_id === familyId
      );
      if (!stillOk) setBillingVariantDraft('');
    },
    [billingVariants, billingVariantDraft]
  );

  useEffect(() => {
    if (!trip?.client_id || trip.clients) return;
    void searchClientsById(trip.client_id).then((c) => {
      if (!c) return;
      setClientFirstDraft(c.first_name ?? '');
      setClientLastDraft(c.last_name ?? '');
      setClientPhoneDraft((p) => p || c.phone || '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-hydrate when trip row changes; searchClientsById from hook
  }, [trip?.id, trip?.client_id, trip?.clients]);

  useEffect(() => {
    const fetchDrivers = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('role', 'driver')
        .order('name');
      setDrivers(data || []);
    };
    fetchDrivers();
  }, []);

  const runWithRecurringScope = (fn: () => Promise<void>) => {
    if (trip?.rule_id) {
      pendingSaveRef.current = fn;
      setRecurringScopeOpen(true);
    } else {
      void fn();
    }
  };

  const handleDriverChange = async (driverId: string) => {
    if (!trip) return;
    const exec = async () => {
      setIsUpdatingDriver(true);
      try {
        const newDriverId = driverId === 'unassigned' ? null : driverId;
        const payload: { driver_id: string | null; status?: string } = {
          driver_id: newDriverId
        };
        const derivedStatus = getStatusWhenDriverChanges(
          trip.status,
          newDriverId
        );
        if (derivedStatus) payload.status = derivedStatus;
        await tripsService.updateTrip(trip.id, payload);
        toast.success('Fahrer aktualisiert');
        void queryClient.invalidateQueries({
          queryKey: tripKeys.detail(trip.id)
        });
        await refreshAfterTripSave();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        toast.error(`Fehler beim Zuweisen des Fahrers: ${msg}`);
      } finally {
        setIsUpdatingDriver(false);
      }
    };
    runWithRecurringScope(exec);
  };

  useEffect(() => {
    const fetchGroup = async () => {
      if (trip?.group_id) {
        setIsLoadingGroup(true);
        const supabase = createClient();
        const { data } = await supabase
          .from('trips')
          .select('*')
          .eq('group_id', trip.group_id)
          .order('stop_order', { ascending: true, nullsFirst: false })
          .order('scheduled_at', { ascending: true });
        setGroupTrips(data || []);
        setIsLoadingGroup(false);
      } else {
        setGroupTrips([]);
      }
    };
    fetchGroup();
  }, [trip?.group_id, trip?.driver_id]);

  useEffect(() => {
    if (!trip) {
      setLinkedPartner(null);
      return;
    }
    findPairedTrip(trip as Trip).then((p) => setLinkedPartner(p ?? null));
  }, [trip?.id]);

  const isLoading = isTripLoading || isLoadingGroup;

  /** Legs sharing `group_id`, or a single-element array for a non-grouped trip. */
  const effectiveGroupTrips: Trip[] =
    trip && trip.group_id && groupTrips.length > 0
      ? (groupTrips as Trip[])
      : trip
        ? [trip as Trip]
        : [];

  const showCreateReturnButton = trip
    ? shouldShowCreateReturnTripButton(
        trip as Trip,
        !!linkedPartner,
        trip.billing_variant
      )
    : false;

  useEffect(() => {
    if (!showCreateReturnButton) setIsCreateReturnOpen(false);
  }, [showCreateReturnButton]);

  const handleOpenCancelDialog = async () => {
    if (!trip) return;
    setIsCancelDialogOpen(true);
    try {
      const pairExists = await hasPairedLeg(trip as Trip);
      setHasPair(pairExists);
    } catch {
      setHasPair(false);
    }
  };

  const getStatusInfo = (status: string) => {
    const s = status as TripStatus;
    return {
      label: (tripStatusLabels[s] ?? status).toUpperCase(),
      class: tripStatusBadge({ status: s })
    };
  };

  const tripLegDirection = trip ? getTripDirection(trip as Trip) : 'standalone';

  const normalizeNotes = (s: string) => s.trim();
  const notesDirty =
    isOpen &&
    !!trip &&
    normalizeNotes(notesDraft) !== normalizeNotes(trip.notes ?? '');

  /**
   * Persist notes on the open row; optionally the same `notes` value on the linked
   * leg when the user confirmed “Diese Fahrt + Gegenfahrt” in `PairedTripSyncDialog`.
   */
  const applyNotesSave = useCallback(
    async (trimmed: string, syncPartner: boolean) => {
      if (!trip) return;
      setPairSyncOpen(false);
      pendingNotesTrimmedRef.current = null;
      setIsSavingNotes(true);
      try {
        await updateTripMutation.mutateAsync({
          id: trip.id,
          patch: { notes: trimmed ? trimmed : null }
        });
        if (syncPartner && linkedPartner) {
          await updateTripMutation.mutateAsync({
            id: linkedPartner.id,
            patch: { notes: trimmed ? trimmed : null }
          });
          void queryClient.invalidateQueries({
            queryKey: tripKeys.detail(linkedPartner.id)
          });
        }
        toast.success(
          syncPartner && linkedPartner
            ? 'Notizen auf beiden Fahrten gespeichert'
            : 'Notizen gespeichert'
        );
        await refreshAfterTripSave();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Notizen konnten nicht gespeichert werden: ${message}`);
      } finally {
        setIsSavingNotes(false);
      }
    },
    [trip, linkedPartner, updateTripMutation, queryClient, refreshAfterTripSave]
  );

  /**
   * Applies the built details PATCH; if `syncPartner`, mirrors Stammdaten/Abrechnung,
   * notes (when merging), and the **full route** on the partner leg (same swap as new
   * returns: this leg’s dropoff drafts → partner pickup, pickup → partner dropoff),
   * then recomputes driving metrics when coords allow — second PATCH may fail after
   * the first succeeded; we surface the error without automatic rollback.
   */
  const applyDetailsPatch = useCallback(
    async (patch: Record<string, unknown>, syncPartner: boolean) => {
      if (!trip) return;
      setPairSyncOpen(false);
      pendingDetailsPatchRef.current = null;
      setIsSavingDetails(true);
      try {
        let currentPatch: Record<string, unknown> = { ...patch };
        if (syncPartner && notesDirty) {
          const n = normalizeNotes(notesDraft);
          currentPatch = { ...currentPatch, notes: n ? n : null };
        }
        await updateTripMutation.mutateAsync({
          id: trip.id,
          patch: currentPatch as UpdateTrip
        });
        if (syncPartner && linkedPartner) {
          const ktsRowP = billingVariants.find(
            (b) => b.id === billingVariantDraft
          );
          const ktsPayerRowP = payers.find((p) => p.id === payerDraft);
          const ktsResolvedP = resolveKtsDefault({
            payerKtsDefault: ktsPayerRowP?.kts_default,
            familyBehaviorProfile: ktsRowP?.behavior_profile,
            variantKtsDefault: ktsRowP?.kts_default
          });
          const ktsSourceP: TripKtsSource = ktsUserLockedRef.current
            ? 'manual'
            : ktsResolvedP.source;

          let partnerPatch = buildPartnerSyncPatchFromDrafts({
            trip,
            clientIdDraft,
            clientNameComposed: clientDisplayNameFromParts(
              clientFirstDraft,
              clientLastDraft
            ),
            clientPhoneDraft,
            wheelchairDraft,
            payerDraft,
            billingVariantDraft,
            notesDraft,
            pickupAddressDraft,
            dropoffAddressDraft,
            pickupStationDraft,
            dropoffStationDraft,
            billingCallingStationDraft,
            billingBetreuerDraft,
            ktsDocumentAppliesDraft,
            ktsSourceForSave: ktsSourceP,
            lastPickupResolved: lastPickupResolved.current,
            lastDropoffResolved: lastDropoffResolved.current
          });
          partnerPatch =
            await finalizePartnerPatchWithDrivingMetrics(partnerPatch);
          await updateTripMutation.mutateAsync({
            id: linkedPartner.id,
            patch: partnerPatch as UpdateTrip
          });
          void queryClient.invalidateQueries({
            queryKey: tripKeys.detail(linkedPartner.id)
          });
        }
        toast.success(
          syncPartner && linkedPartner
            ? 'Beide Fahrten aktualisiert'
            : 'Fahrt aktualisiert'
        );
        await refreshAfterTripSave();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Speichern fehlgeschlagen: ${message}`);
      } finally {
        setIsSavingDetails(false);
      }
    },
    [
      trip,
      linkedPartner,
      notesDirty,
      notesDraft,
      clientIdDraft,
      clientFirstDraft,
      clientLastDraft,
      clientPhoneDraft,
      wheelchairDraft,
      payerDraft,
      billingVariantDraft,
      pickupAddressDraft,
      dropoffAddressDraft,
      pickupStationDraft,
      dropoffStationDraft,
      billingCallingStationDraft,
      billingBetreuerDraft,
      lastPickupResolved,
      lastDropoffResolved,
      updateTripMutation,
      queryClient,
      refreshAfterTripSave
    ]
  );

  const handleSaveNotes = () => {
    if (!trip) return;
    const exec = async () => {
      const trimmed = normalizeNotes(notesDraft);
      if (shouldOfferPairedSyncForNotesOnlySave(notesDirty, !!linkedPartner)) {
        pendingNotesTrimmedRef.current = trimmed;
        setPairSyncVariant('notes');
        setPairSyncOpen(true);
        return;
      }
      await applyNotesSave(trimmed, false);
    };
    runWithRecurringScope(exec);
  };

  const currentDateYmd = trip?.scheduled_at
    ? format(new Date(trip.scheduled_at), 'yyyy-MM-dd')
    : (trip?.requested_date ?? '');

  /** Kostenträger/Route/… + Datum/Uhrzeit (inkl. reiner Uhrzeit-Änderung am gleichen Tag). */
  const detailsDirty =
    !!trip &&
    (payerDraft !== (trip.payer_id ?? '') ||
      billingVariantDraft !== (trip.billing_variant_id ?? '') ||
      wheelchairDraft !== !!trip.is_wheelchair ||
      (clientIdDraft ?? '') !== (trip.client_id ?? '') ||
      normalizeNotes(
        clientDisplayNameFromParts(clientFirstDraft, clientLastDraft)
      ) !== normalizeNotes(trip.client_name ?? '') ||
      normalizeNotes(clientPhoneDraft) !==
        normalizeNotes(trip.client_phone ?? '') ||
      normalizeNotes(pickupAddressDraft) !==
        normalizeNotes(trip.pickup_address ?? '') ||
      normalizeNotes(pickupStationDraft) !==
        normalizeNotes(trip.pickup_station ?? '') ||
      normalizeNotes(dropoffAddressDraft) !==
        normalizeNotes(trip.dropoff_address ?? '') ||
      normalizeNotes(dropoffStationDraft) !==
        normalizeNotes(trip.dropoff_station ?? '') ||
      normalizeNotes(billingCallingStationDraft) !==
        normalizeNotes(trip.billing_calling_station ?? '') ||
      normalizeNotes(billingBetreuerDraft) !==
        normalizeNotes(trip.billing_betreuer ?? '') ||
      ktsDocumentAppliesDraft !== !!trip.kts_document_applies ||
      dateYmdDraft !== currentDateYmd ||
      (!!trip &&
        !trip.scheduled_at &&
        !!trip.requested_date &&
        !!timeDraft.trim()) ||
      (!!trip.scheduled_at &&
        !!timeDraft.trim() &&
        (() => {
          const next = applyTimeToScheduledDate(trip.scheduled_at!, timeDraft);
          return (
            next.toISOString() !== new Date(trip.scheduled_at!).toISOString()
          );
        })()));

  const handleSaveTripDetails = () => {
    if (!trip) return;
    const exec = async () => {
      const ktsRow = billingVariants.find((b) => b.id === billingVariantDraft);
      const ktsPayerRow = payers.find((p) => p.id === payerDraft);
      const ktsResolvedSave = resolveKtsDefault({
        payerKtsDefault: ktsPayerRow?.kts_default,
        familyBehaviorProfile: ktsRow?.behavior_profile,
        variantKtsDefault: ktsRow?.kts_default
      });
      const ktsSourceForSave: TripKtsSource = ktsUserLockedRef.current
        ? 'manual'
        : ktsResolvedSave.source;

      const built = await buildTripDetailsPatch({
        trip,
        payerDraft,
        billingVariantDraft,
        wheelchairDraft,
        clientIdDraft,
        clientFirstDraft,
        clientLastDraft,
        clientPhoneDraft,
        pickupAddressDraft,
        pickupStationDraft,
        dropoffAddressDraft,
        dropoffStationDraft,
        dateYmdDraft,
        currentDateYmd,
        timeDraft,
        lastPickupResolved: lastPickupResolved.current,
        lastDropoffResolved: lastDropoffResolved.current,
        billingCallingStationDraft,
        billingBetreuerDraft,
        ktsDocumentAppliesDraft,
        ktsSourceForSave
      });
      if (built.isEmpty) {
        toast.info('Keine Änderungen zum Speichern.');
        return;
      }
      // Paired dialog: only after recurring scope (if any). Offer when PATCH touches
      // PAIRED_SYNC_COLUMN_KEYS or notes are dirty (see paired-trip-sync.ts).
      if (
        linkedPartner &&
        shouldOfferPairedSyncForDetailsSave(built.patch, notesDirty)
      ) {
        pendingDetailsPatchRef.current = built.patch;
        setPairSyncVariant('details');
        setPairSyncOpen(true);
        return;
      }
      await applyDetailsPatch(built.patch, false);
    };
    runWithRecurringScope(exec);
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent className='flex w-full flex-col border-l p-0 sm:max-w-xl'>
        {/* Accessibility: Always provide a title */}
        <VisuallyHidden.Root>
          <SheetTitle>Fahrt Details {tripId}</SheetTitle>
        </VisuallyHidden.Root>

        {isLoading ? (
          <div className='space-y-6 p-6'>
            <Skeleton className='h-8 w-3/4' />
            <Skeleton className='h-4 w-1/2' />
            <Separator />
            <div className='space-y-4'>
              <Skeleton className='h-24 w-full rounded-xl' />
              <Skeleton className='h-24 w-full rounded-xl' />
              <Skeleton className='h-24 w-full rounded-xl' />
            </div>
          </div>
        ) : trip ? (
          <>
            <div
              className='relative overflow-hidden border-b p-6 pb-4'
              style={{
                backgroundColor: billingAccentColor
                  ? `color-mix(in srgb, ${billingAccentColor}, var(--background) 90%)`
                  : 'transparent',
                borderBottomColor: billingAccentColor || '#e2e8f0'
              }}
            >
              <div
                className='absolute inset-y-0 left-0 w-1.5'
                style={{
                  backgroundColor: billingAccentColor ?? undefined
                }}
              />
              <div className='mb-2 flex flex-wrap items-center gap-2'>
                <Badge className={getStatusInfo(trip.status).class}>
                  {getStatusInfo(trip.status).label}
                </Badge>
                {tripLegDirection !== 'standalone' && (
                  <Badge
                    variant='outline'
                    className='border-border bg-background/60 text-[10px] font-semibold shadow-none'
                  >
                    {tripLegDirection === 'rueckfahrt'
                      ? 'Rückfahrt'
                      : 'Hinfahrt'}
                  </Badge>
                )}
                {trip.ingestion_source === 'trip_duplicate' && (
                  <Badge
                    variant='secondary'
                    className='border-border/60 text-[10px] font-semibold shadow-none'
                  >
                    Kopie
                  </Badge>
                )}
                {linkedPartner?.status === 'cancelled' && (
                  <Badge
                    variant='destructive'
                    className='gap-1 px-2 py-0.5 text-[10px] font-bold'
                  >
                    <AlertTriangle className='h-3 w-3' />
                    {/* We pass the CURRENT trip (not the cancelled partner) so
                        getCancelledPartnerLabel can return the partner's label. */}
                    {getCancelledPartnerLabel(trip as Trip)}
                  </Badge>
                )}
              </div>
              <SheetHeader className='space-y-1 pl-3 text-left'>
                <div className='flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2'>
                  <SheetTitle className='min-w-0 flex-1 text-2xl font-bold tracking-tight'>
                    {clientDisplayNameFromParts(
                      clientFirstDraft,
                      clientLastDraft
                    ) ||
                      trip.client_name ||
                      'Unbekannter Kunde'}
                  </SheetTitle>
                  <div className='flex shrink-0 items-center gap-2'>
                    <span className='text-muted-foreground text-sm font-medium'>
                      Rollstuhl
                    </span>
                    <Switch
                      checked={wheelchairDraft}
                      onCheckedChange={setWheelchairDraft}
                      disabled={!isOpen}
                      aria-label='Rollstuhl'
                    />
                  </div>
                </div>
                <div className='flex w-full min-w-0 items-center gap-2'>
                  <div className='text-foreground flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden font-medium'>
                    {trip.scheduled_at || trip.requested_date ? (
                      <>
                        <DatePicker
                          value={dateYmdDraft}
                          onChange={setDateYmdDraft}
                          disabled={!isOpen || isSavingDetails}
                          id='trip-detail-sheet-date'
                          triggerClassName='h-8 min-h-8 w-auto max-w-[11rem] shrink-0 px-2 text-xs font-medium'
                        />
                        <>
                          <span
                            className='text-muted-foreground shrink-0'
                            aria-hidden
                          >
                            ·
                          </span>
                          <span
                            className={cn(
                              'border-border/80 inline-grid h-8 min-w-[4.5rem] shrink-0 place-items-center rounded-md border align-middle',
                              'bg-muted/80 hover:bg-muted transition-colors',
                              (isSavingDetails || !isOpen) &&
                                'pointer-events-none opacity-70'
                            )}
                          >
                            <input
                              type='time'
                              step={60}
                              value={timeDraft}
                              onChange={(e) => setTimeDraft(e.target.value)}
                              disabled={isSavingDetails || !isOpen}
                              title='Zeit bearbeiten'
                              aria-label='Geplante Uhrzeit bearbeiten'
                              className={cn(
                                'h-8 w-full min-w-[4.5rem] cursor-text rounded-md border-0 bg-transparent px-1.5',
                                'text-foreground text-center text-xs font-semibold outline-none',
                                '[&::-webkit-calendar-picker-indicator]:hidden',
                                '[&::-webkit-datetime-edit]:m-0 [&::-webkit-datetime-edit]:flex [&::-webkit-datetime-edit]:h-full [&::-webkit-datetime-edit]:w-full [&::-webkit-datetime-edit]:items-center [&::-webkit-datetime-edit]:justify-center',
                                '[&::-webkit-datetime-edit-fields-wrapper]:flex [&::-webkit-datetime-edit-fields-wrapper]:justify-center',
                                '[&::-moz-calendar-picker-indicator]:hidden',
                                'focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2'
                              )}
                            />
                          </span>
                        </>
                      </>
                    ) : (
                      <span className='text-muted-foreground text-sm'>
                        Kein Datum / keine Zeit
                      </span>
                    )}
                  </div>
                  <Button
                    type='button'
                    variant='default'
                    size='sm'
                    className='h-8 shrink-0 gap-1.5 px-2 sm:px-3'
                    title='Details in die Zwischenablage kopieren'
                    aria-label='Teilen: Details kopieren'
                    onClick={async () => {
                      const success = await copyTripToClipboard(trip as Trip);
                      if (success) {
                        toast.success('Details kopiert');
                      } else {
                        toast.error('Fehler beim Kopieren');
                      }
                    }}
                  >
                    <Share2 className='h-4 w-4 shrink-0' />
                    <span className='hidden text-xs font-medium sm:inline'>
                      Teilen
                    </span>
                  </Button>
                </div>
                {showBillingMetadataHeader && (
                  <div className='border-border/60 mt-2 flex w-full max-w-full flex-row gap-2 border-t pt-2 sm:gap-3'>
                    <div className='min-w-0 flex-1 space-y-1'>
                      <Label
                        htmlFor='trip-detail-billing-calling-station'
                        className='text-muted-foreground text-[11px] font-medium'
                      >
                        Anrufstation
                      </Label>
                      <Input
                        id='trip-detail-billing-calling-station'
                        value={billingCallingStationDraft}
                        onChange={(e) =>
                          setBillingCallingStationDraft(e.target.value)
                        }
                        disabled={!isOpen}
                        placeholder='optional'
                        autoComplete='off'
                        className='h-8 text-xs'
                      />
                    </div>
                    <div className='min-w-0 flex-1 space-y-1'>
                      <Label
                        htmlFor='trip-detail-billing-betreuer'
                        className='text-muted-foreground text-[11px] font-medium'
                      >
                        Betreuer
                      </Label>
                      <Input
                        id='trip-detail-billing-betreuer'
                        value={billingBetreuerDraft}
                        onChange={(e) =>
                          setBillingBetreuerDraft(e.target.value)
                        }
                        disabled={!isOpen}
                        placeholder='optional'
                        autoComplete='off'
                        className='h-8 text-xs'
                      />
                    </div>
                  </div>
                )}
              </SheetHeader>
            </div>

            <div className='min-h-0 flex-1 overflow-y-auto px-6'>
              <div className='space-y-8 py-6 pb-20'>
                <TripSheetTopCallouts
                  trip={trip as Trip}
                  linkedPartner={linkedPartner}
                  groupTrips={(groupTrips as Trip[]) || []}
                  partnerStatusClass={
                    linkedPartner
                      ? getStatusInfo(linkedPartner.status).class
                      : ''
                  }
                  partnerStatusLabel={
                    linkedPartner
                      ? getStatusInfo(linkedPartner.status).label
                      : ''
                  }
                  onNavigateToTrip={onNavigateToTrip}
                />

                {/* Timeline / Stops */}
                <section>
                  <div className='mb-6 flex items-center justify-between'>
                    <h3 className='text-muted-foreground text-xs font-bold tracking-widest uppercase'>
                      Route & Verlauf
                    </h3>
                    <Badge
                      variant='outline'
                      className='h-5 px-2 py-0 text-[10px] font-semibold'
                    >
                      {trip.driving_distance_km
                        ? `${trip.driving_distance_km} km`
                        : 'Geplant'}
                    </Badge>
                  </div>

                  <div className='relative ml-3 space-y-0'>
                    {/* Vertical Line Connector */}
                    <div className='bg-border absolute top-4 bottom-4 left-[11px] w-[2px]' />

                    {(() => {
                      const tripsToMap =
                        groupTrips.length > 0 ? groupTrips : [trip];
                      const tripPickupKey = `${trip.pickup_address ?? ''}-${trip.pickup_station || ''}`;
                      const tripDropoffKey = `${trip.dropoff_address ?? ''}-${trip.dropoff_station || ''}`;

                      const pickups: any[] = [];
                      const pickupAddresses = new Set<string>();
                      tripsToMap.forEach((t) => {
                        if (!t.pickup_address) return;
                        const key = `${t.pickup_address}-${t.pickup_station || ''}`;
                        if (!pickupAddresses.has(key)) {
                          pickups.push({
                            address: t.pickup_address,
                            station: t.pickup_station,
                            name: t.client_name,
                            passengerStation: t.pickup_station,
                            time: t.actual_pickup_at,
                            update: t.stop_updates?.[t.pickup_address]
                          });
                          pickupAddresses.add(key);
                        } else {
                          const p = pickups.find(
                            (x) => x.address === t.pickup_address
                          );
                          if (p && t.client_name) {
                            if (!p.name?.includes(t.client_name)) {
                              p.name = p.name
                                ? `${p.name}, ${t.client_name}`
                                : t.client_name;
                            }
                          }
                        }
                      });

                      const dropoffs: any[] = [];
                      const dropoffAddresses = new Set<string>();
                      tripsToMap.forEach((t) => {
                        if (!t.dropoff_address) return;
                        const key = `${t.dropoff_address}-${t.dropoff_station || ''}`;
                        if (!dropoffAddresses.has(key)) {
                          dropoffs.push({
                            address: t.dropoff_address,
                            station: t.dropoff_station,
                            name: t.client_name,
                            passengerStation: t.dropoff_station,
                            time: t.actual_dropoff_at,
                            update: t.stop_updates?.[t.dropoff_address]
                          });
                          dropoffAddresses.add(key);
                        } else {
                          const d = dropoffs.find(
                            (x) => x.address === t.dropoff_address
                          );
                          if (d && t.client_name) {
                            if (!d.name?.includes(t.client_name)) {
                              d.name = d.name
                                ? `${d.name}, ${t.client_name}`
                                : t.client_name;
                            }
                          }
                        }
                      });

                      return (
                        <>
                          {pickups.map((p, i) => {
                            const rowKey = `${p.address ?? ''}-${p.station || ''}`;
                            const showRouteEdit =
                              !!trip.pickup_address && rowKey === tripPickupKey;
                            return (
                              <TimelineItem
                                key={`pickup-${i}`}
                                stopLabel={`A${i + 1}`}
                                title={
                                  i === 0
                                    ? 'Start / Abholung'
                                    : `Abholung ${i + 1}`
                                }
                                address={p.address}
                                name={p.name}
                                passengerStation={p.passengerStation}
                                time={p.time}
                                station={p.station}
                                update={p.update}
                                isCompleted={!!p.time}
                                showRouteEdit={showRouteEdit}
                                stationEditable={showRouteEdit}
                                stationValue={pickupStationDraft}
                                onStationChange={setPickupStationDraft}
                                routeEditOpen={
                                  showRouteEdit && pickupRouteExpanded
                                }
                                onToggleRouteEdit={() => {
                                  setPickupRouteExpanded((o) => !o);
                                  setDropoffRouteExpanded(false);
                                }}
                                routeEditTitle='Abholung bearbeiten'
                                routeEditSlot={
                                  showRouteEdit ? (
                                    <div className='space-y-2'>
                                      <AddressAutocomplete
                                        value={pickupAddressDraft}
                                        onChange={(
                                          result: AddressResult | string
                                        ) => {
                                          if (typeof result === 'string') {
                                            setPickupAddressDraft(result);
                                            return;
                                          }
                                          lastPickupResolved.current = result;
                                          setPickupAddressDraft(
                                            result.address || ''
                                          );
                                        }}
                                        className='text-sm'
                                      />
                                    </div>
                                  ) : undefined
                                }
                              />
                            );
                          })}

                          {dropoffs.map((d, i) => {
                            const rowKey = `${d.address ?? ''}-${d.station || ''}`;
                            const showRouteEdit =
                              !!trip.dropoff_address &&
                              rowKey === tripDropoffKey;
                            return (
                              <TimelineItem
                                key={`dropoff-${i}`}
                                stopLabel={`Z${i + 1}`}
                                title={
                                  i === dropoffs.length - 1
                                    ? 'Ziel / Ankunft'
                                    : `Ausstieg ${i + 1}`
                                }
                                address={d.address}
                                name={d.name}
                                passengerStation={d.passengerStation}
                                time={d.time}
                                station={d.station}
                                update={d.update}
                                isCompleted={!!d.time}
                                isLast={i === dropoffs.length - 1}
                                showRouteEdit={showRouteEdit}
                                stationEditable={showRouteEdit}
                                stationValue={dropoffStationDraft}
                                onStationChange={setDropoffStationDraft}
                                routeEditOpen={
                                  showRouteEdit && dropoffRouteExpanded
                                }
                                onToggleRouteEdit={() => {
                                  setDropoffRouteExpanded((o) => !o);
                                  setPickupRouteExpanded(false);
                                }}
                                routeEditTitle='Ziel bearbeiten'
                                routeEditSlot={
                                  showRouteEdit ? (
                                    <div className='space-y-2'>
                                      <AddressAutocomplete
                                        value={dropoffAddressDraft}
                                        onChange={(
                                          result: AddressResult | string
                                        ) => {
                                          if (typeof result === 'string') {
                                            setDropoffAddressDraft(result);
                                            return;
                                          }
                                          lastDropoffResolved.current = result;
                                          setDropoffAddressDraft(
                                            result.address || ''
                                          );
                                        }}
                                        className='text-sm'
                                      />
                                    </div>
                                  ) : undefined
                                }
                              />
                            );
                          })}
                        </>
                      );
                    })()}
                  </div>
                </section>

                <Separator />

                {/* Same compact grid as original sheet; controls replace static values */}
                <section className='grid grid-cols-2 gap-x-8 gap-y-6 px-1'>
                  <DetailItem
                    icon={<User2 className='h-3.5 w-3.5' />}
                    label='Fahrer'
                    className='col-span-2'
                  >
                    <Select
                      value={trip.driver_id || 'unassigned'}
                      onValueChange={handleDriverChange}
                      disabled={isUpdatingDriver}
                    >
                      <SelectTrigger className='border-border h-8 text-xs font-semibold'>
                        <SelectValue placeholder='Fahrer auswählen' />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem
                          value='unassigned'
                          className='text-muted-foreground text-xs italic'
                        >
                          Nicht zugewiesen
                        </SelectItem>
                        {drivers.map((d) => (
                          <SelectItem
                            key={d.id}
                            value={d.id}
                            className='text-xs font-medium'
                          >
                            {d.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </DetailItem>
                  <div className='col-span-2 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2'>
                    <div className='min-w-[8rem] flex-1 space-y-1'>
                      <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                        <Briefcase className='h-3.5 w-3.5 shrink-0' />
                        Kostenträger
                      </div>
                      <Select
                        value={payerDraft}
                        onValueChange={(v) => {
                          setPayerDraft(v);
                          setBillingVariantDraft('');
                          setBillingFamilyDraft('');
                        }}
                      >
                        <SelectTrigger className='border-border h-8 w-full min-w-0 text-xs font-semibold'>
                          <SelectValue placeholder='Kostenträger wählen' />
                        </SelectTrigger>
                        <SelectContent>
                          {payers.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {payerDraft &&
                      billingVariants.length > 0 &&
                      showFamilySelect && (
                        <div className='min-w-[7rem] flex-1 space-y-1'>
                          <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                            <Layers className='h-3.5 w-3.5 shrink-0' />
                            Abrechnungsfamilie
                          </div>
                          <Select
                            value={billingFamilyDraft || undefined}
                            onValueChange={handleBillingFamilyChange}
                          >
                            <SelectTrigger className='border-border h-8 w-full min-w-0 text-xs font-semibold'>
                              <SelectValue placeholder='Familie wählen' />
                            </SelectTrigger>
                            <SelectContent>
                              {families.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                  {f.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    {payerDraft &&
                      billingVariants.length > 0 &&
                      needVariantDropdown &&
                      (!showFamilySelect || !!billingFamilyDraft) && (
                        <div className='min-w-[7rem] flex-1 space-y-1'>
                          <div className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
                            <CreditCard className='h-3.5 w-3.5 shrink-0' />
                            Unterart
                          </div>
                          <Select
                            value={billingVariantDraft}
                            onValueChange={setBillingVariantDraft}
                            disabled={!payerDraft}
                          >
                            <SelectTrigger className='border-border h-8 w-full min-w-0 text-xs font-semibold'>
                              <SelectValue placeholder='Unterart wählen' />
                            </SelectTrigger>
                            <SelectContent>
                              {variantsInEffectiveFamily.map((bt) => (
                                <SelectItem key={bt.id} value={bt.id}>
                                  <span className='flex items-center gap-2'>
                                    <span
                                      className='inline-block h-2 w-2 shrink-0 rounded-full'
                                      style={{ backgroundColor: bt.color }}
                                    />
                                    <span>
                                      {formatBillingVariantOptionLabel(bt)}
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                  </div>
                  {payerDraft ? (
                    <div className='col-span-2 flex flex-row items-center justify-between gap-3 rounded-lg border border-dashed p-3'>
                      <div className='min-w-0 space-y-1'>
                        <div className='text-muted-foreground text-xs font-medium'>
                          KTS / Krankentransportschein
                        </div>
                        {ktsCatalogHint && ktsDocumentAppliesDraft ? (
                          <p className='text-muted-foreground text-[11px]'>
                            {ktsCatalogHint}
                          </p>
                        ) : null}
                      </div>
                      <Switch
                        checked={ktsDocumentAppliesDraft}
                        onCheckedChange={(c) => {
                          ktsUserLockedRef.current = true;
                          if (!c) setKtsCatalogHint(null);
                          setKtsDocumentAppliesDraft(c);
                        }}
                      />
                    </div>
                  ) : null}
                  <DetailItem
                    icon={<Phone className='h-3.5 w-3.5' />}
                    label='Kontakt'
                    className='col-span-2'
                  >
                    <div className='flex max-w-full flex-col gap-2'>
                      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
                        <div className='min-w-0'>
                          <Label className='text-muted-foreground mb-0.5 block text-[10px] leading-none'>
                            Vorname
                          </Label>
                          <ClientAutoSuggest
                            value={clientFirstDraft}
                            onNameChange={(v) => {
                              setClientFirstDraft(v);
                            }}
                            onSelect={handleTripClientSelect}
                            searchClients={searchClients}
                            placeholder='Suchen…'
                            getDisplayValue={(c) =>
                              c.first_name || c.company_name || ''
                            }
                            inputClassName='h-8 text-sm font-semibold'
                            widePopover
                          />
                        </div>
                        <div className='min-w-0'>
                          <Label className='text-muted-foreground mb-0.5 block text-[10px] leading-none'>
                            Nachname
                          </Label>
                          <Input
                            value={clientLastDraft}
                            onChange={(e) => setClientLastDraft(e.target.value)}
                            placeholder='Nachname'
                            className='h-8 text-sm font-semibold'
                          />
                        </div>
                      </div>
                      <Input
                        value={clientPhoneDraft}
                        onChange={(e) => setClientPhoneDraft(e.target.value)}
                        placeholder='Telefon'
                        className='h-8 max-w-md text-sm font-semibold'
                      />
                      {clientIdDraft ? (
                        <p className='text-muted-foreground text-[10px] font-normal'>
                          Verknüpft mit Stammdaten (Kunden-ID)
                        </p>
                      ) : null}
                    </div>
                  </DetailItem>
                </section>

                <section
                  className={cn(
                    'rounded-xl border p-4 shadow-sm',
                    'border-amber-200/90 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
                  )}
                >
                  <div className='mb-3 flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <h4 className='flex items-start gap-2.5'>
                        <span
                          className='mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 shadow-sm dark:bg-amber-900/60'
                          aria-hidden
                        >
                          <PenLine className='h-4 w-4 text-amber-800 dark:text-amber-200' />
                        </span>
                        <span className='min-w-0'>
                          <span className='block text-xs font-bold tracking-wide text-amber-950 uppercase dark:text-amber-100'>
                            Wichtige Hinweise
                          </span>
                          <span className='mt-0.5 block text-[11px] leading-snug font-normal tracking-normal text-amber-800/85 normal-case dark:text-amber-300/90'>
                            Kurzinfos für Fahrer &amp; Disposition — sofort
                            sichtbar
                          </span>
                        </span>
                      </h4>
                    </div>
                    {notesDirty && (
                      <Button
                        type='button'
                        size='sm'
                        variant='secondary'
                        className='h-8 shrink-0 border border-amber-300/80 bg-white/90 text-xs text-amber-950 shadow-sm hover:bg-white dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/70'
                        disabled={isSavingNotes}
                        onClick={() => {
                          void handleSaveNotes();
                        }}
                      >
                        {isSavingNotes ? 'Speichern…' : 'Speichern'}
                      </Button>
                    )}
                  </div>
                  <div
                    className={cn(
                      'overflow-hidden rounded-lg border shadow-inner',
                      'border-amber-200/80 bg-white/95 dark:border-amber-800/70 dark:bg-amber-950/35'
                    )}
                  >
                    <Textarea
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      disabled={isSavingNotes || !isOpen}
                      placeholder='z. B. Treppenlift, zweiter Ansprechpartner, exakte Abholstelle…'
                      rows={3}
                      aria-label='Wichtige Hinweise zur Fahrt'
                      className={cn(
                        'min-h-[4.75rem] resize-y border-0 text-sm shadow-none',
                        'bg-transparent px-3.5 py-3',
                        'text-amber-950 placeholder:text-amber-900/40 dark:text-amber-50 dark:placeholder:text-amber-400/35',
                        'focus-visible:ring-2 focus-visible:ring-amber-400/35 focus-visible:ring-offset-0 dark:focus-visible:ring-amber-500/30'
                      )}
                    />
                  </div>
                  <p className='mt-2.5 flex items-center gap-1.5 text-[11px] leading-snug text-amber-800/85 dark:text-amber-400/90'>
                    <AlertCircle className='h-3 w-3 shrink-0 opacity-80' />
                    Wird mit der Fahrt gespeichert und im Team angezeigt.
                  </p>
                </section>
              </div>
            </div>

            <SheetFooter className='bg-background mt-auto flex flex-wrap items-center justify-end gap-3 border-t px-6 py-4'>
              {trip.rule_id && (
                <div className='text-muted-foreground mr-auto flex flex-col text-[11px] leading-snug'>
                  <span className='font-mono text-[10px]'>
                    Serie: {trip.rule_id.slice(0, 8)}
                    {'…'}
                  </span>
                </div>
              )}
              <div className='flex flex-wrap items-center gap-2'>
                {detailsDirty && (
                  <Button
                    type='button'
                    size='sm'
                    disabled={isSavingDetails}
                    onClick={() => handleSaveTripDetails()}
                  >
                    {isSavingDetails
                      ? 'Wird aktualisiert…'
                      : 'Trip aktualisieren'}
                  </Button>
                )}
                {showCreateReturnButton && (
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    className='text-primary hover:bg-primary/10 hover:text-primary'
                    onClick={() => setIsCreateReturnOpen(true)}
                  >
                    <ArrowLeftRight className='mr-1.5 h-3.5 w-3.5' />
                    Rückfahrt
                  </Button>
                )}
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      className='gap-1.5'
                    >
                      Aktionen
                      <ChevronDown className='h-3.5 w-3.5 opacity-70' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-52'>
                    <DropdownMenuItem
                      onClick={() => setIsDuplicateDialogOpen(true)}
                    >
                      <Copy className='mr-2 h-4 w-4' />
                      Duplizieren
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!canRescheduleTrip(trip as Trip)}
                      title={getRescheduleDisabledReason(trip as Trip)}
                      onClick={() => setIsRescheduleDialogOpen(true)}
                    >
                      <CalendarRange className='mr-2 h-4 w-4' />
                      Verschieben
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type='button'
                  variant='destructive'
                  size='sm'
                  disabled={isCancelling}
                  onClick={() => {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    handleOpenCancelDialog();
                  }}
                >
                  <Trash2 className='mr-1.5 h-3.5 w-3.5' />
                  Fahrt stornieren
                </Button>
              </div>
            </SheetFooter>

            {trip && (
              <CreateReturnTripDialog
                open={isCreateReturnOpen}
                onOpenChange={setIsCreateReturnOpen}
                anchorTrip={trip as Trip}
                groupTrips={effectiveGroupTrips}
                drivers={drivers}
                onSuccess={() => {
                  // Realtime on `trips` will refetch; paired leg also triggers UPDATE on this row.
                  void findPairedTrip(trip as Trip).then((p) =>
                    setLinkedPartner(p ?? null)
                  );
                }}
              />
            )}

            <TripRescheduleDialog
              trip={trip ? (trip as Trip) : null}
              open={isRescheduleDialogOpen}
              onOpenChange={setIsRescheduleDialogOpen}
              onSuccess={() => {
                void findPairedTrip(trip as Trip).then((p) =>
                  setLinkedPartner(p ?? null)
                );
              }}
            />

            <DuplicateTripsDialog
              open={isDuplicateDialogOpen}
              onOpenChange={setIsDuplicateDialogOpen}
              selectedTrips={trip ? [trip as Trip] : []}
              variant='detail'
              linkedPartnerPreview={linkedPartner}
              onSuccess={(result) => {
                if (!trip) return;
                const ids = result?.ids ?? [];
                const nextId = pickNewTripIdAfterDuplicate(
                  ids,
                  tripLegDirection
                );
                if (nextId) {
                  onNavigateToTrip?.(nextId);
                }
                // `linkedPartner` refreshes via `useEffect` when `trip.id` updates after navigation.
              }}
            />

            <RecurringTripCancelDialog
              trip={trip as Trip}
              hasPair={hasPair}
              isOpen={isCancelDialogOpen}
              isLoading={isCancelling}
              title='Fahrt stornieren?'
              description='Möchten Sie diese Fahrt wirklich stornieren?'
              onOpenChange={setIsCancelDialogOpen}
              onConfirmSingle={(reason) => {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                cancelTrip(
                  trip as Trip,
                  trip.rule_id ? 'skip-occurrence' : 'single-nonrecurring',
                  {
                    source: 'Manually cancelled via Trip Detail Sheet',
                    reason
                  }
                ).then(() => setIsCancelDialogOpen(false));
              }}
              onConfirmWithPair={
                hasPair
                  ? (reason) => {
                      // eslint-disable-next-line @typescript-eslint/no-floating-promises
                      cancelTrip(
                        trip as Trip,
                        trip.rule_id
                          ? 'skip-occurrence-and-paired'
                          : 'cancel-nonrecurring-and-paired',
                        {
                          source:
                            'Manually cancelled (Hinfahrt/Rückfahrt) via Trip Detail Sheet',
                          reason
                        }
                      ).then(() => setIsCancelDialogOpen(false));
                    }
                  : undefined
              }
              onConfirmSeries={
                trip.rule_id
                  ? (reason) => {
                      // eslint-disable-next-line @typescript-eslint/no-floating-promises
                      cancelTrip(trip as Trip, 'cancel-series', {
                        source:
                          'Recurring series cancelled via Trip Detail Sheet',
                        reason
                      }).then(() => setIsCancelDialogOpen(false));
                    }
                  : undefined
              }
              singleLabel={
                trip.rule_id
                  ? 'Nur diese Fahrt stornieren (Aussetzen)'
                  : hasPair
                    ? 'Nur diese Fahrt stornieren'
                    : 'Fahrt stornieren'
              }
              pairLabel='Diese Fahrt & Rückfahrt stornieren'
              seriesLabel='Gesamte Serie beenden'
            />

            <PairedTripSyncDialog
              open={pairSyncOpen}
              onOpenChange={(open) => {
                setPairSyncOpen(open);
                if (!open) {
                  pendingDetailsPatchRef.current = null;
                  pendingNotesTrimmedRef.current = null;
                }
              }}
              partnerLegLabel={
                linkedPartner
                  ? (() => {
                      const d = getTripDirection(linkedPartner);
                      if (d === 'rueckfahrt') return 'Rückfahrt';
                      if (d === 'hinfahrt') return 'Hinfahrt';
                      return 'Gegenfahrt';
                    })()
                  : 'Gegenfahrt'
              }
              variant={pairSyncVariant}
              partnerCancelled={linkedPartner?.status === 'cancelled'}
              isLoading={isSavingDetails || isSavingNotes}
              onCurrentTripOnly={() => {
                if (pairSyncVariant === 'notes') {
                  const t =
                    pendingNotesTrimmedRef.current ??
                    normalizeNotes(notesDraft);
                  void applyNotesSave(t, false);
                } else {
                  const p = pendingDetailsPatchRef.current;
                  if (p) void applyDetailsPatch(p, false);
                }
              }}
              onBothTrips={() => {
                if (pairSyncVariant === 'notes') {
                  const t =
                    pendingNotesTrimmedRef.current ??
                    normalizeNotes(notesDraft);
                  void applyNotesSave(t, true);
                } else {
                  const p = pendingDetailsPatchRef.current;
                  if (p) void applyDetailsPatch(p, true);
                }
              }}
            />

            <RecurringTripEditScopeDialog
              open={recurringScopeOpen}
              onOpenChange={(open) => {
                setRecurringScopeOpen(open);
                if (!open) pendingSaveRef.current = null;
              }}
              onConfirmThisTripOnly={() => {
                const fn = pendingSaveRef.current;
                pendingSaveRef.current = null;
                setRecurringScopeOpen(false);
                if (fn) void fn();
              }}
              onConfirmSeries={() => {
                pendingSaveRef.current = null;
                setRecurringScopeOpen(false);
                toast.info(
                  'Serienweite Bearbeitung: Bitte die wiederkehrende Regel im Fahrgastprofil anpassen.'
                );
              }}
            />
          </>
        ) : (
          <div className='text-muted-foreground p-10 text-center'>
            Fehler beim Laden der Fahrt-Details.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailItem({
  icon,
  label,
  value,
  children,
  className
}: {
  icon?: ReactNode;
  label: string;
  value?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium'>
        {icon}
        {label}
      </div>
      {/* No horizontal inset: controls align with the icon column, not under the label text. */}
      <div className='text-foreground text-sm font-semibold [&_input]:font-semibold'>
        {children ?? value}
      </div>
    </div>
  );
}

function googleMapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

interface TimelineItemProps {
  stopLabel: string;
  title: string;
  address: string;
  name?: string;
  passengerStation?: string;
  time?: string;
  station?: string;
  update?: { status?: string };
  isCompleted?: boolean;
  isLast?: boolean;
  showRouteEdit?: boolean;
  /** When set, show an inline Station input on the Fahrgast row (current trip leg). */
  stationEditable?: boolean;
  stationValue?: string;
  onStationChange?: (value: string) => void;
  routeEditOpen?: boolean;
  onToggleRouteEdit?: () => void;
  routeEditSlot?: ReactNode;
  routeEditTitle?: string;
}

function TimelineItem({
  stopLabel,
  title,
  address,
  name,
  passengerStation,
  time,
  station,
  update,
  isCompleted,
  isLast,
  showRouteEdit,
  stationEditable,
  stationValue,
  onStationChange,
  routeEditOpen,
  onToggleRouteEdit,
  routeEditSlot,
  routeEditTitle = 'Adresse bearbeiten'
}: TimelineItemProps) {
  const isCancelled = update?.status === 'not_present';
  const mapQuery =
    typeof address === 'string' && address.trim().length > 0
      ? [address.trim(), station ? String(station).trim() : '']
          .filter(Boolean)
          .join(', ')
      : '';
  const mapsHref = mapQuery ? googleMapsSearchUrl(mapQuery) : undefined;

  const handleCopyAddress = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!mapQuery) return;
    const clipboardText =
      typeof address === 'string' && address.trim().length > 0
        ? [
            stripAddressForShare(address.trim()),
            station ? String(station).trim() : ''
          ]
            .filter(Boolean)
            .join(', ')
        : mapQuery;
    try {
      await navigator.clipboard.writeText(clipboardText);
      toast.success('Adresse kopiert');
    } catch {
      toast.error('Kopieren fehlgeschlagen');
    }
  };

  return (
    <div className={`relative pb-8 pl-10 ${isLast ? 'pb-2' : ''}`}>
      <div className='absolute top-[10px] left-0 z-10'>
        <Badge
          variant='outline'
          className='border-border bg-muted/60 text-muted-foreground flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums'
        >
          {stopLabel}
        </Badge>
      </div>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center justify-between'>
          <span className='text-muted-foreground text-[10px] font-bold tracking-tighter uppercase'>
            {title}
          </span>
          {time && (
            <span className='rounded border border-green-100 bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600 italic dark:border-green-800 dark:bg-green-950/40 dark:text-green-400'>
              Erledigt: {format(new Date(time), 'HH:mm')}
            </span>
          )}
        </div>
        <div
          className={cn(
            'flex flex-col text-sm leading-snug font-semibold',
            isCancelled && 'opacity-50'
          )}
        >
          <div className='flex min-w-0 items-start gap-0.5'>
            <div className='flex min-w-0 flex-1 flex-col'>
              {mapsHref ? (
                <a
                  href={mapsHref}
                  target='_blank'
                  rel='noopener noreferrer'
                  className={cn(
                    'text-primary min-w-0 underline-offset-2 hover:underline',
                    isCancelled && 'line-through'
                  )}
                  title='In Google Maps öffnen'
                  aria-label={`Adresse in Google Maps öffnen: ${address}`}
                >
                  {address}
                </a>
              ) : (
                <span className={cn('min-w-0', isCancelled && 'line-through')}>
                  {address}
                </span>
              )}
              <div
                className='border-muted-foreground/30 mt-2 w-full border-b [border-bottom-width:1pt] border-dashed'
                aria-hidden
              />
            </div>
            {(mapQuery || showRouteEdit) && (
              <div className='-mr-1 flex shrink-0 self-start'>
                {mapQuery ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='text-muted-foreground hover:text-foreground h-7 w-7'
                    title='Adresse kopieren'
                    aria-label='Adresse kopieren'
                    onClick={(e) => {
                      void handleCopyAddress(e);
                    }}
                  >
                    <Copy className='h-3.5 w-3.5' />
                  </Button>
                ) : null}
                {showRouteEdit ? (
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className={cn(
                      'text-muted-foreground hover:text-foreground h-7 w-7',
                      routeEditOpen && 'text-primary'
                    )}
                    title={routeEditTitle}
                    aria-label={routeEditTitle}
                    aria-expanded={!!routeEditOpen}
                    onClick={() => onToggleRouteEdit?.()}
                  >
                    <PenLine className='h-3.5 w-3.5' />
                  </Button>
                ) : null}
              </div>
            )}
          </div>
          {station && !name && (
            <span
              className={cn(
                'text-muted-foreground text-xs font-normal',
                isCancelled && 'line-through'
              )}
            >
              ({station})
            </span>
          )}
        </div>
        {name && (
          <div className='flex flex-col gap-1 text-xs'>
            <span className='shrink-0'>
              <span className='text-foreground font-semibold'>Fahrgast</span>
              <span className='text-muted-foreground'>: {name}</span>
            </span>
            {stationEditable ? (
              <div className='flex flex-wrap items-center gap-1.5 pl-0'>
                <span className='text-foreground shrink-0 font-semibold'>
                  Station
                </span>
                <Input
                  value={stationValue ?? ''}
                  onChange={(e) => onStationChange?.(e.target.value)}
                  placeholder=''
                  aria-label='Station'
                  className='border-border h-7 w-[4.5rem] max-w-[4.5rem] shrink-0 px-1.5 text-xs font-semibold sm:w-24 sm:max-w-[6rem]'
                />
              </div>
            ) : passengerStation?.trim() ? (
              <div className='flex flex-wrap items-center gap-1.5'>
                <span className='text-foreground shrink-0 font-semibold'>
                  Station
                </span>
                <Badge
                  variant='outline'
                  className='border-border bg-muted/60 text-muted-foreground h-5 px-1.5 py-0 text-[10px] font-medium'
                >
                  {passengerStation.trim()}
                </Badge>
              </div>
            ) : null}
          </div>
        )}
        {stationEditable && !name && (
          <div className='flex flex-wrap items-center gap-2 text-xs'>
            <span className='text-foreground shrink-0 font-semibold'>
              Station
            </span>
            <Input
              value={stationValue ?? ''}
              onChange={(e) => onStationChange?.(e.target.value)}
              placeholder=''
              aria-label='Station'
              className='border-border h-7 w-[4.5rem] max-w-[4.5rem] shrink-0 px-1.5 text-xs font-semibold sm:w-24 sm:max-w-[6rem]'
            />
          </div>
        )}

        {isCancelled && (
          <div className='mt-1 flex w-fit items-center gap-1 rounded border border-red-100 bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400'>
            <AlertCircle className='h-3 w-3' /> PERSON NICHT ERSCHIENEN
          </div>
        )}

        {routeEditOpen && routeEditSlot ? (
          <div
            className={cn(
              'border-border/80 bg-muted/30 mt-2 rounded-lg border p-3',
              'shadow-inner'
            )}
          >
            {routeEditSlot}
          </div>
        ) : null}
      </div>
    </div>
  );
}
