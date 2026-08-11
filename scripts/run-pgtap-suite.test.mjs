import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  discoverPgTapFiles,
  runPgTapSuite,
  tapOutputHasDisallowedDirective,
} from './run-pgtap-suite.mjs';

function sink() {
  return { write() {} };
}

test('discovers every planned pgTAP SQL file regardless of naming and excludes manual SQL', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kilo-pgtap-'));
  writeFileSync(path.join(dir, 'alpha.test.sql'), 'select plan(1);');
  writeFileSync(path.join(dir, 'beta_test.sql'), 'SELECT PLAN (2);');
  writeFileSync(path.join(dir, 'unexpected-name.sql'), 'select plan(3);');
  writeFileSync(path.join(dir, 'manual_check.sql'), 'select 1;');

  assert.deepEqual(
    discoverPgTapFiles(dir).map((file) => path.basename(file)),
    ['alpha.test.sql', 'beta_test.sql', 'unexpected-name.sql'],
  );
});

test('recognizes skip, TODO, zero-plan, and aborted TAP output', () => {
  assert.equal(tapOutputHasDisallowedDirective('ok 1 - done\n1..1\n'), false);
  assert.equal(tapOutputHasDisallowedDirective('ok 1 - later # SKIP unavailable\n'), true);
  assert.equal(tapOutputHasDisallowedDirective('not ok 1 - later # TODO fix\n'), true);
  assert.equal(tapOutputHasDisallowedDirective('1..0 # SKIP no tests\n'), true);
  assert.equal(tapOutputHasDisallowedDirective('Bail out! broken fixture\n'), true);
  assert.equal(tapOutputHasDisallowedDirective('Dubious, test returned 255\n'), true);
});

test('runs every discovered file and accepts only clean successful output', () => {
  const seen = [];
  assert.doesNotThrow(() => runPgTapSuite({
    files: ['/repo/a.test.sql', '/repo/b_test.sql'],
    run(file) {
      seen.push(file);
      return { status: 0, stdout: 'ok 1 - secure\n1..1\n', stderr: '' };
    },
    stdout: sink(),
    stderr: sink(),
  }));
  assert.deepEqual(seen, ['/repo/a.test.sql', '/repo/b_test.sql']);
});

test('continues through the suite and fails on exit errors or forbidden directives', () => {
  const seen = [];
  assert.throws(() => runPgTapSuite({
    files: ['/repo/a.test.sql', '/repo/b.test.sql', '/repo/c.test.sql'],
    run(file) {
      seen.push(file);
      if (file.endsWith('a.test.sql')) return { status: 1, stdout: '', stderr: 'aborted' };
      if (file.endsWith('b.test.sql')) return { status: 0, stdout: 'ok 1 # SKIP later\n1..1\n', stderr: '' };
      return { status: 0, stdout: 'ok 1 - done\n1..1\n', stderr: '' };
    },
    stdout: sink(),
    stderr: sink(),
  }), /did not complete cleanly/);
  assert.equal(seen.length, 3);
});
