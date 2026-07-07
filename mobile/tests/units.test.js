// Unit display preference (#441): conversion helpers, display formatting
// boundaries, entry-path conversion, and the preference store.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  KG_PER_LB,
  lbToKg,
  kgToLb,
  unitFromUnitSystem,
  unitSystemFromUnit,
  displayWeight,
  formatBodyweightValue,
  formatLiftWeightValue,
  inputWeightToLb,
  displayChartSeries,
} from '../lib/units';
import {
  getWeightUnit,
  setWeightUnitPreference,
  subscribeWeightUnit,
  __resetWeightUnitForTests,
} from '../lib/unitPreference';
import { parseWeightEntry } from '../lib/parser';
import { saveUserProfile, clearUserProfile } from '../storage/entries/profileStorage';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  AsyncStorage.clear();
  __resetWeightUnitForTests();
});

// ── conversion core ───────────────────────────────────────────────────────────

describe('lb↔kg conversion', () => {
  test('uses the exact international pound definition', () => {
    expect(KG_PER_LB).toBe(0.45359237);
  });

  test('round-trips lb → kg → lb without drift', () => {
    for (const lb of [1, 45, 135, 185.2, 225, 315, 1000]) {
      expect(kgToLb(lbToKg(lb))).toBeCloseTo(lb, 10);
    }
  });

  test('converts known values', () => {
    expect(lbToKg(220.462262)).toBeCloseTo(100, 4);
    expect(kgToLb(100)).toBeCloseTo(220.462262, 4);
  });
});

describe('unit_system mapping', () => {
  test('metric maps to kg; imperial, unset, and unknown default to lb', () => {
    expect(unitFromUnitSystem('metric')).toBe('kg');
    expect(unitFromUnitSystem('imperial')).toBe('lb');
    expect(unitFromUnitSystem(null)).toBe('lb');
    expect(unitFromUnitSystem(undefined)).toBe('lb');
    expect(unitFromUnitSystem('weird')).toBe('lb');
  });

  test('maps units back to unit_system values', () => {
    expect(unitSystemFromUnit('kg')).toBe('metric');
    expect(unitSystemFromUnit('lb')).toBe('imperial');
  });
});

// ── display helpers ───────────────────────────────────────────────────────────

describe('displayWeight', () => {
  test('is the identity in lb mode', () => {
    expect(displayWeight(185.2, 'lb')).toBe(185.2);
    expect(displayWeight(0, 'lb')).toBe(0);
  });

  test('converts unrounded in kg mode', () => {
    expect(displayWeight(185.2, 'kg')).toBeCloseTo(84.005, 3);
  });

  test('passes null/undefined through', () => {
    expect(displayWeight(null, 'kg')).toBeNull();
    expect(displayWeight(undefined, 'kg')).toBeUndefined();
  });
});

describe('formatBodyweightValue', () => {
  test('lb mode matches raw string interpolation exactly', () => {
    expect(formatBodyweightValue(185, 'lb')).toBe('185');
    expect(formatBodyweightValue(185.2, 'lb')).toBe('185.2');
  });

  test('kg mode always shows one decimal', () => {
    expect(formatBodyweightValue(185, 'kg')).toBe('83.9');
    expect(formatBodyweightValue(185.2, 'kg')).toBe('84.0');
    expect(formatBodyweightValue(220.462262, 'kg')).toBe('100.0');
  });

  test('rounds at the display boundary rather than truncating', () => {
    // 0.33 lb = 0.14968… kg → rounds up to 0.1? no: 0.1497 → '0.1'; use a value
    // straddling the half boundary: 185.31 lb = 84.0549… kg → '84.1'? No —
    // 84.0549 → '84.1' only if >= 84.05. toFixed rounds half away from zero.
    expect(formatBodyweightValue(185.31, 'kg')).toBe('84.1');
    expect(formatBodyweightValue(185.2, 'kg')).toBe('84.0');
  });

  test('returns empty string for null/undefined', () => {
    expect(formatBodyweightValue(null, 'kg')).toBe('');
    expect(formatBodyweightValue(undefined, 'lb')).toBe('');
  });
});

describe('formatLiftWeightValue', () => {
  test('lb mode matches raw string interpolation exactly', () => {
    expect(formatLiftWeightValue(315, 'lb')).toBe('315');
    expect(formatLiftWeightValue(87.5, 'lb')).toBe('87.5');
  });

  test('kg mode rounds to one decimal and trims trailing .0', () => {
    expect(formatLiftWeightValue(225, 'kg')).toBe('102.1');
    expect(formatLiftWeightValue(45, 'kg')).toBe('20.4');
    expect(formatLiftWeightValue(220.462262, 'kg')).toBe('100');
  });

  test('returns empty string for null/undefined', () => {
    expect(formatLiftWeightValue(null, 'kg')).toBe('');
    expect(formatLiftWeightValue(undefined, 'kg')).toBe('');
  });
});

