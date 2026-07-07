import { formatDelta } from './format';
import { displayWeight } from './units';

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

export function formatTrendCue(currentValue, priorValue) {
  if (currentValue === null || priorValue === null) return '-';
  if (currentValue > priorValue) return '↑ Gaining';
  if (currentValue < priorValue) return '↓ Losing';
  return '→ Stable';
}

export function buildTrendSections(trends, paceLevel, unit = 'lb') {
  return [
    {
      title: 'Today',
      col1: { label: 'Current', value: formatTrendValue(trends.currentWeight, unit) },
      col2: { label: 'Vs Previous', value: formatTrendDeltaValue(trends.currentWeight, trends.priorDayWeight, unit) },
      col3: { label: 'Trend', value: trends.paceFlag ? (trends.paceFlag === 'gain' ? '↑ Gaining' : '↓ Losing') : '-' },
      paceLevel,
    },
    {
      title: '7-day rolling',
      col1: { label: 'Average', value: formatTrendValue(trends.avg7, unit) },
      col2: { label: 'Vs Prior 7d', value: formatTrendDeltaValue(trends.avg7, trends.priorAvg7, unit) },
      col3: { label: 'Trend', value: formatTrendCue(trends.avg7, trends.priorAvg7) },
    },
    {
      title: '30-day rolling',
      col1: { label: 'Average', value: formatTrendValue(trends.avg30, unit) },
      col2: { label: 'Vs Prior 30d', value: formatTrendDeltaValue(trends.avg30, trends.priorAvg30, unit) },
      col3: { label: 'Trend', value: formatTrendCue(trends.avg30, trends.priorAvg30) },
      isLast: true,
    },
  ];
}
