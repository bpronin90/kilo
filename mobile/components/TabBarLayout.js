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
// scroll up, at the top or bottom of a scroll, and on tab change. Hiding is purely a
// transform, so the measured height and ScreenShell's scroll clearance never
// change and content cannot jump.
export const TAB_BAR_SCROLL_THRESHOLD = 8;

// Bottom reveal (#1231): a scroll within this many logical dp of the content
// end (or beyond it, during iOS rubber-banding) counts as "at the bottom". It is
// a fixed dp value, deliberately not viewport- or content-scaled: it only
// absorbs scroll-metric rounding, so the reveal never starts early on tall
// screens.
export const TAB_BAR_BOTTOM_EPSILON = 1;

// Scroll metrics -> { y, maxY, atTop, atBottom }. maxY <= 0 means nothing can
// scroll (content shorter than or equal to the viewport): that is both
// boundaries at once, so the bar is always shown.
function boundaries({ y, contentHeight = 0, layoutHeight = 0 }) {
  const maxY = Math.max(0, contentHeight - layoutHeight);
  const unscrollable = maxY <= 0;
  return {
    maxY,
    atTop: unscrollable || y <= 0,
    atBottom: y >= maxY - TAB_BAR_BOTTOM_EPSILON,
  };
}

// Pure transition: given the previous scroll offset/visibility and a new scroll
// event's metrics, return the next { hidden, lastY }. Rules:
// - lastY null (first event after mount/tab change) only records a baseline.
// - Top (y <= 0, including negative overscroll) and unscrollable content always
//   show the bar.
// - Bottom (y within TAB_BAR_BOTTOM_EPSILON of maxY, or beyond it) also always
//   shows the bar (#1231) and resets the baseline to exactly maxY. That reset is
//   the hysteresis: bounce/settle events and sub-epsilon jitter around the end
//   are measured from maxY, never a stale mid-scroll offset, so they can neither
//   hide nor flicker the bar. It can hide again only from a non-bottom baseline
//   after a fresh downward drag over the threshold.
// - deltas under the threshold are ignored and do not move the baseline, so
//   slow drags still accumulate into a decision.
export function nextTabBarScrollState({ lastY, hidden }, metrics) {
  const { y } = metrics;
  const { maxY, atTop, atBottom } = boundaries(metrics);
  if (atTop) return { hidden: false, lastY: 0 };
  if (atBottom) return { hidden: false, lastY: maxY };
  if (lastY == null) return { hidden, lastY: y };
  const delta = y - lastY;
  if (Math.abs(delta) < TAB_BAR_SCROLL_THRESHOLD) return { hidden, lastY };
  return { hidden: delta > 0, lastY: y };
}

// Programmatic scrolls (scrollTo/scrollToEnd/anchor jumps, userDriven=false)
// never hide the bar; they only re-baseline, and a jump to the top or the
// bottom reveals it like a user scroll there would.
export function nextTabBarProgrammaticState({ hidden }, metrics) {
  const y = Math.max(0, metrics.y);
  const { maxY, atTop, atBottom } = boundaries({ ...metrics, y });
  if (atTop) return { hidden: false, lastY: 0 };
  if (atBottom) return { hidden: false, lastY: maxY };
  return { hidden, lastY: y };
}

// Web has no drag/momentum events, so user scrolling is inferred from input on
// the scroll node (#1214): wheel/trackpad, touch drags, scroll keys
// (arrows, Page/Home/End, Space; see focus rules below) and scrollbar presses stamp a window; scroll events inside it are user-driven.
// Anchor/animated section jumps fire scroll events with no preceding scroll
// input, so they stay programmatic. Plain presses on content (links, buttons,
// taps, Enter, Space on controls) deliberately do not stamp: they are what trigger jumps.
// The window outlasts trackpad inertia gaps between wheel events but not a
// multi-frame animated scrollTo.
export const WEB_USER_SCROLL_WINDOW_MS = 200;
const WEB_SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
// Focus decides what a key does. Text entry and widgets that own the arrow keys
// consume every scroll key; buttons and links only claim Space/Enter, so
// arrows/Page/Home/End still scroll the page there.
const roleOf = (t) => (t.getAttribute && t.getAttribute('role')) || '';
const consumesArrows = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')
  || t.isContentEditable === true
  || /^(textbox|combobox|listbox|slider|spinbutton|radio|tab|menu|menuitem|searchbox)$/.test(roleOf(t)));
