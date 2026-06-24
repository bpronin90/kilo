import React, { useContext, createContext } from 'react';
import { ScrollView, StyleSheet, Text, View, Platform, StatusBar, SafeAreaView, useWindowDimensions } from 'react-native';
import { Colors } from '../theme/colors';
import { Button } from './UI';
import pkg from '../package.json';

export const ScrollContext = createContext({ onScroll: () => {} });

// Desktop web readability cap: on wide viewports the single-column mobile
// layout stretches uncomfortably, so center the content within a fixed max
// width. Native (phone) layout is unaffected because the viewport is narrower
// than the cap.
const DESKTOP_CONTENT_MAX_WIDTH = 640;

/**
 * Shared Shell Contract:
 * - Horizontal padding: 16px (standard boundary for all screen content)
 * - Vertical gap: 16px (consistent spacing between top-level components/cards)
 * - Bottom padding: 120px (ensures content clears the absolute TabBar and bottom safe area)
 * - Top safe area: Handled via localized SafeAreaView in the headerWrapper
 */
export const ScreenShell = React.forwardRef(({ title, subtitle, headerRight, keyboardShouldPersistTaps, onScroll: propOnScroll, style, children, stickyHeaderIndices, onBack }, ref) => {
  const version = `v${pkg.version}`;
  const { onScroll: contextOnScroll } = useContext(ScrollContext);
  const { width: windowWidth } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && windowWidth > DESKTOP_CONTENT_MAX_WIDTH;
  const wideContentStyle = isWideWeb
    ? { maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' }
    : null;

  const handleScroll = (e) => {
    if (contextOnScroll) contextOnScroll(e);
    if (propOnScroll) propOnScroll(e);
  };

  return (
    <View style={[styles.outerContainer, style]}>
      {onBack && (
        <View style={styles.stickyHeader}>
          <View style={[styles.stickyHeaderInner, wideContentStyle]}>
            <Button title="← Back" onPress={onBack} style={styles.backButton} textStyle={styles.backButtonText} />
            {headerRight}
          </View>
        </View>
      )}
      <ScrollView
        ref={ref}
        style={styles.scroll}
        contentContainerStyle={[styles.container, wideContentStyle]}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        stickyHeaderIndices={stickyHeaderIndices}
      >
        <View style={styles.headerWrapper}>
          <View style={styles.header}>
            {!title && (
              <View style={styles.titleRow}>
                <Text style={styles.title}>Kilo</Text>
                <Text style={styles.version}>{version}</Text>
              </View>
            )}
            {title && (
              <View style={styles.titleRow}>
                <View style={[styles.titleGroup, typeof title === 'string' && styles.titleGroupShrink]}>
                  {typeof title === 'string' ? (
                    <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
                      {title}
                    </Text>
                  ) : (
                    title
                  )}
                </View>
                {!onBack && headerRight}
              </View>
            )}
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        </View>
        {children}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  outerContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  stickyHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
  },
  stickyHeaderInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    // WCAG 2.5.5 / mobile a11y: guarantee a >=44x44 tappable area.
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  backButtonText: {
    color: Colors.text,
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  container: {
    paddingHorizontal: 16,
    paddingBottom: 120, // Space for tab bar + safe area
    gap: 16,
  },
  headerWrapper: {
    // Spacing handled by App.js safe area cap
  },
  header: {
    paddingTop: 8,
    paddingBottom: 8,
    gap: 8, // Reduced gap from 12 to 8 for cleaner look
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center', // Changed from baseline to center for better alignment with icons/buttons
    gap: 12,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleGroupShrink: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
  },
  version: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: Colors.textMuted,
  },
});
