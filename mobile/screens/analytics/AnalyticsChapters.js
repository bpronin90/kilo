import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SectionTitle } from '../../components/UI';
import { Panel, HairlineRow } from '../../components/ui/RedesignPrimitives';
import { useThemedStyles } from '../../theme/ThemeContext';
import { useKuaTypography } from '../../theme/typography';

// Analytics chapters (redesign v3, #1602; docs/design/app-redesign-v3 "Analytics").
// Presentation only: the chapter index, the numbered chapter headers and the
// Recovery chapter's navigation entries. Scroll, measurement and scroll-spy
// live in useAnalyticsChapterNavigation.

// Chapter ids in reading order. Normal training reads Progress → Training →
// Bodyweight → Recovery; active Recovery puts Recovery first and gathers the
// paused baseline chapters under one Paused chapter (#871).
export const NORMAL_CHAPTERS = [
  { id: 'progress', number: '01', title: 'Progress', label: 'PROGRESS' },
  { id: 'training', number: '02', title: 'Training', label: 'TRAINING' },
  { id: 'bodyweight', number: '03', title: 'Bodyweight', label: 'BODYWEIGHT' },
  { id: 'recovery', number: '04', title: 'Recovery', label: 'RECOVERY' },
];
export const ACTIVE_RECOVERY_CHAPTERS = [
  { id: 'recovery', number: '01', title: 'Recovery', label: 'RECOVERY', tag: 'Active' },
  { id: 'bodyweight', number: '02', title: 'Bodyweight', label: 'BODYWEIGHT' },
  { id: 'baseline', number: '03', title: 'Baseline training', label: 'PAUSED', tag: 'Paused' },
];

// Sticky chapter index under the root header. Four (or three) equal-width
// items that always fit the column, so the active item is always in view; the
// active one carries the underline plus selected/aria-current state.
export function ChapterIndex({ chapters, activeId, onSelect }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  return (
    <View testID="analytics-chapter-index" style={styles.index} accessibilityRole="tablist" accessibilityLabel="Analytics chapters">
      {chapters.map((chapter) => {
        const on = chapter.id === activeId;
        return (
          <Pressable
            key={chapter.id}
            testID={`analytics-chapter-index-${chapter.id}`}
            onPress={() => onSelect(chapter.id)}
            accessibilityRole="tab"
            accessibilityLabel={chapter.title === 'Baseline training' ? 'Paused baseline training' : chapter.title}
            accessibilityState={{ selected: on }}
            aria-current={on ? 'true' : undefined}
            style={styles.indexItem}
          >
            <Text
              style={[typography['label-md'], styles.indexLabel, on ? styles.indexLabelOn : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {chapter.label}
            </Text>
            {on ? <View style={styles.indexUnderline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// Chapter header: mono number, 22px title, hairline rule, optional state tag.
// No intro paragraph. `onLayout` feeds the chapter offset used by the index.
export function ChapterHeader({ chapter, onLayout }) {
  const styles = useThemedStyles(createStyles);
  const typography = useKuaTypography();
  const display = typography['headline-xl-mobile'];
  return (
    <View key={`chapter-${chapter.id}`} testID={`analytics-chapter-${chapter.id}`} style={styles.chapter} onLayout={onLayout}>
      <Text style={[typography['label-md'], styles.chapterNumber]}>{chapter.number}</Text>
      <Text
        style={[styles.chapterTitle, { fontFamily: display.fontFamily, fontWeight: display.fontWeight }]}
        accessibilityRole="header"
        numberOfLines={1}
      >
        {chapter.title}
      </Text>
      <View style={styles.chapterRule} />
      {chapter.tag ? (
        <View style={[styles.tag, chapter.tag === 'Active' ? styles.tagActive : styles.tagPaused]}>
          <Text style={[typography['label-sm'], styles.tagText, chapter.tag === 'Active' ? styles.tagTextActive : null]}>
            {chapter.tag.toUpperCase()}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// Recovery chapter entries (#1602). Active Recovery adds "Manage recovery in
// Log" for the active block (the typed `recovery-manage` intent); both modes
// end with the Recovery history row, which opens Log's Recovery view. The
// count is the verified snapshot's completed blocks only — an unverified read
// names the destination without a number rather than fabricating one.
export function RecoveryChapterEntries({ activeBlockId, completedCount, ready, onNavigate }) {
  const styles = useThemedStyles(createStyles);
  const go = (target) => { if (onNavigate) onNavigate('Log', target); };
  let historyTitle = 'Recovery management';
  if (ready) {
    historyTitle = completedCount > 0
      ? `${completedCount} completed ${completedCount === 1 ? 'block' : 'blocks'}`
      : 'No completed recovery blocks yet';
  }
  return (
    <View style={styles.entries}>
      {activeBlockId ? (
        <Panel>
          <HairlineRow
            testID="analytics-recovery-manage"
            icon="tune"
            title="Manage recovery in Log"
            onPress={() => go({ kind: 'recovery-manage', blockId: activeBlockId })}
          />
        </Panel>
      ) : null}
      <SectionTitle>Recovery history</SectionTitle>
      <Panel>
        <HairlineRow
          testID="analytics-recovery-history-entry"
          icon="history"
          title={historyTitle}
          subtitle="Opens Recovery management"
          onPress={() => go({ kind: 'recovery-note', noteId: null })}
        />
      </Panel>
    </View>
  );
}

const createStyles = (colors, kua = null) => StyleSheet.create({
  index: {
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
    backgroundColor: kua ? kua.background : colors.background,
  },
  indexItem: {
    flex: 1,
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexLabel: {
    fontWeight: '600',
    letterSpacing: 0.5,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  indexLabelOn: {
    color: kua ? kua.onSurface : colors.text,
  },
  indexUnderline: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: -1,
    height: 2,
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  chapter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    paddingHorizontal: 2,
  },
  chapterNumber: {
    fontWeight: '600',
    color: kua ? kua.primary : colors.accent,
  },
  chapterTitle: {
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.22,
    flexShrink: 1,
    color: kua ? kua.onSurface : colors.text,
  },
  chapterRule: {
    flex: 1,
    minWidth: 12,
    height: 1,
    backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  tag: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagActive: {
    backgroundColor: kua ? kua.primaryContainer : colors.chipBackground,
    borderColor: kua ? kua.primaryContainerBorder : colors.cardBorder,
  },
  tagPaused: {
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  tagText: {
    fontWeight: '600',
    letterSpacing: 0.9,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  tagTextActive: {
    color: kua ? kua.primaryOnContainer : colors.text,
  },
  entries: {
    gap: 12,
  },
});
