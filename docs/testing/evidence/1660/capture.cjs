const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    localStorage.setItem('kilo:welcome-walkthrough:v1', '{"version":1,"dismissed":true}');
  });
  await page.goto('http://127.0.0.1:8106/');
  await page.getByRole('tab', { name: 'More', exact: true }).click({ timeout: 30000 });
  const link = page.getByRole('link', { name: 'Download on Google Play', exact: true });
  await link.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  if (await link.getAttribute('href') !== 'https://play.google.com/store/apps/details?id=com.benpronin.kilo') throw Error('Wrong listing');
  if (await link.getAttribute('target') !== '_blank') throw Error('Missing new-tab target');
  await page.screenshot({ path: path.join(__dirname, 'more-web-390.png') });
  // Intercept the external destination: verify browser navigation without depending on Play availability.
  await page.context().route('https://play.google.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Play listing navigation verified</title>' }));
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await popup.waitForLoadState();
  if (!popup.url().startsWith('https://play.google.com/store/apps/details?id=com.benpronin.kilo')) throw Error('Wrong popup');
  if (page.url() !== 'http://127.0.0.1:8106/') throw Error('Web app replaced');
  console.log('PASS: accessible link, exact listing, new tab, original app retained');
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
