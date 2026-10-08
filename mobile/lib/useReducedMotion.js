import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Live OS "reduce motion" preference. Read-only UI preference: never persisted
// as app state. Matches the RestTimerBanner / recovery-modal pattern:
//  - initial lookup via isReduceMotionEnabled(), then live reduceMotionChanged;
//  - a late lookup or event after unmount is ignored (`cancelled`);
//  - a lookup that throws or rejects falls back to `false` (normal motion), the
//    same default the first render uses, with no unhandled rejection.
export function useReducedMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let sub = null;
    try {
      Promise.resolve(AccessibilityInfo.isReduceMotionEnabled())
        .then((v) => { if (!cancelled) setReduceMotion(!!v); })
        .catch(() => {});
    } catch {
      // Lookup unavailable: stay on normal motion.
    }
    try {
      sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
        if (!cancelled) setReduceMotion(!!v);
      });
    } catch {
      sub = null;
    }
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, []);

  return reduceMotion;
}
