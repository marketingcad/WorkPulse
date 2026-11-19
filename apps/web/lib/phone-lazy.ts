'use client';
import { useEffect, useState } from 'react';

/**
 * The phone module (@tallywork/contracts/phone) loaded on demand: it carries libphonenumber's
 * numbering plan data, about 30 KB gzipped, which would otherwise be part of the first load of every
 * page with a phone field (bundle budget, 20 Nov 2026).
 */
export type PhoneModule = typeof import('@tallywork/contracts/phone');

let loaded: PhoneModule | null = null;
let pending: Promise<PhoneModule> | null = null;

/** Loads the phone module once; later calls get the same promise. */
export function loadPhone(): Promise<PhoneModule> {
  pending ??= import('@tallywork/contracts/phone').then((m) => (loaded = m));
  return pending;
}

/**
 * The phone module if it has been loaded, else null. A phone value can only change by typing in a
 * PhoneInput, which loads the module before it shows, so a form's check of a changed number always
 * has it. The server checks every number anyway.
 */
export function loadedPhone(): PhoneModule | null {
  return loaded;
}

/** The phone module for a component, starting to load it on mount; null until it is loaded. */
export function usePhone(): PhoneModule | null {
  const [m, setM] = useState<PhoneModule | null>(loaded);
  useEffect(() => {
    if (m) return;
    let live = true;
    void loadPhone().then((x) => live && setM(x));
    return () => {
      live = false;
    };
  }, [m]);
  return m;
}
