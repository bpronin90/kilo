import AsyncStorage from '@react-native-async-storage/async-storage';
import { WELCOME_WALKTHROUGH_KEY, readWelcomeWalkthrough, dismissWelcomeWalkthrough } from '../storage/welcomeWalkthrough';

beforeEach(() => { jest.clearAllMocks(); });

test('missing is eligible; versioned dismissal survives a reread', async () => {
  AsyncStorage.getItem.mockResolvedValueOnce(null);
  expect(await readWelcomeWalkthrough()).toBe('missing');
  expect(await dismissWelcomeWalkthrough()).toBe(true);
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(WELCOME_WALKTHROUGH_KEY, '{"version":1,"dismissed":true}');
  AsyncStorage.getItem.mockResolvedValueOnce(AsyncStorage.setItem.mock.calls[0][1]);
  expect(await readWelcomeWalkthrough()).toBe('dismissed');
});

test.each(['{', 'null', 'false', '{}', '{"version":2,"dismissed":true}', '{"version":1,"dismissed":false}'])('malformed/unknown preference %s suppresses automatic launch', async (raw) => {
  AsyncStorage.getItem.mockResolvedValueOnce(raw);
  expect(await readWelcomeWalkthrough()).toBe('unavailable');
});

test('read and write failures are explicit, never reported as missing or saved', async () => {
  AsyncStorage.getItem.mockRejectedValueOnce(new Error('disk'));
  expect(await readWelcomeWalkthrough()).toBe('unavailable');
  AsyncStorage.setItem.mockRejectedValueOnce(new Error('disk'));
  expect(await dismissWelcomeWalkthrough()).toBe(false);
});
