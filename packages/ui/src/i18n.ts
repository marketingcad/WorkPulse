/**
 * Translation and locale. English (`en`) is the base catalog; other catalogs may cover any subset
 * of its keys and fall back to English for the rest. Messages use `{name}` placeholders and ICU
 * style plurals: `{count, plural, one {# member} other {# members}}`.
 *
 * The active locale is process-wide (set once from the signed-in person's settings) so the plain
 * formatting helpers in format.ts can use it without threading it through every call.
 */
import { uiEn } from './messages/en';

export type Catalog = Record<string, string>;

const catalogs = new Map<string, Catalog>();
let base: Catalog = {};
let active: Catalog = {};
let locale = 'en-US';
const listeners = new Set<() => void>();

/** Add messages for a language (merged with what is already registered for it). */
export function registerCatalog(lang: string, messages: Catalog, opts: { base?: boolean } = {}) {
  const merged = { ...catalogs.get(lang.toLowerCase()), ...messages };
  catalogs.set(lang.toLowerCase(), merged);
  if (opts.base) base = merged;
  setLocale(locale);
}

/** A BCP 47 tag the runtime understands, or `en-US`. */
export function normalizeLocale(tag: string | null | undefined): string {
  try {
    return (tag && Intl.getCanonicalLocales(tag)[0]) || 'en-US';
  } catch {
    return 'en-US';
  }
}

/** Switch locale: formatting follows it, and messages come from the closest catalog (fr-CA → fr → en). */
export function setLocale(tag: string | null | undefined) {
  locale = normalizeLocale(tag);
  const lang = locale.toLowerCase();
  active = catalogs.get(lang) ?? catalogs.get(lang.split('-')[0]!) ?? base;
  for (const l of listeners) l();
}

export function getLocale(): string {
  return locale;
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const PLURAL = /\{(\w+),\s*plural,\s*((?:[=\w]+\s*\{[^{}]*\}\s*)+)\}/g;

/** Look up and fill a message. Unknown keys return the key itself, so gaps are visible, never blank. */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const msg = active[key] ?? base[key] ?? key;
  const rules = new Intl.PluralRules(locale);
  return msg
    .replace(PLURAL, (_, name: string, forms: string) => {
      const n = Number(vars[name] ?? 0);
      const options = Object.fromEntries([...forms.matchAll(/([=\w]+)\s*\{([^{}]*)\}/g)].map((m) => [m[1]!, m[2]!]));
      const chosen = options[`=${n}`] ?? options[rules.select(n)] ?? options.other ?? '';
      return chosen.replace(/#/g, new Intl.NumberFormat(locale).format(n));
    })
    .replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Placeholders a message uses (for checking that translations keep them). */
export function placeholders(msg: string): string[] {
  const names = new Set<string>();
  for (const m of msg.matchAll(/\{(\w+)(?:,\s*plural)?/g)) names.add(m[1]!);
  return [...names].sort();
}

/** Problems with a translation catalog compared with the base: unknown keys and changed placeholders. */
export function checkCatalog(baseCatalog: Catalog, other: Catalog): string[] {
  const problems: string[] = [];
  for (const [k, v] of Object.entries(other)) {
    if (!(k in baseCatalog)) problems.push(`unknown key ${k}`);
    else if (placeholders(v).join() !== placeholders(baseCatalog[k]!).join()) problems.push(`${k}: placeholders ${placeholders(v).join(',')} ≠ ${placeholders(baseCatalog[k]!).join(',')}`);
  }
  return problems;
}

registerCatalog('en', uiEn, { base: true });
