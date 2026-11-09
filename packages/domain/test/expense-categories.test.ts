import { describe, expect, it } from 'vitest';
import { suggestExpenseCategory } from '../src/expense-categories';

const CATS = ['Travel', 'Meals', 'Lodging', 'Software', 'Equipment', 'Supplies', 'Mileage', 'Other'] as const;

describe('suggestExpenseCategory', () => {
  it('suggests from keywords, case and accent insensitive', () => {
    expect(suggestExpenseCategory('Uber to the airport', CATS)).toEqual({ category: 'Travel', matched: 'uber' });
    expect(suggestExpenseCategory('TAXI to client', CATS)?.category).toBe('Travel');
    expect(suggestExpenseCategory('Café con leche', CATS)?.category).toBe('Meals');
    expect(suggestExpenseCategory('Hotel two nights', CATS)?.category).toBe('Lodging');
    expect(suggestExpenseCategory('Adobe subscription', CATS)?.category).toBe('Software');
  });
  it('makes no guess when nothing matches, the text is empty, or two categories tie', () => {
    expect(suggestExpenseCategory('', CATS)).toBeNull();
    expect(suggestExpenseCategory('   ', CATS)).toBeNull();
    expect(suggestExpenseCategory('Reunión de equipo', CATS)).toBeNull();
    expect(suggestExpenseCategory('Uber Eats lunch', CATS)).toBeNull();
  });
  it('only suggests categories that exist in the list', () => {
    expect(suggestExpenseCategory('Uber to the airport', ['Meals', 'Other'])).toBeNull();
  });
});
