// #1492: the canonical workout-history population projection. Each consumer's
// pre-extraction projection is reproduced verbatim below (LEGACY_*) and the new
// helper and the moved public callers are held to identical output on
// representative and edge fixtures: empty, malformed, missing ids, deleted
// (tombstoned) memberships, deloads, A/B weeks, Recovery exclusion, live
// unsaved drafts, and notes dated across a UTC midnight boundary.

import { parseWorkoutNote } from '../lib/parser/workoutPure';
import { getNoteSections } from '../hooks/entries/noteSections';
import { filterNotesForNormalAnalytics, deriveRecoveryExcludedNoteIds } from '../lib/data/recoveryAnalyticsFilter';
import { deriveProgressionSections, deriveProgressionAnchorSource } from '../lib/data/exerciseProgress';
import {
  projectWorkoutHistoryPopulation,
  classifyWorkoutHistoryMembers,
  isExcludedByNoteIds,
} from '../lib/data/workoutHistoryPopulation';
import { deriveParsedSections } from '../screens/analytics/analyticsDerivations';
import { deriveHomeDashboardData } from '../screens/home/homeDashboardData';
import {
  normalizeLiftName,
  deriveWorkoutNoteAnalytics,
  listTrackedLifts,
  getDefaultTrackedNames,
} from '../lib/data';
import * as DeloadStorage from '../storage/entries/deloadStorage';
import * as ExerciseProgress from '../lib/data/exerciseProgress';
import { loadRecoveryExcludedNoteIds } from '../hooks/entries/recoveryBlockHooks';
import { computeSaveClassifications, computePendingPRCandidate } from '../screens/log/currentRoutineSave';

jest.mock('../lib/reminderScheduler', () => ({ reconcileWorkoutReminder: () => Promise.resolve() }));
jest.mock('../lib/supabaseClient', () => ({ getSupabaseClient: jest.fn() }));
jest.mock('../hooks/entries/recoveryBlockHooks', () => ({
  ...jest.requireActual('../hooks/entries/recoveryBlockHooks'),
  loadRecoveryExcludedNoteIds: jest.fn(),
}));

const DELOAD = 'Deload · ';
const AB_TEXT = 'Monday\n-Bench\n135 5\n---\nMonday\n-Bench\n145 5';

function notebook() {
  return [
    { id: 'n1', title: 'Block 1', date: '2024-01-01T23:59:59.000Z', raw_text: 'Monday\n-Bench\n135 5,5\n-Squat\n185 5' },
    { id: 'd1', title: `${DELOAD}Block 1`, date: '2024-01-02T00:00:00.000Z', raw_text: 'Monday\n-Bench\n95 5' },
    { id: 'r1', title: 'Rehab wk 1', date: '2024-01-03T00:00:00.000Z', raw_text: 'Monday\n-Bench\n65 8\n-Band Pull\n10' },
    { id: 'ab', title: 'A/B block', date: '2024-01-04T00:00:00.000Z', raw_text: AB_TEXT },
    { id: 'empty', title: 'Empty', raw_text: '' },
    { id: 'nul', title: 'No text', raw_text: null },
    { id: 'junk', title: 'Malformed', raw_text: '%%%\n???\n-\n12 x\n---\n---' },
    { title: 'No id yet', raw_text: 'Tuesday\n-Deadlift\n225 3' },
    { id: 'cur', title: 'Current', date: '2024-01-05T00:00:00.000Z', raw_text: 'Monday\n-Bench\n150 5\n-Squat\n200 5' },
  ];
}

// --- Pre-extraction projections, verbatim ------------------------------------

function LEGACY_analytics(notes, excludedNoteIds) {
  const normalNotes = filterNotesForNormalAnalytics(notes || [], excludedNoteIds);
  const noteSectionsList = normalNotes.map(n => getNoteSections(n));
  return {
    allSections: noteSectionsList.flat(),
    signalSections: deriveProgressionSections(normalNotes, noteSectionsList),
    noteSectionsList,
    normalNotes,
    anchorSource: deriveProgressionAnchorSource(notes || [], (notes || []).map(n => getNoteSections(n)), normalNotes),
  };
}

function LEGACY_log(notes, currentId, workoutNoteText, isNoteExcluded) {
  const noteSectionsList = notes.map(n => {
    const text = n.id === currentId ? workoutNoteText : n.raw_text;
    if (!text) return [];
    try { return parseWorkoutNote(text).sections; } catch { return []; }
  });
  const anchorSource = deriveProgressionAnchorSource(notes, noteSectionsList, notes.filter(n => !isNoteExcluded?.(n.id)));
  return { anchorSource, allSections: noteSectionsList.filter((_, i) => anchorSource.included[i]).flat() };
}

