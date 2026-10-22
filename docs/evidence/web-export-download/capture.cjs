// Local-only capture for #1563. Serves a local web export, injects a fake
// session for the mock project `mockproj`, fulfills every Supabase call with
// synthetic data, and blocks all other non-local traffic. No production access.
// Usage: node capture.cjs <distDir> <label> <outDir>
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('/home/benpronin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core');

const [dist, label, out] = process.argv.slice(2);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let f = path.join(dist, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'e2e-local@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {} };
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, email: USER.email, role: 'authenticated', aud: 'authenticated', exp: now + 7200, iat: now })}.c2ln`;
const SESSION = { access_token: JWT, refresh_token: 'mock-refresh', token_type: 'bearer', expires_in: 7200, expires_at: now + 7200, user: USER };
// MOCKED account-export response (synthetic; identifies itself as mocked).
const ACCOUNT_EXPORT = { version: 3, mocked: 'local #1563 evidence, not a server response', exportedAt: new Date().toISOString(), account: { id: USER.id, email: USER.email }, cloud: { weight_entries: [{ date: '2026-10-01', weight_value: 81.5, note: 'Morgenwiegen ✓ 体重' }] } };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const log = [];
  await ctx.addInitScript(([k, v]) => {
    // Sharing unavailable, as in the reported desktop browsers.
    delete Navigator.prototype.share;
    if (!sessionStorage.getItem('injected')) { localStorage.setItem(k, v); sessionStorage.setItem('injected', '1'); }
  }, ['sb-mockproj-auth-token', JSON.stringify(SESSION)]);
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.hostname === '127.0.0.1') return route.continue();
    if (u.hostname !== 'mockproj.supabase.co') { log.push(`blocked ${u.hostname}`); return route.abort(); }
    log.push(`mock ${req.method()} ${u.pathname}`);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body) => route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const p = u.pathname;
    if (p.endsWith('/auth/v1/user')) return json(USER);
    if (p.endsWith('/auth/v1/token')) return json(SESSION);
    if (p.endsWith('/functions/v1/account-export')) return json(ACCOUNT_EXPORT);
    if (p.endsWith('/rpc/health_sync_preflight')) return json({ allowed: true, code: 'OK' });
    if (p.includes('/rest/v1/consent_revision')) {
      const row = { catalog_revision: 1, material_version: 1, privacy_policy_url: 'https://example.invalid/privacy.html' };
      return json(/vnd\.pgrst\.object/.test(req.headers().accept || '') ? row : [row]);
    }
    if (p.includes('/rest/v1/')) return json(/vnd\.pgrst\.object/.test(req.headers().accept || '') ? null : []);
    return json({});
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') log.push(`console.error ${m.text().slice(0, 160)}`); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const w = page.getByTestId('welcome-walkthrough');
  for (let i = 0; i < 8 && await w.isVisible().catch(() => false); i++) {
    const btn = w.getByText(/^(Skip|Get started|Done|Close)$/i).last();
    if (!(await btn.count())) break;
    await btn.click(); await page.waitForTimeout(400);
  }
  const own = page.getByTestId('ownership-prompt');
  if (await own.isVisible().catch(() => false)) { await own.getByText('Not Now').click(); await page.waitForTimeout(600); }
  await page.getByText('More', { exact: true }).last().click();
  await page.waitForTimeout(800);
  await page.getByText(/^Data & Backup$/).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${label}-01-export-section.png` });

  const results = [];
  async function run(name, buttonText, confirmText) {
    await page.getByText(buttonText, { exact: true }).first().scrollIntoViewIfNeeded();
    const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
    await page.getByText(buttonText, { exact: true }).first().click();
    if (confirmText) { await page.getByText(confirmText, { exact: true }).last().click(); }
    const d = await dl;
    await page.waitForTimeout(800);
    const r = { action: name, download: null };
    if (d) {
      const file = await d.path();
      const buf = fs.readFileSync(file);
      const textBody = buf.toString('utf8');
      let parse = 'n/a';
      if (d.suggestedFilename().endsWith('.json')) { try { JSON.parse(textBody); parse = 'JSON.parse ok'; } catch (e) { parse = `JSON.parse FAILED ${e.message}`; } }
      else parse = `csv header: ${textBody.split('\n')[0]}`;
      r.download = { filename: d.suggestedFilename(), bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), parse };
      if (name === 'Export Account Data') r.download.unicodePreserved = textBody.includes('Morgenwiegen ✓ 体重');
    }
    const body = await page.locator('body').innerText();
    r.exportFailedShown = /Export failed|Cloud export failed/.test(body);
    r.status = (body.match(/(Backup downloaded\.|CSV downloaded\.|Account data exported\.|Cloud export ready\.|Export failed[^\n]*|Cloud export failed\.)/g) || []).join(' | ');
    results.push(r);
    return r;
  }
  await run('Export Local Backup', 'Export Local Backup', 'Export anyway');
  await page.screenshot({ path: `${out}/${label}-02-local-backup.png` });
  await run('Export Workouts CSV', 'Export Workouts CSV', 'Export anyway');
  await run('Export Weight CSV', 'Export Weight CSV', 'Export anyway');
  await run('Export Account Data', 'Export Account Data', null);
  await page.screenshot({ path: `${out}/${label}-03-account-data.png` });
  await run('Export Cloud Copy', 'Export Cloud Copy', null);
  await page.screenshot({ path: `${out}/${label}-04-cloud-copy.png` });
  console.log(JSON.stringify({ label, results }, null, 2));
  console.log('--- network log (unique)');
  console.log([...new Set(log)].join('\n'));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
