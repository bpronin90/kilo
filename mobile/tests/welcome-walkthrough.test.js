import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { BackHandler, Keyboard, Modal, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useWelcomeWalkthrough, WALKTHROUGH_STEPS } from '../hooks/useWelcomeWalkthrough';
import { WelcomeWalkthrough } from '../components/WelcomeWalkthrough';
import { WELCOME_WALKTHROUGH_KEY } from '../storage/welcomeWalkthrough';

let tour, tree, navigation, keyboard, hardwareBack, removals;
function Harness({ activeTab: externalTab, ...props }) {
  const [tab, setTab] = React.useState('Home');
  const navigate = React.useCallback((value) => { navigation(value); setTab(value); }, []);
  tour = useWelcomeWalkthrough({ ready: true, firstUse: 'empty', blocked: false, ...props,
    activeTab: externalTab || tab, navigate });
  return null;
}
async function mount(props = {}) {
  await act(async () => { tree = renderer.create(<Harness {...props} />); });
}
async function update(props = {}) { await act(async () => tree.update(<Harness {...props} />)); }
async function measure() {
  await act(async () => tour.measureAnchor({ tab: WALKTHROUGH_STEPS[tour.step].tab,
    request: tour.request, x: 20, y: 600, width: 60, height: 46 }));
}
beforeEach(() => {
  jest.clearAllMocks(); navigation = jest.fn(); keyboard = {}; removals = [];
  AsyncStorage.getItem.mockResolvedValue(null);
  AsyncStorage.setItem.mockResolvedValue(null);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
    keyboard[event] = callback;
    const remove = jest.fn(); removals.push(remove); return { remove };
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_, callback) => {
    hardwareBack = callback;
    const remove = jest.fn(); removals.push(remove); return { remove };
  });
});
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null; jest.restoreAllMocks();
});

