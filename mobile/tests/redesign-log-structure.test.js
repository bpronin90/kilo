// #1606 (redesign v3 R7): structure of the Log tab's note-first read view.
// Every fixture is parsed by the production parser and grouped by the
// production `buildDayGroups`; the Log presentation renders those structures
// as-is. These tests pin the presentation contract (fold count/order, LAST
// tag, warnings never folded, day index from parsed headings, header actions
// as the single owner, Week A/B radios) without touching parser semantics.
import React from 'react';
import render from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { parseWorkoutNote } from '../lib/parser';
import { buildDayGroups } from '../screens/log/logScreenHelpers';
import { WorkoutContentRenderer } from '../components/WorkoutContentRenderer';
import { deriveLogDays, useLogDayNav, LogDayIndex } from '../screens/log/LogDayIndex';
import { useLogRoutineActions } from '../components/log/LogRoutineActionSheet';
import { LogRoutineHeaderActions } from '../screens/log/LogRoutineHeaderActions';
import { LogSetLine } from '../components/log/LogExerciseRows';
import { ThemeProvider } from '../theme/ThemeContext';
import { buildExerciseHistory } from '../components/log/exerciseHistoryPresentation';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));

const groupsFor = (text) => buildDayGroups(parseWorkoutNote(text).sections);

const textOf = (node) => {
  const c = node.props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
};
const flat = (node) => StyleSheet.flatten(node.props.style) || {};
// A node is hidden when it or any ancestor carries display:none.
const isHidden = (node) => {
  for (let n = node; n; n = n.parent) {
    if (n.props && n.props.style && flat(n).display === 'none') return true;
  }
  return false;
};
// Host nodes carry the a11y props; the owning Pressable carries onPress.
const press = (node, evt = { stopPropagation: () => {} }) => {
  let n = node;
  while (n && !(n.props && typeof n.props.onPress === 'function')) n = n.parent;
  render.act(() => { n.props.onPress(evt); });
};
const hostSetLines = (root) => root.findAll(n => typeof n.type === 'string'
  && (n.props.testID === 'log-set-line' || n.props.testID === 'log-set-line-last'));

function renderLog(text, props = {}) {
  let c;
  render.act(() => {
    c = render.create(
      <WorkoutContentRenderer
        dayGroups={groupsFor(text)}
        presentation="log"
        sourceNoteId="n1"
        sourceWeekIndex={0}
        sourceSliceText={text}
        {...props}
      />
    );
  });
  return c;
}

const FIVE_SESSIONS = [
  'Monday — Upper',
  '+Strength',
  '-Bench',
  '135 5,5,5',
  '140 5,5',
  '-',
  '145 5,5',
  '150 5,4',
].join('\n');

