// Plate calculator entry points (#1375, #1445): header button and Routine actions. The calculator lives outside
// the note body, so weights in the note stay plain text and never compete
// with the body's double-tap-to-edit. This owns the calculator's visibility
// and the menu-to-modal handoff: iOS cannot present a second Modal while the
// actions sheet is still dismissing, so the launch waits for the sheet's
// `onDismiss` (with ActionSheetMenu's guarded fallback) and runs exactly once.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

const IOS_DISMISS_FALLBACK_MS = 700;

export function useRoutinePlateCalculator(menuOpen) {
  const [visible, setVisible] = useState(false);
  const pendingRef = useRef(false);

  const launch = useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    setVisible(true);
  }, []);

  // Called from the menu item after it has closed the sheet.
  const request = useCallback(() => {
    pendingRef.current = true;
    if (Platform.OS !== 'ios') launch();
  }, [launch]);

  useEffect(() => {
    if (menuOpen) {
      // Reopening the sheet cancels any launch still waiting on the old one.
      pendingRef.current = false;
      return undefined;
    }
    if (!pendingRef.current) return undefined;
    const timer = setTimeout(launch, IOS_DISMISS_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [menuOpen, launch]);

  // Unmount drops any pending launch along with the fallback timer above.
  useEffect(() => () => { pendingRef.current = false; }, []);

  // Direct header entry (#1445): no sheet to wait on, and it supersedes any
  // launch still pending from the overflow menu.
  const open = useCallback(() => {
    pendingRef.current = false;
    setVisible(true);
  }, []);

  const close = useCallback(() => setVisible(false), []);

  return { visible, request, open, onMenuDismiss: launch, close };
}
