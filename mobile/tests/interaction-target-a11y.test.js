// Issue 904: every interactive control outside the Log tab and outside the
// excluded five-tab bar must present a >=44x44 effective target and a complete
// screen-reader contract (button role, an accessible name that matches the
// visible label, and selected/disabled/expanded state where the control has
// one).
//
// The target is asserted the way it renders: the flattened style's
// minHeight/minWidth plus any hitSlop, so a later style edit that drops the
// minimum fails here rather than silently shipping a 29dp tap area.
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { StyleSheet } from 'react-native';

jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }), { virtual: true });

jest.mock('@react-native-community/datetimepicker', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return function MockDateTimePicker(props) {
    return ReactLocal.createElement(View, props);
  };
});

const mockUserProfile = { profile: { display_name: 'Ben' }, loading: false };
jest.mock('../hooks/useEntries', () => ({
  useFeatureToggles: () => ({
    fatigueTrackingEnabled: true,
    deloadModeEnabled: false,
    setFatigueTrackingEnabled: jest.fn(),
    setDeloadModeEnabled: jest.fn(),
  }),
  useUserProfile: () => ({
    profile: mockUserProfile.profile,
    save: jest.fn().mockResolvedValue({}),
    loading: mockUserProfile.loading,
    clear: jest.fn().mockResolvedValue(undefined),
  }),
}));

// SettingsScreen mounts the real ReminderSettingsCard, so its storage and
// scheduler dependencies are stubbed here the same way
// reminder-settings-card.test.js stubs them.
jest.mock('../storage/entries', () => ({
  loadWeighInReminder: jest.fn(async () => ({ enabled: true, hour: 8, minute: 0 })),
  loadWorkoutReminder: jest.fn(async () => ({ enabled: true, hour: 17, minute: 0, fallbackWeekdays: [2] })),
  saveWeighInReminder: jest.fn(async () => {}),
  saveWorkoutReminder: jest.fn(async () => {}),
}));

jest.mock('../lib/reminderScheduler', () => ({
  remindersSupported: jest.fn(() => true),
  requestReminderPermission: jest.fn(async () => true),
  applyWeighInReminder: jest.fn(async () => {}),
  applyWorkoutReminder: jest.fn(async () => {}),
  reconcileWorkoutReminder: jest.fn(async () => ({
    // No inferred weekdays, so the fallback weekday chips render.
    workout: { enabled: true, hour: 17, minute: 0, fallbackWeekdays: [2] },
    inferredWeekdays: [],
  })),
}));

import { ErrorBanner } from '../components/UI';
import { SettingsScreen } from '../components/SettingsScreen';
import { ProfileScreen } from '../components/ProfileScreen';
import { ReminderSettingsCard } from '../components/ReminderSettingsCard';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { AnalyticsFatigueCard } from '../components/AnalyticsFatigueCard';
import { AnalyticsBig3MappingCard } from '../components/AnalyticsStrengthSection';
import { formatCheckInDate } from '../lib/AnalyticsScreenHelpers';

const MIN_TARGET = 44;

async function renderTree(element) {
  let tree;
  await act(async () => {
    tree = renderer.create(element);
  });
  return tree;
}

// The Pressable itself (not the host View it renders) is the node that carries
// both the press handler and the authored style/hitSlop.
function pressableByLabel(root, label) {
  const matches = root.findAll(
    (node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function',
    { deep: true }
  );
  if (matches.length === 0) throw new Error(`no pressable labelled "${label}"`);
  return matches[0];
}

function pressableByText(root, text) {
  const matches = root.findAll(
    (node) => typeof node.props?.onPress === 'function'
      && node.findAll((n) => n.props?.children === text, { deep: true }).length > 0,
    { deep: true }
  );
  if (matches.length === 0) throw new Error(`no pressable containing "${text}"`);
  return matches[matches.length - 1];
}

function normalizeSlop(hitSlop) {
  if (typeof hitSlop === 'number') {
    return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop };
  }
  return { top: 0, bottom: 0, left: 0, right: 0, ...(hitSlop || {}) };
}

// Effective target = the box the style guarantees, plus whatever the hitSlop
// adds around it.
function effectiveTarget(node) {
  const style = StyleSheet.flatten(node.props.style) || {};
  const slop = normalizeSlop(node.props.hitSlop);
  return {
    height: (style.minHeight || style.height || 0) + slop.top + slop.bottom,
    width: (style.minWidth || style.width || 0) + slop.left + slop.right,
  };
}

// Compact controls (chips, segmented tabs, the banner's Retry) must clear the
// minimum in both axes. Row-shaped controls stretch to their container's width,
// which a static style cannot state, so only their height is asserted.
function expectTarget(node, { width = false } = {}) {
  const target = effectiveTarget(node);
  expect(target.height).toBeGreaterThanOrEqual(MIN_TARGET);
  if (width) expect(target.width).toBeGreaterThanOrEqual(MIN_TARGET);
}

