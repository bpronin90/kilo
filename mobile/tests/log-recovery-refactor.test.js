// #1056 refactor guard: LogRecoverySection.js was split into
// components/recovery/{LogRecoveryWeeks,LogRecoveryEvidence,LogRecoveryLifecycle}
// and logRecoveryStyles.js, keeping the section file as the public boundary.
// These are BEHAVIOR-PRESERVING negative fixtures — the failure and edge paths a
// naive extraction is most likely to drop — exercised through the public
// `../components/LogRecoverySection` import and its documented mock seams. The
// happy-path coverage lives in log-recovery-*, recovery-*, save-status-region,
// and interaction-target-a11y; this file pins the four negatives the card
// names: stale identity, failed operation, partial lifecycle data, and a clean
// rerender after restoration.

import React from 'react';
import render from 'react-test-renderer';
import { RECOVERY_STALE_MESSAGE } from '../hooks/entries/recoveryBlockHooks';
import { LogRecoverySection } from '../components/LogRecoverySection';

// Confirmations flow through the shared platformAlert seam. Capturing the
// button set lets a fixture drive a Confirm press without a native dialog, so a
// failed lifecycle operation can be observed end to end (button -> section
// handler -> runAction -> the state-zone error banner).
jest.mock('../lib/platformAlert', () => ({
  Alert: { alert: jest.fn() },
}));
import { Alert } from '../lib/platformAlert';

const activeBlock = {
  id: 'rb-active',
  baseline_note_id: 'nbase',
  baseline_note_title: 'Legs Day',
  started_at: '2026-01-01T00:00:00.000Z',
  completed_at: null,
  deleted_at: null,
};

const openWeek = (over = {}) => ({
  id: 'w1',
  block_id: 'rb-active',
  note_id: 'n1',
  week_number: 1,
  completed_at: null,
  deleted_at: null,
  ...over,
});

const weekNote = { id: 'n1', title: 'Recovery Week Note', raw_text: 'Monday\n-Bench\n135 5,5,5' };

const baseProps = {
  notes: [weekNote],
  onViewNote: jest.fn(),
  onCompleteWeek: jest.fn(),
  onUndoCompleteWeek: jest.fn(),
  onOpenAddWeek: jest.fn(),
  onOpenEndBlockModal: jest.fn(),
  onUnlinkWeek: jest.fn(),
  onRetryRecovery: jest.fn(),
};

function renderSection(props = {}) {
  let component;
  render.act(() => {
    component = render.create(
      React.createElement(LogRecoverySection, { ...baseProps, ...props })
    );
  });
  return component;
}

const byLabel = (root, label) =>
  root.findAll(n => n.props && n.props.accessibilityLabel === label)[0] || null;

const pressableByLabel = (root, label) =>
  root.findAll(n => n.props
    && n.props.accessibilityLabel === label
    && typeof n.props.onPress === 'function')[0] || null;

const textCount = (root, exact) =>
  root.findAll(n => n.type === 'Text' && n.props.children === exact).length;

const joinedTexts = (root) =>
  root.findAll(n => n.type === 'Text').map(n => (
    Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children
  ));

const hasJoinedText = (root, needle) =>
  root.findAll(n => n.type === 'Text' && Array.isArray(n.props.children)
    && n.props.children.join('') === needle).length > 0;

const lastAlertButtons = () => {
  const calls = Alert.alert.mock.calls;
  return calls.length ? calls[calls.length - 1][2] : null;
};

beforeEach(() => {
  Alert.alert.mockClear();
});

