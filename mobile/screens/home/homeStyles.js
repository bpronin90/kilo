import { StyleSheet } from 'react-native';
import { HeroMetric } from '../../components/UI';
import { TYPOGRAPHY } from '../../theme/typography';
import { GEOMETRY } from '../../theme/spacing';

export const createStyles = (colors, kua = null, typography = TYPOGRAPHY) => StyleSheet.create({
  // Cloud sync notice.
  syncNoticeCard: {
    padding: 16,
    gap: 8,
    backgroundColor: colors.chipBackground,
    borderColor: colors.cardBorder,
  },
  syncNoticeCardFailed: {
    padding: 16,
    gap: 8,
    backgroundColor: colors.errorSurface,
    borderColor: kua ? kua.error : colors.error,
  },
  syncNoticeTitle: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.onSurface : colors.text,
  },
  syncNoticeTitleFailed: {
    fontSize: TYPOGRAPHY['body-md'].fontSize,
    fontWeight: '700',
    color: kua ? kua.error : colors.error,
  },
  syncNoticeBody: {
    ...(kua ? { fontFamily: typography['body-sm'].fontFamily, fontSize: typography['body-sm'].fontSize } : {}),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    // No fixed lineHeight: enlarged text must grow its own line box.
    marginTop: 2,
  },
  syncNoticeRetryError: {
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
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
    fontSize: TYPOGRAPHY['body-sm'].fontSize,
    fontWeight: '700',
    color: colors.chipAccentText,
  },
  // Static first-paint placeholder bars.
  skeletonCard: {
    padding: 18,
    marginBottom: 16,
    gap: 12,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  skeletonBar: {
    backgroundColor: kua ? kua.surfaceBorder : colors.cardBorder,
    borderRadius: GEOMETRY['radius-md'],
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
    padding: 18,
    gap: 0,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.primary : undefined,
    borderWidth: kua ? 2 : undefined,
  },
  heroHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  heroAccentBar: {
    width: 3,
    height: 18,
    borderRadius: GEOMETRY['radius-xs'],
    backgroundColor: kua ? kua.primary : colors.accent,
  },
  heroSectionLabel: {
    ...(kua ? { ...typography['headline-sm'], fontSize: TYPOGRAPHY['body-sm'].fontSize, lineHeight: 17 } : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  heroInfoToggle: {
    flexShrink: 0,
    minHeight: 32,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRecoveryNoteLabel: {
    ...(kua ? typography['body-sm'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurface : colors.text,
    marginTop: 2,
  },
  // No current routine / empty routine (#1333): one plain line, no fake week.
  heroRoutineMessage: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-md'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 4,
    marginBottom: 12,
  },
  // The two highest-frequency actions share one stable strip at every width.
  heroPrimaryActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: kua ? kua.primaryContainer : colors.subtleBg,
    borderRadius: GEOMETRY['radius-xl'],
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
    ...(kua ? { ...typography['body-md'], fontSize: TYPOGRAPHY['body-sm'].fontSize } : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '600' }),
    color: kua ? kua.primaryOnContainer : colors.textMuted,
    textAlign: 'center',
  },
  heroPrimaryActionDivider: {
    width: 1,
    marginVertical: 8,
    backgroundColor: kua ? kua.primaryContainerBorder : colors.cardBorder,
  },
  // Quiet legacy-mode Analytics handoff on the Weight card.
  heroInlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 4,
  },
  heroInlineActionText: {
    ...(kua ? typography['body-sm'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  heroWeightValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    minWidth: 0,
  },
  heroWeightValue: {
    ...(kua ? { ...typography['metric-display-mobile'], fontSize: 24, lineHeight: 28 } : { fontSize: TYPOGRAPHY['headline-lg'].fontSize, fontWeight: '800' }), // display exception per #1283 foundation
    color: kua ? kua.onSurface : colors.accentText,
    flexShrink: 1,
    minWidth: 0,
  },
  heroWeightPlaceholder: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['headline-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  heroWeightUnit: {
    fontFamily: kua ? typography['body-md'].fontFamily : undefined,
    fontSize: TYPOGRAPHY['body-lg'].fontSize,
    fontWeight: kua ? undefined : '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // The classification trio is the hero's lead content (#1112: training leads).
  classifSection: {
    marginBottom: 12,
  },
  classifHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  sectionHeaderLabel: {
    flexShrink: 1,
  },
  sectionHeaderChevron: {
    flexShrink: 0,
  },
  classifSectionLabel: {
    ...(kua ? typography['label-sm'] : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '700' }),
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
  classifCount: {
    ...(kua ? { ...typography['metric-display-mobile'], fontSize: 24, lineHeight: 28 } : { fontSize: TYPOGRAPHY['body-lg'].fontSize, fontWeight: '800' }), // display exception per #1283 foundation
    color: kua ? kua.onSurface : colors.text,
  },
  classifLabel: {
    ...(kua ? { fontFamily: typography['body-sm'].fontFamily, fontSize: TYPOGRAPHY['label-md'].fontSize } : { fontSize: TYPOGRAPHY['label-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textAlign: 'center',
  },
  classifCaption: {
    ...(kua ? { ...typography['body-sm'], fontSize: TYPOGRAPHY['label-md'].fontSize } : { fontSize: TYPOGRAPHY['label-md'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: kua ? 4 : 8,
    fontStyle: 'italic',
  },
  // Recovery status card (#757).
  recoveryCard: {
    padding: 20,
    paddingTop: 12,
    gap: 4,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  // #1341: active Recovery is Home's lead card (weeklyHero), not a second card.
  // The 44dp header supplies its own top slack, so the card padding is trimmed.
  recoveryHeaderLink: {
    gap: 8, marginTop: -10,
  },
  recoveryBody: {
    gap: 14,
    marginBottom: 12,
  },
  recoveryTotalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
  },
  recoveryTotalValue: {
    ...(kua ? { ...typography['metric-display'], fontSize: 48, lineHeight: 52 } : HeroMetric.hero), // display exception per #1283 foundation
    color: kua ? kua.onSurface : colors.text,
  },
  recoveryTotalLabel: {
    ...(kua ? typography['label-md'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  recoveryLabel: {
    ...(kua ? { ...typography['headline-sm'], fontSize: TYPOGRAPHY['body-sm'].fontSize, lineHeight: 17 } : { fontSize: TYPOGRAPHY['label-md'].fontSize, fontWeight: '700', letterSpacing: 0.5 }),
    color: kua ? kua.onSurface : colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Recovery headline's at/over-baseline colour (the Big 3 rows' own styles
  // live in components/Big3Bars, #1353).
  liftValueDone: {
    color: kua ? kua.completion : colors.success,
  },
  recoveryFallbackLine: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-lg'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
    marginTop: 2,
  },
  recoveryStatusLine: {
    ...(kua ? { ...typography['body-sm'], fontSize: TYPOGRAPHY['label-md'].fontSize } : { fontSize: TYPOGRAPHY['body-sm'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 2,
  },
  recoveryAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  recoveryActionText: {
    ...(kua ? typography['body-sm'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700' }),
    color: kua ? kua.primary : colors.accentText,
  },
  // #1339: supporting card — header row, then one value/goal row.
  goalCard: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 16,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  weightSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 8,
  },
  weightTrendChart: {
    marginTop: 14,
  },
  goalSummary: {
    flexShrink: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  goalAttention: {
    marginTop: 12,
  },
  goalAttentionText: {
    ...(kua ? typography['body-sm'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.warning : colors.cautionText,
  },
  goalDirectionText: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-md'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  goalModeAccent: {
    color: kua ? kua.primary : colors.accentText,
  },
  goalWeeksText: {
    ...(kua ? { ...typography['body-sm'], fontSize: TYPOGRAPHY['label-md'].fontSize } : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // #1341: left-aligned like every other Home card; the 44dp header supplies
  // the top slack.
  oneKCard: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 20,
    gap: 2,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  oneKSetupText: {
    ...(kua ? typography['body-sm'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginBottom: 12,
  },
  oneKHeroValue: {
    ...(kua ? { ...typography['metric-display'], fontSize: 48, lineHeight: 52 } : HeroMetric.hero), // display exception per #1283 foundation
    color: kua ? kua.onSurface : colors.text,
  },
  oneKHeroUnit: {
    fontFamily: kua ? typography['body-md'].fontFamily : undefined,
    fontSize: kua ? TYPOGRAPHY['headline-sm'].fontSize : TYPOGRAPHY['body-lg'].fontSize,
    fontWeight: kua ? undefined : '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  progressBarLarge: {
    height: 8,
    backgroundColor: kua ? kua.surfaceBorder : colors.divider,
    borderRadius: GEOMETRY['radius-sm'],
    overflow: 'hidden',
    marginTop: 8,
    marginBottom: 18,
    alignSelf: 'stretch',
  },
  progressFillLarge: {
    height: '100%',
    backgroundColor: kua ? kua.primary : colors.accent,
    borderRadius: GEOMETRY['radius-sm'],
  },
  welcomeCard: {
    padding: 18,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  welcomeTitle: {
    ...(kua ? typography['headline-md'] : { fontSize: TYPOGRAPHY['headline-md'].fontSize, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.text,
  },
  welcomeSubtitle: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-md'].fontSize, lineHeight: 20 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    marginTop: 6,
  },
  welcomeActions: {
    gap: 12,
    marginTop: 16,
  },
  welcomeButton: {
    borderRadius: GEOMETRY['radius-xl'],
    paddingVertical: 12,
  },
});
