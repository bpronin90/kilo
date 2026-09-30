import { createContext, useCallback, useEffect, useRef, useState } from 'react';

// Shared visual gap between the floating TabBar and the screen bottom edge.
// TabBar uses it for its own bottom offset (not its height); ScreenShell adds
// it on top of the measured bar height for scroll clearance (#551).
export const TAB_BAR_VISUAL_GAP = 4;

// Approximate rendered (compact bar ~55dp, #1209) TabBar height, used only until TabBar's own onLayout
// measurement lands so ScreenShell has sufficient clearance before that
// first measurement without visibly jumping once it arrives.
export const TAB_BAR_HEIGHT_FALLBACK = 56;

// Owned by App.js, which measures TabBar via onLayout and provides the real
// height to every ScreenShell so scroll clearance tracks the rendered bar.
export const TabBarLayoutContext = createContext({
  tabBarHeight: TAB_BAR_HEIGHT_FALLBACK,
});

// Scroll-direction auto-hide (#1209, reverses #1026's always-visible bar). The
// bar stays fully opaque whenever it is shown; it slides off-screen (a
// translateY, never an opacity fade) while the user scrolls down and returns on
// scroll up, at the top of a scroll, and on tab change. Hiding is purely a
// transform, so the measured height and ScreenShell's scroll clearance never
// change and content cannot jump.
export const TAB_BAR_SCROLL_THRESHOLD = 8;

// Pure transition: given the previous scroll offset/visibility and a new scroll
// event's metrics, return the next { hidden, lastY }. Rules:
// - lastY null (first event after mount/tab change) only records a baseline.
// - y is clamped into [0, maxY] so top/bottom overscroll bounce cannot flip
//   direction; at or above the top (y <= 0) the bar always shows.
// - deltas under the threshold are ignored and do not move the baseline, so
//   slow drags still accumulate into a decision.
export function nextTabBarScrollState({ lastY, hidden }, { y, contentHeight = 0, layoutHeight = 0 }) {
  const maxY = Math.max(0, contentHeight - layoutHeight);
  const clampedY = Math.min(Math.max(y, 0), maxY || Math.max(y, 0));
  if (clampedY <= 0) return { hidden: false, lastY: 0 };
  if (lastY == null) return { hidden, lastY: clampedY };
  const delta = clampedY - lastY;
  if (Math.abs(delta) < TAB_BAR_SCROLL_THRESHOLD) return { hidden, lastY };
  return { hidden: delta > 0, lastY: clampedY };
}

// Owned by App.js. `onScroll` takes a ScrollView scroll event; ScreenShell
// forwards every scroll to it. Default is a no-op so isolated ScreenShell
// renders (and tests) need no provider.
export const TabBarScrollContext = createContext({ onScroll: () => {} });

// Returns { hidden, onScroll }. Resets to shown (and forgets the scroll
// baseline) whenever `activeTab` changes.
export function useTabBarAutoHide(activeTab) {
  const [hidden, setHidden] = useState(false);
  const stateRef = useRef({ lastY: null, hidden: false });

  useEffect(() => {
    stateRef.current = { lastY: null, hidden: false };
    setHidden(false);
  }, [activeTab]);

  const onScroll = useCallback((e) => {
    const n = e && e.nativeEvent;
    if (!n || !n.contentOffset) return;
    const next = nextTabBarScrollState(stateRef.current, {
      y: n.contentOffset.y,
      contentHeight: n.contentSize ? n.contentSize.height : 0,
      layoutHeight: n.layoutMeasurement ? n.layoutMeasurement.height : 0,
    });
    const changed = next.hidden !== stateRef.current.hidden;
    stateRef.current = next;
    if (changed) setHidden(next.hidden);
  }, []);

  return { hidden, onScroll };
}
