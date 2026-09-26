// The web export must ship Android Digital Asset Links (issue #1164).
//
// Android Restore Credentials (#1157/#1162) uses kilo-app.pages.dev as its
// WebAuthn RP ID, and Android only lets com.benpronin.kilo use keys for that
// domain if https://kilo-app.pages.dev/.well-known/assetlinks.json is the real
// statement file. The SPA fallback answers that path with index.html (HTTP 200,
// text/html), which Google's verifier rejects, so the file must be emitted by
// the export -- including its hidden `.well-known` directory -- byte for byte.
//
// This runs a real `expo export --platform web` into a temporary directory, so
// it is slower than a unit test. The post-deploy checks (curl for 200 +
// application/json, Google's statements:list API) are owner-run, not here.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOBILE_ROOT = path.join(__dirname, '..');
const SOURCE = path.join(MOBILE_ROOT, 'public', '.well-known', 'assetlinks.json');

describe('assetlinks.json in the web export', () => {
  let outDir;

  beforeAll(() => {
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kilo-assetlinks-export-'));
    execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', outDir], {
      cwd: MOBILE_ROOT,
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    });
  }, 300000);

  afterAll(() => {
    if (outDir) fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('is a Digital Asset Links statement for the Kilo Android app', () => {
    const statements = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
    expect(Array.isArray(statements)).toBe(true);
    const [statement] = statements;
    expect(statement.relation).toEqual(
      expect.arrayContaining(['delegate_permission/common.get_login_creds']),
    );
    expect(statement.target.namespace).toBe('android_app');
    expect(statement.target.package_name).toBe('com.benpronin.kilo');
    expect(statement.target.sha256_cert_fingerprints.length).toBeGreaterThan(0);
    for (const fingerprint of statement.target.sha256_cert_fingerprints) {
      expect(fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
  });

  it('is emitted under the hidden .well-known directory, byte for byte', () => {
    const exported = path.join(outDir, '.well-known', 'assetlinks.json');
    expect(fs.existsSync(exported)).toBe(true);
    expect(fs.readFileSync(exported).equals(fs.readFileSync(SOURCE))).toBe(true);
  });

  it('is not shadowed by the SPA entry point', () => {
    const exported = fs.readFileSync(path.join(outDir, '.well-known', 'assetlinks.json'), 'utf8');
    expect(exported).not.toMatch(/<html|<!DOCTYPE/i);
    expect(fs.existsSync(path.join(outDir, 'index.html'))).toBe(true);
  });
});
