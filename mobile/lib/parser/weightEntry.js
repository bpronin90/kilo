import { getWeightUnit } from '../unitPreference';
import { inputWeightToLb } from '../units';

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