test.each(['loading', 'unavailable', 'populated'])('%s Home reads cannot start a tour', async (firstUse) => {
  await mount({ firstUse }); expect(tour.active).toBe(false); expect(navigation).not.toHaveBeenCalled();
});
test('preference read is independent of startup readiness, including late reads after unmount', async () => {
  let resolve;
  AsyncStorage.getItem.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
  await mount({ ready: false });
  expect(AsyncStorage.getItem).toHaveBeenCalledWith(WELCOME_WALKTHROUGH_KEY);
  await update(); expect(tour.active).toBe(false);
  await act(async () => tree.unmount()); tree = null;
  await act(async () => resolve(null)); expect(navigation).not.toHaveBeenCalled();
});
test.each(['{"version":1,"dismissed":true}', '{bad', '{}'])('saved or corrupt preference suppresses auto; replay works: %s', async (raw) => {
  AsyncStorage.getItem.mockResolvedValue(raw);
  await mount(); expect(tour.active).toBe(false);
  await act(async () => tour.replay()); expect(tour.step).toBe(0); expect(navigation).toHaveBeenLastCalledWith('Home');
});
test('read error suppresses auto and permits manual replay', async () => {
  AsyncStorage.getItem.mockRejectedValue(new Error('disk'));
  await mount(); expect(tour.active).toBe(false);
  await act(async () => tour.replay()); expect(tour.active).toBe(true);
});
test('all real screens, rapid taps, stale measurement rejection, Back, Done and replay', async () => {
  await mount(); expect(tour.step).toBe(0);
  // No screen change until a visible anchor has been measured.
  await act(async () => tour.next()); expect(tour.step).toBe(0);
  await measure();
  const oldRequest = tour.request;
  const staleMeasure = tour.measureAnchor;
  const next = tour.next;
  await act(async () => { next(); next(); next(); });
  expect(tour.step).toBe(1); expect(navigation.mock.calls.map(([tab]) => tab)).toEqual(['Home', 'Log']);
  await act(async () => staleMeasure({ request: oldRequest, tab: 'Log', width: 60, height: 46 }));
  expect(tour.anchor).toBe(null);
  await measure(); await act(async () => tour.back()); expect(tour.step).toBe(0);
  for (let i = 0; i < 4; i++) { await measure(); await act(async () => tour.next()); }
  expect(tour.step).toBe(4); expect(navigation).toHaveBeenLastCalledWith('More');
  await act(async () => tour.done()); expect(tour.active).toBe(false);
  expect(navigation).toHaveBeenLastCalledWith('Home');
  expect(AsyncStorage.setItem.mock.calls.map(([key]) => key)).toEqual([WELCOME_WALKTHROUGH_KEY]);
  await update(); expect(tour.active).toBe(false);
  await act(async () => tour.replay()); expect(tour.step).toBe(0);
});
test('Skip keeps current screen and suppresses repeat even if persistence fails', async () => {
  AsyncStorage.setItem.mockRejectedValue(new Error('full'));
  await mount(); await measure(); await act(async () => tour.next());
  navigation.mockClear();
  await act(async () => tour.skip()); expect(tour.active).toBe(false); expect(navigation).not.toHaveBeenCalled();
  await update(); expect(tour.active).toBe(false);
  await act(async () => tour.replay()); expect(tour.step).toBe(0);
});
test('system Back skips and releases listeners; remount with persisted dismissal stays closed', async () => {
  await mount(); await act(async () => { expect(hardwareBack()).toBe(true); });
  expect(tour.active).toBe(false); expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  await act(async () => tree.unmount()); tree = null;
  expect(removals.every((remove) => remove.mock.calls.length > 0)).toBe(true);
  AsyncStorage.getItem.mockResolvedValue('{"version":1,"dismissed":true}');
  await mount(); expect(tour.active).toBe(false);
});
test('blocking interruption preserves destination and does not persist a fake dismissal', async () => {
  await mount(); navigation.mockClear();
  await update({ blocked: true, activeTab: 'More' }); expect(tour.active).toBe(false);
  expect(navigation).not.toHaveBeenCalled(); expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  await update(); expect(tour.active).toBe(false);
  await act(async () => tour.replay()); expect(tour.step).toBe(0);
});
test('visible keyboard interrupts without dismissing keyboard; closing it does not restart tour', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss');
  await mount(); await act(async () => keyboard.keyboardDidShow()); expect(tour.active).toBe(false);
  await act(async () => keyboard.keyboardDidHide()); expect(tour.active).toBe(false);
  expect(dismiss).not.toHaveBeenCalled();
});
test('readiness and blockers delay auto launch; an unrelated rerender preserves the active step', async () => {
  await mount({ ready: false, blocked: true }); expect(tour.active).toBe(false);
  await update({ blocked: true }); expect(tour.active).toBe(false);
  await update(); expect(tour.step).toBe(0);
  await measure(); await act(async () => tour.next());
  await update(); expect(tour.step).toBe(1);
});
test('view waits for real visible anchor, and Modal back uses Skip', async () => {
  await mount();
  const skip = jest.fn();
  const viewTour = { ...tour, skip, step: 1, active: true };
  let view;
  await act(async () => { view = renderer.create(<WelcomeWalkthrough tour={viewTour} anchorVisible />); });
  expect(view.root.findAllByType(Modal)).toHaveLength(0);
  const dimensions = require('react-native').Dimensions.get('window');
  const anchor = { x: 16, y: dimensions.height - 70, width: 60, height: 46, windowWidth: dimensions.width, windowHeight: dimensions.height };
  await act(async () => view.update(<WelcomeWalkthrough tour={{ ...viewTour, anchor }} anchorVisible />));
  expect(view.root.findAllByType(Text).some((node) => node.props.children === WALKTHROUGH_STEPS[1].body)).toBe(true);
  act(() => view.root.findByType(Modal).props.onRequestClose()); expect(skip).toHaveBeenCalledTimes(1);
  await act(async () => view.update(<WelcomeWalkthrough tour={{ ...viewTour, anchor }} anchorVisible={false} />));
  expect(view.root.findAllByType(Modal)).toHaveLength(0);
  await act(async () => view.unmount());
});
