#!/usr/bin/env node

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

export function evaluateDisposition({ pr, comments }) {
  const head = String(pr?.head?.sha ?? '').toLowerCase();
  if (!SHA_RE.test(head)) {
    return { state: 'error', description: 'PR head SHA is unavailable' };
  }

  const implementation = pr?.user?.login === 'dependabot[bot]'
    ? { agent: 'dependabot[bot]', execution: `dependabot:${head}`, commit: head }
    : parseImplementation(pr.body);
  if (!implementation || implementation.commit !== head) {
    return { state: 'pending', description: 'current-head implementation metadata required' };
  }

  const dispositions = comments
    .map(parseDisposition)
    .filter(Boolean)
    .filter((record) => record.commit === head)
    .filter((record) => record.record === 'OWNER_OVERRIDE' || record.reviewerExecution !== implementation.execution)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);

  const current = dispositions.at(-1);
  if (!current) {
    return { state: 'pending', description: 'review required for current PR head' };
  }

  if (current.disposition === 'APPROVED' || current.disposition === 'OWNER_OVERRIDE') {
    return { state: 'success', description: `${current.disposition.toLowerCase()} for current PR head` };
  }

  return { state: 'failure', description: `${current.disposition.toLowerCase()} for current PR head` };
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
  const result = evaluateDisposition({ pr, comments });
  await publish(result.state, result.description);
  console.log(`${REVIEW_CONTEXT}: ${result.state} — ${result.description}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyStatus().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
