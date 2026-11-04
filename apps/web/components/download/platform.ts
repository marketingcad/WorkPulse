export type Platform = 'windows' | 'macos' | 'linux';

/**
 * The system this page is opened on. Phones and tablets come first: an iPhone's user agent also
 * says "Mac OS X" (and iPadOS says Macintosh, told apart by its touch screen), and the app does not
 * run on them, so they must not be offered the Mac installer.
 */
export function detectPlatform(ua: string, maxTouchPoints = 0): Platform | 'mobile' | null {
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return 'mobile';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux';
  return null;
}
