import { installRendererCleanup } from './helpers/log-screen';
import render from 'react-test-renderer';

installRendererCleanup();

// Suite-local mocks: each behavior suite runs in its own Jest environment.
jest.mock('expo-updates', () => ({
  useUpdates: () => ({ currentlyRunning: { isEmbeddedLaunch: true } }),
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

// A real in-memory store rather than bare jest.fn()s: the durable recovery
// operation journal (#696) reads back what it wrote, so a mock that forgets
// every write would make every journaled operation look unverifiable.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map();
  return {
    __store: store,
    getItem: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItem: jest.fn(async (key, value) => { store.set(key, value); }),
    removeItem: jest.fn(async (key) => { store.delete(key); }),
    clear: jest.fn(async () => { store.clear(); }),
  };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return React.createElement(View, { testID: 'mock-datetimepicker', ...props });
  };
});

jest.mock('../components/LogEmptyState', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    LogEmptyState: function MockLogEmptyState() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/SessionCheckInModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SessionCheckInModal: function MockSessionCheckInModal() {
      return React.createElement(View);
    }
  };
});

jest.mock('../components/ScreenShell', () => {
  const React = require('react');
  const { View } = require('react-native');
  const ScreenShell = React.forwardRef(({ children, headerRight }, ref) => {
    return React.createElement(View, { testID: 'screen-shell' }, headerRight, children);
  });
  return {
    ScreenShell,
    ScrollContext: React.createContext({ onScroll: () => {} }),
  };
});

jest.mock('../hooks/useEntries');

// ── #716: one authoritative Recovery read-and-reconcile contract ─────────────

