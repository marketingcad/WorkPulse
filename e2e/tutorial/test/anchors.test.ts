import { describe, expect, it } from 'vitest';
import { anchorWords, normalize, scriptWords } from '../timing/anchors';

const scene = { id: '09.2', narration: 'Open Time › Approvals. Click Approve → the entry is locked. Click Approve again.' };

describe('scriptWords', () => {
  it('keeps the words as written and drops tokens the voice does not say', () => {
    expect(scriptWords(scene.narration)).toEqual(['Open', 'Time', 'Approvals.', 'Click', 'Approve', '→', 'the', 'entry', 'is', 'locked.', 'Click', 'Approve', 'again.']);
    expect(scriptWords('Payroll — then reports')).toEqual(['Payroll', 'then', 'reports']);
  });

  it('normalizes the way the voice reads', () => {
    expect(normalize('→')).toBe('to');
    expect(normalize('&')).toBe('and');
    expect(normalize('Sign-in,')).toBe('signin');
    expect(normalize('›')).toBe('');
  });
});

describe('anchorWords', () => {
  it('finds a phrase by its words, ignoring case and punctuation', () => {
    expect(anchorWords(scene, 'Approvals')).toEqual({ first: 2, last: 2 });
    expect(anchorWords(scene, 'click approve')).toEqual({ first: 3, last: 4 });
  });

  it('picks a later occurrence with nth', () => {
    expect(anchorWords(scene, 'Click Approve', 2)).toEqual({ first: 10, last: 11 });
  });

  it('matches an arrow as the word "to"', () => {
    expect(anchorWords(scene, 'approve to the entry')).toEqual({ first: 4, last: 7 });
  });

  it('names the scene and phrase when the phrase is missing', () => {
    expect(() => anchorWords(scene, 'Reject')).toThrow('No "Reject" (occurrence 1) in the narration of scene 09.2');
    expect(() => anchorWords(scene, 'Click Approve', 3)).toThrow('occurrence 3');
  });
});
