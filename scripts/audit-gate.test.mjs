import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advisoryKey, collectAdvisories, evaluate, parseReport, readAllowlist } from './audit-gate.mjs';

const imageSize = {
  source: 1109834,
  name: 'image-size',
  severity: 'high',
  title: 'image-size: ICNS parser allows denial of service through an infinite loop',
  url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
  range: '<=2.0.2',
};

function report(vulnerabilities) {
  return JSON.stringify({ vulnerabilities, metadata: { vulnerabilities: { high: 1 } } });
}

function fixture(accepted) {
  const root = mkdtempSync(join(tmpdir(), 'kilo-audit-'));
  if (accepted) writeFileSync(join(root, 'audit-allowlist.json'), JSON.stringify({ accepted }, null, 2));
  return root;
}

function entry(overrides = {}) {
  return {
    id: 'GHSA-w3rx-r6r6-pgpr',
    package: 'image-size',
    reviewBy: '2026-09-07',
    reason: 'No patched release exists and the dependency is build-time only, never shipped to devices.',
    ...overrides,
  };
}

test('a registry failure payload is rejected, never read as a clean tree', () => {
  const failure = JSON.stringify({
    message: '403 Forbidden - GET https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
    error: { code: 'E403', summary: '403 Forbidden', detail: '' },
  });
  assert.throws(() => parseReport(failure, 'mobile'), /mobile: npm audit failed \(403 Forbidden\)/);
  assert.throws(() => collectAdvisories(failure, 'mobile'), /npm audit failed/);
});

test('a transport failure reports its cause even when summary and detail are empty', () => {
  // The exact payload npm 11 emits when the audit endpoint is unreachable.
  const unreachable = JSON.stringify({
    message: 'request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
    error: { summary: '', detail: '' },
  });
  assert.throws(() => parseReport(unreachable, 'mobile'), /npm audit failed \(request to .* ECONNREFUSED/);
});

test('a payload without vulnerabilities and metadata is rejected even with no error key', () => {
  assert.throws(() => parseReport(JSON.stringify({ message: 'ENOTFOUND' }), 'mobile'), /did not return an audit report: ENOTFOUND/);
  assert.throws(() => parseReport(JSON.stringify({ vulnerabilities: {} }), '.'), /did not return an audit report/);
  assert.throws(() => parseReport('<html>502</html>', '.'), /did not return JSON/);
  assert.throws(() => parseReport('null', '.'), /did not return an audit report/);
});

test('a genuinely clean report parses to an empty advisory set', () => {
  const clean = JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { high: 0 } } });
  assert.equal(collectAdvisories(clean).size, 0);
});

test('one advisory affecting two packages stays two separate findings', () => {
  const advisories = collectAdvisories(report({
    'image-size': { severity: 'high', via: [imageSize] },
    'other-pkg': { severity: 'high', via: [{ ...imageSize, name: 'other-pkg' }] },
  }));
  assert.equal(advisories.size, 2);
  assert.deepEqual(
    [...advisories.values()].map((a) => a.package).sort(),
    ['image-size', 'other-pkg'],
  );
});

test('an exception reviewed for one package does not suppress the same advisory on another', () => {
  const advisories = collectAdvisories(report({
    'image-size': { severity: 'high', via: [imageSize] },
    'other-pkg': { severity: 'high', via: [{ ...imageSize, name: 'other-pkg' }] },
  }));
  const result = evaluate(advisories, [entry()], '2026-08-07');
  assert.equal(result.ok, false);
  assert.deepEqual(result.blocking.map((a) => a.package), ['other-pkg']);
});

test('an entry naming the wrong package blocks the advisory and reads as stale', () => {
  const advisories = collectAdvisories(report({ 'image-size': { severity: 'high', via: [imageSize] } }));
  const result = evaluate(advisories, [entry({ package: 'not-image-size' })], '2026-08-07');
  assert.equal(result.ok, false);
  assert.deepEqual(result.blocking.map((a) => a.package), ['image-size']);
  assert.deepEqual(result.stale.map((e) => e.package), ['not-image-size']);
});

