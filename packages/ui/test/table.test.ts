import { describe, expect, it } from 'vitest';
import { mobileColumns, type Column } from '../src';

const col = (key: string, extra: Partial<Column<unknown>> = {}): Column<unknown> => ({ key, header: key, cell: () => key, ...extra });
const keys = (cs: Column<unknown>[]) => cs.map((c) => c.key);

describe('mobileColumns', () => {
  it('keeps the actions column on the stacked layout', () => {
    const m = mobileColumns([col('name', { priority: 'primary' }), col('status', { priority: 'secondary' }), col('amount'), col('actions')]);
    expect(keys(m.shown)).toEqual(['name']);
    expect(keys(m.meta)).toEqual(['status']);
    expect(keys(m.actions)).toEqual(['actions']);
  });

  it('treats a column marked actions as an action, whatever its key', () => {
    const m = mobileColumns([col('period'), col('pdf', { actions: true })]);
    expect(keys(m.actions)).toEqual(['pdf']);
    expect(keys(m.shown)).toEqual(['period']);
  });

  it('lets a column keyed actions opt out', () => {
    expect(keys(mobileColumns([col('name'), col('actions', { actions: false })]).actions)).toEqual([]);
  });

  it('never uses an actions column as the fallback title or detail line', () => {
    const m = mobileColumns([col('actions'), col('name'), col('date'), col('hours'), col('extra')]);
    expect(keys(m.shown)).toEqual(['name']);
    expect(keys(m.meta)).toEqual(['date', 'hours']);
    expect(keys(m.actions)).toEqual(['actions']);
  });
});
