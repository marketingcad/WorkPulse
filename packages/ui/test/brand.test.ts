import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiBadge, BrandLockup, BrandSignature, PageHeader, uiEn } from '../src';

// Branding: WorkPulse is the product name; "Powered by AI" is secondary; one official tagline.
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('brand text', () => {
  it('has the official name, descriptor, tagline and signature', () => {
    expect(uiEn['brand.name']).toBe('WorkPulse');
    expect(uiEn['brand.descriptor']).toBe('Powered by AI');
    expect(uiEn['brand.tagline']).toBe('Smarter Workforce. Better Business.');
    expect(uiEn['brand.signature']).toBe('WorkPulse – Powered by AI');
  });
});

describe('BrandLockup', () => {
  it('is only the mark and wordmark by default', () => {
    const html = renderToStaticMarkup(h(BrandLockup));
    expect(html).toContain('aria-label="WorkPulse"');
    expect(text(html)).toBe('Work Pulse');
    expect(html).not.toContain('ai-badge');
  });

  it('adds the badge and the new tagline (never the old one) when asked', () => {
    const html = renderToStaticMarkup(h(BrandLockup, { descriptor: true, tagline: true, tone: 'onDark' }));
    expect(text(html)).toBe('Work Pulse Powered by AI Smarter Workforce. Better Business.');
    expect(html).not.toContain('Focus');
  });

  it('keeps "Powered by AI" smaller than the WorkPulse wordmark', () => {
    const html = renderToStaticMarkup(h(BrandLockup, { size: 56, descriptor: true }));
    const wordmark = Number(html.match(/font-size:(\d+(?:\.\d+)?)px/)?.[1]);
    expect(wordmark).toBeCloseTo(56 * 0.72);
    // The badge is text-[10.5px], well under the wordmark.
    expect(html).toContain('text-[10.5px]');
    expect(wordmark).toBeGreaterThan(10.5 * 3);
  });
});

describe('AiBadge', () => {
  it('shows the words, with a decorative sparkle', () => {
    const html = renderToStaticMarkup(h(AiBadge));
    expect(text(html)).toBe('Powered by AI');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain('bg-interactive-soft');
  });

  it('icon-only keeps the words for screen readers and as a tooltip', () => {
    const html = renderToStaticMarkup(h(AiBadge, { iconOnly: true, tone: 'onDark' }));
    expect(html).toContain('title="Powered by AI"');
    expect(html).toContain('<span class="sr-only">Powered by AI</span>');
  });
});

describe('BrandSignature', () => {
  it('reads "WorkPulse – Powered by AI · Smarter Workforce. Better Business."', () => {
    // As textContent reads it (tags removed, no spaces added): the spaces must be real text, since
    // the flex gap is only visual. Regression: it read "…AI·Smarter…".
    const textContent = renderToStaticMarkup(h(BrandSignature)).replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '');
    expect(textContent).toBe('WorkPulse – Powered by AI · Smarter Workforce. Better Business.');
  });
});

describe('PageHeader eyebrow', () => {
  it('renders a line above the title only when given', () => {
    expect(renderToStaticMarkup(h(PageHeader, { title: 'Overview', eyebrow: 'Smarter Workforce. Better Business.' }))).toMatch(/<p[^>]*>Smarter Workforce\. Better Business\.<\/p><h1/);
    expect(renderToStaticMarkup(h(PageHeader, { title: 'Overview' }))).not.toContain('<p');
  });
});