// ── Fixture 1: stale identity ────────────────────────────────────────────────
describe('#1056 negative: stale identity', () => {
  test('a stale snapshot keeps last-known-good data and the retry path, never a wiped/empty card', () => {
    const component = renderSection({
      blocks: [activeBlock],
      weeks: [openWeek()],
      stateStale: true,
    });
    const root = component.root;

    // A stale verified read must NOT fall through to the "nothing to show"
    // null return — the affordance to repair it would vanish with the records.
    expect(component.toJSON()).not.toBeNull();
    // Last-known-good content is still on screen, plainly marked stale.
    expect(textCount(root, 'Week 1 in progress')).toBe(1);
    expect(hasJoinedText(root, 'Baseline: Legs Day')).toBe(true);
    expect(joinedTexts(root)).toContain(RECOVERY_STALE_MESSAGE);

    const retry = pressableByLabel(root, 'Retry recovery');
    expect(retry).toBeTruthy();
    render.act(() => { retry.props.onPress(); });
    expect(baseProps.onRetryRecovery).toHaveBeenCalled();
  });

  test('presentation state opened for one block identity does not leak onto a different block', () => {
    const component = renderSection({ blocks: [activeBlock], weeks: [openWeek()] });
    const root = component.root;

    const manage = pressableByLabel(root, 'Manage recovery block: Legs Day');
    expect(manage).toBeTruthy();
    render.act(() => { manage.props.onPress(); });
    expect(textCount(root, 'End recovery block')).toBe(1);

    // Identity changes underneath the same mounted section: the disclosure is
    // keyed by block id, so it must read as collapsed for the new block rather
    // than exposing Unlink / End / the inclusion switch it had opened for the
    // previous one.
    const blockB = { ...activeBlock, id: 'rb-next', baseline_note_title: 'Upper/Lower' };
    render.act(() => {
      component.update(React.createElement(LogRecoverySection, {
        ...baseProps,
        blocks: [blockB],
        weeks: [openWeek({ id: 'wB', block_id: 'rb-next' })],
      }));
    });
    const triggerB = byLabel(root, 'Manage recovery block: Upper/Lower');
    expect(triggerB).toBeTruthy();
    expect(triggerB.props.accessibilityState).toEqual({ expanded: false });
    expect(textCount(root, 'End recovery block')).toBe(0);
  });
});

// ── Fixture 2: failed operation ──────────────────────────────────────────────
describe('#1056 negative: failed operation', () => {
  test('a rejected lifecycle mutation surfaces its error in the state zone without crashing', async () => {
    const onCompleteWeek = jest.fn(async () => ({ ok: false, error: 'Complete failed' }));
    const component = renderSection({
      blocks: [activeBlock],
      weeks: [openWeek()],
      onCompleteWeek,
    });
    const root = component.root;

    const complete = pressableByLabel(root, 'Complete Week 1');
    expect(complete).toBeTruthy();
    render.act(() => { complete.props.onPress(); });

    // The confirm dialog is a real gate — nothing runs until it is confirmed.
    const buttons = lastAlertButtons();
    expect(Array.isArray(buttons)).toBe(true);
    const confirm = buttons.find(b => b.text === 'Complete week');
    expect(confirm).toBeTruthy();

    await render.act(async () => { await confirm.onPress(); });

    expect(onCompleteWeek).toHaveBeenCalledWith({ blockId: 'rb-active' });
    expect(textCount(root, 'Complete failed')).toBe(1);
    // The card is still fully rendered — a failed write does not tear it down.
    expect(textCount(root, 'Week 1 in progress')).toBe(1);
  });

  test('a terminal (cancelled) operation is explained but locks nothing and offers no retry', () => {
    const component = renderSection({
      blocks: [activeBlock],
      weeks: [openWeek()],
      pendingRecoveryError: 'That recovery change was cancelled.',
    });
    const root = component.root;

    expect(textCount(root, 'That recovery change was cancelled.')).toBe(1);
    // Terminal, not pending: no retry affordance, and lifecycle stays usable.
    expect(pressableByLabel(root, 'Retry recovery')).toBeNull();
    expect(byLabel(root, 'Complete Week 1').props.accessibilityState.disabled).toBe(false);
  });
});

