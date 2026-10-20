// Movement groups (#1306): the deterministic one-group taxonomy, the override
// map, the group-score derivation over #1305's rows, and the Recovery UI.

import React from 'react';
import render, { act } from 'react-test-renderer';
import {
  MOVEMENT_GROUPS, MOVEMENT_GROUP_IDS, OVERRIDE_STATE, keywordMovementGroup, movementGroupMapError,
  nextMovementGroupMap, readMovementOverrides, resolveMovementGroup,
} from '../lib/data/movementGroups';
import { deriveMovementGroupBreakdown, resolveMovementGroupSource } from '../lib/data/recoveryMovementGroups';
import { deriveRecoveryStrength } from '../lib/data/recoveryStrength';
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { movementGroupsNoteError } from '../storage/entries/movementGroupValidation';
import { AnalyticsRecoverySection } from '../components/AnalyticsRecoverySection';
import { LogRecoverySection } from '../components/LogRecoverySection';

const mockSetMovementGroup = jest.fn();
jest.mock('../hooks/entries/movementGroupHooks', () => ({
  useMovementGroupEditor: () => ({ setMovementGroup: (...args) => mockSetMovementGroup(...args) }),
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));

// ── keyword table ────────────────────────────────────────────────────────────

const TABLE = [
  // hinge
  ['Deadlift', 'hinge'], ['deadlifts', 'hinge'], ['Romanian Deadlift', 'hinge'], ['RDL', 'hinge'], ['  rdl  ', 'hinge'],
  ['Trap Bar Deadlift', 'hinge'], ['Good Morning', 'hinge'], ['good-mornings', 'hinge'], ['Hip Thrust', 'hinge'],
  ['Barbell Hip Thrusts', 'hinge'], ['Glute Bridge', 'hinge'], ['Leg Curl', 'hinge'], ['Seated LEG  CURL', 'hinge'],
  ['Lying Hamstring Curl', 'hinge'], ['Single Leg RDL', 'hinge'],
  // legs
  ['Squat', 'legs'], ['Back Squat', 'legs'], ['Front squats', 'legs'], ['Bulgarian Split Squat', 'legs'],
  ['Leg Press', 'legs'], ['Leg Presses', 'legs'], ['Shoulder Presses', 'shoulders'], ['Bench Presses', 'push'], ['Press', 'other'], ['Walking Lunges', 'legs'], ['Reverse Lunge', 'legs'], ['Leg Extension', 'legs'],
  ['Leg Extensions', 'legs'], ['Step-Up', 'legs'],
  // push
  ['Bench Press', 'push'], ['DB Bench Press', 'push'], ['Incline DB Press', 'push'], ['Chest Press', 'push'],
  ['Push-Up', 'push'], ['push ups', 'push'], ['Pushup', 'push'], ['Cable Fly', 'push'], ['Pec Deck', 'push'], ['Dips', 'push'],
  ['Bench', 'push'],
  // pull
  ['Barbell Row', 'pull'], ['Pull-Up', 'pull'], ['pull ups', 'pull'], ['Chin-Up', 'pull'], ['Lat Pulldown', 'pull'],
  ['Hammer Strength Iso Row', 'pull'], ['Seated Cable Row', 'pull'],
  // shoulders
  ['Overhead Press', 'shoulders'], ['Shoulder Press', 'shoulders'], ['OHP', 'shoulders'], ['Lateral Raise', 'shoulders'],
  ['Front Raises', 'shoulders'], ['Rear Delt Fly', 'shoulders'], ['Reverse Fly', 'shoulders'], ['Upright Row', 'shoulders'],
  ['Push Press', 'shoulders'],
  // arms
  ['Biceps Curl', 'arms'], ['Bicep Curl', 'arms'], ['Hammer Curl', 'arms'], ['EZ Bar Curl', 'arms'], ['Preacher Curl', 'arms'],
  ['Triceps Extension', 'arms'], ['Overhead Triceps Extension', 'arms'], ['Tricep Pushdown', 'arms'], ['Cable Pushdown', 'arms'],
  ['Skull Crusher', 'arms'],
  // core
  ['Plank', 'core'], ['Crunches', 'core'], ['Cable Crunch', 'core'], ['Ab Wheel', 'core'], ['Hanging Leg Raise', 'core'],
  ['Sit-Ups', 'core'], ['Pallof Press', 'core'],
  // other (no decisive explicit rule)
  ['Treadmill', 'other'], ['Rowing Machine', 'other'], ['Calf Raise', 'other'], ['Face Pull', 'other'],
  ['Farmer Carry', 'other'], ['Mystery Machine', 'other'], ['', 'other'], ['Stretching', 'other'],
];

describe('keyword rules', () => {
  test.each(TABLE)('%s -> %s', (name, group) => {
    expect(keywordMovementGroup(name)).toBe(group);
  });

  test('every output is exactly one valid group id', () => {
    for (const [name] of TABLE) expect(MOVEMENT_GROUP_IDS).toContain(keywordMovementGroup(name));
    expect(MOVEMENT_GROUPS.map(g => g.label)).toEqual([
      'Push', 'Pull', 'Shoulders', 'Arms', 'Legs (quad-dominant)', 'Hinge / posterior chain', 'Core', 'Other',
    ]);
  });

  test('specific beats general: hinge before legs, leg curl before curl, triceps extension before leg extension', () => {
    expect(keywordMovementGroup('Single Leg Deadlift')).toBe('hinge');
    expect(keywordMovementGroup('Leg Curl')).toBe('hinge');
    expect(keywordMovementGroup('Curl')).toBe('arms');
    expect(keywordMovementGroup('Triceps Extension')).toBe('arms');
    expect(keywordMovementGroup('Leg Extension')).toBe('legs');
    expect(keywordMovementGroup('Overhead Press')).toBe('shoulders');
    expect(keywordMovementGroup('Bench Press')).toBe('push');
    expect(keywordMovementGroup('Rear Delt Fly')).toBe('shoulders');
    expect(keywordMovementGroup('Cable Fly')).toBe('push');
    expect(keywordMovementGroup('Upright Row')).toBe('shoulders');
  });

  test('whole-word matching: row does not match rowing, dip does not match dipping', () => {
    expect(keywordMovementGroup('Rowing')).toBe('other');
    expect(keywordMovementGroup('Rower')).toBe('other');
  });

  test('is deterministic, and the same for a name and its normalized key', () => {
    expect(keywordMovementGroup('Romanian Deadlift')).toBe(keywordMovementGroup('rdl'));
    expect(keywordMovementGroup('BB Bench Press')).toBe('push');
  });
});

// ── override map ──────────────────────────────────────────────────────────────

describe('override map', () => {
  const ok = { version: 1, overrides: { deadlift: 'hinge' } };

  test('null/undefined is rules only; a valid map reads; the shape is exact', () => {
    expect(readMovementOverrides(null)).toEqual({ state: OVERRIDE_STATE.RULES_ONLY, overrides: {} });
    expect(readMovementOverrides(undefined).state).toBe(OVERRIDE_STATE.RULES_ONLY);
    expect(readMovementOverrides(ok)).toEqual({ state: OVERRIDE_STATE.OVERRIDES, overrides: { deadlift: 'hinge' } });
    expect(movementGroupMapError(ok)).toBeNull();
    expect(movementGroupMapError({ version: 1, overrides: {} })).toBeNull();
  });

  test.each([
    ['array', []],
    ['string', 'x'],
    ['version 2', { version: 2, overrides: {} }],
    ['no version', { overrides: {} }],
    ['extra top-level field', { version: 1, overrides: {}, extra: 1 }],
    ['overrides array', { version: 1, overrides: [] }],
    ['multi-group array', { version: 1, overrides: { squat: ['legs', 'hinge'] } }],
    ['unknown id', { version: 1, overrides: { squat: 'quads' } }],
    ['empty key', { version: 1, overrides: { '': 'legs' } }],
    ['key > 200', { version: 1, overrides: { ['k'.repeat(201)]: 'legs' } }],
  ])('invalid: %s is an explicit invalid state, never accepted', (_label, value) => {
    expect(movementGroupMapError(value)).toEqual(expect.any(String));
    expect(readMovementOverrides(value)).toMatchObject({ state: OVERRIDE_STATE.INVALID, overrides: {} });
  });

  test('1000 keys is the limit', () => {
    const many = (n) => ({ version: 1, overrides: Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 'other'])) });
    expect(movementGroupMapError(many(1000))).toBeNull();
    expect(movementGroupMapError(many(1001))).toMatch(/too many/);
    expect(movementGroupMapError({ version: 1, overrides: { ['k'.repeat(200)]: 'legs' } })).toBeNull();
  });

  test('set, change and reset; reset removes the key so the rules apply again; an emptied map stays a map', () => {
    const set = nextMovementGroupMap(null, 'Deadlift', 'legs');
    expect(set).toEqual({ ok: true, map: { version: 1, overrides: { deadlift: 'legs' } } });
    expect(resolveMovementGroup('Deadlift', set.map.overrides)).toMatchObject({ group: 'legs', source: 'override' });
    const changed = nextMovementGroupMap(set.map, 'deadlift', 'other');
    expect(changed.map.overrides).toEqual({ deadlift: 'other' });
    const reset = nextMovementGroupMap(changed.map, 'DEADLIFT', null);
    expect(reset.map).toEqual({ version: 1, overrides: {} });
    expect(resolveMovementGroup('Deadlift', reset.map.overrides)).toMatchObject({ group: 'hinge', source: 'rules' });
  });

  test('refuses unknown groups, an invalid current map and over-long keys without producing a map', () => {
    expect(nextMovementGroupMap(null, 'squat', 'quads')).toMatchObject({ ok: false });
    expect(nextMovementGroupMap({ version: 9, overrides: {} }, 'squat', 'legs')).toMatchObject({ ok: false });
    expect(nextMovementGroupMap(null, 'k'.repeat(201), 'legs')).toMatchObject({ ok: false });
    expect(nextMovementGroupMap(null, '__proto__', 'legs')).toMatchObject({ ok: false });
  });

  test('an override keys on the exact normalized key: a rename falls back to the rules', () => {
    const map = nextMovementGroupMap(null, 'Hack Squat', 'other').map;
    expect(resolveMovementGroup('Hack Squat', map.overrides).group).toBe('other');
    expect(resolveMovementGroup('Hack Squats', map.overrides)).toMatchObject({ group: 'legs', source: 'rules' });
  });

  test('backup gate: legacy omitted/null passes, a bad map is rejected with a message', () => {
    expect(movementGroupsNoteError({ id: 'n' })).toBeNull();
    expect(movementGroupsNoteError({ id: 'n', exercise_movement_groups: null })).toBeNull();
    expect(movementGroupsNoteError({ id: 'n', exercise_movement_groups: ok })).toBeNull();
    expect(movementGroupsNoteError({ id: 'n', exercise_movement_groups: { version: 1, overrides: { a: ['push'] } } })).toMatch(/^Invalid backup/);
  });
});

