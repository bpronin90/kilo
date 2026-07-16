import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateDisposition,
  implementationFingerprint,
  isMatchingExactApprovalStatus,
  parseDisposition,
  pathsOverlap,
  validateParentApproval,
  verifyRefreshObjects,
} from './review-disposition.mjs';

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

function pr({ head = HEAD, execution = 'impl-1', commit = head } = {}) {
  return {
    head: { sha: head },
    body: [
      'Implementation-Agent: agent:claude',
      `Implementation-Execution: ${execution}`,
      `Implementation-Commit: ${commit}`,
    ].join('\n'),
  };
}

function comment({
  id = 1,
  disposition = 'APPROVED',
  commit = HEAD,
  execution = 'review-1',
  association = 'OWNER',
  created = '2026-07-15T12:00:00Z',
  updated = created,
  record = 'REVIEW',
} = {}) {
  const details = record === 'OWNER_OVERRIDE'
    ? ['Reason: owner accepts the review findings']
    : [`Reviewer-Execution: ${execution}`, 'Findings: none'];
  return {
    id,
    author_association: association,
    created_at: created,
    updated_at: updated,
    body: [
      `RECORD=${record}`,
      `DISPOSITION=${disposition}`,
      `Commit: ${commit}`,
      ...details,
    ].join('\n'),
  };
}

test('fails actionably before review', () => {
  assert.equal(evaluateDisposition({ pr: pr(), comments: [] }).state, 'failure');
});

test('requires implementation metadata for the current head', () => {
  assert.equal(evaluateDisposition({ pr: pr({ commit: NEXT }), comments: [comment()] }).state, 'failure');
});

test('derives current-head implementation metadata for Dependabot PRs', () => {
  const dependabotPr = { head: { sha: HEAD }, body: '', user: { login: 'dependabot[bot]' } };
  assert.equal(evaluateDisposition({ pr: dependabotPr, comments: [comment()] }).state, 'success');
});

test('accepts an independent approval for the exact head', () => {
  const result = evaluateDisposition({ pr: pr(), comments: [comment()] });
  assert.equal(result.state, 'success');
  assert.equal(result.description, `approved for current PR head; impl=${implementationFingerprint('impl-1')}`);
});

test('rejects review from the implementation execution', () => {
  assert.equal(evaluateDisposition({ pr: pr(), comments: [comment({ execution: 'impl-1' })] }).state, 'failure');
});

test('feedback and blocked dispositions fail only the review gate', () => {
  assert.equal(evaluateDisposition({ pr: pr(), comments: [comment({ disposition: 'FEEDBACK' })] }).state, 'failure');
  assert.equal(evaluateDisposition({ pr: pr(), comments: [comment({ disposition: 'BLOCKED' })] }).state, 'failure');
});

test('owner override supersedes earlier feedback for the exact head', () => {
  const comments = [
    comment({ id: 1, disposition: 'FEEDBACK' }),
    comment({ id: 2, record: 'OWNER_OVERRIDE', disposition: 'OWNER_OVERRIDE', created: '2026-07-15T12:01:00Z' }),
  ];
  assert.equal(evaluateDisposition({ pr: pr(), comments }).state, 'success');
});

test('only an owner-associated comment can override review', () => {
  const comments = [
    comment({ disposition: 'FEEDBACK' }),
    comment({
      id: 2,
      record: 'OWNER_OVERRIDE',
      disposition: 'OWNER_OVERRIDE',
      association: 'COLLABORATOR',
      created: '2026-07-15T12:01:00Z',
    }),
  ];
  assert.equal(evaluateDisposition({ pr: pr(), comments }).state, 'failure');
});

test('a later review can supersede an owner override', () => {
  const comments = [
    comment({ id: 1, record: 'OWNER_OVERRIDE', disposition: 'OWNER_OVERRIDE' }),
    comment({ id: 2, disposition: 'BLOCKED', created: '2026-07-15T12:01:00Z' }),
  ];
  assert.equal(evaluateDisposition({ pr: pr(), comments }).state, 'failure');
});

test('a new head invalidates old dispositions', () => {
  assert.equal(evaluateDisposition({ pr: pr({ head: NEXT }), comments: [comment()] }).state, 'failure');
});

test('accepts a required-check-verified closeout refresh without a second review', () => {
  const carryForward = { state: 'success', description: 'carried approval from reviewed head' };
  assert.equal(evaluateDisposition({ pr: pr({ head: NEXT }), comments: [comment()], carryForward }).state, 'success');
});

test('exact-head feedback overrides a supplied carry-forward result', () => {
  const carryForward = { state: 'success', description: 'carried approval from reviewed head' };
  const feedback = comment({ disposition: 'FEEDBACK', commit: NEXT });
  assert.equal(evaluateDisposition({ pr: pr({ head: NEXT }), comments: [feedback], carryForward }).state, 'failure');
});

test('ignores unauthorized, edited, and malformed comments', () => {
  const invalid = [
    comment({ id: 1, association: 'NONE' }),
    comment({ id: 2, updated: '2026-07-15T12:02:00Z' }),
    { ...comment({ id: 3 }), body: 'RECORD=REVIEW\nDISPOSITION=APPROVED' },
  ];
  assert.equal(evaluateDisposition({ pr: pr(), comments: invalid }).state, 'failure');
});

test('requires exactly one value for each control field', () => {
  const duplicate = comment();
  duplicate.body += '\nDISPOSITION=BLOCKED';
  assert.equal(parseDisposition(duplicate), null);
});

