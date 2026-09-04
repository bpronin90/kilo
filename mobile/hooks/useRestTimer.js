// App-root rest timer controller (#577). Mounted exactly once from App.js —
// owns hydration, the tick, and reconciliation on cold start and on every
// background/inactive → active AppState transition. Row/countdown UI reads
// this hook's return value; it never hydrates or listens independently, so
// mounting several set rows can never create competing listeners or
// duplicate reconciliation passes.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  startRestTimer,
  cancelRestTimer,
  reconcileRestTimer,
  remindersSupported,
} from '../lib/restTimerScheduler';
import { remainingMs, isElapsed } from '../lib/restTimer';
import { setNotificationHandlerAppActive } from '../lib/reminderScheduler';

const TICK_MS = 250;

export function useRestTimer() {
  const [record, setRecord] = useState(null);
  const [justElapsed, setJustElapsed] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const wasActiveRef = useRef(AppState.currentState === 'active');

  const reconcile = useCallback(async (wasActiveWhenElapsed) => {
    const { record: r, justElapsed: elapsed } = await reconcileRestTimer({ wasActiveWhenElapsed });
    setRecord(r);
    setRemaining(remainingMs(r));
    if (elapsed) setJustElapsed(true);
  }, []);

  // Cold start: single reconciliation pass, exactly once.
  useEffect(() => {
    reconcile(false).catch(() => {});
  }, [reconcile]);

  // The single AppState subscription for the rest timer anywhere in the app
  // (#577 review) — row/countdown components must never add their own.
  useEffect(() => {
    setNotificationHandlerAppActive(AppState.currentState === 'active');
    const sub = AppState.addEventListener('change', (next) => {
      const wasActive = wasActiveRef.current;
      const isActive = next === 'active';
      setNotificationHandlerAppActive(isActive);
      if (!wasActive && isActive) {
        reconcile(false).catch(() => {});
      }
      wasActiveRef.current = isActive;
    });
    return () => sub.remove();
  }, [reconcile]);

  // Foreground tick: recomputes remaining from the wall clock every 250ms
  // while a timer is running; never an authoritative interval counter.
  useEffect(() => {
    if (!record) return undefined;
    const id = setInterval(() => {
      const left = remainingMs(record);
      setRemaining(left);
      if (left === 0 && wasActiveRef.current) {
        // Elapsed while the app stayed foregrounded the whole time — the OS
        // notification was suppressed for this case, so show the in-app
        // banner directly rather than waiting for a background→active
        // transition that will never come.
        setJustElapsed(true);
        setRecord(null);
        cancelRestTimer().catch(() => {});
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [record]);

  const start = useCallback(async (durationSec, exerciseLabel = null) => {
    setJustElapsed(false);
    const r = await startRestTimer({ durationSec, exerciseLabel });
    setRecord(r);
    setRemaining(remainingMs(r));
  }, []);

  const cancel = useCallback(async () => {
    await cancelRestTimer();
    setRecord(null);
    setRemaining(0);
  }, []);

  const dismissDone = useCallback(() => setJustElapsed(false), []);

  return {
    record,
    remainingMs: remaining,
    isRunning: !!record && !isElapsed(record),
    justElapsed,
    // #950 review (P2): while a timer is active, this must reflect whether a
    // background alert was ACTUALLY scheduled for THIS timer (permission
    // granted + the schedule call succeeded — record.notificationScheduled,
    // set by restTimerScheduler.startRestTimer/persisted with the record),
    // not merely whether the platform generally supports notifications.
    // Denied permission, "can't ask again", or a rejected native schedule
    // call all correctly read as unavailable here. Before any timer has ever
    // started there is no record yet, so remindersSupported() is used only
    // as a platform-capability hint (RestTimerBanner never shows this
    // warning outside a running timer anyway).
    backgroundAlertAvailable: record ? !!record.notificationScheduled : remindersSupported(),
    start,
    cancel,
    dismissDone,
  };
}