// ── group score derivation ────────────────────────────────────────────────────

const BASELINE = '-Bench\n- 100 5\n-Squat\n- 100 5\n-Deadlift\n- 100 5\n-Row\n- 100 5\n-Plank: 2x45s\n- 45,45';
const weekNote = (id, text) => ({ id, raw_text: text });
function strengthFor(weekTexts, baselineText = BASELINE) {
  const baseline = captureRecoveryBaselineFromText(baselineText);
  const block = { id: 'b', baseline };
  const notes = weekTexts.map((t, i) => weekNote(`n${i}`, t));
  const weeks = weekTexts.map((_, i) => ({ id: `w${i}`, block_id: 'b', note_id: `n${i}`, week_number: i + 1, deleted_at: null }));
  return { baseline, strength: deriveRecoveryStrength({ block, weeks, notes }) };
}
const byId = (b, id) => b.groups.find(g => g.id === id);

describe('group score derivation', () => {
  test('group mean is over the same cohort; empty score groups have no percent; no 0%', () => {
    const { baseline, strength } = strengthFor(['-Bench\n- 80 5\n-Squat\n- 60 5\n-Deadlift\n- 100 5\n-Curl\n- 30 10']);
    const b = deriveMovementGroupBreakdown({ strength, baselineRows: baseline.exercises, addedRows: [{ key: 'curl', name: 'Curl' }] });
    expect(byId(b, 'push').percent).toBeCloseTo(80, 6);
    expect(byId(b, 'legs').percent).toBeCloseTo(60, 6);
    expect(byId(b, 'hinge').percent).toBeCloseTo(100, 6);
    // Row was not logged this week: grouped, never scored, so its group has no percent.
    expect(byId(b, 'pull')).toMatchObject({ percent: null, total_count: 1, scored_count: 0, cohort_count: 0 });
    // Plank is unscoreable, an added lift is not scored: grouped, not averaged.
    expect(byId(b, 'core')).toMatchObject({ percent: null, total_count: 1, baseline_count: 1 });
    expect(byId(b, 'arms')).toMatchObject({ percent: null, total_count: 1, baseline_count: 0 });
  });

  test('a lift outside the cohort (not scored every week) stays grouped but does not enter the group mean', () => {
    const { baseline, strength } = strengthFor([
      '-Bench\n- 100 5\n-Squat\n- 100 5', '-Bench\n- 90 5',
    ]);
    expect(strength.cohort.map(c => c.key)).toEqual(['bench']);
    const b = deriveMovementGroupBreakdown({ strength, baselineRows: baseline.exercises });
    expect(byId(b, 'push')).toMatchObject({ scored_count: 1, cohort_count: 1 });
    expect(byId(b, 'push').percent).toBeCloseTo(90, 6);
    expect(byId(b, 'legs')).toMatchObject({ percent: null, total_count: 1, cohort_count: 0 });
  });

  test('empty cohort -> every group has no percent', () => {
    const { baseline, strength } = strengthFor(['-Bench\n- 100 5', '-Squat\n- 100 5']);
    const b = deriveMovementGroupBreakdown({ strength, baselineRows: baseline.exercises });
    expect(strength.headline).toBeNull();
    expect(b.groups.every(g => g.percent === null)).toBe(true);
  });

  test('reassignment moves a lift exactly once and leaves the overall score untouched', () => {
    const { baseline, strength } = strengthFor(['-Bench\n- 80 5\n-Squat\n- 60 5\n-Deadlift\n- 100 5\n-Row\n- 90 5\n-Curl\n- 30 10']);
    const added = [{ key: 'curl', name: 'Curl' }];
    const before = deriveMovementGroupBreakdown({ strength, baselineRows: baseline.exercises, addedRows: added });
    const after = deriveMovementGroupBreakdown({
      strength, baselineRows: baseline.exercises, addedRows: added, overrides: { deadlift: 'legs' },
    });
    expect(after.total_count).toBe(before.total_count);
    const count = (b) => b.groups.reduce((n, g) => n + g.total_count, 0);
    expect(count(after)).toBe(count(before));
    expect(after.groups.flatMap(g => g.exercises).filter(e => e.key === 'deadlift')).toHaveLength(1);
    expect(byId(before, 'hinge')).toBeDefined();
    expect(byId(after, 'hinge')).toBeUndefined();
    expect(byId(after, 'legs').exercises.map(e => e.key).sort()).toEqual(['deadlift', 'squat']);
    expect(byId(after, 'legs').percent).toBeCloseTo((60 + 100) / 2, 6);
    expect(byId(after, 'legs').exercises.find(e => e.key === 'deadlift')).toMatchObject({ source: 'override', automatic_group: 'hinge' });
    // The strength result is an input only: same object, same headline.
    expect(strength.headline).toBeCloseTo((80 + 60 + 100 + 90) / 4, 6);
  });

  test('source: baseline note is the authority; missing, failed read and invalid map are labelled unavailable', () => {
    const block = { baseline_note_id: 'nb' };
    const live = { id: 'nb', exercise_movement_groups: { version: 1, overrides: { squat: 'other' } } };
    expect(resolveMovementGroupSource({ block, notes: [live] })).toMatchObject({ available: true, overrides: { squat: 'other' }, noteId: 'nb' });
    expect(resolveMovementGroupSource({ block, notes: [{ id: 'nb' }] })).toMatchObject({ available: true, overrides: {} });
    expect(resolveMovementGroupSource({ block, notes: [] })).toMatchObject({ available: false, reason: 'missing' });
    expect(resolveMovementGroupSource({ block, notes: [{ ...live, deleted_at: 'x' }] })).toMatchObject({ available: false, reason: 'missing' });
    expect(resolveMovementGroupSource({ block, notes: [live], notesError: new Error('x') })).toMatchObject({ available: false, reason: 'unreadable', overrides: {} });
    expect(resolveMovementGroupSource({ block, notes: [{ id: 'nb', exercise_movement_groups: { version: 3, overrides: {} } }] })).toMatchObject({ available: false, reason: 'invalid', overrides: {} });
  });
});

