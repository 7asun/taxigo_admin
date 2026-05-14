import { create } from 'zustand';
import type { Table, VisibilityState } from '@tanstack/react-table';

interface TripsTableStore {
  table: Table<any> | null;
  columnVisibility: VisibilityState;
  /** Mirrored from `table.getState().columnOrder` in TripsTable — for snapshots & active preset detection. */
  columnOrder: string[];
  /**
   * Queued from “Ansichten” when switching Kanban → Liste: TanStack instance is
   * null until TripsTable mounts — we apply and clear in TripsTable’s effect.
   */
  pendingColumnVisibility: VisibilityState | null;
  /**
   * Same pattern as pendingColumnVisibility — preset column order when list table
   * is not mounted (e.g. Kanban → Liste).
   */
  pendingColumnOrder: string[] | null;
  setTable: (table: Table<any> | null) => void;
  setColumnVisibility: (visibility: VisibilityState) => void;
  setColumnOrder: (order: string[]) => void;
  setPendingColumnVisibility: (visibility: VisibilityState | null) => void;
  setPendingColumnOrder: (order: string[] | null) => void;
}

export const useTripsTableStore = create<TripsTableStore>((set) => ({
  table: null,
  columnVisibility: {},
  columnOrder: [],
  pendingColumnVisibility: null,
  pendingColumnOrder: null,
  setTable: (table) => set({ table }),
  setColumnVisibility: (columnVisibility) => set({ columnVisibility }),
  setColumnOrder: (columnOrder) => set({ columnOrder }),
  setPendingColumnVisibility: (pendingColumnVisibility) =>
    set({ pendingColumnVisibility }),
  setPendingColumnOrder: (pendingColumnOrder) => set({ pendingColumnOrder })
}));
