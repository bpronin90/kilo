import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Live OS "reduce motion" preference. Read-only UI preference: never persisted
// as app state. Matches the RestTimerBanner / recovery-modal pattern, with one
// addition: a module-level cache so a conditionally mounted modal reads the
// real value on its very first render instead of starting a fade first.
//  - the cache is primed once at module load via isReduceMotionEnabled();
//  - the native reduceMotionChanged listener is ref-counted: the first mounted
//    consumer adds it (and refreshes the lookup), the last unmount removes it.
//    The cached value is kept across, so a later mount still starts correct;
//  - until the first lookup resolves the value is unknown, and unknown means
//    reduced (`true`): nothing animates on a guess;
//  - a lookup that throws or rejects settles on `false` (normal motion) with no
//    unhandled rejection; add/remove that throw are swallowed;
//  - hooks ignore notifications after unmount.
let cached = true;
let lookupInFlight = false;
let subscription = null;
const listeners = new Set();

function publish(value) {
  const next = !!value;
  cached = next;
  listeners.forEach((fn) => fn(next));
}

function lookup() {
  if (lookupInFlight) return;
  lookupInFlight = true;
  const done = (fn) => (v) => { lookupInFlight = false; fn(v); };
  try {
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
      .then(done(publish), done(() => publish(false)));
  } catch {
    // Lookup unavailable: normal motion.
    lookupInFlight = false;
    publish(false);
  }
}

function subscribe() {
  try {
    subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', publish) || null;
  } catch {
    subscription = null;
  }
  lookup();
}

function unsubscribe() {
  try {
    subscription?.remove?.();
  } catch {
    // Nothing further to release.
  }
  subscription = null;
}

lookup();

export function useReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(cached);

  useEffect(() => {
    let cancelled = false;
    const onChange = (v) => { if (!cancelled) setReduceMotion(v); };
    if (listeners.size === 0) subscribe();
    listeners.add(onChange);
    // The cache may have changed between first render and this effect.
    setReduceMotion(cached);
    return () => {
      cancelled = true;
      listeners.delete(onChange);
      if (listeners.size === 0) unsubscribe();
    };
  }, []);

  return reduceMotion;
}