// ── UI ───────────────────────────────────────────────────────────────────────

const UI_BASELINE = '-Bench\n- 100 5\n-Squat\n- 100 5\n-Deadlift\n- 100 5';
function uiBlock() {
  return {
    id: 'rb1', baseline_note_id: 'nb', baseline_note_title: 'Push Pull Legs', baseline: captureRecoveryBaselineFromText(UI_BASELINE),
    started_at: '2026-05-01T00:00:00Z', completed_at: null, saved_at: '2026-05-01T00:00:00Z', updated_at: '2026-05-01T00:00:00Z', deleted_at: null,
  };
}
const uiWeek = { id: 'rw1', block_id: 'rb1', note_id: 'nw1', week_number: 1, completed_at: null, saved_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z', deleted_at: null };
const uiNotes = (extra = {}) => [
  { id: 'nb', title: 'Push Pull Legs', raw_text: UI_BASELINE, ...extra },
  { id: 'nw1', title: 'Week 1', raw_text: '-Bench\n- 80 5\n-Squat\n- 60 5\n-Deadlift\n- 100 5\n-Curl\n- 30 10' },
];
function mount(props = {}) {
  let c;
  act(() => { c = render.create(<AnalyticsRecoverySection blocks={[uiBlock()]} weeks={[uiWeek]} notes={uiNotes()} {...props} />); });
  return c.root;
}
// The group EDITOR lives in Log's Manage block (#1315): the same block, mounted
// through Log's Recovery section with the block focused.
function mountLog(props = {}) {
  let c;
  act(() => {
    c = render.create(
      <LogRecoverySection
        blocks={[uiBlock()]} weeks={[uiWeek]} notes={uiNotes()}
        manage={{ focusedBlockId: 'rb1', completedBlocks: [], onSelectBlock: () => {}, newestCompletedId: null, notesError: props.notesError || null }}
        {...props}
      />
    );
  });
  return c.root;
}
const host = (root, id) => root.findAll(n => typeof n.type === 'string' && n.props.testID === id);
const texts = (root) => root.findAllByType('Text').map(t => [].concat(t.props.children).join(''));
const comp = (root, id) => root.findAll(n => typeof n.type !== 'string' && n.props.testID === id && n.props.onPress)[0];
const press = (root, id) => act(() => { comp(root, id).props.onPress(); });
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => { mockSetMovementGroup.mockReset(); });

