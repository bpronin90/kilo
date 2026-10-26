# Rest-timer completion sound (#1651)

Automated coverage: `mobile/tests/rest-timer-sound.test.js`,
`rest-timer-hook.test.js`, `rest-timer-scheduler.test.js`,
`reminder-scheduler.test.js`.

## Design

- Foreground: `useRestTimer` (the single app-root controller) plays
  `mobile/assets/sounds/rest-timer-complete.wav` via `expo-audio` when the tick
  sees the timer end with the app continuously active. Guarded once per
  `timerId` in the hook and again in `lib/restTimerSound.js`. The iOS silent
  switch and media volume are respected (no `playsInSilentMode`).
- Background/locked: the scheduled notification now carries `sound: 'default'`
  and uses the new high-importance Android channel `kilo-rest-timer`. The
  existing `kilo-reminders` channel is unchanged (Android cannot alter an
  existing channel), so weigh-in/workout reminders behave as before.
- Not replayed: cold start, stale elapsed records, and timers that ended while
  the app was away (the OS alert owned those).
- Web: `createAudioPlayer`/`play()` failures (including autoplay policy,
  reported as `autoplay-blocked`) resolve quietly; the countdown and done UI
  are unaffected.

## Runtime

`expo-audio` is a new native module, so `PREVIEW_RUNTIME` is now `preview-15`
and a fresh preview/development build is required. No release was published.

## Manual reproduction (not run by the implementing session)

1. Install a preview-15 / development build; allow notifications.
2. Start a 10 s rest timer while editing a workout note; stay in the app. Expect
   one short two-tone chime at completion and the existing done banner.
3. Start another, lock the device. Expect the OS notification sound
   (subject to mute, volume and Do Not Disturb).
4. Start another, background and return after it ends: no foreground chime.
