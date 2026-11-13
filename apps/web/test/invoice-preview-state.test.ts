import { describe, expect, it } from 'vitest';
import { previewIsCurrent } from '../components/finance/preview-state';

/** QA audit 13 Nov 2026 (BUG-20): the Review step showed $12.99 while “Create” saved $67.99. */
describe('previewIsCurrent', () => {
  const base = { formKey: 'a', sentKey: 'a', fetching: false, placeholder: false, hasData: true };

  it('is current once the preview is for the current form and has arrived', () => {
    expect(previewIsCurrent(base)).toBe(true);
  });

  it('is not, while the form changed and the preview has not caught up', () => {
    expect(previewIsCurrent({ ...base, formKey: 'b' })).toBe(false);
  });

  it('is not, while the new preview is on its way or the previous one is shown in its place', () => {
    expect(previewIsCurrent({ ...base, fetching: true })).toBe(false);
    expect(previewIsCurrent({ ...base, placeholder: true })).toBe(false);
  });

  it('is not, with no preview at all', () => {
    expect(previewIsCurrent({ ...base, hasData: false })).toBe(false);
  });
});