describe('Recovery movement-group UI', () => {
  test('collapsed by default: one counted header, no group rows; expands to compact collapsible rows (#1315)', () => {
    const root = mount();
    expect(host(root, 'recovery-movement-groups')).toHaveLength(1);
    expect(host(root, 'movement-group-row-push')).toHaveLength(0);
    press(root, 'recovery-movement-groups-header');
    expect(host(root, 'movement-group-row-push')).toHaveLength(1);
    expect(host(root, 'movement-group-value-push')[0].props.children).toBe('80%');
    expect(host(root, 'movement-group-value-legs')[0].props.children).toBe('60%');
    expect(host(root, 'movement-group-value-hinge')[0].props.children).toBe('100%');
    // An added lift is grouped but unscored: Arms shows no percent.
    expect(host(root, 'movement-group-value-arms')[0].props.children).toBe('No score');
    // Compact visible counts; the full wording stays in the row's label.
    expect(texts(root)).toContain('1 of 1 scored · 1 in baseline');
    const row = host(root, 'movement-group-row-push')[0];
    expect(row.props.accessibilityLabel).toContain('1 of 1 lift in the average scored · 1 lift in the baseline');
  });

  test('the breakdown is read-only: no editor control and no Manage block anywhere in Analytics', () => {
    const root = mount();
    press(root, 'recovery-movement-groups-header');
    press(root, 'movement-group-row-hinge');
    expect(host(root, 'movement-group-exercise-deadlift')).toHaveLength(1);
    expect(host(root, 'movement-group-edit-deadlift')).toHaveLength(0);
    expect(host(root, 'recovery-manage-groups')).toHaveLength(0);
  });

  test('a persisted override (from the baseline note) moves the lift immediately; the overall number is unchanged', () => {
    const root = mount({ notes: uiNotes({ exercise_movement_groups: { version: 1, overrides: { deadlift: 'legs' } } }) });
    press(root, 'recovery-movement-groups-header');
    expect(host(root, 'movement-group-row-hinge')).toHaveLength(0);
    expect(host(root, 'movement-group-value-legs')[0].props.children).toBe('80%');
    expect(host(root, 'recovery-strength-summary')[0].props.accessibilityLabel).toMatch(/^Week 1: 80% /);
  });

  test.each([
    ['failed notes read', { notesError: new Error('x') }, 'Saved group choices couldn’t be read'],
    ['missing baseline note', { notes: uiNotes().slice(1) }, 'baseline routine is gone'],
    ['invalid stored map', { notes: uiNotes({ exercise_movement_groups: { version: 4, overrides: {} } }) }, 'Saved group choices are unreadable'],
  ])('%s: rules-only grouping with a concise status and the full notice on demand', (_l, props, copy) => {
    const root = mount(props);
    // Concise visible status while collapsed; the full explanation is on demand.
    expect(texts(root).some(t => t.includes('saved choices unavailable'))).toBe(true);
    expect(texts(root).some(t => t.includes(copy))).toBe(false);
    press(root, 'recovery-movement-groups-header');
    expect(texts(root).some(t => t.includes(copy))).toBe(true);
    press(root, 'movement-group-row-hinge');
    expect(host(root, 'movement-group-exercise-deadlift')).toHaveLength(1);
    expect(host(root, 'movement-group-edit-deadlift')).toHaveLength(0);
  });
});

