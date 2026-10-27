// Usage: node docs/evidence/support-email/capture.mjs http://localhost:8093
import { chromium } from '/home/benpronin/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
// Keep the capture local; prevent the browser from launching an external mail app.
await page.addInitScript(() => { window.open = () => null; });
await page.goto(process.argv[2] || 'http://localhost:8093', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
for (const pattern of [/^skip/i, /^not now$/i, /^decide later$/i]) {
  const control = page.getByText(pattern).first();
  if (await control.isVisible().catch(() => false)) await control.click();
}
await page.getByText('More', { exact: true }).last().click();
await page.getByText('Send Feedback', { exact: true }).click();
await page.getByText(/send your feedback to support@kilofitnesstracker.com/).waitFor();
await page.waitForTimeout(700); // Wait for the dialog fade-in before capturing.
await page.screenshot({ path: 'docs/evidence/support-email/after.png' });
console.log(await page.locator('body').innerText());
await browser.close();
