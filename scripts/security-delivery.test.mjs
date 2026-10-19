import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const require = createRequire(import.meta.url);
const app = JSON.parse(readFileSync(new URL('../mobile/app.json', import.meta.url)));
const eas = JSON.parse(readFileSync(new URL('../mobile/eas.json', import.meta.url)));
const mobilePackage = JSON.parse(readFileSync(new URL('../mobile/package.json', import.meta.url)));
const headers = readFileSync(new URL('../mobile/public/_headers', import.meta.url), 'utf8');
const resolveAppConfig = require('../mobile/app.config.js');

test('native builds isolate OTA channels and Android OS backup stays disabled', () => {
  assert.equal(app.expo.updates.enabled, true);
  assert.equal(app.expo.updates.checkAutomatically, 'ON_LOAD');
  assert.equal(app.expo.android.allowBackup, false);
  assert.equal(eas.build.production.channel, 'production');
  assert.equal(eas.build.production.environment, 'production');
  for (const name of ['preview', 'ios-simulator', 'ios-device']) {
    assert.equal(eas.build[name].channel, 'preview');
    assert.equal(eas.build[name].environment, 'preview');
  }
  assert.match(mobilePackage.scripts['update:android:preview'], /--channel preview --environment preview/);
  assert.match(mobilePackage.scripts['update:android:production'], /--channel production --environment production/);
  assert.match(mobilePackage.scripts['update:ios:preview'], /--channel preview --environment preview/);
  const priorAppEnv = process.env.APP_ENV;
  process.env.APP_ENV = 'preview';
  try {
    assert.equal(resolveAppConfig({ config: app.expo }).runtimeVersion, 'preview-13');
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
  assert.match(headers, /^\s*! Access-Control-Allow-Origin\s*$/m);
  assert.doesNotMatch(headers, /^\s*Access-Control-Allow-Origin:/m);
});

test('CSP preserves only the required external data connections', () => {
  assert.match(headers, /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/\*\.sentry\.io https:\/\/challenges\.cloudflare\.com;/);
  assert.doesNotMatch(headers, /connect-src[^;]*\s\*/);
});

// Production-only signed OTA updates (#1233). Throwaway material is minted per
// run in a temp dir; nothing here is the real Kilo key or certificate.
const SIGNING_ENV = ['APP_ENV', 'EAS_BUILD_PROFILE', 'KILO_OTA_CODE_SIGNING_CERTIFICATE', 'KILO_OTA_CODE_SIGNING_PRIVATE_KEY'];
const mobileDir = resolve(new URL('../mobile', import.meta.url).pathname);
const signingDir = mkdtempSync(join(tmpdir(), 'kilo-ota-signing-'));
after(() => rmSync(signingDir, { recursive: true, force: true }));

function mintCertificate(name, extensions) {
  const keyPath = join(signingDir, `${name}-key.pem`);
  const certPath = join(signingDir, `${name}-cert.pem`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
    '-days', '2', '-subj', `/CN=Kilo test ${name}`, ...extensions.flatMap((ext) => ['-addext', ext])], { stdio: 'ignore' });
  return { keyPath, certPath };
}

const signer = mintCertificate('signer', ['keyUsage=critical,digitalSignature', 'extendedKeyUsage=critical,codeSigning']);
const attacker = mintCertificate('attacker', ['keyUsage=critical,digitalSignature', 'extendedKeyUsage=critical,codeSigning']);
const noCodeSigning = mintCertificate('no-eku', ['keyUsage=critical,digitalSignature']);
const malformedPath = join(signingDir, 'malformed.pem');
writeFileSync(malformedPath, '-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----\n');

function withEnv(vars, fn) {
  const prior = Object.fromEntries(SIGNING_ENV.map((name) => [name, process.env[name]]));
  for (const name of SIGNING_ENV) delete process.env[name];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const name of SIGNING_ENV) {
      if (prior[name] === undefined) delete process.env[name];
      else process.env[name] = prior[name];
    }
  }
}

const resolveUpdates = (vars) => withEnv(vars, () => resolveAppConfig({ config: app.expo }).updates);

test('production builds embed the configured certificate and require signed OTA updates', () => {
  for (const marker of [{ APP_ENV: 'production' }, { EAS_BUILD_PROFILE: 'production' }]) {
    const resolved = withEnv({ ...marker, KILO_OTA_CODE_SIGNING_CERTIFICATE: signer.certPath }, () => resolveAppConfig({ config: app.expo }));
    const { updates } = resolved;
    // Signed builds never share a runtime with unsigned production installs.
    assert.equal(resolved.runtimeVersion, `${app.expo.version}-signed`);
    assert.equal(resolve(mobileDir, updates.codeSigningCertificate), signer.certPath);
    assert.deepEqual(updates.codeSigningMetadata, { keyid: 'main', alg: 'rsa-v1_5-sha256' });
    assert.notEqual(updates.codeSigningAllowUnsignedManifests, true);
    assert.equal(updates.url, app.expo.updates.url);
  }
  assert.deepEqual(eas.build.production.env, { APP_ENV: 'production' });
});

