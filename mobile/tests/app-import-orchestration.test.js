// Behavior coverage for the backup-import application command (#1495).
import fs from 'fs';
import path from 'path';
import { runBackupImport } from '../app/import';

const PAYLOAD = { version: '4', weight_entries: [] };

function harness({ importResult = { ok: true }, getStorageMode } = {}) {
  const calls = [];
  const deferred = {};
  const importBackup = jest.fn((...args) => {
    calls.push('importBackup');
    return new Promise((resolve, reject) => {
      deferred.resolve = () => resolve(importResult);
      deferred.reject = reject;
    });
  });
  const mk = (name) => jest.fn(() => { calls.push(name); });
  const refreshers = [mk('weight'), mk('notes'), mk('recovery'), mk('settings')];
  const deps = { importBackup, getStorageMode, refreshers };
  return { calls, deferred, importBackup, refreshers, deps };
}

describe('runBackupImport', () => {
  test('local mode: replaces with the active mode and refreshes in order after commit', async () => {
    const h = harness({ getStorageMode: jest.fn(() => 'local') });
    const p = runBackupImport(PAYLOAD, h.deps);
    // Nothing refreshes while the durable restore is still pending.
    await Promise.resolve();
    expect(h.calls).toEqual(['importBackup']);
    h.deferred.resolve();
    const result = await p;
    expect(result).toEqual({ ok: true });
    expect(h.importBackup).toHaveBeenCalledWith(PAYLOAD, 'replace', { mode: 'local' });
    expect(h.calls).toEqual(['importBackup', 'weight', 'notes', 'recovery', 'settings']);
  });

  test('cloud mode: passes the cloud mode through', async () => {
    const h = harness({ getStorageMode: () => 'cloud' });
    const p = runBackupImport(PAYLOAD, h.deps);
    h.deferred.resolve();
    await p;
    expect(h.importBackup).toHaveBeenCalledWith(PAYLOAD, 'replace', { mode: 'cloud' });
    expect(h.refreshers.every((r) => r.mock.calls.length === 1)).toBe(true);
  });

  test('unresolvable mode falls back to undefined (local contract), still refreshes', async () => {
    const h = harness({ getStorageMode: undefined });
    const p = runBackupImport(PAYLOAD, h.deps);
    h.deferred.resolve();
    await p;
    expect(h.importBackup).toHaveBeenCalledWith(PAYLOAD, 'replace', { mode: undefined });
    expect(h.calls).toEqual(['importBackup', 'weight', 'notes', 'recovery', 'settings']);
  });

  test.each([
    ['validation failure', { ok: false, error: 'Unsupported backup version.' }],
    ['write failure', { ok: false, error: 'Import failed: disk full' }],
    ['cancellation', { ok: false, cancelled: true }],
  ])('%s: returns the engine result untouched and refreshes nothing', async (_n, importResult) => {
    const h = harness({ importResult, getStorageMode: () => 'local' });
    const p = runBackupImport(PAYLOAD, h.deps);
    h.deferred.resolve();
    await expect(p).resolves.toBe(importResult);
    expect(h.calls).toEqual(['importBackup']);
  });

  test('rejected restore propagates the same error and refreshes nothing', async () => {
    const h = harness({ getStorageMode: () => 'cloud' });
    const boom = new Error('persist rejected');
    const p = runBackupImport(PAYLOAD, h.deps);
    h.deferred.reject(boom);
    await expect(p).rejects.toBe(boom);
    expect(h.calls).toEqual(['importBackup']);
  });

  test('a throwing refresher propagates and stops later refreshers (unchanged policy)', async () => {
    const h = harness({ getStorageMode: () => 'local' });
    h.refreshers[1].mockImplementation(() => { throw new Error('refresh boom'); });
    const p = runBackupImport(PAYLOAD, h.deps);
    h.deferred.resolve();
    await expect(p).rejects.toThrow('refresh boom');
    expect(h.refreshers[2]).not.toHaveBeenCalled();
    expect(h.refreshers[3]).not.toHaveBeenCalled();
  });

  test('re-entrant imports each run their own restore and refresh', async () => {
    const h = harness({ getStorageMode: () => 'local' });
    const first = runBackupImport(PAYLOAD, h.deps);
    const resolveFirst = h.deferred.resolve;
    const second = runBackupImport(PAYLOAD, h.deps);
    resolveFirst();
    h.deferred.resolve();
    await Promise.all([first, second]);
    expect(h.importBackup).toHaveBeenCalledTimes(2);
    expect(h.refreshers[3]).toHaveBeenCalledTimes(2);
  });
});

describe('App.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
  test('handleImport delegates to runBackupImport with the full refresh contract in order', () => {
    expect(src).toMatch(/runBackupImport\(payload, \{\s*importBackup,\s*getStorageMode,/);
    expect(src).toMatch(
      /refreshers: \[\s*weightHook\.refresh,\s*noteHook\.refresh,\s*reloadRecoveryBlocks,\s*reloadPersistedSettingsDomains,\s*\]/,
    );
  });
});
