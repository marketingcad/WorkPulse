import { useEffect, useState } from 'react';
import {
  Award,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Clock3,
  Crown,
  Flag,
  Flame,
  Gem,
  Heart,
  ListChecks,
  RefreshCw,
  Repeat,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Target,
  Trophy,
  Users,
  WifiOff,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { AgentState } from '../../shared/ipc';
import { Badge, Card, Page, Stat, Status } from './Pages';
import { fmtDay, fmtHm, useMe } from './lib';

/** GET /agent/me/performance (packages/api/src/services/my-performance.ts). The worker's own data only. */
type Tier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';
interface AwardDto {
  id: string;
  name: string;
  icon: string;
  tier: Tier | null;
  source: 'AUTOMATIC' | 'MANAGER' | 'CLIENT';
  awarded_by: string | null;
  reason: string | null;
  created_at: string;
}
interface Goal {
  id: string;
  title: string;
  subject_type: 'MEMBER' | 'TEAM' | 'PROJECT' | 'ORG';
  subject_name: string;
  metric: 'TASKS_COMPLETED' | 'MILESTONES_COMPLETED' | 'APPROVED_HOURS' | 'ON_TIME_PCT';
  target: number;
  current: number;
  progress_pct: number;
  status: 'ACTIVE' | 'COMPLETED' | 'MISSED' | 'ARCHIVED';
  pace: 'AHEAD' | 'ON_TRACK' | 'AT_RISK' | null;
  end_date: string;
}
interface Review {
  id: string;
  reviewer: { name: string };
  period_start: string;
  period_end: string;
  quality_rating: number | null;
  summary: string | null;
  strengths: string[];
  improvements: string[];
  recommendations: string | null;
}
export interface MyPerformance {
  week: { start: string; end: string; approved_seconds: number; scheduled_seconds: number; tasks_done: number; tasks_due: number; streak_weeks: number };
  goals: Goal[];
  badges: AwardDto[];
  recognition: AwardDto[];
  next_badge: { name: string; icon: string; tier: Tier | null; value: number; target: number; pct: number } | null;
  milestones: Array<{ id: string; title: string; project: string; due_date: string; completed_at: string | null; on_time: boolean | null }>;
  /** only when the organization shares scores with workers */
  score: { score: number | null; coverage: number } | null;
  trend: Array<{ period_start: string; score: number | null }>;
  reviews: Review[];
}

const ICONS: Record<string, LucideIcon> = { award: Award, 'check-circle': CheckCircle2, 'calendar-check': CalendarCheck, flag: Flag, repeat: Repeat, clock: Clock, crown: Crown, heart: Heart, star: Star, gem: Gem, smile: Smile, trophy: Trophy, target: Target, zap: Zap, rocket: Rocket, 'shield-check': ShieldCheck, users: Users, sparkles: Sparkles };
const TIER_LABEL: Record<Tier, string> = { BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum' };
const TIER_CLASS: Record<Tier, string> = { BRONZE: 'bg-tier-bronze-soft text-tier-bronze', SILVER: 'bg-tier-silver-soft text-tier-silver', GOLD: 'bg-tier-gold-soft text-tier-gold', PLATINUM: 'bg-tier-platinum-soft text-tier-platinum' };
const HEX = 'polygon(50% 0, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)';

function BadgeIcon({ icon, tier, size = 40, dim }: { icon: string; tier: Tier | null; size?: number; dim?: boolean }) {
  const Icon = ICONS[icon] ?? Award;
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center ${TIER_CLASS[tier ?? 'GOLD']} ${dim ? 'opacity-50' : ''}`} style={{ width: size, height: Math.round(size * 1.13), clipPath: HEX }}>
      <Icon className="size-[45%]" strokeWidth={2.2} />
    </span>
  );
}

function Bar({ pct, label, tone = 'bg-interactive' }: { pct: number; label: string; tone?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-surface-muted" role="img" aria-label={label}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

const goalValue = (g: Goal, v: number) => (g.metric === 'APPROVED_HOURS' ? `${Math.round(v * 10) / 10} h` : g.metric === 'ON_TIME_PCT' ? `${Math.round(v)}%` : String(Math.round(v)));
const sourceText: Record<AwardDto['source'], string> = { AUTOMATIC: 'Earned from your work', MANAGER: 'From your manager', CLIENT: 'From a client' };
const cacheKey = (membershipId: string) => `wp.myPerformance.${membershipId}`;

/**
 * My performance: the worker's own goals, badges, recognition, milestones and shared reviews. Their
 * score only when their organization shares it. Never anyone else's data, a ranking, activity or
 * screenshots. When it cannot be loaded (for example offline), the last copy is shown and labelled.
 */
export function PerformancePage({ s }: { s: AgentState }) {
  const q = useMe<MyPerformance>('performance', {}, { refreshMs: 5 * 60_000 });
  const key = cacheKey(s.account?.membershipId ?? 'me');
  const [saved, setSaved] = useState<{ at: string; data: MyPerformance } | null>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { at: string; data: MyPerformance }) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!q.data) return;
    const copy = { at: new Date().toISOString(), data: q.data };
    setSaved(copy);
    try {
      localStorage.setItem(key, JSON.stringify(copy));
    } catch {
      // Storage full or blocked: the page still works, without an offline copy.
    }
  }, [q.data, key]);

  const fromCache = !q.data && !!q.error && !!saved;
  const d = q.data ?? (fromCache ? saved!.data : null);

  return (
    <Page
      title="My performance"
      description="Your goals, badges and recognition, from your approved work, tasks and milestones. Never your activity or screenshots."
      actions={
        <button onClick={q.reload} disabled={q.loading} className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-surface-muted disabled:opacity-50">
          <RefreshCw className={`size-4 ${q.loading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden /> Refresh
        </button>
      }
    >
      {fromCache && (
        <p role="status" className="flex items-center gap-2 rounded-sm bg-warning-soft px-3 py-2 text-xs text-warning">
          <WifiOff className="size-3.5 shrink-0" aria-hidden />
          Could not refresh ({q.error}). Showing the copy saved {new Date(saved!.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.
        </p>
      )}
      {!d ? (
        <Card>
          <Status loading={q.loading} error={q.error} onRetry={q.reload} />
        </Card>
      ) : (
        <Body d={d} />
      )}
    </Page>
  );
}

function Body({ d }: { d: MyPerformance }) {
  const w = d.week;
  const goals = d.goals.filter((g) => g.status !== 'ARCHIVED');
  const upcoming = d.milestones.filter((m) => !m.completed_at);
  const delivered = d.milestones.filter((m) => m.completed_at);
  return (
    <>
      <section aria-label="This week" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Approved this week" value={fmtHm(w.approved_seconds)} hint={w.scheduled_seconds ? `of ${fmtHm(w.scheduled_seconds)} scheduled` : `${fmtDay(w.start)} – ${fmtDay(w.end)}`} icon={Clock3} color="blue" />
        <Stat label="Tasks done this week" value={String(w.tasks_done)} hint={w.tasks_due ? `${w.tasks_due} due this week` : 'None due this week'} icon={ListChecks} color="green" />
        <Stat label="Consistency streak" value={`${w.streak_weeks} ${w.streak_weeks === 1 ? 'week' : 'weeks'}`} hint="Weeks with approved time on every scheduled day" icon={Flame} color="amber" />
        <Stat label="Badges" value={String(d.badges.length)} hint={d.recognition.length ? `${d.recognition.length} from managers or clients` : undefined} icon={Award} color="violet" />
      </section>

      {d.score && (
        <Card title="Your score this month" right={<span className="text-2xs text-text-muted">Shared by your organization</span>}>
          <div className="flex flex-wrap items-center gap-4 px-4 py-3">
            <span className="tabular text-3xl font-extrabold">{d.score.score === null ? '—' : Math.round(d.score.score)}</span>
            <span className="text-sm text-text-muted">{d.score.score === null ? 'Not enough measured yet this month.' : `out of 100 · ${d.score.coverage}% of the score measured`}</span>
            {d.trend.some((t) => t.score !== null) && (
              <ol className="ml-auto flex items-end gap-1" aria-label="Your score in recent months">
                {d.trend.map((t) => (
                  <li key={t.period_start} className="flex flex-col items-center gap-0.5">
                    <span className="w-5 rounded-t-sm bg-interactive" style={{ height: `${Math.max(2, ((t.score ?? 0) / 100) * 40)}px`, opacity: t.score === null ? 0.25 : 1 }} aria-hidden />
                    <span className="text-2xs text-text-muted">{fmtDay(t.period_start, { month: 'short' })}</span>
                    <span className="sr-only">{t.score === null ? 'no score' : Math.round(t.score)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-3 md:gap-4 lg:grid-cols-2">
        <Card title="My goals">
          <Status loading={false} error={null} empty={!goals.length && 'No goals yet. When your manager sets one, it shows here with your progress.'}>
            <ul className="divide-y divide-border">
              {goals.map((g) => (
                <li key={g.id} className="space-y-1.5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.title}</span>
                    {g.status === 'ACTIVE' ? (
                      g.pace && <Badge tone={g.pace === 'AT_RISK' ? 'warning' : g.pace === 'AHEAD' ? 'success' : 'info'}>{g.pace === 'AT_RISK' ? 'At risk' : g.pace === 'AHEAD' ? 'Ahead' : 'On track'}</Badge>
                    ) : (
                      <Badge tone={g.status === 'COMPLETED' ? 'success' : 'danger'}>{g.status === 'COMPLETED' ? 'Completed' : 'Missed'}</Badge>
                    )}
                  </div>
                  <Bar pct={g.progress_pct} label={`${Math.round(g.progress_pct)}% of the target`} tone={g.status === 'COMPLETED' ? 'bg-success' : g.pace === 'AT_RISK' ? 'bg-warning' : 'bg-interactive'} />
                  <p className="tabular text-2xs text-text-muted">
                    {goalValue(g, g.current)} of {goalValue(g, g.target)} · {g.subject_type === 'MEMBER' ? 'Your goal' : `${g.subject_type === 'TEAM' ? 'Team' : 'Project'}: ${g.subject_name}`} · ends {fmtDay(g.end_date)}
                  </p>
                </li>
              ))}
            </ul>
          </Status>
        </Card>

        <Card title="Next badge">
          {d.next_badge ? (
            <div className="flex items-center gap-3 px-4 py-3">
              <BadgeIcon icon={d.next_badge.icon} tier={d.next_badge.tier} size={44} dim />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm font-medium">
                  {d.next_badge.name}
                  {d.next_badge.tier && <span className="text-text-muted"> · {TIER_LABEL[d.next_badge.tier]}</span>}
                </p>
                <Bar pct={d.next_badge.pct} label={`${d.next_badge.pct}% of the way`} />
                <p className="tabular text-2xs text-text-muted">
                  {d.next_badge.value} of {d.next_badge.target}
                </p>
              </div>
            </div>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-text-muted">You have every level of the badges earned from work. Well done.</p>
          )}
        </Card>
      </div>

      <Card title="My badges">
        <Status loading={false} error={null} empty={!d.badges.length && 'No badges yet. They are earned from your work, like tasks done, on-time days and approved hours, and given by your manager.'}>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3 p-4">
            {d.badges.map((b) => (
              <li key={b.id} className="flex flex-col items-center gap-1 text-center">
                <BadgeIcon icon={b.icon} tier={b.tier} />
                <span className="text-xs font-medium">{b.name}</span>
                <span className="text-2xs text-text-muted">
                  {b.tier ? `${TIER_LABEL[b.tier]} · ` : ''}
                  {fmtDay(b.created_at.slice(0, 10), { month: 'short', day: 'numeric' })}
                </span>
              </li>
            ))}
          </ul>
        </Status>
      </Card>

      <div className="grid gap-3 md:gap-4 lg:grid-cols-2">
        <Card title="Recognition">
          <Status loading={false} error={null} empty={!d.recognition.length && 'When a manager or a client recognizes your work, it shows here with what they said.'}>
            <ul className="divide-y divide-border">
              {d.recognition.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <BadgeIcon icon={r.icon} tier={r.tier} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r.name}</p>
                    {r.reason && <p className="text-sm text-text-muted">“{r.reason}”</p>}
                    <p className="text-2xs text-text-muted">
                      {r.awarded_by ? `${sourceText[r.source]} · ${r.awarded_by}` : sourceText[r.source]} · {fmtDay(r.created_at.slice(0, 10))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Status>
        </Card>

        <Card title="My milestones">
          <Status loading={false} error={null} empty={!d.milestones.length && 'No milestones on your projects right now.'}>
            <ul className="divide-y divide-border">
              {[...upcoming, ...delivered].map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="truncate text-2xs text-text-muted">
                      {m.project} · due {fmtDay(m.due_date)}
                    </p>
                  </div>
                  {m.completed_at ? <Badge tone={m.on_time ? 'success' : 'warning'}>{m.on_time ? 'Done on time' : 'Done late'}</Badge> : <Badge tone={m.due_date < new Date().toISOString().slice(0, 10) ? 'danger' : 'neutral'}>{m.due_date < new Date().toISOString().slice(0, 10) ? 'Overdue' : 'Open'}</Badge>}
                </li>
              ))}
            </ul>
          </Status>
        </Card>
      </div>

      {d.reviews.length > 0 && (
        <Card title="Feedback from your manager">
          <ul className="divide-y divide-border">
            {d.reviews.map((r) => (
              <li key={r.id} className="space-y-2 px-4 py-3 text-sm">
                <p className="font-medium">
                  {fmtDay(r.period_start, { month: 'short', day: 'numeric', year: 'numeric' })} – {fmtDay(r.period_end, { month: 'short', day: 'numeric', year: 'numeric' })} · {r.reviewer.name}
                  {r.quality_rating !== null && <span className="text-text-muted"> · {r.quality_rating} of 5</span>}
                </p>
                {r.summary && <p>{r.summary}</p>}
                {r.strengths.length > 0 && <p className="text-text-muted">Strengths: {r.strengths.join(', ')}</p>}
                {r.improvements.length > 0 && <p className="text-text-muted">Areas to grow: {r.improvements.join(', ')}</p>}
                {r.recommendations && <p className="text-text-muted">Plan: {r.recommendations}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
