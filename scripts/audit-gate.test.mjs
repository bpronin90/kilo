import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectAdvisories, evaluate, readAllowlist } from './audit-gate.mjs';

const imageSize = {
  source: 1109834,
  name: 'image-size',
  severity: 'high',
  title: 'image-size: ICNS parser allows denial of service through an infinite loop',
  url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
  range: '<=2.0.2',
};

function report(vulnerabilities) {
  return JSON.stringify({ vulnerabilities });
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

test('collapses a propagated advisory to the single root it came from', () => {
  const advisories = collectAdvisories(report({
    'image-size': { severity: 'high', via: [imageSize] },
    metro: { severity: 'high', via: ['image-size', 'metro-config'] },
    expo: { severity: 'high', via: ['@expo/cli'] },
  }));
  assert.deepEqual([...advisories.keys()], ['GHSA-w3rx-r6r6-pgpr']);
  assert.equal(advisories.get('GHSA-w3rx-r6r6-pgpr').package, 'image-size');
});

test('ignores advisories below the blocking severity', () => {
  const advisories = collectAdvisories(report({
    tough: { severity: 'moderate', via: [{ ...imageSize, severity: 'moderate' }] },
  }));
  assert.equal(advisories.size, 0);
});

test('records every workspace an advisory was seen in', () => {
  const advisories = collectAdvisories(report({ 'image-size': { severity: 'high', via: [imageSize] } }), 'mobile');
  assert.deepEqual([...advisories.get('GHSA-w3rx-r6r6-pgpr').workspaces], ['mobile']);
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
