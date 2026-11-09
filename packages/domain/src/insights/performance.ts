import { findingId } from './compare';
import type { Finding, Period } from './types';

/**
 * Why a Performance Center score moved, from the scores the Performance Center itself computed.
 * This never computes a score: it compares two existing results part by part. No activity,
 * screenshots or review notes are involved (quality is the average rating already in the score).
 */
type Metric5 = 'goals' | 'delivery' | 'consistency' | 'quality' | 'attendance';
const METRICS: Metric5[] = ['goals', 'delivery', 'consistency', 'quality', 'attendance'];
const LABEL: Record<Metric5, string> = { goals: 'Goal completion', delivery: 'Project delivery', consistency: 'Approved-work consistency', quality: 'Quality', attendance: 'Attendance' };
const SUGGESTION: Record<Metric5, string> = {
  goals: 'Agree fewer, clearer goals with due dates.',
  delivery: 'Review task estimates and due dates together.',
  consistency: 'Submit timesheets every period.',
  quality: "Discuss the last review's points in a 1:1.",
  attendance: 'Check the schedule matches when work really starts.',
};

export interface ScoreSnapshot {
  score: number | null;
  coverage: number;
  parts: Record<Metric5, { value: number | null; weight: number; effective_weight: number }>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function explainScore(input: { subject: { type: 'member' | 'team'; id: string; name: string }; period: Period; previous: Period; current: ScoreSnapshot; before: ScoreSnapshot | null }): { findings: Finding[]; limitations: string[] } {
  const { subject, period, current, before } = input;
  const findings: Finding[] = [];
  const limitations: string[] = [];
  const base = { section: 'performance' as const, period, refs: [{ type: subject.type, id: subject.id, name: subject.name }], links: ['performance' as const] };
  if (current.score === null) return { findings, limitations: ['Not enough measured this period to give a score.'] };

  if (!before || before.score === null) limitations.push('No earlier score to compare with.');
  else {
    const change = round1(current.score - before.score);
    findings.push({
      ...base,
      id: findingId('performance', 'score_change', subject.id),
      category: 'score_change',
      severity: change <= -10 ? 'attention' : 'info',
      basis: 'observation',
      title: `${subject.name}'s score ${change > 0 ? 'rose' : change < 0 ? 'fell' : 'held'}${change ? ` by ${Math.abs(change)} points` : ''}`,
      summary: `${current.score} this period against ${before.score} in the previous period, as computed by the Performance Center.`,
      metrics: [
        { label: 'Score', value: current.score, unit: 'count', previous: before.score },
        { label: 'Change (points)', value: change, unit: 'count' },
      ],
      next_step: 'Open the Performance Center for the full breakdown.',
    });
    // The parts whose change moved the score most: change in value times the weight it carried.
    const moves = METRICS.map((m) => {
      const now = current.parts[m];
      const then = before.parts[m];
      if (now.value === null || then.value === null) return null;
      return { m, now: now.value, then: then.value, impact: (now.value - then.value) * now.effective_weight };
    })
      .filter((x): x is NonNullable<typeof x> => !!x && x.impact !== 0)
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .slice(0, 2);
    if (moves.length) {
      findings.push({
        ...base,
        id: findingId('performance', 'drivers', subject.id),
        category: 'drivers',
        severity: 'info',
        basis: 'observation',
        title: 'What moved the score',
        summary: moves.map((d) => `${LABEL[d.m]} went from ${round1(d.then)} to ${round1(d.now)}`).join('; ') + '.',
        metrics: moves.map((d) => ({ label: LABEL[d.m], value: round1(d.now), unit: 'percent' as const, previous: round1(d.then) })),
        next_step: 'Talk through these parts in the next 1:1.',
      });
    }
  }

  const measured = METRICS.filter((m) => current.parts[m].value !== null).sort((a, b) => current.parts[a].value! - current.parts[b].value!);
  const lowest = measured[0];
  if (lowest) {
    findings.push({
      ...base,
      id: findingId('performance', 'development', subject.id),
      category: 'development',
      severity: 'info',
      basis: 'fact',
      title: `Room to grow: ${LABEL[lowest]}`,
      summary: `${LABEL[lowest]} is the lowest measured part of the score this period (${round1(current.parts[lowest].value!)} out of 100).`,
      metrics: [{ label: LABEL[lowest], value: round1(current.parts[lowest].value!), unit: 'percent' }],
      next_step: SUGGESTION[lowest],
    });
  }
  return { findings, limitations };
}
