import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  carryForwardRecordBody,
  controllingDisposition,
  evaluateDisposition,
  exactApprovalDescription,
  exactOverrideDescription,
  hasImmutableCarryForwardRecord,
  implicitDependabotHandoff,
  issueNumbersForPullEvent,
  isMatchingExactApprovalStatus,
  latestHandoff,
  parseDisposition,
  parseHandoff,
  parseIssueReference,
  pullsForIssue,
  selectAuthoritativeEvidence,
  validateParentDisposition,
  verifyRefreshObjects,
} from './review-disposition.mjs';

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);

function pr({ number = 42, head = HEAD, issue = 600, login = 'owner' } = {}) {
  return {
    number,
    head: { sha: head },
    body: issue === null ? 'Issue: none' : `Issue: #${issue}`,
    user: { login },
  };
}

function handoff({
  id = 1,
  prNumber = 42,
  commit = HEAD,
  update = 'IMPLEMENTED',
  association = 'OWNER',
  created = '2026-07-16T12:00:00Z',
  updated = created,
} = {}) {
  return {
    id,
    author_association: association,
    created_at: created,
    updated_at: updated,
    body: [
      `UPDATE=${update}`,
      `PR: #${prNumber}`,
      `Commit: ${commit}`,
      'Summary: Fixed the scoped behavior.',
      'Verification: Targeted tests passed.',
      'Remaining: none',
    ].join('\n'),
  };
}

function verdict({
  id = 2,
  prNumber = 42,
  commit = HEAD,
  disposition = 'APPROVED',
  association = 'OWNER',
  created = '2026-07-16T12:01:00Z',
  updated = created,
  ownerOverride = false,
} = {}) {
  return {
    id,
    author_association: association,
    created_at: created,
    updated_at: updated,
    body: ownerOverride
      ? [`STATUS=OWNER_OVERRIDE`, `PR: #${prNumber}`, `Commit: ${commit}`, 'Reason: owner accepts the risk'].join('\n')
      : [`VERDICT=${disposition}`, `PR: #${prNumber}`, `Commit: ${commit}`, 'Findings: none'].join('\n'),
  };
}

test('parses exactly one issue reference', () => {
  assert.deepEqual(parseIssueReference('Issue: #600'), { kind: 'issue', number: 600 });
  assert.deepEqual(parseIssueReference('Issue: none'), { kind: 'none', number: null });
  assert.equal(parseIssueReference('Issue: #600\nIssue: #601'), null);
  assert.equal(parseIssueReference('no issue field'), null);
});

test('accepts only immutable owner-authored handoffs', () => {
  assert.equal(parseHandoff(handoff()).commit, HEAD);
  assert.equal(parseHandoff(handoff({ updated: '2026-07-16T12:02:00Z' })), null);
  assert.equal(parseHandoff(handoff({ association: 'MEMBER' })), null);
  assert.equal(parseHandoff(handoff({ association: 'COLLABORATOR' })), null);
  assert.equal(parseHandoff(handoff({ association: 'NONE' })), null);
  const incomplete = handoff();
  incomplete.body = `UPDATE=IMPLEMENTED\nPR: #42\nCommit: ${HEAD}`;
  assert.equal(parseHandoff(incomplete), null);
});

test('accepts only immutable owner-authored verdicts and overrides', () => {
  assert.equal(parseDisposition(verdict()).disposition, 'APPROVED');
  assert.equal(parseDisposition(verdict({ ownerOverride: true })).disposition, 'OWNER_OVERRIDE');
  assert.equal(parseDisposition(verdict({ association: 'MEMBER' })), null);
  assert.equal(parseDisposition(verdict({ association: 'COLLABORATOR' })), null);
  assert.equal(parseDisposition(verdict({ ownerOverride: true, association: 'COLLABORATOR' })), null);
  assert.equal(parseDisposition(verdict({ updated: '2026-07-16T12:02:00Z' })), null);
  const malformedOverride = verdict({ ownerOverride: true });
  malformedOverride.body = `STATUS=OWNER_OVERRIDE\nPR: #42\nCommit: ${HEAD}`;
  assert.equal(parseDisposition(malformedOverride), null);
});

test('requires a current-head implementation handoff before review', () => {
  const result = evaluateDisposition({ pr: pr(), comments: [verdict()] });
  assert.equal(result.state, 'failure');
  assert.match(result.description, /handoff/);
});

test('accepts an exact-head approval without pretending to verify execution identity', () => {
  const comments = [handoff(), verdict()];
  const result = evaluateDisposition({ pr: pr(), comments, handoff: latestHandoff(comments, 42, HEAD) });
  assert.deepEqual(result, {
    state: 'success',
    description: 'approved for current PR head; review=2',
    controllingCommentId: 2,
  });
});

