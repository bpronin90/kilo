// #1607: per-exercise history sheet — presentation over one parsed exercise
// occurrence, keyed to that occurrence and dropped on routine/week change.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { parseWorkoutNote } from '../lib/parser';
import { WorkoutContentRenderer } from '../components/WorkoutContentRenderer';
import { ThemeProvider } from '../theme/ThemeContext';
import { buildExerciseHistory, topSetLoad, describeLoadPoints } from '../components/log/exerciseHistoryPresentation';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => 'dark') }));
jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lb' }));

function dayGroupsOf(text) {
  const groups = [];
  for (const section of parseWorkoutNote(text).sections) {
    const last = groups[groups.length - 1];
    if (last && last.heading === section.heading) last.sections.push(section);
    else groups.push({ heading: section.heading, sections: [section] });
  }
  return groups;
}

const NOTE = [
  'Monday', '+Strength', '-Bench Press', '205 5,5,5', '210 5,5,5', '215 5,5,5',
  'Thursday', '+Strength', '-Bench Press', '135 8,8,8', 'BW 10,10', '60s',
].join('\n');

function renderLog(text, props = {}) {
  let tree;
  act(() => {
    tree = TestRenderer.create(
      <ThemeProvider>
        <WorkoutContentRenderer dayGroups={dayGroupsOf(text)} presentation="log" sourceNoteId="n1" sourceWeekIndex={0} sourceSliceText={text} {...props} />
      </ThemeProvider>,
    );
  });
  return tree;
}
const byTestId = (tree, id) => tree.root.findAll(n => n.props && n.props.testID === id && typeof n.type !== 'string');
const sheetText = (tree) => byTestId(tree, 'exercise-history-sheet')
  .flatMap(sheet => sheet.findAll(n => n.type === 'Text' || (typeof n.type === 'string' && n.type === 'Text')))
  .map(n => [].concat(n.props.children).join('')).join('|');

describe('exerciseHistoryPresentation', () => {
  test('top-set load reads parsed weight_value only; BW/timed/skipped omitted, never zero', () => {
    expect(topSetLoad([{ weight_value: 200 }, { weight_value: 225 }])).toBe(225);
    expect(topSetLoad([{ weight_value: null, rep_count: 10 }])).toBeNull();
    expect(topSetLoad([{ weight_value: 50, duration_seconds: 60 }])).toBeNull();
    expect(topSetLoad([{ weight_value: 300, skipped: true }])).toBeNull();
  });

  test('sessions keep note order with skipped/unparsed preserved; points index by session', () => {
    const ex = dayGroupsOf(NOTE)[1].sections[0].exercises[0];
    const { sessions, points } = buildExerciseHistory(ex);
    const numbered = sessions.filter(s => s.index != null).map(s => s.index);
    expect(numbered).toEqual(numbered.map((_, i) => i + 1));
    expect(points).toEqual([{ index: 1, load: 135 }]);
    expect(describeLoadPoints(points, 'lb')).toBe('Top-set load by session: session 1, 135 lb');
    expect(describeLoadPoints([], 'lb')).toMatch(/No numeric load/);
  });
});

test('positional unparsed source rows are kept verbatim, unnumbered and uncharted', () => {
  const ex = dayGroupsOf('Monday\n+Strength\n-Bench Press\n185 5,5,5\nnot a set line ???\n-')[0].sections[0].exercises[0];
  const { sessions, points, sessionCount } = buildExerciseHistory(ex);
  expect(sessions.map(s => [s.kind, s.index])).toEqual([['logged', 1], ['unparsed', null], ['skipped', 2]]);
  expect(sessions[1].raw).toBe('not a set line ???');
  expect(sessionCount).toBe(2);
  expect(points).toEqual([{ index: 1, load: 185 }]);
});

describe('ExerciseHistorySheet in the Log renderer', () => {
  test('history button is a labelled 44dp target per occurrence and opens that occurrence only', () => {
    const tree = renderLog(NOTE);
    const btns = tree.root.findAll(n => n.props && n.props.accessibilityLabel === 'Bench Press history' && typeof n.props.onPress === 'function');
    expect(btns.length).toBeGreaterThanOrEqual(2);
    const monday = byTestId(tree, 'log-exercise-0-0-0-history')[0];
    expect(monday.props.style.minHeight ?? 44).toBeGreaterThanOrEqual(44);
    act(() => { monday.props.onPress(); });
    const text = sheetText(tree);
    expect(text).toContain('Monday');
    expect(text).not.toContain('Thursday');
    expect(byTestId(tree, 'exercise-history-session-3').length).toBe(1);
    expect(byTestId(tree, 'exercise-history-chart')[0].props.accessibilityLabel).toContain('session 3, 215 lb');
  });

  test('chart points select a session and move the callout; latest is the default', () => {
    const tree = renderLog(NOTE);
    act(() => { byTestId(tree, 'log-exercise-0-0-0-history')[0].props.onPress(); });
    const callout = () => [].concat(byTestId(tree, 'exercise-history-callout')[0].props.children).join('');
    expect(callout()).toBe('Latest · 215 lb');
    const first = byTestId(tree, 'exercise-history-point-1')[0];
    expect(first.props.style.width).toBeGreaterThanOrEqual(44);
    act(() => { first.props.onPress(); });
    expect(callout()).toBe('Session 1 · 205 lb');
    expect(byTestId(tree, 'exercise-history-point-1')[0].props.accessibilityState).toEqual({ selected: true });
  });

  test('repeated name on another day keeps its own context and sessions', () => {
    const tree = renderLog(NOTE);
    act(() => { byTestId(tree, 'log-exercise-1-0-0-history')[0].props.onPress(); });
    expect(sheetText(tree)).toContain('Thursday');
    expect(byTestId(tree, 'exercise-history-chart')[0].props.accessibilityLabel).not.toContain('215');
  });

  test('close clears the sheet; a routine/week change drops a stale selection', async () => {
    const tree = renderLog(NOTE);
    act(() => { byTestId(tree, 'log-exercise-0-0-0-history')[0].props.onPress(); });
    act(() => { byTestId(tree, 'exercise-history-close')[0].props.onPress(); });
    // Let the focus-return tick run inside the test environment.
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(byTestId(tree, 'exercise-history-sheet')).toHaveLength(0);
    act(() => { byTestId(tree, 'log-exercise-0-0-0-history')[0].props.onPress(); });
    act(() => {
      tree.update(
        <ThemeProvider>
          <WorkoutContentRenderer dayGroups={dayGroupsOf(NOTE)} presentation="log" sourceNoteId="n2" sourceWeekIndex={0} sourceSliceText={NOTE} />
        </ThemeProvider>,
      );
    });
    expect(byTestId(tree, 'exercise-history-sheet')).toHaveLength(0);
  });

  test('default presentation has no history control', () => {
    const tree = renderLog(NOTE, { presentation: 'default' });
    expect(tree.root.findAll(n => n.props && n.props.accessibilityLabel === 'Bench Press history')).toHaveLength(0);
  });
});
