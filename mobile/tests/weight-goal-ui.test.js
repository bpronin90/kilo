import React from 'react';
import render from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { WeightScreen } from '../screens/WeightScreen';
import * as useEntries from '../hooks/useEntries';
import * as weightHooks from '../hooks/entries/weightHooks';
import { Colors } from '../theme/colors';

// Mock dependencies
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('@expo/vector-icons/MaterialIcons', () => {
  const React = require('react');
  return { __esModule: true, default: () => null };
}, { virtual: true });

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return function MockDateTimePicker() {
    return null;
  };
});

jest.mock('../hooks/useEntries');
jest.mock('../hooks/entries/weightHooks');

// Mock current date for consistent testing
// May 24, 2026 is a Sunday.
// Aug 2, 2026 is exactly 10 weeks later.
const MOCK_NOW = new Date('2026-05-24T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

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

    expect(findText(root, 'Goal ended.')).toBeTruthy();
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

  const setup = (goal, entries = [], archivedGoals = []) => {
    useEntries.useWeightEntries.mockReturnValue({ entries, remove: jest.fn(), update: jest.fn() });
    useEntries.useWeightGoal.mockReturnValue({ goal, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    weightHooks.useArchivedWeightGoals.mockReturnValue({ archivedGoals, loading: false, refresh: jest.fn() });
    let component;
    render.act(() => {
      component = render.create(<WeightScreen {...defaultProps} />);
    });
    return component;
  };

  const findText = (root, text) => {
    const allText = root.findAllByType('Text');
    const match = allText.find(t => {
      const children = t.props.children;
      const flat = Array.isArray(children) ? children.join('') : String(children);
      return flat.includes(text);
    });
    if (!match) {
        // Fallback for deeply nested children or complex fragments
        return allText.find(t => JSON.stringify(t.props.children).includes(text));
    }
    return match;
  };

  test('renders today target date as completed/overdue state (weeks_remaining <= 0)', () => {
    const goal = { target_weight: 180, target_date: '2026-05-24', start_weight: 200 };
    const component = setup(goal);
    const root = component.root;

    expect(findText(root, 'Goal ended.')).toBeTruthy();
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

    // 200 -> 190 in 70 days (10 weeks) = 1.00 lb/week
    expect(findText(root, '1.00 lb / week')).toBeTruthy();
    expect(findText(root, 'Suggested')).toBeTruthy();
    expect(findText(root, 'deficit')).toBeTruthy();
    expect(findText(root, '500 cal / day')).toBeTruthy();
  });

  test('renders "gain" state', () => {
    const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 180 };
    const component = setup(goal);
    const root = component.root;

    // 180 -> 190 in 70 days (10 weeks) = 1.00 lb/week
    expect(findText(root, '1.00 lb / week')).toBeTruthy();
    expect(findText(root, 'Suggested')).toBeTruthy();
    expect(findText(root, 'surplus')).toBeTruthy();
    expect(findText(root, '500 cal / day')).toBeTruthy();
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

      expect(findText(root, 'Goal ended.')).toBeTruthy();
      const allTexts = root.findAllByType('Text').map(t => {
        const children = t.props.children;
        return Array.isArray(children) ? children.join('') : String(children ?? '');
      });
      expect(allTexts.some(txt => txt.includes('to go'))).toBe(false);
    });

    test('derived labels use compact 12px uppercase hierarchy so they do not compete with values', () => {
      const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 200 };
      const entries = [{ id: '1', date: '2026-05-24', weight_value: 195.0, note: '' }];
      const component = setup(goal, entries);
      const label = findByExactText(component.root, 'Target pace');
      expect(label).toBeTruthy();
      expect(getStyleProp(label, 'fontSize')).toBe(12);
      expect(getStyleProp(label, 'fontWeight')).toBe('700');
      expect(getStyleProp(label, 'textTransform')).toBe('uppercase');
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

    expect(findText(root, 'Trends')).toBeTruthy();
    expect(findText(root, 'Today')).toBeTruthy();
    expect(findText(root, 'Current')).toBeTruthy();
    expect(findText(root, '185.0 lb')).toBeTruthy();
    expect(findText(root, '+1.0')).toBeTruthy();
    expect(findText(root, '↑ Gaining')).toBeTruthy();

    expect(findText(root, '7-day rolling')).toBeTruthy();
    expect(findText(root, '184.0 lb')).toBeTruthy();
    expect(findText(root, '+3.5')).toBeTruthy();

    expect(findText(root, '30-day rolling')).toBeTruthy();
    expect(findText(root, '181.8 lb')).toBeTruthy();
    expect(findText(root, '-')).toBeTruthy();
  });

  test('uses logged_at for history display while trends still use date buckets', () => {
    const entries = [
      { id: '1', date: '2026-05-24', logged_at: '2026-05-20T08:30:00Z', weight_value: 185.0, note: 'after travel' },
    ];
    const component = setup(null, entries);
    const root = component.root;

    expect(findText(root, '05-20-2026')).toBeTruthy();
    expect(findText(root, '185.0 lb')).toBeTruthy();
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
      return flat.some(s => s && s.fontSize === 12);
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

      const texts = root.findAllByType('Text');
      const historyDeltaTexts = texts.filter(isHistoryDeltaText);
      const positiveDeltaText = historyDeltaTexts.find(t => t.props.children === '+3.0');
      const negativeDeltaText = historyDeltaTexts.find(t => t.props.children === '-3.0');

      expect(positiveDeltaText).toBeTruthy();
      expect(negativeDeltaText).toBeTruthy();

      // Positive delta (+3.0) goes opposite to the weight loss goal, so it should be highlighted (warn)
      const posColor = getStyleProp(positiveDeltaText, 'color');
      expect(posColor).not.toBe(Colors.textMuted);
      expect(posColor).toBeTruthy();

      // Negative delta (-3.0) matches the weight loss goal, so it should NOT be highlighted (remain muted)
      const negColor = getStyleProp(negativeDeltaText, 'color');
      expect(negColor).toBe(Colors.textMuted);
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

      const texts = root.findAllByType('Text');
      const historyDeltaTexts = texts.filter(isHistoryDeltaText);
      const positiveDeltaText = historyDeltaTexts.find(t => t.props.children === '+3.0');
      const negativeDeltaText = historyDeltaTexts.find(t => t.props.children === '-3.0');

      expect(positiveDeltaText).toBeTruthy();
      expect(negativeDeltaText).toBeTruthy();

      // Positive delta (+3.0) matches weight gain goal, so it should NOT be highlighted
      const posColor = getStyleProp(positiveDeltaText, 'color');
      expect(posColor).toBe(Colors.textMuted);

      // Negative delta (-3.0) goes opposite to the weight gain goal, so it should be highlighted
      const negColor = getStyleProp(negativeDeltaText, 'color');
      expect(negColor).not.toBe(Colors.textMuted);
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
        jest.setSystemTime(new Date('2026-05-25T12:00:00Z'));
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

    test('no goal shows the new-goal entry form (not met state)', () => {
      const component = setup(null, []);
      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(false);
      expect(hasTextSafe(component.root, 'Archive')).toBe(false);
      // Form inputs present
      const root = component.root;
      const inputs = root.findAll(n => n.type === 'TextInput');
      expect(inputs.some(i => i.props.placeholder === '175.0')).toBe(true);
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

      // Header is visible, count-first collapsed summary present, rows hidden.
      expect(hasTextSafe(root, 'Goal History')).toBe(true);
      expect(hasTextSafe(root, 'Latest:')).toBe(true);
      expect(hasTextSafe(root, '175 lb')).toBe(false);

      // Expanding reveals the archived goal rows.
      expandGoalHistory(root);
      expect(hasTextSafe(root, '175 lb')).toBe(true);
    });

    test('hides archived goals section when there are no archived goals', () => {
      const component = setup(null, [], []);
      expect(hasTextSafe(component.root, 'Goal History')).toBe(false);
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

      expect(hasTextSafe(root, 'Goal History')).toBe(true);
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

      test('column labels use fontSize 11 matching Trends label hierarchy', () => {
        const component = setup(null, [], archivedFixture);
        // Column headers only render when expanded (#410).
        expandGoalHistory(component.root);
        const colLabel = findByExactText(component.root, 'Target');
        expect(colLabel).toBeTruthy();
        expect(getStyleProp(colLabel, 'fontSize')).toBe(11);
        expect(getStyleProp(colLabel, 'fontWeight')).toBe('700');
      });

      // #408 bumped these to 18; #409 brought them to 20/900; #411 unifies the
      // shared value typography to a clean 20/700 (off the over-heavy 900),
      // identical across both history panels.
      test('primary value cells use the shared value typography 20/700 (#411)', () => {
        const component = setup(null, [], archivedFixture);
        expandGoalHistory(component.root);
        const valueNode = findByExactText(component.root, '175 lb');
        expect(valueNode).toBeTruthy();
        expect(getStyleProp(valueNode, 'fontSize')).toBe(20);
        expect(getStyleProp(valueNode, 'fontWeight')).toBe('700');
      });

      // #411 unifies the date typography with Weight History (15/600 muted) so
      // dates read as one system and no longer compete with the 20px values.
      test('date cells use the shared date typography 15/600 (#411)', () => {
        const component = setup(null, [], archivedFixture);
        expandGoalHistory(component.root);
        const dateNode = findByExactText(component.root, '09-01-2026');
        expect(dateNode).toBeTruthy();
        expect(getStyleProp(dateNode, 'fontSize')).toBe(15);
        expect(getStyleProp(dateNode, 'fontWeight')).toBe('600');
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
        expect(getStyleProp(outcomeNode, 'fontWeight')).toBe('900');
        // The surrounding summary line is larger than the prior 13px.
        const summary = root.findAllByType('Text').find(t => {
          const c = t.props.children;
          const flat = Array.isArray(c) ? c.join('') : String(c ?? '');
          return flat.includes('Latest:');
        });
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

      test('Goal History section title is static; collapse chevron lives inside the panel', () => {
        const component = setup(null, [], metFixture);
        const root = component.root;

        // "Goal History" title has no pressable ancestor (chevron is off the title row).
        const title = findByExactText(root, 'Goal History');
        expect(title).toBeTruthy();
        let node = title.parent;
        let pressableAncestor = false;
        while (node) {
          if (node.props && typeof node.props.onPress === 'function') pressableAncestor = true;
          node = node.parent;
        }
        expect(pressableAncestor).toBe(false);

        // The collapse toggle exists (rendered inside the card header).
        expect(root.findByProps({ accessibilityLabel: 'Expand goal history' })).toBeTruthy();
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

        // Two-line collapsed summary: count on first line, Latest: on second line.
        expect(hasTextSafe(root, '1 goal')).toBe(true);
        expect(hasTextSafe(root, 'Latest:')).toBe(true);
        const successNode = findByExactText(root, 'Success');
        expect(successNode).toBeTruthy();
        expect(getStyleProp(successNode, 'fontWeight')).toBe('900');
        expect(getStyleProp(successNode, 'color')).toBe(Colors.success);
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
        expect(getStyleProp(missedNode, 'color')).toBe(Colors.error);
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

        // Expanded by default: the filter icon is present but From/To are hidden.
        expect(root.findAllByProps({ accessibilityLabel: 'Filter by date range' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBe(0);
        expect(root.findAllByProps({ accessibilityLabel: 'To date' }).length).toBe(0);

        // Tapping the filter icon reveals the From/To controls.
        const filterBtn = root.findByProps({ accessibilityLabel: 'Filter by date range' });
        render.act(() => { filterBtn.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'To date' }).length).toBeGreaterThan(0);

        // Tapping it again hides them.
        render.act(() => { filterBtn.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBe(0);

        // Collapsed: filter icon REMAINS visible; From/To controls are hidden;
        // the summary line is present.
        const toggle = root.findByProps({ accessibilityLabel: 'Collapse history' });
        render.act(() => { toggle.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'Filter by date range' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBe(0);
        expect(hasTextSafe(root, 'Latest:')).toBe(true);

        // Tapping the collapsed-state filter icon expands the panel and shows From/To.
        const collapsedFilterBtn = root.findByProps({ accessibilityLabel: 'Filter by date range' });
        render.act(() => { collapsedFilterBtn.props.onPress(); });
        expect(root.findAllByProps({ accessibilityLabel: 'From date' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'To date' }).length).toBeGreaterThan(0);
        expect(root.findAllByProps({ accessibilityLabel: 'Collapse history' }).length).toBeGreaterThan(0);
      });
    });

    // #408: archived End Weight is colored by goal outcome via isGoalMet so users
    // can scan whether each archived goal succeeded or failed.
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
        expect(getStyleProp(endNode, 'color')).toBe(Colors.success);
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
        expect(getStyleProp(endNode, 'color')).toBe(Colors.error);
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
        const endNode = findByExactText(component.root, '—');
        expect(endNode).toBeTruthy();
        const color = getStyleProp(endNode, 'color');
        expect(color).toBe(Colors.text);
        expect(color).not.toBe(Colors.success);
        expect(color).not.toBe(Colors.error);
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

      test('column labels use fontSize 11 matching Trends label hierarchy', () => {
        const component = setup(null, entries);
        const colLabel = component.root.findAllByType('Text').find(t => {
          const children = t.props.children;
          return (Array.isArray(children) ? children.join('') : String(children ?? '')) === 'Weight';
        });
        expect(colLabel).toBeTruthy();
        expect(getStyleProp(colLabel, 'fontSize')).toBe(11);
        expect(getStyleProp(colLabel, 'fontWeight')).toBe('700');
      });

      test('row weight values use the shared value typography 20/700 (#411)', () => {
        const component = setup(null, entries);
        const weightNode = component.root.findAllByType('Text').find(t => {
          const children = t.props.children;
          const text = Array.isArray(children) ? children.join('') : String(children ?? '');
          return text === '190 lb';
        });
        expect(weightNode).toBeTruthy();
        expect(getStyleProp(weightNode, 'fontSize')).toBe(20);
        expect(getStyleProp(weightNode, 'fontWeight')).toBe('700');
      });

      // #409: collapsed Weight History summary renders the latest weight in bold
      // at a larger-than-13px size, consistent with the Goal History summary.
      test('collapsed summary renders the latest weight in bold above 13px (#409)', () => {
        const component = setup(null, entries);
        const root = component.root;
        const toggle = root.findByProps({ accessibilityLabel: 'Collapse history' });
        render.act(() => { toggle.props.onPress(); });

        const weightNode = root.findAllByType('Text').find(t => {
          const children = t.props.children;
          const text = Array.isArray(children) ? children.join('') : String(children ?? '');
          return text === '190 lb';
        });
        expect(weightNode).toBeTruthy();
        expect(getStyleProp(weightNode, 'fontWeight')).toBe('900');

        const summary = root.findAllByType('Text').find(t => {
          const c = t.props.children;
          const flat = Array.isArray(c) ? c.join('') : String(c ?? '');
          return flat.includes('Latest:');
        });
        expect(summary).toBeTruthy();
        expect(getStyleProp(summary, 'fontSize')).toBeGreaterThan(13);
      });
    });

    describe('Weight History collapsed summary (#407 M-7)', () => {
      const hasTextSafe = (root, text) =>
        root.findAllByType('Text').some(t => {
          const children = t.props.children;
          const flat = Array.isArray(children) ? children.join('') : String(children ?? '');
          return flat.includes(text);
        });

      test('collapsed summary shows latest weight and date, not just a count', () => {
        const entries = [
          { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 190, weight_unit: 'lb', note: '' },
          { id: '2', date: '2026-05-22', logged_at: '2026-05-22T08:00:00Z', weight_value: 191, weight_unit: 'lb', note: '' },
        ];
        const component = setup(null, entries);
        const root = component.root;

        // Collapse the Weight History list.
        const toggle = root.findByProps({ accessibilityLabel: 'Collapse history' });
        render.act(() => { toggle.props.onPress(); });

        // Summary includes the most recent entry's weight and date.
        expect(hasTextSafe(root, '190')).toBe(true);
        expect(hasTextSafe(root, 'Latest:')).toBe(true);
        expect(hasTextSafe(root, '05-24-2026')).toBe(true);
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
    const renderBoth = () => {
      const component = setup(null, entries, archived);
      const root = component.root;
      const expand = root.findByProps({ accessibilityLabel: 'Expand goal history' });
      render.act(() => { expand.props.onPress(); });
      return root;
    };

    test('primary value cells share identical typography across both panels', () => {
      const root = renderBoth();
      const goalValue = findByExactText(root, '175 lb');
      const weightValue = findByExactText(root, '190 lb');
      expect(goalValue).toBeTruthy();
      expect(weightValue).toBeTruthy();
      expect(getStyleProp(goalValue, 'fontSize')).toBe(getStyleProp(weightValue, 'fontSize'));
      expect(getStyleProp(goalValue, 'fontWeight')).toBe(getStyleProp(weightValue, 'fontWeight'));
      expect(getStyleProp(goalValue, 'fontSize')).toBe(20);
      expect(getStyleProp(goalValue, 'fontWeight')).toBe('700');
    });

    test('date cells share identical typography across both panels', () => {
      const root = renderBoth();
      const goalDate = findByExactText(root, '09-01-2026');
      const weightDate = findByExactText(root, '05-24-2026');
      expect(goalDate).toBeTruthy();
      expect(weightDate).toBeTruthy();
      expect(getStyleProp(goalDate, 'fontSize')).toBe(getStyleProp(weightDate, 'fontSize'));
      expect(getStyleProp(goalDate, 'fontWeight')).toBe(getStyleProp(weightDate, 'fontWeight'));
      expect(getStyleProp(goalDate, 'color')).toBe(getStyleProp(weightDate, 'color'));
    });

    test('column header labels share identical typography and casing across both panels', () => {
      const root = renderBoth();
      const goalLabel = findByExactText(root, 'Target');
      const weightLabel = findByExactText(root, 'Weight');
      expect(goalLabel).toBeTruthy();
      expect(weightLabel).toBeTruthy();
      for (const prop of ['fontSize', 'fontWeight', 'color', 'textTransform', 'letterSpacing']) {
        expect(getStyleProp(goalLabel, prop)).toBe(getStyleProp(weightLabel, prop));
      }
    });

    test('the 3-column grid uses identical column flex across both panels', () => {
      const root = renderBoth();
      // Scope label lookup to each panel's header row (via its collapse toggle)
      // so form labels like "Target Date" elsewhere in the tree cannot collide.
      const inHeader = (label, texts) => {
        const header = root.findByProps({ accessibilityLabel: label });
        return texts.map(txt => header.findAllByType('Text').find(t => {
          const c = t.props.children;
          return (Array.isArray(c) ? c.join('') : String(c ?? '')) === txt;
        }));
      };
      const goalCols = inHeader('Collapse goal history', ['Target', 'End Weight', 'Target Date']);
      const weightCols = inHeader('Collapse history', ['Weight', 'Change', 'Date']);
      for (let i = 0; i < 3; i++) {
        expect(goalCols[i]).toBeTruthy();
        expect(weightCols[i]).toBeTruthy();
        expect(getStyleProp(goalCols[i], 'flex')).toBe(getStyleProp(ancestorWithStyleProp(weightCols[i], 'flex'), 'flex'));
      }
      // And the ratios are the intended shared grid.
      expect(goalCols.map(n => getStyleProp(n, 'flex'))).toEqual([1.35, 1.25, 1.5]);
    });

    test('expanded Weight History groups the filter icon with the Date header', () => {
      const root = renderBoth();
      const dateHeaderGroups = root.findAllByProps({ testID: 'weight-history-date-header' });
      const headerFilterButtons = root.findAllByProps({ testID: 'weight-history-date-filter-header' });
      expect(dateHeaderGroups.length).toBeGreaterThan(0);
      expect(headerFilterButtons.length).toBeGreaterThan(0);

      const dateHeaderGroup = dateHeaderGroups[0];
      const dateLabel = dateHeaderGroup.findAllByType('Text').find(t => {
        const c = t.props.children;
        return (Array.isArray(c) ? c.join('') : String(c ?? '')) === 'Date';
      });
      expect(dateLabel).toBeTruthy();

      expect(getStyleProp(dateHeaderGroup, 'flex')).toBe(1.5);
      expect(getStyleProp(dateHeaderGroup, 'flexDirection')).toBe('row');
      expect(getStyleProp(dateHeaderGroup, 'gap')).toBe(8);
    });

    test('collapsed summary lines share identical base typography across both panels', () => {
      // Goal History is collapsed by default; collapse Weight History too.
      const component = setup(null, entries, archived);
      const root = component.root;
      const collapseWeight = root.findByProps({ accessibilityLabel: 'Collapse history' });
      render.act(() => { collapseWeight.props.onPress(); });

      // Two-line collapsed summary: find the "Latest:" text node in each panel.
      // Both panels render their "Latest:" line as a separate Text node (summaryLatest).
      const latestNodes = root.findAllByType('Text').filter(t => {
        const c = t.props.children;
        const flat = Array.isArray(c) ? c.join('') : String(c ?? '');
        return flat.startsWith('Latest:');
      });
      expect(latestNodes.length).toBe(2);
      expect(getStyleProp(latestNodes[0], 'fontSize')).toBe(getStyleProp(latestNodes[1], 'fontSize'));
      expect(getStyleProp(latestNodes[0], 'fontWeight')).toBe(getStyleProp(latestNodes[1], 'fontWeight'));
      expect(getStyleProp(latestNodes[0], 'color')).toBe(getStyleProp(latestNodes[1], 'color'));

      // Count lines share identical typography too.
      // Match only the "N goal(s)" / "N entry|entries" summary-count nodes (not unrelated UI text).
      const goalCount = root.findAllByType('Text').find(t => {
        const c = t.props.children;
        const flat = Array.isArray(c) ? c.join('') : String(c ?? '');
        return /^\d+ goals?$/.test(flat.trim());
      });
      const weightCount = root.findAllByType('Text').find(t => {
        const c = t.props.children;
        const flat = Array.isArray(c) ? c.join('') : String(c ?? '');
        return /^\d+ entr(y|ies)$/.test(flat.trim());
      });
      expect(goalCount).toBeTruthy();
      expect(weightCount).toBeTruthy();
      expect(getStyleProp(goalCount, 'fontSize')).toBe(getStyleProp(weightCount, 'fontSize'));
      expect(getStyleProp(goalCount, 'fontWeight')).toBe(getStyleProp(weightCount, 'fontWeight'));
      expect(getStyleProp(goalCount, 'color')).toBe(getStyleProp(weightCount, 'color'));
    });

    test('Weight History hides its column headers when collapsed, shows them when expanded', () => {
      const component = setup(null, entries);
      const root = component.root;
      const findLabel = (text) => root.findAllByType('Text').some(t => {
        const c = t.props.children;
        return (Array.isArray(c) ? c.join('') : String(c ?? '')) === text;
      });

      // Expanded by default: the Change/Date column labels are present.
      expect(findLabel('Change')).toBe(true);

      const toggle = root.findByProps({ accessibilityLabel: 'Collapse history' });
      render.act(() => { toggle.props.onPress(); });

      // Collapsed: column-header chrome is gone (only the summary line remains).
      expect(findLabel('Change')).toBe(false);
    });
  });

  // Goal action chips are visually compact; they expose an enlarged hitSlop so
  // the effective touch target meets the 44px minimum without changing their
  // visual size (#404).
  describe('goal action chip touch targets (#404)', () => {
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

    test('Edit and Clear chips expose an enlarged hitSlop when a goal is in progress', () => {
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 185, note: '' },
      ];
      const component = setup(goal, entries);
      const editChip = findPressableByText(component.root, 'Edit');
      const clearChip = findPressableByText(component.root, 'Clear');
      expect(editChip).toBeTruthy();
      expect(clearChip).toBeTruthy();
      expect(editChip.props.hitSlop).toBe(12);
      expect(clearChip.props.hitSlop).toBe(12);
    });

    test('Archive chip exposes an enlarged hitSlop when a goal is met', () => {
      const goal = { target_weight: 175, target_date: '2026-05-24', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 174, note: '' },
      ];
      const component = setup(goal, entries);
      const archiveChip = findPressableByText(component.root, 'Archive');
      expect(archiveChip).toBeTruthy();
      expect(archiveChip.props.hitSlop).toBe(12);
    });
  });
});