function LEGACY_save(notes, currentId, textToSave, excludedNoteIds) {
  const { sections: savedSections } = parseWorkoutNote(textToSave);
  const allSections = [
    ...notes.flatMap(n => {
      if (n.id && excludedNoteIds.has(n.id)) return [];
      const text = n.id === currentId ? textToSave : n.raw_text;
      return text ? parseWorkoutNote(text).sections : [];
    }),
    ...(currentId ? [] : savedSections),
  ];
  const unfilteredSections = [
    ...notes.flatMap(n => {
      const text = n.id === currentId ? textToSave : n.raw_text;
      return text ? parseWorkoutNote(text).sections : [];
    }),
    ...(currentId ? [] : savedSections),
  ];
  return { allSections, unfilteredSections };
}

function LEGACY_prEligible(notes, excludedNoteIds) {
  return filterNotesForNormalAnalytics(notes || [], excludedNoteIds).filter(n => !n.title?.startsWith(DELOAD));
}

const EXCLUSION_CASES = [
  ['no exclusions (null)', null],
  ['empty set', new Set()],
  ['recovery week excluded', new Set(['r1'])],
  ['current note excluded', new Set(['cur', 'r1'])],
  ['deload also excluded', new Set(['d1'])],
  ['unknown id only', new Set(['ghost'])],
];

const NOTEBOOKS = [
  ['empty notebook', () => []],
  ['representative notebook', notebook],
  ['deload-only notebook', () => notebook().filter(n => n.id === 'd1')],
  ['A/B-only notebook', () => notebook().filter(n => n.id === 'ab')],
];

describe('projectWorkoutHistoryPopulation — Analytics equivalence', () => {
  describe.each(NOTEBOOKS)('%s', (_label, make) => {
    test.each(EXCLUSION_CASES)('%s', (_c, excluded) => {
      const notes = make();
      const legacy = LEGACY_analytics(notes, excluded);
      const current = notes.find(n => n.id === 'cur') || null;
      const parsed = deriveParsedSections(notes, current, excluded);
      expect(parsed.allSections).toEqual(legacy.allSections);
      expect(parsed.signalSections).toEqual(legacy.signalSections);
      expect(parsed.noteSectionsList).toEqual(legacy.noteSectionsList);
      expect(parsed.anchorSource).toEqual(legacy.anchorSource);
      // Same note objects, same order.
      expect(parsed.normalNotes).toHaveLength(legacy.normalNotes.length);
      parsed.normalNotes.forEach((n, i) => expect(n).toBe(legacy.normalNotes[i]));
      expect(parsed.currentSections).toEqual(getNoteSections(current));
    });
  });

  test('a missing exclusion set keeps the caller array for normalNotes, like filterNotesForNormalAnalytics', () => {
    const notes = notebook();
    expect(deriveParsedSections(notes, null, null).normalNotes).toBe(notes);
    expect(deriveParsedSections(notes, null, new Set()).normalNotes).toBe(notes);
    expect(deriveParsedSections(null, null, null).allSections).toEqual([]);
  });

  test('tombstoned (deleted) memberships exclude nothing; a live opted-out membership excludes its note', () => {
    const blocks = [{ id: 'b1', include_in_normal_analytics: false }];
    const deletedWeeks = [{ id: 'w1', block_id: 'b1', note_id: 'r1', deleted_at: '2024-02-01T00:00:00.000Z' }];
    const liveWeeks = [{ id: 'w1', block_id: 'b1', note_id: 'r1' }];
    const notes = notebook();
    for (const weeks of [deletedWeeks, liveWeeks]) {
      const excluded = deriveRecoveryExcludedNoteIds(blocks, weeks);
      expect(deriveParsedSections(notes, null, excluded).anchorSource).toEqual(LEGACY_analytics(notes, excluded).anchorSource);
    }
    expect(deriveRecoveryExcludedNoteIds(blocks, deletedWeeks).size).toBe(0);
    expect(deriveRecoveryExcludedNoteIds(blocks, liveWeeks).has('r1')).toBe(true);
  });
});

