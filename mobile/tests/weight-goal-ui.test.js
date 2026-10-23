import React from 'react';
import render from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { WeightScreen } from '../screens/WeightScreen';
import * as useEntries from '../hooks/useEntries';
import * as weightHooks from '../hooks/entries/weightHooks';
import { LightColors, KUA_PALETTES } from '../theme/colors';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
});

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return function MockDateTimePicker() {
    return null;
  };
});

jest.mock('../hooks/useEntries');
jest.mock('../hooks/entries/weightHooks');

// Mock current date for consistent testing
// May 24, 2026 is a Sunday at noon local time (timezone-invariant).
// Aug 2, 2026 is exactly 10 weeks later.
// Use local time construction to ensure the date is the same across all timezones.
const MOCK_NOW = new Date(2026, 4, 24, 12, 0, 0);
// Fake timers are installed per-test, not at module scope: a module-scope
// jest.useFakeTimers() contaminates React/react-test-renderer scheduler state
// during import-graph evaluation, which then leaks across Jest's shared worker
// into the next test file (#679).
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
});
afterEach(() => {
  jest.useRealTimers();
});

import { deriveWeightGoalAnalytics } from '../lib/data';

describe('WeightScreen', () => {
  test('renders overdue goal state', () => {
    const goal = { target_weight: 180, target_date: '2026-05-20', start_weight: 200 };
    const entries = [
      { id: '1', date: '2026-05-24', weight_value: 195.0, note: '' },
      { id: '2', date: '2026-05-23', weight_value: 196.0, note: '' },
    ];
    const component = setup(goal, entries);
    const root = component.root;

    expect(findText(root, 'Goal ended')).toBeTruthy();
    expect(findText(root, 'Select a future target date for guidance.')).toBeFalsy();

    const allTexts = root.findAllByType('Text').map(t => {
      const children = t.props.children;
      return Array.isArray(children) ? children.join('') : String(children ?? '');
    });

    for (const txt of allTexts) {
      expect(txt.includes('NaN')).toBe(false);
      expect(txt.includes('Infinity')).toBe(false);
      expect(txt).not.toMatch(/-\d+\s+weeks/);
    }
  });

  const defaultProps = {
    weightValue: '',
    setWeightValue: jest.fn(),
    weightNote: '',
    setWeightNote: jest.fn(),
    onSaveWeight: jest.fn(),
    errorMessage: '',
    saving: false,
  };

  const setup = (goal, entries = [], archivedGoals = [], save = jest.fn()) => {
    useEntries.useWeightEntries.mockReturnValue({ entries, remove: jest.fn(), update: jest.fn() });
    useEntries.useWeightGoal.mockReturnValue({ goal, save, clear: jest.fn(), archiveGoal: jest.fn() });
    weightHooks.useArchivedWeightGoals.mockReturnValue({ archivedGoals, loading: false, refresh: jest.fn() });
    let component;
    render.act(() => {
      component = render.create(<WeightScreen {...defaultProps} />);
    });
    return component;
  };

  // #1601: with no goal the Goal panel shows a compact "Set a goal" that
  // opens the existing form.
  const openGoalSetup = (root) => {
    const btn = root.find(n => n.props && n.props.accessibilityLabel === 'Set a goal' && typeof n.props.onPress === 'function');
    render.act(() => { btn.props.onPress(); });
  };

  // Recursively flatten React children without JSON.stringify to avoid circular crashes.
  // Extracts text from nested fragments and React elements.
  const flattenChildren = (children) => {
    if (children == null) return '';
    if (typeof children === 'string' || typeof children === 'number') return String(children);
    if (Array.isArray(children)) {
      return children.map(flattenChildren).join('');
    }
    // For React elements/objects with children prop, recursively flatten
    if (typeof children === 'object' && children.props && children.props.children !== undefined) {
      return flattenChildren(children.props.children);
    }
    // For other objects, return empty string (avoids [object Object] strings)
    return '';
  };

  const findText = (root, text) => {
    const allText = root.findAllByType('Text');
    return allText.find(t => {
      const flat = flattenChildren(t.props.children);
      return flat.includes(text);
    });
  };

  test('renders today target date as completed/overdue state (weeks_remaining <= 0)', () => {
    const goal = { target_weight: 180, target_date: '2026-05-24', start_weight: 200 };
    const component = setup(goal);
    const root = component.root;

    expect(findText(root, 'Goal ended')).toBeTruthy();
    expect(findText(root, 'Select a future target date for guidance.')).toBeFalsy();
  });

  test('renders "maintain" state', () => {
    const goal = { target_weight: 180, target_date: '2026-06-24', start_weight: 180 };
    const component = setup(goal);
    const root = component.root;

    expect(findText(root, 'Maintain')).toBeTruthy();
    expect(findText(root, 'Current weight is within maintenance range.')).toBeTruthy();
  });

  test('renders "loss" state', () => {
    const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 200 };
    const component = setup(goal);
    const root = component.root;

    // 200 -> 190 in 70 days (10 weeks) = 1.00 lb/week. #1601: the Target pace
    // and Suggested split cells read "1.00 lb/wk" and "500 cal/day".
    expect(findText(root, '1.00 lb/wk')).toBeTruthy();
    expect(findText(root, 'Suggested deficit')).toBeTruthy();
    expect(findText(root, '500 cal/day')).toBeTruthy();
  });

  test('renders "gain" state', () => {
    const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 180 };
    const component = setup(goal);
    const root = component.root;

    // 180 -> 190 in 70 days (10 weeks) = 1.00 lb/week
    expect(findText(root, '1.00 lb/wk')).toBeTruthy();
    expect(findText(root, 'Suggested surplus')).toBeTruthy();
    expect(findText(root, '500 cal/day')).toBeTruthy();
  });

  test('renders health warnings (unhealthy pace)', () => {
    const goal = { target_weight: 180, target_date: '2026-08-02', start_weight: 200 };
    const component = setup(goal);
    const root = component.root;

    expect(findText(root, 'Pace is aggressive - a slower target is safer.')).toBeTruthy();
  });

  test('renders unrealistic warnings', () => {
    const goal = { target_weight: 150, target_date: '2026-06-28', start_weight: 200 };
    const component = setup(goal);
    const root = component.root;

    expect(findText(root, 'Pace is unrealistic - consider a longer timeline.')).toBeTruthy();
  });

  describe('goal card guidance and progress hierarchy (#405)', () => {
    const getStyleProp = (node, propName) => {
      const style = node.props.style;
      if (!style) return undefined;
      if (Array.isArray(style)) {
        const flat = style.flat();
        for (let i = flat.length - 1; i >= 0; i--) {
          if (flat[i] && flat[i][propName] !== undefined) return flat[i][propName];
        }
        return undefined;
      }
      return style[propName];
    };

    const findByExactText = (root, text) =>
      root.findAllByType('Text').find(t => {
        const children = t.props.children;
        return (Array.isArray(children) ? children.join('') : String(children ?? '')) === text;
      });

    test('goal-derived guidance renders inline in the goal card display (no standalone Guidance card)', () => {
      const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 200 };
      const entries = [{ id: '1', date: '2026-05-24', weight_value: 195.0, note: '' }];
      const component = setup(goal, entries);
      const root = component.root;

      // Guidance content is present...
      expect(findText(root, 'Target pace')).toBeTruthy();
      // ...but the old standalone "Guidance" card title is gone.
      const allTexts = root.findAllByType('Text').map(t => {
        const children = t.props.children;
        return Array.isArray(children) ? children.join('') : String(children ?? '');
      });
      expect(allTexts.includes('Guidance')).toBe(false);
    });

    test('shows remaining distance to target when current weight is known', () => {
      const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 200 };
      const entries = [{ id: '1', date: '2026-05-24', weight_value: 195.0, note: '' }];
      const component = setup(goal, entries);
      const root = component.root;

      // |195 - 190| = 5.0 lb to go
      expect(findText(root, '5.0 lb')).toBeTruthy();
      expect(findText(root, 'to go')).toBeTruthy();
    });

    test('hides remaining distance for an overdue goal', () => {
      const goal = { target_weight: 180, target_date: '2026-05-20', start_weight: 200 };
      const entries = [{ id: '1', date: '2026-05-24', weight_value: 195.0, note: '' }];
      const component = setup(goal, entries);
      const root = component.root;

      expect(findText(root, 'Goal ended')).toBeTruthy();
      const allTexts = root.findAllByType('Text').map(t => {
        const children = t.props.children;
        return Array.isArray(children) ? children.join('') : String(children ?? '');
      });
      expect(allTexts.some(txt => txt.includes('to go'))).toBe(false);
    });

    // #1601: split-cell labels are the 12px mono label-md role (weight is in
    // the JetBrains Mono family), uppercase, under 18px mono values.
    test('derived labels use compact 12px uppercase hierarchy so they do not compete with values', () => {
      const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 200 };
      const entries = [{ id: '1', date: '2026-05-24', weight_value: 195.0, note: '' }];
      const component = setup(goal, entries);
      const label = findByExactText(component.root, 'Target pace');
      expect(label).toBeTruthy();
      expect(getStyleProp(label, 'fontSize')).toBe(12);
      expect(getStyleProp(label, 'fontFamily')).toBe('JetBrainsMono-Medium');
      expect(getStyleProp(label, 'textTransform')).toBe('uppercase');
      const value = component.root.findAllByType('Text').find(t => /^\d+\.\d{2} lb\/wk$/.test(flattenChildren(t.props.children)));
      expect(value).toBeTruthy();
      expect(StyleSheet.flatten(value.props.style).fontSize).toBeGreaterThan(12);
    });
  });

  test('renders merged trends using entry.date windows', () => {
    const entries = [
      { id: '1', date: '2026-05-24', logged_at: '2026-05-24T22:15:00Z', weight_value: 185.0, note: '' },
      { id: '2', date: '2026-05-23', logged_at: '2026-05-23T22:15:00Z', weight_value: 184.0, note: '' },
      { id: '3', date: '2026-05-18', logged_at: '2026-05-18T22:15:00Z', weight_value: 183.0, note: '' },
      { id: '4', date: '2026-05-12', logged_at: '2026-05-12T22:15:00Z', weight_value: 181.0, note: '' },
      { id: '5', date: '2026-05-11', logged_at: '2026-05-11T22:15:00Z', weight_value: 180.0, note: '' },
      { id: '6', date: '2026-04-25', logged_at: '2026-04-25T22:15:00Z', weight_value: 178.0, note: '' },
    ];
    const component = setup(null, entries);
    const root = component.root;

    // #1601: the Latest panel carries the same date-bucketed values: the
    // latest weigh-in with its change vs the previous day, and the 7-/30-day
    // rolling averages with their vs-prior-window change.
    const cellTexts = (testID) => root.findAll(n => n.props?.testID === testID && typeof n.type === 'string')[0]
      .findAllByType('Text').map(t => flattenChildren(t.props.children));
    expect(findText(root, 'Latest · 05-24-2026')).toBeTruthy();
    expect(root.findAll(n => n.props?.accessibilityLabel === 'Latest weigh-in 185 lb').length).toBeGreaterThan(0);
    expect(cellTexts('weight-latest-change')).toEqual(['+1.0']);

    expect(cellTexts('weight-avg-7')).toEqual(['7-day avg', '184.0', '+3.5']);
    // 30-day window has no prior window -> no change is drawn.
    expect(cellTexts('weight-avg-30')).toEqual(['30-day avg', '181.8']);
  });

  test('uses logged_at for history display while trends still use date buckets', () => {
    const entries = [
      { id: '1', date: '2026-05-24', logged_at: '2026-05-20T08:30:00Z', weight_value: 185.0, note: 'after travel' },
    ];
    const component = setup(null, entries);
    const root = component.root;
    // Weight History is collapsed by default (#898); expand to see the row.
    render.act(() => {
      root.findByProps({ accessibilityLabel: 'Expand history' }).props.onPress();
    });

    expect(findText(root, '05-20-2026')).toBeTruthy();
    // #1601: history rows show the logged value with its unit ("185 lb").
    expect(findText(root, '185 lb')).toBeTruthy();
    expect(findText(root, 'after travel')).toBeTruthy();
  });

  describe('goal-aware weight delta highlighting', () => {
    const getStyleProp = (node, propName) => {
      const style = node.props.style;
      if (!style) return undefined;
      if (Array.isArray(style)) {
        const flat = style.flat();
        for (let i = flat.length - 1; i >= 0; i--) {
          if (flat[i] && flat[i][propName] !== undefined) {
            return flat[i][propName];
          }
        }
        return undefined;
      }
      return style[propName];
    };

    const isHistoryDeltaText = (node) => {
      const style = node.props.style;
      if (!style) return false;
      const flat = Array.isArray(style) ? style.flat() : [style];
      // #1601: history Change cells are 15px mono, right-aligned.
      return flat.some(s => s && s.fontSize === 15 && s.textAlign === 'right');
    };

    test('suppresses warnings for weight loss when goal is weight loss, but warns on weight gain', () => {
      const goal = { target_weight: 180, target_date: '2026-08-02', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185.0, note: '' },
        { id: '2', date: '2026-05-23', logged_at: '2026-05-23T08:00:00Z', weight_value: 182.0, note: '' }, // +3.0 delta relative to next
        { id: '3', date: '2026-05-22', logged_at: '2026-05-22T08:00:00Z', weight_value: 185.0, note: '' }, // -3.0 delta relative to next
        { id: '4', date: '2026-05-21', logged_at: '2026-05-21T08:00:00Z', weight_value: 188.0, note: '' },
      ];
      const component = setup(goal, entries);
      const root = component.root;
      // Weight History is collapsed by default (#898); expand to see the rows.
      render.act(() => {
        root.findByProps({ accessibilityLabel: 'Expand history' }).props.onPress();
      });

      const texts = root.findAllByType('Text');
      const historyDeltaTexts = texts.filter(isHistoryDeltaText);
      const positiveDeltaText = historyDeltaTexts.find(t => t.props.children === '+3.0');
      const negativeDeltaText = historyDeltaTexts.find(t => t.props.children === '-3.0');

      expect(positiveDeltaText).toBeTruthy();
      expect(negativeDeltaText).toBeTruthy();

      // Positive delta (+3.0) goes opposite to the weight loss goal, so it should be highlighted (warn)
      const posColor = getStyleProp(positiveDeltaText, 'color');
      expect(posColor).not.toBe(LightColors.textMuted);
      expect(posColor).toBeTruthy();

      // Negative delta (-3.0) matches the weight loss goal, so it should NOT be highlighted (remain muted)
      const negColor = getStyleProp(negativeDeltaText, 'color');
      expect(negColor).toBe(KUA_PALETTES.hardCourt.light.onSurfaceVariant);
    });

    test('suppresses warnings for weight gain when goal is weight gain, but warns on weight loss', () => {
      const goal = { target_weight: 200, target_date: '2026-08-02', start_weight: 180 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185.0, note: '' },
        { id: '2', date: '2026-05-23', logged_at: '2026-05-23T08:00:00Z', weight_value: 182.0, note: '' }, // +3.0 delta relative to next
        { id: '3', date: '2026-05-22', logged_at: '2026-05-22T08:00:00Z', weight_value: 185.0, note: '' }, // -3.0 delta relative to next
        { id: '4', date: '2026-05-21', logged_at: '2026-05-21T08:00:00Z', weight_value: 188.0, note: '' },
      ];
      const component = setup(goal, entries);
      const root = component.root;
      // Weight History is collapsed by default (#898); expand to see the rows.
      render.act(() => {
        root.findByProps({ accessibilityLabel: 'Expand history' }).props.onPress();
      });

      const texts = root.findAllByType('Text');
      const historyDeltaTexts = texts.filter(isHistoryDeltaText);
      const positiveDeltaText = historyDeltaTexts.find(t => t.props.children === '+3.0');
      const negativeDeltaText = historyDeltaTexts.find(t => t.props.children === '-3.0');

      expect(positiveDeltaText).toBeTruthy();
      expect(negativeDeltaText).toBeTruthy();

      // Positive delta (+3.0) matches weight gain goal, so it should NOT be highlighted
      const posColor = getStyleProp(positiveDeltaText, 'color');
      expect(posColor).toBe(KUA_PALETTES.hardCourt.light.onSurfaceVariant);

      // Negative delta (-3.0) goes opposite to the weight gain goal, so it should be highlighted
      const negColor = getStyleProp(negativeDeltaText, 'color');
      expect(negColor).not.toBe(LightColors.textMuted);
      expect(negColor).toBeTruthy();
    });
  });

  describe('met-goal lifecycle', () => {
    // Safe text search that does not fall back to JSON.stringify (avoids
    // circular-fiber crash for "not found" assertions).
    const hasTextSafe = (root, text) =>
      root.findAllByType('Text').some(t => {
        const children = t.props.children;
        const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
        return flat.includes(text);
      });

    test('shows "Goal Met!" badge when current weight has reached a loss goal on its target date', () => {
      // Loss goal: target 175, start 200, target date is today (MOCK_NOW). Current
      // weight entry at 175 → both the weight threshold and the date are met.
      const goal = { target_weight: 175, target_date: '2026-05-24', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 175, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(true);
    });

    test('shows "Archive" action chip when goal is met on its target date', () => {
      const goal = { target_weight: 175, target_date: '2026-05-24', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 174, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'Archive')).toBe(true);
    });

    // #549: reaching the target weight before target_date is progress, not
    // completion — the target date is part of the goal contract.
    test('shows "On Track" instead of "Goal Met!" when the weight threshold is reached before target_date', () => {
      // Loss goal: target 175, start 200. Current weight entry at 175, but the
      // target date (2026-09-01) is still months away (today is 2026-05-24).
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 175, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'On Track')).toBe(true);
      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(false);
      expect(hasTextSafe(component.root, 'Archive')).toBe(false);
      // Normal in-progress guidance (Edit/Clear) remains available.
      expect(hasTextSafe(component.root, 'Clear')).toBe(true);
    });

    // #549 review follow-up: a screen left mounted across local midnight must
    // transition out of "On Track" into "Goal Met!" once target_date arrives,
    // without requiring a weight change or remount.
    test('transitions from "On Track" to "Goal Met!" when local midnight crosses into target_date', () => {
      // Loss goal: target 175, start 200, target date is tomorrow relative to
      // MOCK_NOW (2026-05-24). Current weight already at target.
      const goal = { target_weight: 175, target_date: '2026-05-25', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 175, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'On Track')).toBe(true);
      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(false);

      render.act(() => {
        // Cross local midnight into 2026-05-25 and let the scheduled refresh fire.
        jest.setSystemTime(new Date(2026, 4, 25, 12, 0, 0));
        jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      });

      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(true);
      expect(hasTextSafe(component.root, 'On Track')).toBe(false);
      expect(hasTextSafe(component.root, 'Archive')).toBe(true);
    });

    test('does not show "Goal Met!" or "Archive" when goal is in progress', () => {
      // Loss goal: target 175, start 200. Current at 185 — not yet met.
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(false);
      expect(hasTextSafe(component.root, 'Archive')).toBe(false);
    });

    test('shows "Clear" action when goal is in progress (not met)', () => {
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'Clear')).toBe(true);
    });

    test('shows "Goal Met!" for a gain goal when current reaches target on its target date', () => {
      const goal = { target_weight: 185, target_date: '2026-05-24', start_weight: 160 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 186, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(true);
    });

    test('shows "Archive" action chip when goal is overdue (target date passed, weight not reached)', () => {
      // Loss goal: target 175 not yet reached; target date in the past (overdue).
      const goal = { target_weight: 175, target_date: '2026-05-20', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'Archive')).toBe(true);
    });

    test('active goal target omits .0 for whole numbers and keeps real decimals (#1266)', () => {
      const whole = setup({ target_weight: 175, target_date: '2099-01-01', start_weight: 190 }, []);
      expect(hasTextSafe(whole.root, '175 lb')).toBe(true);
      const frac = setup({ target_weight: 175.5, target_date: '2099-01-01', start_weight: 190 }, []);
      expect(hasTextSafe(frac.root, '175.5 lb')).toBe(true);
    });

    // #1601 supersedes #1459's form-first no-goal state: Weight shows a
    // compact "Set a goal" (no progress, pace or deficit) that opens the
    // existing goal form; Cancel returns to the compact state.
    test('no goal shows a compact Set a goal that opens the existing form (#1601)', () => {
      const component = setup(null, []);
      const root = component.root;
      expect(hasTextSafe(root, 'Goal Met!')).toBe(false);
      expect(hasTextSafe(root, 'Archive')).toBe(false);
      expect(hasTextSafe(root, 'No goal set.')).toBe(true);
      expect(hasTextSafe(root, 'Target pace')).toBe(false);
      expect(hasTextSafe(root, 'Suggested')).toBe(false);
      expect(root.findAll(n => n.props?.testID === 'weight-goal-progress')).toHaveLength(0);
      expect(hasTextSafe(root, 'Save goal')).toBe(false);
      expect(root.findAll(n => n.type === 'TextInput' && n.props.placeholder === '175.0')).toHaveLength(0);

      openGoalSetup(root);
      expect(hasTextSafe(root, 'Save goal')).toBe(true);
      expect(root.findAll(n => n.type === 'TextInput' && n.props.placeholder === '175.0')).toHaveLength(1);
      expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Goal target date').length).toBeGreaterThan(0);

      const cancel = root.findAll(n => typeof n.props?.onPress === 'function' && n.props.label === 'Cancel')[0];
      render.act(() => { cancel.props.onPress(); });
      expect(hasTextSafe(root, 'Save goal')).toBe(false);
      expect(hasTextSafe(root, 'No goal set.')).toBe(true);
    });

    test('a failed goal save keeps the draft open with an error and never shows success', async () => {
      const component = setup(null, [], [], jest.fn().mockRejectedValue(new Error('disk full')));
      openGoalSetup(component.root);
      const press = (label) => render.act(async () => {
        const text = component.root.findAllByType('Text').find(t => String(t.props.children) === label);
        let node = text;
        while (node && typeof node.props.onPress !== 'function') node = node.parent;
        node.props.onPress();
      });
      const input = (ph) => component.root.findAll(n => n.type === 'TextInput').find(i => i.props.placeholder === ph);
      render.act(() => { input('175.0').props.onChangeText('170'); });
      render.act(() => { input('200.0').props.onChangeText('190'); });
      await press('Save goal');
      expect(hasTextSafe(component.root, 'Could not save your goal. Try again.')).toBe(true);
      expect(hasTextSafe(component.root, 'Save goal')).toBe(true);
      expect(input('175.0').props.value).toBe('170');
      expect(input('200.0').props.value).toBe('190');
      await press('Save goal');
      expect(input('175.0').props.value).toBe('170');
    });

    test('cancelling an edit of an existing goal discards the draft target', async () => {
      const component = setup({ target_weight: 175, target_date: '2099-01-01', start_weight: 190 }, []);
      const press = (label) => render.act(async () => {
        let node = component.root.findAllByType('Text').find(t => String(t.props.children) === label);
        while (node && typeof node.props.onPress !== 'function') node = node.parent;
        node.props.onPress();
      });
      const targetInput = () => component.root.findAll(n => n.type === 'TextInput').find(i => i.props.placeholder === '175.0');
      await press('Edit');
      render.act(() => { targetInput().props.onChangeText('170'); });
      await press('Cancel');
      expect(targetInput()).toBeUndefined();
      expect(hasTextSafe(component.root, '175 lb')).toBe(true);
      await press('Edit');
      expect(targetInput().props.value).toBe('175');
    });

    test('no-goal Target field and date match the weigh-in field geometry and typography (#1459)', () => {
      const component = setup(null, []);
      openGoalSetup(component.root);
      const target = component.root
        .findAll(n => n.type === 'TextInput')
        .find(i => i.props.placeholder === '175.0');
      const style = StyleSheet.flatten(target.props.style);
      expect(style.fontSize).toBe(14);
      expect(style.fontFamily).toBe('JetBrainsMono-SemiBold');
      expect(target.props.keyboardType).toBe('decimal-pad');
      expect(target.props.value || '').toBe('');
      // Date renders the same YYYY-MM-DD value as the weigh-in date field.
      const dateBtn = component.root.find(n => n.props && n.props.accessibilityLabel === 'Goal target date' && typeof n.props.onPress === 'function');
      const dateText = dateBtn.findByType('Text').props.children;
      expect(String(dateText)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('archived goals history list', () => {
    const hasTextSafe = (root, text) =>
      root.findAllByType('Text').some(t => {
        const children = t.props.children;
        const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
        return flat.includes(text);
      });

    // Goal History defaults to collapsed (#407 H-5). Expand it to assert on rows.
    const expandGoalHistory = (root) => {
      const toggle = root.findByProps({ accessibilityLabel: 'Expand goal history' });
      render.act(() => { toggle.props.onPress(); });
    };

    test('defaults to collapsed, showing a count summary instead of rows', () => {
      const archived = [{
        id: 'ag_1',
        target_weight: 175,
        target_date: '2026-09-01',
        completed_weight: 174.5,
        archived_at: '2026-09-02T08:00:00.000Z',
      }];
      const component = setup(null, [], archived);
      const root = component.root;

      // #1601: the disclosure reads "Goal history · N" with the latest outcome;
      // rows are hidden until expanded.
      expect(hasTextSafe(root, 'Goal history · 1')).toBe(true);
      expect(hasTextSafe(root, 'Latest:')).toBe(true);
      expect(hasTextSafe(root, '175 lb')).toBe(false);

      // Expanding reveals the archived goal rows.
      expandGoalHistory(root);
      expect(hasTextSafe(root, '175 lb')).toBe(true);
    });

    test('hides archived goals section when there are no archived goals', () => {
      const component = setup(null, [], []);
      expect(hasTextSafe(component.root, 'Goal history')).toBe(false);
      expect(component.root.findAll(n => n.props?.testID === 'weight-goal-history')).toHaveLength(0);
    });

    test('renders Goal History section and list with target weight, completed weight, and target date', () => {
      const archived = [
        {
          id: 'ag_1',
          target_weight: 175,
          target_date: '2026-09-01',
          completed_weight: 174.5,
          archived_at: '2026-09-02T08:00:00.000Z',
        },
      ];
      const component = setup(null, [], archived);
      const root = component.root;

      expect(hasTextSafe(root, 'Goal history · 1')).toBe(true);
      expandGoalHistory(root);

      expect(hasTextSafe(root, '175 lb')).toBe(true);
      // End Weight is its own column; value appears as bare weight, no "Completed:" prefix
      expect(hasTextSafe(root, '174.5 lb')).toBe(true);
      expect(hasTextSafe(root, 'End Weight')).toBe(true);
      // Column header now says "Target Date"; cell shows the target date (#407 M-1)
      expect(hasTextSafe(root, 'Target Date')).toBe(true);
      expect(hasTextSafe(root, '09-01-2026')).toBe(true);
      // Archive date is no longer shown in the table (#407 M-1)
      expect(hasTextSafe(root, '09-02-2026')).toBe(false);
    });

    test('renders archived goals in newest-first order', () => {
      const archived = [
        {
          id: 'ag_old',
          target_weight: 180,
          target_date: '2026-06-01',
          completed_weight: 179.8,
          archived_at: '2026-06-02T08:00:00.000Z',
        },
        {
          id: 'ag_new',
          target_weight: 170,
          target_date: '2026-08-01',
          completed_weight: 169.5,
          archived_at: '2026-08-02T08:00:00.000Z',
        },
      ];
      const component = setup(null, [], archived);
      const root = component.root;
      expandGoalHistory(root);

      const texts = root.findAllByType('Text').map(t => {
        const children = t.props.children;
        return Array.isArray(children) ? children.join('') : String(children ?? '');
      });

      const target170Idx = texts.indexOf('170 lb');
      const target180Idx = texts.indexOf('180 lb');

      expect(target170Idx).toBeGreaterThan(-1);
      expect(target180Idx).toBeGreaterThan(-1);
      expect(target170Idx).toBeLessThan(target180Idx);
    });

    describe('Goal History panel typography', () => {
      const getStyleProp = (node, propName) => {
        const style = node.props.style;
        if (!style) return undefined;
        if (Array.isArray(style)) {
          const flat = style.flat();
          for (let i = flat.length - 1; i >= 0; i--) {
            if (flat[i] && flat[i][propName] !== undefined) return flat[i][propName];
          }
          return undefined;
        }
        return style[propName];
      };

      const findByExactText = (root, text) =>
        root.findAllByType('Text').find(t => {
          const children = t.props.children;
          return (Array.isArray(children) ? children.join('') : String(children ?? '')) === text;
        });

      const archivedFixture = [{
        id: 'ag_1',
        target_weight: 175,
        target_date: '2026-09-01',
        completed_weight: 174.5,
        archived_at: '2026-09-02T08:00:00.000Z',
      }];

      // #1601 (h.css .hcols): column labels are the 12px mono label-md role,
      // uppercase, on the panel's header band.
      test('column labels use the 12px uppercase mono label role (#1601)', () => {
        const component = setup(null, [], archivedFixture);
        // Column headers only render when expanded (#410).
        expandGoalHistory(component.root);
        const colLabel = findByExactText(component.root, 'Target');
        expect(colLabel).toBeTruthy();
        expect(getStyleProp(colLabel, 'fontSize')).toBe(12);
        expect(getStyleProp(colLabel, 'fontFamily')).toBe('JetBrainsMono-Medium');
        expect(getStyleProp(colLabel, 'textTransform')).toBe('uppercase');
      });

      // #411 lineage, #1601 values (h.css .hrow): 15px bold mono values,
      // identical across both history panels.
      test('primary value cells use JBM typography (#411, #1601)', () => {
        const component = setup(null, [], archivedFixture);
        expandGoalHistory(component.root);
        const valueNode = findByExactText(component.root, '175 lb');
        expect(valueNode).toBeTruthy();
        expect(getStyleProp(valueNode, 'fontSize')).toBe(15);
        expect(getStyleProp(valueNode, 'fontFamily')).toBe('JetBrainsMono-Bold');
      });

      // Dates are 15px medium mono, muted, so they do not compete with values.
      test('date cells use the shared date typography 15/medium (#411, #1601)', () => {
        const component = setup(null, [], archivedFixture);
        expandGoalHistory(component.root);
        const dateNode = findByExactText(component.root, '09-01-2026');
        expect(dateNode).toBeTruthy();
        expect(getStyleProp(dateNode, 'fontSize')).toBe(15);
        expect(getStyleProp(dateNode, 'fontFamily')).toBe('JetBrainsMono-Medium');
      });

      // #410: the collapsed Goal History summary is count-first and surfaces the
      // most recent archived goal's OUTCOME (Success/Missed) in bold — no weight —
      // at a larger-than-13px size. archivedFixture has no start_weight and ends
      // at 174.5 vs a 175 target, which isGoalMet judges as not met => Missed.
      test('collapsed summary surfaces latest goal outcome in bold above 13px (#410)', () => {
        const component = setup(null, [], archivedFixture);
        const root = component.root;
        const outcomeNode = findByExactText(root, 'Missed');
        expect(outcomeNode).toBeTruthy();
        expect(getStyleProp(outcomeNode, 'fontFamily')).toBe('JetBrainsMono-Bold');
        // The surrounding summary line is larger than the prior 13px.
        const summary = root.findAllByType('Text').find(t => flattenChildren(t.props.children).startsWith('Latest:'));
        expect(summary).toBeTruthy();
        expect(getStyleProp(summary, 'fontSize')).toBeGreaterThan(13);
      });
    });

    // #410: both history panels follow the Analytics collapse convention — a
    // static section title above the card, the collapse chevron INSIDE the card
    // header, and only the count-first summary line when collapsed.
    describe('Analytics collapse convention standardization (#410)', () => {
      const getStyleProp = (node, propName) => {
        const style = node.props.style;
        if (!style) return undefined;
        if (Array.isArray(style)) {
          const flat = style.flat();
          for (let i = flat.length - 1; i >= 0; i--) {
            if (flat[i] && flat[i][propName] !== undefined) return flat[i][propName];
          }
          return undefined;
        }
        return style[propName];
      };

      const findByExactText = (root, text) =>
        root.findAllByType('Text').find(t => {
          const children = t.props.children;
          return (Array.isArray(children) ? children.join('') : String(children ?? '')) === text;
        });

      const metFixture = [{
        id: 'ag_met',
        target_weight: 175,
        target_date: '2026-09-01',
        start_weight: 200,
        completed_weight: 174,
        archived_at: '2026-09-02T08:00:00.000Z',
      }];

      // #1601 replaces the static section title with a single disclosure row
      // inside the panel: the whole row is the toggle and names its state.
      test('Goal History is one in-panel disclosure row that exposes its expanded state', () => {
        const component = setup(null, [], metFixture);
        const root = component.root;

        const toggle = root.findAll(n => n.props?.accessibilityLabel === 'Expand goal history' && typeof n.props.onPress === 'function')[0];
        expect(toggle).toBeTruthy();
        expect(toggle.props.accessibilityRole).toBe('button');
        expect(toggle.props.accessibilityState).toEqual({ expanded: false });
        const title = toggle.findAllByType('Text').find(t => flattenChildren(t.props.children) === 'Goal history · 1');
        expect(title).toBeTruthy();
        // The disclosure lives inside the Goal history panel.
        const panel = root.findAll(n => n.props?.testID === 'weight-goal-history')[0];
        expect(panel.findAll(n => n === toggle)).toHaveLength(1);
        render.act(() => { toggle.props.onPress(); });
        expect(root.findAll(n => n.props?.accessibilityLabel === 'Collapse goal history' && n.props.accessibilityState?.expanded === true).length).toBeGreaterThan(0);
      });

      test('Goal History hides column headers when collapsed, shows them when expanded', () => {
        const component = setup(null, [], metFixture);
        const root = component.root;

        // Collapsed by default: no column-header chrome. ("End Weight" is unique
        // to the Goal History table; "Target Date" also appears in the goal form.)
        expect(hasTextSafe(root, 'End Weight')).toBe(false);
        expect(hasTextSafe(root, '175 lb')).toBe(false);

        const toggle = root.findByProps({ accessibilityLabel: 'Expand goal history' });
        render.act(() => { toggle.props.onPress(); });

        expect(hasTextSafe(root, 'End Weight')).toBe(true);
        expect(hasTextSafe(root, '175 lb')).toBe(true);
      });

      test('collapsed Goal History summary is count-first with a bold Success outcome (green)', () => {
        // Loss goal 200 -> 175 ended at 174 (met) => Success in success color.
        const component = setup(null, [], metFixture);
        const root = component.root;

        // Two-line disclosure: count on the title line, Latest: on the second.
        expect(hasTextSafe(root, 'Goal history · 1')).toBe(true);
        expect(hasTextSafe(root, 'Latest:')).toBe(true);
        const successNode = findByExactText(root, 'Success');
        expect(successNode).toBeTruthy();
        expect(getStyleProp(successNode, 'fontFamily')).toBe('JetBrainsMono-Bold');
        expect(getStyleProp(successNode, 'color')).toBe(KUA_PALETTES.hardCourt.light.success);
      });

      test('collapsed Goal History summary shows a bold Missed outcome (red) for an unmet goal', () => {
        // Loss goal 200 -> 175 ended at 185 (> target) => Missed in error color.
        const missedFixture = [{
          id: 'ag_missed',
          target_weight: 175,
          target_date: '2026-09-01',
          start_weight: 200,
          completed_weight: 185,
          archived_at: '2026-09-02T08:00:00.000Z',
        }];
        const component = setup(null, [], missedFixture);
        const root = component.root;

        const missedNode = findByExactText(root, 'Missed');
        expect(missedNode).toBeTruthy();
        expect(getStyleProp(missedNode, 'color')).toBe(KUA_PALETTES.hardCourt.light.errorText);
      });

      // #411 option B: the From/To controls are hidden by default and revealed
      // by the header filter icon. The filter icon is ALWAYS visible (collapsed
      // or expanded). Tapping it when expanded toggles From/To visibility. Tapping
      // it when collapsed expands the panel and shows the From/To row (#411 C).
      test('Weight History reveals From/To only after tapping the filter icon; icon stays visible when collapsed', () => {
        const entries = [
          { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 190, note: '' },
        ];
        const component = setup(null, entries);
        const root = component.root;

        // Collapsed by default (#898): the filter icon is present, From/To
        // controls hidden, and the #1601 count header is shown.
        expect(root.findAllByProps({ accessibilityLabel: 'Filter by date range' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBe(0);
        expect(root.findAllByProps({ accessibilityLabel: 'To date' }).length).toBe(0);
        expect(hasTextSafe(root, 'History · 1')).toBe(true);

        // Tapping the collapsed-state filter icon expands the panel and shows From/To.
        const collapsedFilterBtn = root.findByProps({ accessibilityLabel: 'Filter by date range' });
        render.act(() => { collapsedFilterBtn.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'To date' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'Collapse history' }).length).toBeGreaterThan(0);

        // Tapping the filter icon again (now expanded) hides From/To.
        const filterBtn = root.findByProps({ accessibilityLabel: 'Filter by date range' });
        render.act(() => { filterBtn.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBe(0);

        // Tapping it a third time reveals them again, still expanded.
        render.act(() => { filterBtn.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'To date' }).length).toBeGreaterThan(0);

        // Re-collapsing: filter icon REMAINS visible; From/To controls hide.
        const toggle = root.findByProps({ accessibilityLabel: 'Collapse history' });
        render.act(() => { toggle.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'Filter by date range' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBe(0);
        expect(hasTextSafe(root, 'History · 1')).toBe(true);
      });
    });

    // #408: archived End Weight is colored by goal outcome via isGoalMet so users
    // can scan whether each archived goal succeeded or failed. #1601 draws the
    // outcome with the active KUA palette's success / errorText tokens.
    describe('archived End Weight outcome coloring (#408)', () => {
      const getStyleProp = (node, propName) => {
        const style = node.props.style;
        if (!style) return undefined;
        if (Array.isArray(style)) {
          const flat = style.flat();
          for (let i = flat.length - 1; i >= 0; i--) {
            if (flat[i] && flat[i][propName] !== undefined) return flat[i][propName];
          }
          return undefined;
        }
        return style[propName];
      };

      const findByExactText = (root, text) =>
        root.findAllByType('Text').find(t => {
          const children = t.props.children;
          return (Array.isArray(children) ? children.join('') : String(children ?? '')) === text;
        });

      const expandGoalHistory = (root) => {
        const toggle = root.findByProps({ accessibilityLabel: 'Expand goal history' });
        render.act(() => { toggle.props.onPress(); });
      };

      test('met loss goal colors End Weight success (green)', () => {
        // Loss goal 200 -> 175; ended at 174 (<= target) => met.
        const archived = [{
          id: 'ag_met',
          target_weight: 175,
          target_date: '2026-09-01',
          start_weight: 200,
          completed_weight: 174,
          archived_at: '2026-09-02T08:00:00.000Z',
        }];
        const component = setup(null, [], archived);
        expandGoalHistory(component.root);
        const endNode = findByExactText(component.root, '174 lb');
        expect(endNode).toBeTruthy();
        expect(getStyleProp(endNode, 'color')).toBe(KUA_PALETTES.hardCourt.light.success);
      });

      test('missed loss goal colors End Weight error (red)', () => {
        // Loss goal 200 -> 175; ended at 185 (> target) => not met.
        const archived = [{
          id: 'ag_missed',
          target_weight: 175,
          target_date: '2026-09-01',
          start_weight: 200,
          completed_weight: 185,
          archived_at: '2026-09-02T08:00:00.000Z',
        }];
        const component = setup(null, [], archived);
        expandGoalHistory(component.root);
        const endNode = findByExactText(component.root, '185 lb');
        expect(endNode).toBeTruthy();
        expect(getStyleProp(endNode, 'color')).toBe(KUA_PALETTES.hardCourt.light.errorText);
      });

      test('missing completed weight stays neutral', () => {
        const archived = [{
          id: 'ag_none',
          target_weight: 175,
          target_date: '2026-09-01',
          start_weight: 200,
          completed_weight: null,
          archived_at: '2026-09-02T08:00:00.000Z',
        }];
        const component = setup(null, [], archived);
        expandGoalHistory(component.root);
        const endNode = findByExactText(component.root, 'N/A');
        expect(endNode).toBeTruthy();
        const color = getStyleProp(endNode, 'color');
        expect(color).toBe(KUA_PALETTES.hardCourt.light.onSurface);
        expect(color).not.toBe(KUA_PALETTES.hardCourt.light.success);
        expect(color).not.toBe(KUA_PALETTES.hardCourt.light.errorText);
      });
    });

    describe('Weight History panel typography', () => {
      const getStyleProp = (node, propName) => {
        const style = node.props.style;
        if (!style) return undefined;
        if (Array.isArray(style)) {
          const flat = style.flat();
          for (let i = flat.length - 1; i >= 0; i--) {
            if (flat[i] && flat[i][propName] !== undefined) return flat[i][propName];
          }
          return undefined;
        }
        return style[propName];
      };

      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 190, note: '' },
      ];

      // Weight History is collapsed by default (#898); expand it to assert on rows.
      const expandWeightHistory = (root) => {
        const toggle = root.findByProps({ accessibilityLabel: 'Expand history' });
        render.act(() => { toggle.props.onPress(); });
      };

      // Scope lookups to the History panel: the root header also reads "Weight".
      const inHistory = (root) => root.findAll(n => n.props?.testID === 'weight-history-panel' && typeof n.type === 'string')[0];
      const exact = (scope, text) => scope.findAllByType('Text').find(t => flattenChildren(t.props.children) === text);

      test('column labels use the 12px uppercase mono label role (#1601)', () => {
        const component = setup(null, entries);
        const colLabel = exact(inHistory(component.root), 'Weight');
        expect(colLabel).toBeTruthy();
        expect(getStyleProp(colLabel, 'fontSize')).toBe(12);
        expect(getStyleProp(colLabel, 'fontFamily')).toBe('JetBrainsMono-Medium');
        expect(getStyleProp(colLabel, 'textTransform')).toBe('uppercase');
      });

      test('row weight values use JBM typography matching goal history (#411, #1601)', () => {
        const component = setup(null, entries);
        expandWeightHistory(component.root);
        const weightNode = exact(inHistory(component.root), '190 lb');
        expect(weightNode).toBeTruthy();
        expect(getStyleProp(weightNode, 'fontSize')).toBe(15);
        expect(getStyleProp(weightNode, 'fontFamily')).toBe('JetBrainsMono-Bold');
      });

      // #1601: the header carries the count in the mono label role; the newest
      // rows are previewed rather than summarized.
      test('collapsed header shows the History count over a preview of the newest row (#1601)', () => {
        const component = setup(null, entries);
        const panel = inHistory(component.root);
        const header = exact(panel, 'History · 1');
        expect(header).toBeTruthy();
        expect(getStyleProp(header, 'textTransform')).toBe('uppercase');
        expect(exact(panel, '190 lb')).toBeTruthy();
      });
    });

    describe('Weight History collapsed preview (#407 M-7, #1601)', () => {
      test('collapsed panel shows the latest weight and date, not just a count', () => {
        const entries = [
          { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 190, weight_unit: 'lb', note: '' },
          { id: '2', date: '2026-05-22', logged_at: '2026-05-22T08:00:00Z', weight_value: 191, weight_unit: 'lb', note: '' },
        ];
        const component = setup(null, entries);
        const panel = component.root.findAll(n => n.props?.testID === 'weight-history-panel' && typeof n.type === 'string')[0];
        const texts = panel.findAllByType('Text').map(t => flattenChildren(t.props.children));
        // Newest first: the latest entry's weight and date lead the preview.
        expect(texts).toContain('History · 2');
        expect(texts.indexOf('190 lb')).toBeGreaterThan(-1);
        expect(texts.indexOf('190 lb')).toBeLessThan(texts.indexOf('191 lb'));
        expect(texts).toContain('05-24-2026');
      });
    });

    test('archiving a met goal immediately updates the visible archived goals', async () => {
      const { useWeightGoal, useArchivedWeightGoals } = jest.requireActual('../hooks/entries/weightHooks');
      const { View, Text, Pressable } = require('react-native');

      const initialGoal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      let archivedStore = [];
      let currentGoalStore = initialGoal;

      const AsyncStorage = require('@react-native-async-storage/async-storage');
      AsyncStorage.getItem.mockImplementation(async (key) => {
        if (key === 'kilo_weight_goal') return currentGoalStore ? JSON.stringify(currentGoalStore) : null;
        if (key === 'kilo_archived_weight_goals') return JSON.stringify(archivedStore);
        return null;
      });
      AsyncStorage.setItem.mockImplementation(async (key, value) => {
        if (key === 'kilo_archived_weight_goals') {
          archivedStore = JSON.parse(value);
        }
        if (key === 'kilo_weight_goal') {
          currentGoalStore = JSON.parse(value);
        }
      });
      AsyncStorage.removeItem.mockImplementation(async (key) => {
        if (key === 'kilo_weight_goal') {
          currentGoalStore = null;
        }
      });

      function HookWrapper() {
        const { goal, archiveGoal } = useWeightGoal();
        const { archivedGoals } = useArchivedWeightGoals();

        return (
          <View>
            <Text testID="goal">{goal ? `${goal.target_weight}` : 'no-goal'}</Text>
            <Text testID="archived-count">{archivedGoals.length}</Text>
            <Pressable testID="archive-btn" onPress={() => archiveGoal(175)} />
          </View>
        );
      }

      let component;
      await render.act(async () => {
        component = render.create(<HookWrapper />);
      });

      const goalText = component.root.findByProps({ testID: 'goal' });
      const archivedCountText = component.root.findByProps({ testID: 'archived-count' });

      expect(goalText.props.children).toBe('175');
      expect(archivedCountText.props.children).toBe(0);

      const archiveBtn = component.root.findByProps({ testID: 'archive-btn' });
      await render.act(async () => {
        await archiveBtn.props.onPress();
      });

      expect(goalText.props.children).toBe('no-goal');
      expect(archivedCountText.props.children).toBe(1);
    });
  });

  // #411: Goal History and Weight History must render as ONE uniform visual
  // system. For every equivalent element the shared typography and 3-column grid
  // must be numerically identical across the two panels; only the literal label
  // text and semantic outcome colors may differ.
  describe('history panels uniform visual system (#411)', () => {
    const getStyleProp = (node, propName) => {
      const style = node.props.style;
      if (!style) return undefined;
      const flat = StyleSheet.flatten(style);
      return flat?.[propName];
    };

    const findByExactText = (root, text) =>
      root.findAllByType('Text').find(t => {
        const children = t.props.children;
        return (Array.isArray(children) ? children.join('') : String(children ?? '')) === text;
      });

    const ancestorWithStyleProp = (node, propName) => {
      let current = node;
      while (current) {
        if (getStyleProp(current, propName) !== undefined) return current;
        current = current.parent;
      }
      return node;
    };

    const archived = [{
      id: 'ag_1',
      target_weight: 175,
      target_date: '2026-09-01',
      start_weight: 200,
      completed_weight: 174.5,
      archived_at: '2026-09-02T08:00:00.000Z',
    }];
    const entries = [
      { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 190, weight_unit: 'lb', note: '' },
    ];

    // Render both panels expanded so their equivalent elements are visible.
    // Both default to collapsed (#407 H-5, #898).
    const renderBoth = () => {
      const component = setup(null, entries, archived);
      const root = component.root;
      const expandGoal = root.findByProps({ accessibilityLabel: 'Expand goal history' });
      render.act(() => { expandGoal.props.onPress(); });
      const expandWeight = root.findByProps({ accessibilityLabel: 'Expand history' });
      render.act(() => { expandWeight.props.onPress(); });
      return root;
    };

    // Scope each lookup to its panel: the root header also reads "Weight" and
    // the goal form can read "Target".
    const panelOf = (root, testID) => root.findAll(n => n.props?.testID === testID && typeof n.type === 'string')[0];
    const exactIn = (scope, text) => scope.findAllByType('Text').find(t => {
      const c = t.props.children;
      return (Array.isArray(c) ? c.join('') : String(c ?? '')) === text;
    });

    test('primary value cells share identical typography across both panels (#411)', () => {
      const root = renderBoth();
      const goalValue = exactIn(panelOf(root, 'weight-goal-history'), '175 lb');
      const weightValue = exactIn(panelOf(root, 'weight-history-panel'), '190 lb');
      expect(goalValue).toBeTruthy();
      expect(weightValue).toBeTruthy();
      expect(getStyleProp(goalValue, 'fontSize')).toBe(getStyleProp(weightValue, 'fontSize'));
      expect(getStyleProp(goalValue, 'fontFamily')).toBe(getStyleProp(weightValue, 'fontFamily'));
      expect(getStyleProp(goalValue, 'color')).toBe(getStyleProp(weightValue, 'color'));
      expect(getStyleProp(goalValue, 'fontSize')).toBe(15);
      expect(getStyleProp(goalValue, 'fontFamily')).toBe('JetBrainsMono-Bold');
    });

    test('date cells share identical typography across both panels', () => {
      const root = renderBoth();
      const goalDate = exactIn(panelOf(root, 'weight-goal-history'), '09-01-2026');
      const weightDate = exactIn(panelOf(root, 'weight-history-panel'), '05-24-2026');
      expect(goalDate).toBeTruthy();
      expect(weightDate).toBeTruthy();
      for (const prop of ['fontSize', 'fontFamily', 'color']) {
        expect(getStyleProp(goalDate, prop)).toBe(getStyleProp(weightDate, prop));
      }
    });

    test('column header labels share identical typography and casing across both panels', () => {
      const root = renderBoth();
      const goalLabel = exactIn(panelOf(root, 'weight-goal-history'), 'Target');
      const weightLabel = exactIn(panelOf(root, 'weight-history-panel'), 'Weight');
      expect(goalLabel).toBeTruthy();
      expect(weightLabel).toBeTruthy();
      for (const prop of ['fontSize', 'fontFamily', 'color', 'textTransform', 'letterSpacing']) {
        expect(getStyleProp(goalLabel, prop)).toBe(getStyleProp(weightLabel, prop));
      }
    });

    // #1601 (h.css .hcols/.hrow): a flexible first column, then fixed 76 / 104
    // columns and a 44dp control slot, identical in both tables.
    test('the 3-column grid uses identical column geometry across both panels', () => {
      const root = renderBoth();
      const goalPanel = panelOf(root, 'weight-goal-history');
      const weightPanel = panelOf(root, 'weight-history-panel');
      const goalCols = ['Target', 'End Weight', 'Target Date'].map(t => exactIn(goalPanel, t));
      const weightCols = ['Weight', 'Change', 'Date'].map(t => exactIn(weightPanel, t));
      for (let i = 0; i < 3; i++) {
        expect(goalCols[i]).toBeTruthy();
        expect(weightCols[i]).toBeTruthy();
        for (const prop of ['flex', 'width', 'textAlign']) {
          expect(getStyleProp(goalCols[i], prop)).toBe(getStyleProp(weightCols[i], prop));
        }
      }
      expect(goalCols.map(n => getStyleProp(n, 'flex') ?? getStyleProp(n, 'width'))).toEqual([1, 76, 104]);
    });

    // #1601 moves the date filter into the History header next to the
    // expand/collapse control; the Date column header stays a plain label.
    test('Weight History keeps the filter icon in the panel header beside the toggle', () => {
      const root = renderBoth();
      const filter = root.findAll(n => n.props?.testID === 'weight-history-date-filter-header' && typeof n.props.onPress === 'function')[0];
      const toggle = root.findAll(n => n.props?.testID === 'weight-history-toggle' && typeof n.props.onPress === 'function')[0];
      expect(filter).toBeTruthy();
      expect(toggle).toBeTruthy();
      expect(filter.parent).toBe(toggle.parent);
      const dateHeader = root.findAll(n => n.props?.testID === 'weight-history-date-header' && n.type === 'Text')[0];
      expect(flattenChildren(dateHeader.props.children)).toBe('Date');
      expect(getStyleProp(dateHeader, 'width')).toBe(104);
    });

    // Both panels lead with a count in their header line (#1601 replaces the
    // two-line collapsed summaries).
    test('both panels name their count in the header', () => {
      const component = setup(null, entries, archived);
      const root = component.root;
      expect(exactIn(panelOf(root, 'weight-history-panel'), 'History · 1')).toBeTruthy();
      expect(exactIn(panelOf(root, 'weight-goal-history'), 'Goal history · 1')).toBeTruthy();
    });

    test('Weight History shows column headers whenever it has rows, and none when empty', () => {
      const withRows = setup(null, entries).root;
      expect(exactIn(panelOf(withRows, 'weight-history-panel'), 'Change')).toBeTruthy();
      const toggle = withRows.findByProps({ accessibilityLabel: 'Expand history' });
      render.act(() => { toggle.props.onPress(); });
      expect(exactIn(panelOf(withRows, 'weight-history-panel'), 'Change')).toBeTruthy();

      const empty = setup(null, []).root;
      expect(exactIn(panelOf(empty, 'weight-history-panel'), 'Change')).toBeUndefined();
    });
  });

  // Goal action chips are visually compact. #404 first met the 44px minimum
  // with an enlarged hitSlop; #919 replaced that with a real >=44x44dp box on
  // `goalActionChip` itself (ui-design-rules.md §15: React Native clips a slop
  // at the one-line row's bounds), keeping the 13/700 label and 12/6 padding.
  describe('goal action chip touch targets (#404, #919)', () => {
    const findPressableByText = (root, text) => {
      const matches = root.findAll(n => {
        if (n.type !== 'Text') return false;
        const children = n.props.children;
        const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
        return flat === text;
      });
      for (const match of matches) {
        let node = match.parent;
        while (node) {
          if (node.props && typeof node.props.onPress === 'function') return node;
          node = node.parent;
        }
      }
      return null;
    };

    const expectOwnBox = (chip) => {
      expect(chip).toBeTruthy();
      expect(chip.props.hitSlop).toBeUndefined();
      const style = StyleSheet.flatten(chip.props.style) || {};
      expect(style.minHeight).toBe(44);
      expect(style.minWidth).toBe(44);
    };

    test('Edit and Clear chips press through a real 44x44 box when a goal is in progress', () => {
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185, note: '' },
      ];
      const component = setup(goal, entries);
      expectOwnBox(findPressableByText(component.root, 'Edit'));
      expectOwnBox(findPressableByText(component.root, 'Clear'));
    });

    test('Archive chip presses through a real 44x44 box when a goal is met', () => {
      const goal = { target_weight: 175, target_date: '2026-05-24', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 174, note: '' },
      ];
      const component = setup(goal, entries);
      expectOwnBox(findPressableByText(component.root, 'Archive'));
    });
  });

  describe('text lookup with nested fragments and React elements', () => {
    test('discovers text buried inside nested React elements/fragments without JSON.stringify', () => {
      // Render an overdue goal to trigger nested component rendering.
      // Target date is in the past (before MOCK_NOW 2026-05-24) so "Goal ended." appears.
      const goal = { target_weight: 180, target_date: '2026-05-20', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185, note: '' },
      ];
      const component = setup(goal, entries);
      const root = component.root;

      // These strings are rendered inside nested fragments and components; findText
      // must recursively flatten to discover them, not crash on circular refs or
      // convert nested React elements to [object Object] strings.
      expect(findText(root, 'Goal ended')).toBeTruthy();
      // #1601: "185 lb" is a history row; "lb to go" style value+unit runs
      // are nested Text in the Goal and Latest panels.
      expect(findText(root, '185 lb')).toBeTruthy();
      expect(findText(root, 'Weight')).toBeTruthy();
    });

    test('deliberately missing text returns undefined and preserves assertion failure', () => {
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const component = setup(goal);
      const root = component.root;

      // Text that does not exist in the component tree should return undefined
      // so the assertion `expect(findText(...)).toBeFalsy()` naturally fails with
      // the intended message, not a JSON.stringify circular crash.
      const result = findText(root, 'This text does not exist anywhere');
      expect(result).toBeUndefined();
    });
  });
});

