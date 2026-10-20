// #1488: the shared Recovery snapshot signature must cover displayed CONTENT, not
// just ids/timestamps. A verified refresh publishes changed block reason,
// baseline, and week completion even when every timestamp is identical; an
// unchanged reload keeps the same snapshot identity; and content freshness on
// the filter path never grants mutation authority.

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

let mockBlocks = [];
let mockWeeks = [];
jest.mock('../storage/entries', () => ({
  loadRecoveryBlocks: jest.fn(async () => mockBlocks.filter(b => !b.deleted_at)),
  loadRecoveryBlockWeeks: jest.fn(async () => mockWeeks.filter(w => !w.deleted_at)),
  loadRecoveryBlocksRaw: jest.fn(async () => mockBlocks),
  loadRecoveryBlockWeeksRaw: jest.fn(async () => mockWeeks),
}));
jest.mock('../storage/entries/recoveryOperationJournal', () => ({
  RECOVERY_OPERATION_CODES: { RECONCILIATION_PENDING: 'RECONCILIATION_PENDING' },
  reconcileRecoveryOperations: jest.fn(async () => ({ pending: [], corrupt: false, error: null })),
}));
jest.mock('../storage/syncRecovery', () => ({
  SYNC_PHASE: { SYNC: 'sync' },
  SYNC_STATUS: { COMPLETE: 'complete' },
  subscribeSyncState: jest.fn(() => () => {}),
}));
jest.mock('../storage/entries/startupTiming', () => ({
  markStartupPhase: jest.fn(),
  recordStartupReconcileStart: jest.fn(),
  whenStartupBackgroundWorkReleased: jest.fn((task) => { task(); return () => {}; }),
}));
jest.mock('../hooks/entries/storageMode', () => ({}));

const store = require('../hooks/entries/recoveryReadState');

const TS = '2026-05-01T00:00:00Z';
const mkBlock = (over = {}) => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'PPL',
  baseline: { exercises: [{ name: 'Bench', weight: 100 }] }, reason: 'torn hamstring',
  started_at: TS, completed_at: null, include_in_normal_analytics: false,
  saved_at: TS, updated_at: TS, deleted_at: null, ...over,
});
const mkWeek = (over = {}) => ({
  id: 'rw1', block_id: 'rb1', note_id: 'w1', week_number: 1, completed_at: null,
  saved_at: TS, updated_at: TS, deleted_at: null, ...over,
});

let latest;
function Probe() {
  latest = store.useRecoveryBlockState();
  return null;
}
let renderer;
async function mount() {
  await act(async () => { renderer = TestRenderer.create(<Probe />); });
  await act(async () => { await store.refreshRecoveryState(); });
}
const refresh = () => act(async () => { await store.refreshRecoveryState(); });

beforeEach(() => {
  store._resetRecoveryAnalyticsFilterCache();
  mockBlocks = [mkBlock()];
  mockWeeks = [mkWeek()];
});
afterEach(() => {
  if (renderer) act(() => renderer.unmount());
  renderer = null;
  latest = null;
});