// ── Fixture 3: partial lifecycle data ────────────────────────────────────────
describe('#1056 negative: partial lifecycle data', () => {
  test('an active block with no weeks yet renders the add-week state and no week-scoped controls', () => {
    const component = renderSection({ blocks: [activeBlock], weeks: [] });
    const root = component.root;

    expect(textCount(root, 'No recovery week yet — add a week')).toBe(1);
    expect(pressableByLabel(root, 'Add next recovery week')).toBeTruthy();

    // Open Manage: with no current week there is nothing to unlink, but the
    // block can still be ended — the split must not fabricate a week-scoped row.
    const manage = pressableByLabel(root, 'Manage recovery block: Legs Day');
    render.act(() => { manage.props.onPress(); });
    expect(textCount(root, 'End recovery block')).toBe(1);
    expect(root.findAll(n => n.props
      && typeof n.props.accessibilityLabel === 'string'
      && n.props.accessibilityLabel.startsWith('Unlink Week')).length).toBe(0);
  });

  test('a week whose note is missing renders a dead, unreadable row rather than an inert button', () => {
    const component = renderSection({
      blocks: [activeBlock],
      // note_id points at a note that is not in the notebook.
      weeks: [openWeek({ note_id: 'ghost' })],
      notes: [],
    });
    const root = component.root;

    const deadRow = byLabel(root, 'Recovery Week 1, note unavailable');
    expect(deadRow).toBeTruthy();
    expect(deadRow.props.onPress).toBeUndefined();
    expect(deadRow.props.accessibilityRole).toBeUndefined();
    expect(textCount(root, 'Note unavailable')).toBe(1);
  });

  test('a block missing its baseline title falls back to the reserved placeholder, not an empty caption', () => {
    const component = renderSection({
      blocks: [{ ...activeBlock, baseline_note_title: null }],
      weeks: [openWeek()],
    });
    expect(hasJoinedText(component.root, 'Baseline: Untitled Routine')).toBe(true);
  });
});

// ── Fixture 4: clean rerender after restoration ──────────────────────────────
describe('#1056 negative: clean rerender after restoration', () => {
  test('restoring to a verified snapshot clears the stale/pending banners on rerender', () => {
    const component = renderSection({
      blocks: [activeBlock],
      weeks: [openWeek()],
      stateStale: true,
      pendingRecovery: [{ id: 'op1' }],
    });
    const root = component.root;
    expect(joinedTexts(root)).toContain(RECOVERY_STALE_MESSAGE);
    expect(textCount(root, 'A recovery change is still being applied on this device.')).toBe(1);

    render.act(() => {
      component.update(React.createElement(LogRecoverySection, {
        ...baseProps,
        blocks: [activeBlock],
        weeks: [openWeek()],
        stateStale: false,
        pendingRecovery: [],
      }));
    });

    expect(joinedTexts(root)).not.toContain(RECOVERY_STALE_MESSAGE);
    expect(textCount(root, 'A recovery change is still being applied on this device.')).toBe(0);
    expect(textCount(root, 'Week 1 in progress')).toBe(1);
    expect(pressableByLabel(root, 'Retry recovery')).toBeNull();
  });

  test('an open reason editor does not survive the active block being replaced', () => {
    const withReason = { ...activeBlock, reason: 'torn hamstring' };
    const component = renderSection({ blocks: [withReason], weeks: [openWeek()] });
    const root = component.root;

    render.act(() => { pressableByLabel(root, 'Manage recovery block: Legs Day').props.onPress(); });
    render.act(() => {
      pressableByLabel(root, 'Edit reason for this recovery block: torn hamstring').props.onPress();
    });
    expect(byLabel(root, 'Reason for this recovery block')).toBeTruthy();

    // The block is completed and cleared (verified-empty renders nothing)...
    render.act(() => {
      component.update(React.createElement(LogRecoverySection, {
        ...baseProps, blocks: [], weeks: [],
      }));
    });
    expect(component.toJSON()).toBeNull();

    // ...then a fresh block starts. The prior draft/editor must not reappear.
    const blockB = { id: 'rb-next', baseline_note_id: 'nb2', baseline_note_title: 'Upper/Lower', started_at: '2026-02-01T00:00:00.000Z', completed_at: null, deleted_at: null };
    render.act(() => {
      component.update(React.createElement(LogRecoverySection, {
        ...baseProps,
        blocks: [blockB],
        weeks: [openWeek({ id: 'wB', block_id: 'rb-next' })],
      }));
    });
    expect(textCount(root, 'Week 1 in progress')).toBe(1);
    expect(byLabel(root, 'Reason for this recovery block')).toBeNull();
    const triggerB = byLabel(root, 'Manage recovery block: Upper/Lower');
    expect(triggerB.props.accessibilityState).toEqual({ expanded: false });
  });
});
