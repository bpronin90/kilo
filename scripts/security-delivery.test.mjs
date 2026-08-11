import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const app = JSON.parse(readFileSync(new URL('../mobile/app.json', import.meta.url)));
const eas = JSON.parse(readFileSync(new URL('../mobile/eas.json', import.meta.url)));
const mobilePackage = JSON.parse(readFileSync(new URL('../mobile/package.json', import.meta.url)));
const headers = readFileSync(new URL('../mobile/public/_headers', import.meta.url), 'utf8');
const resolveAppConfig = require('../mobile/app.config.js');

test('native builds reject OTA updates and Android OS backup', () => {
  assert.equal(app.expo.updates.enabled, false);
  assert.equal(app.expo.updates.checkAutomatically, 'NEVER');
  assert.equal(app.expo.android.allowBackup, false);
  for (const profile of Object.values(eas.build)) {
    assert.equal(profile.channel, undefined);
  }
  assert.equal(eas.build.production.environment, 'production');
  for (const name of ['preview', 'ios-simulator', 'ios-device']) {
    assert.equal(eas.build[name].environment, 'preview');
  }
  assert.match(mobilePackage.scripts['update:blocked'], /process\.exit\(1\)/);
  for (const name of ['update:android:preview', 'update:android:production', 'update:ios:preview']) {
    assert.equal(mobilePackage.scripts[name], 'npm run update:blocked');
  }
  const priorAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = 'preview';
  try {
    assert.equal(resolveAppConfig({ config: app.expo }).runtimeVersion, 'preview-5');
  } finally {
    if (priorAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = priorAppEnv;
  }
});

test('static headers enforce anti-framing and narrow browser capabilities', () => {
  assert.match(headers, /^\/\*/m);
  assert.match(headers, /Content-Security-Policy: .*frame-ancestors 'none'/);
  assert.match(headers, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
  assert.match(headers, /frame-src https:\/\/challenges\.cloudflare\.com;/);
  assert.doesNotMatch(headers, /script-src[^;]*'unsafe-inline'/);
  assert.doesNotMatch(headers, /script-src[^;]*'unsafe-eval'/);
  assert.match(headers, /Permissions-Policy: .*camera=\(\).*geolocation=\(\).*microphone=\(\)/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
  assert.match(headers, /X-Frame-Options: DENY/);
});

test('CSP preserves only the required external data connections', () => {
  assert.match(headers, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/\*\.sentry\.io https:\/\/challenges\.cloudflare\.com;/);
  assert.doesNotMatch(headers, /connect-src[^;]*\s\*/);
});
