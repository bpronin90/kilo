// Rejected Recovery modal/action callbacks (#1490): a thrown/rejected write is
// neither a confirmed success nor a known failure. Each surface keeps its draft
// and context, clears busy, shows actionable feedback, allows a retry, and never
// closes or announces completion.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { AccessibilityInfo } from 'react-native';
import { RecoveryBlockEndModal } from '../components/RecoveryBlockEndModal';
import { RebuildBaselineAction } from '../components/recovery/RebuildBaseline';
import { TidyRecoveryNamesAction } from '../components/recovery/TidyRecoveryNames';
import { LogRecoveryManageStack } from '../components/recovery/LogRecoveryHistory';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import * as hooks from '../hooks/entries/recoveryBlockHooks';
import { LightColors, KUA_PALETTES } from '../theme/colors';
import { ThemeContext } from '../theme/ThemeContext';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lb' }));
jest.mock('../hooks/entries/recoveryTidyMutations', () => ({ useRecoveryTidyNames: () => null }));
jest.mock('../hooks/entries/movementGroupHooks', () => ({ useMovementGroupEditor: () => ({}) }));
let mockLifecycleProps = [];
jest.mock('../components/recovery/LogRecoveryLifecycle', () => ({
  LogRecoveryLifecycle: (props) => { mockLifecycleProps.push(props); return null; },
}));

const BASE = '-Squat\n- 225 5';
const blk = (o = {}) => ({
  id: 'rb1', baseline_note_title: 'Routine', baseline: captureRecoveryBaselineFromText(BASE),
  started_at: '2026-05-01T00:00:00Z', completed_at: null, deleted_at: null, include_in_normal_analytics: false, ...o,
});
const kuaP = KUA_PALETTES.hardCourt.light;
const theme = { colors: LightColors, kuaPalette: kuaP, mode: 'light', preference: 'light', setPreference: () => {} };
const wrap = (el) => <ThemeContext.Provider value={theme}>{el}</ThemeContext.Provider>;
const byLabel = (root, l) => root.findAll(n => n.props && n.props.accessibilityLabel === l)[0];
const texts = (root) => root.findAll(n => typeof n.type === 'string' && n.type === 'Text').map(n => [].concat(n.props.children).join(''));
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

