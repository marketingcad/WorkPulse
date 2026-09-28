import nodemailer, { type Transporter } from 'nodemailer';

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

export interface SmtpOptions {
  host: string;
  port: number;
  /** implicit TLS (port 465); otherwise STARTTLS is negotiated */
  secure: boolean;
  user?: string;
  pass?: string;
}

/** SMTP mailer (enabled when SMTP_HOST is set), e.g. Gmail with an app password. */
export class SmtpMailer implements Mailer {
  private readonly transport: Pick<Transporter, 'sendMail'>;
  constructor(
    opts: SmtpOptions,
    private readonly from: string,
    transport?: Pick<Transporter, 'sendMail'>,
  ) {
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: opts.host,
        port: opts.port,
        secure: opts.secure,
        auth: opts.user ? { user: opts.user, pass: opts.pass ?? '' } : undefined,
      });
  }
  async send(msg: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
  }
}

export function createMailer(env: Record<string, string | undefined> = process.env): Mailer {
  if (env.RESEND_API_KEY) return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM ?? 'Tallywork <no-reply@tallywork.app>');
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT ?? 465);
    const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
    // Gmail rewrites any other From address to the signed-in account, so default to it.
    const from = env.MAIL_FROM ?? (env.SMTP_USER ? `Tallywork <${env.SMTP_USER}>` : 'Tallywork <no-reply@tallywork.app>');
    return new SmtpMailer({ host: env.SMTP_HOST, port, secure, user: env.SMTP_USER, pass: env.SMTP_PASS }, from);
  }
  return new MemoryMailer(env.NODE_ENV !== 'test');
}
