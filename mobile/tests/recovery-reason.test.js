// The optional "why this recovery block started" reason (#872).
//
// One nullable free-text field, and the whole risk is that it crosses every
// layer at once: the local record, the Kilo-owned Postgres column, the cloud
// push whitelist and bootstrap projection, the backup/export contract, and two
// completed-history surfaces. So the tests below follow the field rather than
// the module — normalization, then persistence, then every projection that
// could silently drop it, then the surfaces that show it — and each one also
// pins the negative: nothing else about a block moves when the reason does.
//
// The three states that must stay indistinguishable from one another wherever
// it matters: a block created without a reason, a block whose reason was
// cleared, and a LEGACY block written by a build that had no such field.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MAX_RECOVERY_REASON_LENGTH,
  buildRecoveryBlock,
  normalizeRecoveryReason,
} from '../lib/data/recoveryBlocks';
import {
  RECOVERY_BLOCKS_KEY,
  RECOVERY_BLOCK_WEEKS_KEY,
  WORKOUT_NOTES_KEY,
} from '../storage/entries/keys';
import {
  completeRecoveryBlock,
  createRecoveryBlock,
  deleteRecoveryBlock,
  loadRecoveryBlocksRaw,
  replaceRecoveryBlocksRaw,
  updateRecoveryBlock,
} from '../storage/entries/recoveryStorage';
import {
  setRecoveryBlockReasonCore,
  startRecoveryBlockCore,
} from '../hooks/entries/recoveryBlockHooks';
import { exportBackup, importBackup } from '../storage/entries/backupImport';
import { buildBootstrapPlan } from '../storage/cloud/bootstrapPlan';
import { createSupabaseTransport } from '../storage/cloud/transport';
import { SYNC_TABLES } from '../storage/syncQueue';

beforeEach(async () => {
  await AsyncStorage.clear();
});

