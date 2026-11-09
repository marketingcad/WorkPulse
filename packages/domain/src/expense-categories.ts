/**
 * Expense category suggestion from the description: keyword rules, never a guess. It returns a
 * category only when exactly one category matches and that category is in the organization's list;
 * the person always confirms it.
 */
const RULES: Array<{ category: string; words: string[] }> = [
  { category: 'Travel', words: ['uber', 'lyft', 'taxi', 'cab', 'flight', 'airline', 'airfare', 'train', 'rail', 'bus', 'parking', 'toll', 'car rental', 'rental car', 'fuel', 'gas station'] },
  { category: 'Lodging', words: ['hotel', 'airbnb', 'lodging', 'motel', 'hostel', 'accommodation'] },
  { category: 'Meals', words: ['lunch', 'dinner', 'breakfast', 'coffee', 'cafe', 'restaurant', 'meal', 'eats', 'catering', 'leche'] },
  { category: 'Software', words: ['subscription', 'license', 'licence', 'saas', 'software', 'app store', 'domain', 'hosting'] },
  { category: 'Equipment', words: ['laptop', 'monitor', 'keyboard', 'mouse', 'headset', 'webcam', 'phone', 'hardware'] },
  { category: 'Supplies', words: ['paper', 'ink', 'toner', 'stationery', 'pens', 'notebook', 'printer paper'] },
  { category: 'Mileage', words: ['mileage', 'miles', 'km', 'kilometres', 'kilometers'] },
];

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const has = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text);

export function suggestExpenseCategory(description: string, categories: readonly string[]): { category: string; matched: string } | null {
  const text = fold(description.trim());
  if (!text) return null;
  const allowed = new Map(categories.map((c) => [fold(c), c]));
  const hits: Array<{ category: string; matched: string }> = [];
  for (const rule of RULES) {
    const category = allowed.get(fold(rule.category));
    if (!category) continue;
    const word = rule.words.find((w) => has(text, w));
    if (word) hits.push({ category, matched: word });
  }
  return hits.length === 1 ? hits[0]! : null;
}