describe('authoritative Recovery state contract (#716)', () => {
  const hooks = require('../hooks/entries/recoveryBlockHooks');
  const recoveryStorageModule = require('../storage/entries/recoveryStorage');
  const journalModule = require('../storage/entries/recoveryOperationJournal');
  const AsyncStorage = require('@react-native-async-storage/async-storage');
  const { RECOVERY_BLOCKS_KEY, RECOVERY_BLOCK_WEEKS_KEY } = require('../storage/entries/keys');

  const block = {
    id: 'rb716', baseline_note_id: 'baseline', baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] }, include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z', completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };
  const week = {
    id: 'rw716', block_id: 'rb716', note_id: 'recoverynote', week_number: 1,
    completed_at: null, deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z', updated_at: '2026-05-01T00:00:00.000Z',
  };

  const mounted = [];
  const seen = [];

  function Probe({ bucket }) {
    bucket.push(hooks.useRecoveryBlockState());
    return null;
  }
  const latestOf = (bucket) => bucket[bucket.length - 1];
  const latest = () => latestOf(seen);

  const mountProbe = async (bucket = seen) => {
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={bucket} />));
    });
  };

  const seedRecords = async (blocks, weeks) => {
    await AsyncStorage.setItem(RECOVERY_BLOCKS_KEY, JSON.stringify(blocks));
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify(weeks));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    AsyncStorage.__store.clear();
    seen.length = 0;
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  afterEach(async () => {
    await render.act(async () => { mounted.forEach(c => c.unmount()); });
    mounted.length = 0;
    jest.restoreAllMocks();
    hooks._resetRecoveryAnalyticsFilterCache();
  });

  test('a successful cold load reports ready, allows mutations, and is not stale', async () => {
    await seedRecords([block], [week]);
    await mountProbe();

    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
    expect(latest().ready).toBe(true);
    expect(latest().loading).toBe(false);
    expect(latest().stale).toBe(false);
    expect(latest().error).toBe(null);
    expect(latest().mutationsAllowed).toBe(true);
    expect(latest().activeBlock.id).toBe('rb716');
  });

  test('a terminal first-load failure is an error state, never a verified-empty one', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('recovery key unreadable'));
    await mountProbe();

    // The arrays are empty, but nothing may treat that as "no recovery blocks":
    // `ready` is what separates a verified empty result from an unknown one.
    expect(latest().blocks).toEqual([]);
    expect(latest().ready).toBe(false);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.ERROR);
    expect(latest().error).toBeTruthy();
    // A terminal failure is distinguishable from initial progress: it is not
    // loading, so the UI shows a retry path instead of an endless spinner.
    expect(latest().loading).toBe(false);
    expect(latest().refreshing).toBe(false);
    expect(latest().mutationsAllowed).toBe(false);
  });

  test('retry after a terminal first-load failure reaches the verified state', async () => {
    const loadSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValueOnce(new Error('recovery key unreadable'));
    await mountProbe();
    expect(latest().ready).toBe(false);

    await seedRecords([block], [week]);
    loadSpy.mockRestore();
    await render.act(async () => { await latest().retryRecovery(); });

    expect(latest().ready).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
    expect(latest().error).toBe(null);
    expect(latest().activeBlock.id).toBe('rb716');
  });

  test('a refresh failure keeps last-known-good data visible and marks it stale', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    const goodBlocks = latest().blocks;
    expect(latest().ready).toBe(true);

    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('transient read failure'));
    await render.act(async () => { await latest().refresh(); });

    // Last-known-good survives the failure, identity included, and is labelled.
    expect(latest().blocks).toBe(goodBlocks);
    expect(latest().activeBlock.id).toBe('rb716');
    expect(latest().ready).toBe(true);
    expect(latest().stale).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().staleError).toBeTruthy();
    // A stale snapshot is still verified persisted state, so it is not an
    // unverified read and does not have to freeze mutations.
    expect(latest().mutationsAllowed).toBe(true);
  });

  test('two simultaneously mounted consumers share exactly one reconciliation pass, not a coalesced follow-up', async () => {
    await seedRecords([block], [week]);

    let readCount = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const real = recoveryStorageModule.loadRecoveryBlocks;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        return await real();
      } finally {
        concurrent -= 1;
      }
    });

    const logBucket = [];
    const analyticsBucket = [];
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });

    expect(maxConcurrent).toBe(1);
    // Not merely "never concurrent" — genuinely ONE shared pass. The second
    // mount, joining the subscriber base while the first mount's pass is
    // already in flight, must NOT trigger its own coalesced follow-up read;
    // it subscribes to the SAME pass instead (#711 review finding 3, round 2).
    expect(readCount).toBe(1);
    // Not merely equal — the SAME published object, which is what makes
    // divergent reconciliation results structurally impossible.
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
    expect(latestOf(logBucket).weeks).toBe(latestOf(analyticsBucket).weeks);
    expect(latestOf(logBucket).ready).toBe(latestOf(analyticsBucket).ready);
    expect(latestOf(logBucket).status).toBe(latestOf(analyticsBucket).status);
  });

  // #711 review finding 3 (round 2): the earlier fix only deduplicated the
  // MOUNT-time read. Every mounted `useRecoveryBlockState` instance still
  // registered its own `recoveryListeners` entry and its own sync-completion
  // subscription, so a LATER automatic signal (a mutation/import
  // notification, a completed cloud sync) still invoked one
  // `refreshRecoveryState()` call per mounted consumer — and since that
  // function guarantees a fresh follow-up pass for any caller arriving while
  // one is in flight, two consumers on the same later signal still produced
  // two full passes. These tests mount Log+Analytics FIRST (past the initial
  // mount-time read), then fire a signal, and prove exactly one read results.
  test('a post-mount recovery notification triggers exactly one shared pass across two mounted consumers', async () => {
    await seedRecords([block], [week]);

    const logBucket = [];
    const analyticsBucket = [];
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });
    expect(latestOf(logBucket).ready).toBe(true);

    let readCount = 0;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      return [block];
    });

    // `reloadRecoveryBlocks` fires the same private `recoveryListeners`
    // notification a local recovery mutation or a restored backup would.
    await render.act(async () => { hooks.reloadRecoveryBlocks(); });

    expect(readCount).toBe(1);
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
  });

  test('a post-mount cloud-sync completion triggers exactly one shared pass, and only one sync subscription is registered', async () => {
    await seedRecords([block], [week]);
    const syncRecoveryModule = require('../storage/syncRecovery');

    let subscribeCallCount = 0;
    const syncListeners = [];
    const subscribeSpy = jest.spyOn(syncRecoveryModule, 'subscribeSyncState').mockImplementation((listener) => {
      subscribeCallCount += 1;
      syncListeners.push(listener);
      return () => {};
    });

    const logBucket = [];
    const analyticsBucket = [];
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });

    // Exactly one subscription for two simultaneously mounted consumers.
    expect(subscribeCallCount).toBe(1);
    expect(syncListeners.length).toBe(1);

    let readCount = 0;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      return [block];
    });

    await render.act(async () => {
      syncListeners[0]({ [syncRecoveryModule.SYNC_PHASE.SYNC]: { status: syncRecoveryModule.SYNC_STATUS.COMPLETE } });
    });

    expect(readCount).toBe(1);
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
    subscribeSpy.mockRestore();
  });

  test('after the shared subscription owner unmounts, a remaining consumer keeps working and a later solo mount resubscribes', async () => {
    await seedRecords([block], [week]);

    const logBucket = [];
    const analyticsBucket = [];
    let logComponent;
    await render.act(async () => {
      logComponent = render.create(<Probe bucket={logBucket} />);
      mounted.push(logComponent);
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
    });
    expect(latestOf(analyticsBucket).ready).toBe(true);

    // Unmount the FIRST-mounted (subscription-owning) consumer while the
    // second is still mounted. The shared subscription must transfer, not
    // disappear — the surviving consumer still reacts to later signals.
    await render.act(async () => { logComponent.unmount(); });
    mounted.splice(mounted.indexOf(logComponent), 1);

    let readCount = 0;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      return [block];
    });
    await render.act(async () => { hooks.reloadRecoveryBlocks(); });
    expect(readCount).toBe(1);
    expect(latestOf(analyticsBucket).blocks[0]).toBeTruthy();
  });

  // #711 review finding 1 (round 3): round 2's fix bound `verified` onto a
  // SINGLE shared snapshot object, which closed the trust leak but destroyed
  // last-known-good retention — a later, less-trusted filter read publishing
  // DIFFERENT content replaced the very record `useRecoveryBlockState`
  // rendered, so Log immediately stopped showing previously-verified data
  // (and a subsequent refresh failure then mis-resolved to terminal ERROR
  // instead of STALE, because it saw that replacement as "never verified").
  // The structural fix is TWO independent snapshots — `useRecoveryBlockState`
  // and `useRecoveryAnalyticsFilter` each read their own module-level record,
  // and a filter-only publish can never touch the one Log renders.
  test('a later unreconciled filter read that returns DIFFERENT records updates the filter, but never touches what Log renders or its mutation trust', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
    const verifiedBlocks = latest().blocks;

    // Different content from what was authoritatively verified — e.g. another
    // device's write landed between the authoritative read and this one.
    const changedBlock = { ...block, updated_at: '2026-05-02T00:00:00.000Z' };
    await seedRecords([changedBlock], [week]);

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });

    // The filter itself picks up the new data — a raw read is adequate
    // evidence for its own exclusion-boundary purpose, and it is free to move
    // forward on unreconciled data because it never authorizes a mutation.
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
    // But `useRecoveryBlockState` — the authoritative, mutation-gating
    // consumer — must keep rendering the LAST-KNOWN-GOOD verified data
    // (same object, even), completely unaffected by the filter's read. This
    // is the last-known-good retention issue #716 locks in: it must never be
    // silently evicted by an unrelated, less-trusted read.
    expect(latest().blocks).toBe(verifiedBlocks);
    expect(latest().blocks[0].updated_at).toBe('2026-05-01T00:00:00.000Z');
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
  });

  // The reviewer's specifically requested regression: a refresh FAILURE after
  // a filter publish must still degrade to STALE with the previously-verified
  // data visible — never to terminal ERROR. Round 2's shared-object design
  // broke exactly this, because the filter publish had already overwritten
  // the "was anything ever verified" record the failure path checks.
  test('a refresh failure after an intervening filter publish still degrades to STALE with the previously-verified data visible, never ERROR', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    const verifiedBlocks = latest().blocks;
    const verifiedWeeks = latest().weeks;

    // An unrelated filter mount reads (possibly different) unreconciled data
    // in between — this must not affect what the failure path below sees.
    const changedBlock = { ...block, updated_at: '2026-05-02T00:00:00.000Z' };
    await seedRecords([changedBlock], [week]);
    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);

    // Now the NEXT authoritative refresh genuinely fails.
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('transient read failure'));
    await render.act(async () => { await latest().refresh(); });

    // STALE, not ERROR — and the data on screen is still the last GENUINELY
    // verified snapshot, not the filter's unreconciled one and not an empty
    // placeholder.
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().error).toBe(null);
    expect(latest().staleError).toBeTruthy();
    expect(latest().blocks).toBe(verifiedBlocks);
    expect(latest().weeks).toBe(verifiedWeeks);
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
  });

  test('a later unreconciled filter read that returns the SAME records does not affect the already-verified consumer', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });

    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
    // Identical content, and this is the steady-state case (Log and Analytics
    // both mounted, nothing changed) — Log must not flicker unready.
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);
  });

  // #711 review finding 2 (round 2): the earlier fix added a gate call before
  // note creation in LogScreen, but `startBlock` ran its OWN second gate
  // afterward — so a gate failure discovered on that second call still
  // arrived after the note had already been persisted. The fix folds note
  // creation inside `useStartRecoveryBlock.startBlock` itself, behind exactly
  // one gate, so there is no second decision point left to bypass. These
  // tests exercise the REAL hook end-to-end (not LogScreen's mocked
  // `startBlock`) to prove that.
  describe('useStartRecoveryBlock: the gate precedes the new-note write, not just the block write', () => {
    test('an unverified read gate rejects before the Week-1 note is ever created', async () => {
      jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
        .mockRejectedValue(new Error('recovery key unreadable'));
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'shouldNeverExist' });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote,
        });
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('RECOVERY_STATE_UNVERIFIED');
      expect(createWeekNote).not.toHaveBeenCalled();
    });

    test('a corrupt journal discovered by the gate rejects before the Week-1 note is ever created', async () => {
      const corruptResult = {
        ok: false, code: 'JOURNAL_CORRUPT', corrupt: true, pending: [], cancelled: [], results: [],
        error: 'Recovery operations could not be read from this device. Recovery actions are paused until this is retried.',
        cause: null,
      };
      const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations').mockResolvedValue(corruptResult);
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'shouldNeverExist' });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote,
        });
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe('RECOVERY_JOURNAL_CORRUPT');
      expect(createWeekNote).not.toHaveBeenCalled();
      reconcileSpy.mockRestore();
    });

    test('a passing gate creates the note exactly once, then starts the block with its id', async () => {
      await seedRecords([], []);
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'newnote-x' });
      const createSpy = jest.spyOn(recoveryStorageModule, 'createRecoveryBlock').mockResolvedValue({ id: 'rbX' });
      const addWeekSpy = jest.spyOn(recoveryStorageModule, 'addRecoveryWeek')
        .mockResolvedValue({ id: 'rwX', block_id: 'rbX', note_id: 'newnote-x', week_number: 1 });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote,
        });
      });

      expect(createWeekNote).toHaveBeenCalledTimes(1);
      expect(result.ok).toBe(true);
      expect(addWeekSpy).toHaveBeenCalledWith({ blockId: 'rbX', noteId: 'newnote-x' });
      createSpy.mockRestore();
      addWeekSpy.mockRestore();
    });

    test('a note created under a passing gate is rolled back if the block/week write then fails', async () => {
      await seedRecords([], []);
      const createWeekNote = jest.fn().mockResolvedValue({ id: 'newnote-y' });
      const removeWeekNote = jest.fn().mockResolvedValue(undefined);
      const createSpy = jest.spyOn(recoveryStorageModule, 'createRecoveryBlock').mockResolvedValue({ id: 'rbY' });
      const addWeekSpy = jest.spyOn(recoveryStorageModule, 'addRecoveryWeek')
        .mockRejectedValue(Object.assign(new Error('Week-1 write failed'), { code: 'WEEK_WRITE_FAILED' }));
      const deleteSpy = jest.spyOn(recoveryStorageModule, 'deleteRecoveryBlock').mockResolvedValue({ id: 'rbY' });

      const startSeen = [];
      function StartProbe() {
        startSeen.push(hooks.useStartRecoveryBlock());
        return null;
      }
      await render.act(async () => { mounted.push(render.create(<StartProbe />)); });

      let result;
      await render.act(async () => {
        result = await startSeen[startSeen.length - 1].startBlock({
          baselineNoteId: 'baseline', baselineNoteTitle: 'Push Day', baselineNoteText: '',
          weekNoteId: null, createWeekNote, removeWeekNote,
        });
      });

      expect(result.ok).toBe(false);
      expect(deleteSpy).toHaveBeenCalledWith('rbY');
      // The orphaned note this call itself created is rolled back too — not
      // just the orphaned block.
      expect(removeWeekNote).toHaveBeenCalledWith('newnote-y');
      createSpy.mockRestore();
      addWeekSpy.mockRestore();
      deleteSpy.mockRestore();
    });
  });

  test('a mutation is rejected at confirm time while state is unverified', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('recovery key unreadable'));
    const weeksForBlockSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryWeeksForBlock');

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_STATE_UNVERIFIED');
    // Refused before any domain read or write: the mutation never decided
    // anything against the unverified placeholder snapshot.
    expect(weeksForBlockSpy).not.toHaveBeenCalled();
  });

  test('the confirm-time recheck re-establishes verified state and then allows the mutation', async () => {
    const loadSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValueOnce(new Error('recovery key unreadable'));

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    await mountProbe();
    expect(latest().ready).toBe(false);

    // The storage failure clears while the confirmation dialog is open.
    await seedRecords([block], [week]);
    loadSpy.mockRestore();

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    expect(result.ok).toBe(true);
    expect(result.week.id).toBe('rw716');
    expect(latest().ready).toBe(true);
  });

  // #711 review finding (round 4): the confirm-time gate must require SUCCESS
  // FROM THE EXACT AUTHORITATIVE PASS IT AWAITED, not merely "a prior
  // snapshot exists and display status isn't ERROR". Round 3 correctly made a
  // confirm-time read failure over an already-verified snapshot degrade
  // DISPLAY to STALE-with-last-known-good rather than ERROR — but
  // `ensureVerifiedRecoveryState` then read that same STALE status back and
  // treated "not ERROR" as "safe to mutate", which is wrong: STALE means the
  // recheck this call just awaited FAILED. These three tests are the ones the
  // reviewer specifically requested.
  test('a transient confirm-time read failure over an already-verified snapshot: display goes STALE with last-known-good, but the mutation is rejected', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    const verifiedBlocks = latest().blocks;

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });

    // The confirm-time recheck's own read fails — a transient error, not a
    // corrupt journal.
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValue(new Error('transient confirm-time read failure'));
    const weeksForBlockSpy = jest.spyOn(recoveryStorageModule, 'loadRecoveryWeeksForBlock');

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    // Display: STALE, with the last-known-good data still visible — this is
    // finding 1 of the prior round and must not regress.
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().blocks).toBe(verifiedBlocks);
    expect(latest().ready).toBe(true);
    // The mutation itself: rejected. THIS recheck failed, so the domain write
    // never proceeds — the storage layer's own week-lookup was never reached.
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_STATE_UNVERIFIED');
    expect(weeksForBlockSpy).not.toHaveBeenCalled();
  });

  test('a reconciliation that resolves ok:false with pending operations rejects the mutation even though display is READY', async () => {
    await seedRecords([block], [week]);

    const pendingRecord = {
      id: 'op-pending-1', type: 'ADD_WEEK_WITH_NEW_NOTE', block_id: 'rb716',
      status: 'pending', code: 'RECONCILIATION_PENDING',
    };
    const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations').mockResolvedValue({
      ok: false,
      code: 'RECONCILIATION_PENDING',
      corrupt: false,
      pending: [pendingRecord],
      cancelled: [],
      results: [pendingRecord],
      error: null,
      cause: null,
    });

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    await mountProbe();

    // Display: READY (the read itself succeeded, nothing is corrupt) — this
    // is deliberate and must not regress: a pending operation is surfaced via
    // `pendingRecovery`, not by refusing to render.
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.READY);
    expect(latest().ready).toBe(true);
    expect(latest().pendingRecovery).toEqual([pendingRecord]);

    // But the confirm-time gate must reject: THIS pass's own reconciliation
    // outcome was ok:false with a non-zero pending count, regardless of the
    // READY display status.
    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECONCILIATION_PENDING');

    reconcileSpy.mockRestore();
  });

  test('the happy path still succeeds: a clean read with no pending operations allows the mutation', async () => {
    await seedRecords([block], [week]);

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });

    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });

    expect(result.ok).toBe(true);
    expect(result.week.id).toBe('rw716');
  });

  // #711 review finding 2: a corrupt operation journal must never resolve like
  // an ordinary reconciliation with nothing pending. It must block mutations
  // even when a previously-verified snapshot keeps the read-only view "stale"
  // rather than "error".
  test('a corrupt journal read blocks mutations, whether or not a snapshot was previously verified', async () => {
    const corruptResult = {
      ok: false,
      code: 'JOURNAL_CORRUPT',
      corrupt: true,
      pending: [],
      cancelled: [],
      results: [],
      error: 'Recovery operations could not be read from this device. Recovery actions are paused until this is retried.',
      cause: null,
    };
    const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations')
      .mockResolvedValue(corruptResult);

    // Case 1: nothing was ever verified. A corrupt journal is a terminal
    // error, not a verified-empty result.
    await mountProbe();
    expect(latest().ready).toBe(false);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.ERROR);
    expect(latest().mutationsAllowed).toBe(false);

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_JOURNAL_CORRUPT');

    reconcileSpy.mockRestore();
  });

  test('a corrupt journal read on a previously-verified snapshot goes stale AND stays mutation-blocked', async () => {
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);
    expect(latest().mutationsAllowed).toBe(true);

    const corruptResult = {
      ok: false, code: 'JOURNAL_CORRUPT', corrupt: true, pending: [], cancelled: [], results: [],
      error: 'Recovery operations could not be read from this device. Recovery actions are paused until this is retried.',
      cause: null,
    };
    const reconcileSpy = jest.spyOn(journalModule, 'reconcileRecoveryOperations')
      .mockResolvedValue(corruptResult);
    await render.act(async () => { await latest().refresh(); });

    // Last-known-good data still renders (stale), but — unlike an ordinary
    // transient read failure — mutations must stay blocked, because the
    // journal contract itself says recovery actions are paused while it is
    // unreadable.
    expect(latest().ready).toBe(true);
    expect(latest().stale).toBe(true);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.STALE);
    expect(latest().mutationsAllowed).toBe(false);

    const lifecycleSeen = [];
    function LifecycleProbe() {
      lifecycleSeen.push(hooks.useRecoveryBlockLifecycle());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<LifecycleProbe />)); });
    let result;
    await render.act(async () => {
      result = await lifecycleSeen[lifecycleSeen.length - 1].completeCurrentWeek({ blockId: 'rb716' });
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RECOVERY_JOURNAL_CORRUPT');

    reconcileSpy.mockRestore();
  });

  // #711 review finding 1: an ordinary (unreconciled) filter read must never
  // be able to establish the mutation-authorizing verified state.
  // `useRecoveryAnalyticsFilter` reads records directly, without running the
  // journal reconciliation `useRecoveryBlockState` always runs first.
  test('a plain analytics filter read never establishes the mutation-verified state for a not-yet-reconciled consumer', async () => {
    await seedRecords([block], [week]);

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    // The filter itself becomes ready (it read real records)...
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);

    // ...now mount an authoritative consumer whose OWN read is held open. If
    // the filter's raw read had (incorrectly) set the shared mutation-verified
    // bit, this consumer would report `ready`/`mutationsAllowed` true
    // immediately, without ever completing its own reconcile-then-read pass.
    let releaseRead;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(
      () => new Promise((resolve) => { releaseRead = () => resolve([block]); })
    );
    await mountProbe();

    expect(latest().ready).toBe(false);
    expect(latest().loading).toBe(true);
    expect(latest().mutationsAllowed).toBe(false);

    await render.act(async () => { releaseRead(); await Promise.resolve(); });
  });

  test('a plain analytics filter success does not paper over a real authoritative read failure', async () => {
    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    // The filter succeeds first — an empty snapshot is a legitimate empty
    // read for the filter boundary.
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);

    // The authoritative pass then genuinely fails. If the two verified flags
    // were still one shared bit, the filter's earlier success would leak into
    // this consumer and hide the failure.
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockRejectedValue(new Error('boom'));
    await mountProbe();

    expect(latest().ready).toBe(false);
    expect(latest().status).toBe(hooks.RECOVERY_STATUS.ERROR);
    expect(latest().mutationsAllowed).toBe(false);
  });

  // #711 review finding 3 (round 2): `publishRecoverySnapshot` used to notify
  // subscribers BEFORE `recoveryFilterVerified` was set true, so a
  // `useRecoveryAnalyticsFilter` that was stuck unverified after a cold
  // failure and then observed a successful authoritative read (triggered
  // elsewhere — e.g. Log's `Retry recovery`) would snapshot the new DATA in
  // that notification while still reading the OLD, unverified boundary flag,
  // and get no second notification to correct it. Reproduces exactly that
  // sequence: filter fails first, stays unverified; a later independent
  // authoritative read (not the filter's own) then succeeds; the filter must
  // end up ready in that SAME notification, not stuck loading forever.
  test('a successful authoritative read unblocks an already-unverified filter subscriber in the very same notification', async () => {
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks')
      .mockRejectedValueOnce(new Error('cold start failure'));

    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => { mounted.push(render.create(<FilterProbe />)); });
    // The filter's own read failed and nothing was ever verified — it must
    // report itself unready, not silently admit recovery work.
    expect(filterSeen[filterSeen.length - 1].ready).toBe(false);

    // Storage recovers, and a SEPARATE authoritative read succeeds (mirrors
    // Log mounting, or the user pressing "Retry recovery" — never the
    // filter's own retry loop).
    await seedRecords([block], [week]);
    await mountProbe();
    expect(latest().ready).toBe(true);

    // The filter subscriber must already be unblocked from that same publish
    // — not left waiting on its own bounded retry timer.
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
  });

  // #711 review finding 4: strengthen the existing max-concurrency assertion
  // to prove a single shared reconciliation pass — not merely that two
  // `useRecoveryBlockState` consumers never run concurrently, but that a
  // simultaneously-mounted `useRecoveryAnalyticsFilter` reuses that same pass
  // instead of issuing its own separate read.
  test('Log, Analytics, and the analytics filter share exactly one storage read on cold mount', async () => {
    await seedRecords([block], [week]);

    let readCount = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    const real = recoveryStorageModule.loadRecoveryBlocks;
    jest.spyOn(recoveryStorageModule, 'loadRecoveryBlocks').mockImplementation(async () => {
      readCount += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        return await real();
      } finally {
        concurrent -= 1;
      }
    });

    const logBucket = [];
    const analyticsBucket = [];
    const filterSeen = [];
    function FilterProbe() {
      filterSeen.push(hooks.useRecoveryAnalyticsFilter());
      return null;
    }
    await render.act(async () => {
      mounted.push(render.create(<Probe bucket={logBucket} />));
      mounted.push(render.create(<Probe bucket={analyticsBucket} />));
      mounted.push(render.create(<FilterProbe />));
    });

    expect(maxConcurrent).toBe(1);
    // All three mounted consumers — two `useRecoveryBlockState` instances
    // (Log, Analytics) plus the analytics filter — share exactly ONE storage
    // read. Neither the second `useRecoveryBlockState` mount nor the filter
    // mount triggers its own separate pass (#711 review finding 3, round 2;
    // finding 4's filter-piggyback still holds on top of that).
    expect(readCount).toBe(1);
    expect(latestOf(logBucket).blocks).toBe(latestOf(analyticsBucket).blocks);
    expect(filterSeen[filterSeen.length - 1].ready).toBe(true);
  });
});

