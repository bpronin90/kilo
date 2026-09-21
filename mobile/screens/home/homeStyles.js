import { StyleSheet } from 'react-native';
import { HeroMetric } from '../../components/UI';
import { TYPOGRAPHY } from '../../theme/typography';

export const createStyles = (colors, kua = null) => StyleSheet.create({
  // Cloud sync notice.
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
    borderColor: kua ? kua.error : colors.error,
  },
  syncNoticeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  syncNoticeTitleFailed: {
    fontSize: 14,
    fontWeight: '700',
    color: kua ? kua.error : colors.error,
  },
  syncNoticeBody: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: TYPOGRAPHY['body-sm'].fontSize } : {}),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    // No fixed lineHeight: enlarged text must grow its own line box.
    marginTop: 2,
  },
  syncNoticeRetryError: {
    fontSize: 13,
    fontWeight: '600',
    color: kua ? kua.error : colors.error,
  },
  syncNoticeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    // Wraps at 320dp with enlarged text instead of squeezing both actions below the 44dp target.
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
  },
  syncNoticeAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
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
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  skeletonBar: {
    backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder,
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
  // The hero is Home's one "active" card.
  weeklyHero: {
    padding: 20,
    gap: 0,
    marginTop: 12,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.primary : undefined,
    borderWidth: kua ? 2 : undefined,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  heroHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    minWidth: 0,
  },
  heroAccentBar: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  heroSectionLabel: {
    ...(kua ? { ...TYPOGRAPHY['headline-sm'], fontSize: 13, lineHeight: 17 } : { fontSize: 12, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  heroHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  heroClassifHeaderLabel: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: 12 } : { fontSize: 11, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroInfoToggle: {
    flexShrink: 0,
    minHeight: 32,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWeekSubline: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.primary : colors.accentText,
    marginBottom: 4,
  },
  heroRecoveryNoteLabel: {
    ...(kua ? TYPOGRAPHY['body-sm'] : { fontSize: 13, fontWeight: '600' }),
    color: kua ? kua.onSurface : colors.text,
    marginTop: 2,
  },
  heroWeightRow: {
    minWidth: 0,
    marginBottom: kua ? 12 : 0,
  },
  // The two highest-frequency actions share one stable strip at every width.
  heroPrimaryActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: kua ? kua.primaryContainer : colors.subtleBg,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: kua ? 1 : 0,
    borderColor: kua ? kua.primaryContainerBorder : 'transparent',
    marginTop: 4,
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
    ...(kua ? { ...TYPOGRAPHY['body-md'], fontSize: 13 } : { fontSize: 12, fontWeight: '600' }),
    color: kua ? kua.primaryOnContainer : colors.textMuted,
    textAlign: 'center',
  },
  heroPrimaryActionDivider: {
    width: 1,
    marginVertical: 8,
    backgroundColor: kua ? kua.primaryContainerBorder : colors.cardBorder,
  },
  // Quiet Analytics handoff attached to the sparkline.
  heroInlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  heroInlineActionText: {
    ...(kua ? TYPOGRAPHY['body-sm'] : { fontSize: 13, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Body-weight block (#1112 redesign).
  heroMetricLabel: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: 12 } : { fontSize: 11, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  heroWeightValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    minWidth: 0,
  },
  heroWeightValue: {
    ...(kua ? { ...TYPOGRAPHY['metric-display'], fontSize: 32, lineHeight: 36 } : HeroMetric.hero),
    color: kua ? kua.onSurface : colors.accentText,
    flexShrink: 1,
    minWidth: 0,
  },
  heroWeightPlaceholder: {
    ...(kua ? TYPOGRAPHY['body-md'] : { fontSize: 20, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  heroWeightUnit: {
    fontFamily: kua ? TYPOGRAPHY['body-md'].fontFamily : undefined,
    fontSize: kua ? 16 : 16,
    fontWeight: kua ? undefined : '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  heroSparklineStrip: {
    marginTop: 8,
  },
  heroSparklineSublabel: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: 12 } : { fontSize: 11, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginBottom: 4,
  },
  heroSparklineChart: {
    marginBottom: 2,
  },
  // The classification trio is the hero's lead content (#1112: training leads).
  classifSection: {
    marginBottom: 12,
  },
  sectionHeaderAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
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
    ...(kua ? TYPOGRAPHY['label-sm'] : { fontSize: 12, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  classifRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
    columnGap: 16,
  },
  classifCol: {
    // Content-sized rather than fixed thirds.
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
    ...(kua ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 24, lineHeight: 28 } : { fontSize: 16, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.text,
  },
  classifLabel: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: 12 } : { fontSize: 11, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'center',
  },
  classifCaption: {
    ...(kua ? { ...TYPOGRAPHY['body-sm'], fontSize: 12 } : { fontSize: 12 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: kua ? 4 : 8,
    fontStyle: 'italic',
  },
  heroFooter: {
    alignItems: 'center',
    marginTop: 6,
  },
  insightsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  insightsLinkText: {
    ...(kua ? { ...TYPOGRAPHY['body-sm'], fontSize: 12 } : { fontSize: 12, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Recovery status card (#757).
  recoveryCard: {
    padding: 20,
    paddingTop: 12,
    gap: 4,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  recoveryLabel: {
    ...(kua ? { ...TYPOGRAPHY['headline-sm'], fontSize: 13, lineHeight: 17 } : { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }),
    color: kua ? kua.onSurface : colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recoveryWeekLabel: {
    ...(kua ? TYPOGRAPHY['label-sm'] : { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
  },
  recoveryHeroCaption: {
    ...(kua ? { ...TYPOGRAPHY['body-sm'], fontSize: 12 } : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
    marginBottom: 6,
  },
  recoveryBandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 3,
  },
  recoveryBandLabel: {
    ...(kua ? { ...TYPOGRAPHY['label-lg'], fontSize: 13, lineHeight: 18 } : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  recoveryBandCount: {
    ...(kua ? { ...TYPOGRAPHY['label-lg'], fontSize: 13, lineHeight: 18 } : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  recoveryFallbackLine: {
    ...(kua ? { ...TYPOGRAPHY['body-md'], fontSize: 15, lineHeight: 21 } : { fontSize: 16, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
    marginTop: 2,
  },
  recoveryStatsDivider: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
    paddingTop: 12,
    marginTop: 10,
  },
  recoveryStatusLine: {
    ...(kua ? { ...TYPOGRAPHY['body-sm'], fontSize: 12 } : { fontSize: 13 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
  },
  recoveryAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  recoveryActionText: {
    ...(kua ? TYPOGRAPHY['body-sm'] : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.primary : colors.accentText,
  },
  goalCard: {
    padding: 20,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  goalModeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  goalDirectionText: {
    ...(kua ? { ...TYPOGRAPHY['headline-md'], fontSize: 18, lineHeight: 24 } : { fontSize: 18, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  goalModeAccent: {
    color: kua ? kua.primary : colors.accentText,
  },
  goalWeeksText: {
    ...(kua ? { ...TYPOGRAPHY['body-sm'], fontSize: 12 } : { fontSize: 13, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  goalStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  goalStatCol: {
    flex: 1,
    gap: 4,
    alignItems: 'center',
  },
  goalStatLabel: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: 12 } : { fontSize: 11, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  goalStatValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  // Same scale as the classification counts (#1112 owner feedback).
  goalStatValueLarge: {
    ...(kua ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 24, lineHeight: 28 } : { fontSize: 30, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.text,
  },
  goalStatUnitLabel: {
    fontFamily: kua ? TYPOGRAPHY['body-md'].fontFamily : undefined,
    fontSize: kua ? 14 : 18,
    fontWeight: kua ? undefined : '700',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  oneKCard: {
    padding: 20,
    paddingTop: 12,
    gap: 2,
    alignItems: 'center',
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  oneKLabel: {
    ...(kua ? { ...TYPOGRAPHY['headline-sm'], fontSize: 13, lineHeight: 17 } : { fontSize: 12, fontWeight: '800', letterSpacing: 1 }),
    color: kua ? kua.onSurface : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: kua ? 0.5 : 1,
    flexShrink: 1,
  },
  oneKHero: {
    alignItems: 'center',
    marginBottom: 16,
  },
  oneKHeroValue: {
    ...(kua ? { ...TYPOGRAPHY['metric-display'], fontSize: 48, lineHeight: 52, letterSpacing: -0.02 * 48 } : HeroMetric.hero),
    color: kua ? kua.onSurface : colors.text,
  },
  oneKHeroUnit: {
    fontFamily: kua ? TYPOGRAPHY['body-md'].fontFamily : undefined,
    fontSize: kua ? 18 : 16,
    fontWeight: kua ? undefined : '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  oneKHeroPlaceholder: {
    ...(kua ? { ...TYPOGRAPHY['metric-display'], fontSize: 32, lineHeight: 36 } : HeroMetric.hero),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  oneKHeroCaption: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: 12 } : { fontSize: 12 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
  },
  progressBarLarge: {
    height: 8,
    backgroundColor: kua ? kua.surfaceBorder : colors.divider,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 6,
    marginBottom: 12,
    alignSelf: 'stretch',
  },
  progressFillLarge: {
    height: '100%',
    backgroundColor: kua ? kua.primary : colors.accent,
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
    borderColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  oneKGridValue: {
    ...(kua ? { ...TYPOGRAPHY['metric-display-mobile'], fontSize: 24, lineHeight: 28 } : { fontSize: 16, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  oneKGridLabel: {
    ...(kua ? { fontFamily: TYPOGRAPHY['body-sm'].fontFamily, fontSize: 12 } : { fontSize: 11, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
  },
  placeholderText: {
    fontSize: 48,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    fontWeight: '400',
  },
  emptyText: {
    ...(kua ? TYPOGRAPHY['body-md'] : { fontSize: 13, lineHeight: 18 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  welcomeCard: {
    padding: 24,
    marginTop: 12,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  welcomeHeader: {
    marginBottom: 8,
  },
  welcomeTitle: {
    ...(kua ? TYPOGRAPHY['headline-md'] : { fontSize: 22, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.text,
  },
  welcomeSubtitle: {
    ...(kua ? TYPOGRAPHY['body-md'] : { fontSize: 14, lineHeight: 20 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 6,
  },
  welcomeDivider: {
    height: 1,
    backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder,
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
    backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.8,
  },
  welcomeStepTextContainer: {
    flex: 1,
  },
  welcomeStepTitle: {
    ...(kua ? TYPOGRAPHY['body-lg'] : { fontSize: 16, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  welcomeStepDesc: {
    ...(kua ? TYPOGRAPHY['body-sm'] : { fontSize: 13, lineHeight: 18 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 4,
  },
  welcomeButton: {
    borderRadius: 14,
    paddingVertical: 12,
  },
});