test('feedback and blocked verdicts fail the gate', () => {
  for (const disposition of ['FEEDBACK', 'BLOCKED']) {
    const comments = [handoff(), verdict({ disposition })];
    assert.equal(evaluateDisposition({
      pr: pr(), comments, handoff: latestHandoff(comments, 42, HEAD),
    }).state, 'failure');
  }
});

test('latest exact-head disposition controls deterministically', () => {
  const comments = [
    verdict(),
    verdict({ id: 3, disposition: 'FEEDBACK', created: '2026-07-16T12:02:00Z' }),
  ];
  assert.equal(controllingDisposition(comments, 42, HEAD).disposition, 'FEEDBACK');
});

test('requires the exact-head verdict to follow the current handoff', () => {
  const earlyVerdict = verdict({ created: '2026-07-16T11:59:00Z' });
  const currentHandoff = handoff();
  assert.match(evaluateDisposition({
    pr: pr(), comments: [earlyVerdict, currentHandoff], handoff: parseHandoff(currentHandoff),
  }).description, /predates/);
});

test('the latest owner override remains controlling over later ordinary verdicts', () => {
  const comments = [
    handoff(),
    verdict({ disposition: 'FEEDBACK' }),
    verdict({ id: 3, ownerOverride: true, created: '2026-07-16T12:02:00Z' }),
  ];
  assert.equal(evaluateDisposition({ pr: pr(), comments, handoff: parseHandoff(comments[0]) }).state, 'success');
  comments.push(verdict({ id: 4, disposition: 'BLOCKED', created: '2026-07-16T12:03:00Z' }));
  assert.equal(evaluateDisposition({ pr: pr(), comments, handoff: parseHandoff(comments[0]) }).state, 'success');
  comments.push(verdict({ id: 5, ownerOverride: true, created: '2026-07-16T12:04:00Z' }));
  assert.equal(controllingDisposition(comments, 42, HEAD).id, 5);
});

test('a replacement handoff retires older overrides for later approvals', () => {
  const replacementHandoff = handoff({ id: 4, created: '2026-07-16T12:03:00Z' });
  const comments = [
    handoff(),
    verdict({ id: 2, disposition: 'FEEDBACK' }),
    verdict({ id: 3, ownerOverride: true, created: '2026-07-16T12:02:00Z' }),
    replacementHandoff,
    verdict({ id: 5, created: '2026-07-16T12:04:00Z' }),
  ];
  assert.equal(controllingDisposition(comments, 42, HEAD, parseHandoff(replacementHandoff)).id, 5);
  assert.equal(evaluateDisposition({
    pr: pr(), comments, handoff: parseHandoff(replacementHandoff),
  }).state, 'success');
});

test('a new head invalidates old handoffs and verdicts', () => {
  const comments = [handoff(), verdict()];
  assert.equal(evaluateDisposition({ pr: pr({ head: NEXT }), comments }).state, 'failure');
});

test('Dependabot has an implicit implementation handoff but still needs review', () => {
  const dependabot = pr({ issue: null, login: 'dependabot[bot]' });
  assert.equal(evaluateDisposition({ pr: dependabot, comments: [] }).state, 'failure');
  const syntheticHandoff = implicitDependabotHandoff(dependabot.number, HEAD);
  assert.equal(evaluateDisposition({ pr: dependabot, comments: [verdict()], handoff: syntheticHandoff }).state, 'success');
});

test('non-authoritative competing PRs fail even with exact-head approval', () => {
  const comments = [handoff(), verdict()];
  assert.equal(evaluateDisposition({
    pr: pr(), comments, handoff: parseHandoff(comments[0]), authoritative: false,
  }).state, 'failure');
});

test('selects authoritative evidence by created time then numeric comment id', () => {
  const first = parseHandoff(handoff({ id: 8 }));
  const second = parseHandoff(handoff({ id: 9 }));
  assert.equal(selectAuthoritativeEvidence([
    { pr: pr({ number: 41 }), handoff: first },
    { pr: pr({ number: 42 }), handoff: second },
  ]).pr.number, 42);
});

test('links only open PR bodies that name the issue', () => {
  const pulls = [pr({ number: 1, issue: 600 }), pr({ number: 2, issue: 601 }), pr({ number: 3, issue: null })];
  assert.deepEqual(pullsForIssue(pulls, 600).map((pull) => pull.number), [1]);
});

test('reevaluates both sides when a PR changes its linked issue', () => {
  assert.deepEqual(issueNumbersForPullEvent({
    changes: { body: { from: 'Issue: #600' } },
  }, 'Issue: #601'), [601, 600]);
});

