import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { DOCUMENT_LOGO_MAX_CHARS } from '@tallywork/contracts';
import { DOC_LOGO_BOX, fitLogo, renderInvoicePdf } from '../src/lib/invoice-pdf';
import { renderPayStubPdf } from '../src/lib/pay-stub-pdf';
import { Client, addMember, createHarness, pkce, signup, type Harness } from './harness';

/**
 * The organization's logo on finance documents (invoices and pay stubs, web and desktop): an uncropped
 * "document logo" that keeps its shape, with the square company logo as the fallback.
 */

// ── tiny PNG encoder, so tests use real images of a known size ──
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(w: number, h: number): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x33)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString('base64')}`;
}

/** Every image in a PDF: its pixel size, and the size it is drawn at on page 1. */
async function imagesIn(pdf: Buffer | Uint8Array): Promise<{ pixels: Array<{ width: number; height: number }>; drawn: Array<{ width: number; height: number; x: number; y: number }> }> {
  const doc = await PDFDocument.load(pdf);
  const pixels: Array<{ width: number; height: number }> = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : null;
    if (dict?.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
      pixels.push({ width: (dict.get(PDFName.of('Width')) as PDFNumber).asNumber(), height: (dict.get(PDFName.of('Height')) as PDFNumber).asNumber() });
    }
  }
  const contents = doc.getPages()[0]!.node.Contents();
  const streams = contents instanceof PDFRawStream ? [contents] : [];
  if (!streams.length && contents) {
    const arr = contents as unknown as { asArray(): unknown[] };
    for (const ref of arr.asArray()) streams.push(doc.context.lookup(ref as never) as PDFRawStream);
  }
  const ops = streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')).join('\n');
  // pdf-lib draws an image as q, then translate, rotate, scale and skew (each a `cm`), then `Do`.
  // Multiplying those matrices maps the unit square to where the image lands: size and position.
  const drawn: Array<{ width: number; height: number; x: number; y: number }> = [];
  for (const seg of ops.split(/\/\S+\s+Do/).slice(0, -1)) {
    const block = seg.slice(seg.lastIndexOf('q'));
    type Matrix = [number, number, number, number, number, number];
    let m: Matrix = [1, 0, 0, 1, 0, 0];
    for (const c of block.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)) {
      const n = c.slice(1, 7).map(Number) as Matrix;
      // row-vector convention: the new matrix applies before the current one
      m = [n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3], n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3], n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5]];
    }
    const r = (v: number) => Math.round(v * 1000) / 1000;
    drawn.push({ width: r(m[0]), height: r(m[3]), x: r(m[4]), y: r(m[5]) });
  }
  return { pixels, drawn };
}

const WIDE = png(300, 100); // a wordmark: 3:1
const TALL = png(100, 300);
const SQUARE = png(64, 64);
const NOW = new Date('2026-10-02T15:00:00Z');

let t: Harness;
let admin: Client;
let orgId: string;
let walt: Client;
let waltId: string;
let manager: Client;
let stubId: string;
const o = (p: string) => `/orgs/${orgId}${p}`;

beforeAll(async () => {
  t = await createHarness();
  t.clock.set(NOW);
  ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@doclogo.test'));
  ({ client: walt, membershipId: waltId } = await addMember(t, admin, orgId, 'Walt', 'walt@doclogo.test'));
  ({ client: manager } = await addMember(t, admin, orgId, 'Mona', 'mona@doclogo.test', 'TEAM_MANAGER'));
  // A finalized payroll with one stub for Walt (September, monthly).
  const projectId = (await admin.post(o('/projects'), { name: 'Site', member_ids: [waltId], billable_default: true })).body.id;
  await admin.post(o('/rates'), { kind: 'PAY', scope: 'WORKER', scope_id: waltId, amount_minor: 2000, currency: 'USD', effective_from: '2020-01-01' });
  expect((await admin.post(o('/manual-time'), { membership_id: waltId, project_id: projectId, started_at: '2026-09-08T13:00:00.000Z', ended_at: '2026-09-08T16:00:00.000Z', reason: 'fixture' })).status).toBe(201);
  const ts = await walt.post(o('/timesheets/submit'), { date: '2026-09-08' });
  expect((await admin.post(o(`/timesheets/${ts.body.id}/approve`), {})).status).toBe(200);
  const profile = (await admin.post(o('/payroll/profiles'), { name: 'Monthly USD', period: { type: 'monthly' }, currency: 'USD', member_ids: [waltId] })).body.id;
  const run = (await admin.post(o('/payroll/runs'), { profile_id: profile })).body.id;
  expect((await admin.post(o(`/payroll/runs/${run}/finalize`), {})).body.status).toBe('FINALIZED');
  stubId = (await walt.get(o('/me/pay-stubs'))).body[0].id;
  await t.flush();
});
afterAll(() => t.close());

const webStub = async () => Buffer.from(await (await t.app.request(`/api/v1${o(`/pay-stubs/${stubId}/pdf`)}`, { headers: { Cookie: walt.cookie } })).arrayBuffer());
async function desktopStub(): Promise<Buffer> {
  const { verifier, challenge } = pkce();
  const code = await walt.post('/agent/authorize', { code_challenge: challenge, organization_id: orgId });
  const c = new Client(t);
  c.bearer = (await c.post('/agent/register', { code: code.body.code, code_verifier: verifier, device: { name: 'Walt-PC', platform: 'windows', agent_version: '0.2.0' } })).body.access_token;
  const r = await t.app.request(`/api/v1/agent/me/pay-stubs/${stubId}/pdf`, { headers: { Authorization: `Bearer ${c.bearer}` } });
  expect(r.status).toBe(200);
  return Buffer.from(await r.arrayBuffer());
}

describe('fitting a logo into the document header', () => {
  it('keeps the shape: wide logos use the width, tall ones the height', () => {
    expect(fitLogo(300, 100)).toEqual({ width: 144, height: 48 });
    expect(fitLogo(600, 100)).toEqual({ width: 160, height: 160 / 6 });
    expect(fitLogo(100, 300)).toEqual({ width: 16, height: 48 });
    expect(fitLogo(64, 64)).toEqual({ width: 48, height: 48 });
    const f = fitLogo(1000, 37)!;
    expect(f.width).toBeLessThanOrEqual(DOC_LOGO_BOX.width);
    expect(f.height).toBeLessThanOrEqual(DOC_LOGO_BOX.height);
  });
  it('refuses an image with no size', () => {
    expect(fitLogo(0, 10)).toBeNull();
    expect(fitLogo(10, Number.NaN)).toBeNull();
  });
});

describe('the document logo setting', () => {
  it('owners save an uncropped logo; it is kept as given', async () => {
    const r = await admin.patch(o(''), { document_logo: WIDE });
    expect(r.status).toBe(200);
    expect(r.body.organization).toMatchObject({ document_logo: WIDE, has_document_logo: true });
  });

  it('only people who can edit the organization receive the image', async () => {
    for (const c of [walt, manager]) {
      const me = (await c.get(o(''))).body.organization;
      expect(me.document_logo).toBeNull();
      expect(me.has_document_logo).toBe(true);
    }
  });

  it('workers and managers cannot change it', async () => {
    expect((await walt.patch(o(''), { document_logo: TALL })).status).toBe(403);
    expect((await manager.patch(o(''), { document_logo: null })).status).toBe(403);
    expect((await admin.get(o(''))).body.organization.document_logo).toBe(WIDE);
  });

  it('accepts only PNG or JPEG data URLs under the size cap', async () => {
    expect((await admin.patch(o(''), { document_logo: 'data:image/webp;base64,UklGRg==' })).status).toBe(400);
    expect((await admin.patch(o(''), { document_logo: 'data:image/svg+xml;base64,PHN2Zz4=' })).status).toBe(400);
    expect((await admin.patch(o(''), { document_logo: 'https://example.com/logo.png' })).status).toBe(400);
    const huge = `data:image/png;base64,${'A'.repeat(DOCUMENT_LOGO_MAX_CHARS)}`;
    const r = await admin.patch(o(''), { document_logo: huge });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('document_logo');
    expect((await admin.get(o(''))).body.organization.document_logo).toBe(WIDE);
  });

  it('saving other company details leaves it alone', async () => {
    expect((await admin.patch(o(''), { brief: 'Remote staffing' })).status).toBe(200);
    expect((await admin.get(o(''))).body.organization.document_logo).toBe(WIDE);
  });

  it('keeps the image out of the audit log', async () => {
    const log = JSON.stringify((await admin.get(o('/audit-logs?action=organization.updated'))).body);
    expect(log).toContain('organization.updated');
    expect(log).toContain('(image)');
    expect(log).not.toContain(WIDE.slice(22, 80));
  });
});

describe('pay stub PDF', () => {
  it('prints the document logo at its own shape on the web download', async () => {
    const { pixels, drawn } = await imagesIn(await webStub());
    expect(pixels).toEqual([{ width: 300, height: 100 }]);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({ width: 144, height: 48, x: 48 });
  });

  it('prints the same logo on the desktop app download', async () => {
    const { pixels, drawn } = await imagesIn(await desktopStub());
    expect(pixels).toEqual([{ width: 300, height: 100 }]);
    expect(drawn[0]).toMatchObject({ width: 144, height: 48 });
  });

  it('falls back to the square company logo when there is no document logo', async () => {
    expect((await admin.patch(o(''), { document_logo: null, logo: SQUARE })).status).toBe(200);
    expect((await admin.get(o(''))).body.organization.has_document_logo).toBe(false);
    const { pixels, drawn } = await imagesIn(await webStub());
    expect(pixels).toEqual([{ width: 64, height: 64 }]);
    expect(drawn[0]).toMatchObject({ width: 44, height: 44 });
  });

  it('shows the company name only when there is no logo at all', async () => {
    expect((await admin.patch(o(''), { logo: null })).status).toBe(200);
    const pdf = await webStub();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await imagesIn(pdf)).pixels).toEqual([]);
  });

  it('places the company name beside the logo, not under it', async () => {
    const stub = (await walt.get(o(`/pay-stubs/${stubId}`))).body;
    const pdf = await renderPayStubPdf(stub, { name: 'Ada Org', documentLogo: TALL, address: '1 Main St', taxId: 'TX-1' });
    const { drawn } = await imagesIn(pdf);
    expect(drawn[0]).toMatchObject({ width: 16, height: 48, x: 48 });
    const text = (await PDFDocument.load(pdf)).getTitle();
    expect(text).toContain('Pay stub');
  });

  it('skips a broken document logo and uses the square one', async () => {
    const stub = (await walt.get(o(`/pay-stubs/${stubId}`))).body;
    const pdf = await renderPayStubPdf(stub, { name: 'Ada Org', documentLogo: 'data:image/png;base64,AAAA', logo: SQUARE });
    expect((await imagesIn(pdf)).pixels).toEqual([{ width: 64, height: 64 }]);
  });
});

describe('invoice PDF', () => {
  const inv = {
    number: 'INV-1',
    status: 'DRAFT',
    issue_date: '2026-10-01',
    due_date: '2026-10-15',
    period_start: null,
    period_end: null,
    currency: 'USD',
    subtotal_minor: 1000,
    tax_minor: 0,
    total_minor: 1000,
    paid_minor: 0,
    balance_minor: 1000,
    notes: null,
    client: { name: 'Acme', email: null, address: null },
    lines: [{ description: 'Work', quantity: 1, unit_price_minor: 1000, amount_minor: 1000, tax_minor: 0 }],
  };

  it('prefers the document logo over the square logo', async () => {
    const { pixels, drawn } = await imagesIn(await renderInvoicePdf(inv, { name: 'Ada Org', logo: SQUARE, documentLogo: WIDE }));
    expect(pixels).toEqual([{ width: 300, height: 100 }]);
    expect(drawn[0]).toMatchObject({ width: 144, height: 48 });
  });

  it('keeps the square logo at its previous size when there is no document logo', async () => {
    const { drawn } = await imagesIn(await renderInvoicePdf(inv, { name: 'Ada Org', logo: SQUARE }));
    expect(drawn[0]).toMatchObject({ width: 44, height: 44, x: 48 });
  });

  it('the invoice download uses the saved document logo', async () => {
    expect((await admin.patch(o(''), { document_logo: WIDE })).status).toBe(200);
    const client = (await admin.post(o('/clients'), { name: 'Acme' })).body.id;
    const created = await admin.post(o('/invoices'), { client_id: client, period_start: '2026-09-01', period_end: '2026-09-30', issue_date: '2026-10-01', due_date: '2026-10-15', extra_lines: [{ description: 'Setup', quantity: 1, unit_price_minor: 5000 }] });
    expect(created.status).toBe(201);
    const r = await t.app.request(`/api/v1${o(`/invoices/${created.body.id}/pdf`)}`, { headers: { Cookie: admin.cookie } });
    expect(r.status).toBe(200);
    expect((await imagesIn(Buffer.from(await r.arrayBuffer()))).pixels).toEqual([{ width: 300, height: 100 }]);
  });
});