describe('displayChartSeries', () => {
  const series = [
    { value: 185.0, label: '01-01', unit: 'lb' },
    { value: 186.4, label: '01-02', unit: 'lb' },
  ];

  test('returns the same array reference in lb mode', () => {
    expect(displayChartSeries(series, 'lb')).toBe(series);
  });

  test('converts values and unit labels in kg mode', () => {
    const converted = displayChartSeries(series, 'kg');
    expect(converted).not.toBe(series);
    expect(converted[0]).toEqual({ value: 83.9, label: '01-01', unit: 'kg' });
    expect(converted[1].value).toBe(84.5); // 84.5496… rounds to one decimal
    expect(converted[1].unit).toBe('kg');
  });

  test('supports integer rounding for lift totals', () => {
    const oneK = [{ value: 1000, label: '#1', unit: 'lb' }];
    expect(displayChartSeries(oneK, 'kg', 0)[0].value).toBe(454);
  });

  test('passes null-valued points and non-arrays through', () => {
    expect(displayChartSeries(null, 'kg')).toBeNull();
    const withNull = [{ value: null, label: 'x' }];
    expect(displayChartSeries(withNull, 'kg')[0]).toEqual({ value: null, label: 'x' });
  });
});

// ── entry-path conversion ─────────────────────────────────────────────────────

describe('inputWeightToLb', () => {
  test('lb input is stored exactly as typed', () => {
    expect(inputWeightToLb(185.2, 'lb')).toBe(185.2);
  });

  test('kg input converts to lb rounded to one decimal', () => {
    expect(inputWeightToLb(84, 'kg')).toBe(185.2);
    expect(inputWeightToLb(100, 'kg')).toBe(220.5);
  });

  test('display→entry round trip stays within one kg display step', () => {
    // Display toggling itself is lossless (canonical lb is never rewritten);
    // RE-ENTERING a displayed one-decimal kg value quantizes at the kg step
    // (0.1 kg ≈ 0.22 lb), so the reconstructed lb value must stay within half
    // a step of the original.
    for (const lb of [150.0, 185.2, 200.6, 243.8]) {
      const shownKg = Number(formatBodyweightValue(lb, 'kg'));
      expect(Math.abs(inputWeightToLb(shownKg, 'kg') - lb)).toBeLessThanOrEqual(0.12);
    }
  });
});

describe('parseWeightEntry unit conversion', () => {
  test('defaults to lb and stores the typed value', () => {
    const parsed = parseWeightEntry('185.2');
    expect(parsed.ok).toBe(true);
    expect(parsed.weight_value).toBe(185.2);
    expect(parsed.weight_unit).toBe('lb');
  });

  test('explicit kg unit converts to canonical lb', () => {
    const parsed = parseWeightEntry('84', 'kg');
    expect(parsed.ok).toBe(true);
    expect(parsed.weight_value).toBe(185.2);
    expect(parsed.weight_unit).toBe('lb');
  });

  test('follows the active display preference by default', () => {
    setWeightUnitPreference('kg');
    const parsed = parseWeightEntry('84');
    expect(parsed.weight_value).toBe(185.2);
    expect(parsed.weight_unit).toBe('lb');
  });

  test('validation is unchanged regardless of unit', () => {
    expect(parseWeightEntry('', 'kg').ok).toBe(false);
    expect(parseWeightEntry('abc', 'kg').ok).toBe(false);
    expect(parseWeightEntry('0', 'kg').ok).toBe(false);
  });
});

// ── preference store ──────────────────────────────────────────────────────────

describe('unit preference store', () => {
  test('defaults to lb', () => {
    expect(getWeightUnit()).toBe('lb');
  });

  test('set + notify + unsubscribe', () => {
    const seen = [];
    const unsubscribe = subscribeWeightUnit(() => seen.push(getWeightUnit()));
    setWeightUnitPreference('kg');
    expect(getWeightUnit()).toBe('kg');
    expect(seen).toEqual(['kg']);
    setWeightUnitPreference('kg'); // no-op, no extra notify
    expect(seen).toEqual(['kg']);
    unsubscribe();
    setWeightUnitPreference('lb');
    expect(seen).toEqual(['kg']);
    expect(getWeightUnit()).toBe('lb');
  });

  test('coerces unknown values to lb', () => {
    setWeightUnitPreference('stone');
    expect(getWeightUnit()).toBe('lb');
  });

  test('hydrates from the stored profile unit_system on first subscribe', async () => {
    await saveUserProfile({ unit_system: 'metric' });
    __resetWeightUnitForTests();
    const unsubscribe = subscribeWeightUnit(() => {});
    await flush();
    expect(getWeightUnit()).toBe('kg');
    unsubscribe();
  });

  test('an explicit selection wins over hydration', async () => {
    await saveUserProfile({ unit_system: 'metric' });
    __resetWeightUnitForTests();
    setWeightUnitPreference('lb');
    const unsubscribe = subscribeWeightUnit(() => {});
    await flush();
    expect(getWeightUnit()).toBe('lb');
    unsubscribe();
  });

  test('a cleared profile hydrates back to the lb default', async () => {
    await clearUserProfile();
    __resetWeightUnitForTests();
    const unsubscribe = subscribeWeightUnit(() => {});
    await flush();
    expect(getWeightUnit()).toBe('lb');
    unsubscribe();
  });
});