describe('projectWorkoutHistoryPopulation — the pure contract', () => {
  test('anchor provenance stays aligned with the whole notebook; occurrence positions are preserved', () => {
    const notes = notebook();
    const pop = projectWorkoutHistoryPopulation(notes, {
      sectionsOf: getNoteSections,
      isExcluded: isExcludedByNoteIds(new Set(['r1'])),
    });
    expect(pop.noteSectionsList).toHaveLength(notes.length);
    expect(pop.anchorSource.included).toEqual(notes.map(n => n.id !== 'r1' && n.id !== 'd1'));
    expect(pop.normalNotes.map(n => n.id)).toEqual(notes.filter(n => n.id !== 'r1').map(n => n.id));
    expect(pop.progressionNotes.map(n => n.id)).toEqual(notes.filter(n => n.id !== 'r1' && n.id !== 'd1').map(n => n.id));
    // Both A/B halves are present, A before B, inside the A/B note's own slot.
    const abIdx = notes.findIndex(n => n.id === 'ab');
    expect(pop.noteSectionsList[abIdx]).toEqual(parseWorkoutNote(AB_TEXT).sections);
    expect(pop.unfilteredSections).toEqual(notes.flatMap(n => getNoteSections(n)));
  });

  test('sectionsOf runs exactly once per note, in order, and the helper never mutates its inputs', () => {
    const notes = notebook();
    const snapshot = JSON.stringify(notes);
    const seen = [];
    projectWorkoutHistoryPopulation(notes, { sectionsOf: (n, i) => { seen.push([n.id, i]); return []; } });
    expect(seen).toEqual(notes.map((n, i) => [n.id, i]));
    expect(JSON.stringify(notes)).toBe(snapshot);
  });

  test('requires an explicit parse; a missing predicate means nothing excluded', () => {
    expect(() => projectWorkoutHistoryPopulation([], {})).toThrow(TypeError);
    const notes = notebook();
    expect(classifyWorkoutHistoryMembers(notes).normalNotes).toBe(notes);
    expect(isExcludedByNoteIds(null)).toBeNull();
    expect(isExcludedByNoteIds(new Set())).toBeNull();
    expect(isExcludedByNoteIds(new Set(['n1']))({ title: 'no id' })).toBe(false);
  });
});

describe('Log progression population equivalence (live unsaved draft)', () => {
  const draft = 'Monday\n-Bench\n155 5\n-Squat\n205 5\n-Row\n100 8';
  test.each(EXCLUSION_CASES)('%s', (_c, excluded) => {
    const notes = notebook();
    const isNoteExcluded = excluded ? (id) => !!id && excluded.has(id) : undefined;
    const legacy = LEGACY_log(notes, 'cur', draft, isNoteExcluded);
    const pop = projectWorkoutHistoryPopulation(notes, {
      sectionsOf: (n) => {
        const text = n?.id === 'cur' ? draft : n?.raw_text;
        if (!text) return [];
        try { return parseWorkoutNote(text).sections; } catch { return []; }
      },
      isExcluded: (n) => !!isNoteExcluded?.(n?.id),
    });
    expect(pop.anchorSource).toEqual(legacy.anchorSource);
    expect(pop.progressionSections).toEqual(legacy.allSections);
  });
});

describe('Home anchor source equivalence', () => {
  test.each(EXCLUSION_CASES)('%s', (_c, excluded) => {
    const notes = notebook();
    const normalNotes = filterNotesForNormalAnalytics(notes, excluded);
    const noteSectionsList = normalNotes.map(n => getNoteSections(n));
    const current = notes.find(n => n.id === 'cur');
    const base = {
      weightEntries: [], workoutNote: current, weightGoal: null,
      allSections: noteSectionsList.flat(), noteSectionsList, normalNotes,
      trackedLifts: { bench: true, squat: true }, trackedLiftActivations: { bench: { anchor: 1, at: '2024-01-01T00:00:00.000Z' } },
      deloadHistory: null, sourceNoteId: 'cur', recoveryBlocks: [], referenceDate: new Date('2024-01-06T00:00:00.000Z'),
    };
    const spy = jest.spyOn(ExerciseProgress, 'deriveExerciseProgress');
    deriveHomeDashboardData({ ...base, notes });
    expect(spy.mock.calls[0][0].anchorSource).toEqual(
      deriveProgressionAnchorSource(notes, notes.map(n => getNoteSections(n)), normalNotes),
    );
    expect(spy.mock.calls[0][0].progressionSections).toEqual(deriveProgressionSections(normalNotes, noteSectionsList));
    // Without the notebook the anchors are clamped, exactly as before.
    deriveHomeDashboardData({ ...base, notes: null });
    expect(spy.mock.calls[1][0].anchorSource).toBeNull();
    spy.mockRestore();
  });
});

