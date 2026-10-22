// Renders the Account screen sign-out with a session whose lookup resolves
// { session: null, error } (expired access token + non-retryable refresh
// failure). Local build against a fake Supabase host only; every request to
// that host is intercepted here. Usage: node capture.mjs <url> <out.png>
import { chromium } from '/home/benpronin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
const [url, out] = process.argv.slice(2);
const KEY = 'sb-localfake-auth-token';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'evidence@example.com', app_metadata: { provider: 'email' }, user_metadata: {} };
const jwt = (exp) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
const session = (exp) => ({ access_token: jwt(exp), refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user });

const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const calls = [];
let refreshFails = false;
await ctx.route(/localfake\.supabase\.co/, async (route) => {
  const u = new URL(route.request().url());
  calls.push(`${route.request().method()} ${u.pathname}`);
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  if (route.request().method() === 'OPTIONS') return json(200, {});
  if (u.pathname === '/auth/v1/token') return refreshFails ? json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }) : json(200, session(now + 3600));
  if (u.pathname === '/auth/v1/user') return json(200, user);
  if (u.pathname.includes('/functions/v1/')) return json(200, { version: 1, revoked: true });
  return json(200, []);
});
// Stub Turnstile so the signed-out form's widget does not overwrite the status line.
await ctx.route(/challenges\.cloudflare\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.turnstile={render:function(){return "w";},remove:function(){},reset:function(){}};' }));
await p.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(session(now + 3600))]);
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
const skip = p.getByText(/^skip/i).first();
if (await skip.isVisible().catch(() => false)) { await skip.click(); await p.waitForTimeout(800); }
for (const label of [/^not now$/i, /^decide later$/i]) { const d = p.getByText(label).first(); if (await d.isVisible().catch(() => false)) { await d.click(); await p.waitForTimeout(800); } }
await p.getByText('More', { exact: true }).last().click(); await p.waitForTimeout(600);
await p.getByText('Account', { exact: true }).first().click(); await p.waitForTimeout(2500);
if (process.argv[4]) await p.screenshot({ path: process.argv[4] });
console.log('signed-in view before sign-out:', /sign out/i.test(await p.locator('body').innerText()));
// The SDK's stored session now has an expired access token and its refresh is refused.
refreshFails = true;
await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(session(now - 60))]);
calls.length = 0;
await p.getByText(/^sign out$/i).first().click();
await p.waitForTimeout(800);
const confirm = p.getByRole('button', { name: /^sign out$/i });
if (await confirm.count() > 1) { await confirm.last().click(); }
await p.waitForTimeout(3000);
await p.getByLabel('Account status').evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
await p.waitForTimeout(400);
await p.screenshot({ path: out });
const text = await p.locator('body').innerText();
const status = await p.getByLabel('Account status').innerText().catch(() => '(no status)');
console.log('STATUS:', status);
const sb = await p.getByLabel('Account status').boundingBox().catch(() => null);
const nav = await p.evaluate(() => { const el = [...document.querySelectorAll('div')].filter((d) => d.innerText === 'Home').pop(); let n = el; for (let i = 0; i < 4 && n; i++) n = n.parentElement; const r = n?.getBoundingClientRect(); return r ? { top: r.top } : null; });
const sw = await p.getByLabel('Account status').evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight })).catch(() => null);
console.log('status box:', JSON.stringify(sb), 'overflow:', JSON.stringify(sw), 'tab bar top (approx):', JSON.stringify(nav), 'page scrollWidth:', await p.evaluate(() => document.documentElement.scrollWidth));
console.log('sign-in form visible:', /sign in/i.test(text), '| sign-out button visible:', /sign out/i.test(text));
console.log('network after click:', JSON.stringify(calls));
console.log('stored session key present:', await p.evaluate((k) => localStorage.getItem(k) != null, KEY));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
