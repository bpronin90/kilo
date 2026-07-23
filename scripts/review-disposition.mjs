#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REVIEW_CONTEXT = 'review disposition accepted';
const SHA_RE = /^[0-9a-f]{40}$/;

function fieldValues(body, name) {
  const prefix = `${name}:`;
  return String(body ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

function singleField(body, name) {
  const values = fieldValues(body, name);
  return values.length === 1 && values[0] ? values[0] : null;
}

function singleControl(body, name) {
  const prefix = `${name}=`;
  const values = String(body ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  return values.length === 1 && values[0] ? values[0] : null;
}

function parseNumber(value) {
  const match = String(value ?? '').match(/^#?([1-9][0-9]*)$/);
  return match ? Number(match[1]) : null;
}

function immutableAuthorizedComment(comment) {
  return comment?.author_association === 'OWNER'
    && comment.created_at === comment.updated_at
    && Number.isSafeInteger(Number(comment.id));
}

export function parseIssueReference(body) {
  const values = fieldValues(body, 'Issue');
  if (values.length !== 1) return null;
  if (values[0].toLowerCase() === 'none') return { kind: 'none', number: null };
  const number = parseNumber(values[0]);
  return number ? { kind: 'issue', number } : null;
}

export function parseHandoff(comment) {
  if (!immutableAuthorizedComment(comment)) return null;
  const update = singleControl(comment.body, 'UPDATE');
  if (!new Set(['IMPLEMENTED', 'FEEDBACK_ADDRESSED']).has(update)) return null;
  const pr = parseNumber(singleField(comment.body, 'PR'));
  const commit = singleField(comment.body, 'Commit')?.toLowerCase();
  const summary = singleField(comment.body, 'Summary');
  const verification = singleField(comment.body, 'Verification');
  const remaining = singleField(comment.body, 'Remaining');
  if (!pr || !SHA_RE.test(commit ?? '') || !summary || !verification || !remaining) return null;
  return {
    update,
    pr,
    commit,
    summary,
    verification,
    remaining,
    createdAt: comment.created_at,
    id: Number(comment.id),
  };
}

export function implicitDependabotHandoff(prNumber, commit) {
  return {
    pr: prNumber,
    commit,
    createdAt: '1970-01-01T00:00:00Z',
    id: 0,
  };
}

export function parseDisposition(comment) {
  if (!immutableAuthorizedComment(comment)) return null;
  const pr = parseNumber(singleField(comment.body, 'PR'));
  const commit = singleField(comment.body, 'Commit')?.toLowerCase();
  if (!pr || !SHA_RE.test(commit ?? '')) return null;

  const verdict = singleControl(comment.body, 'VERDICT');
  if (new Set(['APPROVED', 'FEEDBACK', 'BLOCKED']).has(verdict)) {
    const findings = singleField(comment.body, 'Findings');
    if (!findings) return null;
    return {
      record: 'REVIEW',
      disposition: verdict,
      pr,
      commit,
      findings,
      createdAt: comment.created_at,
      id: Number(comment.id),
    };
  }

  if (singleControl(comment.body, 'STATUS') === 'OWNER_OVERRIDE') {
    if (comment.author_association !== 'OWNER') return null;
    const reason = singleField(comment.body, 'Reason');
    if (!reason) return null;
    return {
      record: 'OWNER_OVERRIDE',
      disposition: 'OWNER_OVERRIDE',
      pr,
      commit,
      reason,
      createdAt: comment.created_at,
      id: Number(comment.id),
    };
  }
  return null;
}

function compareRecords(left, right) {
  return left.createdAt.localeCompare(right.createdAt) || left.id - right.id;
}

export function latestHandoff(comments, prNumber, commit) {
  return comments
    .map(parseHandoff)
    .filter(Boolean)
    .filter((record) => record.pr === prNumber && record.commit === commit)
    .sort(compareRecords)
    .at(-1) ?? null;
}

export function controllingDisposition(comments, prNumber, commit, handoff = null) {
  const records = comments
    .map(parseDisposition)
    .filter(Boolean)
    .filter((record) => record.pr === prNumber && record.commit === commit)
    .filter((record) => !handoff || compareRecords(record, handoff) > 0)
    .sort(compareRecords);
  const overrides = records.filter((record) => record.record === 'OWNER_OVERRIDE');
  return overrides.at(-1) ?? records.at(-1) ?? null;
}

export function selectAuthoritativeEvidence(evidence) {
  return evidence
    .filter((item) => item?.handoff)
    .sort((left, right) => compareRecords(left.handoff, right.handoff))
    .at(-1) ?? null;
}

export function evaluateDisposition({ pr, comments, handoff = null, authoritative = true, carryForward = null }) {
  const head = String(pr?.head?.sha ?? '').toLowerCase();
  const prNumber = Number(pr?.number);
  if (!SHA_RE.test(head) || !Number.isSafeInteger(prNumber)) {
    return { state: 'error', description: 'PR number or head SHA is unavailable' };
  }
  if (!authoritative) {
    return { state: 'failure', description: 'PR is not the authoritative implementation for its linked issue' };
  }

  const implicitDependabotHandoff = pr?.user?.login === 'dependabot[bot]';
  if (!handoff && !implicitDependabotHandoff && carryForward?.state !== 'success') {
    return { state: 'failure', description: 'current PR head requires an unedited implementation handoff' };
  }

  const current = controllingDisposition(comments, prNumber, head, handoff);
  const latestExactHead = controllingDisposition(comments, prNumber, head);
  if (!current && handoff && latestExactHead && compareRecords(latestExactHead, handoff) < 0) {
    return { state: 'failure', description: 'exact-head verdict predates the current implementation handoff' };
  }
  if (current?.disposition === 'APPROVED' || current?.disposition === 'OWNER_OVERRIDE') {
    return {
      state: 'success',
      description: current.disposition === 'APPROVED'
        ? `approved for current PR head; review=${current.id}`
        : `owner override for current PR head; comment=${current.id}`,
      controllingCommentId: current.id,
    };
  }
  if (current) {
    return { state: 'failure', description: `${current.disposition.toLowerCase()} for current PR head` };
  }
  if (carryForward?.state === 'success') return carryForward;
  return carryForward ?? { state: 'failure', description: 'exact-head review or verified closeout refresh required' };
}

function git(args, options = {}) {
  return execFileSync('git', ['--no-replace-objects', ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
    },
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function ensureCommit(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
  } catch {
    git(['fetch', '--no-tags', 'origin', sha], { stdio: 'ignore' });
    git(['cat-file', '-e', `${sha}^{commit}`]);
  }
}

function exactPatch(from, to) {
  return git([
    'diff', '--full-index', '--binary', '--no-renames',
    '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', from, to,
  ]);
}

export function exactApprovalDescription(commentId) {
  return `approved for current PR head; review=${commentId}`;
}

export function exactOverrideDescription(commentId) {
  return `owner override for current PR head; comment=${commentId}`;
}

export function isMatchingExactApprovalStatus(status, commentId) {
  return status?.context === REVIEW_CONTEXT
    && status.state === 'success'
    && status.description === exactApprovalDescription(commentId);
}

function isMatchingExactDispositionStatus(status, disposition) {
  const description = disposition.record === 'OWNER_OVERRIDE'
    ? exactOverrideDescription(disposition.id)
    : exactApprovalDescription(disposition.id);
  return status?.context === REVIEW_CONTEXT
    && status.state === 'success'
    && (
      status.description === description
      || status.description?.startsWith(`carried ${disposition.disposition}; comment=${disposition.id};`)
    );
}

export function validateParentDisposition({ comments, prNumber, reviewedHead, handoff, exactStatus }) {
  const reviewed = controllingDisposition(comments, prNumber, reviewedHead, handoff);
  if (!reviewed || !new Set(['APPROVED', 'OWNER_OVERRIDE']).has(reviewed.disposition)) {
    return { state: 'failure', description: 'parent head lacks a controlling unedited approval or owner override' };
  }
  if (!isMatchingExactDispositionStatus(exactStatus, reviewed)) {
    return { state: 'failure', description: 'parent disposition is not the latest accepted review status' };
  }
  return {
    state: 'success',
    dispositionCommentId: reviewed.id,
    disposition: reviewed.disposition,
    reason: reviewed.reason ?? null,
  };
}

export function verifyRefreshObjects({ head, base }) {
  ensureCommit(head);
  ensureCommit(base);
  const ancestry = git(['rev-list', '--parents', '-n', '1', head], { encoding: 'utf8' }).trim().split(/\s+/);
  if (ancestry.length !== 3) return { state: 'failure', description: 'refresh head must have exactly two parents' };
  const [, reviewedHead, mergedBase] = ancestry;
  if (mergedBase !== base) return { state: 'failure', description: 'refresh does not merge the current PR base' };

  ensureCommit(reviewedHead);
  const mergeBase = git(['merge-base', reviewedHead, base], { encoding: 'utf8' }).trim();
  const isolated = mkdtempSync(join(tmpdir(), 'review-carry-forward-'));
  const indexPath = join(isolated, 'index');
  let appliedTree;
  try {
    const indexEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_NO_REPLACE_OBJECTS: '1',
      GIT_INDEX_FILE: indexPath,
    };
    git(['read-tree', base], { env: indexEnv });
    git(['apply', '--cached', '--whitespace=nowarn', '-'], {
      env: indexEnv,
      input: exactPatch(mergeBase, reviewedHead),
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    appliedTree = git(['write-tree'], { env: indexEnv, encoding: 'utf8' }).trim();
  } catch {
    return { state: 'failure', description: 'reviewed patch does not apply exactly to the current PR base' };
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }

  let expectedTree;
  try {
    expectedTree = git([
      '-c', 'core.hooksPath=/dev/null', 'merge-tree', '--write-tree', reviewedHead, base,
    ], { encoding: 'utf8' }).trim().split(/\s+/)[0];
  } catch {
    return { state: 'failure', description: 'refresh cannot be reproduced as a conflict-free Git merge' };
  }
  const actualTree = git(['rev-parse', `${head}^{tree}`], { encoding: 'utf8' }).trim();
  if (appliedTree !== actualTree) {
    return { state: 'failure', description: 'refresh tree does not reproduce the exact reviewed patch on the current base' };
  }
  if (expectedTree !== actualTree) {
    return { state: 'failure', description: 'refresh tree is not the reproducible Git merge result' };
  }
  return { state: 'success', reviewedHead };
}

async function githubRequest(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function getAllPages(path) {
  const values = [];
  for (let page = 1; ; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await githubRequest(`${path}${separator}per_page=100&page=${page}`);
    values.push(...batch);
    if (batch.length < 100) return values;
  }
}

async function getAllComments(repository, issueNumber) {
  return getAllPages(`/repos/${repository}/issues/${issueNumber}/comments`);
}

async function getOpenPulls(repository) {
  return getAllPages(`/repos/${repository}/pulls?state=open`);
}

async function latestReviewStatus(repository, sha) {
  const statuses = await getAllPages(`/repos/${repository}/commits/${sha}/statuses`);
  return statuses.find((status) => status.context === REVIEW_CONTEXT) ?? null;
}

async function proveCarryForward({ repository, pr, comments }) {
  const head = pr.head.sha.toLowerCase();
  const base = pr.base.sha.toLowerCase();
  const objectProof = verifyRefreshObjects({ head, base });
  if (objectProof.state !== 'success') return objectProof;
  const { reviewedHead } = objectProof;
  const parentHandoff = pr.user?.login === 'dependabot[bot]'
    ? implicitDependabotHandoff(pr.number, reviewedHead)
    : latestHandoff(comments, pr.number, reviewedHead);
  if (!parentHandoff) return { state: 'failure', description: 'reviewed parent lacks a valid implementation handoff' };
  const exactStatus = await latestReviewStatus(repository, reviewedHead);
  const dispositionProof = validateParentDisposition({
    comments, prNumber: pr.number, reviewedHead, handoff: parentHandoff, exactStatus,
  });
  if (dispositionProof.state !== 'success') return dispositionProof;
  return {
    state: 'success',
    description: `carried ${dispositionProof.disposition}; comment=${dispositionProof.dispositionCommentId}; patch unchanged`,
    reviewedHead,
    dispositionCommentId: dispositionProof.dispositionCommentId,
    disposition: dispositionProof.disposition,
    reason: dispositionProof.reason,
    handoff: parentHandoff,
  };
}

async function publishStatus(repository, pr, state, description) {
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  return githubRequest(`/repos/${repository}/statuses/${pr.head.sha}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, context: REVIEW_CONTEXT, description: description.slice(0, 140), target_url: runUrl }),
  });
}

export function carryForwardRecordBody(pr, carry) {
  return [
    'STATUS=REVIEW_CARRIED_FORWARD',
    `PR: #${pr.number}`,
    `Reviewed-Commit: ${carry.reviewedHead}`,
    `Commit: ${pr.head.sha.toLowerCase()}`,
    `Disposition: ${carry.disposition}`,
    `Disposition-Comment: ${carry.dispositionCommentId}`,
    ...(carry.disposition === 'OWNER_OVERRIDE' ? [`Reason: ${carry.reason}`] : []),
    'Verification: conflict-free base refresh with exact reviewed patch and reproduced tree',
  ].join('\n');
}

export function hasImmutableCarryForwardRecord(comments, marker) {
  return comments.some((comment) => (
    comment.body === marker
    && comment.created_at === comment.updated_at
    && comment.author_association === 'OWNER'
  ));
}

async function postCarryForwardRecord(repository, issueNumber, pr, carry, comments) {
  if (!issueNumber) return;
  const marker = carryForwardRecordBody(pr, carry);
  if (hasImmutableCarryForwardRecord(comments, marker)) return;
  await githubRequest(`/repos/${repository}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: marker }),
  });
}

export function pullsForIssue(pulls, issueNumber) {
  return pulls.filter((pr) => parseIssueReference(pr.body)?.number === issueNumber);
}

export function issueNumbersForPullEvent(event, currentBody) {
  const numbers = new Set();
  const current = parseIssueReference(currentBody);
  const previous = parseIssueReference(event?.changes?.body?.from);
  if (current?.kind === 'issue') numbers.add(current.number);
  if (previous?.kind === 'issue') numbers.add(previous.number);
  return [...numbers];
}

async function evaluateIssuePulls(repository, issueNumber, pulls) {
  const comments = await getAllComments(repository, issueNumber);
  const evidence = [];
  for (const pr of pulls) {
    const head = pr.head.sha.toLowerCase();
    const handoff = latestHandoff(comments, pr.number, head);
    let carryForward = null;
    if (!handoff) carryForward = await proveCarryForward({ repository, pr, comments });
    evidence.push({ pr, handoff: handoff ?? carryForward?.handoff ?? null, exactHandoff: handoff, carryForward });
  }
  const authoritative = selectAuthoritativeEvidence(evidence);
  for (const item of evidence) {
    await publishStatus(repository, item.pr, 'pending', 'evaluating current PR head review disposition');
    const result = evaluateDisposition({
      pr: item.pr,
      comments,
      handoff: item.exactHandoff,
      authoritative: authoritative?.pr.number === item.pr.number,
      carryForward: item.carryForward,
    });
    await publishStatus(repository, item.pr, result.state, result.description);
    if (result.state === 'success' && item.carryForward?.state === 'success') {
      await postCarryForwardRecord(repository, issueNumber, item.pr, item.carryForward, comments);
    }
    console.log(`PR #${item.pr.number}: ${result.state} — ${result.description}`);
  }
}

async function evaluatePullConversation(repository, pr) {
  const comments = await getAllComments(repository, pr.number);
  const head = pr.head.sha.toLowerCase();
  if (pr.user?.login !== 'dependabot[bot]' && parseIssueReference(pr.body)?.kind !== 'none') {
    await publishStatus(repository, pr, 'failure', 'PR body requires exactly one Issue: #number or Issue: none field');
    return;
  }
  const handoff = pr.user?.login === 'dependabot[bot]'
    ? implicitDependabotHandoff(pr.number, head)
    : latestHandoff(comments, pr.number, head);
  const carryForward = handoff ? null : await proveCarryForward({ repository, pr, comments });
  await publishStatus(repository, pr, 'pending', 'evaluating current PR head review disposition');
  const result = evaluateDisposition({ pr, comments, handoff, carryForward });
  await publishStatus(repository, pr, result.state, result.description);
  if (result.state === 'success' && carryForward?.state === 'success') {
    await postCarryForwardRecord(repository, pr.number, pr, carryForward, comments);
  }
  console.log(`PR #${pr.number}: ${result.state} — ${result.description}`);
}

async function applyStatus() {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repository || !eventPath) throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');
  const { readFile } = await import('node:fs/promises');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));

  if (event.issue && !event.issue.pull_request) {
    const pulls = pullsForIssue(await getOpenPulls(repository), event.issue.number);
    if (pulls.length === 0) return console.log(`Issue #${event.issue.number} has no linked open PRs.`);
    return evaluateIssuePulls(repository, event.issue.number, pulls);
  }

  const prNumber = event.pull_request?.number ?? (event.issue?.pull_request ? event.issue.number : null);
  if (!prNumber) return console.log('Event is not associated with an issue or pull request.');
  const pr = await githubRequest(`/repos/${repository}/pulls/${prNumber}`);
  const issue = parseIssueReference(pr.body);
  if (event.pull_request) {
    const openPulls = await getOpenPulls(repository);
    for (const issueNumber of issueNumbersForPullEvent(event, pr.body)) {
      const pulls = pullsForIssue(openPulls, issueNumber);
      if (pulls.length > 0) await evaluateIssuePulls(repository, issueNumber, pulls);
    }
    if (issue?.kind === 'issue') return;
    return evaluatePullConversation(repository, pr);
  }
  if (issue?.kind === 'issue') {
    const pulls = pullsForIssue(await getOpenPulls(repository), issue.number);
    return evaluateIssuePulls(repository, issue.number, pulls);
  }
  return evaluatePullConversation(repository, pr);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyStatus().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
