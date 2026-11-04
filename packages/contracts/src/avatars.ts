/**
 * Profile pictures. A person's avatar belongs to their user account, so it is the same in every
 * organization they belong to; who may see a photo is still decided per organization.
 *
 * The curated collection: stable ids (stored on the user), artwork in @tallywork/ui.
 *
 * No zod here: web pages import this file alone (@tallywork/contracts/avatars), without the schemas.
 */
export const AVATAR_PRESETS = [
  'person-1',
  'person-2',
  'person-3',
  'person-4',
  'person-5',
  'person-6',
  'person-7',
  'person-8',
  'minimal-1',
  'minimal-2',
  'minimal-3',
  'shape-1',
  'shape-2',
  'shape-3',
] as const;
export type AvatarPresetId = (typeof AVATAR_PRESETS)[number];

/** Uploads: what the server accepts before it decodes and re-encodes the picture (always to WebP). */
export const AVATAR_UPLOAD = { maxBytes: 5 * 1024 * 1024, maxSide: 4096, types: ['image/jpeg', 'image/png', 'image/webp'] } as const;

/**
 * A person's avatar as the API shows it. `photo.url` is an authorized, same-origin address that
 * changes when the picture does (safe to cache); no storage key or bucket address is exposed.
 * `null`: no picture, so the initials are shown.
 */
export type AvatarDto = { kind: 'photo'; url: string } | { kind: 'preset'; preset: AvatarPresetId } | null;

/** Avatars of the organization's members the caller may see (others show initials). */
export interface MemberAvatarDto {
  membership_id: string;
  avatar: Exclude<AvatarDto, null>;
}

/** The desktop app's own avatar: the picture itself, as the app has no browser session to load it with. */
export interface AgentAvatarDto {
  avatar: { kind: 'photo'; data_url: string } | { kind: 'preset'; preset: AvatarPresetId } | null;
}
