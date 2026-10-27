import { describe, expect, it } from 'vitest';
import { EDGE, GAP, clampToViewport, isDrag, panelPosition, parseSavedPosition } from '../components/calculator/position';

/** The movable calculator always stays on screen, and its panel opens where it fits. */
const VIEW = { width: 1280, height: 800 };
const BUTTON = { width: 48, height: 48 };
const PANEL = { width: 368, height: 420 };

describe('keeping the button on screen', () => {
  it('leaves a position inside the window as it is', () => {
    expect(clampToViewport({ x: 300, y: 200 }, BUTTON, VIEW)).toEqual({ x: 300, y: 200 });
  });

  it('pulls a position past any edge back inside, with a small margin', () => {
    expect(clampToViewport({ x: -50, y: -10 }, BUTTON, VIEW)).toEqual({ x: EDGE, y: EDGE });
    expect(clampToViewport({ x: 5000, y: 5000 }, BUTTON, VIEW)).toEqual({ x: VIEW.width - EDGE - 48, y: VIEW.height - EDGE - 48 });
  });

  it('pins to the top-left margin when the window is smaller than the box', () => {
    expect(clampToViewport({ x: 100, y: 100 }, { width: 500, height: 500 }, { width: 300, height: 300 })).toEqual({ x: EDGE, y: EDGE });
  });
});

describe('click or drag', () => {
  it('treats a small wobble as a click and a real move as a drag', () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 12, y: 13 })).toBe(false);
    expect(isDrag({ x: 10, y: 10 }, { x: 10, y: 16 })).toBe(true);
  });
});

describe('where the panel opens', () => {
  it('opens above the button, lined up with its right edge', () => {
    const anchor = { x: 1000, y: 700 };
    expect(panelPosition(anchor, BUTTON, PANEL, VIEW)).toEqual({ x: 1000 + 48 - 368, y: 700 - GAP - 420 });
  });

  it('opens below the button when it is near the top', () => {
    const anchor = { x: 1000, y: 20 };
    expect(panelPosition(anchor, BUTTON, PANEL, VIEW).y).toBe(20 + 48 + GAP);
  });

  it('lines up with the left edge when the button is near the left side', () => {
    const anchor = { x: 20, y: 700 };
    expect(panelPosition(anchor, BUTTON, PANEL, VIEW).x).toBe(20);
  });

  it('fits a tall panel into a short window rather than going off screen', () => {
    const short = { width: 400, height: 500 };
    const p = panelPosition({ x: 200, y: 250 }, BUTTON, PANEL, short);
    expect(p.y).toBe(short.height - EDGE - PANEL.height);
    expect(p.x).toBeGreaterThanOrEqual(EDGE);
    expect(p.x + PANEL.width).toBeLessThanOrEqual(short.width - EDGE);
  });
});

describe('the saved position', () => {
  it('reads a saved position and ignores anything else', () => {
    expect(parseSavedPosition('{"x":120,"y":340}')).toEqual({ x: 120, y: 340 });
    for (const raw of [null, '', 'nope', '{"x":"a","y":1}', '[1,2]', '{"x":1}']) expect(parseSavedPosition(raw)).toBeNull();
  });
});
