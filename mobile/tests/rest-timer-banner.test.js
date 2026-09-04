import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { RestTimerBanner } from '../components/RestTimerBanner';
import { ThemeProvider } from '../theme/ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

function renderBanner(props) {
  let component;
  act(() => {
    component = renderer.create(
      <ThemeProvider>
        <RestTimerBanner {...props} />
      </ThemeProvider>
    );
  });
  return component;
}

// #950 review (P1): the countdown/done surface now mounts once at the
// app-shell level (App.js), while the Log-screen instance renders only the
// idle start row (`startOnly`). These tests pin the prop contract that
// split relies on so the two instances can never both render — or both
// omit — the running/done UI.
describe('RestTimerBanner startOnly (#950 review P1)', () => {
  test('the app-shell instance (startOnly=false) shows the countdown while running', () => {
    const tree = renderBanner({ isRunning: true, remainingMs: 5000, justElapsed: false, backgroundAlertAvailable: true, showStart: false });
    expect(JSON.stringify(tree.toJSON())).toContain('0:05');
  });

  test('the app-shell instance (startOnly=false) shows the done banner after elapsing', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: true, backgroundAlertAvailable: true, showStart: false });
    expect(JSON.stringify(tree.toJSON())).toContain('Rest over');
  });

  test('the Log-screen instance (startOnly=true) renders nothing while a timer is running — it never duplicates the countdown', () => {
    const tree = renderBanner({ isRunning: true, remainingMs: 5000, justElapsed: false, backgroundAlertAvailable: true, showStart: true, startOnly: true });
    expect(tree.toJSON()).toBeNull();
  });

  test('the Log-screen instance (startOnly=true) renders nothing after elapsing — it never duplicates the done banner', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: true, backgroundAlertAvailable: true, showStart: true, startOnly: true });
    expect(tree.toJSON()).toBeNull();
  });

  test('the Log-screen instance (startOnly=true) shows the start row when idle and showStart is true', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: false, backgroundAlertAvailable: true, showStart: true, startOnly: true });
    expect(JSON.stringify(tree.toJSON())).toContain('Rest timer');
  });

  test('backgroundAlertAvailable=false shows the "unavailable" warning while running', () => {
    const tree = renderBanner({ isRunning: true, remainingMs: 5000, justElapsed: false, backgroundAlertAvailable: false, showStart: false });
    expect(JSON.stringify(tree.toJSON())).toContain('Background alert unavailable');
  });

  test('backgroundAlertAvailable=true never shows the "unavailable" warning', () => {
    const tree = renderBanner({ isRunning: true, remainingMs: 5000, justElapsed: false, backgroundAlertAvailable: true, showStart: false });
    expect(JSON.stringify(tree.toJSON())).not.toContain('Background alert unavailable');
  });
});