let unhandled;
const onUnhandled = (e) => { unhandled.push(e); };
let announceSpy;
beforeEach(() => {
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
  mockLifecycleProps = [];
  announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(async () => {
  await new Promise(r => setImmediate(r));
  process.removeListener('unhandledRejection', onUnhandled);
  jest.restoreAllMocks();
  expect(unhandled).toEqual([]);
});

describe('RecoveryBlockEndModal', () => {
  const mount = (props) => {
    const handlers = {
      onSetInclusion: jest.fn().mockResolvedValue({ ok: true }),
      onConfirmComplete: jest.fn().mockResolvedValue({ ok: true }),
      onClose: jest.fn(),
    };
    let c;
    act(() => { c = render.create(wrap(<RecoveryBlockEndModal visible block={blk()} weeks={[]} {...handlers} {...props} />)); });
    return { c, root: c.root, handlers: { ...handlers, ...props } };
  };
  const confirm = (root) => act(async () => { await byLabel(root, 'End block').props.onPress(); });

  test('rejected completion: error shown, no close, busy clears, retry succeeds', async () => {
    const onConfirmComplete = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true });
    const { root, handlers } = mount({ onConfirmComplete });
    await confirm(root);
    expect(texts(root).some(t => /may not have been saved/.test(t))).toBe(true);
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(byLabel(root, 'End block').props.disabled).toBe(false);
    await confirm(root);
    expect(onConfirmComplete).toHaveBeenCalledTimes(2);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(texts(root).some(t => /may not have been saved/.test(t))).toBe(false);
  });

  test('rejected inclusion write: completion never runs, selection retained, retry possible', async () => {
    const onSetInclusion = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true });
    const { root, handlers } = mount({ onSetInclusion });
    act(() => { byLabel(root, 'Count them with everything else').props.onPress(); });
    await confirm(root);
    expect(handlers.onConfirmComplete).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(byLabel(root, 'Count them with everything else').props.accessibilityState.checked).toBe(true);
    await confirm(root);
    expect(onSetInclusion).toHaveBeenLastCalledWith({ blockId: 'rb1', include: true });
    expect(handlers.onConfirmComplete).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  test('resolved failure keeps its own message and does not close', async () => {
    const { root, handlers } = mount({ onConfirmComplete: jest.fn().mockResolvedValue({ ok: false, error: 'Nope.' }) });
    await confirm(root);
    expect(texts(root)).toContain('Nope.');
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  test('duplicate presses while pending call once; unmount mid-flight is quiet', async () => {
    const d = deferred();
    const onConfirmComplete = jest.fn(() => d.promise);
    const { c, root, handlers } = mount({ onConfirmComplete });
    act(() => { byLabel(root, 'End block').props.onPress(); });
    act(() => { byLabel(root, 'Ending…').props.onPress(); });
    expect(onConfirmComplete).toHaveBeenCalledTimes(1);
    act(() => { c.unmount(); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { d.reject(new Error('late')); await d.promise.catch(() => {}); });
    expect(err).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });
});

describe('RebuildBaselineAction', () => {
  const baseNote = { id: 'nb', title: 'Routine', raw_text: BASE, updated_at: '2026-04-01T00:00:00Z' };
  const mount = (onRebuild) => {
    const block = { ...blk({ baseline: { ...captureRecoveryBaselineFromText(BASE), version: 1 } }), baseline_note_id: 'nb' };
    let c;
    act(() => { c = render.create(wrap(<RebuildBaselineAction block={block} notes={[baseNote]} weeks={[]} onRebuild={onRebuild} />)); });
    return c;
  };

  test('rejected rebuild keeps the preview open with an alert, announces failure not success, and retries', async () => {
    const onRebuild = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true });
    const c = mount(onRebuild);
    expect(byLabel(c.root, 'Rebuild baseline')).toBeDefined();
    act(() => { byLabel(c.root, 'Rebuild baseline').props.onPress(); });
    await act(async () => { await byLabel(c.root, 'Confirm rebuilding the baseline').props.onPress(); });
    expect(texts(c.root).some(t => /may not have been rebuilt/.test(t))).toBe(true);
    expect(byLabel(c.root, 'Confirm rebuilding the baseline').props.disabled).toBe(false);
    expect(announceSpy).not.toHaveBeenCalledWith('Baseline rebuilt from the routine.');
    await act(async () => { await byLabel(c.root, 'Confirm rebuilding the baseline').props.onPress(); });
    expect(onRebuild).toHaveBeenCalledTimes(2);
    expect(announceSpy).toHaveBeenCalledWith('Baseline rebuilt from the routine.');
  });
});

describe('TidyRecoveryNamesAction', () => {
  const notes = [{ id: 'n1', raw_text: '-Squat 3x6-8, step up\n- 135 8\n', updated_at: 'x' }];
  const weeks = [{ id: 'w1', block_id: 'rb1', note_id: 'n1', week_number: 1, deleted_at: null }];
  const mount = (onTidy) => {
    let c;
    act(() => { c = render.create(wrap(<TidyRecoveryNamesAction block={blk()} weeks={weeks} notes={notes} onTidy={onTidy} />)); });
    return c;
  };
  const confirm = (root) => act(async () => { await byLabel(root, 'Confirm tidy names').props.onPress(); });

  test('rejected tidy keeps the review open, shows an alert, no success notice, retry works', async () => {
    const onTidy = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true });
    const c = mount(onTidy);
    act(() => { byLabel(c.root, 'Tidy names').props.onPress(); });
    await confirm(c.root);
    expect(texts(c.root).some(t => /may not have been tidied/.test(t))).toBe(true);
    expect(byLabel(c.root, 'Confirm tidy names')).toBeDefined();
    expect(byLabel(c.root, 'Confirm tidy names').props.disabled).toBe(false);
    expect(texts(c.root)).not.toContain('Names tidied.');
    expect(announceSpy).not.toHaveBeenCalledWith('Names tidied.');
    await confirm(c.root);
    expect(onTidy).toHaveBeenCalledTimes(2);
    expect(texts(c.root)).toContain('Names tidied.');
  });

  test('duplicate presses call once; unmount while pending is quiet', async () => {
    const d = deferred();
    const onTidy = jest.fn(() => d.promise);
    const c = mount(onTidy);
    act(() => { byLabel(c.root, 'Tidy names').props.onPress(); });
    act(() => { byLabel(c.root, 'Confirm tidy names').props.onPress(); });
    act(() => { byLabel(c.root, 'Confirm tidy names').props.onPress(); });
    expect(onTidy).toHaveBeenCalledTimes(1);
    act(() => { c.unmount(); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { d.reject(new Error('late')); await d.promise.catch(() => {}); });
    expect(err).not.toHaveBeenCalled();
  });
});

describe('LogRecoveryManageStack inclusion toggle', () => {
  const setup = (setIncludeInNormalAnalytics) => {
    jest.spyOn(hooks, 'useRecoveryBlockLifecycle').mockReturnValue({ setIncludeInNormalAnalytics });
    jest.spyOn(hooks, 'useRecoveryBaselineNames').mockReturnValue({});
    let c;
    act(() => {
      c = render.create(wrap(
        <LogRecoveryManageStack
          styles={{}} colors={LightColors} kua={{}} activeBlock={blk()} completedBlocks={[]} weeks={[]} notes={[]}
          currentWeek={null} busy={null} actionsLocked={false} stale={false}
          onUnlinkWeek={() => {}} onOpenEndBlockModal={() => {}} manage={{ focusedBlockId: 'rb1' }}
        />
      ));
    });
    return c;
  };
  const latest = () => mockLifecycleProps[mockLifecycleProps.length - 1].inclusion;

  test('rejection sets an error, clears busy and permits retry', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ ok: true });
    setup(fn);
    await act(async () => { await latest().onToggle(blk(), true); });
    expect(latest().error).toMatch(/may not have been saved/);
    expect(latest().busy).toBe(false);
    await act(async () => { await latest().onToggle(blk(), true); });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(latest().error).toBeNull();
  });

  test('duplicate toggles while pending call once; unmount mid-flight is quiet', async () => {
    const d = deferred();
    const fn = jest.fn(() => d.promise);
    const c = setup(fn);
    act(() => { latest().onToggle(blk(), true); });
    act(() => { latest().onToggle(blk(), true); });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(latest().busy).toBe(true);
    act(() => { c.unmount(); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { d.reject(new Error('late')); await d.promise.catch(() => {}); });
    expect(err).not.toHaveBeenCalled();
  });

  test('resolved failure keeps its message', async () => {
    setup(jest.fn().mockResolvedValue({ ok: false, error: 'Nope.' }));
    await act(async () => { await latest().onToggle(blk(), true); });
    expect(latest().error).toBe('Nope.');
  });
});