test('keeps PR-head tests unprivileged and the production evaluator on trusted base code', () => {
  const testWorkflow = readFileSync('.github/workflows/test.yml', 'utf8');
  assert.match(testWorkflow, /on:\n  pull_request:/);
  assert.doesNotMatch(testWorkflow, /pull_request_target/);
  assert.match(testWorkflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(testWorkflow, /secrets\./);

  const gateWorkflow = readFileSync('.github/workflows/review-disposition.yml', 'utf8');
  assert.match(gateWorkflow, /pull_request_target:/);
  assert.match(gateWorkflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
});

test('edited approval withdrawal produces a failing current-head evaluation', () => {
  const comments = [handoff(), verdict({ updated: '2026-07-16T12:02:00Z' })];
  assert.equal(evaluateDisposition({ pr: pr(), comments, handoff: parseHandoff(comments[0]) }).state, 'failure');
});

test('accepts a verified carry-forward only when no exact-head disposition supersedes it', () => {
  const carryForward = { state: 'success', description: 'carried approval from reviewed head' };
  assert.equal(evaluateDisposition({ pr: pr({ head: NEXT }), comments: [], carryForward }).state, 'success');
  const feedback = verdict({ commit: NEXT, disposition: 'FEEDBACK' });
  assert.equal(evaluateDisposition({ pr: pr({ head: NEXT }), comments: [feedback], carryForward }).state, 'failure');
});

test('matches an accepted parent disposition to its immutable comment id and exact status', () => {
  const approved = verdict({ id: 77 });
  const approvalStatus = {
    context: 'review disposition accepted',
    state: 'success',
    description: exactApprovalDescription(77),
  };
  assert.equal(isMatchingExactApprovalStatus(approvalStatus, 77), true);
  assert.equal(isMatchingExactApprovalStatus(approvalStatus, 78), false);
  assert.deepEqual(validateParentDisposition({
    comments: [approved], prNumber: 42, reviewedHead: HEAD, handoff: parseHandoff(handoff()), exactStatus: approvalStatus,
  }), {
    state: 'success',
    dispositionCommentId: 77,
    disposition: 'APPROVED',
    reason: null,
  });

  const override = verdict({ id: 78, ownerOverride: true });
  const overrideStatus = {
    context: 'review disposition accepted',
    state: 'success',
    description: exactOverrideDescription(78),
  };
  assert.deepEqual(validateParentDisposition({
    comments: [override],
    prNumber: 42,
    reviewedHead: HEAD,
    handoff: parseHandoff(handoff()),
    exactStatus: overrideStatus,
  }), {
    state: 'success',
    dispositionCommentId: 78,
    disposition: 'OWNER_OVERRIDE',
    reason: 'owner accepts the risk',
  });
  assert.equal(validateParentDisposition({
    comments: [override],
    prNumber: 42,
    reviewedHead: HEAD,
    handoff: parseHandoff(handoff()),
    exactStatus: {
      context: 'review disposition accepted',
      state: 'success',
      description: 'carried OWNER_OVERRIDE; comment=78; patch unchanged',
    },
  }).state, 'success');
  assert.equal(validateParentDisposition({
    comments: [verdict({ id: 77, updated: '2026-07-16T12:02:00Z' })],
    prNumber: 42,
    reviewedHead: HEAD,
    handoff: parseHandoff(handoff()),
    exactStatus: approvalStatus,
  }).state, 'failure');
  assert.equal(validateParentDisposition({
    comments: [verdict({ id: 79, disposition: 'FEEDBACK' })],
    prNumber: 42,
    reviewedHead: HEAD,
    handoff: parseHandoff(handoff()),
    exactStatus: approvalStatus,
  }).state, 'failure');
});

test('proves different-file and same-file disjoint-hunk refreshes by exact patch application', () => {
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
      state: 'success', reviewedHead: reviewed,
    });
    const wrongTree = run('rev-parse', `${reviewed}^{tree}`);
    const manufactured = run('commit-tree', wrongTree, '-p', reviewed, '-p', currentBase, '-m', 'wrong');
    assert.equal(verifyRefreshObjects({ head: manufactured, base: currentBase }).state, 'failure');
    assert.equal(verifyRefreshObjects({ head: reviewed, base: currentBase }).description, 'refresh head must have exactly two parents');
    assert.equal(verifyRefreshObjects({ head: refresh, base }).description, 'refresh does not merge the current PR base');

    run('switch', '--quiet', '--detach', base);
    writeFileSync(join(repo, 'shared.test.js'), Array.from({ length: 30 }, (_, index) => `test ${index + 1}\n`).join(''));
    run('add', 'shared.test.js');
    run('commit', '--quiet', '-m', 'shared fixture');
    const sharedBase = run('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'shared.test.js'), `${readFileSync(join(repo, 'shared.test.js'), 'utf8')}reviewed test\n`);
    run('commit', '--quiet', '-am', 'append reviewed test');
    const reviewedShared = run('rev-parse', 'HEAD');

    run('switch', '--quiet', '--detach', sharedBase);
    const lines = readFileSync(join(repo, 'shared.test.js'), 'utf8').split('\n');
    lines[0] = 'base-only test';
    writeFileSync(join(repo, 'shared.test.js'), lines.join('\n'));
    run('commit', '--quiet', '-am', 'edit disjoint base hunk');
    const baseShared = run('rev-parse', 'HEAD');
    const sharedTree = run('merge-tree', '--write-tree', reviewedShared, baseShared).split(/\s+/)[0];
    const sharedRefresh = run('commit-tree', sharedTree, '-p', reviewedShared, '-p', baseShared, '-m', 'same-file refresh');
    assert.deepEqual(verifyRefreshObjects({ head: sharedRefresh, base: baseShared }), {
      state: 'success', reviewedHead: reviewedShared,
    });

    const unreproducedTree = run('rev-parse', `${reviewedShared}^{tree}`);
    const unreproduced = run('commit-tree', unreproducedTree, '-p', reviewedShared, '-p', baseShared, '-m', 'wrong tree');
    assert.equal(verifyRefreshObjects({ head: unreproduced, base: baseShared }).state, 'failure');

    run('switch', '--quiet', '--detach', sharedBase);
    const reviewedConflictLines = readFileSync(join(repo, 'shared.test.js'), 'utf8').split('\n');
    reviewedConflictLines[10] = 'reviewed conflicting test';
    writeFileSync(join(repo, 'shared.test.js'), reviewedConflictLines.join('\n'));
    run('commit', '--quiet', '-am', 'reviewed conflict');
    const reviewedConflict = run('rev-parse', 'HEAD');

    run('switch', '--quiet', '--detach', sharedBase);
    const baseConflictLines = readFileSync(join(repo, 'shared.test.js'), 'utf8').split('\n');
    baseConflictLines[10] = 'base conflicting test';
    writeFileSync(join(repo, 'shared.test.js'), baseConflictLines.join('\n'));
    run('commit', '--quiet', '-am', 'base conflict');
    const baseConflict = run('rev-parse', 'HEAD');
    const resolvedTree = run('rev-parse', `${reviewedConflict}^{tree}`);
    const resolvedHead = run('commit-tree', resolvedTree, '-p', reviewedConflict, '-p', baseConflict, '-m', 'edited resolution');
    assert.equal(verifyRefreshObjects({ head: resolvedHead, base: baseConflict }).state, 'failure');
  } finally {
    process.chdir(originalCwd);
    rmSync(repo, { recursive: true, force: true });
  }
});

