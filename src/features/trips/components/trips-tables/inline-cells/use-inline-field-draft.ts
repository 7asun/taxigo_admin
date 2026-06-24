'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseInlineFieldDraftOptions<T extends string> {
  initialValue: T;
  debounceMs?: number;
  onPersist: (value: T) => void;
}

export interface UseInlineFieldDraftResult<T extends string> {
  draft: T;
  setDraft: (v: T) => void;
  flush: () => void;
}

/**
 * WHY: mutation-agnostic local draft + debounced persist shared across inline table cells;
 * draftRef ensures flush/blur reads the latest typed value (not stale closure state).
 * Loading state (`isPending`) stays in mutation hooks — not here.
 */
export function useInlineFieldDraft<T extends string>({
  initialValue,
  debounceMs = 1500,
  onPersist
}: UseInlineFieldDraftOptions<T>): UseInlineFieldDraftResult<T> {
  const draftRef = useRef<T>(initialValue);
  const [draft, setDraftState] = useState<T>(initialValue);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPersistRef = useRef(onPersist);

  useEffect(() => {
    onPersistRef.current = onPersist;
  }, [onPersist]);

  // Sync draft when server row refreshes (RSC / realtime).
  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    draftRef.current = initialValue;
    setDraftState(initialValue);
  }, [initialValue]);

  const setDraft = useCallback(
    (v: T) => {
      draftRef.current = v;
      setDraftState(v);
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        onPersistRef.current(draftRef.current);
      }, debounceMs);
    },
    [debounceMs]
  );

  const flush = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    onPersistRef.current(draftRef.current);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return { draft, setDraft, flush };
}
