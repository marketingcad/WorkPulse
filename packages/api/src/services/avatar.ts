import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import sharp, { type Metadata } from 'sharp';
import { memberships, users } from '@tallywork/db';
import { newId, notFound, validation, visibleMembershipIds } from '@tallywork/domain';
import { AVATAR_PRESETS, AVATAR_UPLOAD, type AgentAvatarDto, type AvatarDto, type AvatarPresetId, type MemberAvatarDto } from '@tallywork/contracts';
import type { Deps } from '../context';
import type { Ctx } from './ctx';
import type { AgentCtx } from './agent';

/**
 * Profile pictures (UX: the profile avatar experience).
 *
 * Owned by the user account, not a membership: someone in several organizations has one picture.
 * `users.avatar_url` holds a reference, never an address or a key the client chose:
 *   `photo:<imageId>`  an uploaded picture at avatars/{userId}/{imageId}.webp (private storage)
 *   `preset:<id>`      one of the curated avatars (artwork in @tallywork/ui)
 * Pictures are streamed by the API after an authorization check, like every other private file,
 * at an address that changes with the picture so browsers may keep it.
 */
type AvatarRef = { kind: 'photo'; imageId: string } | { kind: 'preset'; preset: AvatarPresetId } | null;

const PRESETS = new Set<string>(AVATAR_PRESETS);
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The stored picture's side: sharp on a large profile header and on high-density screens. */
export const AVATAR_PX = 512;

export function parseAvatarRef(value: string | null | undefined): AvatarRef {
  if (!value) return null;
  const [kind, rest] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)];
  if (kind === 'photo' && IMAGE_ID.test(rest)) return { kind: 'photo', imageId: rest };
  if (kind === 'preset' && PRESETS.has(rest)) return { kind: 'preset', preset: rest as AvatarPresetId };
  // Anything else (a legacy URL, a removed preset): no avatar, so the initials show.
  return null;
}

/** The storage key, always built here from the account's own id: never from what a client sent. */
export const avatarKey = (userId: string, imageId: string) => `avatars/${userId}/${imageId}.webp`;

function toDto(ref: AvatarRef, photoUrl: (imageId: string) => string): AvatarDto {
  if (!ref) return null;
  return ref.kind === 'photo' ? { kind: 'photo', url: photoUrl(ref.imageId) } : { kind: 'preset', preset: ref.preset };
}

/** The signed-in person's own avatar, with the address of their own picture. */
export const ownAvatarDto = (value: string | null | undefined): AvatarDto => toDto(parseAvatarRef(value), (v) => `/api/v1/me/avatar?v=${v}`);

const invalid = (message: string) => validation(message, { errors: [{ field: 'file', message }] });

/**
 * Check what the file really is (its bytes, not its name or the type the browser sent), refuse
 * anything that is not a readable JPEG, PNG or WebP within the limits, and re-encode it: a square
 * WebP of AVATAR_PX, upright (EXIF rotation applied), with no metadata (location, camera) kept.
 */
export async function processAvatarImage(input: Buffer): Promise<Buffer> {
  if (input.length === 0) throw invalid('The file is empty. Choose a picture.');
  if (input.length > AVATAR_UPLOAD.maxBytes) throw invalid('Use a picture of 5 MB or less.');
  let meta: Metadata;
  try {
    meta = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    throw invalid('This file is not a picture that can be read. Use a JPEG, PNG or WebP image.');
  }
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw invalid('Use a JPEG, PNG or WebP image.');
  if (!meta.width || !meta.height) throw invalid('This picture could not be read. Try another one.');
  if (meta.width > AVATAR_UPLOAD.maxSide || meta.height > AVATAR_UPLOAD.maxSide) throw invalid(`Use a picture of at most ${AVATAR_UPLOAD.maxSide} × ${AVATAR_UPLOAD.maxSide} pixels.`);
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: AVATAR_UPLOAD.maxSide * AVATAR_UPLOAD.maxSide, animated: false })
      .rotate()
      .resize(AVATAR_PX, AVATAR_PX, { fit: 'cover', position: 'centre' })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Valid headers over broken image data (a truncated or tampered file).
    throw invalid('This picture is damaged and could not be read. Try another one.');
  }
}

async function currentRef(deps: Deps, userId: string): Promise<string | null> {
  const [u] = await deps.db.select({ avatar: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw notFound('user');
  return u.avatar;
}

/** Remove the previous picture once the new reference is saved; a failure only leaves an unused object. */
export async function deleteReplaced(deps: Deps, userId: string, previous: string | null) {
  const ref = parseAvatarRef(previous);
  if (ref?.kind !== 'photo') return;
  try {
    await deps.storage.delete([avatarKey(userId, ref.imageId)]);
  } catch (e) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'avatar cleanup failed', user_id: userId, error: e instanceof Error ? e.message : String(e) }));
  }
}

async function setRef(deps: Deps, userId: string, value: string | null) {
  await deps.db.update(users).set({ avatarUrl: value, updatedAt: deps.now() }).where(eq(users.id, userId));
}

/**
 * Upload or replace the signed-in person's picture. Order matters for failures: the new object is
 * stored first; if saving the reference fails, that new object is deleted again (the old picture
 * stays in use); only after the reference is saved is the old object deleted.
 */
