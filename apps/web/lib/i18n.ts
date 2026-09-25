'use client';
/**
 * Web app i18n glue. Importing this module registers the web catalog as part of the English base,
 * so import `t` from here (not from @tallywork/ui) in app code to be sure the keys are loaded.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { getLocale, onLocaleChange, registerCatalog, setLocale, t } from '@tallywork/ui';
import { webEn } from '@/messages/en';

registerCatalog('en', webEn, { base: true });

export { t };
export type WebMessageKey = keyof typeof webEn;

/** The active locale; components using it re-render when it changes. */
export function useLocale(): string {
  return useSyncExternalStore(onLocaleChange, getLocale, getLocale);
}

// Once the signed-in person's own setting is known it wins over the browser language.
let fromAccount = false;

/** Switch to the person's saved locale (from GET/PATCH /me). */
export function applyAccountLocale(tag: string | null | undefined) {
  fromAccount = true;
  setLocale(tag);
}

/** Signed-out pages: format with the browser language. */
export function useBrowserLocale() {
  useEffect(() => {
    if (!fromAccount && typeof navigator !== 'undefined') setLocale(navigator.language);
  }, []);
}

/** Signed-in pages: follow the locale saved on the account. */
export function useAccountLocale(tag: string | null | undefined) {
  useEffect(() => {
    if (tag) applyAccountLocale(tag);
  }, [tag]);
}
