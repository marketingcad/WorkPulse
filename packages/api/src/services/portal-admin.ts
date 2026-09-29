import { and, eq } from 'drizzle-orm';
import { clientPortalAccess, clientPortalSettings, clients, DEFAULT_PORTAL_SECTIONS, projects, type ClientPortalSections } from '@tallywork/db';
import { businessRule, conflict, forbidden, newId, notFound, validation } from '@tallywork/domain';
import type { ClientPortalSettingsDto, clientPortalInviteInput, clientPortalSettingsInput, PortalScreenshotDto } from '@tallywork/contracts';
import type { z } from 'zod';
import { randomToken, sha256 } from '../lib/crypto';
import type { Ctx } from './ctx';
import { audit } from './events';
import { includedProjects, portalScreenshotsTx, type PortalAccess } from './portal';

const INVITE_DAYS = 7;

function assertManager(x: Ctx) {
  if (x.actor.grants['clients:manage'] !== 'org') throw forbidden('Only organization admins can manage client portals');
}

/**
 * While activity or screenshots are shared, anything that lets more people (a new viewer) or more
 * projects (a wider scope) see them needs the same org-wide grants as switching them on.
 */
function assertMonitoringGrants(x: Ctx, sections: ClientPortalSections, what: string) {
  if (sections.activity && x.actor.grants['activity:read'] !== 'org') throw forbidden(`You need organization-wide access to activity to ${what} a dashboard that shares activity`);
  if (sections.screenshots && x.actor.grants['screenshots:read'] !== 'org') throw forbidden(`You need organization-wide access to screenshots to ${what} a dashboard that shares screenshots`);
}

async function loadClient(x: Ctx, clientId: string) {
  const [c] = await x.tx.select().from(clients).where(eq(clients.id, clientId));
  if (!c) throw notFound('client');
  return c;
}

async function settingsRow(x: Ctx, clientId: string) {
  const [s] = await x.tx.select().from(clientPortalSettings).where(eq(clientPortalSettings.clientId, clientId));
  return s ?? { enabled: false, sections: DEFAULT_PORTAL_SECTIONS, projectIds: null as string[] | null };
}

export async function getPortalSettings(x: Ctx, clientId: string): Promise<ClientPortalSettingsDto> {
  assertManager(x);
  await loadClient(x, clientId);
  const s = await settingsRow(x, clientId);
  const ps = await x.tx.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.clientId, clientId)).orderBy(projects.name);
  const access = await x.tx.select().from(clientPortalAccess).where(eq(clientPortalAccess.clientId, clientId)).orderBy(clientPortalAccess.createdAt);
  return {
    client_id: clientId,
    enabled: s.enabled,
    sections: { ...DEFAULT_PORTAL_SECTIONS, ...s.sections },
    project_ids: s.projectIds,
    projects: ps,
    access: access.map((a) => ({ id: a.id, email: a.email, name: a.name, status: a.status, accepted_at: a.acceptedAt?.toISOString() ?? null, last_viewed_at: a.lastViewedAt?.toISOString() ?? null })),
    can_enable: { activity: x.actor.grants['activity:read'] === 'org', screenshots: x.actor.grants['screenshots:read'] === 'org' },
  };
}

export async function updatePortalSettings(x: Ctx, clientId: string, input: z.infer<typeof clientPortalSettingsInput>): Promise<ClientPortalSettingsDto> {
  assertManager(x);
  await loadClient(x, clientId);
  const before = await settingsRow(x, clientId);
  const sections: ClientPortalSections = { ...DEFAULT_PORTAL_SECTIONS, ...before.sections, ...input.sections };
  // Nobody can expose monitoring data they could not see themselves.
  if (sections.activity && !before.sections.activity && x.actor.grants['activity:read'] !== 'org') throw forbidden('You need organization-wide access to activity to share it');
  if (sections.screenshots && !before.sections.screenshots && x.actor.grants['screenshots:read'] !== 'org') throw forbidden('You need organization-wide access to screenshots to share them');
  let projectIds = input.project_ids === undefined ? before.projectIds : input.project_ids;
  if (projectIds) {
    const own = new Set((await x.tx.select({ id: projects.id }).from(projects).where(eq(projects.clientId, clientId))).map((p) => p.id));
    if (projectIds.some((id) => !own.has(id))) throw validation('Choose only this client’s projects', { errors: [{ field: 'project_ids', message: 'Includes a project of another client' }] });
    projectIds = [...new Set(projectIds)];
  }
  // Widening the scope (switching to "all projects" or adding a project) exposes more monitoring data
  // while activity or screenshots are shared, so it needs the same org-wide grants. Narrowing never does.
  const widened = before.projectIds !== null && (projectIds === null || projectIds.some((id) => !before.projectIds!.includes(id)));
  if (widened) assertMonitoringGrants(x, sections, 'widen the projects of');
  const enabled = input.enabled ?? before.enabled;
  await x.tx
    .insert(clientPortalSettings)
    .values({ organizationId: x.org.id, clientId, enabled, sections, projectIds, updatedBy: x.actor.membershipId, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [clientPortalSettings.organizationId, clientPortalSettings.clientId], set: { enabled, sections, projectIds, updatedBy: x.actor.membershipId, updatedAt: new Date() } });
  await audit(x, { action: 'client_portal.settings_updated', targetType: 'client', targetId: clientId, before, after: { enabled, sections, projectIds } });
  return getPortalSettings(x, clientId);
}

