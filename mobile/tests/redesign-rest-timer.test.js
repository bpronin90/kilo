// #1607: redesign v3 rest-timer presentation — anchored preset panel and
// app-shell pill extracted from RestTimerBanner; timing semantics unchanged.
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { RestTimerBanner } from '../components/RestTimerBanner';
import { RestTimerPresetPanel, DURATION_PRESETS_SEC, formatCountdown } from '../components/restTimer/RestTimerPresetPanel';
import { ThemeProvider } from '../theme/ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: jest.fn(() => 'dark') }));
jest.mock('../lib/unitPreference', () => ({ useWeightUnit: () => 'lb' }));

function render(el) {
  let tree;
  act(() => { tree = TestRenderer.create(<ThemeProvider>{el}</ThemeProvider>); });
  return tree;
}
const byLabel = (tree, label) => tree.root.findAll(n => n.props && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
const panelProps = { visible: true, anchor: null, remainingMs: 72000, alertMissing: false, reduceMotion: false, onClose: jest.fn() };

test('presets stay 0:30–3:00', () => {
  expect(DURATION_PRESETS_SEC.map(s => formatCountdown(s * 1000))).toEqual(['0:30', '1:00', '1:30', '2:00', '3:00']);
});

test('running panel: "of" caption, active preset, Cancel timer and Dismiss (close only)', () => {
  const onCancel = jest.fn();
  const onClose = jest.fn();
  const tree = render(<RestTimerPresetPanel {...panelProps} phase="running" durationSec={90} onCancel={onCancel} onClose={onClose} />);
  expect(JSON.stringify(tree.toJSON())).toContain('of 1:30 rest');
  expect(byLabel(tree, 'Restart 90 second rest timer')[0].props.accessibilityState).toEqual({ selected: true });
  act(() => { byLabel(tree, 'Close rest timer panel')[0].props.onPress(); });
  expect(onCancel).not.toHaveBeenCalled();
  act(() => { byLabel(tree, 'Cancel rest timer')[0].props.onPress(); });
  expect(onCancel).toHaveBeenCalledTimes(1);
});

test('running panel without a known duration falls back to the restart caption', () => {
  const tree = render(<RestTimerPresetPanel {...panelProps} phase="running" durationSec={null} />);
  expect(JSON.stringify(tree.toJSON())).toContain('Resting · tap a time to restart');
});

test('docked control forwards durationSec into the panel', () => {
  const tree = render(<RestTimerBanner compact showStart isRunning remainingMs={30000} justElapsed={false} backgroundAlertAvailable durationSec={60} onStart={jest.fn()} />);
  act(() => { tree.root.findAll(n => n.props && n.props.accessibilityLabel === 'Rest timer, 0:30 remaining')[0].props.onPress(); });
  expect(JSON.stringify(tree.toJSON())).toContain('of 1:00 rest');
});

test('app-shell pill renders running and done with their actions', () => {
  const run = render(<RestTimerBanner isRunning remainingMs={72000} justElapsed={false} backgroundAlertAvailable onCancel={jest.fn()} />);
  expect(run.root.findAll(n => n.props && n.props.testID === 'rest-timer-pill').length).toBeGreaterThan(0);
  expect(byLabel(run, 'Cancel rest timer')).toHaveLength(1);
  const done = render(<RestTimerBanner isRunning={false} remainingMs={0} justElapsed backgroundAlertAvailable onDismissDone={jest.fn()} />);
  expect(byLabel(done, 'Dismiss rest timer done banner')).toHaveLength(1);
});