describe('Log Manage block movement-group editor (#1306, moved to Log by #1315)', () => {
  const openEditor = (root) => {
    press(root, 'recovery-manage-trigger-rb1');
    press(root, 'recovery-manage-groups-header');
  };

  test('lists every lift once with its group and source, collapsed until asked', () => {
    const root = mountLog();
    press(root, 'recovery-manage-trigger-rb1');
    expect(host(root, 'manage-group-exercise-deadlift')).toHaveLength(0);
    press(root, 'recovery-manage-groups-header');
    for (const key of ['bench', 'squat', 'deadlift', 'curl']) expect(host(root, `manage-group-exercise-${key}`)).toHaveLength(1);
    expect(texts(root)).toContain('Hinge / posterior chain · Automatic');
    expect(texts(root)).toContain('Arms · Automatic · added during recovery');
  });

  test('the editor offers every group plus reset, each >= 44dp with selected state', () => {
    const root = mountLog();
    openEditor(root);
    press(root, 'movement-group-edit-deadlift');
    const { StyleSheet } = require('react-native');
    for (const id of MOVEMENT_GROUP_IDS) {
      const opt = host(root, `movement-group-option-deadlift-${id}`)[0];
      expect(opt.props.accessibilityRole).toBe('radio');
      expect(opt.props.accessibilityState.selected).toBe(id === 'hinge');
      expect(StyleSheet.flatten(opt.props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
    const reset = host(root, 'movement-group-reset-deadlift')[0];
    expect(StyleSheet.flatten(reset.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(reset.props.accessibilityState.disabled).toBe(true); // already automatic
    expect(StyleSheet.flatten(host(root, 'movement-group-edit-deadlift')[0].props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(texts(root).some(t => t.includes('every week and every block that uses Push Pull Legs'))).toBe(true);
  });

  test('choosing a group writes once with the baseline note id; duplicate taps are disabled while saving', async () => {
    let finish;
    mockSetMovementGroup.mockReturnValue(new Promise(r => { finish = r; }));
    const root = mountLog();
    openEditor(root);
    press(root, 'movement-group-edit-deadlift');
    press(root, 'movement-group-option-deadlift-legs');
    expect(mockSetMovementGroup).toHaveBeenCalledWith({ noteId: 'nb', key: 'deadlift', group: 'legs' });
    expect(host(root, 'movement-group-option-deadlift-push')[0].props.accessibilityState.disabled).toBe(true);
    act(() => { comp(root, 'movement-group-option-deadlift-push').props.onPress(); });
    expect(mockSetMovementGroup).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: true }); });
  });

  test('a failed save keeps the chosen group as an unsaved draft with the error, also through a Manage collapse', async () => {
    mockSetMovementGroup.mockResolvedValue({ ok: false, error: 'disk full' });
    const root = mountLog();
    openEditor(root);
    press(root, 'movement-group-edit-deadlift');
    press(root, 'movement-group-option-deadlift-legs');
    await flush();
    expect(host(root, 'movement-group-error-deadlift')[0].props.children).toBe('Not saved: disk full');
    expect(host(root, 'movement-group-option-deadlift-legs')[0].props.accessibilityState.selected).toBe(true);
    // Collapsing Manage block keeps the draft and error mounted (hidden), never discarded.
    press(root, 'recovery-manage-trigger-rb1');
    expect(host(root, 'recovery-manage-body-rb1')[0].props.accessibilityElementsHidden).toBe(true);
    press(root, 'recovery-manage-trigger-rb1');
    expect(host(root, 'movement-group-error-deadlift')[0].props.children).toBe('Not saved: disk full');
    expect(host(root, 'movement-group-option-deadlift-legs')[0].props.accessibilityState.selected).toBe(true);
  });

  test.each([
    ['failed notes read', { notesError: new Error('x') }, 'Saved group choices couldn’t be read'],
    ['missing baseline note', { notes: uiNotes().slice(1) }, 'baseline routine is gone'],
    ['invalid stored map', { notes: uiNotes({ exercise_movement_groups: { version: 4, overrides: {} } }) }, 'Saved group choices are unreadable'],
  ])('%s: a visible notice and no editor', (_l, props, copy) => {
    const root = mountLog(props);
    openEditor(root);
    expect(host(root, 'movement-group-edit-deadlift')).toHaveLength(0);
    expect(host(root, 'manage-group-exercise-deadlift')).toHaveLength(1);
    expect(texts(root).filter(t => t.includes(copy))).toHaveLength(1);
  });

  test('writes are locked (not hidden) while Recovery data is stale or a write is pending', () => {
    const stale = mountLog({ stateStale: true });
    openEditor(stale);
    expect(host(stale, 'recovery-manage-locked')).toHaveLength(1);
    expect(texts(stale).some(t => t.includes('paused until Recovery data is current'))).toBe(true);
    press(stale, 'movement-group-edit-deadlift');
    expect(host(stale, 'movement-group-option-deadlift-legs')[0].props.accessibilityState.disabled).toBe(true);

    const pending = mountLog({ pendingRecovery: [{ operation_id: 1, block_id: 'rb1', error: null }] });
    openEditor(pending);
    press(pending, 'movement-group-edit-deadlift');
    expect(host(pending, 'movement-group-option-deadlift-legs')[0].props.accessibilityState.disabled).toBe(true);
  });
});
