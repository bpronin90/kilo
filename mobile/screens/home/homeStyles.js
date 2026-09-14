import { StyleSheet } from 'react-native';
import { HeroMetric } from '../../components/UI';

export const createStyles = (colors) => StyleSheet.create({
  // Cloud sync notice. The queued state is informational, so it uses the same
  // quiet chip tone as the shell's update banner; only a real failure takes the
  // error surface.
  syncNoticeCard: {
    padding: 16,
    marginTop: 12,
    gap: 8,
    backgroundColor: colors.chipBackground,
    borderColor: colors.cardBorder,
  },
  syncNoticeCardFailed: {
    padding: 16,
    marginTop: 12,
    gap: 8,
    backgroundColor: colors.errorSurface,
    borderColor: colors.error,
  },
  syncNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  syncNoticeTitleFailed: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.error,
  },
  syncNoticeBody: {
    fontSize: 13,
    color: colors.textMuted,
    // No fixed lineHeight: enlarged text must grow its own line box.
    marginTop: 2,
  },
  syncNoticeRetryError: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },
  syncNoticeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps at 320dp with enlarged text instead of squeezing both actions
    // below the 44dp target.
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
  },
  syncNoticeAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  // Dual-surface (#923): the same label renders on `syncNoticeCard`'s
  // `chipBackground` and on `syncNoticeCardFailed`'s `errorSurface`.
  // `chipAccentText` clears AA on both in both modes (5.00/6.31 on the chip,
  // 5.78/10.03 on the error surface), so one ink serves both states.
  syncNoticeActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
  // Static first-paint placeholder bars.
  skeletonCard: {
    padding: 24,
    marginTop: 12,
    gap: 12,
  },
  skeletonBar: {
    backgroundColor: colors.cardBorder,
    borderRadius: 6,
    opacity: 0.6,
  },
  skeletonBarShort: {
    height: 12,
    width: '35%',
  },
  skeletonBarHero: {
    height: 36,
    width: '60%',
  },
  skeletonBarFull: {
    height: 12,
    width: '100%',
  },
  skeletonBarWide: {
    height: 12,
    width: '75%',
  },
  weeklyHero: {
    padding: 24,
    gap: 0,
    marginTop: 12,
  },
  heroWeekRow: {
    marginBottom: 4,
  },
  heroWeekLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    flexShrink: 1,
  },
  // Active-Recovery eyebrow (#869): accent-colored so the hero visibly
  // announces Recovery rather than reading as an ordinary baseline week.
  heroWeekLabelRecovery: {
    color: colors.accentText,
  },
  // The active Recovery note's own title, named directly under the eyebrow so
  // "what is current" answers both the week number and which note that is.
  heroRecoveryNoteLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
  },
  heroWeightRow: {
    minWidth: 0,
  },
  // The two highest-frequency actions share one stable strip at every width,
  // keeping them visually distinct from the surrounding summary and Analytics
  // handoffs while preserving the single hero metric.
  heroPrimaryActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.subtleBg,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 8,
  },
  heroPrimaryAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  heroPrimaryActionText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },
  heroPrimaryActionDivider: {
    width: 1,
    marginVertical: 8,
    backgroundColor: colors.cardBorder,
  },
  // Quiet Analytics handoff attached to the sparkline. 44pt minimum target per
  // the mobile touch-target rule, kept visually quiet so the hero metric remains
  // the only dominant element (§8).
  heroInlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  heroInlineActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  heroWeightValue: {
    ...HeroMetric.hero,
    color: colors.accentText,
    // Allow the value to give up width inside the row so an enlarged metric on a
    // 320dp screen stays inside the card instead of painting past its edge.
    flexShrink: 1,
    minWidth: 0,
  },
  // The no-data hero is a short muted sentence, not a hero-sized dash: at hero
  // scale a lone glyph left a visible hole in the card's dominant slot.
  heroWeightPlaceholder: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.textMuted,
  },
  heroWeightUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  heroSparklineStrip: {
    marginTop: 4,
    marginBottom: 12,
  },
  heroSparklineSublabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    marginBottom: 2,
  },
  classifSection: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 16,
    marginBottom: 16,
  },
  // Shared affordance for the two strength destinations (Exercise Progress and
  // 1K Progress): the section label plus the same plain chevron that
  // `Full history and insights` already uses on this screen. No fill and no
  // border — a filled pill read as noisy, and no chevron at all read as not
  // pressable. The row itself is the press target, so the metrics beneath stay
  // untappable.
  sectionHeaderAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    // No wrap and no space-between: as independent flex children on a wrapping
    // full-width row, the chevron orphaned onto its own line at 320px with
    // enlarged text. Kept adjacent like `Full history and insights ›`, the row
    // hugs its content and the label absorbs narrow widths by wrapping itself.
    maxWidth: '100%',
  },
  sectionHeaderActionStart: {
    alignSelf: 'flex-start',
  },
  sectionHeaderActionCenter: {
    alignSelf: 'center',
  },
  sectionHeaderLabel: {
    flexShrink: 1,
  },
  sectionHeaderChevron: {
    flexShrink: 0,
  },
  classifSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  classifRow: {
    flexDirection: 'row',
    // At 320dp with an enlarged text setting, `Progressing` / `Regressing` are
    // single words wider than a one-third column, so fixed thirds made the three
    // labels collide. Wrapping lets a column drop to the next line instead
    // (verified by rendered capture at 320/375/448dp, #717 review round 2).
    flexWrap: 'wrap',
    rowGap: 12,
    // Content-sized columns with no gap could exactly fill the row, so at 375px
    // with enlarged text the three labels touched and read as one continuous
    // string. A real horizontal gap both separates them when they fit and forces
    // the wrap one column earlier when they no longer do.
    columnGap: 16,
  },
  classifCol: {
    // Content-sized rather than fixed thirds. A static basis cannot tell default
    // text from enlarged text: sized for the large case it wrapped at default
    // 375dp, sized for the default case the enlarged label overran its column.
    // Sizing to content keeps all three on one row whenever they fit and wraps
    // only when they genuinely do not (verified by rendered capture).
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    alignItems: 'center',
    gap: 5,
  },
  classifDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  classifCount: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  classifLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
    // No fixed lineHeight: a scaled-up label must grow its own line box rather
    // than overflow a 14px one.
  },
  classifCaption: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
    fontStyle: 'italic',
  },
  heroFooter: {
    alignItems: 'center',
    marginTop: 12,
  },
  insightsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  insightsLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // Recovery status card (#757). Same padding as the other tiers; the label
  // reuses the uppercase section treatment already used by the Exercise
  // Progress and 1K headers, so the handoff reads as one of that family.
  // Top padding and gap trimmed from the 24/8 default (#820): the header row
  // is still a full 44dp target, so the fix for the dead space it left above
  // the week eyebrow is tightening the space around it, not the target itself.
  recoveryCard: {
    padding: 24,
    paddingTop: 14,
    gap: 4,
  },
  recoveryLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // #803: the card is read as analytics, not as prose — a week eyebrow, one
  // hero result, then supporting count tiles. Sizes follow the analytics
  // hierarchy already established for cards (ui-design-rules §8): one hero,
  // supporting values at 18/700 over an 11/600 uppercase muted label.
  recoveryWeekLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // #1029: the denominator caption ("N of Y roster exercises trained") sits
  // at the SAME weight tier as the bucket rows below it — it is a fact of
  // equal standing, not a subordinate footnote (acceptance criterion 1/12).
  recoveryHeroCaption: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 6,
  },
  // One proportional row per trained performance bucket (#1029), sized
  // against the trained total rather than the roster — never a stacked
  // six-way strip, which would spend most of its pixels on the one bucket
  // (`Not trained yet`) that must never read as a failure.
  recoveryBandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  recoveryBandLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  recoveryBandCount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  // The fallbacks are sentences, not figures: they take the hero's slot at
  // reading weight rather than being dressed up as a metric.
  recoveryFallbackLine: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginTop: 2,
  },
  // Category breakdown (#820): reuses the Exercise Progress band's own
  // dot/count/label column grammar instead of a bespoke tile system, so the
  // two summary rows in this hero card read as one visual language.
  recoveryStatsDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: 14,
    marginTop: 12,
  },
  recoveryStatusLine: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  recoveryAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  recoveryActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentText,
  },
  goalCard: {
    padding: 24,
  },
  goalModeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  goalDirectionText: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  goalModeAccent: {
    color: colors.accentText,
  },
  goalWeeksText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  goalStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  goalStatCol: {
    flex: 1,
    gap: 4,
  },
  goalStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  goalStatValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  goalStatValueLarge: {
    fontSize: 30,
    fontWeight: '800',
    color: colors.text,
  },
  goalStatUnitLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textMuted,
  },
  // Top padding and gap trimmed from the 24/10 default (#820): the header
  // row is still a full 44dp target, so the fix for the dead space it left
  // above the hero total is tightening the space around it, not the target.
  oneKCard: {
    padding: 24,
    paddingTop: 14,
    gap: 6,
    alignItems: 'center',
  },
  oneKLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    flexShrink: 1,
  },
  oneKHero: {
    alignItems: 'center',
    marginBottom: 16,
  },
  // Restored to the accepted pre-regression scale (#771): the #763 compact-
  // summary override read as a visual demotion of the 1K total, so this
  // spreads HeroMetric.hero (48/900) the same as the Analytics owner card.
  oneKHeroValue: {
    ...HeroMetric.hero,
    color: colors.text,
  },
  oneKHeroUnit: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textMuted,
  },
  // Track color, radius, and vertical rhythm match the Analytics 1K progress
  // bar (#763) — the bar reads as the same control on both surfaces, and since
  // #771 so does the hero value itself (see design-system-map.md).
  progressBarLarge: {
    height: 8,
    backgroundColor: colors.divider,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 16,
    alignSelf: 'stretch',
  },
  progressFillLarge: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: 4,
  },
  oneKGrid: {
    flexDirection: 'row',
    alignSelf: 'stretch',
  },
  oneKGridItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  oneKGridItemBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.cardBorder,
  },
  // Weight and case match the Analytics breakdown item (#763); fontSize
  // stays smaller here because Home is the compact summary, not the owner.
  oneKGridValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  oneKGridLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  placeholderText: {
    fontSize: 48,
    color: colors.textMuted,
    fontWeight: '400',
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    fontStyle: 'italic',
  },
  welcomeCard: {
    padding: 24,
    marginTop: 12,
  },
  welcomeHeader: {
    marginBottom: 8,
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
  },
  welcomeSubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginTop: 6,
  },
  welcomeDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 16,
  },
  welcomeStep: {
    marginBottom: 20,
  },
  welcomeStepHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  welcomeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
  },
  welcomeStepTextContainer: {
    flex: 1,
  },
  welcomeStepTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  welcomeStepDesc: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  welcomeButton: {
    borderRadius: 14,
    paddingVertical: 12,
  },
});
