import { StyleSheet } from 'react-native';
import { HeroMetric } from '../../components/UI';
import { TYPOGRAPHY } from '../../theme/typography';

export const createStyles = (colors, kua = null) => StyleSheet.create({
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
  // The hero is Home's one "active" card. KUA level-2 treatment (foundation.md
  // §borders): a 2px primary border marks it as the primary/focused surface,
  // the same signal the Log routine card uses — so Home reads as the same
  // design system rather than a stack of generic panels.
  weeklyHero: {
    padding: 20,
    gap: 0,
    marginTop: 12,
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.primary : undefined,
    borderWidth: kua ? 2 : undefined,
  },
  // Section-header row for the hero (#1112 redesign): a short primary accent
  // bar + uppercase section label on the left, the week identity on the right.
  // The accent bar is the KUA structural motif carried onto Home.
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
  // Right side of the hero header: the "Exercise Progress" label for the
  // classification trio, sitting across from the week with the info toggle
  // next to it (#1112 owner feedback).
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
  // Header-right info toggle for the classification caption (#1112 owner
  // feedback): the "ⓘ" no longer owns a dedicated row — it lives in the space
  // the redundant week label used to occupy.
  heroInfoToggle: {
    flexShrink: 0,
    minHeight: 32,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Recovery sub-line under the "Recovery" header: the week number or
  // between-weeks state, in the theme primary so it reads as the live accent.
  heroWeekSubline: {
    ...(kua ? TYPOGRAPHY['label-lg'] : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.primary : colors.accentText,
    marginBottom: 4,
  },
  // The active Recovery note's own title, named directly under the eyebrow so
  // "what is current" answers both the week number and which note that is.
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
  // In KUA mode it takes the tinted primary-container treatment (the same
  // family as the Log TRACK button), so the daily loops read as inviting,
  // tappable surfaces rather than the near-invisible gray bar they were.
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
    ...(kua ? TYPOGRAPHY['body-sm'] : { fontSize: 13, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Body-weight block (#1112 redesign). On a screen titled "current routine
  // progress" body weight is a supporting metric, not the headline: it sits
  // below the training pulse and its own action, grouped with the trend it
  // belongs to. Small uppercase label over a metric value.
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
  // The no-data hero is a short muted sentence, not a hero-sized dash: at hero
  // scale a lone glyph left a visible hole in the card's dominant slot.
  heroWeightPlaceholder: {
    ...(kua ? TYPOGRAPHY['body-md'] : { fontSize: 20, fontWeight: '600' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Explicit Space Grotesk family: a unit ("lb"/"kg") is linguistic, not a
  // metric, and a nested Text inherits its parent value's JetBrains Mono
  // otherwise — which rendered "lb" as a mangled mono ligature (#1112).
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
  // A taller chart so the trend does not read as a squished wide band and the
  // built-in date axis is not crowded against the line (#1112 owner feedback).
  heroSparklineChart: {
    marginBottom: 2,
  },
  // The classification trio is the hero's lead content (#1112: training leads).
  // It sits directly under the header with no top rule, so the week's training
  // pulse is the first thing read, above the actions and the body-weight trend.
  classifSection: {
    marginBottom: 12,
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
    ...(kua ? TYPOGRAPHY['label-sm'] : { fontSize: 12, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.text,
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
  // Promoted to the full metric-display scale (#1112 owner feedback): as the
  // hero's lead figures the counts are the dominant numbers on the card,
  // tinted per bucket in JSX.
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
  // Recovery status card (#757). Same padding as the other tiers; the label
  // reuses the uppercase section treatment already used by the Exercise
  // Progress and 1K headers, so the handoff reads as one of that family.
  // Top padding and gap trimmed from the 24/8 default (#820): the header row
  // is still a full 44dp target, so the fix for the dead space it left above
  // the week eyebrow is tightening the space around it, not the target itself.
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
  // #803: the card is read as analytics, not as prose — a week eyebrow, one
  // hero result, then supporting count tiles. Sizes follow the analytics
  // hierarchy already established for cards (ui-design-rules §8): one hero,
  // supporting values at 18/700 over an 11/600 uppercase muted label.
  recoveryWeekLabel: {
    ...(kua ? TYPOGRAPHY['label-sm'] : { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
    textTransform: 'uppercase',
  },
  // #1029: the denominator caption ("N of Y roster exercises trained") sits
  // at the SAME weight tier as the bucket rows below it — it is a fact of
  // equal standing, not a subordinate footnote (acceptance criterion 1/12).
  recoveryHeroCaption: {
    ...(kua ? { ...TYPOGRAPHY['body-sm'], fontSize: 12 } : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
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
    ...(kua ? { ...TYPOGRAPHY['label-lg'], fontSize: 13, lineHeight: 18 } : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  recoveryBandCount: {
    ...(kua ? { ...TYPOGRAPHY['label-lg'], fontSize: 13, lineHeight: 18 } : { fontSize: 13, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
  },
  // The fallbacks are sentences, not figures: they take the hero's slot at
  // reading weight rather than being dressed up as a metric.
  recoveryFallbackLine: {
    ...(kua ? { ...TYPOGRAPHY['body-md'], fontSize: 15, lineHeight: 21 } : { fontSize: 16, fontWeight: '700' }),
    color: kua ? kua.onSurface : colors.text,
    marginTop: 2,
  },
  // Category breakdown (#820): reuses the Exercise Progress band's own
  // dot/count/label column grammar instead of a bespoke tile system, so the
  // two summary rows in this hero card read as one visual language.
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
  // The two goal stats read as the same visual language as the classification
  // trio (#1112 owner feedback): centered columns spanning the card, not edge-
  // pinned values with a gulf between them.
  goalStatCol: {
    flex: 1,
    gap: 4,
    alignItems: 'center',
  },
  // Same treatment as the "Exercise Progress" header label (#1112 owner
  // feedback): uppercase, tracked, muted.
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
  // Top padding and gap trimmed from the 24/10 default (#820): the header
  // row is still a full 44dp target, so the fix for the dead space it left
  // above the hero total is tightening the space around it, not the target.
  oneKCard: {
    padding: 20,
    paddingTop: 12,
    gap: 2,
    alignItems: 'center',
    backgroundColor: kua ? kua.surfaceCard : undefined,
    borderColor: kua ? kua.surfaceBorder : undefined,
  },
  // Same size as the hero's WEEK header so the card titles read as one family
  // (#1112 owner feedback: match the others where applicable).
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
  // Restored to the accepted pre-regression scale (#771): the #763 compact-
  // summary override read as a visual demotion of the 1K total, so this
  // spreads HeroMetric.hero (48/900) the same as the Analytics owner card.
  // In KUA mode, 32px JBM Bold — metric-display-mobile base with +4px bump
  // so the total reads as the dominant figure in the card.
  // The 1K total is Home's flagship figure (#1112 owner feedback): spread the
  // metric-display token but scaled well past it so the number dominates its
  // card the way the signature "1K" metric should.
  oneKHeroValue: {
    ...(kua ? { ...TYPOGRAPHY['metric-display'], fontSize: 48, lineHeight: 52, letterSpacing: -0.02 * 48 } : HeroMetric.hero),
    color: kua ? kua.onSurface : colors.text,
  },
  // Explicit Space Grotesk: the unit suffix is nested inside the JetBrains Mono
  // hero value and would otherwise inherit the mono family and render "lb" as a
  // mangled ligature (#1112). Sized against the enlarged total.
  oneKHeroUnit: {
    fontFamily: kua ? TYPOGRAPHY['body-md'].fontFamily : undefined,
    fontSize: kua ? 18 : 16,
    fontWeight: kua ? undefined : '600',
    color: kua ? kua.onSurfaceVariant : colors.textMuted,
  },
  // Muted hero placeholder for the untracked 1K total: a plain em-dash at hero
  // scale in the muted ink, never the lerp-tinted value color that made "—"
  // read as a stray colored mark (#1112).
  // The untracked placeholder is smaller than the real total so the empty
  // state is not a tall box holding a lone em-dash (#1112 owner feedback: dead
  // space).
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
  // Track color, radius, and vertical rhythm match the Analytics 1K progress
  // bar (#763) — the bar reads as the same control on both surfaces, and since
  // #771 so does the hero value itself (see design-system-map.md).
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
  // Weight and case match the Analytics breakdown item (#763); fontSize
  // stays smaller here because Home is the compact summary, not the owner.
  // Same scale as the classification / goal metric values (#1112 owner feedback).
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
