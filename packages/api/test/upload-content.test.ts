import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentMatchesType } from '../src/lib/file-sniff';
import { Client, createHarness, signup, type Harness } from './harness';

/**
 * Form validation audit (20 Nov 2026): project documents and expense receipts were stored with the type
 * the browser declared, which comes from the file's name. A program renamed to "brief.pdf" was accepted
 * as a PDF, and an empty receipt was accepted. The content must now agree with the declared type.
 */

const bytes = (...parts: Array<string | number[]>) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...Buffer.from(p, 'latin1')] : p)));
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'rest');
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], 'rest');
const WEBP = bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 ');
const ZIP = bytes('PK', [3, 4], 'rest');
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'rest');

describe('contentMatchesType', () => {
  it('accepts files whose content matches the declared type', () => {
    expect(contentMatchesType(bytes('%PDF-1.7\n'), 'application/pdf')).toBe(true);
    expect(contentMatchesType(bytes('\r\n%PDF-1.4'), 'application/pdf')).toBe(true); // a little junk before the header is allowed
    expect(contentMatchesType(PNG, 'image/png')).toBe(true);
    expect(contentMatchesType(JPEG, 'image/jpeg')).toBe(true);
    expect(contentMatchesType(WEBP, 'image/webp')).toBe(true);
    expect(contentMatchesType(bytes('GIF89a'), 'image/gif')).toBe(true);
    expect(contentMatchesType(ZIP, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(true);
    expect(contentMatchesType(OLE, 'application/vnd.ms-excel')).toBe(true);
    expect(contentMatchesType(bytes('Date,Hours\n2026-11-20,8\n'), 'text/csv')).toBe(true);
    expect(contentMatchesType(bytes([0xff, 0xfe], 'h\0i\0'), 'text/plain')).toBe(true); // UTF-16 text has NUL bytes
  });

  it('refuses content that does not match, programs, empty files and types it does not know', () => {
    expect(contentMatchesType(bytes('MZ\x90\0'), 'application/pdf')).toBe(false);
    expect(contentMatchesType(bytes('MZ\x90\0'), 'text/plain')).toBe(false);
    expect(contentMatchesType(bytes('\x7fELF'), 'text/csv')).toBe(false);
    expect(contentMatchesType(bytes('#!/bin/sh\nrm -rf /'), 'text/plain')).toBe(false);
    expect(contentMatchesType(bytes('<html><script>alert(1)</script>'), 'image/png')).toBe(false);
    expect(contentMatchesType(PNG, 'image/jpeg')).toBe(false);
    expect(contentMatchesType(bytes('a\0b'), 'text/plain')).toBe(false); // binary called text
    expect(contentMatchesType(ZIP, 'application/msword')).toBe(false);
    expect(contentMatchesType(new Uint8Array(), 'text/plain')).toBe(false);
    expect(contentMatchesType(PNG, 'image/svg+xml')).toBe(false);
  });
});

let t: Harness;
let admin: Client;
let orgId: string;
let projectId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

async function upload(path: string, name: string, type: string, content: Uint8Array | string) {
  const form = new FormData();
  form.set('file', new File([content as string], name, { type }));
  const res = await t.app.request(`/api/v1${o(path)}`, { method: 'POST', headers: { Origin: 'http://localhost:3000', Cookie: admin.cookie }, body: form });
  return { status: res.status, body: (await res.json()) as { code?: string; errors?: Array<{ field: string; message: string }> } };
}

beforeAll(async () => {
  t = await createHarness();
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@upload-content.test'));
  projectId = (await admin.post(o('/projects'), { name: 'Uploads' })).body.id;
});
afterAll(() => t.close());

describe('project documents', () => {
  it('stores a real file', async () => {
    expect((await upload(`/projects/${projectId}/documents`, 'logo.png', 'image/png', PNG)).status).toBe(201);
  });

  it('refuses a program renamed as a PDF, and stores nothing', async () => {
    const before = t.storage.objects.size;
    const r = await upload(`/projects/${projectId}/documents`, 'brief.pdf', 'application/pdf', bytes('MZ\x90\0\x03'));
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('file_content');
    expect(t.storage.objects.size).toBe(before);
  });

  it('refuses a web page called a picture', async () => {
    expect((await upload(`/projects/${projectId}/documents`, 'photo.jpg', 'image/jpeg', '<html><script>alert(1)</script></html>')).body.code).toBe('file_content');
  });
});

describe('expense receipts', () => {
  it('stores a real receipt', async () => {
    expect((await upload('/files/receipts', 'r.jpg', 'image/jpeg', JPEG)).status).toBe(201);
  });

  it('refuses an empty receipt with a message on the file field', async () => {
    const r = await upload('/files/receipts', 'r.pdf', 'application/pdf', '');
    expect(r.status).toBe(400);
    expect(r.body.errors?.[0]).toMatchObject({ field: 'file', message: expect.stringContaining('empty') });
  });

  it('refuses a receipt whose content is not the declared type', async () => {
    const r = await upload('/files/receipts', 'r.png', 'image/png', bytes('%PDF-1.4'));
    expect(r.status).toBe(400);
    expect(r.body.errors?.[0]?.field).toBe('file');
  });
});
