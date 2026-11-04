'use client';
import { useState, type ReactNode } from 'react';
import { cx } from './primitives';

/**
 * Profile avatars: an uploaded photo, a curated avatar, or initials. One component for every
 * screen (web and desktop), so a person looks the same wherever they appear.
 */
export type AvatarImage = { kind: 'photo'; url: string } | { kind: 'preset'; preset: string } | null | undefined;

/** Up to two initials, from the first and last words of the name ("Ana María López" → "AL"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (w: string | undefined) => (w ? Array.from(w)[0]!.toUpperCase() : '');
  return words.length > 1 ? first(words[0]) + first(words[words.length - 1]) : first(words[0]);
}

/** A hue from a stable id (so renaming someone never recolors them; the name when there is no id). */
export function avatarHue(seed: string): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * The initials background: dark enough at every hue for white text at 4.5:1 or more (WCAG AA;
 * checked for all 360 hues in avatar.test.ts).
 */
export const avatarBackground = (hue: number) => `hsl(${hue} 55% 30%)`;

export function Avatar({
  name,
  size = 28,
  image,
  seed,
  label,
  className,
}: {
  name: string;
  size?: number;
  /** a photo or curated avatar; without one (or when a photo cannot be loaded), the initials */
  image?: AvatarImage;
  /** a stable id for the initials color (a membership or user id) */
  seed?: string;
  /** an accessible name, when the avatar is shown without the person's name next to it */
  label?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const photo = image?.kind === 'photo' && failed !== image.url ? image.url : null;
  const preset = image?.kind === 'preset' ? PRESETS[image.preset] : undefined;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <span
      {...a11y}
      className={cx('relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold text-white', className)}
      // A fixed box: nothing moves while a picture loads. White initials in both themes: the background
      // is dark in both (on-accent turns dark in dark mode).
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38), background: preset ? undefined : avatarBackground(avatarHue(seed ?? name)) }}
    >
      {preset ? (
        <PresetArt art={preset} />
      ) : (
        <>
          {initials(name) || '?'}
          {photo && (
            <img
              src={photo}
              alt=""
              width={size}
              height={size}
              decoding="async"
              loading="lazy"
              draggable={false}
              onLoad={() => setLoaded(photo)}
              onError={() => setFailed(photo)}
              className={cx('absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none', loaded === photo ? 'opacity-100' : 'opacity-0')}
            />
          )}
        </>
      )}
    </span>
  );
}

// ─── Curated avatars ─────────────────────────────────────────────────────────
// Illustrations, not styling: their colors are part of the artwork (a muted, professional palette),
// so they sit here as data rather than as theme tokens. Built from a few shared shapes to stay small.

type Person = { kind: 'person'; bg: string; skin: string; hair: string; shirt: string; style: 'short' | 'long' | 'bun' | 'curly' | 'cap' | 'none' | 'scarf' | 'side' };
type Minimal = { kind: 'minimal'; bg: string; fg: string };
type Shape = { kind: 'shape'; bg: string; a: string; b: string; form: 'rings' | 'peak' | 'tiles' };
type Art = Person | Minimal | Shape;

const SKIN = { a: '#f3d3b8', b: '#e0b08c', c: '#c48a5f', d: '#a06a43', e: '#7a4b2c', f: '#55331e' };

const PRESETS: Record<string, Art> = {
  'person-1': { kind: 'person', bg: '#dbe7f5', skin: SKIN.b, hair: '#3b2a20', shirt: '#2f5d8a', style: 'short' },
  'person-2': { kind: 'person', bg: '#f3e1d6', skin: SKIN.e, hair: '#1f1712', shirt: '#7a4e8c', style: 'curly' },
  'person-3': { kind: 'person', bg: '#dcefe6', skin: SKIN.a, hair: '#c9893f', shirt: '#2e7d64', style: 'long' },
  'person-4': { kind: 'person', bg: '#ece3f4', skin: SKIN.d, hair: '#2b1d16', shirt: '#b3542f', style: 'bun' },
  'person-5': { kind: 'person', bg: '#f4ead3', skin: SKIN.f, hair: '#151010', shirt: '#3f6b4f', style: 'none' },
  'person-6': { kind: 'person', bg: '#e1e8ef', skin: SKIN.c, hair: '#4a6b8a', shirt: '#2a3f5c', style: 'scarf' },
  'person-7': { kind: 'person', bg: '#f1dede', skin: SKIN.b, hair: '#8f8a85', shirt: '#5b5f97', style: 'side' },
  'person-8': { kind: 'person', bg: '#e3eedc', skin: SKIN.d, hair: '#2d2420', shirt: '#9a5b2b', style: 'cap' },
  'minimal-1': { kind: 'minimal', bg: '#dfe6f0', fg: '#4d6488' },
  'minimal-2': { kind: 'minimal', bg: '#e4efe8', fg: '#3f7a5e' },
  'minimal-3': { kind: 'minimal', bg: '#f1e6dc', fg: '#9a6440' },
  'shape-1': { kind: 'shape', bg: '#24324a', a: '#5f8fd0', b: '#c9d8ee', form: 'rings' },
  'shape-2': { kind: 'shape', bg: '#f0e7dc', a: '#d0814d', b: '#4f6d8f', form: 'peak' },
  'shape-3': { kind: 'shape', bg: '#e2ece8', a: '#3f8a73', b: '#9cc3b5', form: 'tiles' },
};

