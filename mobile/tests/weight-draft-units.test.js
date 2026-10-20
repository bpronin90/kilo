import React from 'react';
import render from 'react-test-renderer';
import { WeightScreen } from '../screens/WeightScreen';
import * as useEntries from '../hooks/useEntries';
import * as weightHooks from '../hooks/entries/weightHooks';
import { setWeightUnitPreference } from '../lib/unitPreference';
import { convertWeightDraft } from '../lib/parser/weightEntry';
import { parseWeightEntry } from '../lib/parser';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn(),
}));
jest.mock('@expo/vector-icons/MaterialIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('../hooks/useEntries');
jest.mock('../hooks/entries/weightHooks');

const ENTRY = { id: 'e1', date: '2026-05-24', logged_at: '2026-05-24T08:00:00Z', weight_value: 180, weight_unit: 'lb', note: '' };
const GOAL = { target_weight: 170, target_date: '2099-01-01', start_weight: 180 };

let latestWeightValue;
function Host({ onSaveWeight }) {
  const [weightValue, setWeightValue] = React.useState('');
  const [weightNote, setWeightNote] = React.useState('');
  latestWeightValue = weightValue;
  return (
    <WeightScreen
      weightValue={weightValue} setWeightValue={setWeightValue}
      weightNote={weightNote} setWeightNote={setWeightNote}
      onSaveWeight={onSaveWeight || jest.fn()} errorMessage="" saving={false} isActive
    />
  );
}

let update;
let save;
function mount({ goal = GOAL, entries = [ENTRY] } = {}) {
  update = jest.fn().mockResolvedValue(true);
  save = jest.fn().mockResolvedValue(undefined);
  useEntries.useWeightEntries.mockReturnValue({ entries, remove: jest.fn(), update });
  useEntries.useWeightGoal.mockReturnValue({ goal, save, clear: jest.fn(), archiveGoal: jest.fn() });
  useEntries.useUserProfile.mockReturnValue({ profile: null });
  weightHooks.useArchivedWeightGoals.mockReturnValue({ archivedGoals: [], loading: false, refresh: jest.fn() });
  let c;
  render.act(() => { c = render.create(<Host />); });
  mounted = c;
  return c;
}
const inputs = (c) => c.root.findAllByType('TextInput');
const byLabelStart = (c, prefix) => c.root.findAllByType('TextInput')
  .find((i) => String(i.props.accessibilityLabel || '').startsWith(prefix));
const press = (c, label) => {
  const node = c.root.findAll((n) => n.props.onPress && (n.props.label === label || n.props.title === label))[0];
  render.act(() => { node.props.onPress(); });
};
const startEdit = (c) => {
  const expand = c.root.findAll((n) => n.props.accessibilityLabel === 'Expand history' && n.props.onPress)[0];
  render.act(() => { expand.props.onPress(); });
  const edit = c.root.findAll((n) => n.props.onPress && !n.props.accessibilityLabel && n.findAllByType('Text').some((t) => String(t.props.children).includes('180')))[0];
  render.act(() => { edit.props.onPress(); });
};
const setUnit = (u) => render.act(() => { setWeightUnitPreference(u); });
const type = (input, text) => render.act(() => { input.props.onChangeText(text); });

const MOCK_NOW = new Date(2026, 4, 24, 12, 0, 0);
let mounted;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(MOCK_NOW);
  setWeightUnitPreference('lb');
  mounted = null;
});
afterEach(() => {
  if (mounted) render.act(() => { mounted.unmount(); });
  jest.useRealTimers();
});

describe('convertWeightDraft', () => {
  test('converts once and keeps lb provenance across repeated switches', () => {
    let d = convertWeightDraft('180', 'lb', 'kg', null);
    expect(d.text).toBe('81.6');
    for (let i = 0; i < 5; i += 1) {
      const back = convertWeightDraft(d.text, 'kg', 'lb', d);
      expect(back.text).toBe('180');
      d = convertWeightDraft(back.text, 'lb', 'kg', back);
      expect(d.text).toBe('81.6');
    }
  });
  test('typed text without provenance parses in its entry unit', () => {
    expect(convertWeightDraft('81.6', 'kg', 'lb', { text: '99', unit: 'kg', lb: 1 }).text).toBe('179.9');
  });
  test('invalid, empty and zero drafts are not converted', () => {
    for (const t of ['', 'abc', '0', '1e3', '-5']) expect(convertWeightDraft(t, 'lb', 'kg', null)).toBeNull();
  });
  test('partial numeric input converts', () => {
    expect(convertWeightDraft('180.', 'lb', 'kg', null).text).toBe('81.6');
  });
});