test('detects exact and namespace path overlap without blocking ordinary siblings', () => {
  assert.equal(pathsOverlap(['config'], ['config']), 'config ↔ config');
  assert.equal(pathsOverlap(['config'], ['config/app.json']), 'config ↔ config/app.json');
  assert.equal(pathsOverlap(['config/app.json'], ['config']), 'config/app.json ↔ config');
  assert.equal(pathsOverlap(['config/a.json'], ['config/b.json']), null);
});

test('carry-forward requires the controlling parent approval and its implementation-bound exact status', () => {
  const approved = comment();
  assert.equal(validateParentApproval({
    comments: [approved],
    reviewedHead: HEAD,
    implementationExecution: 'impl-1',
    exactStatus: { state: 'success' },
  }).state, 'success');
  assert.equal(validateParentApproval({
    comments: [],
    reviewedHead: HEAD,
    implementationExecution: 'impl-1',
    exactStatus: { state: 'success' },
  }).state, 'failure');
  assert.equal(validateParentApproval({
    comments: [approved],
    reviewedHead: HEAD,
    implementationExecution: 'impl-1',
    exactStatus: null,
  }).state, 'failure');
  assert.equal(validateParentApproval({
    comments: [comment({ execution: 'impl-1' })],
    reviewedHead: HEAD,
    implementationExecution: 'impl-1',
    exactStatus: { state: 'success' },
  }).state, 'failure');
  assert.equal(validateParentApproval({
    comments: [approved, comment({ id: 2, disposition: 'FEEDBACK', created: '2026-07-15T12:01:00Z' })],
    reviewedHead: HEAD,
    implementationExecution: 'impl-1',
    exactStatus: { state: 'success' },
  }).state, 'failure');
  const exactDescription = `approved for current PR head; impl=${implementationFingerprint('impl-1')}`;
  assert.equal(isMatchingExactApprovalStatus({
    context: 'review disposition accepted',
    state: 'success',
    description: exactDescription,
  }, 'impl-1'), true);
  assert.equal(isMatchingExactApprovalStatus({
    context: 'review disposition accepted',
    state: 'success',
    description: 'carried approval from abcdef123456; object delta unchanged',
  }, 'impl-1'), false);
  assert.equal(isMatchingExactApprovalStatus({
    context: 'review disposition accepted',
    state: 'success',
    description: exactDescription,
  }, 'different-implementation'), false);
});

test('proves only the reproducible object-identical merge refresh', () => {
  const originalCwd = process.cwd();
  const repo = mkdtempSync(join(tmpdir(), 'review-refresh-'));
  const run = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  try {
    run('init', '--quiet');
    run('config', 'user.name', 'Gate Test');
    run('config', 'user.email', 'gate@example.test');
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    run('add', 'base.txt');
    run('commit', '--quiet', '-m', 'base');
    const base = run('rev-parse', 'HEAD');

    run('switch', '--quiet', '-c', 'reviewed');
    writeFileSync(join(repo, 'feature.txt'), 'reviewed change\n');
    run('add', 'feature.txt');
    run('commit', '--quiet', '-m', 'reviewed');
    const reviewed = run('rev-parse', 'HEAD');

    run('switch', '--quiet', '--detach', base);
    writeFileSync(join(repo, 'main.txt'), 'new base change\n');
    run('add', 'main.txt');
    run('commit', '--quiet', '-m', 'advance base');
    const currentBase = run('rev-parse', 'HEAD');
    const tree = run('merge-tree', '--write-tree', reviewed, currentBase).split(/\s+/)[0];
    const refresh = run('commit-tree', tree, '-p', reviewed, '-p', currentBase, '-m', 'refresh');

    process.chdir(repo);
    assert.deepEqual(verifyRefreshObjects({ head: refresh, base: currentBase }), {
      state: 'success',
      reviewedHead: reviewed,
    });

    const wrongTree = run('rev-parse', `${reviewed}^{tree}`);
    const manufactured = run('commit-tree', wrongTree, '-p', reviewed, '-p', currentBase, '-m', 'wrong');
    assert.equal(verifyRefreshObjects({ head: manufactured, base: currentBase }).state, 'failure');
    assert.equal(verifyRefreshObjects({ head: reviewed, base: currentBase }).description, 'refresh head must have exactly two parents');
    assert.equal(verifyRefreshObjects({ head: refresh, base }).description, 'refresh does not merge the current PR base');

    run('switch', '--quiet', '--detach', base);
    writeFileSync(join(repo, 'base.txt'), 'reviewed overlap\n');
    run('commit', '--quiet', '-am', 'reviewed overlap');
    const reviewedOverlap = run('rev-parse', 'HEAD');
    run('switch', '--quiet', '--detach', base);
    writeFileSync(join(repo, 'base.txt'), 'base overlap\n');
    run('commit', '--quiet', '-am', 'base overlap');
    const baseOverlap = run('rev-parse', 'HEAD');
    const overlapTree = run('rev-parse', `${reviewedOverlap}^{tree}`);
    const overlapHead = run('commit-tree', overlapTree, '-p', reviewedOverlap, '-p', baseOverlap, '-m', 'overlap');
    assert.match(verifyRefreshObjects({ head: overlapHead, base: baseOverlap }).description, /^refresh path overlap:/);
  } finally {
    process.chdir(originalCwd);
    rmSync(repo, { recursive: true, force: true });
  }
});
