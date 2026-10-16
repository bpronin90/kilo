// #1424: the active Recovery workspace hierarchy. End recovery is a visible
// lifecycle action in the active card (not inside Manage block); Manage block is
// grouped into settings, maintenance and week actions; every active-only action
// follows the live active target and is disabled while locked or stale.

import React from 'react';
import render, { act } from 'react-test-renderer';
import { LogRecoverySection } from '../components/LogRecoverySection';
import { useLogRecoveryManage } from '../screens/log/useLogRecoveryManage';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import * as hooks from '../hooks/entries/recoveryBlockHooks';

jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

const BASE = '-Bench\n- 100 5\n-Squat\n- 100 5';
const block = (o = {}) => ({
  id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'Push Pull Legs', baseline: captureRecoveryBaselineFromText(BASE),
  started_at: '2026-05-01T00:00:00Z', completed_at: null, saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null, ...o,
});
const done = (id, at) => block({ id, completed_at: at });
const NOTES = [{ id: 'nb', title: 'Push Pull Legs', raw_text: BASE }];
const WEEK = { id: 'w1', block_id: 'rb1', note_id: 'nb', week_number: 1, completed_at: null, deleted_at: null, saved_at: '2026-05-02T00:00:00Z' };

beforeEach(() => {
  jest.spyOn(hooks, 'useRecoveryBlockLifecycle').mockReturnValue({
    setIncludeInNormalAnalytics: jest.fn().mockResolvedValue({ ok: true }),
    setBlockReason: jest.fn().mockResolvedValue({ ok: true }),
    rebuildBaseline: jest.fn().mockResolvedValue({ ok: true }),
  });
});
afterEach(() => { jest.restoreAllMocks(); });

const all = (root, label) => root.findAll(n => n.props && n.props.accessibilityLabel === label && n.props.onPress);
const texts = (root) => root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const press = (root, id) => act(() => { root.findAll(n => typeof n.type !== 'string' && n.props.testID === id && n.props.onPress)[0].props.onPress(); });

function Harness({ blocks, onOpenEndBlockModal, ...rest }) {
  const hist = useLogRecoveryManage({ blocks, ready: true, readError: null, navManageBlockId: null, navKey: 0 });
  return (
    <LogRecoverySection
      blocks={blocks} weeks={[WEEK]} notes={NOTES} onOpenEndBlockModal={onOpenEndBlockModal} {...rest}
      manage={{ ...hist.manage, completedBlocks: hist.completedBlocks, notesError: null, onReopenBlock: () => {} }}
    />
  );
}
function mount(props) {
  let c;
  act(() => { c = render.create(<Harness {...props} />); });
  return c;
}

describe('End recovery promotion', () => {
  test('is visible without opening Manage block, opens the existing modal, and is the only End action', () => {
    const onOpenEndBlockModal = jest.fn();
    const c = mount({ blocks: [block()], onOpenEndBlockModal });
    const end = all(c.root, 'End recovery block');
    expect(end).toHaveLength(1);
    expect(end[0].props.accessibilityState.disabled).toBe(false);
    act(() => { end[0].props.onPress(); });
    expect(onOpenEndBlockModal).toHaveBeenCalledTimes(1);
    press(c.root, 'recovery-manage-trigger-rb1');
    expect(all(c.root, 'End recovery block')).toHaveLength(1);
  });

  test.each([
    ['busy', { busy: 'week' }],
    ['pending recovery write', { pendingRecovery: [{ operation_id: 1, block_id: 'rb1', error: null }] }],
    ['unverified mutations', { mutationsAllowed: false }],
    ['stale snapshot', { stateStale: true }],
  ])('is disabled while %s', (_l, props) => {
    const c = mount({ blocks: [block()], onOpenEndBlockModal: jest.fn(), ...props });
    expect(all(c.root, 'End recovery block')[0].props.accessibilityState.disabled).toBe(true);
  });

  test('a completed block exposes no active-only action, even when focused', () => {
    const c = mount({ blocks: [done('rb-old', '2026-06-01T00:00:00Z')], onOpenEndBlockModal: jest.fn() });
    press(c.root, 'recovery-manage-trigger-rb-old');
    expect(all(c.root, 'End recovery block')).toHaveLength(0);
    expect(all(c.root, 'Unlink Week 1')).toHaveLength(0);
  });
});

describe('Manage block grouping', () => {
  test('settings, maintenance and week actions are separate headed groups in order', () => {
    const c = mount({ blocks: [block()], onOpenEndBlockModal: jest.fn() });
    press(c.root, 'recovery-manage-trigger-rb1');
    const headings = texts(c.root).filter(t => ['Block settings', 'Maintenance', 'Week actions'].includes(t));
    expect(headings).toEqual(['Block settings', 'Maintenance', 'Week actions']);
    expect(all(c.root, 'Unlink Week 1')).toHaveLength(1);
  });

  test('Unlink is disabled while the snapshot is stale', () => {
    const c = mount({ blocks: [block()], onOpenEndBlockModal: jest.fn(), stateStale: true });
    press(c.root, 'recovery-manage-trigger-rb1');
    expect(all(c.root, 'Unlink Week 1')[0].props.accessibilityState.disabled).toBe(true);
  });

  test('a reason draft survives collapsing Manage block', () => {
    const c = mount({ blocks: [block()], onOpenEndBlockModal: jest.fn() });
    press(c.root, 'recovery-manage-trigger-rb1');
    act(() => { all(c.root, 'Add a reason for this recovery block')[0].props.onPress(); });
    act(() => { c.root.findAll(n => n.props && n.props.accessibilityLabel === 'Reason for this recovery block')[0].props.onChangeText('knee'); });
    press(c.root, 'recovery-manage-trigger-rb1');
    press(c.root, 'recovery-manage-trigger-rb1');
    expect(c.root.findAll(n => n.props && n.props.accessibilityLabel === 'Reason for this recovery block')[0].props.value).toBe('knee');
  });
});
