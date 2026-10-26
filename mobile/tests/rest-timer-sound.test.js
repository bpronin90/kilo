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

describe('playRestTimerCompletionSound', () => {
  test('plays once for a timer identity and ignores a duplicate', async () => {
    expect(await playRestTimerCompletionSound('t1')).toEqual({ played: true });
    expect(await playRestTimerCompletionSound('t1')).toEqual({ played: false, reason: 'duplicate' });
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  test('a replacement timer id plays again', async () => {
    await playRestTimerCompletionSound('t1');
    await playRestTimerCompletionSound('t2');
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });

  test('no timer id never plays', async () => {
    expect(await playRestTimerCompletionSound(null)).toEqual({ played: false, reason: 'no-timer' });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('a playback rejection resolves (never rejects) and releases the player', async () => {
    mockPlayer.play.mockRejectedValueOnce(new Error('audio session unavailable'));
    expect(await playRestTimerCompletionSound('t3')).toEqual({ played: false, reason: 'error' });
    expect(mockPlayer.release).toHaveBeenCalled();
  });

  test('player creation failure resolves with an error reason', async () => {
    mockCreate.mockImplementationOnce(() => { throw new Error('native module missing'); });
    expect(await playRestTimerCompletionSound('t4')).toEqual({ played: false, reason: 'error' });
  });

  test('web autoplay rejection is reported as autoplay-blocked', async () => {
    const original = Platform.OS;
    Platform.OS = 'web';
    const err = new Error('blocked');
    err.name = 'NotAllowedError';
    mockPlayer.play.mockRejectedValueOnce(err);
    try {
      expect(await playRestTimerCompletionSound('t5')).toEqual({ played: false, reason: 'autoplay-blocked' });
    } finally {
      Platform.OS = original;
    }
  });

  test('releases the player when playback finishes', async () => {
    await playRestTimerCompletionSound('t6');
    const [, listener] = mockPlayer.addListener.mock.calls[0];
    listener({ didJustFinish: true });
    expect(mockPlayer.release).toHaveBeenCalled();
  });
});
