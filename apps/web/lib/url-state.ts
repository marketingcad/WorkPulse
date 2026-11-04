'use client';
import { useEffect, useRef, useState } from 'react';
import { useUrlParams } from '@/components/timesheets/use-url-params';
import { useDefaultRange } from '@/components/tracking/filters';
import type { DateRange, RangePreset } from '@/components/tracking/time';
import { parseRange, rangeParams } from './url-range';

/**
 * List state kept in the address (UX audit: filters were lost on refresh and Back, and a shared link
 * did not show the same list). Changes replace the current history entry, so Back leaves the page
 * instead of stepping through every filter change, and comes back to the list as it was left.
 * Anything invalid or out of date in the address falls back to the default, never to an error.
 */

export function useUrlRange(defaultPreset: Exclude<RangePreset, 'custom'>): [DateRange, (r: DateRange) => void] {
  const [p, set] = useUrlParams(['range', 'from', 'to'] as const);
  const fallback = useDefaultRange(defaultPreset);
  const presets = {
    today: useDefaultRange('today'),
    yesterday: useDefaultRange('yesterday'),
    this_week: useDefaultRange('this_week'),
    last_week: useDefaultRange('last_week'),
  };
  return [parseRange(p, fallback, (name) => presets[name]), (r) => set(rangeParams(r, fallback))];
}

/** One value in the address, limited to `allowed` when given; the default is left out of the address. */
export function useUrlValue<T extends string>(key: string, fallback: T, allowed?: readonly T[]): [T, (v: T) => void] {
  const [p, set] = useUrlParams([key] as const);
  const raw = p[key] ?? null;
  const value = raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as T) : fallback;
  return [value, (v) => set({ [key]: v === fallback ? null : v })];
}

/** A search box backed by the address: typing updates the box at once and the address a moment later. */
export function useUrlSearch(key = 'q', delay = 300) {
  const [p, set] = useUrlParams([key] as const);
  const term = (p[key] ?? '').trim();
  const [input, setInput] = useState(term);
  const written = useRef(term);
  // Back/Forward (or a link) changed the address: show its term. Not when the change was our own
  // debounced write, which would overwrite what was typed since.
  useEffect(() => {
    if (term !== written.current) {
      written.current = term;
      setInput(term);
    }
  }, [term]);
  useEffect(() => {
    if (input.trim() === term) return;
    const id = setTimeout(() => {
      written.current = input.trim();
      set({ [key]: input.trim() || null });
    }, delay);
    return () => clearTimeout(id);
  }, [input, term, delay, key, set]);
  return { input, setInput, term };
}

/** An id from the address: a well-formed UUID, or nothing (a broken link must not reach the API). */
export function isId(v: string | null): v is string {
  return !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/** A member, project or other id in the address; anything malformed reads as "all". */
export function useUrlId(key: string): [string, (v: string) => void] {
  const [p, set] = useUrlParams([key] as const);
  const raw = p[key] ?? null;
  return [isId(raw) ? raw : '', (v) => set({ [key]: v || null })];
}