const claimsSpace = (t) => consumesArrows(t) || (!!t && (/^(A|BUTTON|SUMMARY)$/.test(t.tagName || '')
  || /^(button|link|checkbox|switch)$/.test(roleOf(t))));
const isScrollKey = (e) => (WEB_SCROLL_KEYS.has(e.key) && !consumesArrows(e.target))
  || ((e.key === ' ' || e.key === 'Spacebar') && !claimsSpace(e.target));
const onScrollbar = (node, e) => e.target === node && (e.offsetX >= node.clientWidth || e.offsetY >= node.clientHeight);
const WEB_USER_SCROLL_LISTENERS = {
  wheel: () => true,
  touchmove: () => true,
  keydown: (node, e) => isScrollKey(e),
};
const WEB_SCROLLBAR_PRESS = ['pointerdown', 'mousedown'];
const WEB_SCROLLBAR_RELEASE = ['pointerup', 'pointercancel', 'mouseup'];

// Returns { attach, isActive }. `attach(node)` binds the input listeners to a
// DOM node (or detaches when null); nodes without addEventListener are ignored.
// A scrollbar press holds intent until release, since dragging the thumb emits
// scroll events with no further input events on the node.
export function useWebUserScrollIntent() {
  const lastInputAt = useRef(-Infinity);
  const held = useRef(false);
  const detach = useRef(null);
  const attach = useCallback((instance) => {
    if (detach.current) { detach.current(); detach.current = null; }
    const node = instance && typeof instance.getScrollableNode === 'function' ? instance.getScrollableNode() : instance;
    if (!node || typeof node.addEventListener !== 'function') return;
    const stamp = () => { lastInputAt.current = Date.now(); };
    const bound = Object.entries(WEB_USER_SCROLL_LISTENERS).map(([name, counts]) => {
      const fn = (e) => { if (counts(node, e || {})) stamp(); };
      node.addEventListener(name, fn, { passive: true });
      return [name, fn];
    });
    const win = (node.ownerDocument && node.ownerDocument.defaultView) || node;
    const release = () => {
      held.current = false;
      stamp();
      WEB_SCROLLBAR_RELEASE.forEach((n) => win.removeEventListener(n, release));
    };
    const press = (e) => {
      if (!onScrollbar(node, e || {}) || held.current) return;
      held.current = true;
      stamp();
      WEB_SCROLLBAR_RELEASE.forEach((n) => win.addEventListener(n, release));
    };
    WEB_SCROLLBAR_PRESS.forEach((n) => node.addEventListener(n, press, { passive: true }));
    detach.current = () => {
      bound.forEach(([name, fn]) => node.removeEventListener(name, fn));
      WEB_SCROLLBAR_PRESS.forEach((n) => node.removeEventListener(n, press));
      WEB_SCROLLBAR_RELEASE.forEach((n) => win.removeEventListener(n, release));
      held.current = false;
    };
  }, []);
  const isActive = useCallback(() => held.current || Date.now() - lastInputAt.current <= WEB_USER_SCROLL_WINDOW_MS, []);
  return { attach, isActive };
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

  // `userDriven` false (programmatic jumps) only re-baselines `lastY` (and
  // reveals at the top/bottom), so the next real drag measures from where the
  // jump landed, never a stale offset.
  const onScroll = useCallback((e, userDriven = true) => {
    const n = e && e.nativeEvent;
    if (!n || !n.contentOffset) return;
    const metrics = {
      y: n.contentOffset.y,
      contentHeight: n.contentSize ? n.contentSize.height : 0,
      layoutHeight: n.layoutMeasurement ? n.layoutMeasurement.height : 0,
    };
    const next = (userDriven ? nextTabBarScrollState : nextTabBarProgrammaticState)(stateRef.current, metrics);
    const changed = next.hidden !== stateRef.current.hidden;
    stateRef.current = next;
    if (changed) setHidden(next.hidden);
  }, []);

  return { hidden, onScroll };
}
