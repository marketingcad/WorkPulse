import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { escapeHtml, renderEmail } from '../src/lib/email';
import { orgLink } from '../src/services/notify';
import { Client, createHarness, signup, type Harness } from './harness';

// Every email uses one branded layout (HTML + plain text). Names come from users, so the HTML must
// escape them; links in notification emails must point into the organization (audit INT-2).
describe('email layout', () => {
  const mail = renderEmail(
    {
      subject: 'Invoice INV-1 from Acme <Labs>',
      preheader: '$10.00 due 2026-11-01',
      heading: 'Invoice INV-1',
      paragraphs: ['Acme <Labs> sent you "invoice" INV-1.'],
      details: [{ label: 'Amount due', value: '$10.00', strong: true }],
      action: { label: 'Pay now', url: 'https://app.example/pay?a=1&b=2' },
      note: 'Questions? Reply to Acme.',
      reason: 'You received this email because Acme sent you an invoice.',
    },
    { appUrl: 'https://app.example/', to: 'client@example.com' },
  );

  it('escapes names and text so they cannot inject markup', () => {
    expect(mail.html).toContain('Acme &lt;Labs&gt; sent you &quot;invoice&quot; INV-1.');
    expect(mail.html).not.toContain('<Labs>');
    expect(escapeHtml(`<script>alert('x')</script>`)).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
  });

  it('has the logo, heading, button, details, note and footer', () => {
    expect(mail.html).toContain('src="https://app.example/email/logo.png"');
    expect(mail.html).toContain('>Invoice INV-1</h1>');
    expect(mail.html).toContain('href="https://app.example/pay?a=1&amp;b=2"');
    expect(mail.html).toContain('>Pay now</a>');
    expect(mail.html).toContain('Amount due');
    expect(mail.html).toContain('This email was sent to client@example.com.');
  });

  it('has a plain-text version with the same content and the full link', () => {
    expect(mail.text).toContain('Invoice INV-1');
    expect(mail.text).toContain('Amount due: $10.00');
    expect(mail.text).toContain('Pay now: https://app.example/pay?a=1&b=2');
    expect(mail.text).toContain('You received this email because Acme sent you an invoice.');
    expect(mail.subject).toBe('Invoice INV-1 from Acme <Labs>');
  });

  it('notification links open the page inside the organization', () => {
    expect(orgLink('https://app.example', 'org-1', '/timesheets/approvals')).toBe('https://app.example/o/org-1/timesheets/approvals');
    expect(orgLink('https://app.example', 'org-1', '/')).toBe('https://app.example/o/org-1');
  });
});

describe('emails the app sends', () => {
  let t: Harness;
  let admin: Client;
  let orgId: string;
  beforeAll(async () => {
    t = await createHarness();
    ({ client: admin, orgId } = await signup(t, 'Ada', 'ada@email.test', 'Ada <Studio>'));
  });
  afterAll(() => t.close());

  it('an invitation is a branded email with an Accept button, the role and the link', async () => {
    const roles = await admin.get<Array<{ id: string; key: string; name: string }>>(`/orgs/${orgId}/roles`);
    const worker = roles.body.find((r) => r.key === 'WORKER')!;
    const r = await admin.post<{ invite_url: string }>(`/orgs/${orgId}/invitations`, { email: 'new@email.test', name: 'New', role_id: worker.id });
    expect(r.status).toBe(201);
    const m = t.mailer.sent.at(-1)!;
    expect(m.to).toBe('new@email.test');
    expect(m.subject).toBe("You're invited to Ada <Studio> on WorkPulse");
    expect(m.html).toContain('Join Ada &lt;Studio&gt; on WorkPulse');
    expect(m.html).toContain('>Accept invitation</a>');
    expect(m.html).toContain(`You'll join as ${worker.name}.`.replace("'", '&#39;'));
    expect(m.text).toContain(`Accept invitation: ${r.body.invite_url}`);
  });

  it('a password reset email has a Reset button and says when it expires', async () => {
    await new Client(t).post('/auth/password/forgot', { email: 'ada@email.test' });
    const m = t.mailer.sent.at(-1)!;
    expect(m.subject).toBe('Reset your WorkPulse password');
    expect(m.html).toContain('>Reset password</a>');
    expect(m.text).toMatch(/Reset password: http\S+\/reset-password\?token=\S+/);
    expect(m.text).toContain('This link expires in 1 hour.');
  });
});
