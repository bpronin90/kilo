import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listFragmentFiles,
  nextVersion,
  parseFragment,
  prepareRelease,
  validateFragments,
} from './changelog-fragments.mjs';
import { syncVersions } from './sync-version.mjs';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kilo-release-'));
  mkdirSync(join(root, '.changes'));
  mkdirSync(join(root, 'mobile'));
  writeJson(join(root, 'package.json'), { name: 'kilo', version: '0.98.1' });
  writeJson(join(root, 'package-lock.json'), {
    name: 'kilo', version: '0.98.1', packages: { '': { name: 'kilo', version: '0.98.1' } },
  });
  writeJson(join(root, 'mobile', 'package.json'), { name: 'mobile', version: '0.98.1' });
  writeJson(join(root, 'mobile', 'app.json'), { expo: { version: '0.98.1' } });
  writeJson(join(root, 'mobile', 'package-lock.json'), {
    name: 'mobile', version: '0.98.1', packages: { '': { name: 'mobile', version: '0.98.1' } },
  });
  writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\n## 0.98.1 - 2026-07-16\n\n- Existing release.\n');
  return root;
}

function fragment(root, name, issue, bump, text = 'Changed the visible behavior.') {
  writeFileSync(join(root, '.changes', name), `issue: ${issue}\nbump: ${bump}\n\n${text}\n`);
}

test('parses the issue, sequence, bump, and normalized release text', () => {
  assert.deepEqual(parseFragment('600-2.md', 'issue: 600\nbump: patch\n\nFixed a\nvisible bug.\n'), {
    name: '600-2.md', issue: 600, sequence: 2, bump: 'patch', text: 'Fixed a visible bug.',
  });
});

test('rejects malformed names, issue mismatches, and unsupported bump levels', () => {
  assert.throws(() => parseFragment('600.md', 'issue: 600\nbump: patch\n\nText\n'), /expected/);
  assert.throws(() => parseFragment('600-1.md', 'issue: 601\nbump: patch\n\nText\n'), /does not match/);
  assert.throws(() => parseFragment('600-1.md', 'issue: 600\nbump: major\n\nText\n'), /expected/);
});

test('validation rejects stray files that do not follow the fragment contract', () => {
  const root = fixture();
  try {
    writeFileSync(join(root, '.changes', 'bad-name.md'), 'not a fragment\n');
    assert.throws(() => validateFragments(root), /expected <issue>-<sequence>/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('chooses the highest requested pre-1.0 bump', () => {
  assert.equal(nextVersion('0.98.1', [{ bump: 'patch' }]), '0.98.2');
  assert.equal(nextVersion('0.98.1', [{ bump: 'patch' }, { bump: 'minor' }]), '0.99.0');
  assert.equal(nextVersion('0.98.1', []), '0.98.1');
});

test('prepares one deterministic release and synchronizes every version field', () => {
  const root = fixture();
  try {
    fragment(root, '600-2.md', 600, 'minor', 'Added a capability.');
    fragment(root, '600-1.md', 600, 'patch', 'Fixed the first pass.');
    const result = prepareRelease({ root, date: '2026-07-17', logger: { log() {} } });
    assert.equal(result.version, '0.99.0');
    assert.deepEqual(result.fragments.map(({ name }) => name), ['600-1.md', '600-2.md']);
    assert.deepEqual(listFragmentFiles(root), []);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '0.99.0');
    assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'))).packages[''].version, '0.99.0');
    assert.equal(JSON.parse(readFileSync(join(root, 'mobile', 'package.json'))).version, '0.99.0');
    assert.equal(JSON.parse(readFileSync(join(root, 'mobile', 'app.json'))).expo.version, '0.99.0');
    assert.equal(JSON.parse(readFileSync(join(root, 'mobile', 'package-lock.json'))).version, '0.99.0');
    assert.match(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), /^# Changelog\n\n## 0\.99\.0 - 2026-07-17/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('synchronizes only the structural mobile version fields', () => {
  const root = fixture();
  try {
    writeJson(join(root, 'mobile', 'package.json'), {
      nested: { version: 'decoy-package' }, name: 'mobile', version: '0.97.0',
    });
    writeJson(join(root, 'mobile', 'app.json'), {
      metadata: { version: 'decoy-app' }, expo: { name: 'Kilo', version: '0.96.0' },
    });
    const result = syncVersions({ root, logger: { log() {} } });
    assert.deepEqual(result.drift, [
      { label: 'mobile/package.json', from: '0.97.0', to: '0.98.1' },
      { label: 'mobile/app.json', from: '0.96.0', to: '0.98.1' },
    ]);
    assert.equal(JSON.parse(readFileSync(join(root, 'mobile', 'package.json'))).nested.version, 'decoy-package');
    assert.equal(JSON.parse(readFileSync(join(root, 'mobile', 'package.json'))).version, '0.98.1');
    assert.equal(JSON.parse(readFileSync(join(root, 'mobile', 'app.json'))).metadata.version, 'decoy-app');
    assert.equal(JSON.parse(readFileSync(join(root, 'mobile', 'app.json'))).expo.version, '0.98.1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('leaves fragments created after the release snapshot for the next release', () => {
  const root = fixture();
  try {
    fragment(root, '600-1.md', 600, 'patch');
    const snapshot = listFragmentFiles(root);
    fragment(root, '601-1.md', 601, 'minor');
    prepareRelease({ root, date: '2026-07-17', fragmentNames: snapshot, logger: { log() {} } });
    assert.deepEqual(listFragmentFiles(root), ['601-1.md']);
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '0.98.2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a release with no fragments is a no-op', () => {
  const root = fixture();
  try {
    assert.deepEqual(prepareRelease({ root, logger: { log() {} } }), {
      changed: false, fragments: [], version: null,
    });
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'))).version, '0.98.1');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('validation accepts multiple sequences for one issue and version check catches lock drift', () => {
  const root = fixture();
  try {
    fragment(root, '600-1.md', 600, 'patch');
    fragment(root, '600-2.md', 600, 'patch');
    assert.equal(validateFragments(root).length, 2);
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json')));
    lock.version = '0.97.0';
    writeJson(join(root, 'package-lock.json'), lock);
    assert.throws(() => syncVersions({ root, check: true }), /package-lock\.json is 0\.97\.0/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
