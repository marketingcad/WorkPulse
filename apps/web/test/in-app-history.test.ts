import { beforeEach, describe, expect, it } from 'vitest';
import { hasInAppHistory, noteRoute, resetInAppHistory } from '../lib/in-app-history';

describe('in-app history (where “Back” may go)', () => {
  beforeEach(() => resetInAppHistory());

  it('has no in-app page to go back to on the first page loaded', () => {
    expect(hasInAppHistory()).toBe(false);
    noteRoute('/o/1/help');
    expect(hasInAppHistory()).toBe(false);
  });

  it('the same page shown again (a re-render) is not a move', () => {
    noteRoute('/o/1/help');
    noteRoute('/o/1/help');
    expect(hasInAppHistory()).toBe(false);
  });

  it('has one once the person moves to another page inside the app', () => {
    noteRoute('/o/1/clients');
    noteRoute('/o/1/help');
    expect(hasInAppHistory()).toBe(true);
  });
});
