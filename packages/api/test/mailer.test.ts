import { describe, expect, it } from 'vitest';
import { createMailer, MemoryMailer, ResendMailer, SmtpMailer } from '../src/lib/mailer';

describe('createMailer', () => {
  it('falls back to the in-memory mailer without provider settings', () => {
    expect(createMailer({ NODE_ENV: 'test' })).toBeInstanceOf(MemoryMailer);
  });

  it('uses SMTP when SMTP_HOST is set', () => {
    expect(createMailer({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'app-pass' })).toBeInstanceOf(SmtpMailer);
  });
});

describe('SmtpMailer', () => {
  it('sends the message through the transport with the configured sender', async () => {
    const sent: unknown[] = [];
    const transport = { sendMail: async (m: unknown) => (sent.push(m), {}) } as never;
    const mailer = new SmtpMailer({ host: 'smtp.gmail.com', port: 465, secure: true }, 'Tallywork <me@gmail.com>', transport);
    await mailer.send({ to: 'a@b.co', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' });
    expect(sent).toEqual([{ from: 'Tallywork <me@gmail.com>', to: 'a@b.co', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' }]);
  });

  it('propagates transport failures', async () => {
    const transport = { sendMail: async () => { throw new Error('535 auth failed'); } } as never;
    const mailer = new SmtpMailer({ host: 'smtp.gmail.com', port: 465, secure: true }, 'x@y.z', transport);
    await expect(mailer.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow('535');
  });
});

// QA audit 13 Nov 2026 (C-17): invoices go out with the PDF attached and replies to the organization.
describe('replies and attachments', () => {
  const pdf = Buffer.from('%PDF-1.7 test');
  const msg = { to: 'a@b.co', subject: 'Invoice', text: 't', replyTo: 'accounts@org.test', attachments: [{ filename: 'INV-1.pdf', content: pdf, contentType: 'application/pdf' }] };

  it('SMTP passes the Reply-To and the attachment to the transport', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const transport = { sendMail: async (m: Record<string, unknown>) => (sent.push(m), {}) } as never;
    await new SmtpMailer({ host: 'h', port: 465, secure: true }, 'x@y.z', transport).send(msg);
    expect(sent[0]).toMatchObject({ replyTo: 'accounts@org.test', attachments: [{ filename: 'INV-1.pdf', content: pdf, contentType: 'application/pdf' }] });
  });

  it('Resend sends reply_to and the attachment as base64', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => (bodies.push(JSON.parse(init.body)), new Response('{}', { status: 200 }))) as never;
    try {
      await new ResendMailer('key', 'x@y.z').send(msg);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(bodies[0]).toMatchObject({ reply_to: 'accounts@org.test', attachments: [{ filename: 'INV-1.pdf', content: pdf.toString('base64'), content_type: 'application/pdf' }] });
  });

  it('Resend leaves both out when there are none', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => (bodies.push(JSON.parse(init.body)), new Response('{}', { status: 200 }))) as never;
    try {
      await new ResendMailer('key', 'x@y.z').send({ to: 'a@b.co', subject: 's', text: 't' });
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(Object.keys(bodies[0]!)).not.toContain('reply_to');
    expect(Object.keys(bodies[0]!)).not.toContain('attachments');
  });
});
