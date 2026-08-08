#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultWorkspaces = ['.', 'mobile'];
const blockingSeverities = new Set(['high', 'critical']);
const ghsaRe = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;
const dateRe = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

export function runAudit(workspace, root = defaultRoot) {
  try {
    return execFileSync('npm', ['audit', '--json'], {
      cwd: join(root, workspace),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero whenever it finds anything; the report is still on stdout.
    if (typeof error.stdout === 'string' && error.stdout.trim()) return error.stdout;
    throw new Error(`${workspace}: npm audit produced no report (${error.message})`);
  }
}

export function collectAdvisories(report, workspace = '.') {
  const parsed = typeof report === 'string' ? JSON.parse(report) : report;
  const advisories = new Map();
  for (const vulnerability of Object.values(parsed.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      // String entries are chained dependents; only object entries are real advisories.
      if (typeof via !== 'object' || via === null) continue;
      if (!blockingSeverities.has(via.severity)) continue;
      const id = String(via.url ?? '').split('/').pop() || `npm-${via.source}`;
      const existing = advisories.get(id);
      if (existing) {
        existing.workspaces.add(workspace);
        continue;
      }
      advisories.set(id, {
        id,
        package: via.name,
        title: via.title,
        severity: via.severity,
        range: via.range,
        url: via.url,
        workspaces: new Set([workspace]),
      });
    }
  }
  return advisories;
}

export function readAllowlist(root = defaultRoot) {
  const path = join(root, 'audit-allowlist.json');
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`audit-allowlist.json: ${error.message}`);
  }
  if (!Array.isArray(parsed?.accepted)) throw new Error('audit-allowlist.json: expected an "accepted" array');
  return parsed.accepted.map((entry, index) => {
    const where = `audit-allowlist.json entry ${index + 1}`;
    if (!ghsaRe.test(entry?.id ?? '')) throw new Error(`${where}: "id" must be a GHSA identifier`);
    if (!entry.package) throw new Error(`${entry.id}: "package" is required`);
    if (!dateRe.test(entry.reviewBy ?? '')) throw new Error(`${entry.id}: "reviewBy" must be YYYY-MM-DD`);
    if (!entry.reason || entry.reason.trim().length < 40) {
      throw new Error(`${entry.id}: "reason" must explain why the advisory is accepted`);
    }
    return entry;
  });
}

export function evaluate(advisories, allowlist, today = new Date().toISOString().slice(0, 10)) {
  const accepted = new Map(allowlist.map((entry) => [entry.id, entry]));
  const blocking = [];
  const expired = [];
  for (const advisory of advisories.values()) {
    const entry = accepted.get(advisory.id);
    if (!entry) {
      blocking.push(advisory);
    } else if (entry.reviewBy < today) {
      expired.push({ ...advisory, reviewBy: entry.reviewBy });
    }
  }
  // An exception that no longer matches a live advisory has to be deleted, or the
  // file silently accumulates permission nobody re-examines.
  const stale = allowlist.filter((entry) => !advisories.has(entry.id));
  return { blocking, expired, stale, ok: blocking.length === 0 && expired.length === 0 && stale.length === 0 };
}

export function auditWorkspaces(root = defaultRoot, workspaces = defaultWorkspaces) {
  const advisories = new Map();
  for (const workspace of workspaces) {
    for (const [id, advisory] of collectAdvisories(runAudit(workspace, root), workspace)) {
      const existing = advisories.get(id);
      if (existing) advisory.workspaces.forEach((name) => existing.workspaces.add(name));
      else advisories.set(id, advisory);
    }
  }
  return advisories;
}

function describe(advisory) {
  const where = [...advisory.workspaces].sort().join(', ');
  return `  ${advisory.id}  ${advisory.package}@${advisory.range}  [${where}]\n    ${advisory.title}\n    ${advisory.url}`;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const advisories = auditWorkspaces();
    const allowlist = readAllowlist();
    const { blocking, expired, stale, ok } = evaluate(advisories, allowlist);

    if (blocking.length > 0) {
      console.error(`${blocking.length} unreviewed high/critical advisory(ies):`);
      for (const advisory of blocking) console.error(describe(advisory));
      console.error('\nRemediate the dependency, or add a reviewed entry to audit-allowlist.json.');
    }
    if (expired.length > 0) {
      console.error(`${expired.length} accepted advisory(ies) are past their review date:`);
      for (const advisory of expired) console.error(`${describe(advisory)}\n    reviewBy: ${advisory.reviewBy}`);
      console.error('\nRe-check whether a fix has shipped, then extend or remove the entry.');
    }
    if (stale.length > 0) {
      console.error(`${stale.length} allowlist entry(ies) no longer match a live advisory:`);
      for (const entry of stale) console.error(`  ${entry.id}  ${entry.package}`);
      console.error('\nDelete them from audit-allowlist.json.');
    }
    if (!ok) process.exit(1);

    const count = allowlist.length;
    console.log(
      count === 0
        ? 'No high or critical advisories.'
        : `No unreviewed high or critical advisories (${count} accepted, all within review date).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