describe('authoritative snapshot content freshness', () => {
  const CHANGES = {
    'block reason': () => { mockBlocks = [mkBlock({ reason: 'new reason' })]; },
    'baseline content': () => {
      mockBlocks = [mkBlock({ baseline: { exercises: [{ name: 'Bench', weight: 120 }] } })];
    },
    'week completion': () => { mockWeeks = [mkWeek({ completed_at: '2026-05-09T00:00:00Z' })]; },
  };

  it.each(Object.keys(CHANGES))('publishes a changed %s under identical timestamps', async (name) => {
    await mount();
    expect(latest.ready).toBe(true);
    const before = latest.blocks;
    CHANGES[name]();
    await refresh();
    expect(latest.blocks).not.toBe(before);
    expect(latest.blocks[0].reason).toBe(mockBlocks[0].reason);
    expect(latest.blocks[0].baseline).toEqual(mockBlocks[0].baseline);
    expect(latest.weeks[0].completed_at).toBe(mockWeeks[0].completed_at);
    expect(latest.ready).toBe(true);
    expect(latest.mutationsAllowed).toBe(true);
  });

  it('keeps stable snapshot identity for a semantically unchanged read', async () => {
    await mount();
    const { blocks, weeks } = latest;
    const renders = jest.fn();
    const unsubscribe = (() => { store.addSnapshotSubscriber(renders); return () => store.removeSnapshotSubscriber(renders); })();
    mockBlocks = [mkBlock()];
    mockWeeks = [mkWeek()];
    await refresh();
    unsubscribe();
    expect(latest.blocks).toBe(blocks);
    expect(latest.weeks).toBe(weeks);
    expect(store.getFilterSnapshot().blocks).toBe(blocks);
  });

  it('keeps snapshot identity when only baseline key order differs', async () => {
    mockBlocks = [mkBlock({ baseline: { version: 2, exercises: [{ name: 'Bench', weight: 100 }] } })];
    await mount();
    const { blocks, weeks } = latest;
    mockBlocks = [mkBlock({ baseline: { exercises: [{ weight: 100, name: 'Bench' }], version: 2 } })];
    await refresh();
    expect(latest.blocks).toBe(blocks);
    expect(latest.weeks).toBe(weeks);
    const filter = store.getFilterSnapshot();
    await act(async () => { await store.runRecoveryFilterRead(); });
    expect(store.getFilterSnapshot()).toBe(filter);
  });

  it('refreshes the filter snapshot when the authoritative pass publishes new content', async () => {
    await mount();
    mockBlocks = [mkBlock({ reason: 'changed' })];
    await refresh();
    expect(store.getFilterSnapshot().blocks[0].reason).toBe('changed');
  });
});

describe('filter snapshot content freshness', () => {
  it('publishes changed content on a plain filter read without granting authority', async () => {
    // The authoritative pass fails, so nothing is ever verified.
    require('../storage/entries/recoveryOperationJournal').reconcileRecoveryOperations
      .mockRejectedValueOnce(new Error('journal unreadable'));
    await act(async () => { renderer = TestRenderer.create(<Probe />); });
    await act(async () => { await store.runRecoveryFilterRead(); });
    const first = store.getFilterSnapshot();
    expect(store.isRecoveryFilterVerified()).toBe(true);

    mockBlocks = [mkBlock({ reason: 'filter-fresh', baseline: { exercises: [] } })];
    mockWeeks = [mkWeek({ completed_at: '2026-05-09T00:00:00Z' })];
    await act(async () => { await store.runRecoveryFilterRead(); });
    const second = store.getFilterSnapshot();
    expect(second).not.toBe(first);
    expect(second.blocks[0].reason).toBe('filter-fresh');
    expect(second.weeks[0].completed_at).toBe('2026-05-09T00:00:00Z');
    // Content freshness is display-only: still unverified, mutations closed.
    expect(latest.ready).toBe(false);
    expect(latest.mutationsAllowed).toBe(false);
  });

  it('keeps the filter snapshot identity when an equal plain read repeats', async () => {
    await act(async () => { await store.runRecoveryFilterRead(); });
    const first = store.getFilterSnapshot();
    mockBlocks = [mkBlock()];
    await act(async () => { await store.runRecoveryFilterRead(); });
    expect(store.getFilterSnapshot()).toBe(first);
  });

  it('does not touch the verified authoritative snapshot', async () => {
    await mount();
    const verified = latest.blocks;
    mockBlocks = [mkBlock({ reason: 'filter-only' })];
    await act(async () => { await store.runRecoveryFilterRead(); });
    expect(store.getFilterSnapshot().blocks[0].reason).toBe('filter-only');
    expect(latest.blocks).toBe(verified);
    expect(latest.blocks[0].reason).toBe('torn hamstring');
  });
});
