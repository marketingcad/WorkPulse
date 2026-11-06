import { describe, expect, it } from 'vitest';
import { groupCaptures, screenLabel, type BlockShot } from '../components/tracking/captures';

/**
 * Activity › a 10-minute block: screenshots from a three-monitor computer arrive as separate rows in
 * any order. The block shows one capture (moment) at a time with all its screens side by side, as
 * Screen 1, 2 and 3; a one-screen capture is just "the screenshot".
 */
const shot = (id: string, at: string, display: number): BlockShot => ({ id, captured_at: at, display_index: display, blurred: false, thumb_url: `/t/${id}`, full_url: `/f/${id}` });
const AT1 = '2026-11-04T14:02:00.000Z';
const AT2 = '2026-11-04T14:07:00.000Z';
const AT0 = '2026-11-04T14:00:30.000Z';

describe('screens of a capture', () => {
  it('should_group_three_monitors_by_moment_in_time_order_with_screens_1_2_3', () => {
    const shuffled = [shot('b3', AT2, 2), shot('a2', AT1, 1), shot('b1', AT2, 0), shot('solo', AT0, 0), shot('a3', AT1, 2), shot('a1', AT1, 0), shot('b2', AT2, 1)];
    const captures = groupCaptures(shuffled);
    expect(captures.map((c) => c.map((s) => s.id))).toEqual([['solo'], ['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']]);
    expect(captures[1]!.map(screenLabel)).toEqual(['Screen 1', 'Screen 2', 'Screen 3']);
  });

  it('should_keep_a_capture_whole_even_when_a_screen_is_missing', () => {
    // One screen's upload failed: the others still form their capture, numbered as they were.
    const captures = groupCaptures([shot('x3', AT1, 2), shot('x1', AT1, 0)]);
    expect(captures).toHaveLength(1);
    expect(captures[0]!.map(screenLabel)).toEqual(['Screen 1', 'Screen 3']);
  });

  it('should_return_nothing_for_a_block_without_screenshots', () => {
    expect(groupCaptures([])).toEqual([]);
  });
});
