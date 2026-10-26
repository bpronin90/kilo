// Foreground completion cue for the rest timer (#1651). Owned by the timer
// lifecycle (useRestTimer), not by any mounted banner/row, so it plays once per
// timer identity no matter how many controls are visible or how often they
// rerender. Background/locked completion is the OS notification's job
// (restTimerScheduler.js) — this is only the in-app cue, and it never throws:
// a missing/denied audio runtime must not stop the countdown or the done UI.
import { Platform } from 'react-native';

// Cleanup safety net if the player never reports it finished.
const RELEASE_AFTER_MS = 5000;
// How long to wait for an asynchronous playback-error event before reporting
// success; browsers reject autoplay within a few milliseconds.
const SETTLE_MS = 150;

function failureReason(message) {
  const blocked = Platform.OS === 'web' && /not allowed|gesture|interact/i.test(message);
  return blocked ? 'autoplay-blocked' : 'error';
}

let lastPlayedTimerId = null;

export function __resetRestTimerSoundForTests() {
  lastPlayedTimerId = null;
}

// Plays the cue at most once per timerId. Resolves { played, reason } instead of
// rejecting. Silent mode and the OS media volume are respected (the player is
// not asked to override the iOS silent switch).
export async function playRestTimerCompletionSound(timerId) {
  if (!timerId) return { played: false, reason: 'no-timer' };
  if (lastPlayedTimerId === timerId) return { played: false, reason: 'duplicate' };
  lastPlayedTimerId = timerId;
  let player = null;
  try {
    // Lazy require keeps expo-audio out of the startup import graph.
    // eslint-disable-next-line global-require
    const { createAudioPlayer } = require('expo-audio');
    // eslint-disable-next-line global-require
    player = createAudioPlayer(require('../assets/sounds/rest-timer-complete.wav'));
    let failure = null;
    const release = () => {
      try { player?.release?.(); } catch { /* already released */ }
    };
    player.addListener?.('playbackStatusUpdate', (status) => {
      // expo-audio's web play() returns void and reports a rejected media
      // promise (e.g. autoplay policy) only as a status event with `error`.
      if (status?.error && !failure) failure = String(status.error);
      if (status?.didJustFinish) release();
    });
    setTimeout(release, RELEASE_AFTER_MS);
    await player.play();
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    if (failure) return { played: false, reason: failureReason(failure) };
    return { played: true };
  } catch (e) {
    try { player?.release?.(); } catch { /* ignore */ }
    const blocked = Platform.OS === 'web' && e?.name === 'NotAllowedError';
    return { played: false, reason: blocked ? 'autoplay-blocked' : failureReason(String(e?.message ?? e)) };
  }
}
