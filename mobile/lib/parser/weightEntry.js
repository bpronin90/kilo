import { getWeightUnit } from '../unitPreference';
import { inputWeightToLb, formatGoalWeightValue } from '../units';

// Parse a weigh-in entry typed in the selected display unit (#441).
// The returned weight_value is ALWAYS canonical lb; kg input is converted at
// this entry funnel (both the new-entry and edit paths flow through here).
// `unit` defaults to the active display preference so existing callers that
// pass only the raw text pick up the selected unit automatically.
export function parseWeightEntry(raw, unit = getWeightUnit()) {
  if (!raw || raw.trim() === '') {
    return { ok: false, raw: raw || '', error: 'Weight is required', category: 'missing_required_field' };
  }
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, raw, error: 'Enter a number only (e.g. 180 or 180.4)', category: 'invalid_field_value' };
  }
  const value = parseFloat(trimmed);
  if (value <= 0) {
    return { ok: false, raw, error: 'Weight must be greater than zero', category: 'invalid_field_value' };
  }
  return { ok: true, raw, weight_value: inputWeightToLb(value, unit), weight_unit: 'lb', logged_at: new Date().toISOString() };
}

// Strict numeric parse shared by draft conversion and goal-form save (#1476):
// optional surrounding whitespace, digits with at most one decimal point
// ("165", "165.", "165.5", ".5"). Anything parseFloat would only partly read
// ("165..", "12a", "1e3", "-5") yields null, so a draft that cannot be converted
// can never be saved from its numeric prefix. Returns a positive number or null.
// (parseWeightEntry's weigh-in grammar is a stricter subset: no trailing dot or
// leading-dot forms, so everything accepted there is accepted here.)
export function parseStrictWeightText(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
  const value = parseFloat(trimmed);
  return value > 0 ? value : null;
}

// Re-express a dirty weight draft when the display unit changes (#1476).
// `text` was typed in `fromUnit`; the result is the same physical weight in
// `toUnit`. `known` ({ text, unit, lb }) is the draft's retained provenance: while
// the text is still exactly what was seeded/converted in `fromUnit`, the original
// canonical lb value is reused so repeated lb<->kg switches never drift through
// kg rounding. Returns null when the text is not a convertible number (empty,
// non-numeric, zero); the caller then leaves the text untouched.
export function convertWeightDraft(text, fromUnit, toUnit, known) {
  if (fromUnit === toUnit) return null;
  const value = parseStrictWeightText(text);
  if (value == null) return null;
  const lb = known && known.text === text && known.unit === fromUnit
    ? known.lb
    : inputWeightToLb(value, fromUnit);
  return { text: formatGoalWeightValue(lb, toUnit), unit: toUnit, lb };
}

// Save-boundary counterpart of convertWeightDraft (#1476): while the draft text
// is still exactly the seeded/converted text in the unit it was retained for,
// return the retained canonical lb value so saving never re-rounds the display
// text. Returns null when the user has typed since (callers then parse the text).
export function retainedDraftLb(text, unit, known) {
  return known && known.text === text && known.unit === unit && Number.isFinite(known.lb)
    ? known.lb
    : null;
}
