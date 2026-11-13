import { describe, expect, it } from 'vitest';
import { CHAPTERS } from '../scenes';
import { CONCEPTS, conceptHits } from '../visuals/concepts';
import { planVisuals, type PlanInput } from '../visuals/plan';
import { planRetime } from '../timing/retime';
import { scriptWords } from '../timing/anchors';
import type { Marker, WordTime } from '../timing/types';

const LEAD = 0.4;
const evenly = (narration: string): WordTime[] => scriptWords(narration).map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 }));

/** A scene whose footage plays as recorded (anchors land where they were recorded). */
function input(over: Partial<PlanInput['scene']> & { markers: Marker[]; callouts?: string[] }): PlanInput {
  const scene = {
    id: '09.3',
    title: 'Approve timesheets',
    narration: 'When members submit their timesheets, they arrive in Approvals. Click a timesheet to review it. If everything is right, click Approve. Approved time becomes invoices and payroll.',
    actions: ['Open Time Tracking › Approvals.', 'Click a timesheet.', 'Click "Approve".'],
    ...over,
  };
  const words = evenly(scene.narration);
  const markers = [{ at: 0, label: 'scene start (trim before this)' }, ...over.markers, { at: 60, label: 'scene end (trim after this)' }];
  const anchors = markers.flatMap((m, key) => (m.on ? [{ label: m.label, on: m.on, key, clipAt: m.at, wordAt: m.at }] : []));
  return {
    scene,
    chapter: 9,
    lead: LEAD,
    words,
    markers,
    start: 0,
    retime: planRetime({ clip: 60, target: 60, maxSpeed: 1.5, anchors }),
    callouts: over.callouts ?? [],
  };
}
const box = { x: 800, y: 500, width: 120, height: 40 };

describe('rings and labels', () => {
  it('rings the named item when its words are spoken, labelled with its name, and ends at the click', () => {
    const v = planVisuals(input({ markers: [{ at: 6, label: 'click: click Approve', on: 'click Approve', target: box }, { at: 6.9, label: 'interaction: click', interaction: 'click' }] }));
    const ring = v.find((x) => x.kind === 'ring')!;
    expect(ring.layer).toBe('point');
    expect(ring.from).toBe(6);
    expect(ring.to).toBeCloseTo(7.05);
    expect(ring.x).toBeLessThan(box.x);
    expect(ring.x + ring.w).toBeGreaterThan(box.x + box.width);
    const label = v.find((x) => x.kind === 'label')!;
    expect(label.spec.text).toBe('Approve');
    expect(label.from).toBe(6);
  });

  it('holds a ring at most 1.5 s, and ends it early at a scroll or page change', () => {
    const long = planVisuals(input({ markers: [{ at: 3, label: 'point: Approvals', on: 'they arrive in Approvals', target: box }] }));
    expect(long.find((x) => x.kind === 'ring')!.to).toBeCloseTo(4.5);
    const scrolled = planVisuals(input({ markers: [{ at: 3, label: 'point: Approvals', on: 'they arrive in Approvals', target: box }, { at: 3.8, label: 'interaction: scroll', interaction: 'scroll' }] }));
    expect(scrolled.find((x) => x.kind === 'ring')!.to).toBeCloseTo(3.8);
  });

  it('shows one ring at a time: a newer one ends the older', () => {
    const v = planVisuals(input({ markers: [{ at: 3, label: 'point: Approvals', on: 'they arrive in Approvals', target: box }, { at: 3.6, label: 'point: timesheet', on: 'Click a timesheet', target: { ...box, y: 300 } }] }));
    const rings = v.filter((x) => x.kind === 'ring');
    expect(rings).toHaveLength(2);
    expect(rings[0]!.to).toBeLessThanOrEqual(rings[1]!.from);
  });

  it('draws no ring for an anchor without a box (scrolls, cues)', () => {
    expect(planVisuals(input({ markers: [{ at: 3, label: 'cue: Approvals', on: 'they arrive in Approvals' }] })).some((x) => x.kind === 'ring')).toBe(false);
  });

  it('numbers the clicks only in a scene marked step by step', () => {
    const markers: Marker[] = [
      { at: 4, label: 'click: Click a timesheet', on: 'Click a timesheet', target: box },
      { at: 6, label: 'click: click Approve', on: 'click Approve', target: { ...box, y: 200 } },
    ];
    expect(planVisuals(input({ markers })).some((x) => x.spec.step !== undefined)).toBe(false);
    const steps = planVisuals(input({ markers, visuals: { steps: true } })).filter((x) => x.kind === 'ring').map((x) => x.spec.step);
    expect(steps).toEqual([1, 2]);
  });
});

describe('callouts', () => {
  it('slides a callout in at the narration that talks about it, not at an even interval', () => {
    const v = planVisuals(input({ markers: [], callouts: ['Approved time becomes invoices and payroll'] }));
    const c = v.find((x) => x.kind === 'callout')!;
    const at = scriptWords(input({ markers: [] }).scene.narration).findIndex((w) => w === 'Approved');
    expect(c.from).toBeCloseTo(LEAD + at * 0.5);
    expect(c.layer).toBe('fixed');
  });
});

describe('concept cards', () => {
  it('shows the workflow card on its words, with its steps timed to the words that name them', () => {
    const v = planVisuals(input({ markers: [] }));
    const card = v.find((x) => x.kind === 'card' && x.spec.concept === 'flow')!;
    const words = scriptWords(input({ markers: [] }).scene.narration);
    expect(card.from).toBeCloseTo(LEAD + words.indexOf('Approved') * 0.5);
    const nodes = card.spec.nodes as Array<{ label: string; at: number }>;
    expect(nodes.map((n) => n.label)).toEqual(['Time', 'Approval', 'Invoices', 'Payroll']);
    for (let i = 1; i < nodes.length; i++) expect(nodes[i]!.at).toBeGreaterThanOrEqual(nodes[i - 1]!.at);
  });

  it('can be switched off or added in the script', () => {
    expect(planVisuals(input({ markers: [], visuals: { off: ['flow'] } })).some((x) => x.kind === 'card')).toBe(false);
    const added = planVisuals(input({ markers: [], visuals: { off: ['flow'], add: [{ concept: 'money', on: 'click Approve' }] } }));
    expect(added.find((x) => x.kind === 'card')!.spec.concept).toBe('money');
  });

  it('takes the corner farthest from the ringed item', () => {
    const v = planVisuals(input({ markers: [{ at: 11.4, label: 'point: Approved', on: 'Approved time becomes', target: { x: 1500, y: 120, width: 200, height: 40 } }] }));
    const card = v.find((x) => x.kind === 'card')!;
    expect(card.x + card.w / 2).toBeLessThan(960);
    expect(card.y + card.h / 2).toBeGreaterThan(540);
  });

  it('every concept fires somewhere in the tutorial, and only on its own words', () => {
    const fired = new Set<string>();
    for (const s of CHAPTERS.flatMap((c) => c.scenes)) for (const h of conceptHits(s)) fired.add(h.concept);
    expect([...fired].sort()).toEqual(Object.keys(CONCEPTS).sort());
  });
});

describe('scene tag', () => {
  it('names the chapter and scene for the first seconds', () => {
    const tag = planVisuals(input({ markers: [] })).find((x) => x.kind === 'tag')!;
    expect(tag.spec.text).toBe('Chapter 9 · Approve timesheets');
    expect(tag.from).toBeLessThan(1);
    expect(tag.to).toBeLessThan(5);
  });
});