export async function invitePortalViewer(x: Ctx, clientId: string, input: z.infer<typeof clientPortalInviteInput>): Promise<{ id: string; invite_url: string }> {
  assertManager(x);
  const client = await loadClient(x, clientId);
  // A new viewer would see whatever monitoring data is shared: same org-wide grants as sharing it.
  assertMonitoringGrants(x, { ...DEFAULT_PORTAL_SECTIONS, ...(await settingsRow(x, clientId)).sections }, 'invite viewers to');
  const email = input.email.toLowerCase();
  const [existing] = await x.tx.select().from(clientPortalAccess).where(and(eq(clientPortalAccess.clientId, clientId), eq(clientPortalAccess.email, email)));
  // Revoked access and an invitation that expired unused can both be re-issued.
  const expired = existing?.status === 'INVITED' && !!existing.inviteExpiresAt && existing.inviteExpiresAt.getTime() <= x.deps.now().getTime();
  if (existing && existing.status !== 'REVOKED' && !expired) throw conflict('portal_viewer_exists', 'This person already has access or a pending invitation');
  const token = randomToken(32);
  const id = existing?.id ?? newId();
  const values = { status: 'INVITED' as const, name: input.name ?? null, inviteTokenHash: sha256(token), inviteExpiresAt: new Date(x.deps.now().getTime() + INVITE_DAYS * 86_400_000), invitedBy: x.actor.membershipId, revokedAt: null, acceptedAt: null, userId: null };
  if (existing) await x.tx.update(clientPortalAccess).set(values).where(eq(clientPortalAccess.id, id));
  else await x.tx.insert(clientPortalAccess).values({ id, organizationId: x.org.id, clientId, email, ...values });
  const inviteUrl = `${x.deps.config.appUrl}/portal-invite?token=${token}`;
  await x.deps.mailer.send({
    to: email,
    subject: `${client.name}’s WorkPulse dashboard from ${x.org.name}`,
    text: `${x.org.name} invited you to follow the work on ${client.name}'s projects in WorkPulse: who is working on them, hours per task and task progress.\n\nOpen your dashboard (link valid for ${INVITE_DAYS} days): ${inviteUrl}\n`,
  });
  await audit(x, { action: 'client_portal.viewer_invited', targetType: 'client', targetId: clientId, after: { email } });
  return { id, invite_url: inviteUrl };
}

export async function revokePortalViewer(x: Ctx, clientId: string, accessId: string): Promise<void> {
  assertManager(x);
  const [a] = await x.tx.select().from(clientPortalAccess).where(and(eq(clientPortalAccess.id, accessId), eq(clientPortalAccess.clientId, clientId)));
  if (!a) throw notFound('portal access');
  if (a.status === 'REVOKED') throw businessRule('already_revoked', 'Access is already revoked');
  await x.tx.update(clientPortalAccess).set({ status: 'REVOKED', revokedAt: new Date(), inviteTokenHash: null }).where(eq(clientPortalAccess.id, accessId));
  await audit(x, { action: 'client_portal.viewer_revoked', targetType: 'client', targetId: clientId, before: { email: a.email, status: a.status } });
}

/**
 * The access object the client would get, for "Preview as client" (no viewer, so no client audit row).
 * Monitoring sections are masked to what the previewing admin may see org-wide themselves, so a
 * clients:manage holder without those grants cannot use the preview to read activity or screenshots.
 */
export async function previewAccess(x: Ctx, clientId: string): Promise<PortalAccess> {
  assertManager(x);
  await loadClient(x, clientId);
  const s = await settingsRow(x, clientId);
  const sections = { ...DEFAULT_PORTAL_SECTIONS, ...s.sections };
  sections.activity = sections.activity && x.actor.grants['activity:read'] === 'org';
  sections.screenshots = sections.screenshots && x.actor.grants['screenshots:read'] === 'org';
  return { accessId: null, organizationId: x.org.id, clientId, sections, projectIds: await includedProjects(x.tx, clientId, s.projectIds) };
}

/** "Preview as client" screenshots: same rows the client would get, audited as the previewing admin. */
export async function previewScreenshots(x: Ctx, clientId: string, range: { from: string; to: string }): Promise<PortalScreenshotDto[]> {
  // Reuses the org route's already-open tenant transaction (portalScreenshots would open a second one).
  const rows = await portalScreenshotsTx(x.tx, x.deps, await previewAccess(x, clientId), range);
  await audit(x, { action: 'client_portal.preview_screenshots_viewed', targetType: 'client', targetId: clientId, metadata: { count: rows.length, from: range.from, to: range.to } });
  return rows;
}
