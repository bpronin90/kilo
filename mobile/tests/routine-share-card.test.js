import React from 'react';
import render from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { buildRoutineShareSummary, shareRoutineImage } from '../lib/interoperability/routineShare';
import { RoutineShareCard, RoutineShareModal } from '../components/RoutineShareCard';
import { LogActiveRoutineCard } from '../components/LogActiveRoutineCard';
import { LogPreviousRoutines } from '../components/LogPreviousRoutines';
import { parseWorkoutNote } from '../lib/parser';
import html2canvas from 'html2canvas';

jest.mock('@expo/vector-icons/MaterialIcons', () => 'MaterialIcons');
jest.mock('html2canvas', () => jest.fn());

const RAW = 'Monday\n+Lifting\n-Bench Press: 3x8-10\n135 10,10,10 *PR\n-- private comment\nunknown private row\n---\nTuesday\n-Pull-ups: 3x8-12\n12,12,12\n-- another secret\n';
const content = root => root.findAll(n => n.type === 'Text').map(n => n.props.children).flat().join(' ');
const byLabel = (root, label) => root.findAll(n => n.props.accessibilityRole && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const press = node => render.act(() => { node.props.onPress({ stopPropagation: jest.fn() }); });

describe('routine image allowlist', () => {
  test('real A/B parser content is redacted before reaching the renderer', () => {
    const parsed = parseWorkoutNote(RAW);
    expect(parsed.ok).toBe(true);
    expect(parsed.sections).toHaveLength(2);
    const summary = buildRoutineShareSummary({ title: 'My routine', rawText: RAW, account: 'secret account', recovery: 'secret recovery' });
    expect(summary).toEqual({ title: 'My routine', sections: [
      { week: 'A', heading: 'Monday', subheading: 'Lifting', exercises: [{ name: 'Bench Press', setCount: 3 }] },
      { week: 'B', heading: 'Tuesday', subheading: null, exercises: [{ name: 'Pull-ups', setCount: 3 }] },
    ] });
    let component;
    render.act(() => { component = render.create(<RoutineShareCard summary={summary} />); });
    const text = content(component.root);
    for (const absent of ['135', '10 reps', '12 reps', '8-10', 'PR', 'private', 'secret', 'Recovery', 'fatigue']) expect(text).not.toContain(absent);
    expect(text).toContain('Week A · Monday · Lifting');
    expect(text).toContain('Week B · Tuesday');
    expect(text).toContain('3 sets');
    expect(StyleSheet.flatten(component.root.findByProps({ testID: 'routine-share-card' }).props.style).backgroundColor).toBe('#ffffff');
    render.act(() => component.unmount());
  });

  test('explicit numeric opt-in adds only structured weights/reps, never annotations or unknown rows', () => {
    const summary = buildRoutineShareSummary({ rawText: RAW, includeNumbers: true });
    expect(summary.sections[0].exercises[0]).toEqual({
      name: 'Bench Press', setCount: 3, repRange: { lo: 8, hi: 10 },
      latestSets: Array(3).fill({ weight: 135, reps: 10, unit: 'lb' }),
    });
    expect(summary.sections[1].exercises[0].latestSets).toEqual(Array(3).fill({ weight: null, reps: 12, unit: null }));
    for (const absent of ['PR', 'private', 'secret', 'annotation', 'raw_text']) expect(JSON.stringify(summary)).not.toContain(absent);
  });

  test('set counts use the declaration, then the latest logged row, never total history', () => {
    const summary = buildRoutineShareSummary({ rawText: 'Monday\n-Bench: 4x8-10\n135 10,10\n-Curl\n30 10,10,10\n35 8,8\n-Squat\n' });
    expect(summary.sections[0].exercises.map(e => e.setCount)).toEqual([4, 2, null]);
  });

  test('kg provenance becomes canonical numeric weight only and comments stay excluded', () => {
    const summary = buildRoutineShareSummary({ rawText: 'Monday\n-Deadlift\n100kg 5,5 *PR\n-- medical secret', includeNumbers: true });
    expect(summary.sections[0].exercises[0].latestSets).toEqual(Array(2).fill({ weight: 220, reps: 5, unit: 'lb' }));
    expect(JSON.stringify(summary)).not.toContain('secret');
  });

  test.each([null, '', 'not a routine', 'x'.repeat(200001)])('unparseable or empty content has no shareable exercises', rawText => {
    expect(buildRoutineShareSummary({ rawText }).sections).toEqual([]);
  });
});

describe('routine image preview and confirmation', () => {
  let component;
  afterEach(() => { if (component) render.act(() => component.unmount()); component = null; });
  const mount = props => render.act(() => { component = render.create(<RoutineShareModal title="Routine" rawText={RAW} onClose={jest.fn()} {...props} />); });
  const layout = () => render.act(() => { component.root.findByType(RoutineShareCard).props.onLayout(); });

  test('opening or opting in does not capture; confirmation waits for the current preview layout', async () => {
    const shareImage = jest.fn().mockResolvedValue();
    mount({ shareImage });
    expect(shareImage).not.toHaveBeenCalled();
    expect(component.root.findByType(RoutineShareCard).props.summary.sections[0].exercises[0]).not.toHaveProperty('latestSets');
    expect(byLabel(component.root, 'Confirm routine image')).toBeUndefined();
    layout();
    press(byLabel(component.root, 'Include weights and reps for this share'));
    expect(byLabel(component.root, 'Confirm routine image')).toBeUndefined();
    expect(shareImage).not.toHaveBeenCalled();
    layout();
    await render.act(async () => { await byLabel(component.root, 'Confirm routine image').props.onPress(); });
    expect(shareImage).toHaveBeenCalledTimes(1);
  });

  test('turning numeric details off clears them before the next capture can start', () => {
    mount(); layout();
    press(byLabel(component.root, 'Include weights and reps for this share')); layout();
    expect(content(component.root)).toContain('135 lb');
    press(byLabel(component.root, 'Include weights and reps for this share'));
    expect(content(component.root)).not.toContain('135 lb');
    expect(byLabel(component.root, 'Confirm routine image')).toBeUndefined();
    layout();
    expect(byLabel(component.root, 'Confirm routine image')).toBeTruthy();
  });

  test('text sharing is independent and closing/reopening resets numeric consent', async () => {
    const onShareRoutine = jest.fn();
    render.act(() => { component = render.create(<LogActiveRoutineCard workoutNoteTitle="Routine" routineRawText={RAW} dayGroups={[]} onShareRoutine={onShareRoutine} />); });
    press(byLabel(component.root, 'Share routine as image'));
    press(byLabel(component.root, 'Include weights and reps for this share'));
    const modal = component.root.findByType(RoutineShareModal);
    expect(modal.props.rawText).toBe(RAW);
    render.act(() => modal.props.onClose());
    expect(component.root.findAllByType(RoutineShareModal)).toHaveLength(0);
    press(byLabel(component.root, 'Share routine'));
    expect(onShareRoutine).toHaveBeenCalledWith({ title: 'Routine', rawText: RAW });
    press(byLabel(component.root, 'Share routine as image'));
    expect(component.root.findByType(RoutineShareCard).props.summary.sections[0].exercises[0]).not.toHaveProperty('latestSets');
  });

  test('an image error is actionable and does not claim delivery', async () => {
    mount({ shareImage: jest.fn().mockRejectedValue(new Error('native unavailable')) }); layout();
    await render.act(async () => { await byLabel(component.root, 'Confirm routine image').props.onPress(); });
    expect(content(component.root)).toContain('Could not share this image.');
    expect(content(component.root)).not.toContain('Successfully');
    expect(byLabel(component.root, 'Confirm routine image')).toBeTruthy();
  });

  test('repeat presses cannot start overlapping captures', async () => {
    let finish;
    const shareImage = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    mount({ shareImage }); layout();
    const confirm = byLabel(component.root, 'Confirm routine image').props.onPress;
    render.act(() => { confirm(); confirm(); });
    expect(shareImage).toHaveBeenCalledTimes(1);
    expect(byLabel(component.root, 'Include weights and reps for this share')).toBeTruthy();
    expect(byLabel(component.root, 'Include weights and reps for this share').props.disabled).toBe(true);
    await render.act(async () => { finish(); });
  });

  test('previous-routine image action snapshots the complete A/B note, not the displayed week', () => {
    const note = { id: 'old', title: 'Old routine', raw_text: RAW };
    render.act(() => { component = render.create(<LogPreviousRoutines otherNotes={[note]} expanded viewingNoteId={note.id} viewingNote={note} viewingNoteDayGroups={[]} viewingActiveText="Monday" />); });
    press(byLabel(component.root, 'Share routine Old routine as image'));
    expect(component.root.findByType(RoutineShareModal).props.rawText).toBe(RAW);
    expect(component.root.findByType(RoutineShareCard).props.summary.sections).toHaveLength(2);
  });
});

describe('on-device image transport', () => {
  const native = overrides => ({
    platform: 'ios', available: jest.fn().mockResolvedValue(true),
    capture: jest.fn().mockResolvedValue('file:///cache/card.png'),
    share: jest.fn().mockResolvedValue(), release: jest.fn(), ...overrides,
  });
  test.each(['ios', 'android'])('shares only the captured PNG on %s, then releases it', async platform => {
    const deps = native({ platform }); const view = { current: {} };
    await shareRoutineImage(view, deps);
    expect(deps.capture).toHaveBeenCalledWith(view, { format: 'png', result: 'tmpfile' });
    expect(deps.share).toHaveBeenCalledWith('file:///cache/card.png', { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share routine image' });
    expect(deps.release).toHaveBeenCalledWith('file:///cache/card.png');
  });
  test('capture failure cannot invoke the share sheet', async () => {
    const deps = native({ capture: jest.fn().mockRejectedValue(new Error('capture')) });
    await expect(shareRoutineImage({}, deps)).rejects.toThrow('capture');
    expect(deps.share).not.toHaveBeenCalled(); expect(deps.release).not.toHaveBeenCalled();
  });
  test('unavailable sharing does not create a file', async () => {
    const deps = native({ available: jest.fn().mockResolvedValue(false) });
    await expect(shareRoutineImage({}, deps)).rejects.toThrow('unavailable');
    expect(deps.capture).not.toHaveBeenCalled();
  });
  test('share rejection still releases the temporary image', async () => {
    const deps = native({ share: jest.fn().mockRejectedValue(new Error('share')) });
    await expect(shareRoutineImage({}, deps)).rejects.toThrow('share');
    expect(deps.release).toHaveBeenCalledWith('file:///cache/card.png');
  });
  test('web saves a locally captured data URI without a server or native share module', async () => {
    const capture = jest.fn().mockResolvedValue('data:image/png;base64,cGl4ZWxz'); const download = jest.fn();
    await shareRoutineImage({}, { platform: 'web', capture, download });
    expect(capture).toHaveBeenCalledWith({}, { format: 'png', result: 'data-uri' });
    expect(download).toHaveBeenCalledWith('data:image/png;base64,cGl4ZWxz');
  });
  test('the real web adapter passes the DOM ref directly to its rasterizer', async () => {
    const element = {}; const toDataURL = jest.fn().mockReturnValue('data:image/png;base64,cGl4ZWxz');
    html2canvas.mockResolvedValue({ toDataURL });
    const download = jest.fn();
    await shareRoutineImage({ current: element }, { platform: 'web', download });
    expect(html2canvas).toHaveBeenCalledWith(element, { logging: false });
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(download).toHaveBeenCalledWith('data:image/png;base64,cGl4ZWxz');
  });
});