test('advisoryKey separates identical ids across packages', () => {
  assert.notEqual(advisoryKey('GHSA-w3rx-r6r6-pgpr', 'a'), advisoryKey('GHSA-w3rx-r6r6-pgpr', 'b'));
});

test('collapses a propagated advisory to the single root it came from', () => {
  const advisories = collectAdvisories(report({
    'image-size': { severity: 'high', via: [imageSize] },
    metro: { severity: 'high', via: ['image-size', 'metro-config'] },
    expo: { severity: 'high', via: ['@expo/cli'] },
  }));
  assert.equal(advisories.size, 1);
  const [advisory] = [...advisories.values()];
  assert.equal(advisory.id, 'GHSA-w3rx-r6r6-pgpr');
  assert.equal(advisory.package, 'image-size');
});

test('ignores advisories below the blocking severity', () => {
  const advisories = collectAdvisories(report({
    tough: { severity: 'moderate', via: [{ ...imageSize, severity: 'moderate' }] },
  }));
  assert.equal(advisories.size, 0);
});

test('records every workspace an advisory was seen in', () => {
  const advisories = collectAdvisories(report({ 'image-size': { severity: 'high', via: [imageSize] } }), 'mobile');
  const [advisory] = [...advisories.values()];
  assert.deepEqual([...advisory.workspaces], ['mobile']);
});

test('an unlisted advisory blocks', () => {
  const advisories = collectAdvisories(report({ 'image-size': { severity: 'high', via: [imageSize] } }));
  const result = evaluate(advisories, []);
  assert.equal(result.ok, false);
  assert.deepEqual(result.blocking.map((a) => a.id), ['GHSA-w3rx-r6r6-pgpr']);
});

test('an accepted advisory within its review date passes', () => {
  const advisories = collectAdvisories(report({ 'image-size': { severity: 'high', via: [imageSize] } }));
  assert.equal(evaluate(advisories, [entry()], '2026-08-07').ok, true);
});

test('an accepted advisory past its review date blocks', () => {
  const advisories = collectAdvisories(report({ 'image-size': { severity: 'high', via: [imageSize] } }));
  const result = evaluate(advisories, [entry()], '2026-09-08');
  assert.equal(result.ok, false);
  assert.deepEqual(result.expired.map((a) => a.id), ['GHSA-w3rx-r6r6-pgpr']);
});

test('an allowlist entry that no longer matches a live advisory blocks as stale', () => {
  const result = evaluate(new Map(), [entry()], '2026-08-07');
  assert.equal(result.ok, false);
  assert.deepEqual(result.stale.map((e) => e.id), ['GHSA-w3rx-r6r6-pgpr']);
});

test('a clean tree with an empty allowlist passes', () => {
  assert.equal(evaluate(new Map(), [], '2026-08-07').ok, true);
});

test('a missing allowlist file is an empty allowlist, not an error', () => {
  assert.deepEqual(readAllowlist(fixture()), []);
});

test('rejects an entry without a GHSA identifier', () => {
  assert.throws(() => readAllowlist(fixture([entry({ id: 'CVE-2026-59870' })])), /GHSA identifier/);
});

test('rejects an entry without a review date', () => {
  assert.throws(() => readAllowlist(fixture([entry({ reviewBy: 'soon' })])), /YYYY-MM-DD/);
});

test('rejects an entry whose reason is too thin to be a decision', () => {
  assert.throws(() => readAllowlist(fixture([entry({ reason: 'build only' })])), /must explain/);
});

test('rejects a file without an accepted array', () => {
  const root = mkdtempSync(join(tmpdir(), 'kilo-audit-'));
  writeFileSync(join(root, 'audit-allowlist.json'), JSON.stringify({ entries: [] }));
  assert.throws(() => readAllowlist(root), /"accepted" array/);
});

test('the checked-in allowlist is valid and every entry is still under review', () => {
  const accepted = readAllowlist();
  for (const item of accepted) {
    assert.match(item.id, /^GHSA-/);
    assert.ok(item.reviewBy >= new Date().toISOString().slice(0, 10), `${item.id} is past its review date`);
  }
});
