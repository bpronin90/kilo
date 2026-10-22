// Renders Account auth feedback states (#1565) on a local web build that points
// at the fake host localfake.supabase.co. Every request to that host is answered
// here; Turnstile is stubbed. No production project or data is involved.
// Usage: node capture.mjs <url> <outDir> <prefix> [<width>x<height>, default 390x844]
import { chromium } from '/home/benpronin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
const [url, outDir, prefix, viewportArg = '390x844'] = process.argv.slice(2);
const [vw, vh] = viewportArg.split('x').map(Number);
const KEY = 'sb-localfake-auth-token';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'evidence@example.com', app_metadata: { provider: 'email' }, user_metadata: {} };
const jwt = (exp) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
const session = (exp) => ({ access_token: jwt(exp), refresh_token: 'fake-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user });

const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });

async function open({ signedIn }) {
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await ctx.route(/localfake\.supabase\.co/, async (route) => {
    const u = new URL(route.request().url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
    if (route.request().method() === 'OPTIONS') return json(200, {});
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    if (u.pathname === '/auth/v1/token') return json(200, session(now + 3600));
    if (u.pathname === '/auth/v1/user') return json(200, user);
    // Restore-credential revocation fails retryably, so sign-out stops signed in.
    if (u.pathname.includes('/functions/v1/')) return json(503, { error: 'unavailable' });
    return json(200, []);
  });
  // Turnstile stub: records the render options so the script can fire the
  // token/expired callbacks deterministically.
  await ctx.route(/challenges\.cloudflare\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.turnstile={render:function(el,o){window.__ts=o;return "w";},remove:function(){},reset:function(){}};' }));
  if (signedIn) await p.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, JSON.stringify(session(now + 3600))]);
  await p.goto(url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  const skip = p.getByText(/^skip/i).first();
  await skip.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  if (await skip.isVisible().catch(() => false)) { await skip.click(); await p.waitForTimeout(800); }
  for (const label of [/^not now$/i, /^decide later$/i]) { const d = p.getByText(label).first(); if (await d.isVisible().catch(() => false)) { await d.click(); await p.waitForTimeout(800); } }
  await p.getByText('More', { exact: true }).last().click(); await p.waitForTimeout(600);
  await p.getByText('Account', { exact: true }).first().click(); await p.waitForTimeout(2500);
  return { ctx, p };
}

async function report(p, name) {
  const status = p.getByLabel('Account status');
  await status.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${outDir}/${prefix}-${name}.png` });
  const info = await status.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const live = el.closest('[aria-live]');
    const cs = getComputedStyle(el);
    // Document-order relation to nearby landmarks.
    const pos = (re) => { const n = [...document.querySelectorAll('div,a,button,[role]')].find((d) => d.childElementCount === 0 && d.offsetParent !== null && re.test(d.textContent || '')); return n ? (el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after-status' : 'before-status') : 'absent'; };
    return {
      text: el.innerText, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      overflow: { scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight },
      font: `${cs.fontSize}/${cs.lineHeight} ${cs.color}`,
      liveRegion: live ? live.getAttribute('aria-live') : null,
      privacyPolicy: pos(/^Privacy Policy$/), dangerZone: pos(/^Danger Zone$/), signOut: pos(/^Sign Out$/i), signIn: pos(/^Sign In$/i), github: pos(/^Continue with GitHub$/i),
      statusNodes: document.querySelectorAll('[aria-label="Account status"]').length,
      pageScrollW: document.documentElement.scrollWidth,
    };
  }).catch((e) => ({ error: e.message }));
  console.log(name, JSON.stringify(info));
  const snap = await p.locator('body').ariaSnapshot().catch(() => '');
  const lines = snap.split('\n');
  const i = lines.findIndex((l) => /Invalid login|Security verification|restore|revok|sign-out|Sign-out/i.test(l));
  console.log(`${name} a11y excerpt:\n${lines.slice(Math.max(0, i - 4), i + 4).join('\n')}`);
  if (p.errs.length) console.log('ERRORS', JSON.stringify(p.errs));
}

// A: signed-out sign-in failure (invalid credentials).
{
  const { ctx, p } = await open({ signedIn: false });
  await p.evaluate(() => window.__ts && window.__ts.callback('fake-token-1'));
  await p.getByLabel('Email', { exact: true }).fill('evidence@example.com');
  await p.getByLabel('Password', { exact: true }).fill('wrong-password');
  await p.getByText(/^sign in$/i).last().click();
  await p.waitForTimeout(1500);
  await report(p, 'signin-failure');
  // B: CAPTCHA expiry on the same form (long copy).
  await p.evaluate(() => window.__ts && window.__ts['expired-callback']());
  await p.waitForTimeout(600);
  await report(p, 'captcha-expired');
  await ctx.close();
}
// C: signed-in sign-out failure (revocation unavailable).
{
  const { ctx, p } = await open({ signedIn: true });
  await p.getByText(/^sign out$/i).first().click();
  await p.waitForTimeout(800);
  const confirm = p.getByRole('button', { name: /^sign out$/i });
  if (await confirm.count() > 1) await confirm.last().click();
  await p.waitForTimeout(2500);
  await report(p, 'signout-failure');
  await ctx.close();
}
await browser.close();
