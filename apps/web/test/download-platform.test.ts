import { describe, expect, it } from 'vitest';
import { detectPlatform } from '../components/download/platform';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  // iPadOS asks for the desktop site: it says Macintosh and only its touch screen tells it apart.
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
};

describe('detectPlatform (download page)', () => {
  it('never offers the Mac installer to a phone or tablet (UX audit: iPhones said "Mac OS X")', () => {
    expect(detectPlatform(UA.iphone)).toBe('mobile');
    expect(detectPlatform(UA.ipad, 5)).toBe('mobile');
    expect(detectPlatform(UA.android)).toBe('mobile');
  });

  it('recognizes computers', () => {
    expect(detectPlatform(UA.mac, 0)).toBe('macos');
    expect(detectPlatform(UA.windows, 10)).toBe('windows'); // a touch-screen Windows laptop is still a computer
    expect(detectPlatform(UA.linux)).toBe('linux');
    expect(detectPlatform('Something else')).toBeNull();
  });
});
