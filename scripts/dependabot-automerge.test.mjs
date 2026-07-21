import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/dependabot-automerge.yml', 'utf8');

test('rechecks every Dependabot head by disabling stale auto-merge before guards', () => {
  const autoMergeState = workflow.indexOf("gh pr view \"$PR_URL\" --json autoMergeRequest --jq '.autoMergeRequest != null'");
  const disable = workflow.indexOf('gh pr merge --disable-auto "$PR_URL"');
  const metadata = workflow.indexOf('- name: Fetch Dependabot metadata');
  const changedFiles = workflow.indexOf('- name: Verify changed files are limited to approved manifests/lockfiles');
  const enable = workflow.indexOf('gh pr merge --auto --squash --match-head-commit "$HEAD_SHA" "$PR_URL"');

  assert.ok(autoMergeState >= 0, 'every Dependabot run checks whether auto-merge is enabled');
  assert.ok(disable >= 0, 'every enabled Dependabot auto-merge is explicitly revoked');
  assert.ok(autoMergeState < disable, 'an absent auto-merge request is an explicit no-op');
  assert.ok(disable < metadata, 'metadata failures leave auto-merge disabled');
  assert.ok(disable < changedFiles, 'disallowed files leave auto-merge disabled');
  assert.ok(changedFiles < enable, 'only an allowed head can re-enable auto-merge');
});

test('only exact-head Dependabot patch updates can re-enable auto-merge', () => {
  assert.match(workflow, /github\.actor == 'dependabot\[bot\]'/);
  assert.match(workflow, /github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
  assert.match(workflow, /steps\.changed\.outputs\.allowed == 'true'/);
  assert.match(workflow, /steps\.metadata\.outputs\.update-type == 'version-update:semver-patch'/);
  assert.match(workflow, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(workflow, /--match-head-commit "\$HEAD_SHA"/);
});
