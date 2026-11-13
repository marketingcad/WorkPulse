import { describe, expect, it } from 'vitest';
import { anchorProblems, anchorWords, normalize, scriptWords } from '../timing/anchors';

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

describe('anchorProblems', () => {
  it('lists every anchor the narration does not say, and every anchor outside the scene', () => {
    const markers = [
      { at: 1, label: 'scene start (trim before this)' },
      { at: 0.5, label: 'too early', on: 'Approvals' },
      { at: 2, label: 'fine', on: 'Click Approve' },
      { at: 3, label: 'typo', on: 'Click Aprove' },
      { at: 4, label: 'third', on: 'Click Approve', nth: 3 },
      { at: 9, label: 'scene end (trim after this)' },
    ];
    expect(anchorProblems(scene, markers)).toEqual({
      errors: ['No "Click Aprove" (occurrence 1) in the narration of scene 09.2', 'No "Click Approve" (occurrence 3) in the narration of scene 09.2'],
      warnings: ['09.2 "Approvals": recorded before the scene starts (d.begin()), so it is ignored'],
    });
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