// ── #716: the Log Recovery section never renders unverified state as empty ───

describe('LogRecoverySection — authoritative Recovery state (#716)', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');
  const {
    RECOVERY_STALE_MESSAGE,
    RECOVERY_UNVERIFIED_MESSAGE,
  } = require('../hooks/entries/recoveryBlockHooks');

  const activeBlock = {
    id: 'rbActive716',
    baseline_note_id: 'baseline716',
    baseline_note_title: 'Push Day',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: false,
    started_at: '2026-05-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    saved_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  };
  const activeWeek = {
    id: 'rw716', block_id: 'rbActive716', note_id: 'weeknote716', week_number: 1,
    completed_at: null, deleted_at: null,
  };

  const renderSection = async (props) => {
    let component;
    await render.act(async () => {
      component = render.create(<LogRecoverySection notes={[]} {...props} />);
    });
    return component;
  };

  // Flattens array children too: the baseline is now an interpolated caption
  // (`Baseline: {title}`), which renders as a children array, not one string.
  const texts = (component) =>
    component.root.findAll(n => typeof n.type === 'string' && n.props.children)
      .map(n => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
      .filter(c => typeof c === 'string');

  const retryButton = (component) =>
    component.root.findAll(n => n.props && n.props.accessibilityLabel === 'Retry recovery' && n.props.onPress)[0];

  test('a cold load stays visually neutral and renders nothing (no Recovery card flash)', async () => {
    // #724: a first read in flight must not flash a Recovery card for a
    // non-adopter, so the section renders nothing until the read verifies or
    // terminally fails.
    const component = await renderSection({ stateReady: false, stateLoading: true });
    expect(component.toJSON()).toBeNull();
    expect(retryButton(component)).toBeUndefined();
  });

  test('a terminal first-load failure renders the unknown state with the Retry recovery control', async () => {
    const onRetryRecovery = jest.fn();
    const component = await renderSection({
      stateReady: false,
      stateError: new Error('unreadable'),
      onRetryRecovery,
    });

    expect(texts(component)).toContain(RECOVERY_UNVERIFIED_MESSAGE);
    const button = retryButton(component);
    expect(button).toBeTruthy();
    // ui-design-rules §12: the copy names the control by its exact accessible
    // name, so a screen-reader user searching for it finds it.
    expect(RECOVERY_UNVERIFIED_MESSAGE).toContain('Retry recovery');
    await render.act(async () => { await button.props.onPress(); });
    expect(onRetryRecovery).toHaveBeenCalledTimes(1);
  });

  test('a refresh failure keeps the active block visible and marks it stale', async () => {
    const component = await renderSection({
      blocks: [activeBlock],
      weeks: [activeWeek],
      stateStale: true,
      onRetryRecovery: jest.fn(),
    });

    const rendered = texts(component);
    expect(rendered).toContain('Baseline: Push Day');
    expect(rendered).toContain(RECOVERY_STALE_MESSAGE);
    expect(retryButton(component)).toBeTruthy();
  });

  test('unverified state disables every lifecycle control', async () => {
    const component = await renderSection({
      blocks: [activeBlock],
      weeks: [activeWeek],
      mutationsAllowed: false,
      onCompleteWeek: jest.fn(),
      onOpenAddWeek: jest.fn(),
      onCompleteBlock: jest.fn(),
      onUnlinkWeek: jest.fn(),
    });

    const controls = component.root.findAll(
      // Composite Pressables only: React Native's own host View mirrors an
      // accessibilityState with an undefined `disabled`, which is noise here.
      n => typeof n.type !== 'string'
        && n.props && n.props.accessibilityRole === 'button'
        && n.props.accessibilityState
        && typeof n.props.accessibilityState.disabled === 'boolean'
        && n.props.accessibilityLabel !== 'Retry recovery'
    );
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.props.accessibilityState.disabled).toBe(true);
    }
  });

  test('a verified snapshot with nothing to show still renders nothing', async () => {
    const component = await renderSection({ stateReady: true });
    expect(component.toJSON()).toBeNull();
  });
});
