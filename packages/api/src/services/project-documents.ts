import { and, desc, eq } from 'drizzle-orm';
import { fileObjects, projectDocuments } from '@tallywork/db';
import { businessRule, forbidden, newId, notFound } from '@tallywork/domain';
import type { ProjectDocumentDto } from '@tallywork/contracts';
import type { Ctx } from './ctx';
import { audit } from './events';
import { memberNames } from './timer';
import { getProject } from './work';

const MAX_BYTES = 25 * 1024 * 1024;
/** Documents people attach to projects. No HTML/SVG/scripts: nothing that could run in the browser. */
const ALLOWED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['text/plain', 'txt'],
  ['text/csv', 'csv'],
  ['application/zip', 'zip'],
  ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['application/vnd.ms-excel', 'xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.ms-powerpoint', 'ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
]);
/** Shown in the browser; everything else downloads. */
export const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const cleanName = (name: string) =>
  (name.split(/[\\/]/).pop() ?? 'file')
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(0, 200) || 'file';

export async function listProjectDocuments(x: Ctx, projectId: string): Promise<ProjectDocumentDto[]> {
  await getProject(x, projectId); // visibility check
  const rows = await x.tx.select().from(projectDocuments).where(eq(projectDocuments.projectId, projectId)).orderBy(desc(projectDocuments.createdAt));
  const names = await memberNames(x, [...new Set(rows.map((r) => r.uploadedBy).filter((m): m is string => !!m))]);
  return rows.map((r) => ({ id: r.id, name: r.name, content_type: r.contentType, bytes: r.bytes, uploaded_by_name: r.uploadedBy ? (names.get(r.uploadedBy) ?? null) : null, created_at: r.createdAt.toISOString() }));
}

export async function uploadProjectDocument(x: Ctx, projectId: string, file: File) {
  if (!x.actor.grants['projects:manage']) throw forbidden();
  await getProject(x, projectId);
  const ext = ALLOWED.get(file.type);
  if (!ext) throw businessRule('file_type', 'Upload a PDF, image, Office document, text, CSV or ZIP file');
  if (file.size > MAX_BYTES) throw businessRule('file_too_large', 'Documents are limited to 25 MB');
  if (!file.size) throw businessRule('file_empty', 'The file is empty');
  const id = newId();
  const fileId = newId();
  const key = `org/${x.org.id}/projects/${projectId}/${fileId}.${ext}`;
  await x.deps.storage.put(key, Buffer.from(await file.arrayBuffer()), file.type);
  await x.tx.insert(fileObjects).values({ id: fileId, organizationId: x.org.id, purpose: 'PROJECT_DOCUMENT', storageKey: key, contentType: file.type, bytes: file.size, uploadedBy: x.actor.membershipId });
  const name = cleanName(file.name);
  await x.tx.insert(projectDocuments).values({ id, organizationId: x.org.id, projectId, fileId, name, contentType: file.type, bytes: file.size, uploadedBy: x.actor.membershipId });
  await audit(x, { action: 'project.document_added', targetType: 'project', targetId: projectId, metadata: { document_id: id, name, bytes: file.size } });
  return (await listProjectDocuments(x, projectId)).find((d) => d.id === id)!;
}

async function loadDocument(x: Ctx, projectId: string, docId: string) {
  await getProject(x, projectId);
  const [d] = await x.tx
    .select({ d: projectDocuments, key: fileObjects.storageKey })
    .from(projectDocuments)
    .innerJoin(fileObjects, eq(fileObjects.id, projectDocuments.fileId))
    .where(and(eq(projectDocuments.id, docId), eq(projectDocuments.projectId, projectId)));
  if (!d) throw notFound('document');
  return d;
}

export async function projectDocumentForDownload(x: Ctx, projectId: string, docId: string) {
  const { d, key } = await loadDocument(x, projectId, docId);
  return { name: d.name, contentType: d.contentType, storageKey: key };
}

export async function deleteProjectDocument(x: Ctx, projectId: string, docId: string) {
  if (!x.actor.grants['projects:manage']) throw forbidden();
  const { d, key } = await loadDocument(x, projectId, docId);
  await x.tx.delete(projectDocuments).where(eq(projectDocuments.id, docId));
  await x.tx.delete(fileObjects).where(eq(fileObjects.id, d.fileId));
  await x.deps.storage.delete([key]);
  await audit(x, { action: 'project.document_deleted', targetType: 'project', targetId: projectId, metadata: { document_id: docId, name: d.name } });
}
