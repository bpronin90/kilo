#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';

const REVIEW_CONTEXT = 'review disposition accepted';
const AUTHORIZED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
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

export function parseImplementation(body) {
  const agent = singleField(body, 'Implementation-Agent');
  const execution = singleField(body, 'Implementation-Execution');
  const commit = singleField(body, 'Implementation-Commit');
  if (!agent || !execution || !commit || !SHA_RE.test(commit)) return null;
  return { agent, execution, commit };
}

export function parseDisposition(comment) {
  if (!AUTHORIZED_ASSOCIATIONS.has(comment.author_association)) return null;
  if (comment.created_at !== comment.updated_at) return null;

  const record = singleControl(comment.body, 'RECORD');
  const disposition = singleControl(comment.body, 'DISPOSITION');
  const commit = singleField(comment.body, 'Commit');
  if (!record || !disposition || !commit || !SHA_RE.test(commit)) return null;

  if (record === 'REVIEW') {
    if (!new Set(['APPROVED', 'FEEDBACK', 'BLOCKED']).has(disposition)) return null;
    const reviewerExecution = singleField(comment.body, 'Reviewer-Execution');
    const findings = singleField(comment.body, 'Findings');
    if (!reviewerExecution || !findings) return null;
    return {
      record,
      disposition,
      commit,
      reviewerExecution,
      createdAt: comment.created_at,
      id: Number(comment.id),
    };
  }

  if (record === 'OWNER_OVERRIDE' && disposition === 'OWNER_OVERRIDE') {
    if (comment.author_association !== 'OWNER') return null;
    const reason = singleField(comment.body, 'Reason');
    if (!reason) return null;
    return {
      record,
      disposition,
      commit,
      reviewerExecution: null,
      createdAt: comment.created_at,
      id: Number(comment.id),
    };
  }

  return null;
}

export function controllingDisposition({ comments, commit, implementationExecution }) {
  return comments
    .map(parseDisposition)
    .filter(Boolean)
    .filter((record) => record.commit === commit)
    .filter((record) => record.record === 'OWNER_OVERRIDE' || record.reviewerExecution !== implementationExecution)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)
    .at(-1) ?? null;
}

export function evaluateDisposition({ pr, comments, carryForward = null }) {
  const head = String(pr?.head?.sha ?? '').toLowerCase();
  if (!SHA_RE.test(head)) {
    return { state: 'error', description: 'PR head SHA is unavailable' };
  }

  const implementation = pr?.user?.login === 'dependabot[bot]'
    ? { agent: 'dependabot[bot]', execution: `dependabot:${head}`, commit: head }
    : parseImplementation(pr.body);
  if (!implementation || implementation.commit !== head) {
    return { state: 'failure', description: 'PR body requires unique current-head implementation metadata' };
  }

  const current = controllingDisposition({
    comments,
    commit: head,
    implementationExecution: implementation.execution,
  });
  if (!current) {
    if (carryForward?.state === 'success') return carryForward;
    return carryForward ?? { state: 'failure', description: 'exact-head review or verified closeout refresh required' };
  }

  if (current.disposition === 'APPROVED' || current.disposition === 'OWNER_OVERRIDE') {
    return { state: 'success', description: `${current.disposition.toLowerCase()} for current PR head` };
  }

  return { state: 'failure', description: `${current.disposition.toLowerCase()} for current PR head` };
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

function changedPaths(from, to) {
  const output = git([
    'diff-tree', '-r', '-z', '--name-only', '--no-renames', '--no-commit-id',
    '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', from, to,
  ]);
  const paths = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index > start) paths.push(output.subarray(start, index));
    start = index + 1;
  }
  return paths;
}

export function pathsOverlap(left, right) {
  const asBuffer = (path) => Buffer.isBuffer(path) ? path : Buffer.from(path);
  const key = (path) => path.toString('hex');
  const display = (path) => path.toString('utf8');
  const rightPaths = right.map(asBuffer);
  const rightSet = new Map(rightPaths.map((path) => [key(path), path]));
  const rightDescendant = new Map();
  for (const path of rightPaths) {
    for (let index = path.indexOf(0x2f); index !== -1; index = path.indexOf(0x2f, index + 1)) {
      const ancestor = path.subarray(0, index);
      if (!rightDescendant.has(key(ancestor))) rightDescendant.set(key(ancestor), path);
    }
  }
  for (const value of left) {
    const path = asBuffer(value);
    const exact = rightSet.get(key(path));
    if (exact) return `${display(path)} ↔ ${display(exact)}`;
    const descendant = rightDescendant.get(key(path));
    if (descendant) return `${display(path)} ↔ ${display(descendant)}`;
    for (let index = path.indexOf(0x2f); index !== -1; index = path.indexOf(0x2f, index + 1)) {
      const ancestor = rightSet.get(key(path.subarray(0, index)));
      if (ancestor) return `${display(path)} ↔ ${display(ancestor)}`;
    }
  }
  return null;
}

