import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  affectedPullNumbers,
  carryForwardRecordBody,
  controllingDisposition,
  evaluateDisposition,
  exactApprovalDescription,
  exactOverrideDescription,
  hasImmutableCarryForwardRecord,
  implicitDependabotHandoff,
  isMatchingExactApprovalStatus,
  latestHandoff,
  parseDisposition,
  parseHandoff,
  parseIssueReference,
  pullsForIssue,
  reconcile,
  createGithub,
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

test('treats both sides of an issue relink as affected', () => {
  const pulls = [pr({ number: 1, issue: 601 }), pr({ number: 2, issue: 600 }), pr({ number: 3, issue: 602 })];
  const event = { pull_request: { number: 1, body: 'Issue: #601' }, changes: { body: { from: 'Issue: #600' } } };
  assert.deepEqual([...affectedPullNumbers(event, pulls)].sort(), [1, 2]);
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

// ---- API-mocked reconciliation: failure injection and deterministic schedules ----

const OTHER = 'c'.repeat(40);
const BASE = 'd'.repeat(40);
const CONTEXT = 'review disposition accepted';

function openPr(options = {}) {
  return { ...pr(options), state: 'open', base: { sha: options.base ?? BASE } };
}

// In-memory GitHub. `hooks.before(method, path)` may throw (failure injection)
// or return a promise (barrier) to pause a request at a deterministic point.
function fakeGithub({ pulls = [], comments = {}, statuses = {} } = {}) {
  const state = { pulls, comments, statuses, posted: [], writes: [] };
  const hooks = { before: null };
  const gh = {
    async request(path, options = {}) {
      const method = options.method ?? 'GET';
      const route = path.replace(/[?&]per_page=100&page=\d+$/, '').replace(/\?per_page=100&page=\d+$/, '');
      if (hooks.before) await hooks.before(method, route);
      const page = Number(path.match(/page=(\d+)$/)?.[1] ?? 1);
      const paged = (values) => (page === 1 ? structuredClone(values) : []);
      let match;
      if (method === 'GET' && route === '/repos/o/r/pulls?state=open') return paged(state.pulls);
      if (method === 'GET' && (match = route.match(/^\/repos\/o\/r\/issues\/(\d+)\/comments$/))) {
        return paged(state.comments[match[1]] ?? []);
      }
      if (method === 'GET' && (match = route.match(/^\/repos\/o\/r\/commits\/(\w+)\/statuses$/))) {
        return paged(state.statuses[match[1]] ?? []);
      }
      if (method === 'POST' && (match = route.match(/^\/repos\/o\/r\/statuses\/(\w+)$/))) {
        const body = JSON.parse(options.body);
        state.statuses[match[1]] = [body, ...(state.statuses[match[1]] ?? [])];
        state.writes.push({ sha: match[1], ...body });
        return body;
      }
      if (method === 'POST' && (match = route.match(/^\/repos\/o\/r\/issues\/(\d+)\/comments$/))) {
        state.posted.push({ issue: Number(match[1]), body: JSON.parse(options.body).body });
        return {};
      }
      throw new Error(`unexpected ${method} ${route}`);
    },
  };
  const latest = (sha) => state.statuses[sha]?.find((status) => status.context === CONTEXT) ?? null;
  return { gh, state, hooks, latest };
}

function success(sha, id = 2) {
  return { [sha]: [{ context: CONTEXT, state: 'success', description: exactApprovalDescription(id) }] };
}

function barrier() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  return { gate, release };
}

const noProof = () => ({ state: 'failure', description: 'refresh head must have exactly two parents' });
const run = (fake, extra = {}) => reconcile({
  gh: fake.gh, repository: 'o/r', runUrl: 'run', proveObjects: noProof, log: () => {}, ...extra,
});

test('scenario 1: a comments read failure after approval withdrawal invalidates the prior success', async () => {
  const fake = fakeGithub({
    pulls: [openPr()],
    comments: { 600: [handoff(), verdict({ updated: '2026-07-16T12:05:00Z' })] },
    statuses: success(HEAD),
  });
  fake.hooks.before = (method, path) => {
    if (path.endsWith('/issues/600/comments')) throw Object.assign(new Error('502 pagination'), { status: 502 });
  };
  await assert.rejects(run(fake, { event: { issue: { number: 600 } } }));
  assert.equal(fake.latest(HEAD).state, 'error');
  assert.equal(fake.state.writes[0].state, 'pending');
});

test('scenario 1: a Git proof exception never becomes success', async () => {
  const fake = fakeGithub({
    pulls: [openPr({ head: NEXT })],
    comments: { 600: [handoff(), verdict()] },
    statuses: success(NEXT),
  });
  await assert.rejects(run(fake, { proveObjects: () => { throw new Error('git fetch failed'); } }));
  assert.equal(fake.latest(NEXT).state, 'error');
});

test('scenario 2: unserialized overlap can publish a stale success; the serialized order cannot', async () => {
  const approved = () => ({
    pulls: [openPr()],
    comments: { 600: [handoff(), verdict()] },
    statuses: {},
  });
  // Hazard: A reads the approval, B evaluates the withdrawal, A publishes last.
  const overlap = fakeGithub(approved());
  const paused = barrier();
  let posts = 0;
  overlap.hooks.before = async (method) => {
    if (method === 'POST' && ++posts === 2) await paused.gate; // A holds its final write
  };
  const runA = run(overlap);
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posts, 2);
  overlap.state.comments[600][1].updated_at = '2026-07-16T12:09:00Z';
  await run(overlap);
  paused.release();
  await runA;
  assert.equal(overlap.latest(HEAD).state, 'success', 'the race the workflow concurrency group exists to prevent');

  // Serialized (one repository-wide group, no in-progress cancellation): B starts after A.
  for (const withdraw of [
    (comments) => { comments[1].updated_at = '2026-07-16T12:09:00Z'; },
    (comments) => { comments.push(handoff({ id: 9, created: '2026-07-16T12:09:00Z' })); },
    (comments) => { comments.splice(1, 1, verdict({ id: 3, ownerOverride: true, updated: '2026-07-16T12:09:00Z' })); },
  ]) {
    const fake = fakeGithub(approved());
    const snapshot = barrier();
    let writes = 0;
    fake.hooks.before = async (method) => {
      if (method === 'POST' && ++writes === 2) await snapshot.gate;
    };
    const runA2 = run(fake);
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    withdraw(fake.state.comments[600]);
    snapshot.release();
    await runA2;
    await run(fake);
    assert.notEqual(fake.latest(HEAD).state, 'success');
  }
});

