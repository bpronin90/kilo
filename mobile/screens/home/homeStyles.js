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
  skeletonStack: {
    gap: 16,
  },
  skeletonCard: {
    padding: 16,
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
  // Redesign v3 (#1605) Home header: wordmark + Cloud Sync icon over a hairline.
  topBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    backgroundColor: kua ? kua.background : colors.background,
    borderBottomWidth: 1,
    borderBottomColor: kua ? kua.surfaceBorder : colors.cardBorder,
  },
  topBarMark: {
    paddingLeft: 8,
    justifyContent: 'center',
  },
  topBarAction: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The active panel's padded column (prototype `.pad`: 16dp, 12dp rhythm).
  heroPad: {
    padding: 16,
    gap: 12,
  },
  heroTitleText: {
    fontFamily: typography['headline-xl-mobile'].fontFamily,
    fontWeight: typography['headline-xl-mobile'].fontWeight,
    fontSize: 22,
    lineHeight: 28,
    color: kua ? kua.onSurface : colors.text,
    marginTop: -4,
  },
  // No current routine / empty routine (#1333): one plain line, no fake week.
  heroRoutineMessage: {
    ...(kua ? typography['body-lg'] : { fontSize: TYPOGRAPHY['body-md'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  heroProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 48,
  },
  heroProgressText: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  heroProgressLabel: {
    color: kua ? kua.onSurface : colors.text,
  },
  heroBaselineText: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-md'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // The two daily-loop actions: filled primary + outlined secondary, one row.
  heroPrimaryActions: {
    flexDirection: 'row',
    gap: 10,
  },
  heroButton: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: GEOMETRY['radius-lg'],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  heroButtonPrimary: {
    backgroundColor: kua ? kua.primary : colors.text,
  },
  heroButtonGhost: {
    borderWidth: 1,
    borderColor: kua ? kua.primary : colors.cardBorder,
  },
  heroButtonText: {
    ...typography['label-lg'],
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.78,
    textTransform: 'uppercase',
    flexShrink: 1,
    textAlign: 'center',
  },
  heroButtonPrimaryText: {
    color: kua ? kua.onPrimary : colors.buttonLabel,
  },
  heroButtonGhostText: {
    color: kua ? kua.primaryOnContainer : colors.chipText,
  },
  // Supporting panels (1K, Body weight): a 48dp header row — title link left,
  // muted caption right — then the body.
  panelHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
  },
  panelTitleLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 1,
  },
  panelTitle: {
    ...typography['label-lg'],
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: kua ? kua.onSurface : colors.text,
  },
  panelCaption: {
    ...typography['body-sm'],
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    flexShrink: 1,
  },
  weightBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
  },
  weightValueBlock: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  weightSparkline: {
    width: 120,
    flexShrink: 0,
  },
  heroWeightValueRow: {
    minWidth: 0,
  },
  heroWeightValue: {
    ...(kua ? typography['metric-display-mobile'] : { fontSize: TYPOGRAPHY['headline-lg'].fontSize, fontWeight: '800' }),
    color: kua ? kua.onSurface : colors.text,
  },
  heroWeightUnit: {
    ...(kua ? typography['label-lg'] : { fontSize: TYPOGRAPHY['body-md'].fontSize }),
    letterSpacing: 0,
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  heroWeightPlaceholder: {
    ...(kua ? typography['body-lg'] : { fontSize: TYPOGRAPHY['body-lg'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  goalDirectionText: {
    ...(kua ? typography['body-sm'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // An ended goal is a caution to act on (#1112).
  goalEndedText: {
    color: kua ? kua.warning : colors.cautionText,
  },
  goalAttention: {
    borderTopWidth: 1,
    borderTopColor: kua ? kua.surfaceBorder : colors.cardBorder,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  goalAttentionText: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.warning : colors.cautionText,
  },
  recoveryAction: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  recoveryActionText: {
    ...(kua ? typography['label-lg'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '700' }),
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: kua ? kua.primaryOnContainer : colors.accentText,
  },
  // Recovery (#757, #1341): status panel, or the active panel replacing the hero.
  recoveryStatusBlock: {
    gap: 6,
  },
  recoveryLabel: {
    color: kua ? kua.onSurface : colors.text,
  },
  recoveryHeaderLink: {
    minHeight: 44,
    marginVertical: -6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  recoveryHeaderLabel: {
    flex: 1,
    minWidth: 0,
  },
  recoveryEvidence: {
    ...typography['label-lg'],
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: kua ? kua.primaryOnContainer : colors.chipText,
  },
  recoveryBody: {
    gap: 14,
  },
  recoveryTotalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
  },
  recoveryTotalValue: {
    ...(kua ? { ...typography['metric-display'], fontSize: 44, lineHeight: 46 } : HeroMetric.hero), // one 44px hero number per screen (#1605)
    color: kua ? kua.onSurface : colors.text,
  },
  recoveryTotalLabel: {
    ...(kua ? typography['body-sm'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Recovery headline's at/over-baseline colour (Big 3 rows: components/Big3Bars, #1353).
  liftValueDone: {
    color: kua ? kua.completion : colors.success,
  },
  recoveryFallbackLine: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-lg'].fontSize, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  recoveryStatusLine: {
    ...(kua ? typography['body-md'] : { fontSize: TYPOGRAPHY['body-sm'].fontSize }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  welcomeCard: {
    padding: 16,
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
