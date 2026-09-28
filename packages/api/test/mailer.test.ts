import { describe, expect, it } from 'vitest';
import { createMailer, MemoryMailer, SmtpMailer } from '../src/lib/mailer';

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
