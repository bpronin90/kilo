import { createContext } from 'react';

// Shared visual gap between the floating TabBar and the screen bottom edge.
// TabBar uses it for its own bottom offset (not its height); ScreenShell adds
// it on top of the measured bar height for scroll clearance (#551).
export const TAB_BAR_VISUAL_GAP = 24;

// Approximate rendered TabBar height, used only until TabBar's own onLayout
// measurement lands so ScreenShell has sufficient clearance before that
// first measurement without visibly jumping once it arrives.
export const TAB_BAR_HEIGHT_FALLBACK = 64;

// Owned by App.js, which measures TabBar via onLayout and provides the real
// height to every ScreenShell so scroll clearance tracks the rendered bar.
export const TabBarLayoutContext = createContext({
  tabBarHeight: TAB_BAR_HEIGHT_FALLBACK,
});
