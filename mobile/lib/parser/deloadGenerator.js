import { KILO_EXERCISES } from '../data/exerciseCatalog.js';
import { parseWorkoutNote } from './workoutNote.js';
import { normalizeExerciseKey } from './exerciseNames.js';

function _mostRecentWorkingWeight(exercise) {
  const rows = exercise.rows;
  if (rows.length === 0) return null;
  const lastRow = rows[rows.length - 1];
  const weighted = lastRow.sets.filter(s => s.weight_value != null && s.weight_value > 0);
  if (weighted.length === 0) return null;
  const byWeight = new Map();
  for (const s of weighted) byWeight.set(s.weight_value, (byWeight.get(s.weight_value) || 0) + 1);
  const sorted = [...byWeight.entries()].sort((a, b) => b[0] - a[0]);
  for (const [w, count] of sorted) if (count >= 2) return w;
  return sorted[0][0];
}

function _inferIncrement(exercise) {
  for (const row of exercise.rows) {
    for (const s of row.sets) {
      if (s.weight_value != null && (s.weight_value % 5) !== 0) return 2.5;
    }
  }
  return 5;
}

function _roundToIncrement(weight, increment) {
  return Math.round(weight / increment) * increment;
}

export function parseExerciseHeader(raw_header) {
  if (!raw_header) return null;
  const nxm = /(\d+)\s*[xX×]\s*(\d+)(?:[–\-](\d+))?/.exec(raw_header);
  if (nxm) {
    return {
      sets: parseInt(nxm[1], 10),
      repLo: parseInt(nxm[2], 10),
      repHi: nxm[3] != null ? parseInt(nxm[3], 10) : parseInt(nxm[2], 10),
    };
  }
  const spaced = /(\d+)\s+(\d+)[–\-](\d+)/.exec(raw_header);
  if (spaced) {
    return { sets: parseInt(spaced[1], 10), repLo: parseInt(spaced[2], 10), repHi: parseInt(spaced[3], 10) };
  }
  return null;
}

export function generateDeloadNote(routineRawText) {
  const { sections } = parseWorkoutNote(routineRawText);

  const byHeading = [];
  const headingIdx = new Map();

  function pushItem(heading, line) {
    if (!headingIdx.has(heading)) {
      headingIdx.set(heading, byHeading.length);
      byHeading.push({ heading, lines: [] });
    }
    byHeading[headingIdx.get(heading)].lines.push(line);
  }

  for (const section of sections) {
    if (section.kind === 'warmup') continue;
    const heading = section.heading;

    for (const exercise of section.exercises) {
      const isCore = /^Core:/i.test(exercise.name);

      if (isCore) {
        const shortName = exercise.name.replace(/^Core:\s*/i, '').toLowerCase();
        pushItem(heading, `Core: ${shortName}, easy`);
        continue;
      }

      if (exercise.rows.length === 0) continue;

      const workingWeight = _mostRecentWorkingWeight(exercise);
      if (workingWeight === null) continue;

      const headerInfo = parseExerciseHeader(exercise.raw_header);
      let prescribedSets, repLo, repHi;
      if (headerInfo) {
        prescribedSets = headerInfo.sets;
        repLo = headerInfo.repLo;
        repHi = headerInfo.repHi;
      } else {
        const lastRow = exercise.rows[exercise.rows.length - 1];
        prescribedSets = lastRow.sets.length;
        const rowReps = lastRow.sets.map(s => s.rep_count).filter(r => r != null && r > 0);
        repLo = rowReps.length > 0 ? Math.min(...rowReps) : 8;
        repHi = rowReps.length > 0 ? Math.max(...rowReps) : 8;
      }

      const deloadSets = Math.max(2, prescribedSets - 1);
      const deloadReps = Math.ceil((repLo + repHi) / 2);

      const increment = _inferIncrement(exercise);
      const canonKey = normalizeExerciseKey(exercise.name);
      const catalogEntry = KILO_EXERCISES.find(e => normalizeExerciseKey(e.name) === canonKey);

      const deloadWeight = (catalogEntry && catalogEntry.po)
        ? _roundToIncrement(0.65 * workingWeight, increment)
        : workingWeight;

      pushItem(heading, `${exercise.name}: ${deloadWeight} lbs ${deloadSets}x${deloadReps}`);
    }
  }

  const outputLines = [];
  for (const { heading, lines } of byHeading) {
    if (lines.length === 0) continue;
    if (heading) outputLines.push(heading);
    for (const line of lines) outputLines.push(line);
  }
  return outputLines.join('\n');
}
