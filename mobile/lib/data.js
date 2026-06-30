// Native entry model factories and exercise catalog
import * as _catalog from './data/exerciseCatalog.js';
import * as _weightGoal from './data/weightGoal.js';
import * as _routineStatus from './data/routineStatus.js';
import * as _fatigue from './data/fatigue.js';
import * as _skipData from './data/skipData.js';
import * as _workoutAnalytics from './data/workoutAnalytics.js';
import * as _oneK from './data/oneK.js';
import * as _nonWeightedMetrics from './data/nonWeightedMetrics.js';

// exerciseCatalog
export const KILO_SPLIT = _catalog.KILO_SPLIT;
export const KILO_EXERCISES = _catalog.KILO_EXERCISES;
export const exercisesForDay = _catalog.exercisesForDay;
export const isStrengthExerciseName = _catalog.isStrengthExerciseName;
export const getDefaultTrackedNames = _catalog.getDefaultTrackedNames;
export const normalizeLiftName = _catalog.normalizeLiftName;
export const listTrackedLifts = _catalog.listTrackedLifts;
export const makeWeightEntry = _catalog.makeWeightEntry;
export const makeWorkoutSession = _catalog.makeWorkoutSession;
export const makeWorkoutNote = _catalog.makeWorkoutNote;
export const makeWorkoutNoteItem = _catalog.makeWorkoutNoteItem;

// weightGoal
export const WEIGHT_PACE_NOTABLE_THRESHOLD = _weightGoal.WEIGHT_PACE_NOTABLE_THRESHOLD;
export const WEIGHT_PACE_SPIKE_THRESHOLD = _weightGoal.WEIGHT_PACE_SPIKE_THRESHOLD;
export const computeWeightTrends = _weightGoal.computeWeightTrends;
export const computeWeightPaceLevel = _weightGoal.computeWeightPaceLevel;
export const computeWeightTrendSummary = _weightGoal.computeWeightTrendSummary;
export const computeWeightGoal = _weightGoal.computeWeightGoal;
export const ACTIVITY_MULTIPLIERS = _weightGoal.ACTIVITY_MULTIPLIERS;
export const computeBMR = _weightGoal.computeBMR;
export const computeTDEE = _weightGoal.computeTDEE;
export const ageFromDateOfBirth = _weightGoal.ageFromDateOfBirth;
export const isProfileComplete = _weightGoal.isProfileComplete;
export const computeCalorieEstimate = _weightGoal.computeCalorieEstimate;
export const resolveGoalCurrentWeight = _weightGoal.resolveGoalCurrentWeight;
export const computeWeightRollingAverageSeries = _weightGoal.computeWeightRollingAverageSeries;
export const deriveWeightGoalAnalytics = _weightGoal.deriveWeightGoalAnalytics;

// routineStatus
export const rollingWindowStart = _routineStatus.rollingWindowStart;
export const REPEATED_WEEKDAY_SKIP_SESSION_WINDOW = _routineStatus.REPEATED_WEEKDAY_SKIP_SESSION_WINDOW;
export const computeWeeksIn = _routineStatus.computeWeeksIn;
export const deloadSessionsLogged = _routineStatus.deloadSessionsLogged;
export const elapsedWeeksOnRoutine = _routineStatus.elapsedWeeksOnRoutine;
export const deriveRoutineStatus = _routineStatus.deriveRoutineStatus;

// fatigue
export const getKiloFatigueMultiplier = _fatigue.getKiloFatigueMultiplier;
export const computeKiloMax = _fatigue.computeKiloMax;

// skipData
export const deriveSkipData = _skipData.deriveSkipData;

// workoutAnalytics
export const classifyExerciseSessions = _workoutAnalytics.classifyExerciseSessions;
export const computeRepDropOff = _workoutAnalytics.computeRepDropOff;
export const deriveRepDropOffFlags = _workoutAnalytics.deriveRepDropOffFlags;
export const SESSION_CHECKIN_REP_DROP_THRESHOLD = _workoutAnalytics.SESSION_CHECKIN_REP_DROP_THRESHOLD;
export const SESSION_CHECKIN_MIN_COLLAPSED_SETS = _workoutAnalytics.SESSION_CHECKIN_MIN_COLLAPSED_SETS;
export const SESSION_CHECKIN_SKIP_FLOOR = _workoutAnalytics.SESSION_CHECKIN_SKIP_FLOOR;
export const SESSION_CHECKIN_SKIP_MARGIN = _workoutAnalytics.SESSION_CHECKIN_SKIP_MARGIN;
export const deriveSessionCheckIn = _workoutAnalytics.deriveSessionCheckIn;
export const deriveSignals = _workoutAnalytics.deriveSignals;
export const deriveWorkoutNoteAnalytics = _workoutAnalytics.deriveWorkoutNoteAnalytics;
export const deriveOverloadCounts = _workoutAnalytics.deriveOverloadCounts;
export const computeWeeklySummary = _workoutAnalytics.computeWeeklySummary;
export const deriveCheckInHistory = _workoutAnalytics.deriveCheckInHistory;

// oneK
export const DEFAULT_1K_EXERCISES = _oneK.DEFAULT_1K_EXERCISES;
export const derive1kTotal = _oneK.derive1kTotal;
export const derive1kTotalSeries = _oneK.derive1kTotalSeries;
export const derive1kTotalSeriesFromSectionsList = _oneK.derive1kTotalSeriesFromSectionsList;
export const derive1kTotalFromSectionsList = _oneK.derive1kTotalFromSectionsList;
export const findMatchingExerciseNames = _oneK.findMatchingExerciseNames;
export const rolloverOneKExercises = _oneK.rolloverOneKExercises;

// nonWeightedMetrics
export const deriveNonWeightedTrackedExerciseMetrics = _nonWeightedMetrics.deriveNonWeightedTrackedExerciseMetrics;