test('workflow serializes every trigger in one non-canceling repository-wide group', () => {
  const workflow = readFileSync('.github/workflows/review-disposition.yml', 'utf8');
  assert.match(workflow, /concurrency:\n  group: review-disposition\n  cancel-in-progress: false\n/);
  assert.match(workflow, /types: \[opened, reopened, synchronize, edited, closed\]/);
  assert.match(workflow, /push:\n    branches: \[main\]/);
  assert.match(workflow, /statuses: write/);
});

test('scenario 3: any trigger reconciles both competing PRs and transfers authority', async () => {
  for (const event of [{ issue: { number: 600 } }, { issue: { number: 41, pull_request: {} } }, { pull_request: { number: 42 } }, {}]) {
    const fake = fakeGithub({
      pulls: [openPr({ number: 41 }), openPr({ number: 42, head: OTHER })],
      comments: { 600: [
        handoff({ prNumber: 41 }),
        verdict({ prNumber: 41 }),
        handoff({ id: 5, prNumber: 42, commit: OTHER, created: '2026-07-16T12:03:00Z' }),
      ] },
      statuses: { ...success(HEAD), ...success(OTHER, 99) },
    });
    await run(fake, { event });
    assert.match(fake.latest(HEAD).description, /not the authoritative/);
    assert.equal(fake.latest(OTHER).state, 'failure');
  }
});

test('scenario 4: a write failure on the second PR leaves it invalidated, not successful', async () => {
  const fake = fakeGithub({
    pulls: [openPr({ number: 41, issue: null }), openPr({ number: 42, head: OTHER, issue: null })],
    comments: {
      41: [handoff({ prNumber: 41 }), verdict({ prNumber: 41 })],
      42: [handoff({ prNumber: 42, commit: OTHER }), verdict({ prNumber: 42, commit: OTHER })],
    },
    statuses: { ...success(HEAD, 1), ...success(OTHER, 1) },
  });
  fake.hooks.before = (method, path) => {
    if (method === 'POST' && path.endsWith(`/statuses/${OTHER}`) && fake.latest(OTHER).state === 'pending') {
      throw Object.assign(new Error('503'), { status: 503 });
    }
  };
  await assert.rejects(run(fake));
  assert.equal(fake.latest(HEAD).state, 'success');
  assert.equal(fake.latest(OTHER).state, 'pending');
});

