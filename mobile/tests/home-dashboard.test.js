// Regression tests for issue #379: 1k progress mismatch between Home and Analytics.
//
// Root cause: deriveHomeDashboardData called derive1kTotal with sections from the
// current workout note only, while deriveAnalytics used allSections. When squats
// were only in a historical note, Home showed a null total and Analytics showed the
// correct value.
//
// Fix: Home now passes allSections to derive1kTotal, matching Analytics.

import { parseWorkoutNote, epleyPR } from '../lib/parser';
import { derive1kTotal, DEFAULT_1K_EXERCISES } from '../lib/data';
import { deriveHomeDashboardData } from '../screens/home/homeDashboardData';
import { deriveAnalytics, deriveParsedSections } from '../screens/analytics/analyticsDerivations';

// Historical note: all three Big-3 lifts logged in one session.
const HISTORICAL_TEXT = '-DB Bench Press\n135 5\n-Squat\n225 5\n-Deadlift\n315 5';

// Current note: only bench and deadlift — squat was done in the historical note.
const CURRENT_TEXT = '-DB Bench Press\n140 5\n-Deadlift\n320 5';

const SEL = { bench: 'DB Bench Press', squat: 'Squat', deadlift: 'Deadlift' };

describe('1k progress — Home vs Analytics consistency (issue #379)', () => {
  test('Home and Analytics produce the same non-null 1k total when squats are in a historical note', () => {
    const historicalSections = parseWorkoutNote(HISTORICAL_TEXT).sections;
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const allSections = [...historicalSections, ...currentSections];

    const historicalNote = { id: 'n1', raw_text: HISTORICAL_TEXT, one_k_exercises: null };
    const currentNote = { id: 'n2', raw_text: CURRENT_TEXT, one_k_exercises: null };
    const notes = [historicalNote, currentNote];

    const { oneK: homeOneK } = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: currentNote,
      weightGoal: null,
      allSections,
      trackedLifts: {},
    });

    const parsedSections = deriveParsedSections(notes, currentNote);
    const { oneK: analyticsOneK } = deriveAnalytics(parsedSections, {}, SEL, 1.0);

    expect(homeOneK.total).not.toBeNull();
    expect(homeOneK.total).toBeCloseTo(analyticsOneK.total, 5);
    expect(homeOneK.squat).not.toBeNull();
    expect(homeOneK.squat).toBeCloseTo(analyticsOneK.squat, 5);
  });

  test('squat contribution is accounted when it only appears in historical note', () => {
    const historicalSections = parseWorkoutNote(HISTORICAL_TEXT).sections;
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const allSections = [...historicalSections, ...currentSections];

    const currentNote = { id: 'n2', raw_text: CURRENT_TEXT, one_k_exercises: null };

    const { oneK } = deriveHomeDashboardData({
      weightEntries: [],
      workoutNote: currentNote,
      weightGoal: null,
      allSections,
      trackedLifts: {},
    });

    // The historical note gives one complete cycle — squat from that cycle is used.
    expect(oneK.squat).toBeCloseTo(epleyPR(225, 5), 5);
    expect(oneK.total).toBeCloseTo(epleyPR(135, 5) + epleyPR(225, 5) + epleyPR(315, 5), 5);
  });

  test('pre-fix behavior: current-only sections give null total when squat is absent', () => {
    // Documents what the bug looked like: passing only the current note's sections
    // returns null because there's no complete Big-3 cycle without squats.
    const currentSections = parseWorkoutNote(CURRENT_TEXT).sections;
    const result = derive1kTotal(currentSections, SEL);
    expect(result.total).toBeNull();
    expect(result.squat).toBeNull();
  });
});
