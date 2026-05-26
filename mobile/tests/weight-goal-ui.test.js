import React from 'react';
import render from 'react-test-renderer';
import { WeightScreen } from '../screens/WeightScreen';
import * as useEntries from '../hooks/useEntries';

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

// Mock current date for consistent testing
// May 24, 2026 is a Sunday.
// Aug 2, 2026 is exactly 10 weeks later.
const MOCK_NOW = new Date('2026-05-24T12:00:00Z');
jest.useFakeTimers().setSystemTime(MOCK_NOW);

describe('WeightScreen', () => {
  const defaultProps = {
    weightValue: '',
    setWeightValue: jest.fn(),
    weightNote: '',
    setWeightNote: jest.fn(),
    onSaveWeight: jest.fn(),
    errorMessage: '',
    saving: false,
  };

  const setup = (goal, entries = [], profile = null) => {
    useEntries.useWeightEntries.mockReturnValue({ entries, remove: jest.fn(), update: jest.fn() });
    useEntries.useWeightGoal.mockReturnValue({ goal, save: jest.fn(), clear: jest.fn() });
    useEntries.useUserProfile.mockReturnValue({ profile, save: jest.fn(), clear: jest.fn() });
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

  test('renders "no-estimate" state (future target date missing)', () => {
    const goal = { target_weight: 180, target_date: '2026-05-24', start_weight: 200 };
    const component = setup(goal);
    const root = component.root;

    expect(findText(root, 'Target pace')).toBeTruthy();
    expect(findText(root, '-')).toBeTruthy();
    expect(findText(root, 'Select a future target date for guidance.')).toBeTruthy();
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
    expect(findText(root, '500 cal / day (estimate)')).toBeTruthy();
  });

  test('renders "gain" state', () => {
    const goal = { target_weight: 190, target_date: '2026-08-02', start_weight: 180 };
    const component = setup(goal);
    const root = component.root;

    // 180 -> 190 in 70 days (10 weeks) = 1.00 lb/week
    expect(findText(root, '1.00 lb / week')).toBeTruthy();
    expect(findText(root, 'Suggested')).toBeTruthy();
    expect(findText(root, 'surplus')).toBeTruthy();
    expect(findText(root, '500 cal / day (estimate)')).toBeTruthy();
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
});
