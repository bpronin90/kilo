import React, { useContext, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useKuaStyle, useTheme, useThemedStyles } from '../theme/ThemeContext';
import { TAB_BAR_HEIGHT_FALLBACK } from './TabBarLayout';
import { Icon } from './Icon';
import { centeredColumnInsets } from './adaptiveLayout';
import { useKuaTypography } from '../theme/typography';

// The bottom navigation is always fully opaque (#1026): no idle opacity fade.
// #1209 reverses the always-visible rule: the bar slides off-screen with a
// translateY (never an opacity fade, and never unmounted or re-laid-out) when
// `hidden` is set by scroll direction.
// Redesign v3 (#1600) docks the bar: a full-width band on the card background
// with a top hairline reaching the screen edge (and down through the bottom
// safe area), a 24dp icon over an 11px uppercase mono label, and the active tab
// marked by the primary tint plus a 2dp indicator on its top edge (replacing
// the floating rounded pill). The tabs themselves keep the #1126 content-column
// offsets, so they align with ScreenShell content on every window. Each tab
// stays a >=44dp touch target.
const TAB_ICON_SIZE = 24;
export const TAB_INDICATOR_HEIGHT = 2;

const HIDE_DURATION_MS = 180;

export function TabBar({ tabs, activeTab, onTabPress, onHeightChange, hidden = false, onAnchorChange, anchorRequest = null }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const kua = useKuaStyle();
  const typography = useKuaTypography();
  const { bottom: bottomInset = 0, left: leftInset = 0, right: rightInset = 0 } = useContext(SafeAreaInsetsContext) || {};
  // Wide windows (#1126): the tabs align with ScreenShell's centered content
  // column and clear side insets (16/16 on phone portrait); the docked band
  // behind them bleeds out to both window edges.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const column = centeredColumnInsets(windowWidth, { left: leftInset, right: rightInset });

  // Active/inactive tint from the selected court palette, falling back to the
  // legacy palette outside the production KUA gate (#1139). The active icon,
  // label and indicator take `primaryOnContainer`, the primary ink KUA
  // guarantees AA on both the canvas and the selection fill in every
  // court/mode (dark `primary` is only 4.25:1 on Hard Court's selection).
  // Inactive items sit on `tabBarBg` and take onSurfaceVariant.
  const activeColor = kua ? kua.primaryOnContainer : colors.chipText;
  const inactiveColor = kua ? kua.onSurfaceVariant : colors.textMuted;
  const labelBase = typography['label-sm'];
  // Non-colour active cue: the bold mono face at weight 700.
  const labelActive = { fontFamily: typography['metric-display'].fontFamily, fontWeight: '700' };

  // Slide distance covers the bar plus the safe-area band under it so nothing
  // peeks above the screen edge. Measured height is reported unchanged.
  const heightRef = useRef(TAB_BAR_HEIGHT_FALLBACK);
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(translateY, {
      toValue: hidden ? heightRef.current + bottomInset + TAB_INDICATOR_HEIGHT : 0,
      duration: HIDE_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [hidden, bottomInset, translateY]);

  const tabRefs = useRef({});
  const [layoutVersion, bumpLayout] = React.useReducer((n) => n + 1, 0);
  // Measure only for the walkthrough, after the existing slide has settled.
  useEffect(() => {
    if (anchorRequest === null || hidden || !onAnchorChange) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      const node = tabRefs.current[activeTab];
      node?.measureInWindow((x, y, width, height) => {
        if (live) onAnchorChange({ tab: activeTab, request: anchorRequest, x, y, width, height,
          windowWidth, windowHeight, node });
      });
    }, HIDE_DURATION_MS + 32);
    return () => { live = false; clearTimeout(timer); };
  }, [activeTab, anchorRequest, hidden, windowWidth, windowHeight, layoutVersion, onAnchorChange]);

  // The surface's own height is the tab row only: the band's extension through
  // the bottom inset is an overflow child, so the reported height (and
  // ScreenShell's clearance of height + gap + inset) never counts it twice.
  const handleLayout = (e) => {
    heightRef.current = e.nativeEvent.layout.height;
    bumpLayout();
    if (onHeightChange) onHeightChange(e.nativeEvent.layout.height);
  };

  return (
    <Animated.View
      style={[styles.container, { bottom: bottomInset, left: column.left, right: column.right, transform: [{ translateY }] }]}
      onLayout={handleLayout}
      accessibilityRole="tablist"
      // Off-screen while hidden (#1209): block touches and hide the tabs from
      // TalkBack/VoiceOver so an invisible destination can't be focused or pressed.
      pointerEvents={hidden ? 'none' : 'auto'}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={!!hidden}
    >
      {/* Docked band: card background + top hairline from window edge to edge,
          continuing under the home indicator / gesture area. */}
      <View
        testID="tab-bar-band"
        pointerEvents="none"
        style={[styles.band, { left: -column.left, right: -column.right, bottom: -bottomInset }]}
      />
      {tabs.map((tab) => {
        const active = activeTab === tab;
        const color = active ? activeColor : inactiveColor;
        return (
          <Pressable
            key={tab}
            ref={(node) => { tabRefs.current[tab] = node; }}
            onPress={() => onTabPress(tab)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={tab}
            accessibilityState={{ selected: active }}
            accessible={true}
          >
            {active ? <View testID="tab-bar-indicator" style={[styles.indicator, { backgroundColor: activeColor }]} /> : null}
            <Icon name={tab} size={TAB_ICON_SIZE} color={color} />
            <Text style={[styles.tabText, labelBase, active ? labelActive : null, { color }]} numberOfLines={1}>
              {tab}
            </Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  container: {
    position: 'absolute',
    flexDirection: 'row',
    // Tabs start below the band's 1dp hairline.
    paddingTop: 1,
  },
  band: {
    position: 'absolute',
    top: 0,
    backgroundColor: kua ? kua.tabBarBg : colors.card,
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  tab: {
    flex: 1,
    minHeight: 60,
    paddingVertical: 8,
    gap: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Covers the band's top hairline (-1) over the middle half of the tab.
  indicator: {
    position: 'absolute',
    top: -1,
    left: '24%',
    right: '24%',
    height: TAB_INDICATOR_HEIGHT,
  },
  tabText: {
    textTransform: 'uppercase',
  },
});
