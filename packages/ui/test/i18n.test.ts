import { afterEach, describe, expect, it } from 'vitest';
import { checkCatalog, fmtDate, fmtDuration, fmtMoney, fmtRelative, getLocale, normalizeLocale, registerCatalog, setLocale, t, uiEn } from '../src';

afterEach(() => setLocale('en-US'));
/** Intl uses non-breaking spaces in some locales; compare with plain spaces. */
const sp = (s: string) => s.replace(/\s/g, ' ');

describe('messages', () => {
  it('fills placeholders and plurals, falls back to English, and shows unknown keys', () => {
    expect(t('table.rows', { count: 1 })).toBe('1 row');
    expect(t('table.rows', { count: 1200 })).toBe('1,200 rows');
    expect(t('table.selected', { count: 3 })).toBe('3 selected');
    expect(t('no.such.key')).toBe('no.such.key');
    registerCatalog('fr', { 'common.cancel': 'Annuler', 'table.rows': '{count, plural, one {# ligne} other {# lignes}}' });
    setLocale('fr-CA');
    expect(t('common.cancel')).toBe('Annuler');
    expect(sp(t('table.rows', { count: 1200 }))).toBe('1 200 lignes');
    expect(t('common.save')).toBe('Save'); // not translated yet → English
  });

  it('checks translations against the base: unknown keys and changed placeholders', () => {
    expect(checkCatalog(uiEn, { 'common.cancel': 'Annuler' })).toEqual([]);
    expect(checkCatalog(uiEn, { 'common.nope': 'x', 'table.selected': '{n} sélectionnés' })).toEqual(['unknown key common.nope', 'table.selected: placeholders n ≠ count']);
  });

  it('normalizes locale tags and ignores invalid ones', () => {
    expect(normalizeLocale('en-us')).toBe('en-US');
    expect(normalizeLocale('not a tag')).toBe('en-US');
    setLocale('de-DE');
    expect(getLocale()).toBe('de-DE');
  });
});

describe('formatting follows the locale', () => {
  it('money, dates, decimals and relative times', () => {
    expect(fmtMoney(123456, 'USD')).toBe('$1,234.56');
    expect(fmtDate('2026-09-26')).toBe('Sep 26, 2026');
    setLocale('de-DE');
    expect(sp(fmtMoney(123456, 'EUR'))).toBe('1.234,56 €');
    expect(fmtDate('2026-09-26')).toBe('26. Sept. 2026');
    expect(fmtDuration(5400, 'decimal')).toBe('1,50');
    expect(sp(fmtRelative(new Date(Date.now() - 3 * 3600_000).toISOString()))).toBe('vor 3 Std.');
  });
});