// #1480: a pristine reseed after an external refresh must replace the unit
// provenance with the newly seeded canonical lb values.
describe('WeightScreen goal form: refresh reseed replaces unit provenance (#1480)', () => {
  const { setWeightUnitPreference } = require('../lib/unitPreference');
  let save;
  const mountWith = (goal) => {
    save = jest.fn().mockResolvedValue(undefined);
    useEntries.useWeightEntries.mockReturnValue({ entries: [], remove: jest.fn(), update: jest.fn() });
    useEntries.useUserProfile.mockReturnValue({ profile: null });
    weightHooks.useArchivedWeightGoals.mockReturnValue({ archivedGoals: [], loading: false, refresh: jest.fn() });
    const element = () => {
      useEntries.useWeightGoal.mockReturnValue({ goal: currentGoal, save, clear: jest.fn(), archiveGoal: jest.fn() });
      return (
        <WeightScreen weightValue="" setWeightValue={jest.fn()} weightNote="" setWeightNote={jest.fn()}
          onSaveWeight={jest.fn()} errorMessage="" saving={false} isActive />
      );
    };
    let currentGoal = goal;
    let c;
    render.act(() => { c = render.create(element()); });
    return {
      c,
      setGoal: (g) => { currentGoal = g; render.act(() => { c.update(element()); }); },
    };
  };
  const press = (c, label) => {
    const node = c.root.findAll((n) => n.props.onPress && (n.props.label === label || n.props.title === label))[0];
    return render.act(async () => { await node.props.onPress(); });
  };
  afterEach(() => { setWeightUnitPreference('lb'); });

  test('kg edit: external 170.1 -> 170.2 lb (same kg text) saves exactly 170.2', async () => {
    setWeightUnitPreference('kg');
    const { c, setGoal } = mountWith({ target_weight: 170.1, target_date: '2099-01-01', start_weight: 180.1 });
    await press(c, 'Edit');
    setGoal({ target_weight: 170.2, target_date: '2099-01-01', start_weight: 180.2 });
    await press(c, 'Save goal');
    expect(save.mock.calls[0][0].target_weight).toBe(170.2);
    expect(save.mock.calls[0][0].start_weight).toBe(180.2);
  });
});