describe('save-time classification equivalence (fresh authoritative read)', () => {
  const trackedLifts = { bench: true, row: true };
  const trackedLiftActivations = { bench: { anchor: 1, at: '2024-01-01T00:00:00.000Z' } };

  beforeEach(() => {
    jest.spyOn(DeloadStorage, 'loadDeloadHistory').mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  function trackedNamesFor(lifts) {
    const defaults = getDefaultTrackedNames();
    const normalized = new Set(defaults.map(n => normalizeLiftName(n)));
    return [...defaults, ...listTrackedLifts(lifts).filter(n => !normalized.has(normalizeLiftName(n)))];
  }

  const SAVE_CASES = [
    ['existing note, recovery excluded', 'cur', new Set(['r1'])],
    ['existing note, nothing excluded', 'cur', new Set()],
    ['existing note excluded itself', 'cur', new Set(['cur'])],
    ['brand-new note (no id) appended', null, new Set(['r1'])],
  ];

  test.each(SAVE_CASES)('%s', async (_c, currentId, excluded) => {
    loadRecoveryExcludedNoteIds.mockResolvedValue(excluded);
    const notes = notebook();
    const textToSave = 'Monday\n-Bench\n160 5\n-Row\n110 8';
    const reconcile = jest.fn(() => Promise.resolve());
    const result = await computeSaveClassifications({
      textToSave, currentId, notes, trackedLifts, trackedLiftActivations, reconcileTrackedLiftActivations: reconcile,
    });
    const legacy = LEGACY_save(notes, currentId, textToSave, excluded);
    const { classifications } = deriveWorkoutNoteAnalytics(
      legacy.allSections, trackedNamesFor(trackedLifts), undefined, trackedLiftActivations, { deloadHistory: null, sourceNoteId: currentId ?? null },
    );
    expect(result.classificationsPatch).toEqual({ exercise_classifications: classifications });
    // Retirement/anchor repair still reads the intentionally UNFILTERED notebook.
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0][0]).toEqual(legacy.unfilteredSections);
  });

  test('an unknown boundary writes no classification and never reconciles', async () => {
    loadRecoveryExcludedNoteIds.mockRejectedValue(new Error('malformed'));
    const reconcile = jest.fn(() => Promise.resolve());
    const result = await computeSaveClassifications({
      textToSave: 'Monday\n-Bench\n160 5', currentId: 'cur', notes: notebook(), trackedLifts, trackedLiftActivations, reconcileTrackedLiftActivations: reconcile,
    });
    expect(result.classificationsPatch).toEqual({});
    expect(reconcile).not.toHaveBeenCalled();
  });

  test('membership is read fresh on every save, never cached by the projection', async () => {
    const reconcile = jest.fn(() => Promise.resolve());
    loadRecoveryExcludedNoteIds.mockClear();
    const args = { textToSave: 'Monday\n-Bench\n160 5', currentId: 'cur', notes: notebook(), trackedLifts, trackedLiftActivations, reconcileTrackedLiftActivations: reconcile };
    loadRecoveryExcludedNoteIds.mockResolvedValueOnce(new Set(['r1']));
    const first = await computeSaveClassifications(args);
    loadRecoveryExcludedNoteIds.mockResolvedValueOnce(new Set());
    const second = await computeSaveClassifications(args);
    expect(loadRecoveryExcludedNoteIds).toHaveBeenCalledTimes(2);
    const expectFor = (excluded) => deriveWorkoutNoteAnalytics(
      LEGACY_save(args.notes, 'cur', args.textToSave, excluded).allSections,
      trackedNamesFor(trackedLifts), undefined, trackedLiftActivations, { deloadHistory: null, sourceNoteId: 'cur' },
    ).classifications;
    expect(first.classificationsPatch.exercise_classifications).toEqual(expectFor(new Set(['r1'])));
    expect(second.classificationsPatch.exercise_classifications).toEqual(expectFor(new Set()));
  });
});

describe('PR-moment eligible population equivalence', () => {
  test.each(EXCLUSION_CASES)('%s', (_c, excluded) => {
    const notes = notebook();
    const legacy = LEGACY_prEligible(notes, excluded);
    const { progressionNotes } = classifyWorkoutHistoryMembers(notes, { isExcluded: isExcludedByNoteIds(excluded) });
    expect(progressionNotes).toHaveLength(legacy.length);
    progressionNotes.forEach((n, i) => expect(n).toBe(legacy[i]));
  });

  test('a PR in the current note is detected; an excluded current note or a failed read yields none', async () => {
    const notes = notebook();
    const base = {
      currentId: 'cur',
      originalNoteState: { title: 'Current', text: notes[notes.length - 1].raw_text, activeWeek: null },
      effectiveActiveWeek: null,
      hasABWeeks: false,
      notes,
      trackedLifts: { bench: true },
      trackedLiftActivations: null,
      lastSavedTitle: 'Current',
      liveTitle: 'Current',
      lastSavedText: 'Monday\n-Bench\n150 5\n300 5\n-Squat\n200 5',
      liveText: 'Monday\n-Bench\n150 5\n300 5\n-Squat\n200 5',
      consumedPRKeys: new Set(),
    };
    loadRecoveryExcludedNoteIds.mockResolvedValueOnce(new Set(['r1']));
    const hit = await computePendingPRCandidate(base);
    expect(hit).not.toBeNull();
    expect(hit.weight_value).toBe(300);

    loadRecoveryExcludedNoteIds.mockResolvedValueOnce(new Set(['cur']));
    expect(await computePendingPRCandidate(base)).toBeNull();

    loadRecoveryExcludedNoteIds.mockRejectedValueOnce(new Error('unknown'));
    expect(await computePendingPRCandidate(base)).toBeNull();
  });
});
