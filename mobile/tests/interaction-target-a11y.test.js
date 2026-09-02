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
// Issue 919: the Weight entry block drives the real WeightScreen, so its two
// entry hooks are stubbed here. `mockWeightState` lets each test seed the
// entries list and goal the screen reads.
const mockWeightState = { entries: [], goal: null };
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
  useWeightEntries: () => ({
    entries: mockWeightState.entries,
    remove: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(true),
    loading: false,
    error: null,
    refresh: jest.fn(),
  }),
  useWeightGoal: () => ({
    goal: mockWeightState.goal,
    loading: false,
    error: null,
    refresh: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    archiveGoal: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../hooks/entries/weightHooks', () => ({
  useArchivedWeightGoals: () => ({ archivedGoals: [], loading: false, refresh: jest.fn() }),
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

// LogRecoverySection calls `useRecoveryBlockLifecycle` at render for the two
// single-field writes it owns (inclusion, reason). Neither is exercised here,
// so the hook is stubbed rather than dragging recovery storage into a
// target-geometry test. The two message constants come from the same module.
jest.mock('../hooks/entries/recoveryBlockHooks', () => ({
  RECOVERY_STALE_MESSAGE: 'Recovery may be out of date.',
  RECOVERY_UNVERIFIED_MESSAGE: 'Recovery could not be read.',
  useRecoveryBlockLifecycle: () => ({
    setIncludeInNormalAnalytics: jest.fn(),
    setBlockReason: jest.fn(),
  }),
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

// Issue 920: the More menu rows are asserted against the real MoreScreen.
// Only the sub-views it imports but never renders at the menu are stubbed;
// SettingsScreen and ProfileScreen stay real because this file already
// exercises them above.
jest.mock('../components/HelpScreen', () => ({ HelpScreen: () => null }));
jest.mock('../components/AboutScreen', () => ({ AboutScreen: () => null }));
jest.mock('../components/BackupScreen', () => ({ BackupScreen: () => null }));
jest.mock('../screens/more/AccountScreen', () => ({ AccountScreen: () => null }));
jest.mock('../screens/more/AccountLifecycle', () => ({ AccountLifecycle: () => null }));

import { ErrorBanner } from '../components/UI';
import { MoreScreen } from '../screens/MoreScreen';
import { SettingsScreen } from '../components/SettingsScreen';
import { ProfileScreen } from '../components/ProfileScreen';
import { ReminderSettingsCard } from '../components/ReminderSettingsCard';
import { SessionCheckInModal } from '../components/SessionCheckInModal';
import { AnalyticsFatigueCard } from '../components/AnalyticsFatigueCard';
import { AnalyticsBig3MappingCard } from '../components/AnalyticsStrengthSection';
import { LogRecoverySection } from '../components/LogRecoverySection';
import { WeightScreen } from '../screens/WeightScreen';
import { WeightGoalCard } from '../components/WeightGoalCard';
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
  ])('weekday chip %s presses through a real box, not a hitSlop', (label) => {
    const chip = pressableByLabel(tree.root, label);
    // Independently selectable days are a multi-select, so they announce as
    // checkboxes with a checked state rather than as selected buttons.
    expect(chip.props.accessibilityRole).toBe('checkbox');
    expect(chip.props.accessibilityState).toEqual({ checked: expect.any(Boolean) });
    const style = StyleSheet.flatten(chip.props.style);
    // A hitSlop here would be clipped at the row's bounds, so the target is
    // the box itself; the circle inside keeps its 36dp diameter.
    expect(chip.props.hitSlop).toBeUndefined();
    expect(style.height).toBe(MIN_TARGET);
    expect(style.width).toBe('25%');
  });

  // The row is a four-column grid, so the target width is a quarter of the
  // card's inner width. Seven 44dp targets across need 308dp and a 320dp
  // screen offers 252dp, so the grid wraps 4 + 3 instead of shrinking.
  test.each([320, 375, 448])(
    'each weekday target clears 44dp in both axes at %idp',
    (viewportWidth) => {
      // ScreenShell's content padding is 16 per side; Card's padding is 18.
      const innerWidth = viewportWidth - 2 * 16 - 2 * 18;
      const style = StyleSheet.flatten(pressableByLabel(tree.root, 'Nudge on Monday').props.style);
      const columns = 100 / parseFloat(style.width);
      expect(innerWidth / columns).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(style.height).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  );

  test('the weekday targets tile the grid rather than overlapping', () => {
    const targets = ['Nudge on Sunday', 'Nudge on Monday', 'Nudge on Saturday']
      .map((label) => StyleSheet.flatten(pressableByLabel(tree.root, label).props.style));
    targets.forEach((style) => {
      // Equal, gapless columns: adjacent targets touch, and none of them
      // claims area belonging to a neighbour.
      expect(style.width).toBe('25%');
      expect(style.margin || style.marginHorizontal || 0).toBe(0);
    });
    const row = tree.root.findAll(
      (node) => (StyleSheet.flatten(node.props?.style) || {}).flexWrap === 'wrap'
        && (StyleSheet.flatten(node.props?.style) || {}).flexDirection === 'row',
      { deep: true }
    );
    expect(row.length).toBeGreaterThan(0);
    expect(StyleSheet.flatten(row[0].props.style).gap).toBeUndefined();
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

// Issue 921: Recovery's two expanded-note controls used to sit below the floor
// — `Edit note` at a fixed 36dp with no slop, and the A/B segment at 32dp with
// a `hitSlop` of 6 that never applied, because `noteSurfaceHeader` is an
// unsized row the segment itself was the tallest child of. Both now present a
// real >=44x44dp box, and neither declares a fixed `height`, so a later style
// edit that reintroduces either failure fails here.
describe('Recovery expanded-note controls', () => {
  const note = {
    id: 'note-ab',
    title: 'AB Week',
    raw_text: 'Monday\n+Lifting\n-Bench\n135 5,5,5',
  };
  const block = {
    id: 'rb-921',
    baseline_note_id: 'baseline',
    baseline_note_title: 'Legs Day',
    started_at: '2026-01-01T00:00:00.000Z',
    completed_at: null,
    deleted_at: null,
  };
  const week = {
    id: 'rw-921',
    block_id: block.id,
    note_id: note.id,
    week_number: 1,
    completed_at: null,
    deleted_at: null,
  };

  async function renderExpandedNote() {
    return renderTree(
      <LogRecoverySection
        blocks={[block]}
        weeks={[week]}
        notes={[note]}
        viewingNoteId={note.id}
        viewingNote={note}
        viewingNoteDayGroups={[{ heading: 'Monday', sections: [] }]}
        viewingHasABWeeks
        viewingEffectiveWeek="A"
        onViewNote={() => {}}
        onEditNote={() => {}}
        onToggleViewingWeek={() => {}}
      />
    );
  }

  test('Edit note clears the target from its own box and can still grow with text', async () => {
    const tree = await renderExpandedNote();
    const edit = pressableByLabel(tree.root, 'Edit');
    expect(edit.props.accessibilityRole).toBe('button');
    expect(edit.props.hitSlop).toBeUndefined();
    expectTarget(edit, { width: true });

    const style = StyleSheet.flatten(edit.props.style) || {};
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBe(MIN_TARGET);
    // The outlined treatment the control has carried since #843 is unchanged.
    expect(style.borderWidth).toBe(1);
    expect(style.borderRadius).toBe(10);
  });

  test('the A/B segment presses through a real 44dp box around its 32dp visual', async () => {
    const tree = await renderExpandedNote();
    const segment = pressableByLabel(tree.root, 'Switch to Week B');
    expect(segment.props.accessibilityRole).toBe('button');
    expect(segment.props.accessibilityState).toEqual({ selected: false });
    // The target is the box, never a slop React Native would clip at
    // `noteSurfaceHeader`'s bounds.
    expect(segment.props.hitSlop).toBeUndefined();
    expectTarget(segment, { width: true });

    const targetStyle = StyleSheet.flatten(segment.props.style) || {};
    expect(targetStyle.height).toBeUndefined();

    // The visual inside it still reads at its designed 32dp, by `minHeight` so
    // it grows with the user's text scale rather than clipping the letters.
    const visuals = segment.findAll((node) => {
      if (typeof node.type !== 'string') return false;
      const style = StyleSheet.flatten(node.props?.style) || {};
      return style.minHeight === 32 && style.flexDirection === 'row';
    }, { deep: true });
    expect(visuals).toHaveLength(1);
    expect(StyleSheet.flatten(visuals[0].props.style).height).toBeUndefined();
  });

  test('the segment reports the selected half it would switch away from', async () => {
    const tree = await renderTree(
      <LogRecoverySection
        blocks={[block]}
        weeks={[week]}
        notes={[note]}
        viewingNoteId={note.id}
        viewingNote={note}
        viewingNoteDayGroups={[{ heading: 'Monday', sections: [] }]}
        viewingHasABWeeks
        viewingEffectiveWeek="B"
        onViewNote={() => {}}
        onEditNote={() => {}}
        onToggleViewingWeek={() => {}}
      />
    );
    const segment = pressableByLabel(tree.root, 'Switch to Week A');
    expect(segment.props.accessibilityState).toEqual({ selected: true });
    expectTarget(segment, { width: true });
  });
});

// Issue 920: the six More menu rows now carry the shared MaterialIcons chevron
// (no text arrow), no `colors.error` border, and an explicit 44dp floor. The
// row is a full-width control, so only its height is asserted; the chevron is
// hidden from the screen reader, so each row still announces its name once.
describe('More menu rows', () => {
  const ROW_LABELS = [
    'User Profile',
    'Settings',
    'Account',
    'Data and Backup',
    'App Guide',
    'About Kilo',
  ];

  let tree;
  beforeEach(async () => {
    tree = await renderTree(<MoreScreen isActive={false} />);
  });

  test.each(ROW_LABELS)('row %s declares the 44dp floor with its button role and name', (label) => {
    const row = pressableByLabel(tree.root, label);
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe(label);
    const style = StyleSheet.flatten(row.props.style) || {};
    expect(style.minHeight).toBe(MIN_TARGET);
    expectTarget(row);
  });

  test('the two former "risky" rows share the neutral border of the other four', () => {
    const neutral = StyleSheet.flatten(pressableByLabel(tree.root, 'User Profile').props.style);
    expect(neutral.borderWidth).toBe(1);
    ['Account', 'Data and Backup'].forEach((label) => {
      const style = StyleSheet.flatten(pressableByLabel(tree.root, label).props.style) || {};
      expect(style.borderWidth).toBe(1);
      // Same shared cardBorder token as every other card, not colors.error.
      expect(style.borderColor).toBe(neutral.borderColor);
    });
  });

  test('no navigation affordance renders a text arrow', () => {
    const arrows = tree.root.findAll(
      (node) => typeof node.props?.children === 'string' && node.props.children.includes('\u2192'),
      { deep: true }
    );
    expect(arrows).toHaveLength(0);
  });
});

// Issue 919: nine text-only editor actions on the Weight tab used to sit below
// the §15 floor across eleven render sites. On WeightScreen the `cancelText`
// family (the editing-header `Cancel` plus the four disclosure `Done`s) backed
// bare Pressables with no target box at all, and the header `Cancel` shipped no
// role or name. On WeightGoalCard the `goalActionChip` (`Edit` / `Archive` /
// `Clear`, five sites) and the goal-editor `Cancel` reached for a `hitSlop`
// §15 says a one-line row clips. Each now owns a real >=44x44dp box from its
// own style — asserted as the flattened minHeight/minWidth so a later style
// edit fails here rather than shipping a 27dp tap area — with the two `Cancel`s
// gaining `accessibilityRole="button"` and a name matching their visible label.
function pressableByTestId(root, testID) {
  const matches = root.findAll(
    (node) => node.props?.testID === testID && typeof node.props?.onPress === 'function',
    { deep: true }
  );
  if (matches.length === 0) throw new Error(`no pressable with testID "${testID}"`);
  return matches[0];
}

function pressableContainingText(root, substr) {
  const matches = root.findAll(
    (node) => typeof node.props?.onPress === 'function'
      && node.findAll((n) => {
        const c = n.props?.children;
        const flat = Array.isArray(c) ? c.join('') : String(c ?? '');
        return flat.includes(substr);
      }, { deep: true }).length > 0,
    { deep: true }
  );
  if (matches.length === 0) throw new Error(`no pressable containing "${substr}"`);
  return matches[matches.length - 1];
}

function expectOwnBox(node) {
  const style = StyleSheet.flatten(node.props.style) || {};
  expect(node.props.hitSlop).toBeUndefined();
  expect(style.minHeight).toBe(MIN_TARGET);
  expect(style.minWidth).toBe(MIN_TARGET);
  expectTarget(node, { width: true });
}

describe('Weight entry controls', () => {
  const WEIGHT_PROPS = {
    weightValue: '',
    setWeightValue: () => {},
    weightNote: '',
    setWeightNote: () => {},
    onSaveWeight: () => {},
    errorMessage: '',
    saving: false,
    isActive: true,
  };

  afterEach(() => {
    mockWeightState.entries = [];
    mockWeightState.goal = null;
  });

  test('the two new-entry disclosure "Done" actions clear the floor from their own box', async () => {
    const tree = await renderTree(<WeightScreen {...WEIGHT_PROPS} />);

    await act(async () => {
      pressableByTestId(tree.root, 'weight-new-note-toggle').props.onPress();
      pressableByTestId(tree.root, 'weight-new-date-toggle').props.onPress();
    });

    [['Done adding note'], ['Done changing weigh-in date']].forEach(([label]) => {
      const done = pressableByLabel(tree.root, label);
      expect(done.props.accessibilityRole).toBe('button');
      expect(done.props.accessibilityLabel).toBe(label);
      expectOwnBox(done);
    });
  });

  test('the editing-header Cancel and the two edit disclosure "Done" actions clear the floor', async () => {
    mockWeightState.entries = [{
      id: 'e1',
      date: '2026-05-24',
      logged_at: '2026-05-24T08:00:00Z',
      weight_value: 185,
      weight_unit: 'lb',
      note: '',
    }];
    const tree = await renderTree(<WeightScreen {...WEIGHT_PROPS} />);

    // History is collapsed by default; expand it, then tap the row to enter
    // editing mode so the header and edit-path disclosures render.
    await act(async () => {
      pressableByLabel(tree.root, 'Expand history').props.onPress();
    });
    await act(async () => {
      pressableContainingText(tree.root, '185').props.onPress();
    });

    const cancel = pressableByLabel(tree.root, 'Cancel');
    expect(cancel.props.accessibilityRole).toBe('button');
    expect(cancel.props.accessibilityLabel).toBe('Cancel');
    expectOwnBox(cancel);

    await act(async () => {
      pressableByTestId(tree.root, 'weight-edit-note-toggle').props.onPress();
      pressableByTestId(tree.root, 'weight-edit-date-toggle').props.onPress();
    });

    [['Done editing note'], ['Done changing entry date']].forEach(([label]) => {
      const done = pressableByLabel(tree.root, label);
      expect(done.props.accessibilityRole).toBe('button');
      expect(done.props.accessibilityLabel).toBe(label);
      expectOwnBox(done);
    });
  });
});

describe('Weight goal editor actions', () => {
  const GOAL = { target_weight: 180, target_date: '2026-12-01', start_weight: 200 };
  const GOAL_PROPS = {
    goal: GOAL,
    goalEditing: false,
    goalTargetWeight: '180',
    goalTargetDate: '2026-12-01',
    goalStartWeight: '200',
    setGoalTargetWeight: () => {},
    setGoalStartWeight: () => {},
    goalError: '',
    showDatePicker: false,
    setShowDatePicker: () => {},
    handleSaveGoal: () => {},
    handleClearGoal: () => {},
    handleArchiveGoal: () => {},
    startEditGoal: () => {},
    cancelEditGoal: () => {},
    onDateChange: () => {},
    pickerDate: new Date('2026-12-01'),
    goalInfo: null,
    calorieEstimate: null,
    currentWeight: 190,
    isGoalMet: false,
    aheadOfSchedule: false,
  };

  test('the goal-met header exposes Edit and Archive at the floor from their own box', async () => {
    const tree = await renderTree(<WeightGoalCard {...GOAL_PROPS} isGoalMet />);
    ['Edit', 'Archive'].forEach((label) => {
      const chip = pressableByLabel(tree.root, label);
      expect(chip.props.accessibilityRole).toBe('button');
      expect(chip.props.accessibilityLabel).toBe(label);
      expectOwnBox(chip);
    });
  });

  test('the overdue in-progress header exposes Edit, Archive and Clear at the floor', async () => {
    const tree = await renderTree(
      <WeightGoalCard {...GOAL_PROPS} goalInfo={{ isOverdue: true, weeks_remaining: 0, required_weekly_pace: null }} />
    );
    ['Edit', 'Archive', 'Clear'].forEach((label) => {
      const chip = pressableByLabel(tree.root, label);
      expect(chip.props.accessibilityRole).toBe('button');
      expect(chip.props.accessibilityLabel).toBe(label);
      expectOwnBox(chip);
    });
  });

  test('the goal-editor Cancel clears the floor and announces itself', async () => {
    const tree = await renderTree(<WeightGoalCard {...GOAL_PROPS} goalEditing />);
    const cancel = pressableByLabel(tree.root, 'Cancel');
    expect(cancel.props.accessibilityRole).toBe('button');
    expect(cancel.props.accessibilityLabel).toBe('Cancel');
    expectOwnBox(cancel);
  });
});
