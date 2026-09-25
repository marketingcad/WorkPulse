// Accessibility audit: signs in and runs axe-core (WCAG 2.1 A + AA) on the main screens, in
// light and dark mode. Exits non-zero when any screen has a violation.
//
//   BASE_URL=http://localhost:3000 ORG_ID=<org id> EMAIL=admin@demo.tallywork.app PASSWORD=demo-password-123 \
//   CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" \
//   pnpm dlx -p playwright-core node apps/web/scripts/a11y-audit.cjs
//
// Point it at a local server with the demo seed (`pnpm --filter @tallywork/web seed`), never production.
const { chromium } = require('playwright-core');

const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const ORG = process.env.ORG_ID;
const AXE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
const ROUTES = ['', '/tracking/live', '/activity', '/sessions', '/timesheets', '/timesheets/approvals', '/timesheets/team', '/timesheets/manual', '/workers', '/projects', '/clients', '/tasks', '/teams', '/attendance', '/time-off', '/schedules', '/finance/invoices', '/finance/invoices/new', '/finance/expenses', '/finance/budgets', '/finance/billing', '/finance/payments', '/reports', '/reports/time-activity', '/settings', '/settings/security', '/settings/roles', '/settings/policies', '/settings/audit', '/settings/access-review', '/developer/webhooks', '/developer/api-keys', '/me/profile', '/me/monitoring', '/devices'];

async function audit(browser, axe, scheme) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: scheme });
  const scan = async (route) => {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(700);
    await page.addScriptTag({ content: axe });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) })));
    return { route, violations };
  };
  const results = [];
  await page.goto(`${BASE}/login`);
  results.push(await scan('/login'));
  await page.fill('input[type=email]', process.env.EMAIL);
  await page.fill('input[type=password]', process.env.PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(/\/o\//, { timeout: 30000 });
  for (const r of ROUTES) {
    await page.goto(`${BASE}/o/${ORG}${r}`);
    results.push(await scan(r || '/'));
  }
  await page.close();
  return results;
}

(async () => {
  if (!ORG || !process.env.EMAIL || !process.env.PASSWORD) throw new Error('Set ORG_ID, EMAIL and PASSWORD');
  const axe = await (await fetch(AXE_URL)).text();
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chrome' }) });
  let failed = 0;
  for (const scheme of ['light', 'dark']) {
    for (const { route, violations } of await audit(browser, axe, scheme)) {
      for (const v of violations) {
        failed++;
        console.log(`${scheme} ${route}: ${v.impact} ${v.id} — ${v.help} (${v.nodes.length}) e.g. ${v.nodes[0]}`);
      }
    }
    console.log(`${scheme}: ${ROUTES.length + 1} screens checked`);
  }
  await browser.close();
  if (failed) {
    console.error(`${failed} violation(s)`);
    process.exit(1);
  }
  console.log('No accessibility violations (WCAG 2.1 A/AA).');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