function rawDelta(from, to) {
  return git([
    'diff-tree', '-r', '-z', '--raw', '--no-renames', '--no-commit-id', '--no-abbrev',
    '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', from, to,
  ]);
}

function buffersEqual(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

async function acceptedExactHeadStatus(repository, sha) {
  const combined = await githubRequest(`/repos/${repository}/commits/${sha}/status?per_page=100`);
  return combined.statuses.find((status) => (
    status.context === REVIEW_CONTEXT
      && status.state === 'success'
      && status.description === 'approved for current PR head'
  )) ?? null;
}

export function verifyRefreshObjects({ head, base }) {
  ensureCommit(head);
  ensureCommit(base);

  const ancestry = git(['rev-list', '--parents', '-n', '1', head], { encoding: 'utf8' }).trim().split(/\s+/);
  if (ancestry.length !== 3) {
    return { state: 'failure', description: 'refresh head must have exactly two parents' };
  }
  const [, reviewedHead, mergedBase] = ancestry;
  if (mergedBase !== base) {
    return { state: 'failure', description: 'refresh does not merge the current PR base' };
  }

  ensureCommit(reviewedHead);
  const mergeBase = git(['merge-base', reviewedHead, base], { encoding: 'utf8' }).trim();
  const overlap = pathsOverlap(changedPaths(mergeBase, reviewedHead), changedPaths(mergeBase, base));
  if (overlap) {
    return { state: 'failure', description: `refresh path overlap: ${overlap}` };
  }

  const originalDelta = rawDelta(mergeBase, reviewedHead);
  const refreshedDelta = rawDelta(base, head);
  if (!buffersEqual(originalDelta, refreshedDelta)) {
    return { state: 'failure', description: 'refresh changes the reviewed object-level delta' };
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
  if (expectedTree !== actualTree) {
    return { state: 'failure', description: 'refresh tree is not the reproducible Git merge result' };
  }

  return { state: 'success', reviewedHead };
}

async function proveCarryForward({ repository, pr, comments, implementation }) {
  const head = pr.head.sha.toLowerCase();
  const base = pr.base.sha.toLowerCase();
  const objectProof = verifyRefreshObjects({ head, base });
  if (objectProof.state !== 'success') return objectProof;
  const { reviewedHead } = objectProof;

  const reviewed = controllingDisposition({
    comments,
    commit: reviewedHead,
    implementationExecution: implementation.execution,
  });
  if (!reviewed || reviewed.record !== 'REVIEW' || reviewed.disposition !== 'APPROVED') {
    return { state: 'failure', description: 'parent head lacks a controlling ordinary approval' };
  }

  const priorStatus = await acceptedExactHeadStatus(repository, reviewedHead);
  if (!priorStatus) {
    return { state: 'failure', description: 'parent approval was not accepted as an ordinary exact-head review' };
  }

  return {
    state: 'success',
    description: `carried approval from ${reviewedHead.slice(0, 12)}; object delta unchanged`,
  };
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

async function getAllComments(repository, prNumber) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubRequest(`/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

async function applyStatus() {
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!repository || !eventPath) throw new Error('GITHUB_REPOSITORY and GITHUB_EVENT_PATH are required');

  const { readFile } = await import('node:fs/promises');
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const prNumber = event.pull_request?.number ?? (event.issue?.pull_request ? event.issue.number : null);
  if (!prNumber) {
    console.log('Event is not associated with a pull request; nothing to evaluate.');
    return;
  }

  const pr = await githubRequest(`/repos/${repository}/pulls/${prNumber}`);
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  const publish = (state, description) => githubRequest(`/repos/${repository}/statuses/${pr.head.sha}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, context: REVIEW_CONTEXT, description: description.slice(0, 140), target_url: runUrl }),
  });

  await publish('pending', 'evaluating current PR head review disposition');
  const comments = await getAllComments(repository, prNumber);
  const implementation = pr.user?.login === 'dependabot[bot]'
    ? { agent: 'dependabot[bot]', execution: `dependabot:${pr.head.sha}`, commit: pr.head.sha }
    : parseImplementation(pr.body);
  let carryForward = null;
  if (implementation?.commit === pr.head.sha.toLowerCase()) {
    const exact = controllingDisposition({
      comments,
      commit: pr.head.sha.toLowerCase(),
      implementationExecution: implementation.execution,
    });
    if (!exact) {
      carryForward = await proveCarryForward({ repository, pr, comments, implementation });
    }
  }
  const result = evaluateDisposition({ pr, comments, carryForward });
  await publish(result.state, result.description);
  console.log(`${REVIEW_CONTEXT}: ${result.state} — ${result.description}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyStatus().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
