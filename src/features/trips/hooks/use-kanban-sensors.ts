'use client';

import { useSensors, useSensor, MouseSensor, TouchSensor } from '@dnd-kit/core';

/**
 * Shared DnD sensor configuration for all Kanban board surfaces.
 *
 * why: Both the main Kanban board and the overview widget use identical
 * MouseSensor + TouchSensor activation constraints. Centralising them ensures
 * that any future tuning (e.g. increasing touch delay for accessibility)
 * applies to all surfaces simultaneously.
 *
 * Mouse: activates after 5px movement to allow click events to fire normally.
 * Touch: activates after 120ms delay with 8px tolerance to prevent accidental
 *        drags during scroll.
 */
export function useKanbanSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 120, tolerance: 8 }
    })
  );
}