test('scenario 4: cancellation after invalidation leaves every target fail-closed', async () => {
  const fake = fakeGithub({
    pulls: [openPr({ number: 41, issue: null }), openPr({ number: 42, head: OTHER })],
    comments: { 41: [handoff({ prNumber: 41 }), verdict({ prNumber: 41 })] },
    statuses: { ...success(HEAD), ...success(OTHER) },
  });
  fake.hooks.before = (method, path) => (path.includes('/comments') ? new Promise(() => {}) : undefined);
  run(fake);
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.latest(HEAD).state, 'pending');
  assert.equal(fake.latest(OTHER).state, 'pending');
});

test('scenario 4: open PR discovery failure errors the event PR rather than keeping success', async () => {
  const fake = fakeGithub({ statuses: success(HEAD) });
  fake.hooks.before = (method, path) => {
    if (path.includes('/pulls')) throw Object.assign(new Error('404'), { status: 404 });
  };
  await assert.rejects(run(fake, { event: { pull_request: openPr() } }));
  assert.equal(fake.latest(HEAD).state, 'error');
});

test('scenario 4: a later discovery page failure errors every already discovered head', async () => {
  const pulls = Array.from({ length: 100 }, (_, index) => openPr({ number: index + 1, head: index.toString(16).padStart(40, '0') }));
  const statuses = Object.assign({}, ...pulls.map((pull) => success(pull.head.sha)));
  const fake = fakeGithub({ pulls, statuses });
  const request = fake.gh.request;
  fake.gh.request = (path, options) => {
    if (path.includes('/pulls?state=open&per_page=100&page=2')) return Promise.reject(Object.assign(new Error('502'), { status: 502 }));
    return request(path, options);
  };
  await assert.rejects(run(fake, { event: { action: 'deleted', issue: { number: 600 } } }));
  for (const pull of pulls) assert.equal(fake.latest(pull.head.sha).state, 'error');
});

test('scenario 5: relinks, closure of a competitor, and base advance reevaluate affected PRs', async () => {
  const comments = { 600: [
    handoff({ prNumber: 41 }),
    verdict({ prNumber: 41 }),
    handoff({ id: 5, prNumber: 42, commit: OTHER, created: '2026-07-16T12:03:00Z' }),
    verdict({ id: 6, prNumber: 42, commit: OTHER, created: '2026-07-16T12:04:00Z' }),
  ] };
  const fake = fakeGithub({ pulls: [openPr({ number: 41 }), openPr({ number: 42, head: OTHER })], comments });
  await run(fake);
  assert.equal(fake.latest(HEAD).state, 'failure');
  assert.equal(fake.latest(OTHER).state, 'success');

  // PR 42 relinks to Issue: none (or closes): PR 41 regains authority on its issue.
  fake.state.pulls[1].body = 'Issue: none';
  await run(fake, { event: { pull_request: { number: 42, body: 'Issue: none' }, changes: { body: { from: 'Issue: #600' } } } });
  assert.equal(fake.latest(HEAD).state, 'success');
  assert.equal(fake.latest(OTHER).state, 'failure');
  fake.state.pulls[1].body = 'Issue: #600';
  await run(fake);
  assert.equal(fake.latest(HEAD).state, 'failure');
  fake.state.pulls.pop();
  await run(fake, { event: { action: 'closed', pull_request: { number: 42 } } });
  assert.equal(fake.latest(HEAD).state, 'success');

  // Invalid relink fails closed.
  fake.state.pulls[0].body = 'Issue: #600\nIssue: #601';
  await run(fake);
  assert.match(fake.latest(HEAD).description, /exactly one Issue/);

  // Carry-forward holds only while it merges the current base.
  const carried = fakeGithub({
    pulls: [openPr({ head: NEXT })],
    comments: { 600: [handoff(), verdict()] },
    statuses: success(HEAD),
  });
  const proveObjects = ({ base }) => (base === BASE
    ? { state: 'success', reviewedHead: HEAD }
    : { state: 'failure', description: 'refresh does not merge the current PR base' });
  await run(carried, { proveObjects });
  assert.match(carried.latest(NEXT).description, /^carried APPROVED; comment=2/);
  assert.equal(carried.state.posted.length, 1);
  carried.state.pulls[0].base.sha = OTHER;
  await run(carried, { proveObjects, event: { ref: 'refs/heads/main' } });
  assert.equal(carried.latest(NEXT).state, 'failure');
});

