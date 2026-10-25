// The browser leg of the OAuth flow, driven through the real Kilo web build: a
// signed-out user follows the authorization link to /oauth/consent, signs in with
// the password form, reads the disclosure and chooses Approve or Deny. Local only:
// the web build must be served by stack.sh (127.0.0.1:8081) and talk to the
// disposable stack. Screenshots hold synthetic data only.

import { chromium } from 'playwright-core'
import { type Session } from './lib.ts'

export const WEB = 'http://localhost:8081'

async function chromiumPath(): Promise<string> {
  const fromEnv = Deno.env.get('KILO_MCP_CHROMIUM')
  if (fromEnv) return fromEnv
  const base = `${Deno.env.get('HOME')}/.cache/ms-playwright`
  const found: string[] = []
  for await (const e of Deno.readDir(base)) if (/^chromium-\d+$/.test(e.name)) found.push(`${base}/${e.name}/chrome-linux64/chrome`)
  if (!found.length) throw new Error('no Chromium found; set KILO_MCP_CHROMIUM')
  return found.sort().at(-1)!
}

export async function webServed(): Promise<boolean> {
  try {
    const r = await fetch(`${WEB}/oauth/consent`)
    const html = await r.text()
    return r.ok && html.includes('id="root"')
  } catch {
    return false
  }
}

// Returns the redirect the browser was sent to for the client (callback with code or
// error). The callback address is intercepted, so no client listener is needed.
export async function browserDecision(user: Session, authorizationUrl: URL, action: 'approve' | 'deny', shotsDir?: string, prefix = 'browser'): Promise<URL> {
  const browser = await chromium.launch({ executablePath: await chromiumPath(), headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
    let callback: string | null = null
    await page.route(`${new URL(authorizationUrl.searchParams.get('redirect_uri')!).origin}/**`, (route) => {
      callback = route.request().url()
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>client callback</p>' })
    })
    const shot = async (name: string) => { if (shotsDir) await page.screenshot({ path: `${shotsDir}/${prefix}-${name}.png` }) }

    await page.goto(authorizationUrl.toString())
    await page.getByLabel('Email', { exact: true }).waitFor({ timeout: 20_000 })
    if (new URL(page.url()).pathname !== '/oauth/consent') throw new Error('authorize did not land on /oauth/consent')
    if (new URL(page.url()).search) throw new Error('authorization id left in the visible URL')
    await shot('1-signed-out')
    await page.getByLabel('Email', { exact: true }).fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill(user.password)
    // The Turnstile test widget needs a moment to produce its token before sign-in enables.
    await page.waitForTimeout(3000)
    await page.getByRole('button', { name: /^sign in$/i }).last().click()
    const decide = page.getByText(action === 'approve' ? 'Approve' : 'Deny', { exact: true })
    await decide.first().waitFor({ timeout: 20_000 })
    await page.getByText('Provided by the client, not verified by Kilo.').first().waitFor({ timeout: 5000 })
    await shot('2-disclosure')
    await decide.first().click()
    for (let i = 0; i < 40 && !callback; i++) await page.waitForTimeout(250)
    if (!callback) throw new Error('browser never reached the client callback')
    await shot(action === 'approve' ? '3-approved' : '3-denied')
    return new URL(callback)
  } finally {
    await browser.close()
  }
}