describe('weigh-in drafts across unit changes', () => {
  test('dirty new entry keeps its physical weight lb -> kg -> lb', () => {
    const c = mount();
    type(inputs(c)[0], '200');
    setUnit('kg');
    expect(latestWeightValue).toBe('90.7');
    expect(parseWeightEntry(latestWeightValue).weight_value).toBeCloseTo(200, 0);
    setUnit('lb');
    expect(latestWeightValue).toBe('200');
  });

  test('dirty new entry typed in kg is converted to lb', () => {
    setWeightUnitPreference('kg');
    const c = mount();
    type(inputs(c)[0], '90');
    setUnit('lb');
    expect(latestWeightValue).toBe('198.4');
  });

  test('draft changed while the tab is hidden is converted on switch, not discarded', () => {
    const c = mount();
    type(inputs(c)[0], '150');
    c.update(<Host />);
    setUnit('kg');
    expect(latestWeightValue).toBe('68');
  });

  test('invalid draft is kept verbatim', () => {
    const c = mount();
    type(inputs(c)[0], '12a');
    setUnit('kg');
    expect(latestWeightValue).toBe('12a');
  });

  test('unchanged edit draft round-trips exactly and saves the original lb', async () => {
    const c = mount();
    startEdit(c);
    expect(latestWeightValue).toBe('180');
    setUnit('kg');
    expect(latestWeightValue).toBe('81.6');
    setUnit('lb');
    expect(latestWeightValue).toBe('180');
    setUnit('kg');
    await render.act(async () => { press(c, 'Update entry'); });
    const saved = update.mock.calls[0][1];
    expect(saved).toBe(180);
  });

  test('converted new entry saves its exact lb value through onSaveWeight', async () => {
    const onSave = jest.fn().mockResolvedValue(true);
    useEntries.useWeightEntries.mockReturnValue({ entries: [], remove: jest.fn(), update: jest.fn() });
    useEntries.useWeightGoal.mockReturnValue({ goal: null, save: jest.fn(), clear: jest.fn(), archiveGoal: jest.fn() });
    useEntries.useUserProfile.mockReturnValue({ profile: null });
    weightHooks.useArchivedWeightGoals.mockReturnValue({ archivedGoals: [], loading: false, refresh: jest.fn() });
    let c;
    render.act(() => { c = render.create(<Host onSaveWeight={onSave} />); });
    mounted = c;
    type(inputs(c)[0], '180.4');
    setUnit('kg');
    await render.act(async () => { press(c, 'Save weigh-in'); });
    expect(onSave.mock.calls[0][1]).toBe(180.4);
  });

  test('rejected edit save keeps the converted dirty draft for retry', async () => {
    const c = mount();
    startEdit(c);
    update.mockResolvedValueOnce(false);
    await render.act(async () => { press(c, 'Update entry'); });
    setUnit('kg');
    expect(latestWeightValue).toBe('81.6');
  });
});

describe('goal drafts across unit changes', () => {
  const goalInputs = (c) => inputs(c).slice(2); // after weigh-in weight + note

  test('editing goal: target and start convert once, repeated switches do not drift', () => {
    const c = mount({ goal: GOAL, entries: [] });
    press(c, 'Edit');
    let [start, target] = goalInputs(c);
    expect([start.props.value, target.props.value]).toEqual(['180', '170']);
    setUnit('kg');
    [start, target] = goalInputs(c);
    expect([start.props.value, target.props.value]).toEqual(['81.6', '77.1']);
    setUnit('lb');
    [start, target] = goalInputs(c);
    expect([start.props.value, target.props.value]).toEqual(['180', '170']);
  });

  test('dirty goal text typed in lb converts and saves the same lb weight', async () => {
    const c = mount({ goal: GOAL, entries: [] });
    press(c, 'Edit');
    type(goalInputs(c)[1], '165');
    setUnit('kg');
    expect(goalInputs(c)[1].props.value).toBe('74.8');
    await render.act(async () => { press(c, 'Save goal'); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].target_weight).toBe(165);
  });

  test('rejected goal save keeps draft and it follows a later unit change', async () => {
    const c = mount({ goal: GOAL, entries: [] });
    press(c, 'Edit');
    type(goalInputs(c)[1], '165');
    save.mockRejectedValueOnce(new Error('x'));
    await render.act(async () => { press(c, 'Save goal'); });
    setUnit('kg');
    expect(goalInputs(c)[1].props.value).toBe('74.8');
  });

  test('unchanged goal edit switched to kg saves exact stored target and start lb', async () => {
    const c = mount({ goal: { ...GOAL, target_weight: 170.4, start_weight: 180.4 }, entries: [] });
    press(c, 'Edit');
    setUnit('kg');
    await render.act(async () => { press(c, 'Save goal'); });
    expect(save.mock.calls[0][0].target_weight).toBe(170.4);
    expect(save.mock.calls[0][0].start_weight).toBe(180.4);
  });

  test('typed goal text after a switch is parsed, not the stale retained value', async () => {
    const c = mount({ goal: GOAL, entries: [] });
    press(c, 'Edit');
    setUnit('kg');
    type(goalInputs(c)[1], '75');
    await render.act(async () => { press(c, 'Save goal'); });
    expect(save.mock.calls[0][0].target_weight).toBe(165.3);
  });

  test('cancel then re-edit under the new unit starts clean from the stored goal', () => {
    const c = mount({ goal: GOAL, entries: [] });
    press(c, 'Edit');
    type(goalInputs(c)[1], '165');
    press(c, 'Cancel');
    setUnit('kg');
    press(c, 'Edit');
    expect(goalInputs(c)[1].props.value).toBe('77.1');
  });

  test('clean (not editing) goal form follows the new preference', () => {
    const c = mount({ goal: GOAL, entries: [] });
    setUnit('kg');
    press(c, 'Edit');
    expect(goalInputs(c)[1].props.value).toBe('77.1');
  });

  test('new goal with manually entered start weight converts', () => {
    const c = mount({ goal: null, entries: [] });
    const [start, target] = goalInputs(c);
    type(start, '200');
    type(target, '180');
    setUnit('kg');
    const [s2, t2] = goalInputs(c);
    expect([s2.props.value, t2.props.value]).toEqual(['90.7', '81.6']);
  });
});