// A block exactly as a build that predates #872 wrote it: no `reason` key at
// all, not even a null one.
function legacyBlock(overrides = {}) {
  return {
    id: 'rb-legacy',
    baseline_note_id: 'wn-1',
    baseline_note_title: 'Legs Day',
    baseline: { version: 1, exercises: [] },
    include_in_normal_analytics: false,
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    saved_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

// ── normalization ─────────────────────────────────────────────────────────────

describe('normalizeRecoveryReason: one canonical stored form', () => {
  test('anything that is not a string is no reason at all', () => {
    for (const value of [null, undefined, 0, 42, true, {}, [], NaN]) {
      expect(normalizeRecoveryReason(value)).toBeNull();
    }
  });

  test('blank input is null, never an empty-string reason', () => {
    // `null` is the ONE stored absence: a record that claimed `reason: ''`
    // would be a fourth state that every reader would then have to know about.
    expect(normalizeRecoveryReason('')).toBeNull();
    expect(normalizeRecoveryReason('   ')).toBeNull();
    expect(normalizeRecoveryReason('\n\t  \n')).toBeNull();
  });

  test('surrounding and internal whitespace collapses so the field stays one line', () => {
    expect(normalizeRecoveryReason('  torn hamstring  ')).toBe('torn hamstring');
    expect(normalizeRecoveryReason('torn\nhamstring')).toBe('torn hamstring');
    expect(normalizeRecoveryReason('torn   \t  hamstring')).toBe('torn hamstring');
  });

  test('a reason is capped rather than rejected, and a reason at the cap survives whole', () => {
    const atCap = 'r'.repeat(MAX_RECOVERY_REASON_LENGTH);
    expect(normalizeRecoveryReason(atCap)).toBe(atCap);
    expect(normalizeRecoveryReason('r'.repeat(MAX_RECOVERY_REASON_LENGTH + 50)))
      .toHaveLength(MAX_RECOVERY_REASON_LENGTH);
  });

  test('normalization is idempotent, so a round trip never drifts', () => {
    const once = normalizeRecoveryReason('  came   back\nfrom surgery ');
    expect(normalizeRecoveryReason(once)).toBe(once);
  });
});

describe('buildRecoveryBlock: the reason is a record field like any other', () => {
  test('a block built with no reason still carries the key, holding null', () => {
    const block = buildRecoveryBlock({ baselineNoteId: 'wn-1' });
    expect(block).toHaveProperty('reason', null);
  });

  test('a supplied reason is normalized at build time, not trusted verbatim', () => {
    const block = buildRecoveryBlock({ baselineNoteId: 'wn-1', reason: '  knee\nsprain ' });
    expect(block.reason).toBe('knee sprain');
  });

  test('the reason changes no other field of the record', () => {
    const withReason = buildRecoveryBlock({
      baselineNoteId: 'wn-1', reason: 'knee', now: '2026-01-01T00:00:00.000Z',
    });
    const without = buildRecoveryBlock({
      baselineNoteId: 'wn-1', now: '2026-01-01T00:00:00.000Z',
    });
    const { id: _a, reason: _b, ...restWith } = withReason;
    const { id: _c, reason: _d, ...restWithout } = without;
    expect(restWith).toEqual(restWithout);
  });
});

// ── local persistence ─────────────────────────────────────────────────────────

describe('createRecoveryBlock: with, without, and with an empty reason', () => {
  test('a reason given at creation is stored normalized', async () => {
    const block = await createRecoveryBlock({
      baselineNoteId: 'wn-1', baselineNoteText: '', reason: '  torn hamstring ',
    });
    expect(block.reason).toBe('torn hamstring');
    expect((await loadRecoveryBlocksRaw())[0].reason).toBe('torn hamstring');
  });

  test('a block created with no reason is a perfectly ordinary block', async () => {
    const block = await createRecoveryBlock({ baselineNoteId: 'wn-1', baselineNoteText: '' });
    expect(block.reason).toBeNull();
    expect(block.completed_at).toBeNull();
    expect(block.baseline).toEqual({ version: 1, exercises: [] });
  });

  test('an empty reason creates a block with none, not one claiming a blank one', async () => {
    const block = await createRecoveryBlock({
      baselineNoteId: 'wn-1', baselineNoteText: '', reason: '   ',
    });
    expect(block.reason).toBeNull();
  });
});

describe('updateRecoveryBlock: editing the reason changes nothing else', () => {
  async function seedBlock(reason = null) {
    return createRecoveryBlock({ baselineNoteId: 'wn-1', baselineNoteText: '', reason });
  }

  test('a reason can be added, rewritten, and cleared', async () => {
    const created = await seedBlock();
    const added = await updateRecoveryBlock(created.id, { reason: 'torn hamstring' });
    expect(added.reason).toBe('torn hamstring');

    const rewritten = await updateRecoveryBlock(created.id, { reason: 'hamstring tear, grade 2' });
    expect(rewritten.reason).toBe('hamstring tear, grade 2');

    // Clearing is an ordinary save of empty text, and lands on the same `null`
    // a block created without a reason holds.
    const cleared = await updateRecoveryBlock(created.id, { reason: '  ' });
    expect(cleared.reason).toBeNull();
  });

  test('the patch is normalized here too, so no caller can store raw text', async () => {
    const created = await seedBlock();
    const updated = await updateRecoveryBlock(created.id, { reason: ' back\n\nspasm  ' });
    expect(updated.reason).toBe('back spasm');
  });

  test('every other field of the record is untouched', async () => {
    const created = await seedBlock();
    const updated = await updateRecoveryBlock(created.id, { reason: 'torn hamstring' });
    const { reason: _r1, updated_at: _u1, ...restBefore } = created;
    const { reason: _r2, updated_at: _u2, ...restAfter } = updated;
    expect(restAfter).toEqual(restBefore);
    // The frozen baseline in particular: the whole contract of a baseline is
    // that nothing after creation can move it.
    expect(updated.baseline).toEqual(created.baseline);
    expect(updated.include_in_normal_analytics).toBe(created.include_in_normal_analytics);
  });

  test('saving the same reason again is a no-op, not a content-free sync push', async () => {
    const created = await seedBlock('torn hamstring');
    const resaved = await updateRecoveryBlock(created.id, { reason: '  torn hamstring  ' });
    expect(resaved.updated_at).toBe(created.updated_at);
  });

  test('clearing a reason that was never there is likewise a no-op', async () => {
    const created = await seedBlock();
    const cleared = await updateRecoveryBlock(created.id, { reason: '' });
    expect(cleared.updated_at).toBe(created.updated_at);
    expect(cleared.reason).toBeNull();
  });

  test('a completed block is still editable — naming a past injury is legitimate', async () => {
    const created = await seedBlock();
    const completed = await completeRecoveryBlock(created.id);
    const updated = await updateRecoveryBlock(created.id, { reason: 'torn hamstring' });
    expect(updated.reason).toBe('torn hamstring');
    expect(updated.completed_at).toBe(completed.completed_at);
  });

  test('a tombstoned block rejects the write, exactly as it does every other patch', async () => {
    const created = await seedBlock();
    await deleteRecoveryBlock(created.id);
    await expect(updateRecoveryBlock(created.id, { reason: 'too late' })).rejects.toThrow(/deleted/);
  });

  test('a LEGACY record with no reason key at all accepts one later', async () => {
    await replaceRecoveryBlocksRaw([legacyBlock()]);
    expect(legacyBlock()).not.toHaveProperty('reason');

    const updated = await updateRecoveryBlock('rb-legacy', { reason: 'torn hamstring' });
    expect(updated.reason).toBe('torn hamstring');
    expect(updated.baseline_note_title).toBe('Legs Day');
  });

  test('clearing a LEGACY record that never had one does not mark it dirty', async () => {
    await replaceRecoveryBlocksRaw([legacyBlock()]);
    const cleared = await updateRecoveryBlock('rb-legacy', { reason: null });
    expect(cleared.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ── the mutation seam the UI actually calls ───────────────────────────────────

describe('hooks: starting with a reason, and editing one afterwards', () => {
  test('startRecoveryBlockCore carries the reason into the created block', async () => {
    const storage = {
      createRecoveryBlock: jest.fn(async (args) => ({ id: 'rb1', ...args })),
      addRecoveryWeek: jest.fn(async () => ({ id: 'rw1' })),
      deleteRecoveryBlock: jest.fn(),
    };
    const result = await startRecoveryBlockCore(storage, {
      baselineNoteId: 'wn-1', weekNoteId: 'wn-2', reason: 'torn hamstring',
    });
    expect(result.ok).toBe(true);
    expect(storage.createRecoveryBlock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'torn hamstring' })
    );
  });

  test('starting without one passes null rather than omitting the field', async () => {
    const storage = {
      createRecoveryBlock: jest.fn(async (args) => ({ id: 'rb1', ...args })),
      addRecoveryWeek: jest.fn(async () => ({ id: 'rw1' })),
      deleteRecoveryBlock: jest.fn(),
    };
    await startRecoveryBlockCore(storage, { baselineNoteId: 'wn-1', weekNoteId: 'wn-2' });
    expect(storage.createRecoveryBlock).toHaveBeenCalledWith(
      expect.objectContaining({ reason: null })
    );
  });

  test('setRecoveryBlockReasonCore patches only the reason', async () => {
    const storage = {
      updateRecoveryBlock: jest.fn(async (id, patch) => ({ id, ...patch })),
    };
    const result = await setRecoveryBlockReasonCore(storage, {
      blockId: 'rb1', reason: 'torn hamstring',
    });
    expect(result).toEqual({ ok: true, block: { id: 'rb1', reason: 'torn hamstring' } });
    expect(storage.updateRecoveryBlock).toHaveBeenCalledWith('rb1', { reason: 'torn hamstring' });
  });

  test('a storage rejection is reported, never swallowed as success', async () => {
    const storage = {
      updateRecoveryBlock: jest.fn(async () => {
        const e = new Error('Recovery block rb1 is deleted.');
        e.code = 'BLOCK_NOT_FOUND';
        throw e;
      }),
    };
    const result = await setRecoveryBlockReasonCore(storage, { blockId: 'rb1', reason: 'x' });
    expect(result).toMatchObject({ ok: false, code: 'BLOCK_NOT_FOUND' });
  });
});

// ── backup: export, import, and every legacy/invalid shape ────────────────────

describe('backup round trip', () => {
  async function seedNoteAndBlock(block) {
    await AsyncStorage.setItem(WORKOUT_NOTES_KEY, JSON.stringify([
      { id: 'wn-1', title: 'Legs Day', raw_text: 'Squat 100x5', saved_at: '2026-01-01T00:00:00.000Z' },
    ]));
    await replaceRecoveryBlocksRaw([block]);
    await AsyncStorage.setItem(RECOVERY_BLOCK_WEEKS_KEY, JSON.stringify([]));
  }

  test('a reason is exported and restored verbatim', async () => {
    await seedNoteAndBlock(legacyBlock({ reason: 'torn hamstring' }));
    const backup = await exportBackup();
    expect(backup.recovery_blocks[0].reason).toBe('torn hamstring');

    await AsyncStorage.clear();
    const result = await importBackup(backup);
    expect(result.ok).toBe(true);
    expect((await loadRecoveryBlocksRaw())[0].reason).toBe('torn hamstring');
  });

  // Codex review, PR #877. A file can be hand-edited between export and import,
  // and a multi-line value clears validation — it is a non-blank string inside
  // the bound — so without normalizing on the way in, import is the one write
  // path that can plant a reason no in-app action could ever produce.
  test('a hand-edited non-canonical reason is normalized on import, not stored verbatim', async () => {
    await seedNoteAndBlock(legacyBlock({ reason: 'torn hamstring' }));
    const backup = await exportBackup();

    const tampered = JSON.parse(JSON.stringify(backup));
    tampered.recovery_blocks[0].reason = '  knee\n  surgery  ';

    await AsyncStorage.clear();
    const result = await importBackup(tampered);
    expect(result.ok).toBe(true);
    // Exactly what normalizeRecoveryReason would have produced at creation.
    expect((await loadRecoveryBlocksRaw())[0].reason).toBe('knee surgery');
  });

  test('import normalization leaves an absent reason absent', async () => {
    await seedNoteAndBlock(legacyBlock());
    const backup = await exportBackup();
    await AsyncStorage.clear();
    expect(await importBackup(backup)).toMatchObject({ ok: true });
    // Silence in a legacy file is not an instruction to write a null.
    expect((await loadRecoveryBlocksRaw())[0]).not.toHaveProperty('reason');
  });

  test('a legacy block exports with NO reason key, and restores unchanged', async () => {
    await seedNoteAndBlock(legacyBlock());
    const backup = await exportBackup();
    // Absent, not a fabricated null: the export projection keeps an absent
    // field absent, so the artifact says exactly what the record says.
    expect(backup.recovery_blocks[0]).not.toHaveProperty('reason');

    await AsyncStorage.clear();
    const result = await importBackup(backup);
    expect(result.ok).toBe(true);
    const restored = (await loadRecoveryBlocksRaw())[0];
    expect(restored).not.toHaveProperty('reason');
    expect(restored.baseline_note_title).toBe('Legs Day');
  });

  test('an explicit null reason is accepted', async () => {
    await seedNoteAndBlock(legacyBlock({ reason: null }));
    const backup = await exportBackup();
    expect(await importBackup(backup)).toMatchObject({ ok: true });
  });

  test('a reason at the cap is accepted; one past it is refused', async () => {
    await seedNoteAndBlock(legacyBlock({ reason: 'r'.repeat(MAX_RECOVERY_REASON_LENGTH) }));
    const atCap = await exportBackup();
    expect(await importBackup(atCap)).toMatchObject({ ok: true });

    const oversized = JSON.parse(JSON.stringify(atCap));
    oversized.recovery_blocks[0].reason = 'r'.repeat(MAX_RECOVERY_REASON_LENGTH + 1);
    const rejected = await importBackup(oversized);
    expect(rejected.ok).toBe(false);
    expect(rejected.error).toMatch(/reason too long/);
  });

  test('a non-string reason is refused rather than coerced', async () => {
    await seedNoteAndBlock(legacyBlock({ reason: 'torn hamstring' }));
    const payload = JSON.parse(JSON.stringify(await exportBackup()));
    payload.recovery_blocks[0].reason = { text: 'torn hamstring' };
    const result = await importBackup(payload);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/reason must be a string/);
  });

  // #872 requires an empty reason to be ACCEPTED and normalized consistently —
  // never rejected. Import converges it on `null`, the same value that clearing
  // the field in the app produces, so a blank in a hand-edited file means "no
  // reason" exactly as it does everywhere else (review of 33fe98b).
  test.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['newlines only', '\n\n'],
  ])('%s is accepted on import and stored as null, not refused', async (_label, value) => {
    await seedNoteAndBlock(legacyBlock({ reason: 'torn hamstring' }));
    const payload = JSON.parse(JSON.stringify(await exportBackup()));
    payload.recovery_blocks[0].reason = value;

    await AsyncStorage.clear();
    const result = await importBackup(payload);
    expect(result.ok).toBe(true);
    expect((await loadRecoveryBlocksRaw())[0].reason).toBeNull();
  });

  test('an imported empty reason is indistinguishable from a cleared one', async () => {
    // The three states #872 requires to stay indistinguishable, reached by
    // three different routes and landing on the same stored value.
    await seedNoteAndBlock(legacyBlock({ reason: 'torn hamstring' }));
    const payload = JSON.parse(JSON.stringify(await exportBackup()));
    payload.recovery_blocks[0].reason = '   ';
    await AsyncStorage.clear();
    await importBackup(payload);
    const imported = (await loadRecoveryBlocksRaw())[0].reason;

    await AsyncStorage.clear();
    await seedNoteAndBlock(legacyBlock({ reason: 'torn hamstring' }));
    await updateRecoveryBlock('rb-legacy', { reason: '' });
    const cleared = (await loadRecoveryBlocksRaw())[0].reason;

    expect(imported).toBeNull();
    expect(cleared).toBeNull();
    expect(imported).toBe(cleared);
  });

  test('a rejected payload writes nothing at all', async () => {
    await seedNoteAndBlock(legacyBlock({ reason: 'torn hamstring' }));
    const payload = JSON.parse(JSON.stringify(await exportBackup()));
    payload.recovery_blocks[0].reason = 'r'.repeat(MAX_RECOVERY_REASON_LENGTH + 1);

    await AsyncStorage.clear();
    expect((await importBackup(payload)).ok).toBe(false);
    expect(await AsyncStorage.getItem(RECOVERY_BLOCKS_KEY)).toBeNull();
  });
});

// ── cloud projections ─────────────────────────────────────────────────────────

describe('cloud bootstrap plan', () => {
  test('a block uploads its reason', () => {
    const plan = buildBootstrapPlan(
      { recoveryBlocks: [legacyBlock({ reason: 'torn hamstring' })] },
      'user-1'
    );
    expect(plan.recovery_blocks[0]).toMatchObject({
      user_id: 'user-1', id: 'rb-legacy', reason: 'torn hamstring',
    });
  });

  test('a legacy block uploads an explicit null rather than undefined', () => {
    const plan = buildBootstrapPlan({ recoveryBlocks: [legacyBlock()] }, 'user-1');
    expect(plan.recovery_blocks[0]).toHaveProperty('reason', null);
  });
});

describe('cloud push whitelist', () => {
  // The push path projects each record through an explicit column whitelist, so
  // a field the whitelist does not name never reaches the server no matter what
  // the local record holds. This drives the REAL transport rather than a fake,
  // because the whitelist is the thing under test.
  function makeClient(captured) {
    return {
      auth: {
        async getUser() {
          return { data: { user: { id: 'user-1' } }, error: null };
        },
      },
      schema() {
        return {
          from(table) {
            return {
              upsert(rows, options) {
                captured.push({ table, rows, options });
                return {
                  async select() {
                    return { data: rows, error: null };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  test('the reason is pushed, and the server-owned columns still are not', async () => {
    const captured = [];
    const transport = createSupabaseTransport(() => makeClient(captured));

    await transport.push(SYNC_TABLES.RECOVERY_BLOCKS, [
      legacyBlock({ reason: 'torn hamstring', sync_xid: '99', client_id: 'device-a' }),
    ]);

    expect(captured[0].rows[0]).toMatchObject({ id: 'rb-legacy', reason: 'torn hamstring' });
    expect(captured[0].rows[0]).not.toHaveProperty('updated_at');
    expect(captured[0].rows[0]).not.toHaveProperty('sync_xid');
    expect(captured[0].rows[0]).not.toHaveProperty('client_id');
  });

  test('a legacy record pushes no reason column at all, so it clears nothing', async () => {
    const captured = [];
    const transport = createSupabaseTransport(() => makeClient(captured));

    await transport.push(SYNC_TABLES.RECOVERY_BLOCKS, [legacyBlock()]);

    // Omitted, not null: an omitted column is left alone by the upsert's SET
    // list, so a device that has never heard of the field cannot erase a reason
    // another device set.
    expect(captured[0].rows[0]).not.toHaveProperty('reason');
  });
});

// ── the surfaces that show it ─────────────────────────────────────────────────

const React = require('react');
const renderer = require('react-test-renderer');

// Joined text of every rendered <Text>, so an assertion is about what the user
// reads rather than about how a caption happens to be split into children.
function allText(root) {
  return root.findAll(n => n.type === 'Text').map((t) => {
    const flatten = (c) => (Array.isArray(c) ? c.map(flatten).join('') : String(c ?? ''));
    return flatten(t.props.children);
  });
}
function hasText(root, needle) {
  return allText(root).some(s => s.includes(needle));
}
function byLabel(root, label) {
  return root.findAll(n => n.props && n.props.accessibilityLabel === label)[0] || null;
}

describe('LogRecoverySection: the active block states its reason and offers the edit', () => {
  const { LogRecoverySection } = require('../components/LogRecoverySection');

  const noteA = { id: 'n1', title: 'Push Day', raw_text: '' };
  const activeBlock = (overrides = {}) => ({
    id: 'rb-active',
    baseline_note_id: 'n9',
    baseline_note_title: 'Legs Day',
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
    ...overrides,
  });
  const weekOf = (block) => ({
    id: 'w1', block_id: block.id, note_id: noteA.id, week_number: 1,
    completed_at: null, deleted_at: null,
  });

  function renderSection(block) {
    let component;
    renderer.act(() => {
      component = renderer.create(
        React.createElement(LogRecoverySection, {
          blocks: [block], weeks: [weekOf(block)], notes: [noteA],
          onViewNote: jest.fn(), onCompleteWeek: jest.fn(), onOpenAddWeek: jest.fn(),
          onCompleteBlock: jest.fn(), onUnlinkWeek: jest.fn(), onRetryRecovery: jest.fn(),
        })
      );
    });
    return component;
  }

  test('a block with a reason shows it beside the baseline', () => {
    const root = renderSection(activeBlock({ reason: 'torn hamstring' })).root;
    expect(hasText(root, 'Reason: torn hamstring')).toBe(true);
    expect(hasText(root, 'Baseline: Legs Day')).toBe(true);
  });

  test('a block without one shows no empty placeholder in the card', () => {
    const root = renderSection(activeBlock()).root;
    expect(hasText(root, 'Reason:')).toBe(false);
  });

  test('a LEGACY block with no reason key renders exactly like one with none', () => {
    const { reason: _dropped, ...legacy } = activeBlock({ reason: null });
    expect(legacy).not.toHaveProperty('reason');
    const root = renderSection(legacy).root;
    expect(hasText(root, 'Reason:')).toBe(false);
    expect(hasText(root, 'Baseline: Legs Day')).toBe(true);
  });

  test('Manage block offers the edit, naming what is currently stored', () => {
    const component = renderSection(activeBlock({ reason: 'torn hamstring' }));
    renderer.act(() => {
      byLabel(component.root, 'Manage recovery block: Legs Day').props.onPress();
    });
    const row = byLabel(component.root, 'Edit reason for this recovery block: torn hamstring');
    expect(row).not.toBeNull();
  });

  test('with no reason stored, the same row invites adding one', () => {
    const component = renderSection(activeBlock());
    renderer.act(() => {
      byLabel(component.root, 'Manage recovery block: Legs Day').props.onPress();
    });
    expect(byLabel(component.root, 'Add a reason for this recovery block')).not.toBeNull();
    expect(hasText(component.root, 'Not set. Add why this recovery started.')).toBe(true);
  });

  test('the editor seeds from the STORED value, and Cancel discards the draft', () => {
    const component = renderSection(activeBlock({ reason: 'torn hamstring' }));
    renderer.act(() => {
      byLabel(component.root, 'Manage recovery block: Legs Day').props.onPress();
    });
    renderer.act(() => {
      byLabel(component.root, 'Edit reason for this recovery block: torn hamstring').props.onPress();
    });

    const input = byLabel(component.root, 'Reason for this recovery block');
    expect(input.props.value).toBe('torn hamstring');
    expect(input.props.maxLength).toBe(MAX_RECOVERY_REASON_LENGTH);

    renderer.act(() => { input.props.onChangeText('something else entirely'); });
    expect(byLabel(component.root, 'Reason for this recovery block').props.value)
      .toBe('something else entirely');

    renderer.act(() => {
      byLabel(component.root, 'Cancel editing the reason').props.onPress();
    });
    // Reopening reads the record again rather than re-offering the abandoned
    // draft, so Cancel is a true discard.
    renderer.act(() => {
      byLabel(component.root, 'Edit reason for this recovery block: torn hamstring').props.onPress();
    });
    expect(byLabel(component.root, 'Reason for this recovery block').props.value)
      .toBe('torn hamstring');
  });

  test('collapsing Manage block closes an open editor rather than stranding it', () => {
    const component = renderSection(activeBlock({ reason: 'torn hamstring' }));
    const manage = () => byLabel(component.root, 'Manage recovery block: Legs Day');
    renderer.act(() => { manage().props.onPress(); });
    renderer.act(() => {
      byLabel(component.root, 'Edit reason for this recovery block: torn hamstring').props.onPress();
    });
    renderer.act(() => { manage().props.onPress(); });
    renderer.act(() => { manage().props.onPress(); });
    expect(byLabel(component.root, 'Reason for this recovery block')).toBeNull();
    expect(byLabel(component.root, 'Edit reason for this recovery block: torn hamstring'))
      .not.toBeNull();
  });
});

describe('AnalyticsRecoverySection: completed history carries the reason', () => {
  const { AnalyticsRecoverySection } = require('../components/AnalyticsRecoverySection');
  const { captureRecoveryBaselineFromText } = require('../lib/data/recoveryBlocks');

  const BASELINE_TEXT = '-Bench\n- 135 5,5,5';
  const completed = (overrides = {}) => ({
    id: 'rb-done',
    baseline_note_id: 'note-baseline',
    baseline_note_title: 'Push Pull Legs',
    baseline: captureRecoveryBaselineFromText(BASELINE_TEXT),
    started_at: '2026-05-01T00:00:00Z',
    completed_at: '2026-06-01T00:00:00Z',
    saved_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    deleted_at: null,
    ...overrides,
  });

  function renderSection(blocks) {
    let component;
    renderer.act(() => {
      component = renderer.create(
        React.createElement(AnalyticsRecoverySection, { blocks, weeks: [], notes: [] })
      );
    });
    return component;
  }

  test('the evidence card names the reason for a completed block', () => {
    const root = renderSection([completed({ reason: 'torn hamstring' })]).root;
    expect(hasText(root, 'Reason: torn hamstring')).toBe(true);
  });

  test('a completed block without one shows no placeholder', () => {
    const root = renderSection([completed()]).root;
    expect(hasText(root, 'Reason:')).toBe(false);
  });

  test('the history list shows the reason and announces it in the row label', () => {
    const component = renderSection([completed({ reason: 'torn hamstring' })]);
    renderer.act(() => {
      byLabel(component.root, 'Expand recovery history').props.onPress();
    });
    expect(hasText(component.root, 'torn hamstring')).toBe(true);
    expect(byLabel(
      component.root,
      'View recovery evidence for Push Pull Legs, completed 06-01-2026. Reason: torn hamstring'
    )).not.toBeNull();
  });

  test('a history row for a block with no reason keeps its original label', () => {
    const component = renderSection([completed()]);
    renderer.act(() => {
      byLabel(component.root, 'Expand recovery history').props.onPress();
    });
    expect(byLabel(
      component.root,
      'View recovery evidence for Push Pull Legs, completed 06-01-2026'
    )).not.toBeNull();
  });

  // Codex review, PR #877. `setRecoveryBlockReasonCore` has always accepted a
  // completed block; before this the domain had no UI that reached one, so the
  // documented capability was unreachable the moment a block was completed.
  // This card is the only surface that presents a completed block, which makes
  // it the only place the edit can live.
  test('a completed block offers the editor, naming what is currently stored', () => {
    const component = renderSection([completed({ reason: 'torn hamstring' })]);
    expect(byLabel(
      component.root,
      'Edit reason for this recovery block: torn hamstring'
    )).not.toBeNull();
  });

  test('a completed block with no reason still invites adding one', () => {
    const component = renderSection([completed()]);
    expect(byLabel(component.root, 'Add a reason for this recovery block')).not.toBeNull();
    expect(hasText(component.root, 'Add a reason')).toBe(true);
    // Still no fabricated "Reason: —" claiming a value the block never had.
    expect(hasText(component.root, 'Reason:')).toBe(false);
  });

  test('the completed-block editor seeds from the record, and Cancel discards', () => {
    const component = renderSection([completed({ reason: 'torn hamstring' })]);
    renderer.act(() => {
      byLabel(component.root, 'Edit reason for this recovery block: torn hamstring').props.onPress();
    });

    const input = byLabel(component.root, 'Reason for this recovery block');
    expect(input.props.value).toBe('torn hamstring');
    expect(input.props.maxLength).toBe(MAX_RECOVERY_REASON_LENGTH);

    renderer.act(() => { input.props.onChangeText('rewritten'); });
    renderer.act(() => {
      byLabel(component.root, 'Cancel editing the reason').props.onPress();
    });

    // Reopening reads the record again rather than re-offering the abandoned
    // draft — the same discard contract Log's editor holds.
    renderer.act(() => {
      byLabel(component.root, 'Edit reason for this recovery block: torn hamstring').props.onPress();
    });
    expect(byLabel(component.root, 'Reason for this recovery block').props.value)
      .toBe('torn hamstring');
  });
});
