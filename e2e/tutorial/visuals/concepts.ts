/**
 * Concept cards: illustrations for what the screen cannot show (other operating systems, a phone,
 * the way time turns into money). Each fires on the first narration phrase of its list that a scene
 * says; a scene's script can add one on other words, or turn one off (`visuals` in scenes.ts).
 * Drawings are original (visuals/overlay.html): no real logos or product screenshots.
 */
import { anchorWords } from '../timing/anchors';

export interface Concept {
  /** narration phrases that call for the card */
  triggers: string[];
  caption: string;
}

export const CONCEPTS = {
  os: { triggers: ['Windows, macOS or Linux', 'Windows, macOS, or Ubuntu'], caption: 'Windows · macOS · Linux' },
  'phone-qr': { triggers: ['Scan the QR code'], caption: 'Two-factor sign-in with your phone' },
  security: { triggers: ['Require two-factor authentication'], caption: 'Two-factor for admins or everyone' },
  flow: { triggers: ['Approved time becomes invoices', 'approved time became invoices'], caption: 'From tracked time to money' },
  money: { triggers: ['Money in WorkPulse starts with rates'], caption: 'Rates turn time into money' },
  invoice: { triggers: ['Invoices turn billable time into money'], caption: 'Billable time becomes an invoice' },
  payroll: { triggers: ['Payroll pays your people'], caption: 'Approved hours become pay' },
  'offline-sync': { triggers: ['if your internet connection drops', 'What happens when a computer is offline'], caption: 'Keeps tracking offline, syncs when back' },
  ai: { triggers: ['WorkPulse AI answers questions', 'AI Insights looks through'], caption: 'WorkPulse AI' },
} satisfies Record<string, Concept>;

export type ConceptId = keyof typeof CONCEPTS;

/** The concept cards a scene's narration calls for: each concept once, at the first of its phrases said. */
export function conceptHits(scene: { id: string; narration: string; visuals?: SceneVisuals }): Array<{ concept: ConceptId; first: number; last: number }> {
  const off = new Set(scene.visuals?.off ?? []);
  const hits: Array<{ concept: ConceptId; first: number; last: number }> = [];
  for (const [concept, c] of Object.entries(CONCEPTS) as Array<[ConceptId, Concept]>) {
    if (off.has(concept)) continue;
    const at = c.triggers.map((t) => find(scene, t)).filter((x) => x !== null).sort((a, b) => a!.first - b!.first)[0];
    if (at) hits.push({ concept, ...at });
  }
  for (const a of scene.visuals?.add ?? []) {
    const at = find(scene, a.on, a.nth);
    if (!at) throw new Error(`Scene ${scene.id}: visuals.add "${a.on}" is not in the narration`);
    hits.push({ concept: a.concept, ...at });
  }
  return hits.sort((a, b) => a.first - b.first);
}

/** What a scene's script can say about its visuals. */
export interface SceneVisuals {
  /** number the clicks as steps */
  steps?: boolean;
  /** concept cards to show on other words */
  add?: Array<{ concept: ConceptId; on: string; nth?: number }>;
  /** concept cards not to show in this scene */
  off?: ConceptId[];
}

function find(scene: { id: string; narration: string }, phrase: string, nth = 1): { first: number; last: number } | null {
  try {
    return anchorWords(scene, phrase, nth);
  } catch {
    return null;
  }
}
