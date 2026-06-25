'use client';

/**
 * TripsKanbanBoard – top-level orchestrator for the Kanban board.
 *
 * Responsibilities (this file only):
 * - State: groupBy, zoom, column order, expand/collapse, activeDragId, isSaving
 * - Pending changes: proxy to useKanbanPendingStore (via setPendingChanges)
 * - DnD event handling: handleDragStart / handleDragEnd
 * - Save / Reset logic
 * - Layout: expanded (portal) vs inline
 *
 * All visual sub-components live in sibling files.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { resolveTripsFilterDateYmd } from '@/lib/driver-availability';
import { useDriversWithAvailability } from '@/hooks/useDriversWithAvailability';
import { TripsRscRefreshChrome } from '@/features/trips/components/trips-rsc-refresh-chrome';
import { useTripsRscRefresh } from '@/features/trips/providers';
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  DragOverlay,
  pointerWithin
} from '@dnd-kit/core';
import { toast } from 'sonner';

import { tripsService } from '../../api/trips.service';
import {
  useKanbanPendingStore,
  syncTripIds
} from '@/features/trips/stores/use-kanban-pending-store';
import { useTripFormData } from '@/features/trips/hooks/use-trip-form-data';
import { useKanbanSensors } from '@/features/trips/hooks/use-kanban-sensors';
import {
  buildAssignmentPatch,
  FREMDFIRMA_ALL_ASSIGNEE_PARAM,
  isTripFremdfirma
} from '@/features/trips/lib/trip-assignee';
import { getItem, setItem, STORAGE_KEYS } from '@/lib/kanban-local-storage';
import {
  buildColumns,
  buildItemsByColumn,
  getKanbanTripColumnId
} from '@/features/trips/lib/kanban-columns';
import {
  buildGroupLabels,
  deriveStatusForPending
} from '@/features/trips/lib/kanban-grouping';
import { resolveKanbanDropColumnId } from '@/features/trips/lib/kanban-dnd';
import { invalidateAfterTripSave } from '@/features/trips/lib/invalidate-after-trip-save';
import type {
  KanbanTrip,
  GroupByMode,
  KanbanColumn,
  PendingChange
} from '@/features/trips/lib/kanban-types';

import { KanbanHeader } from './kanban-header';
import { KanbanColumnView } from './kanban-column';
import { KanbanDragPreview } from './kanban-drag-preview';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TripsKanbanBoardProps {
  trips: KanbanTrip[];
  totalItems: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Kanban board for managing trips. Groups trips by driver, status, or payer.
 *
 * All changes (assignments, grouping, time edits) are staged in localStorage
 * until the user clicks "Speichern". "Verwerfen" clears pending changes.
 *
 * Reliability:
 * - useKanbanPendingStore persists to localStorage; beforeunload warns.
 * - Orphan columns prevent cards from disappearing when a driver/status is removed.
 * - DragOverlay avoids coordinate glitches under CSS transform scale.
 * - Status is staged at drag-end so the badge is immediately correct.
 */
