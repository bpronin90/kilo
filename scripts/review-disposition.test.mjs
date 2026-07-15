import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDisposition, parseDisposition } from './review-disposition.mjs';

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

test('remains pending before review', () => {
  assert.equal(evaluateDisposition({ pr: pr(), comments: [] }).state, 'pending');
});

test('requires implementation metadata for the current head', () => {
  assert.equal(evaluateDisposition({ pr: pr({ commit: NEXT }), comments: [comment()] }).state, 'pending');
});

test('derives current-head implementation metadata for Dependabot PRs', () => {
  const dependabotPr = { head: { sha: HEAD }, body: '', user: { login: 'dependabot[bot]' } };
  assert.equal(evaluateDisposition({ pr: dependabotPr, comments: [comment()] }).state, 'success');
});

test('accepts an independent approval for the exact head', () => {
  assert.equal(evaluateDisposition({ pr: pr(), comments: [comment()] }).state, 'success');
});

test('rejects review from the implementation execution', () => {
  assert.equal(evaluateDisposition({ pr: pr(), comments: [comment({ execution: 'impl-1' })] }).state, 'pending');
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
  assert.equal(evaluateDisposition({ pr: pr({ head: NEXT }), comments: [comment()] }).state, 'pending');
});

test('ignores unauthorized, edited, and malformed comments', () => {
  const invalid = [
    comment({ id: 1, association: 'NONE' }),
    comment({ id: 2, updated: '2026-07-15T12:02:00Z' }),
    { ...comment({ id: 3 }), body: 'RECORD=REVIEW\nDISPOSITION=APPROVED' },
  ];
  assert.equal(evaluateDisposition({ pr: pr(), comments: invalid }).state, 'pending');
});

test('requires exactly one value for each control field', () => {
  const duplicate = comment();
  duplicate.body += '\nDISPOSITION=BLOCKED';
  assert.equal(parseDisposition(duplicate), null);
});