test('carry record preserves disposition identity and deduplicates only immutable owner records', () => {
  const body = carryForwardRecordBody(
    { number: 42, head: { sha: NEXT } },
    {
      reviewedHead: HEAD,
      disposition: 'OWNER_OVERRIDE',
      dispositionCommentId: 78,
      reason: 'owner accepts the risk',
    },
  );
  assert.match(body, /Disposition: OWNER_OVERRIDE/);
  assert.match(body, /Disposition-Comment: 78/);
  assert.match(body, /Reason: owner accepts the risk/);
  const immutable = {
    body,
    author_association: 'OWNER',
    created_at: '2026-07-16T12:00:00Z',
    updated_at: '2026-07-16T12:00:00Z',
  };
  assert.equal(hasImmutableCarryForwardRecord([immutable], body), true);
  assert.equal(hasImmutableCarryForwardRecord([{
    ...immutable,
    author_association: 'NONE',
    user: { login: 'github-actions[bot]', type: 'Bot' },
  }], body), true);
  assert.equal(hasImmutableCarryForwardRecord([{ ...immutable, updated_at: '2026-07-16T12:01:00Z' }], body), false);
  assert.equal(hasImmutableCarryForwardRecord([{ ...immutable, author_association: 'MEMBER' }], body), false);
  assert.equal(hasImmutableCarryForwardRecord([{
    ...immutable,
    author_association: 'NONE',
    user: { login: 'untrusted-bot[bot]', type: 'Bot' },
  }], body), false);
  assert.equal(hasImmutableCarryForwardRecord([{
    ...immutable,
    author_association: 'NONE',
    user: { login: 'github-actions[bot]', type: 'User' },
  }], body), false);
});
