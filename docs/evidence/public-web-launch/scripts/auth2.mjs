import { chromium } from 'playwright-core';
const [url, dir] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const openAccount = async () => { await p.getByText('More', { exact: true }).last().click(); await p.waitForTimeout(500); await p.getByText('Account', { exact: true }).first().click(); await p.waitForTimeout(3000); };
// 1. Failed password sign-in
await p.goto(url, { waitUntil: 'networkidle' }); await openAccount();
await p.getByPlaceholder('Email').fill('kilo-launch-check-nonexistent@example.com');
await p.getByPlaceholder('Password').fill('wrong-password-123');
const authResp = p.waitForResponse(r => r.url().includes('/auth/v1/token'), { timeout: 25000 }).then(r => r.status()).catch(() => 'no token request');
await p.getByRole('button', { name: /^sign in$/i }).first().click();
console.log('token request status', await authResp); await p.waitForTimeout(2500);
await p.screenshot({ path: `${dir}/390x844-11-signin-failed.png` });
const t1 = await p.locator('body').innerText();
console.log('FAILED-SIGNIN visible messages:', t1.split('\n').filter(l => /invalid|error|fail|verif|unable|wrong|try again/i.test(l)).join(' | '));
// 2. GitHub OAuth start
const nav = p.waitForURL(u => !u.toString().startsWith(url), { timeout: 20000 }).catch(() => null);
await p.getByText(/^continue with github$/i).first().click(); await nav;
const gh = new URL(p.url());
console.log('OAUTH landed host', gh.host, 'path', gh.pathname);
const rt = decodeURIComponent(p.url()).match(/redirect_to=([^&]+)/);
console.log('redirect_to', rt ? rt[1] : '(not in url)');
// 3. Cancelled OAuth return (what Supabase sends after GitHub "Cancel")
await p.goto(url + '?error=access_denied&error_code=provider_error&error_description=The+user+has+denied+your+application+access.', { waitUntil: 'networkidle' });
await p.waitForTimeout(2500); await openAccount();
await p.screenshot({ path: `${dir}/390x844-12-oauth-cancelled.png` });
const t3 = await p.locator('body').innerText();
console.log('CANCELLED signed-out:', /SIGN IN/.test(t3) && /CONTINUE WITH GITHUB/.test(t3));
console.log('CANCELLED messages:', t3.split('\n').filter(l => /denied|error|cancel/i.test(l)).join(' | ') || '(none)');
console.log('localStorage auth keys', JSON.stringify(await p.evaluate(() => Object.keys(localStorage).filter(k => /auth|sb-/.test(k)))));
console.log('ERRORS', JSON.stringify(errs));
await b.close();
