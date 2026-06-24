export const Colors = {
  background: '#f4efe5',
  card: '#fffaf2',
  cardBorder: '#e3d7c5',
  accent: '#d98d42',
  text: '#1f1a17',
  textMuted: '#5d564f',
  textLight: '#f7f1e8',
  tabBarBackground: '#201914',
  tabInactive: '#cbb9a5',
  inputBackground: '#ffffff',
  inputBorder: '#d9cdbf',
  chipBackground: '#f0d8bb',
  chipText: '#96571c',
  success: '#4a7c44',
  error: '#b03a2e',
  caution: '#d4a017',
  // Darkened tone backgrounds used only for filled success/caution tone cards
  // (UI.js Card/StatCard), tuned so the existing light card text (textLight
  // #f7f1e8) meets WCAG AA 4.5:1. These are intentionally separate from the
  // palette tones above so SessionGauge meter segments, badges, and other
  // direct users of success/caution are not visually changed. Resulting card
  // contrast (textLight on bg): success #3a6035 -> 6.44:1, caution #7f6310 -> 5.06:1.
  cardSuccessBg: '#3a6035',
  cardCautionBg: '#7f6310',
  divider: 'rgba(31, 26, 23, 0.05)',
  subtleBg: 'rgba(31, 26, 23, 0.02)',
  panelBackground: '#ffffff',
  roughBackground: '#fff0e8',
  roughBorder: '#e8c4a0',
};
