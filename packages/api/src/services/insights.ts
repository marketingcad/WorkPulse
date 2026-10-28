import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { clients, holidays, projects, rollupWorkerDay, timeOffPolicies, timeOffRequests } from '@tallywork/db';
import { addDaysToDate, forbidden } from '@tallywork/domain';
import type { InsightsDto } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { listWorkers } from './org';
import { timeOffHoursInRange } from './reports';
import { narrowMemberships } from './scope';
import { priceEntries } from './pay-figures';
import { memberNames } from './timer';

const NONE = ['00000000-0000-7000-8000-000000000000'];

/**
 * Time and money for a date range: totals, per person, per client, per project and per day.
 * Money is priced per entry (see priceEntries): approved time at its approved amounts, the rest at
 * today's rates, an estimate until it is approved. Amounts in a currency other than the
 * workspace currency are left out of the sums and flagged with `other_currency`.
 * Counts finished work only; a timer that is still running is added once it stops.
 */
export async function insights(x: Ctx, from: string, to: string, requested?: string[]): Promise<InsightsDto> {
  const g = x.actor.grants;
  if (!g['time:read']) throw forbidden();
  const target = narrowMemberships(x.actor, 'time:read', requested);
  const moneyPerm = g['billing:read'] ? 'billing:read' : g['rates:read'] ? 'rates:read' : null;
  const moneyVisible = moneyPerm ? narrowMemberships(x.actor, moneyPerm) : [];
  const seesMoney = (m: string) => moneyVisible === 'all' || moneyVisible.includes(m);
  const memberFilter = (col: Parameters<typeof inArray>[0]) => (target === 'all' ? undefined : inArray(col, target.length ? target : NONE));

  const rows = await x.tx
    .select()
    .from(rollupWorkerDay)
    .where(and(gte(rollupWorkerDay.localDate, from), lte(rollupWorkerDay.localDate, to), memberFilter(rollupWorkerDay.membershipId)));

  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const ps = projectIds.length
    ? await x.tx.select({ id: projects.id, name: projects.name, color: projects.color, clientId: projects.clientId, clientName: clients.name }).from(projects).leftJoin(clients, eq(clients.id, projects.clientId)).where(inArray(projects.id, projectIds))
    : [];
  const project = new Map(ps.map((p) => [p.id, p]));

  type Acc = { logged: number; billable: number; active: number; activityTracked: number; pay: number; bill: number };
  const acc = (): Acc => ({ logged: 0, billable: 0, active: 0, activityTracked: 0, pay: 0, bill: 0 });
  const byMember = new Map<string, Acc>();
  const byClient = new Map<string, Acc>();
  const byProject = new Map<string, Acc>();
  const byDay = new Map<string, Acc>();
  const totals = acc();
  let otherCurrency = false;

  for (const r of rows) {
    const secs = r.trackedSeconds + r.manualSeconds;
    const clientId = project.get(r.projectId)?.clientId ?? null;
    for (const [map, key] of [
      [byMember, r.membershipId],
      [byClient, clientId ?? ''],
      [byProject, r.projectId],
      [byDay, r.localDate],
    ] as const) {
      const a = map.get(key) ?? acc();
      a.logged += secs;
      if (r.billable) a.billable += secs;
      a.active += r.activeSeconds;
      a.activityTracked += r.activityTrackedSeconds;
      map.set(key, a);
    }
    totals.logged += secs;
    if (r.billable) totals.billable += secs;
    totals.active += r.activeSeconds;
    totals.activityTracked += r.activityTrackedSeconds;
  }
  // Money per entry, as payroll and approval price it (approved time at its approved amounts).
  if (moneyPerm) {
    for (const e of await priceEntries(x.tx, x.org.currency, from, to, target === 'all' ? 'all' : target)) {
      if (!seesMoney(e.membershipId)) continue;
      if (e.payForeign || e.billForeign) otherCurrency = true;
      for (const [map, key] of [
        [byMember, e.membershipId],
        [byClient, e.clientId ?? ''],
        [byProject, e.projectId],
        [byDay, e.localDate],
      ] as const) {
        const a = map.get(key) ?? acc();
        a.pay += e.payMinor;
        a.bill += e.billMinor;
        map.set(key, a);
      }
      totals.pay += e.payMinor;
      totals.bill += e.billMinor;
    }
  }

  // Everyone in scope is listed, including people with no time in the range.
  const people = g['members:read']
    ? (await listWorkers(x)).filter((w) => w.status !== 'INVITED' && (target === 'all' || target.includes(w.id))).map((w) => ({ id: w.id, name: w.name, title: w.title }))
    : [];
  const known = new Set(people.map((p) => p.id));
  const missing = [...byMember.keys()].filter((m) => !known.has(m));
  if (missing.length) {
    const names = await memberNames(x, missing);
    for (const m of missing) people.push({ id: m, name: names.get(m) ?? '', title: null });
  }

  // Approved time off, clipped to the range (weekends and holidays excluded).
  const ids = people.map((p) => p.id);
  const offRows = ids.length ? await x.tx.select().from(timeOffRequests).where(and(inArray(timeOffRequests.membershipId, ids), eq(timeOffRequests.status, 'APPROVED'), lte(timeOffRequests.startDate, to), gte(timeOffRequests.endDate, from))) : [];
  const daysOff = new Map<string, number>();
  if (offRows.length) {
    const hols = new Set((await x.tx.select({ d: holidays.date }).from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to)))).map((h) => h.d));
    const perDay = new Map((await x.tx.select({ id: timeOffPolicies.id, h: timeOffPolicies.hoursPerDay }).from(timeOffPolicies)).map((p) => [p.id, p.h || 8]));
    for (const t of offRows) {
      const hpd = perDay.get(t.policyId) ?? 8;
      const days = timeOffHoursInRange(t, from, to, hols, hpd) / hpd;
      daysOff.set(t.membershipId, (daysOff.get(t.membershipId) ?? 0) + days);
    }
  }

  const money = (m: number, visible: boolean) => (moneyPerm && visible ? m : null);
  const pct = (a: Acc) => (a.activityTracked > 0 ? Math.round((a.active / a.activityTracked) * 100) : null);
  const round1 = (n: number) => Math.round(n * 10) / 10;
  const allMoney = moneyPerm !== null && moneyVisible === 'all';

  const dayCount = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  // Names of every client listed, including one approved time was billed to that no project has now.
  const clientIds = [...byClient.keys()].filter(Boolean);
  const clientNames = new Map(clientIds.length ? (await x.tx.select({ id: clients.id, name: clients.name }).from(clients).where(inArray(clients.id, clientIds))).map((c) => [c.id, c.name]) : []);
  return {
    from,
    to,
    currency: x.org.currency,
    money_visible: moneyPerm !== null,
    other_currency: otherCurrency,
    totals: {
      logged_seconds: totals.logged,
      billable_seconds: totals.billable,
      activity_pct: pct(totals),
      pay_minor: money(totals.pay, true),
      bill_minor: money(totals.bill, true),
      days_off: round1([...daysOff.values()].reduce((a, b) => a + b, 0)),
      people_with_time: byMember.size,
      clients_with_time: [...byClient.keys()].filter(Boolean).length,
      projects_with_time: byProject.size,
      billable_clients: [...byClient.entries()].filter(([k, a]) => k && a.billable > 0).length,
      billable_projects: [...byProject.values()].filter((a) => a.billable > 0).length,
      paid_people: [...byMember.values()].filter((a) => a.pay > 0).length,
    },
    members: people
      .map((p) => {
        const a = byMember.get(p.id) ?? acc();
        return {
          membership_id: p.id,
          name: p.name,
          title: p.title,
          logged_seconds: a.logged,
          billable_seconds: a.billable,
          activity_pct: pct(a),
          pay_minor: money(a.pay, seesMoney(p.id)),
          bill_minor: money(a.bill, seesMoney(p.id)),
          days_off: round1(daysOff.get(p.id) ?? 0),
        };
      })
      .sort((a, b) => b.logged_seconds - a.logged_seconds || a.name.localeCompare(b.name)),
    by_client: [...byClient.entries()]
      .map(([id, a]) => ({ client_id: id || null, name: id ? (clientNames.get(id) ?? '') : 'No client', seconds: a.logged, billable_seconds: a.billable, bill_minor: money(a.bill, allMoney) }))
      .sort((a, b) => b.seconds - a.seconds),
    by_project: [...byProject.entries()]
      .map(([id, a]) => {
        const p = project.get(id);
        return { project_id: id, name: p?.name ?? '', color: p?.color ?? '#4B4FC4', client_name: p?.clientName ?? null, seconds: a.logged, billable_seconds: a.billable, bill_minor: money(a.bill, allMoney) };
      })
      .sort((a, b) => b.seconds - a.seconds),
    by_day: Array.from({ length: dayCount }, (_, i) => {
      const d = addDaysToDate(from, i);
      const a = byDay.get(d);
      return { date: d, seconds: a?.logged ?? 0, billable_seconds: a?.billable ?? 0, pay_minor: money(a?.pay ?? 0, true), bill_minor: money(a?.bill ?? 0, true) };
    }),
  };
}
