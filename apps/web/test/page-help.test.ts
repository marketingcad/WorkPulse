import { describe, expect, it } from 'vitest';
import type { Permission } from '@tallywork/domain';
import { guideFor } from '../components/help/page-help';
import { HELP_ARTICLES } from '../components/help/content';

const all = () => true;

describe('the top bar Help link', () => {
  it('opens the guide a page names, and otherwise a guide that links to the page', () => {
    expect(guideFor('/finance/billing', all)?.id).toBe('rates');
    expect(guideFor('/timesheets/not-added', all)?.id).toBe('time-not-added');
    expect(guideFor('/timesheets/all', all)?.id).toBe('correct-time');
    expect(guideFor('/no/such/page', all)).toBeNull();
  });

  it('picks the manual time guide on Approvals for someone who approves no timesheets', () => {
    expect(guideFor('/timesheets/approvals', all)?.id).toBe('approve-timesheets');
    expect(guideFor('/timesheets/approvals', (p: Permission) => p !== 'timesheets:approve')?.id).toBe('manual-time');
  });

  it('opens the Performance guides on the Performance pages, only for people who may use them', () => {
    expect(guideFor('/performance', all)?.id).toBe('performance-scores');
    expect(guideFor('/performance/workers', all)?.id).toBe('performance-scores');
    expect(guideFor('/performance/goals', all)?.id).toBe('performance-goals');
    expect(guideFor('/performance/achievements', all)?.id).toBe('performance-recognition');
    expect(guideFor('/performance/leaderboards', all)?.id).toBe('performance-leaderboards');
    expect(guideFor('/developer/webhooks', all)?.id).toBe('webhooks');
    // A manager who may read goals but not set them: no guide about setting goals.
    expect(guideFor('/performance/goals', (p: Permission) => p !== 'goals:manage')).toBeNull();
  });

  it('covers every page in the guides’ own links', () => {
    const pages = [...new Set(HELP_ARTICLES.flatMap((a) => a.links?.map((l) => l.href) ?? []))].filter((h) => !h.includes('#') && !h.includes('?'));
    for (const page of pages) expect(guideFor(page, all), page).not.toBeNull();
  });
});
