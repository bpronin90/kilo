import { Platform } from 'react-native';
import { playRestTimerCompletionSound, __resetRestTimerSoundForTests } from '../lib/restTimerSound';

const mockPlayer = { play: jest.fn(async () => {}), release: jest.fn(), addListener: jest.fn() };
const mockCreate = jest.fn(() => mockPlayer);
jest.mock('expo-audio', () => ({ createAudioPlayer: (...a) => mockCreate(...a) }));

beforeEach(() => {
  __resetRestTimerSoundForTests();
  jest.clearAllMocks();
  mockPlayer.play.mockImplementation(async () => {});
});

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());

async function play(id) {
  const p = playRestTimerCompletionSound(id);
  await jest.advanceTimersByTimeAsync(200);
  return p;
}

describe('playRestTimerCompletionSound', () => {
  test('plays once for a timer identity and ignores a duplicate', async () => {
    expect(await play('t1')).toEqual({ played: true });
    expect(await play('t1')).toEqual({ played: false, reason: 'duplicate' });
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  test('a replacement timer id plays again', async () => {
    await play('t1');
    await play('t2');
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });

  test('no timer id never plays', async () => {
    expect(await play(null)).toEqual({ played: false, reason: 'no-timer' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('a playback rejection resolves (never rejects) and releases the player', async () => {
    mockPlayer.play.mockRejectedValueOnce(new Error('audio session unavailable'));
    expect(await play('t3')).toEqual({ played: false, reason: 'error' });
    expect(mockPlayer.release).toHaveBeenCalled();
  });

  test('player creation failure resolves with an error reason', async () => {
    mockCreate.mockImplementationOnce(() => { throw new Error('native module missing'); });
    expect(await play('t4')).toEqual({ played: false, reason: 'error' });
  });

  test('web autoplay rejection is reported as autoplay-blocked', async () => {
    const original = Platform.OS;
    Platform.OS = 'web';
    const err = new Error('blocked');
    err.name = 'NotAllowedError';
    mockPlayer.play.mockRejectedValueOnce(err);
    try {
      expect(await play('t5')).toEqual({ played: false, reason: 'autoplay-blocked' });
    } finally {
      Platform.OS = original;
    }
  });

  test('web autoplay denial reported only via a status event (real expo-audio web behavior)', async () => {
    const original = Platform.OS;
    Platform.OS = 'web';
    mockPlayer.play.mockImplementationOnce(() => {
      const [, listener] = mockPlayer.addListener.mock.calls.at(-1);
      Promise.resolve().then(() => listener({ error: "play() failed because the user didn't interact with the document first. NotAllowedError" }));
    });
    try {
      expect(await play('t7')).toEqual({ played: false, reason: 'autoplay-blocked' });
    } finally {
      Platform.OS = original;
    }
  });

  test('releases the player when playback finishes', async () => {
    await play('t6');
    const [, listener] = mockPlayer.addListener.mock.calls[0];
    listener({ didJustFinish: true });
    expect(mockPlayer.release).toHaveBeenCalled();
  });
});