describe('Log presentation: inline sessions and the earlier-sessions fold', () => {
  test('shows the newest three sessions, folds the rest in place, and marks the latest LAST', () => {
    const { root } = renderLog(FIVE_SESSIONS);
    const lines = hostSetLines(root);
    // Four logged rows (the skip is a session too but has no set line).
    expect(lines).toHaveLength(4);
    // Five sessions -> two folded, in note order: 135 and 140 rows.
    expect(lines.map(isHidden)).toEqual([true, true, false, false]);
    expect(lines.filter(n => n.props.testID === 'log-set-line-last')).toHaveLength(1);
    expect(lines[3].props.testID).toBe('log-set-line-last');
    expect(root.findAll(n => n.type === Text && textOf(n) === 'LAST').length).toBeGreaterThan(0);

    const earlier = root.find(n => typeof n.type === 'string' && n.props.testID === 'log-exercise-0-0-0-earlier');
    expect(earlier.props.accessibilityLabel).toBe('2 earlier sessions of Bench');
    expect(earlier.props.accessibilityState).toEqual({ expanded: false });

    press(earlier);
    const after = hostSetLines(root);
    expect(after.map(isHidden)).toEqual([false, false, false, false]);
    const toggle = root.find(n => typeof n.type === 'string' && n.props.testID === 'log-exercise-0-0-0-earlier');
    expect(toggle.props.accessibilityState).toEqual({ expanded: true });
    expect(toggle.props.accessibilityLabel).toBe('Show last 3 sessions of Bench');
  });

  test('three or fewer sessions render with no fold control', () => {
    const { root } = renderLog('Monday\n-Squat\n225 5,5\n235 5,5');
    expect(root.findAll(n => n.props && n.props.testID === 'log-exercise-0-0-0-earlier')).toHaveLength(0);
    expect(hostSetLines(root).map(isHidden)).toEqual([false, false]);
  });

  test('parse warnings are never folded away', () => {
    const text = 'Monday\n-Row\n100 8,8\n105 8,8\n110 8,8\nnot a set line ???\n115 8,8';
    const parsedEx = groupsFor(text)[0].sections[0].exercises[0];
    // Guard: the fixture really carries an unparsed row.
    expect((parsedEx.unparsed_positions || []).length + parsedEx.unparsed_rows.length).toBeGreaterThan(0);
    const { root } = renderLog(text);
    const raw = root.findAll(n => n.type === Text && textOf(n).includes('not a set line'));
    expect(raw.length).toBeGreaterThan(0);
    raw.forEach(n => expect(isHidden(n)).toBe(false));
  });

  test('expansion is dropped when the note slice changes', () => {
    let c;
    const el = (slice) => (
      <WorkoutContentRenderer
        dayGroups={groupsFor(FIVE_SESSIONS)}
        presentation="log"
        sourceNoteId="n1"
        sourceWeekIndex={0}
        sourceSliceText={slice}
      />
    );
    render.act(() => { c = render.create(el(FIVE_SESSIONS)); });
    const earlier = () => c.root.find(n => typeof n.type === 'string' && n.props.testID === 'log-exercise-0-0-0-earlier');
    press(earlier());
    expect(earlier().props.accessibilityState).toEqual({ expanded: true });
    render.act(() => { c.update(el(`${FIVE_SESSIONS}\n`)); });
    expect(earlier().props.accessibilityState).toEqual({ expanded: false });
  });

  test('Tracked keeps its label, hint and handler', () => {
    const onToggleTrack = jest.fn();
    const { root } = renderLog(FIVE_SESSIONS, { trackedLifts: {}, onToggleTrack });
    const track = root.find(n => typeof n.type === 'string' && n.props.accessibilityLabel === 'Track');
    expect(track.props.accessibilityHint).toMatch(/Progressive Overload/);
    press(track);
    expect(onToggleTrack).toHaveBeenCalledWith('Bench');
  });

  test('the default presentation is unchanged (no Log rows)', () => {
    let c;
    render.act(() => { c = render.create(<WorkoutContentRenderer dayGroups={groupsFor(FIVE_SESSIONS)} />); });
    expect(hostSetLines(c.root)).toHaveLength(0);
    expect(c.root.findAll(n => n.type === Text && textOf(n) === 'LAST')).toHaveLength(0);
  });

  test('a deload renders its lines bold without a LAST tag and without Track', () => {
    const { root } = renderLog('Monday\n-Bench\n135 5,5', { isDeload: true, onToggleTrack: jest.fn() });
    expect(root.findAll(n => n.type === Text && textOf(n) === 'LAST')).toHaveLength(0);
    expect(root.findAll(n => n.props && n.props.accessibilityLabel === 'Track')).toHaveLength(0);
  });
});

const SQUAT_MULTI_WEIGHT = '-Squat 3x8\n95 10, 165 8,8,8\n95 10, 175 8,8,8\n-\n95 10, 185 8,8,8\n95 10, 195 6,6 185 8';
const lineText = line => line.findAll(n => n.type === Text).map(textOf);

