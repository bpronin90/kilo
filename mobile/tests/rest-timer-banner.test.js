import React from 'react';
import { Modal } from 'react-native';
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

function updateBanner(component, props) {
  act(() => {
    component.update(
      <ThemeProvider>
        <RestTimerBanner {...props} />
      </ThemeProvider>
    );
  });
}

// Walk the rendered tree collecting every node whose props satisfy `pred`.
function findAll(node, pred, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((n) => findAll(n, pred, acc));
    return acc;
  }
  if (pred(node)) acc.push(node);
  (node.children || []).forEach((c) => findAll(c, pred, acc));
  return acc;
}

function buttonsByLabel(json, label) {
  return findAll(json, (n) => n.props && n.props.accessibilityLabel === label);
}

// #950 review (P1): the running countdown / completion surface mounts once at
// the app-shell level (compact=false); the Log-screen instance is the
// contextual idle affordance only. #1026: that surface is now a compact
// centered pill, not a full-width banner — tapping the running pill reveals
// Cancel, completion offers Dismiss in the same place.
describe('RestTimerBanner app-shell instance (#950 review P1, #1026)', () => {
  const shellRun = { isRunning: true, remainingMs: 5000, justElapsed: false, backgroundAlertAvailable: true, showStart: false };

  test('shows the countdown while running', () => {
    const tree = renderBanner(shellRun);
    expect(JSON.stringify(tree.toJSON())).toContain('0:05');
  });

  test('shows the completion notice after elapsing', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: true, backgroundAlertAvailable: true, showStart: false });
    expect(JSON.stringify(tree.toJSON())).toContain('Rest over');
  });

  test('backgroundAlertAvailable=false shows the "unavailable" warning while running', () => {
    const tree = renderBanner({ ...shellRun, backgroundAlertAvailable: false });
    expect(JSON.stringify(tree.toJSON())).toContain('Background alert unavailable');
  });

  test('backgroundAlertAvailable=true never shows the "unavailable" warning', () => {
    const tree = renderBanner(shellRun);
    expect(JSON.stringify(tree.toJSON())).not.toContain('Background alert unavailable');
  });

  test('the running pill hides Cancel until tapped, then exposes it', () => {
    const onCancel = jest.fn();
    const tree = renderBanner({ ...shellRun, onCancel });
    expect(buttonsByLabel(tree.toJSON(), 'Cancel rest timer')).toHaveLength(0);
    const pill = tree.root.findAll(
      (n) => n.props && n.props.accessibilityLabel === 'Rest timer, 0:05 remaining'
    )[0];
    act(() => { pill.props.onPress(); });
    const cancel = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Cancel rest timer')[0];
    act(() => { cancel.props.onPress(); });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('completion offers Dismiss (not a second full-width surface)', () => {
    const onDismissDone = jest.fn();
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: true, backgroundAlertAvailable: true, showStart: false, onDismissDone });
    const dismiss = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Dismiss rest timer done banner')[0];
    act(() => { dismiss.props.onPress(); });
    expect(onDismissDone).toHaveBeenCalledTimes(1);
  });

  test('renders nothing while idle at the app-shell level', () => {
    const tree = renderBanner({ isRunning: false, remainingMs: 0, justElapsed: false, backgroundAlertAvailable: true, showStart: false });
    expect(tree.toJSON()).toBeNull();
  });
});

