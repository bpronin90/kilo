import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { RestTimerBanner } from '../components/RestTimerBanner';
import { PRMomentBanner } from '../components/PRMomentBanner';
import { ThemeProvider } from '../theme/ThemeContext';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

jest.mock('../lib/unitPreference', () => ({
  useWeightUnit: () => 'lb',
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

// #577 review (Codex, post-freeze) finding 1: App.js applies a `style`
// (bottom margin reserving tab-bar + safe-area clearance, matching
// ScreenShell's own pattern) to RestTimerBanner's root View — but only
// while the banner actually renders something, so idle mounts never
// consume that space. These tests pin the prop contract App.js's fix
// relies on.
describe('RestTimerBanner style prop — tab-bar/safe-area clearance (#577 review)', () => {
  test('a style prop is applied to the root view while running', () => {
    const tree = renderBanner({ isRunning: true, remainingMs: 5000, justElapsed: false, backgroundAlertAvailable: true, showStart: false, style: { marginBottom: 88 } });
    const json = tree.toJSON();
    expect(json).not.toBeNull();
    const style = Array.isArray(json.props.style) ? Object.assign({}, ...json.props.style) : json.props.style;
    expect(style.marginBottom).toBe(88);
  });

  test('a style prop is applied to the root view while showing the done banner', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: true, backgroundAlertAvailable: true, showStart: false, style: { marginBottom: 88 } });
    const json = tree.toJSON();
    const style = Array.isArray(json.props.style) ? Object.assign({}, ...json.props.style) : json.props.style;
    expect(style.marginBottom).toBe(88);
  });

  test('an idle mount (nothing rendered) never reserves the clearance space', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: false, backgroundAlertAvailable: true, showStart: false, style: { marginBottom: 88 } });
    expect(tree.toJSON()).toBeNull();
  });

  // #577: the Log-screen startOnly instance renders the idle "start" row
  // (isRunning/justElapsed both false, showStart true) — the very state that
  // was left uncovered by the tests above, which only exercised style on the
  // running/done states. LogScreen.js omitted the style prop on this
  // instance entirely, leaving the start row uncleared behind the absolute
  // bottom TabBar; this pins that the row honors the same clearance contract.
  test('the Log-screen start row (startOnly, showStart) applies the clearance style', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: false, backgroundAlertAvailable: true, showStart: true, startOnly: true, style: { marginBottom: 88 } });
    const json = tree.toJSON();
    expect(json).not.toBeNull();
    const style = Array.isArray(json.props.style) ? Object.assign({}, ...json.props.style) : json.props.style;
    expect(style.marginBottom).toBe(88);
  });
});

// #951 review (Codex): when a PR moment is also visible, LogScreen.js gave
// both the start row and PRMomentBanner below it the full clearance margin,
// so the two stacked into a large blank gap above the tab bar instead of a
// single reserved clearance. LogScreen.js now zeroes the start row's margin
// whenever a PR moment is present, since PRMomentBanner (rendered below it)
// carries the clearance in that case. These tests pin that combined
// contract by mounting both banners the way LogScreen.js wires them.
describe('RestTimerBanner + PRMomentBanner combined clearance (#951 review)', () => {
  function renderBoth({ prMoment, clearance = 88 }) {
    let tree;
    act(() => {
      tree = renderer.create(
        <ThemeProvider>
          <>
            <RestTimerBanner
              isRunning={false}
              remainingMs={0}
              justElapsed={false}
              backgroundAlertAvailable
              showStart
              startOnly
              style={{ marginBottom: prMoment ? 0 : clearance }}
            />
            <PRMomentBanner moment={prMoment} onDismiss={() => {}} style={{ marginBottom: clearance }} />
          </>
        </ThemeProvider>
      );
    });
    return tree;
  }

  function marginBottomOf(node) {
    if (!node) return 0;
    const style = Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
    return style?.marginBottom ?? 0;
  }

  test('only the PR banner reserves clearance when both are visible — no stacked gap', () => {
    const tree = renderBoth({ prMoment: { weight_value: 225, rep_count: 5 } });
    const [startRow, prBanner] = tree.toJSON();
    expect(marginBottomOf(startRow)).toBe(0);
    expect(marginBottomOf(prBanner)).toBe(88);
  });

  test('the start row alone still reserves clearance when no PR moment is present', () => {
    const tree = renderBoth({ prMoment: null });
    const json = tree.toJSON();
    const startRow = Array.isArray(json) ? json[0] : json;
    expect(marginBottomOf(startRow)).toBe(88);
  });
});