export async function uploadMyAvatar(deps: Deps, userId: string, file: File): Promise<AvatarDto> {
  if (file.size > AVATAR_UPLOAD.maxBytes) throw invalid('Use a picture of 5 MB or less.');
  const picture = await processAvatarImage(Buffer.from(await file.arrayBuffer()));
  const previous = await currentRef(deps, userId);
  const imageId = newId();
  const key = avatarKey(userId, imageId);
  await deps.storage.put(key, picture, 'image/webp');
  try {
    await setRef(deps, userId, `photo:${imageId}`);
  } catch (e) {
    await deps.storage.delete([key]).catch(() => undefined);
    throw e;
  }
  await deleteReplaced(deps, userId, previous);
  return ownAvatarDto(`photo:${imageId}`);
}

export async function selectMyAvatarPreset(deps: Deps, userId: string, preset: AvatarPresetId): Promise<AvatarDto> {
  const previous = await currentRef(deps, userId);
  await setRef(deps, userId, `preset:${preset}`);
  await deleteReplaced(deps, userId, previous);
  return ownAvatarDto(`preset:${preset}`);
}

export async function removeMyAvatar(deps: Deps, userId: string): Promise<void> {
  const previous = await currentRef(deps, userId);
  if (!previous) return;
  await setRef(deps, userId, null);
  await deleteReplaced(deps, userId, previous);
}

async function pictureOf(deps: Deps, userId: string, value: string | null) {
  const ref = parseAvatarRef(value);
  if (ref?.kind !== 'photo') throw notFound('avatar');
  const obj = await deps.storage.get(avatarKey(userId, ref.imageId));
  if (!obj) throw notFound('avatar');
  return { body: obj.body, version: ref.imageId };
}

/**
 * A picture as a response. Asked for at its current version (`?v=`, which changes with the picture)
 * a browser may keep it for a year; otherwise only briefly. Private: never kept by shared caches.
 */
export function avatarResponse(pic: { body: ReadableStream; version: string }, requested: string | undefined): Response {
  return new Response(pic.body, {
    headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': requested === pic.version ? 'private, max-age=31536000, immutable' : 'private, max-age=60',
      ETag: `"${pic.version}"`,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** The signed-in person's own picture. */
export async function myAvatarImage(deps: Deps, userId: string) {
  return pictureOf(deps, userId, await currentRef(deps, userId));
}

/**
 * Whose avatars the actor may see in this organization: themselves, and the people their
 * members:read grant covers (everyone with org scope; the people they manage with team scope).
 * Everyone else shows as initials, so a worker never sees another worker's picture.
 */
function visibleTo(x: Ctx): 'all' | Set<string> {
  const visible = visibleMembershipIds(x.actor, 'members:read');
  if (visible === 'all') return 'all';
  return new Set([x.actor.membershipId, ...(visible ?? [])]);
}

/** The avatars of the members the caller may see (one cached request for a whole screen). */
export async function memberAvatars(x: Ctx): Promise<MemberAvatarDto[]> {
  const visible = visibleTo(x);
  if (visible !== 'all' && visible.size === 0) return [];
  const rows = await x.tx
    .select({ id: memberships.id, avatar: users.avatarUrl })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, x.org.id), isNotNull(users.avatarUrl), visible === 'all' ? undefined : inArray(memberships.id, [...visible])));
  const out: MemberAvatarDto[] = [];
  for (const r of rows) {
    const dto = toDto(parseAvatarRef(r.avatar), (v) => `/api/v1/orgs/${x.org.id}/avatars/${r.id}?v=${v}`);
    if (dto) out.push({ membership_id: r.id, avatar: dto });
  }
  return out;
}

/** One member's picture, for someone who may see it (else "not found", revealing nothing). */
export async function memberAvatarImage(x: Ctx, membershipId: string) {
  const visible = visibleTo(x);
  if (!IMAGE_ID.test(membershipId) || (visible !== 'all' && !visible.has(membershipId))) throw notFound('avatar');
  const [m] = await x.tx
    .select({ userId: memberships.userId, avatar: users.avatarUrl })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, x.org.id)))
    .limit(1);
  if (!m) throw notFound('avatar');
  return pictureOf(x.deps, m.userId, m.avatar);
}

/** The desktop app's own avatar: the device's worker only, with the picture inline. */
export async function agentAvatar(a: AgentCtx): Promise<AgentAvatarDto> {
  // Through the request's own transaction: a second connection would wait on it (one-connection databases).
  const [u] = await a.tx.select({ avatar: users.avatarUrl }).from(users).where(eq(users.id, a.userId)).limit(1);
  const value = u?.avatar ?? null;
  const ref = parseAvatarRef(value);
  if (!ref) return { avatar: null };
  if (ref.kind === 'preset') return { avatar: { kind: 'preset', preset: ref.preset } };
  const obj = await a.deps.storage.get(avatarKey(a.userId, ref.imageId));
  if (!obj) return { avatar: null };
  const bytes = Buffer.from(await new Response(obj.body).arrayBuffer());
  return { avatar: { kind: 'photo', data_url: `data:image/webp;base64,${bytes.toString('base64')}` } };
}
