// Movement groups (#1306): the deterministic one-group taxonomy, the override
// map, the group-score derivation over #1305's rows, and the Recovery UI.

import React from 'react';
import render, { act } from 'react-test-renderer';
import {
  DETAILED_MOVEMENT_GROUP_IDS, MOVEMENT_GROUPS, MOVEMENT_GROUP_IDS, OVERRIDE_STATE, keywordMovementGroup, movementGroupMapError,
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
    expect(readMovementOverrides(null)).toEqual({ state: OVERRIDE_STATE.RULES_ONLY, overrides: {}, version: null });
    expect(readMovementOverrides(undefined).state).toBe(OVERRIDE_STATE.RULES_ONLY);
    expect(readMovementOverrides(ok)).toEqual({ state: OVERRIDE_STATE.OVERRIDES, overrides: { deadlift: 'hinge' }, version: 1 });
    expect(movementGroupMapError(ok)).toBeNull();
    expect(movementGroupMapError({ version: 1, overrides: {} })).toBeNull();
  });

  test.each([
    ['array', []],
    ['string', 'x'],
    ['version 3', { version: 3, overrides: {} }],
    ['string version', { version: '2', overrides: {} }],
    ['version 1 with a detailed id', { version: 1, overrides: { squat: 'squat' } }],
    ['version 2 unknown id', { version: 2, overrides: { squat: 'quads' } }],
    ['version 2 unclassified', { version: 2, overrides: { squat: 'unclassified' } }],
    ['version 2 multi-group array', { version: 2, overrides: { squat: ['squat'] } }],
    ['version 2 extra field', { version: 2, overrides: {}, extra: 1 }],
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

  test('version 2 holds detailed and broad choices side by side; version 1 stays valid', () => {
    const v2 = { version: 2, overrides: { squat: 'squat', deadlift: 'hinge', row: 'horizontal_pull' } };
    expect(movementGroupMapError(v2)).toBeNull();
    expect(readMovementOverrides(v2)).toEqual({ state: OVERRIDE_STATE.OVERRIDES, overrides: v2.overrides, version: 2 });
    expect(movementGroupMapError({ version: 2, overrides: {} })).toBeNull();
    expect(resolveMovementGroup('Row', v2.overrides)).toMatchObject({ group: 'horizontal_pull', source: 'override' });
    const many = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`k${i}`, 'squat']));
    expect(movementGroupMapError({ version: 2, overrides: many })).toMatch(/too many/);
    expect(movementGroupMapError({ version: 2, overrides: { ['k'.repeat(201)]: 'squat' } })).toEqual(expect.any(String));
  });

  test('a detailed choice upgrades to version 2 keeping every legacy broad value exactly; never downgrades', () => {
    const v1 = { version: 1, overrides: { deadlift: 'legs', curl: 'pull' } };
    expect(nextMovementGroupMap(v1, 'Squat', 'legs').map).toEqual({ version: 1, overrides: { deadlift: 'legs', curl: 'pull', squat: 'legs' } });
    const up = nextMovementGroupMap(v1, 'Squat', 'squat');
    expect(up).toEqual({ ok: true, map: { version: 2, overrides: { deadlift: 'legs', curl: 'pull', squat: 'squat' } } });
    const reset = nextMovementGroupMap(up.map, 'squat', null);
    expect(reset.map).toEqual({ version: 2, overrides: { deadlift: 'legs', curl: 'pull' } });
    expect(nextMovementGroupMap(reset.map, 'curl', 'arms').map.version).toBe(2);
    expect(nextMovementGroupMap(null, 'Squat', 'unclassified')).toMatchObject({ ok: false });
  });

  test('the server CHECK accepts exactly the client detailed ids (migration list stays in sync)', () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261022163911_exercise_primary_movement_groups.sql'), 'utf8');
    const detailedBlock = sql.slice(sql.indexOf("'horizontal_push'"), sql.indexOf("'stretching'") + "'stretching'".length);
    const ids = detailedBlock.match(/'([a-z_]+)'/g).map(x => x.slice(1, -1));
    expect([...ids].sort()).toEqual([...DETAILED_MOVEMENT_GROUP_IDS].sort());
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
    expect(movementGroupsNoteError({ id: 'n', exercise_movement_groups: { version: 2, overrides: { a: 'squat', b: 'legs' } } })).toBeNull();
    expect(movementGroupsNoteError({ id: 'n', exercise_movement_groups: { version: 1, overrides: { a: 'squat' } } })).toMatch(/^Invalid backup/);
    expect(movementGroupsNoteError({ id: 'n', exercise_movement_groups: { version: 3, overrides: {} } })).toMatch(/unsupported version/);
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
    expect(byId(b, 'squat').percent).toBeCloseTo(60, 6);
    expect(byId(b, 'hip_hinge').percent).toBeCloseTo(100, 6);
    // Row was not logged this week: grouped, never scored, so its group has no percent.
    expect(byId(b, 'pull')).toMatchObject({ percent: null, total_count: 1, scored_count: 0, cohort_count: 0 });
    // Plank is unscoreable, an added lift is not scored: grouped, not averaged.
    expect(byId(b, 'trunk_stability')).toMatchObject({ percent: null, total_count: 1, baseline_count: 1 });
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
    expect(byId(b, 'squat')).toMatchObject({ percent: null, total_count: 1, cohort_count: 0 });
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
      strength, baselineRows: baseline.exercises, addedRows: added, overrides: { deadlift: 'squat' },
    });
    expect(after.total_count).toBe(before.total_count);
    const count = (b) => b.groups.reduce((n, g) => n + g.total_count, 0);
    expect(count(after)).toBe(count(before));
    expect(after.groups.flatMap(g => g.exercises).filter(e => e.key === 'deadlift')).toHaveLength(1);
    expect(byId(before, 'hip_hinge')).toBeDefined();
    expect(byId(after, 'hip_hinge')).toBeUndefined();
    expect(byId(after, 'squat').exercises.map(e => e.key).sort()).toEqual(['deadlift', 'squat']);
    expect(byId(after, 'squat').percent).toBeCloseTo((60 + 100) / 2, 6);
    expect(byId(after, 'squat').exercises.find(e => e.key === 'deadlift')).toMatchObject({ source: 'override', legacy_choice: false, automatic_group: 'hip_hinge' });
    // A version 1 broad choice keeps its exact broad bucket and label.
    const legacy = deriveMovementGroupBreakdown({ strength, baselineRows: baseline.exercises, addedRows: added, overrides: { deadlift: 'legs' } });
    expect(byId(legacy, 'legs')).toMatchObject({ label: 'Legs (quad-dominant)', total_count: 1 });
    expect(byId(legacy, 'legs').exercises[0]).toMatchObject({ key: 'deadlift', source: 'override', legacy_choice: true });
    expect(count(legacy)).toBe(count(before));
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
    expect(host(root, 'movement-group-value-squat')[0].props.children).toBe('60%');
    expect(host(root, 'movement-group-value-hip_hinge')[0].props.children).toBe('100%');
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
    press(root, 'movement-group-row-hip_hinge');
    expect(host(root, 'movement-group-exercise-deadlift')).toHaveLength(1);
    expect(host(root, 'movement-group-edit-deadlift')).toHaveLength(0);
    expect(host(root, 'recovery-manage-groups')).toHaveLength(0);
  });

  test('a persisted override (from the baseline note) moves the lift immediately; the overall number is unchanged', () => {
    const root = mount({ notes: uiNotes({ exercise_movement_groups: { version: 1, overrides: { deadlift: 'legs' } } }) });
    press(root, 'recovery-movement-groups-header');
    expect(host(root, 'movement-group-row-hip_hinge')).toHaveLength(0);
    // The legacy broad choice keeps its own bucket; squat stays in its library group.
    expect(host(root, 'movement-group-value-legs')[0].props.children).toBe('100%');
    expect(host(root, 'movement-group-value-squat')[0].props.children).toBe('60%');
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
    press(root, 'movement-group-row-hip_hinge');
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
    expect(texts(root)).toContain('Hip hinge · Automatic');
    expect(texts(root)).toContain('Arms · Automatic (name keywords) · added during recovery');
  });

  test('the editor offers every group plus reset, each >= 44dp with selected state', () => {
    const root = mountLog();
    openEditor(root);
    press(root, 'movement-group-edit-deadlift');
    const { StyleSheet } = require('react-native');
    for (const id of DETAILED_MOVEMENT_GROUP_IDS) {
      const opt = host(root, `movement-group-option-deadlift-${id}`)[0];
      expect(opt.props.accessibilityRole).toBe('radio');
      expect(opt.props.accessibilityState.selected).toBe(id === 'hip_hinge');
      expect(StyleSheet.flatten(opt.props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
    const reset = host(root, 'movement-group-reset-deadlift')[0];
    expect(StyleSheet.flatten(reset.props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(reset.props.accessibilityState.disabled).toBe(true); // already automatic
    // Broad groups are offered only when needed (none here).
    for (const id of MOVEMENT_GROUP_IDS) expect(host(root, `movement-group-option-deadlift-${id}`)).toHaveLength(0);
    expect(StyleSheet.flatten(host(root, 'movement-group-edit-deadlift')[0].props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(texts(root).some(t => t.includes('every week and every block that uses Push Pull Legs'))).toBe(true);
  });

  test('a legacy broad choice stays visible and selected with its label; reset returns to automatic', async () => {
    mockSetMovementGroup.mockResolvedValue({ ok: true });
    const root = mountLog({ notes: uiNotes({ exercise_movement_groups: { version: 1, overrides: { deadlift: 'legs' } } }) });
    openEditor(root);
    expect(texts(root)).toContain('Legs (quad-dominant) · Your earlier broad choice');
    press(root, 'movement-group-edit-deadlift');
    expect(host(root, 'movement-group-option-deadlift-legs')[0].props.accessibilityState.selected).toBe(true);
    expect(texts(root)).toContain('Broad group (your earlier choice)');
    expect(host(root, 'movement-group-option-deadlift-hinge')).toHaveLength(0);
    const reset = host(root, 'movement-group-reset-deadlift')[0];
    expect(reset.props.accessibilityState.disabled).toBe(false);
    expect(texts(root)).toContain('Reset to automatic (Hip hinge)');
    press(root, 'movement-group-reset-deadlift');
    await flush();
    expect(mockSetMovementGroup).toHaveBeenCalledWith({ noteId: 'nb', key: 'deadlift', group: null });
  });

  test('keyword fallback is labelled as such, never as library certainty', () => {
    const root = mountLog();
    openEditor(root);
    press(root, 'movement-group-edit-curl');
    expect(host(root, 'movement-group-option-curl-arms')[0].props.accessibilityState.selected).toBe(true);
    expect(texts(root)).toContain('Broad group (from name keywords)');
  });

  test('choosing a group writes once with the baseline note id; duplicate taps are disabled while saving', async () => {
    let finish;
    mockSetMovementGroup.mockReturnValue(new Promise(r => { finish = r; }));
    const root = mountLog();
    openEditor(root);
    press(root, 'movement-group-edit-deadlift');
    press(root, 'movement-group-option-deadlift-squat');
    expect(mockSetMovementGroup).toHaveBeenCalledWith({ noteId: 'nb', key: 'deadlift', group: 'squat' });
    expect(host(root, 'movement-group-option-deadlift-horizontal_push')[0].props.accessibilityState.disabled).toBe(true);
    act(() => { comp(root, 'movement-group-option-deadlift-horizontal_push').props.onPress(); });
    expect(mockSetMovementGroup).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: true }); });
  });

  test('a failed save keeps the chosen group as an unsaved draft with the error, also through a Manage collapse', async () => {
    mockSetMovementGroup.mockResolvedValue({ ok: false, error: 'disk full' });
    const root = mountLog();
    openEditor(root);
    press(root, 'movement-group-edit-deadlift');
    press(root, 'movement-group-option-deadlift-squat');
    await flush();
    expect(host(root, 'movement-group-error-deadlift')[0].props.children).toBe('Not saved: disk full');
    expect(host(root, 'movement-group-option-deadlift-squat')[0].props.accessibilityState.selected).toBe(true);
    // Collapsing Manage block keeps the draft and error mounted (hidden), never discarded.
    press(root, 'recovery-manage-trigger-rb1');
    expect(host(root, 'recovery-manage-body-rb1')[0].props.accessibilityElementsHidden).toBe(true);
    press(root, 'recovery-manage-trigger-rb1');
    expect(host(root, 'movement-group-error-deadlift')[0].props.children).toBe('Not saved: disk full');
    expect(host(root, 'movement-group-option-deadlift-squat')[0].props.accessibilityState.selected).toBe(true);
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
    expect(host(stale, 'movement-group-option-deadlift-squat')[0].props.accessibilityState.disabled).toBe(true);

    const pending = mountLog({ pendingRecovery: [{ operation_id: 1, block_id: 'rb1', error: null }] });
    openEditor(pending);
    press(pending, 'movement-group-edit-deadlift');
    expect(host(pending, 'movement-group-option-deadlift-squat')[0].props.accessibilityState.disabled).toBe(true);
  });
});
