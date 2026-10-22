// Renders the signed-out Account screen after Create Account when the sign-up
// request returns HTTP 500 (#1564). supabase-js turns that 500 into an
// AuthRetryableFetchError whose message is the literal "{}". Local build
// against a fake Supabase host only; every request to that host is
// intercepted here. Usage: node capture.mjs <url> <out.png> [form.png]
import { chromium } from '/home/benpronin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
const [url, out, formShot] = process.argv.slice(2);

const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const calls = [];
await ctx.route(/localfake\.supabase\.co/, async (route) => {
  const u = new URL(route.request().url());
  calls.push(`${route.request().method()} ${u.pathname}`);
  const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  if (route.request().method() === 'OPTIONS') return reply(200, {});
  // Synthetic provider failure: HTTP 500 with an empty JSON body.
  if (u.pathname === '/auth/v1/signup') return reply(500, {});
  return reply(200, []);
});
// Stub Turnstile: render immediately issues a fake token so the password flow proceeds.
await ctx.route(/challenges\.cloudflare\.com/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.turnstile={render:function(s,o){setTimeout(function(){o.callback("fake-token-"+Date.now());},50);return "w";},remove:function(){},reset:function(){}};' }));
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(4000);
const skip = p.getByText(/^skip/i).first();
if (await skip.isVisible().catch(() => false)) { await skip.click(); await p.waitForTimeout(800); }
for (const label of [/^not now$/i, /^decide later$/i]) { const d = p.getByText(label).first(); if (await d.isVisible().catch(() => false)) { await d.click(); await p.waitForTimeout(800); } }
await p.getByText('More', { exact: true }).last().click(); await p.waitForTimeout(600);
await p.getByText('Account', { exact: true }).first().click(); await p.waitForTimeout(2500);
await p.getByLabel('Email').first().fill('evidence@example.com');
await p.getByLabel('Password').first().fill('synthetic-password-1564');
await p.waitForTimeout(500);
if (formShot) await p.screenshot({ path: formShot });
calls.length = 0;
await p.getByText('Create Account', { exact: true }).first().click();
await p.waitForTimeout(3000);
await p.getByLabel('Account status').evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
await p.waitForTimeout(400);
await p.screenshot({ path: out });
const status = await p.getByLabel('Account status').innerText().catch(() => '(no status)');
console.log('STATUS:', JSON.stringify(status));
const sb = await p.getByLabel('Account status').boundingBox().catch(() => null);
const sw = await p.getByLabel('Account status').evaluate((el) => ({ scrollW: el.scrollWidth, clientW: el.clientWidth, scrollH: el.scrollHeight, clientH: el.clientHeight, font: getComputedStyle(el).fontSize, lh: getComputedStyle(el).lineHeight })).catch(() => null);
console.log('status box:', JSON.stringify(sb), 'metrics:', JSON.stringify(sw), 'page scrollWidth:', await p.evaluate(() => document.documentElement.scrollWidth));
console.log('confirmation panel shown:', /check your email|confirm/i.test(await p.locator('body').innerText()));
console.log('network after click:', JSON.stringify(calls));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