describe('Multi-weight session layout', () => {
  test('exact Squat fixture keeps five sessions, ordered groups and one latest badge in Log and history', () => {
    const exercise = groupsFor(SQUAT_MULTI_WEIGHT)[0].sections[0].exercises[0];
    const history = buildExerciseHistory(exercise);
    expect(history.sessionCount).toBe(5);
    expect(history.sessions.map(s => s.kind)).toEqual(['logged', 'logged', 'skipped', 'logged', 'logged']);
    const { root } = renderLog(SQUAT_MULTI_WEIGHT);
    press(root.find(n => typeof n.type === 'string' && n.props.testID === 'log-exercise-0-0-0-earlier'));
    const lines = hostSetLines(root);
    expect(lines).toHaveLength(4);
    expect(lines.map(isHidden)).toEqual([false, false, false, false]);
    expect(lines.map(lineText)).toEqual([
      ['95 lb', '10', '165 lb', '8, 8, 8'],
      ['95 lb', '10', '175 lb', '8, 8, 8'],
      ['95 lb', '10', '185 lb', '8, 8, 8'],
      ['95 lb', '10', '195 lb', '6, 6', '185 lb', '8', 'LAST'],
    ]);
    const latest = lines[3];
    const badge = latest.find(n => typeof n.type !== 'string' && n.props.accessibilityLabel === 'Last session');
    const groupRail = badge.parent;
    // Badge participates in the same wrap flow, after every group; it does
    // not reserve a separate column across all of the session's lines.
    expect(groupRail.children[groupRail.children.length - 1]).toBe(badge);
    expect(flat(groupRail)).toMatchObject({ flexWrap: 'wrap', columnGap: 16 });
    const weights = latest.findAll(n => n.type === Text && / lb$/.test(textOf(n)));
    weights.forEach(weight => {
      expect(flat(weight).minWidth).toBeUndefined();
      expect(flat(weight).width).toBeUndefined();
      expect(flat(weight).marginRight).toBeUndefined();
      expect(flat(weight.parent.parent)).toMatchObject({ columnGap: 4, maxWidth: '100%', flexWrap: 'wrap' });
    });

    let tree;
    render.act(() => { tree = render.create(<ThemeProvider><WorkoutContentRenderer dayGroups={groupsFor(SQUAT_MULTI_WEIGHT)} presentation="log" /></ThemeProvider>); });
    press(tree.root.find(n => typeof n.type === 'string' && n.props.accessibilityLabel === 'Squat history'));
    const sheet = tree.root.find(n => typeof n.type === 'string' && n.props.testID === 'exercise-history-sheet');
    const rows = sheet.findAll(n => typeof n.type === 'string' && /^exercise-history-session-/.test(n.props.testID || ''));
    expect(rows.map(n => n.props.testID)).toEqual([5, 4, 3, 2, 1].map(i => `exercise-history-session-${i}`));
    expect(lineText(hostSetLines(sheet)[0])).toEqual(lineText(latest));
    expect(hostSetLines(sheet).filter(n => n.props.testID === 'log-set-line-last')).toHaveLength(1);
  });

  test('long groups may wrap internally without truncation; grouping metadata and existing ink survive', () => {
    const sets = [
      { weight_value: 95, rep_count: 10 },
      { weight_value: 95, converted_from_kg: true, kg_value: 43, rep_count: 8 },
      { weight_value: 95, converted_from_kg: true, kg_value: 44, skipped: true },
      { weight_value: null, duration_seconds: 60 },
      { weight_value: null, rep_count: 12 },
      ...Array.from({ length: 60 }, () => ({ weight_value: 195, rep_count: 8 })),
    ];
    let tree;
    render.act(() => { tree = render.create(<LogSetLine sets={sets} unit="lb" mark="steady" tone="last" />); });
    const texts = tree.root.findAll(n => n.type === Text);
    expect(texts.map(textOf).slice(0, 10)).toEqual(['95 lb', '10', '95 lb (43kg)', '8', '95 lb (44kg)', '-', 'BW', '60s, 12', '195 lb', Array(60).fill(8).join(', ')]);
    expect(texts.map(textOf)).toContain('★ steady');
    texts.forEach(n => {
      expect(n.props.numberOfLines).toBeUndefined();
      expect(n.props.ellipsizeMode).toBeUndefined();
    });
    const reps = texts.find(n => textOf(n) === Array(60).fill(8).join(', '));
    expect(flat(reps)).toMatchObject({ maxWidth: '100%' });
    expect(flat(reps.parent.parent)).toMatchObject({ maxWidth: '100%', flexWrap: 'wrap' });
    expect(flat(texts[0])).toMatchObject({ fontSize: 17, lineHeight: 24 });
    render.act(() => { tree.update(<LogSetLine sets={sets} unit="kg" tone="old" />); });
    const old = tree.root.findAll(n => n.type === Text);
    expect(textOf(old[0])).toBe('43.1 kg');
    expect(flat(old[0])).toMatchObject({ fontSize: 15, lineHeight: 22 });
    expect(old.map(textOf)).not.toContain('LAST');
  });
});

