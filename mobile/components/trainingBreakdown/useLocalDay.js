import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

// Device-local "today" for the Training breakdown range (#1588). Returns a Date
// that changes identity only when the local calendar day changes: at local
// midnight (timer) or when the app returns to the foreground on a new day, so
// bounded ranges re-derive on date rollover without re-deriving every render.
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function useLocalDay() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const check = () => {
      const next = new Date();
      setNow((prev) => (dayKey(prev) === dayKey(next) ? prev : next));
    };
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(check, Math.max(1000, midnight.getTime() - Date.now()));
    const sub = AppState.addEventListener ? AppState.addEventListener('change', (s) => { if (s === 'active') check(); }) : null;
    return () => {
      clearTimeout(timer);
      sub?.remove?.();
    };
  }, [now]);
  return now;
}
