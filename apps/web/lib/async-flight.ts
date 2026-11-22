"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level registry of in-flight async operations, keyed by a caller-chosen
 * string (e.g. "upload", `analysis:${paperId}`).
 *
 * Long server operations (PDF upload processing, intro generation) outlive the
 * component that started them: client-side navigation unmounts the component
 * and its local "loading" state, while the server keeps working — the UI then
 * lies about nothing being in progress. Keeping the flag here survives
 * unmount/remount for the lifetime of the tab. A full page reload clears it,
 * which is acceptable: the started work still completes server-side and the
 * result appears via server props.
 *
 * Same pattern as components/toast.tsx (module store + useSyncExternalStore).
 */
let flights: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function startFlight(key: string): void {
  if (flights.has(key)) return;
  const next = new Set(flights);
  next.add(key);
  flights = next;
  emit();
}

export function endFlight(key: string): void {
  if (!flights.has(key)) return;
  const next = new Set(flights);
  next.delete(key);
  flights = next;
  if (progress.has(key)) {
    const remaining = new Map(progress);
    remaining.delete(key);
    progress = remaining;
  }
  emit();
}

/**
 * How far along a flight is, 0..1, for the ones that can tell (a file upload).
 * Kept here for the same reason as the flags: the bar must still be right when
 * the user navigates away and comes back. Absent means "in progress, extent
 * unknown".
 */
let progress: ReadonlyMap<string, number> = new Map();

export function setFlightProgress(key: string, fraction: number | null): void {
  const next = new Map(progress);
  if (fraction === null) {
    next.delete(key);
  } else {
    next.set(key, Math.min(1, Math.max(0, fraction)));
  }
  progress = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the given operation is currently in flight (re-renders on change). */
export function useFlight(key: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => flights.has(key),
    () => false
  );
}

/** The flight's progress (0..1), or null while its extent is unknown (re-renders on change). */
export function useFlightProgress(key: string): number | null {
  return useSyncExternalStore(
    subscribe,
    () => progress.get(key) ?? null,
    () => null
  );
}
