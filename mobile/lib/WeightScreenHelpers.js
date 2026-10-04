import { formatDelta, formatPaceElapsed } from './format';
import { displayWeight } from './units';
import { paceDirection, weightDirection, weightDirectionCue } from './data/derivedAnalytics';

export function localDateToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatTrendValue(value, unit = 'lb') {
  return value !== null ? `${displayWeight(value, unit).toFixed(1)} ${unit}` : '-';
}

export function formatTrendDeltaValue(currentValue, priorValue, unit = 'lb') {
  return currentValue !== null && priorValue !== null
    ? formatDelta(displayWeight(currentValue - priorValue, unit))
    : '-';
}

// Direction and cue come from the shared derived-analytics layer (#1242).
export function formatTrendCue(currentValue, priorValue) {
  return weightDirectionCue(weightDirection(currentValue, priorValue));
}

export function buildTrendSections(trends, paceInfo, unit = 'lb') {
  const paceLevel = paceInfo ? paceInfo.level : null;
  // The elapsed span rides as its own caption, not concatenated into the value:
  // the Today trend column is narrow and single-line, so a joined string would
  // tail-ellipsize the period away and defeat the point of showing it.
  const paceDir = paceDirection(trends.paceFlag);
  const paceValue = weightDirectionCue(paceDir);
  const paceCaption = trends.paceFlag ? formatPaceElapsed(paceInfo?.elapsedDays) : null;
  return [
    {
      // The Today row compares the two most recent distinct local-date averages —
      // the same pair the pace cue is classified from — so a day with multiple
      // weigh-ins can't show a raw intra-day delta next to a date-averaged pace
      // direction. Single-reading dates make these equal to the raw values.
      title: 'Today',
      col1: { label: 'Current', value: formatTrendValue(trends.recentDateWeight, unit) },
      col2: { label: 'Vs Previous', value: formatTrendDeltaValue(trends.recentDateWeight, trends.priorDateWeight, unit) },
      col3: { label: 'Trend', value: paceValue, caption: paceCaption },
      direction: paceDir,
      paceLevel,
    },
    {
      title: '7-day rolling',
      col1: { label: 'Average', value: formatTrendValue(trends.avg7, unit) },
      col2: { label: 'Vs Prior 7d', value: formatTrendDeltaValue(trends.avg7, trends.priorAvg7, unit) },
      col3: { label: 'Trend', value: formatTrendCue(trends.avg7, trends.priorAvg7) },
      direction: weightDirection(trends.avg7, trends.priorAvg7),
    },
    {
      title: '30-day rolling',
      col1: { label: 'Average', value: formatTrendValue(trends.avg30, unit) },
      col2: { label: 'Vs Prior 30d', value: formatTrendDeltaValue(trends.avg30, trends.priorAvg30, unit) },
      col3: { label: 'Trend', value: formatTrendCue(trends.avg30, trends.priorAvg30) },
      direction: weightDirection(trends.avg30, trends.priorAvg30),
      isLast: true,
    },
  ];
}
