import type { MailMessage } from './mailer';

/**
 * One layout for every email WorkPulse sends: logo, heading, short paragraphs, one button, an
 * optional details box, small print, and a footer saying why the person got it. Built from tables
 * with inline styles so it renders the same in Gmail, Outlook and Apple Mail, and always paired with
 * a plain-text version. Every value is escaped: names come from users and must not inject markup.
 */
export interface EmailContent {
  subject: string;
  /** The line inbox lists show after the subject. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Label / value rows, e.g. an invoice's amount and due date. */
  details?: Array<{ label: string; value: string; strong?: boolean }>;
  /** Small print under the button, e.g. when the link expires. */
  note?: string;
  /** Why the person gets this email. */
  reason: string;
}

const C = {
  page: '#f4f6f9',
  card: '#ffffff',
  border: '#e3e8ef',
  navy: '#0f2240',
  text: '#1f2937',
  muted: '#6b7280',
  button: '#1766ff',
  panel: '#f7f9fc',
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const para = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

export function renderEmail(c: EmailContent, opts: { appUrl: string; to: string }): MailMessage {
  const base = opts.appUrl.replace(/\/$/, '');
  const button = c.action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 8px">
        <tr><td align="center" bgcolor="${C.button}" style="border-radius:8px">
          <a href="${escapeHtml(c.action.url)}" target="_blank" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(c.action.label)}</a>
        </td></tr>
      </table>
      <p style="margin:12px 0 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}">Or copy this link into your browser:<br><a href="${escapeHtml(c.action.url)}" style="color:${C.button};word-break:break-all">${escapeHtml(c.action.url)}</a></p>`
    : '';
  const details = c.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;background:${C.panel};border:1px solid ${C.border};border-radius:8px">
        ${c.details
          .map(
            (d, i) => `<tr>
          <td style="padding:10px 16px;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted}">${escapeHtml(d.label)}</td>
          <td align="right" style="padding:10px 16px;${i ? `border-top:1px solid ${C.border};` : ''}font-family:${FONT};font-size:14px;line-height:20px;color:${C.text};font-weight:${d.strong ? 700 : 500}">${escapeHtml(d.value)}</td>
        </tr>`,
          )
          .join('')}
      </table>`
    : '';
  const note = c.note ? `<p style="margin:20px 0 0;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted}">${para(c.note)}</p>` : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(c.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page}">
  <tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
      <tr><td style="padding:0 4px 20px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle"><img src="${base}/email/logo.png" width="32" height="32" alt="" style="display:block;border:0"></td>
          <td style="vertical-align:middle;padding-left:10px;font-family:${FONT};font-size:18px;font-weight:700;color:${C.navy};letter-spacing:-0.2px">WorkPulse</td>
        </tr></table>
      </td></tr>
      <tr><td style="background:${C.card};border:1px solid ${C.border};border-top:4px solid ${C.button};border-radius:12px;padding:36px 36px 32px">
        <h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:${C.navy}">${escapeHtml(c.heading)}</h1>
        ${c.paragraphs.map((p) => `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.text}">${para(p)}</p>`).join('\n        ')}
        ${details}
        ${button}
        ${note}
      </td></tr>
      <tr><td style="padding:24px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted}" align="center">
        ${para(c.reason)}<br>
        This email was sent to ${escapeHtml(opts.to)}.<br>
        <a href="${base}" style="color:${C.muted}">WorkPulse</a> · Track • Focus • Achieve
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    c.heading,
    '',
    ...c.paragraphs.flatMap((p) => [p, '']),
    ...(c.details?.length ? [...c.details.map((d) => `${d.label}: ${d.value}`), ''] : []),
    ...(c.action ? [`${c.action.label}: ${c.action.url}`, ''] : []),
    ...(c.note ? [c.note, ''] : []),
    '—',
    c.reason,
    `This email was sent to ${opts.to}.`,
  ].join('\n');

  return { to: opts.to, subject: c.subject, text, html };
}