describe('Sticky day index', () => {
  test('derives chips from parsed headings, keeping repeated and custom labels distinct', () => {
    const text = 'Monday — Upper\n-Bench\n135 5\nDay 2\n-Squat\n225 5\nMonday — Upper\n-Row\n100 8';
    const groups = groupsFor(text);
    const days = deriveLogDays(groups);
    expect(days.map(d => [d.index, d.label, d.sub])).toEqual(
      groups.map((g, i) => [i, ...(/^Monday/.test(g.heading) ? ['Mon', 'Upper'] : [g.heading, null])])
    );
    expect(deriveLogDays([{ heading: null, sections: [] }, { heading: 'Push', sections: [] }]))
      .toEqual([{ index: 1, heading: 'Push', label: 'Push', sub: null }]);
  });

  test('a chip scrolls the read view to that parsed day group', () => {
    const scrollTo = jest.fn();
    const scrollRef = { current: { scrollTo } };
    const days = [
      { index: 0, heading: 'Monday — Upper', label: 'Mon', sub: 'Upper' },
      { index: 1, heading: 'Tuesday — Lower', label: 'Tue', sub: 'Lower' },
    ];
    let nav;
    function Harness() {
      nav = useLogDayNav({ scrollRef, scopeKey: 'n1|A|text' });
      return <LogDayIndex days={days} nav={nav} />;
    }
    let c;
    render.act(() => { c = render.create(<Harness />); });
    const layout = (y, height = 0) => ({ nativeEvent: { layout: { y, height } } });
    render.act(() => {
      nav.onCardLayout(layout(100, 2000));
      nav.onIndexLayout(layout(80, 60));
      nav.onBodyLayout(layout(140));
      nav.onDayLayout(0, 0);
      nav.onDayLayout(1, 700);
    });
    const tabs = c.root.findAll(n => typeof n.type === 'string' && n.props.accessibilityRole === 'tab');
    expect(tabs.map(t => t.props.accessibilityLabel)).toEqual(['Monday — Upper', 'Tuesday — Lower']);
    press(tabs[1]);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ y: 100 + 140 + 700 - 60 - 4 }));
  });

  test('fewer than two days renders no index', () => {
    let c;
    function Harness() {
      const nav = useLogDayNav({ scrollRef: { current: null }, scopeKey: 'x' });
      return <LogDayIndex days={[{ index: 0, heading: 'Monday', label: 'Mon', sub: null }]} nav={nav} />;
    }
    render.act(() => { c = render.create(<Harness />); });
    expect(c.toJSON()).toBeNull();
  });
});

describe('Root-header routine actions are the single owner', () => {
  function Screen({ hasABWeeks = false, handleToggleWeek = jest.fn() }) {
    const actions = useLogRoutineActions({
      workoutNoteTitle: 'Upper / Lower',
      routineRawText: FIVE_SESSIONS,
      activeEditText: FIVE_SESSIONS,
      enterCurrentEditor: jest.fn(),
      handleSkipWeek: jest.fn(),
      isCollapsed: false,
      toggleCollapsed: jest.fn(),
    });
    return (
      <>
        <LogRoutineHeaderActions actions={actions} />
        <LogActiveRoutineCard
          workoutNoteTitle="Upper / Lower"
          hasABWeeks={hasABWeeks}
          effectiveActiveWeek="A"
          handleToggleWeek={handleToggleWeek}
          enterCurrentEditor={jest.fn()}
          handleNoteBodyPress={jest.fn()}
          toggleCollapsed={jest.fn()}
          isCollapsed={false}
          dayGroups={groupsFor(FIVE_SESSIONS)}
          trackedLifts={{}}
          handleToggleTrack={jest.fn()}
          roughNoteId="n1"
          currentId="n1"
          roughFlaggedNames={new Set()}
          activeEditText={FIVE_SESSIONS}
          routineActions={actions}
        />
      </>
    );
  }

  test('one Plates button, one actions trigger, one plate calculator and one sheet', () => {
    let c;
    render.act(() => { c = render.create(<Screen />); });
    const hosts = (pred) => c.root.findAll(n => typeof n.type === 'string' && pred(n.props));
    expect(hosts(p => p.testID === 'log-plate-calculator-button')).toHaveLength(1);
    expect(hosts(p => p.accessibilityLabel === 'Routine actions')).toHaveLength(1);
    expect(c.root.findAll(n => n.type && n.type.name === 'PlateCalculatorModal')).toHaveLength(1);
    const trigger = hosts(p => p.accessibilityLabel === 'Routine actions')[0];
    press(trigger);
    expect(hosts(p => p.testID === 'log-current-routine-menu')).toHaveLength(1);
    const labels = [...new Set(hosts(p => p.accessibilityRole === 'menuitem').map(n => n.props.accessibilityLabel))];
    expect(labels).toEqual([
      'Edit routine', 'Skip week', 'Plate calculator', 'Copy routine Upper / Lower', 'Share routine', 'Share routine as image',
    ]);
  });

  test('Week A/B is a radio group that only toggles toward the other week', () => {
    const handleToggleWeek = jest.fn();
    let c;
    render.act(() => { c = render.create(<Screen hasABWeeks handleToggleWeek={handleToggleWeek} />); });
    const group = c.root.find(n => typeof n.type === 'string' && n.props.accessibilityRole === 'radiogroup');
    const radios = group.findAll(n => typeof n.type === 'string' && n.props.accessibilityRole === 'radio');
    expect(radios.map(r => [r.props.accessibilityLabel, r.props.accessibilityState.checked])).toEqual([
      ['Week A', true], ['Week B', false],
    ]);
    press(radios[0]);
    expect(handleToggleWeek).not.toHaveBeenCalled();
    press(radios[1]);
    expect(handleToggleWeek).toHaveBeenCalledTimes(1);
  });
});
