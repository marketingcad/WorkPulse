import { describe, expect, it } from 'vitest';
import { coverage, mentions } from '../timing/coverage';

const scene = {
  id: '09.3',
  narration: 'When members submit their timesheets, they arrive in Approvals. Click a timesheet to review it. If everything is right, click Approve. If something needs fixing, click Request changes.',
  actions: ['Open Time Tracking › Approvals.', 'Click a timesheet.', 'Click "Approve".', 'Click "Request changes" and type "Please add Friday".'],
};

describe('mentions', () => {
  it('finds the quoted on-screen labels the narration says, in narration order', () => {
    expect(mentions(scene).map((m) => m.label)).toEqual(['Approvals', 'Approve', 'Request changes']);
  });

  it('also finds menu paths written with ›', () => {
    expect(mentions({ ...scene, actions: ['Open Time Tracking › Approvals.'] }).map((m) => m.label)).toEqual(['Approvals']);
  });

  it('ignores quoted text the narration does not say (typed values)', () => {
    expect(mentions(scene).some((m) => m.label === 'Please add Friday')).toBe(false);
  });

  it('places each mention on its words', () => {
    const approve = mentions(scene).find((m) => m.label === 'Approve')!;
    expect(approve.first).toBe(approve.last);
  });
});

describe('coverage', () => {
  it('counts a mention as shown when an anchor overlaps its words', () => {
    const r = coverage(scene, [{ on: 'click Approve' }, { on: 'they arrive in Approvals' }]);
    expect(r.missing.map((m) => m.label)).toEqual(['Request changes']);
    expect(r.covered.map((m) => m.label)).toEqual(['Approvals', 'Approve']);
  });

  it('skips mentions listed as not on screen', () => {
    const r = coverage(scene, [{ on: 'click Approve' }, { on: 'Approvals' }], ['Request changes']);
    expect(r.missing).toEqual([]);
  });

  it('uses the occurrence an anchor names with nth', () => {
    const twice = { id: '1', narration: 'Click Save. Then click Save again.', actions: ['Click "Save".'] };
    expect(coverage(twice, [{ on: 'Save', nth: 2 }]).missing.map((m) => m.label)).toEqual(['Save']);
    expect(coverage(twice, [{ on: 'Save' }]).missing).toEqual([]);
  });
});
