'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { OrgContextDto } from '@tallywork/contracts';
import type { Permission, Scope } from '@tallywork/domain';
import { fmtDuration as baseFmt, type DurationFormat } from '@tallywork/ui';

export interface OrgValue extends OrgContextDto {
  can: (p: Permission, scope?: Scope) => boolean;
  /** true when the actor sees beyond themselves (manager/admin) */
  isManagerView: boolean;
  isAdmin: boolean;
  fmtDuration: (s: number | null | undefined) => string;
  base: string;
}

const Ctx = createContext<OrgValue | null>(null);

export function OrgProvider({ value, children }: { value: OrgContextDto; children: ReactNode }) {
  const grants = value.grants;
  const format = ((value.organization.settings as { durationFormat?: DurationFormat }).durationFormat ?? 'hm') as DurationFormat;
  const v: OrgValue = {
    ...value,
    can: (p, scope) => {
      const g = grants[p];
      if (!g) return false;
      if (!scope) return true;
      return g === 'org' || g === scope;
    },
    isManagerView: !!grants['tracking:read'] && grants['tracking:read'] !== 'own',
    isAdmin: grants['org:update'] === 'org',
    fmtDuration: (s) => baseFmt(s, format),
    base: `/o/${value.organization.id}`,
  };
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useOrg(): OrgValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useOrg must be used inside the org layout');
  return v;
}

/** Local date helpers in the org / viewer timezone. */
export function todayIn(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekStartOf(date: string, weekStart: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  const diff = (d.getUTCDay() - weekStart + 7) % 7;
  return addDays(date, -diff);
}
