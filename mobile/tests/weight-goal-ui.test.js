import React from 'react';
import render from 'react-test-renderer';
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
    expect(findText(root, 'Pace')).toBeTruthy();
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

    test('shows "Goal Met!" badge when current weight has reached a loss goal', () => {
      // Loss goal: target 175, start 200. Current weight entry at 175 → goal met.
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 175, note: '' },
      ];
      const component = setup(goal, entries);
      expect(hasTextSafe(component.root, 'Goal Met!')).toBe(true);
    });

    test('shows "Archive" action chip when goal is met', () => {
      const goal = { target_weight: 175, target_date: '2026-09-01', start_weight: 200 };
      const entries = [
        { id: '1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 174, note: '' },
      ];
      const component = setup(goal, entries);
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

    test('shows "Goal Met!" for a gain goal when current reaches target', () => {
      const goal = { target_weight: 185, target_date: '2026-09-01', start_weight: 160 };
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

    test('hides archived goals section when there are no archived goals', () => {
      const component = setup(null, [], []);
      expect(hasTextSafe(component.root, 'Goal History')).toBe(false);
    });

    test('renders Goal History section and list with target weight, completed weight, target date, and archived date', () => {
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
      expect(hasTextSafe(root, '175 lb')).toBe(true);
      expect(hasTextSafe(root, 'Completed: 174.5 lb')).toBe(true);
      expect(hasTextSafe(root, 'By 09-01-2026')).toBe(true);
      expect(hasTextSafe(root, 'Archived: 09-02-2026')).toBe(true);
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
});