describe('ErrorBanner retry', () => {
  test('announces itself as a Retry button at the minimum target', async () => {
    const tree = await renderTree(<ErrorBanner message="Failed to load data." onRetry={() => {}} />);
    const retry = pressableByLabel(tree.root, 'Retry');
    expect(retry.props.accessibilityRole).toBe('button');
    expectTarget(retry, { width: true });
  });
});

describe('Settings controls', () => {
  let tree;
  beforeEach(async () => {
    tree = await renderTree(<SettingsScreen multiplier={1.07} onUpdate={() => {}} onBack={() => {}} />);
  });

  test.each([
    ['Use the light appearance', true],
    ['Use the dark appearance', false],
    ['Follow the device appearance', false],
  ])('appearance tab %s carries role, selected state, and target', async (label) => {
    const tab = pressableByLabel(tree.root, label);
    expect(tab.props.accessibilityRole).toBe('button');
    expect(tab.props.accessibilityState).toHaveProperty('selected');
    expectTarget(tab, { width: true });
  });

  test.each([
    'Show weights in pounds',
    'Show weights in kilograms',
  ])('weight-unit tab %s carries role, selected/disabled state, and target', (label) => {
    const tab = pressableByLabel(tree.root, label);
    expect(tab.props.accessibilityRole).toBe('button');
    expect(tab.props.accessibilityState).toEqual({ selected: expect.any(Boolean), disabled: false });
    expectTarget(tab, { width: true });
  });

  test('fatigue-multiplier reset keeps its visible label as its name and clears the target', () => {
    const reset = pressableByText(tree.root, 'Reset to default (1.07)');
    expect(reset.props.accessibilityRole).toBe('button');
    expectTarget(reset);
  });

  test('the fatigue steppers stay at the minimum target', () => {
    expectTarget(pressableByLabel(tree.root, 'Decrease fatigue multiplier'), { width: true });
    expectTarget(pressableByLabel(tree.root, 'Increase fatigue multiplier'), { width: true });
  });
});

describe('User Profile controls', () => {
  let tree;
  beforeEach(async () => {
    tree = await renderTree(<ProfileScreen onBack={() => {}} />);
  });

  test('Clear All announces the destructive action at the minimum target', () => {
    const clearAll = pressableByLabel(tree.root, 'Clear All');
    expect(clearAll.props.accessibilityRole).toBe('button');
    expectTarget(clearAll, { width: true });
  });

  test.each(['Male', 'Female'])('sex toggle %s exposes role and selected state', (label) => {
    const toggle = pressableByLabel(tree.root, label);
    expect(toggle.props.accessibilityRole).toBe('button');
    expect(toggle.props.accessibilityState).toEqual({ selected: false });
    expectTarget(toggle);
  });

  test.each([
    'Enter height in feet and inches',
    'Enter height in centimeters',
  ])('height-unit tab %s exposes role, selected state, and target', (label) => {
    const tab = pressableByLabel(tree.root, label);
    expect(tab.props.accessibilityRole).toBe('button');
    expect(tab.props.accessibilityState).toHaveProperty('selected');
    expectTarget(tab, { width: true });
  });

  test('activity rows expose role and selected state', () => {
    const row = pressableByLabel(tree.root, 'Sedentary. Little or no exercise, desk job');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityState).toEqual({ selected: false });
  });
});

describe('Reminder settings controls', () => {
  let tree;
  beforeEach(async () => {
    tree = await renderTree(<ReminderSettingsCard />);
  });
  afterEach(async () => {
    await act(async () => {
      tree.unmount();
    });
  });

  test.each([
    'Nudge on Sunday',
    'Nudge on Monday',
    'Nudge on Saturday',
  ])('weekday chip %s presses through a real 44dp box, not a hitSlop', (label) => {
    const chip = pressableByLabel(tree.root, label);
    expect(chip.props.accessibilityRole).toBe('button');
    expect(chip.props.accessibilityState).toHaveProperty('selected');
    const style = StyleSheet.flatten(chip.props.style);
    // A hitSlop here would be clipped at the one-circle-tall row's bounds, so
    // the target is the box itself; the circle inside keeps its 36dp diameter.
    expect(chip.props.hitSlop).toBeUndefined();
    expect(style.flex).toBe(1);
    expectTarget(chip);
  });

  test('the weekday targets are contiguous rather than overlapping', () => {
    // Equal `flex: 1` shares of one row: adjacent targets touch, so no press
    // between two circles is lost and none of them claims a neighbour's area.
    const targets = ['Nudge on Sunday', 'Nudge on Monday', 'Nudge on Saturday']
      .map((label) => StyleSheet.flatten(pressableByLabel(tree.root, label).props.style));
    targets.forEach((style) => {
      expect(style.flex).toBe(1);
      expect(style.margin || style.marginHorizontal || 0).toBe(0);
    });
  });

  test.each([
    'Weigh-in reminder time',
    'Workout nudge time',
  ])('reminder time button %s clears the target', (label) => {
    const button = pressableByLabel(tree.root, label);
    expect(button.props.accessibilityRole).toBe('button');
    expectTarget(button);
  });
});

