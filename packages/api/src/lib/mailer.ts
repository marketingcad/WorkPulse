export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

/** Development/test mailer: keeps messages in memory and logs a one-line summary. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(private readonly log = false) {}
  async send(msg: MailMessage): Promise<void> {
    this.sent.push(msg);
    if (this.log) console.info(`[mail] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
  }
}

/** Resend HTTP API mailer (enabled when RESEND_API_KEY is set). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(msg: MailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
  }
}

export function createMailer(env: Record<string, string | undefined> = process.env): Mailer {
  if (env.RESEND_API_KEY) return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM ?? 'Tallywork <no-reply@tallywork.app>');
  return new MemoryMailer(env.NODE_ENV !== 'test');
}
