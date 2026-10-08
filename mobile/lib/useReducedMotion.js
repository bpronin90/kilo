import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Live OS "reduce motion" preference. Read-only UI preference: never persisted
// as app state. Matches the RestTimerBanner / recovery-modal pattern, with one
// addition: a module-level cache so a conditionally mounted modal reads the
// real value on its very first render instead of starting a fade first.
//  - the cache is primed once at module load via isReduceMotionEnabled();
//  - one module-level reduceMotionChanged subscription keeps it current and
//    notifies mounted hooks;
//  - a lookup or subscription that throws or rejects leaves the cache at
//    `false` (normal motion) with no unhandled rejection;
//  - hooks ignore notifications after unmount.
let cached = false;
const listeners = new Set();

function publish(value) {
  const next = !!value;
  cached = next;
  listeners.forEach((fn) => fn(next));
}

try {
  Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
    .then(publish)
    .catch(() => {});
} catch {
  // Lookup unavailable: stay on normal motion.
}
try {
  AccessibilityInfo.addEventListener('reduceMotionChanged', publish);
} catch {
  // Subscription unavailable: the cached value is never updated live.
}

export function useReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(cached);

  useEffect(() => {
    let cancelled = false;
    const onChange = (v) => { if (!cancelled) setReduceMotion(v); };
    listeners.add(onChange);
    // The cache may have changed between first render and this effect.
    setReduceMotion(cached);
    return () => {
      cancelled = true;
      listeners.delete(onChange);
    };
  }, []);

  return reduceMotion;
}