test('open PRs sharing a head SHA cannot authorize each other through the shared status', async () => {
  const fake = fakeGithub({
    pulls: [openPr({ number: 2, issue: null }), openPr({ number: 1, issue: null })],
    comments: { 1: [handoff({ prNumber: 1 }), verdict({ prNumber: 1 })], 2: [] },
  });
  await run(fake, { event: { pull_request: { number: 2 } } });
  assert.equal(fake.latest(HEAD).state, 'failure');
  assert.match(fake.latest(HEAD).description, /^PR #2: /);
  assert.ok(fake.state.writes.every((write) => write.state !== 'success'));
  fake.state.comments[2].push(handoff({ prNumber: 2 }), verdict({ id: 3, prNumber: 2 }));
  await run(fake);
  assert.equal(fake.latest(HEAD).state, 'success');
});

test('removing one record reevaluates surviving evidence instead of forcing failure', async () => {
  const fake = fakeGithub({
    pulls: [openPr()],
    comments: { 600: [handoff(), verdict(), verdict({ id: 3, created: '2026-07-16T12:02:00Z' })] },
  });
  await run(fake);
  assert.match(fake.latest(HEAD).description, /review=3/);
  fake.state.comments[600].pop(); // a non-owner deletes the newest owner approval
  await run(fake, { event: { action: 'deleted', issue: { number: 600 } } });
  assert.deepEqual([fake.latest(HEAD).state, fake.latest(HEAD).description], ['success', exactApprovalDescription(2)]);
  fake.state.comments[600].pop();
  await run(fake);
  assert.equal(fake.latest(HEAD).state, 'failure');
});

test('issue-free and Dependabot PRs reconcile from their own conversation', async () => {
  const fake = fakeGithub({
    pulls: [openPr({ number: 7, issue: null }), openPr({ number: 8, head: OTHER, issue: null, login: 'dependabot[bot]' })],
    comments: { 7: [handoff({ prNumber: 7 }), verdict({ prNumber: 7 })], 8: [] },
  });
  await run(fake);
  assert.equal(fake.latest(HEAD).state, 'success');
  assert.equal(fake.latest(OTHER).state, 'failure');
  fake.state.comments[8].push(verdict({ prNumber: 8, commit: OTHER }));
  await run(fake);
  assert.equal(fake.latest(OTHER).state, 'success');
});

test('unchanged non-success results are not rewritten on every run', async () => {
  const fake = fakeGithub({ pulls: [openPr()], comments: { 600: [] } });
  await run(fake);
  const writes = fake.state.writes.length;
  await run(fake);
  assert.equal(fake.state.writes.length, writes);
});

test('the GitHub client retries transient failures but not rejections or comment posts', async () => {
  const responses = [
    { ok: false, status: 502, text: async () => 'bad gateway' },
    { ok: true, status: 201, json: async () => ({ ok: 1 }) },
  ];
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return responses.shift(); };
  const gh = createGithub({ token: 't', fetchImpl, sleep: async () => {} });
  assert.deepEqual(await gh.request('/x', { method: 'POST' }), { ok: 1 });
  assert.equal(calls.length, 2);

  const rejected = createGithub({ token: 't', fetchImpl: async () => ({ ok: false, status: 422, text: async () => 'no' }), sleep: async () => {} });
  await assert.rejects(rejected.request('/x'), /422/);
  let posts = 0;
  const once = createGithub({ token: 't', fetchImpl: async () => { posts += 1; return { ok: false, status: 502, text: async () => '' }; }, sleep: async () => {} });
  await assert.rejects(once.request('/x', { method: 'POST' }, { retry: false }));
  assert.equal(posts, 1);
});