// #1006: the Log-screen instance is `compact` — a single stopwatch control
// in a corner of the current-routine editor that expands the four existing
// duration choices in place. It must never render a full-width row, reserve
// banner height, or add bottom-tab clearance.
describe('RestTimerBanner compact editor control (#1006)', () => {
  const idle = { isRunning: false, remainingMs: 0, justElapsed: false, backgroundAlertAvailable: true, compact: true };

  test('collapsed: renders a single accessible "Rest timer" control and no duration row', () => {
    const tree = renderBanner({ ...idle, showStart: true });
    const json = tree.toJSON();
    expect(json).not.toBeNull();
    // one control, labelled for assistive tech
    expect(buttonsByLabel(json, 'Rest timer')).toHaveLength(1);
    // none of the duration choices are on screen while collapsed
    expect(JSON.stringify(json)).not.toContain('Start 60 second rest timer');
    expect(JSON.stringify(json)).not.toContain('60s');
  });

  test('collapsed: the wrapper adds no size — no height, no full-width row', () => {
    const tree = renderBanner({ ...idle, showStart: true });
    const wrapper = tree.toJSON();
    const style = Array.isArray(wrapper.props.style)
      ? Object.assign({}, ...wrapper.props.style.filter(Boolean))
      : wrapper.props.style;
    // no self-imposed banner height, no flex stretch to a full-width row
    expect(style.height).toBeUndefined();
    expect(style.flex).toBeUndefined();
    expect(style.alignSelf).toBeUndefined();
    // it only anchors the dropdown
    expect(style.position).toBe('relative');
    // collapsed: the only child is the icon button, no dropdown in the tree
    expect(wrapper.children).toHaveLength(1);
  });

  test('tap the stopwatch: expands all four existing duration choices near the control', () => {
    const tree = renderBanner({ ...idle, showStart: true });
    const toggle = tree.root.findAll(
      (n) => n.props && n.props.accessibilityLabel === 'Rest timer'
    )[0];
    act(() => { toggle.props.onPress(); });
    const json = JSON.stringify(tree.toJSON());
    [60, 90, 120, 180].forEach((sec) => {
      expect(json).toContain(`Start ${sec} second rest timer`);
    });
  });

  test('expanded: the chooser is a Modal-hosted anchored menu, so it never shifts the editor', () => {
    const tree = renderBanner({ ...idle, showStart: true });
    const toggle = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Rest timer')[0];
    act(() => { toggle.props.onPress(); });
    const menu = tree.root.findAll((n) => n.props && n.props.accessibilityRole === 'menu')[0];
    const style = Array.isArray(menu.props.style)
      ? Object.assign({}, ...menu.props.style.filter(Boolean))
      : menu.props.style;
    // out of flow: absolutely positioned...
    expect(style.position).toBe('absolute');
    // ...and hosted in a Modal so the editor header's own bounds cannot clip
    // it and it cannot reflow the editor layout
    expect(tree.root.findAllByType(Modal).some((m) => m.props.visible === true)).toBe(true);
  });

  test('tap a duration: calls the existing start callback once with that value and collapses', () => {
    const onStart = jest.fn();
    const tree = renderBanner({ ...idle, showStart: true, onStart });
    const toggle = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Rest timer')[0];
    act(() => { toggle.props.onPress(); });
    const choice = tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Start 90 second rest timer')[0];
    act(() => { choice.props.onPress(); });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith(90);
    // chooser collapsed again
    expect(JSON.stringify(tree.toJSON())).not.toContain('Start 90 second rest timer');
  });

  test('dismiss without starting: tapping the stopwatch again collapses the chooser, no timer started', () => {
    const onStart = jest.fn();
    const tree = renderBanner({ ...idle, showStart: true, onStart });
    const toggle = () => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Rest timer')[0];
    act(() => { toggle().props.onPress(); });
    expect(JSON.stringify(tree.toJSON())).toContain('Start 60 second rest timer');
    act(() => { toggle().props.onPress(); });
    expect(JSON.stringify(tree.toJSON())).not.toContain('Start 60 second rest timer');
    expect(onStart).not.toHaveBeenCalled();
  });

  test('hidden outside current-routine edit state (showStart false)', () => {
    const tree = renderBanner({ ...idle, showStart: false });
    expect(tree.toJSON()).toBeNull();
  });

  test('hidden while a timer is running or has just completed', () => {
    expect(renderBanner({ ...idle, showStart: true, isRunning: true, remainingMs: 5000 }).toJSON()).toBeNull();
    expect(renderBanner({ ...idle, showStart: true, justElapsed: true }).toJSON()).toBeNull();
  });

  test('leaving edit state collapses the chooser: it is closed again on return', () => {
    const tree = renderBanner({ ...idle, showStart: true });
    const toggle = () => tree.root.findAll((n) => n.props && n.props.accessibilityLabel === 'Rest timer')[0];
    act(() => { toggle().props.onPress(); });
    expect(JSON.stringify(tree.toJSON())).toContain('Start 60 second rest timer');
    // leave edit mode -> component renders nothing
    updateBanner(tree, { ...idle, showStart: false });
    expect(tree.toJSON()).toBeNull();
    // back into edit mode -> chooser is collapsed, not restored open
    updateBanner(tree, { ...idle, showStart: true });
    expect(JSON.stringify(tree.toJSON())).not.toContain('Start 60 second rest timer');
    expect(buttonsByLabel(tree.toJSON(), 'Rest timer')).toHaveLength(1);
  });
});

// #1006: with the compact control reserving no clearance, PRMomentBanner is
// the only bottom banner in the Log editor flow and carries the tab-bar /
// safe-area clearance exactly once. (Previously the idle rest-timer row and
// PRMomentBanner each tried to, and LogScreen had to zero one of them.)
describe('RestTimerBanner + PRMomentBanner combined clearance (#1006, was #951)', () => {
  function marginBottomOf(node) {
    if (!node) return 0;
    const style = Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style.filter(Boolean))
      : node.props.style;
    return style?.marginBottom ?? 0;
  }

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
              compact
            />
            <PRMomentBanner moment={prMoment} onDismiss={() => {}} style={{ marginBottom: clearance }} />
          </>
        </ThemeProvider>
      );
    });
    return tree;
  }

  test('the compact control never reserves clearance; PRMomentBanner reserves it once', () => {
    const tree = renderBoth({ prMoment: { weight_value: 225, rep_count: 5 } });
    const [compactWrap, prBanner] = tree.toJSON();
    expect(marginBottomOf(compactWrap)).toBe(0);
    expect(marginBottomOf(prBanner)).toBe(88);
  });

  test('no PR moment: the compact control still reserves nothing', () => {
    const tree = renderBoth({ prMoment: null });
    const json = tree.toJSON();
    const compactWrap = Array.isArray(json) ? json[0] : json;
    expect(marginBottomOf(compactWrap)).toBe(0);
  });
});