export function TripsKanbanBoard({ trips }: TripsKanbanBoardProps) {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const kanbanDateYmd = resolveTripsFilterDateYmd(
    searchParams.get('scheduled_at')
  );
  const {
    dataMap: availabilityMap,
    isError: availabilityError,
    isLoading: availabilityLoading
  } = useDriversWithAvailability(kanbanDateYmd);

  // WHY graceful degradation: Kanban must never block on plan/availability fetch failure.
  const availabilityForColumns =
    !availabilityLoading && !availabilityError ? availabilityMap : undefined;

  const { refreshTripsPage } = useTripsRscRefresh();
  const { drivers, isLoading: isFormDataLoading } = useTripFormData();
  const { pendingChanges, setPendingChanges, clearPendingChanges, pruneToIds } =
    useKanbanPendingStore();

  // ── Synchronous ID sync — must happen before any useMemo that reads pendingChanges ─
  // syncTripIds keeps the module-level ref up to date so the Zustand
  // onRehydrateStorage callback can prune stale entries synchronously.
  // pruneToIds is also called here to cover the case where rehydration
  // already finished by the time this render runs.
  const currentTripIds = useMemo(
    () => new Set(trips.map((t) => t.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trips]
  );
  syncTripIds(currentTripIds);
  // Prune inline (safe to call on every render — it's a no-op when nothing changed).
  pruneToIds(currentTripIds);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState<GroupByMode>('driver');
  const [isSaving, setIsSaving] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [fremdfirmaBannerDismissed, setFremdfirmaBannerDismissed] =
    useState(false);
  const [zoom, setZoom] = useState(1);
  const [columnOrderByMode, setColumnOrderByMode] = useState<
    Partial<Record<GroupByMode, string[]>>
  >({});
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragColumnId, setActiveDragColumnId] = useState<string | null>(
    null
  );
  // why: isOver on the column droppable never fires when the pointer is over a child card droppable (pointerWithin always prefers the smallest target). We derive column hover state manually in onDragOver instead.
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const [zoomInput, setZoomInput] = useState<string | null>(null);

  // ── Column order persistence ────────────────────────────────────────────────
  useEffect(() => {
    const stored = getItem<Partial<Record<GroupByMode, string[]>>>(
      STORAGE_KEYS.KANBAN_COLUMN_ORDER
    );
    if (stored && typeof stored === 'object') setColumnOrderByMode(stored);
  }, []);

  useEffect(() => {
    if (Object.keys(columnOrderByMode).length === 0) return;
    setItem(STORAGE_KEYS.KANBAN_COLUMN_ORDER, columnOrderByMode);
  }, [columnOrderByMode]);

  // ── Expand / ESC ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsExpanded(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isExpanded]);

  // ── Zoom helpers ────────────────────────────────────────────────────────────
  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(1, Math.round((z + 0.1) * 10) / 10)),
    []
  );
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10)),
    []
  );
  const zoomDisplayValue =
    zoomInput !== null ? zoomInput : String(Math.round(zoom * 100));
  const applyZoomInput = useCallback((raw: string) => {
    const parsed = parseInt(raw.replace(/%/g, ''), 10);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(50, Math.min(100, parsed));
      setZoom(clamped / 100);
    }
    setZoomInput(null);
  }, []);

  // ── beforeunload guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (Object.keys(pendingChanges).length === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [pendingChanges]);

  // ── DnD sensors ─────────────────────────────────────────────────────────────
  const sensors = useKanbanSensors();

  /**
   * Server `trips` (from RSC) merged with **staged** `pendingChanges`. A background
   * `refreshTripsPage()` updates `trips` only — unsaved edits in `pendingChanges` stay
   * until Speichern/Verwerfen (they are not wiped by RSC refresh).
   */
  const effectiveTrips = useMemo(
    () =>
      trips.map((trip) => {
        const override = pendingChanges[trip.id];
        if (!override) return trip;
        return { ...trip, ...override };
      }),
    [trips, pendingChanges]
  );

  // Internal planning only — Fremdfirma trips are delegated externally.
  const hiddenFremdfirmaCount = useMemo(
    () => effectiveTrips.filter((trip) => isTripFremdfirma(trip)).length,
    [effectiveTrips]
  );

  const visibleTrips = useMemo(
    () =>
      effectiveTrips.filter(
        (trip) => trip.status !== 'cancelled' && !isTripFremdfirma(trip)
      ),
    [effectiveTrips]
  );

  const cancelledTripCount = useMemo(
    () => effectiveTrips.filter((trip) => trip.status === 'cancelled').length,
    [effectiveTrips]
  );

  // ── Callbacks staged in pendingChanges ─────────────────────────────────────

  const onTimeChange = useCallback(
    (tripId: string, scheduledAt: string | null) => {
      setPendingChanges((prev) => {
        const next = { ...prev };
        const current = next[tripId] ?? {};
        current.scheduled_at = scheduledAt;
        next[tripId] = current;
        return next;
      });
    },
    []
  );

  const onStopOrderChange = useCallback((tripId: string, order: number) => {
    setPendingChanges((prev) => {
      const next = { ...prev };
      const current = next[tripId] ?? {};
      current.stop_order = order;
      next[tripId] = current;
      return next;
    });
  }, []);

  const onUngroup = useCallback(
    (groupId: string) => {
      const tripIdsInGroup = effectiveTrips
        .filter((t) => t.group_id === groupId)
        .map((t) => t.id);
      setPendingChanges((prev) => {
        const next = { ...prev };
        for (const id of tripIdsInGroup) {
          const current = next[id] ?? {};
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { group_id, stop_order, ...rest } = current;
          next[id] = { ...rest, group_id: null, stop_order: null };
        }
        return next;
      });
      toast.success('Gruppe zum Auflösen vorgemerkt');
    },
    [effectiveTrips]
  );

  // ── Columns & layout ────────────────────────────────────────────────────────

  const columns: KanbanColumn[] = useMemo(
    () =>
      buildColumns(
        visibleTrips,
        groupBy,
        drivers,
        groupBy === 'driver' ? availabilityForColumns : undefined
      ),
    [visibleTrips, groupBy, drivers, availabilityForColumns]
  );

  const itemsByColumn = useMemo(
    () => buildItemsByColumn(visibleTrips, columns, groupBy),
    [visibleTrips, columns, groupBy]
  );

  const effectiveColumns = useMemo(() => {
    const order = columnOrderByMode[groupBy];
    if (!order?.length) return columns;
    const orderSet = new Set(order);
    const ordered = order
      .filter((id) => columns.some((c) => c.id === id))
      .map((id) => columns.find((c) => c.id === id)!);
    const rest = columns.filter((c) => !orderSet.has(c.id));
    return [...ordered, ...rest];
  }, [columns, columnOrderByMode, groupBy]);

  /** Maps group_id → "Gruppe 1", "Gruppe 2", … (ordered by earliest scheduled_at). */
  const groupLabels = useMemo(
    () => buildGroupLabels(effectiveTrips),
    [effectiveTrips]
  );

  // ── DnD handlers ────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
    // why: Tracked so child cards can suppress their drop-target highlight when a cross-column drag passes over them.
    setActiveDragColumnId(event.active.data.current?.columnId ?? null);
  }, []);

  // why: Resolves the hovered column from any droppable under the pointer — card or column — so the column highlight activates regardless of what the pointer lands on.
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const overId = event.over?.id == null ? null : String(event.over.id);
      if (
        !overId ||
        overId.startsWith('column-') ||
        overId.startsWith('group-')
      ) {
        setDragOverColumnId(null);
        return;
      }

      const hoveredColumnId = resolveKanbanDropColumnId({
        overId,
        columns: effectiveColumns,
        trips: effectiveTrips,
        // why: Pass groupBy explicitly so drag feedback uses the same trip-to-column derivation as buildItemsByColumn for the current board mode.
        getTripColumnId: (trip) => getKanbanTripColumnId(trip, groupBy)
      });

      setDragOverColumnId(
        hoveredColumnId && hoveredColumnId !== activeDragColumnId
          ? hoveredColumnId
          : null
      );
    },
    [activeDragColumnId, effectiveColumns, effectiveTrips, groupBy]
  );

  const applyColumnAssignment = useCallback(
    (draggedId: string, targetColumnId: string) => {
      const isDraggingGroup = draggedId.startsWith('group-');
      const tripIdsToUpdate = isDraggingGroup
        ? effectiveTrips
            .filter((t) => t.group_id === draggedId.replace('group-', ''))
            .map((t) => t.id)
        : [draggedId];

      const draggedTrip = effectiveTrips.find((t) => t.id === draggedId);
      const isSingleTripLeavingGroup =
        !isDraggingGroup && !!draggedTrip?.group_id;

      const value =
        groupBy === 'driver'
          ? targetColumnId === 'unassigned'
            ? null
            : targetColumnId
          : groupBy === 'status'
            ? targetColumnId
            : targetColumnId === 'no_payer'
              ? null
              : targetColumnId;

      setPendingChanges((prev) => {
        const next = { ...prev };
        for (const id of tripIdsToUpdate) {
          const current = next[id] ?? {};
          if (groupBy === 'driver') {
            const newDriverId = value as string | null;
            current.driver_id = newDriverId;
            // Stage derived status immediately so the badge reflects truth.
            const derivedStatus = deriveStatusForPending(
              id,
              newDriverId,
              prev,
              trips
            );
            if (derivedStatus !== undefined) current.status = derivedStatus;
          } else if (groupBy === 'status') {
            current.status = value as string;
          } else if (groupBy === 'payer') {
            current.payer_id = value as string | null;
          }
          if (isSingleTripLeavingGroup && id === draggedId) {
            current.group_id = null;
            current.stop_order = null;
          }
          next[id] = current;
        }
        return next;
      });
    },
    [effectiveTrips, groupBy, trips]
  );

  /**
   * Handles all drag-end events. Three cases:
   * 1. Column header → another column: reorder columns.
   * 2. Trip → trip: group trips together.
   * 3. Trip/group → column: reassign driver / status / payer.
   * All changes staged in pendingChanges until "Speichern".
   */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      setActiveDragColumnId(null);
      setDragOverColumnId(null);
      const { active, over } = event;
      if (!over) return;

      const draggedId = String(active.id);
      const overStr = String(over.id);
      const isDraggingGroup = draggedId.startsWith('group-');

      // 1. Column reorder
      // pointerWithin may report a trip-card droppable (trip-{id}) as `over`
      // instead of the column droppable when the pointer lands on a card inside
      // the target column. Resolve the actual target column in both cases.
      if (draggedId.startsWith('column-')) {
        const draggedColumnId = draggedId.replace(/^column-/, '');

        let targetColumnId = overStr;

        // If we landed on a trip card, find which column owns that trip.
        if (overStr.startsWith('trip-')) {
          const tripId = overStr.replace(/^trip-/, '');
          const trip = effectiveTrips.find((t) => t.id === tripId);
          if (trip) {
            targetColumnId = getKanbanTripColumnId(trip, groupBy);
          }
        }

        const isOverColumn = effectiveColumns.some(
          (c) => c.id === targetColumnId
        );
        if (isOverColumn && draggedColumnId !== targetColumnId) {
          setColumnOrderByMode((prev) => {
            // Always derive currentOrder from effectiveColumns (which already
            // merges the stored order with any new columns). This prevents the
            // silent no-op when localStorage didn't include the last column.
            const currentOrder = effectiveColumns.map((c) => c.id);
            const fromIdx = currentOrder.indexOf(draggedColumnId);
            const toIdx = currentOrder.indexOf(targetColumnId);
            if (fromIdx === -1 || toIdx === -1) return prev;
            const reordered = [...currentOrder];
            reordered.splice(fromIdx, 1);
            reordered.splice(toIdx, 0, draggedColumnId);
            return { ...prev, [groupBy]: reordered };
          });
        }
        // Always return — column drags must never fall through to grouping logic.
        return;
      }

      // 2. Trip → trip: grouping
      if (!isDraggingGroup && overStr.startsWith('trip-')) {
        const targetId = overStr.replace(/^trip-/, '');
        if (targetId === draggedId) return;

        const draggedTrip = effectiveTrips.find((t) => t.id === draggedId);
        const targetTrip = effectiveTrips.find((t) => t.id === targetId);
        if (!draggedTrip || !targetTrip) return;

        // why: Grouping across columns is not permitted — a cross-column card-on-card drop is silently promoted to a plain column move to prevent cards from ending up grouped but in different columns.
        if (
          getKanbanTripColumnId(draggedTrip, groupBy) !==
          getKanbanTripColumnId(targetTrip, groupBy)
        ) {
          // Resolve the target column from the target trip — do not use overStr here,
          // because overStr is "trip-{id}" not a column id when the pointer lands on a card.
          // why: Passing groupBy here keeps the grouping guard aligned with the exact column mode rendered by buildItemsByColumn.
          const targetColumnId = getKanbanTripColumnId(targetTrip, groupBy);
          applyColumnAssignment(draggedId, targetColumnId);
          return;
        }

        const targetGroupId = targetTrip.group_id ?? crypto.randomUUID();
        const groupTrips = effectiveTrips.filter(
          (t) =>
            (t.group_id ?? (t.id === targetId ? targetGroupId : null)) ===
            targetGroupId
        );
        const maxStop = targetTrip.group_id
          ? Math.max(...groupTrips.map((t) => t.stop_order ?? 0), 0)
          : 1;
        const newStopOrder = maxStop + 1;

        setPendingChanges((prev) => {
          const next = { ...prev };
          const draggedChange = next[draggedId] ?? {};
          draggedChange.group_id = targetGroupId;
          draggedChange.stop_order = newStopOrder;
          next[draggedId] = draggedChange;
          if (!targetTrip.group_id) {
            const targetChange = next[targetId] ?? {};
            targetChange.group_id = targetGroupId;
            targetChange.stop_order = 1;
            next[targetId] = targetChange;
          }
          return next;
        });
        return;
      }

      // 3. Trip/group → column: assignment
      // why: overStr may be a column id (drop on empty space) or trip-{id} (drop on
      // a card). We must resolve to a real column id before writing assignment —
      // passing trip-{id} as a column value causes trips to disappear into an
      // unrendered bucket in buildItemsByColumn.
      const resolvedColumnId = resolveKanbanDropColumnId({
        overId: overStr,
        columns: effectiveColumns,
        trips: effectiveTrips,
        // why: The resolver is generic; the board passes groupBy explicitly so assignment writes the same column id that the current view renders.
        getTripColumnId: (trip) => getKanbanTripColumnId(trip, groupBy)
      });
      if (!resolvedColumnId) return;

      applyColumnAssignment(draggedId, resolvedColumnId);
    },
    [groupBy, effectiveTrips, effectiveColumns, applyColumnAssignment]
  );

  // ── Save / Reset ────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    clearPendingChanges();
    void refreshTripsPage();
  }, [clearPendingChanges, refreshTripsPage]);

  const handleSave = useCallback(async () => {
    if (Object.keys(pendingChanges).length === 0) return;
    setIsSaving(true);
    try {
      const entries = Object.entries(pendingChanges).map(([id, change]) => {
        const trip = trips.find((t) => t.id === id);
        const payload: Parameters<typeof tripsService.updateTrip>[1] = {};

        // Only patch assignee fields when driver_id was explicitly staged.
        // Time/payer/group-only saves must not call buildAssignmentPatch — it
        // would merge current state and could emit driver_id: null, clearing
        // an existing driver assignment.
        if (change.driver_id !== undefined && trip) {
          const assignmentPatch = buildAssignmentPatch(trip, {
            driver_id: change.driver_id
          });
          Object.assign(payload, assignmentPatch);
          if (change.status !== undefined) {
            payload.status = change.status;
          }
        }

        if (change.payer_id !== undefined) payload.payer_id = change.payer_id;
        if (change.scheduled_at !== undefined)
          payload.scheduled_at = change.scheduled_at;
        if (change.group_id !== undefined) payload.group_id = change.group_id;
        if (change.stop_order !== undefined)
          payload.stop_order = change.stop_order;

        return { id, payload };
      });

      await Promise.all(
        entries.map(({ id, payload }) => tripsService.updateTrip(id, payload))
      );

      // WHY: 'auto' — Kanban saves may be reorder-only; inspect the patch
      await invalidateAfterTripSave(queryClient, {
        tripIds: entries.map((e) => e.id),
        patch: entries.map((e) => e.payload),
        includePlanningWidgets: 'auto',
        includeTripList: false
      });
      // RSC refresh handles the server component layer
      await refreshTripsPage();
      clearPendingChanges();
    } finally {
      setIsSaving(false);
    }
  }, [
    pendingChanges,
    refreshTripsPage,
    trips,
    clearPendingChanges,
    queryClient
  ]);

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  // ── Board layout ────────────────────────────────────────────────────────────

  const header = (
    <KanbanHeader
      tripCount={visibleTrips.length}
      cancelledTripCount={cancelledTripCount}
      groupBy={groupBy}
      onGroupByChange={setGroupBy}
      zoom={zoom}
      zoomDisplayValue={zoomDisplayValue}
      onZoomIn={zoomIn}
      onZoomOut={zoomOut}
      onZoomInputChange={setZoomInput}
      onZoomInputFocus={() => setZoomInput(zoomDisplayValue)}
      onZoomInputBlur={applyZoomInput}
      onZoomInputKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      isExpanded={isExpanded}
      onToggleExpand={() => setIsExpanded((v) => !v)}
      hasPendingChanges={hasPendingChanges}
      isSaving={isSaving}
      onSave={handleSave}
      onReset={handleReset}
    />
  );

  const boardArea = isFormDataLoading ? (
    <div className='text-muted-foreground flex min-h-[260px] min-w-0 flex-1 items-center justify-center'>
      Laden…
    </div>
  ) : (
    <div className='min-h-0 min-w-0 flex-1 overflow-auto'>
      {/* pointerWithin prefers smaller droppables (trip cards) over columns. */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div
          className='inline-flex min-h-[260px] min-w-max gap-3 p-3'
          style={{ zoom }}
        >
          {effectiveColumns.map((column) => {
            const items = itemsByColumn[column.id] ?? [];
            return (
              <KanbanColumnView
                key={column.id}
                column={column}
                items={items}
                groupBy={groupBy}
                groupLabels={groupLabels}
                activeDragId={activeDragId}
                activeDragColumnId={activeDragColumnId}
                dragOverColumnId={dragOverColumnId}
                onTimeChange={onTimeChange}
                onStopOrderChange={onStopOrderChange}
                onUngroup={onUngroup}
              />
            );
          })}
        </div>

        {/*
         * DragOverlay must be fully controlled by dnd-kit for cursor tracking.
         * Do NOT add a transform style here — it overrides dnd-kit's own
         * translate3d that follows the pointer.
         * Instead, we zoom the inner content wrapper so the preview card
         * matches the board's visual scale.
         */}
        <DragOverlay dropAnimation={null}>
          {activeDragId ? (
            <div style={{ zoom }}>
              <KanbanDragPreview
                activeId={activeDragId}
                effectiveTrips={effectiveTrips}
                groupLabels={groupLabels}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );

  const boardContent = (
    <>
      {header}
      {hiddenFremdfirmaCount > 0 && !fremdfirmaBannerDismissed ? (
        <div className='bg-muted/60 text-muted-foreground flex shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5 text-xs'>
          <span>
            {hiddenFremdfirmaCount} Fremdfirma-Fahrten sind ausgeblendet ·{' '}
            <Link
              href={`/dashboard/trips?driver_id=${encodeURIComponent(FREMDFIRMA_ALL_ASSIGNEE_PARAM)}`}
              className='text-foreground underline-offset-2 hover:underline'
            >
              Zu Fahrten
            </Link>
          </span>
          <button
            type='button'
            className='hover:text-foreground shrink-0 px-1'
            aria-label='Hinweis schließen'
            onClick={() => setFremdfirmaBannerDismissed(true)}
          >
            ×
          </button>
        </div>
      ) : null}
      {boardArea}
    </>
  );

  const boardWithChrome = (
    <TripsRscRefreshChrome className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
      {boardContent}
    </TripsRscRefreshChrome>
  );

  if (isExpanded && typeof document !== 'undefined') {
    return createPortal(
      <div className='bg-background fixed inset-[2.5%] z-40 flex flex-col overflow-hidden rounded-lg border shadow-2xl'>
        {boardWithChrome}
      </div>,
      document.body
    );
  }

  return (
    <div className='bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border'>
      {boardWithChrome}
    </div>
  );
}
