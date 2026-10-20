import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { localDateToday } from '../lib/WeightScreenHelpers';

// Local calendar day ("YYYY-MM-DD") as a projection input (#1484). Never
// persisted. It advances at the next local midnight (timer re-armed from the
// wall clock each time, so DST shifts cannot accumulate drift) and re-syncs
// when the app returns to the foreground, since timers are not reliable while
// backgrounded. Same-value updates bail out, so no render loop.
export function useLocalCalendarDay() {
  const [day, setDay] = useState(localDateToday);
  useEffect(() => {
    let timeoutId;
    const sync = () => setDay(localDateToday());
    const schedule = () => {
      clearTimeout(timeoutId);
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timeoutId = setTimeout(() => {
        sync();
        schedule();
      }, nextMidnight.getTime() - now.getTime());
    };
    schedule();
    // Catch up if mounted state is already stale (e.g. day rolled between
    // first render and effect registration).
    sync();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sync();
        schedule();
      }
    });
    return () => {
      clearTimeout(timeoutId);
      sub?.remove?.();
    };
  }, []);
  return day;
}

// Local-midnight Date for a "YYYY-MM-DD" day (calendar arithmetic, DST-safe).
export function localDayToDate(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  return new Date(y, m - 1, d);
}