test('production fails closed on missing or malformed signing material without echoing it', () => {
  const cases = [
    [{}, /KILO_OTA_CODE_SIGNING_CERTIFICATE is not set/],
    [{ KILO_OTA_CODE_SIGNING_CERTIFICATE: join(signingDir, 'absent.pem') }, /not point at a readable file/],
    [{ KILO_OTA_CODE_SIGNING_CERTIFICATE: malformedPath }, /not a valid PEM X\.509 certificate/],
    [{ KILO_OTA_CODE_SIGNING_CERTIFICATE: signer.keyPath }, /contains private key material/],
    [{ KILO_OTA_CODE_SIGNING_CERTIFICATE: noCodeSigning.certPath }, /lacks the codeSigning extended key usage/],
  ];
  for (const marker of [{ APP_ENV: 'production' }, { EAS_BUILD_PROFILE: 'production' }]) {
    for (const [vars, expected] of cases) {
      assert.throws(() => resolveUpdates({ ...marker, ...vars }), (error) => {
        assert.match(error.message, /^Production OTA signing: /);
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /-----BEGIN|MII/);
        return true;
      });
    }
  }
});

test('preview, simulator, development, and local config stay unsigned even with signing material present', () => {
  for (const appEnv of ['preview', 'development', undefined]) {
    for (const certificate of [undefined, signer.certPath]) {
      const vars = {};
      if (appEnv) vars.APP_ENV = appEnv;
      if (certificate) vars.KILO_OTA_CODE_SIGNING_CERTIFICATE = certificate;
      const resolved = withEnv(vars, () => resolveAppConfig({ config: app.expo }));
      assert.deepEqual(resolved.updates, app.expo.updates);
      assert.deepEqual(resolved.runtimeVersion, appEnv === 'preview' ? 'preview-13' : { policy: 'appVersion' });
    }
  }
  for (const [name, profile] of Object.entries(eas.build)) {
    if (name === 'production') continue;
    assert.notEqual(profile.env?.APP_ENV, 'production', name);
    assert.ok(!Object.keys(profile.env || {}).some((key) => key.startsWith('KILO_OTA_')), name);
  }
  for (const script of ['update:android:preview', 'update:ios:preview']) {
    assert.doesNotMatch(mobilePackage.scripts[script], /KILO_OTA_|private-key-path|assertProductionUpdateSigning/);
  }
});

test('production update preflight runs before publishing and requires the matching private key', () => {
  const script = mobilePackage.scripts['update:android:production'];
  const preflight = script.indexOf('assertProductionUpdateSigning()');
  assert.ok(preflight >= 0 && preflight < script.indexOf('&& APP_ENV=production eas update'));
  assert.match(script, /--private-key-path "\$KILO_OTA_CODE_SIGNING_PRIVATE_KEY"$/);
  const certificate = { KILO_OTA_CODE_SIGNING_CERTIFICATE: signer.certPath };
  const preflightWith = (vars) => withEnv({ APP_ENV: 'production', ...certificate, ...vars }, () => resolveAppConfig.assertProductionUpdateSigning());
  assert.doesNotThrow(() => preflightWith({ KILO_OTA_CODE_SIGNING_PRIVATE_KEY: signer.keyPath }));
  for (const [vars, expected] of [
    [{}, /KILO_OTA_CODE_SIGNING_PRIVATE_KEY is not set/],
    [{ KILO_OTA_CODE_SIGNING_PRIVATE_KEY: malformedPath }, /not a valid unencrypted PEM private key/],
    [{ KILO_OTA_CODE_SIGNING_PRIVATE_KEY: attacker.keyPath }, /does not match KILO_OTA_CODE_SIGNING_CERTIFICATE/],
  ]) {
    assert.throws(() => preflightWith(vars), expected);
  }
});

test('tracked config embeds no signing keys or certificates', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: mobileDir, encoding: 'utf8' }).split('\n');
  assert.deepEqual(tracked.filter((file) => /\.(pem|key|p8|p12|jks|keystore|der|crt)$/i.test(file)), []);
  for (const file of ['app.json', 'app.config.js', 'eas.json', 'package.json']) {
    assert.doesNotMatch(readFileSync(join(mobileDir, file), 'utf8'), /-----BEGIN [A-Z ]+-----/, file);
  }
});