describe('Session check-in chips', () => {
  const checkInData = {
    sessionIndex: 0,
    detectors: ['volume_drop'],
    flagged: [{ name: 'Squat', normName: 'squat', reasons: ['volume_drop'] }],
    metrics: { exercises_skipped: 0, volume_decline_pct: 40 },
  };

  async function openTier(tierLabel) {
    const tree = await renderTree(
      <SessionCheckInModal
        visible
        checkInData={checkInData}
        currentId="note-1"
        currentNote={{ id: 'note-1', session_checkins: {} }}
        update={jest.fn().mockResolvedValue(true)}
        onClose={jest.fn()}
      />
    );
    await act(async () => {
      pressableByLabel(tree.root, tierLabel).props.onPress();
    });
    return tree;
  }

  test('the "normal" tier chips clear the target with a checked state', async () => {
    const tree = await openTier('Normal for me');
    ['No time', 'Short session'].forEach((label) => {
      const chip = pressableByLabel(tree.root, label);
      expect(chip.props.accessibilityRole).toBe('checkbox');
      expect(chip.props.accessibilityState).toEqual({ checked: false });
      expectTarget(chip);
    });
  });

  test('the "rough" tier reason and sub-reason chips clear the target', async () => {
    const tree = await openTier('It was a rough one');
    ['Tired', 'Lower back', 'Left', 'Both'].forEach((label) => {
      const chip = pressableByLabel(tree.root, label);
      expect(chip.props.accessibilityRole).toBe('checkbox');
      expect(chip.props.accessibilityState).toEqual({ checked: false });
      expectTarget(chip);
    });
  });
});

describe('Analytics fatigue history', () => {
  const respondedAt = '2026-02-03T12:00:00.000Z';
  const checkInHistory = {
    rough: [],
    ok: [{ responded_at: respondedAt, reasons: [], note: null, exercises_skipped: 0, volume_decline_pct: null }],
    pending: [],
    summary: { top_reason: null, roughTotal: 0, okTotal: 1, pendingTotal: 0 },
  };

  test('the summary disclosure and the history chips clear the target', async () => {
    const tree = await renderTree(
      <AnalyticsFatigueCard
        checkInHistory={checkInHistory}
        fatigueExpanded
        setFatigueExpanded={() => {}}
        handleCheckInEdit={() => {}}
      />
    );
    const summary = pressableByLabel(tree.root, 'Collapse fatigue details');
    expect(summary.props.accessibilityRole).toBe('button');
    expect(summary.props.accessibilityState).toEqual({ expanded: true });
    expectTarget(summary);

    const chip = pressableByLabel(tree.root, `Edit check-in for ${formatCheckInDate(respondedAt)}`);
    expect(chip.props.accessibilityRole).toBe('button');
    expectTarget(chip, { width: true });
  });
});

describe('Big 3 mapping rows', () => {
  const SLOT_LABELS = { bench: 'Bench', squat: 'Squat', deadlift: 'Deadlift' };

  async function renderCard(activeSlot) {
    return renderTree(
      <AnalyticsBig3MappingCard
        activeSlot={activeSlot}
        handleSlotTap={() => {}}
        SLOT_LABELS={SLOT_LABELS}
        oneKSelections={{ bench: 'Bench Press', squat: 'Back Squat', deadlift: 'Deadlift' }}
        noteExerciseNames={['Bench Press', 'Back Squat']}
        handleSelectExercise={() => {}}
      />
    );
  }

  test('the card disclosure and each slot row clear the target', async () => {
    const tree = await renderCard(null);
    const header = pressableByLabel(tree.root, 'Collapse Big 3 mapping');
    expect(header.props.accessibilityState).toEqual({ expanded: true });
    expectTarget(header);

    const row = pressableByLabel(tree.root, 'Bench, Bench Press, expand');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityState).toEqual({ expanded: false });
    expectTarget(row);
  });

  test('an open slot picker exposes selected options at the target', async () => {
    const tree = await renderCard('bench');
    const selected = pressableByLabel(tree.root, 'Use Bench Press for Bench');
    expect(selected.props.accessibilityRole).toBe('button');
    expect(selected.props.accessibilityState).toEqual({ selected: true });
    expectTarget(selected);

    const other = pressableByLabel(tree.root, 'Use Back Squat for Bench');
    expect(other.props.accessibilityState).toEqual({ selected: false });
    expectTarget(other);
  });
});