/** The curated avatars, grouped as the picker shows them. */
export const AVATAR_PRESET_GROUPS: Array<{ id: 'people' | 'minimal' | 'shapes'; presets: string[] }> = [
  { id: 'people', presets: Object.keys(PRESETS).filter((k) => k.startsWith('person-')) },
  { id: 'minimal', presets: Object.keys(PRESETS).filter((k) => k.startsWith('minimal-')) },
  { id: 'shapes', presets: Object.keys(PRESETS).filter((k) => k.startsWith('shape-')) },
];

export const isAvatarPreset = (id: string) => id in PRESETS;

const HAIR_BACK: Partial<Record<Person['style'], ReactNode>> = {
  long: <path d="M19 27c0-10 6-16 13-16s13 6 13 16v15c-3-1-5-3-6-6H25c-1 3-3 5-6 6z" />,
  scarf: <path d="M18 29c0-11 6-18 14-18s14 7 14 18c0 6-2 11-5 14H23c-3-3-5-8-5-14z" />,
};
const HAIR_FRONT: Partial<Record<Person['style'], ReactNode>> = {
  short: <path d="M21 25c0-8 5-12 11-12s11 4 11 12c-3-4-7-6-11-6s-8 2-11 6z" />,
  long: <path d="M21 25c0-8 5-12 11-12s11 4 11 12c-4-3-7-6-9-8-3 3-8 6-13 8z" />,
  bun: (
    <>
      <circle cx="32" cy="10.5" r="5" />
      <path d="M21 25c0-8 5-12 11-12s11 4 11 12c-3-4-7-6-11-6s-8 2-11 6z" />
    </>
  ),
  curly: (
    <>
      <circle cx="23" cy="20" r="5" />
      <circle cx="29" cy="15" r="5.5" />
      <circle cx="36" cy="15" r="5.5" />
      <circle cx="41" cy="20" r="5" />
    </>
  ),
  side: <path d="M21 26c0-9 5-13 11-13 7 0 11 4 11 11-6-1-12-3-15-7-2 3-4 6-7 9z" />,
  cap: <path d="M20 22c1-7 6-10 12-10s11 3 12 10zM40 22h7v3h-7z" />,
};

function PresetArt({ art }: { art: Art }) {
  return (
    <svg viewBox="0 0 64 64" className="absolute inset-0 size-full" aria-hidden focusable="false">
      <rect width="64" height="64" fill={art.bg} />
      {art.kind === 'person' && (
        <>
          <g fill={art.hair}>{HAIR_BACK[art.style]}</g>
          <path d="M11 64c0-12 9-20 21-20s21 8 21 20z" fill={art.shirt} />
          <path d="M28 36h8v9a4 4 0 0 1-8 0z" fill={art.skin} />
          <circle cx="32" cy="27" r="11" fill={art.skin} />
          <g fill={art.hair}>{HAIR_FRONT[art.style]}</g>
        </>
      )}
      {art.kind === 'minimal' && (
        <g fill={art.fg}>
          <circle cx="32" cy="26" r="10" />
          <path d="M14 64c0-11 8-19 18-19s18 8 18 19z" />
        </g>
      )}
      {art.kind === 'shape' && art.form === 'rings' && (
        <>
          <circle cx="32" cy="32" r="20" fill="none" stroke={art.a} strokeWidth="6" />
          <circle cx="32" cy="32" r="8" fill={art.b} />
        </>
      )}
      {art.kind === 'shape' && art.form === 'peak' && (
        <>
          <path d="M8 50 26 18l18 32z" fill={art.a} />
          <circle cx="44" cy="24" r="9" fill={art.b} />
        </>
      )}
      {art.kind === 'shape' && art.form === 'tiles' && (
        <>
          <rect x="14" y="14" width="16" height="16" rx="3" fill={art.a} />
          <rect x="34" y="14" width="16" height="16" rx="3" fill={art.b} />
          <rect x="14" y="34" width="16" height="16" rx="3" fill={art.b} />
          <rect x="34" y="34" width="16" height="16" rx="8" fill={art.a} />
        </>
      )}
    </svg>
  );
}
