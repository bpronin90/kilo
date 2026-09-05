// Kilo CSV export engine (issue #578 Issue A).

import { exportWorkoutsCsv, exportWeightCsv, WORKOUT_CSV_COLUMNS, WEIGHT_CSV_COLUMNS } from '../lib/interoperability/kiloCsv';

function parseCsv(doc) {
  // Minimal RFC-4180-aware split good enough for asserting on our own writer's
  // output in tests (not a general-purpose parser — that belongs to Issue B).
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < doc.length; i++) {
    const c = doc[i];
    if (inQuotes) {
      if (c === '"' && doc[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r' && doc[i + 1] === '\n') {
      row.push(field); field = ''; rows.push(row); row = []; i++;
    } else {
      field += c;
    }
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function rowsAsObjects(doc, columns) {
  const parsed = parseCsv(doc);
  const [header, ...data] = parsed;
  expect(header).toEqual(columns);
  return data.map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i]])));
}

function byKind(objs, kind) {
  return objs.filter((o) => o.record_kind === kind);
}

describe('exportWorkoutsCsv', () => {
  test('header matches the contract schema exactly', () => {
    const doc = exportWorkoutsCsv([]);
    const [header] = parseCsv(doc);
    expect(header).toEqual(WORKOUT_CSV_COLUMNS);
  });

  test('an empty live note still emits a routine row (empty routines are represented, not dropped)', () => {
    const note = { id: 'n1', title: 'Empty Routine', isCurrent: true, raw_text: '' };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    expect(byKind(objs, 'routine')).toHaveLength(1);
    expect(byKind(objs, 'routine')[0].routine_title).toBe('Empty Routine');
    expect(byKind(objs, 'routine')[0].is_current_routine).toBe('true');
  });

  test('a tombstoned note contributes zero rows even if passed in', () => {
    const note = { id: 'n1', title: 'Deleted', isCurrent: false, raw_text: 'Monday\n-Bench\n- 100 5', deleted_at: '2026-01-01T00:00:00Z' };
    const doc = exportWorkoutsCsv([note]);
    const objs = rowsAsObjects(doc, WORKOUT_CSV_COLUMNS);
    expect(objs).toHaveLength(0);
  });

  test('multi-session, multi-exercise, uneven history, and an authored skip', () => {
    const raw = [
      'Monday',
      '-Bench Press',
      '- 225 5,5,5',
      '- 230 5,5',
      '-',
      '-Squat',
      '- 135 8',
      '- 140 8',
    ].join('\n');
    const note = { id: 'n1', title: 'Push Day', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

    const benchSessionRows = objs.filter((o) => o.exercise_name === 'Bench Press' && ['set', 'session'].includes(o.record_kind));
    const sessionIndexes = [...new Set(benchSessionRows.map((o) => o.session_index))].sort();
    expect(sessionIndexes).toEqual(['1', '2', '3']);

    // Session 1: three sets, set_ordinal restarts at 1.
    const session1Sets = objs.filter((o) => o.exercise_name === 'Bench Press' && o.session_index === '1' && o.record_kind === 'set');
    expect(session1Sets.map((s) => s.set_ordinal)).toEqual(['1', '2', '3']);
    expect(session1Sets.map((s) => s.weight_value_lb)).toEqual(['225', '225', '225']);

    // Session 2: two sets, ordinal restarts at 1 again (not 4).
    const session2Sets = objs.filter((o) => o.exercise_name === 'Bench Press' && o.session_index === '2' && o.record_kind === 'set');
    expect(session2Sets.map((s) => s.set_ordinal)).toEqual(['1', '2']);

    // Session 3: the authored skip.
    const session3 = objs.filter((o) => o.exercise_name === 'Bench Press' && o.session_index === '3');
    expect(session3).toHaveLength(1);
    expect(session3[0].record_kind).toBe('session');
    expect(session3[0].is_skipped).toBe('true');

    // Squat only has 2 sessions — no fabricated 3rd row (missing, not skipped).
    const squatRows = objs.filter((o) => o.exercise_name === 'Squat' && ['set', 'session', 'unparsed'].includes(o.record_kind));
    const squatSessionIndexes = [...new Set(squatRows.map((o) => o.session_index))];
    expect(squatSessionIndexes.sort()).toEqual(['1', '2']);
  });

  test('two sections under the same weekday do not share session_index numbering', () => {
    const raw = [
      'Monday',
      '-Bench Press',
      '- 100 5',
      '- 105 5',
      '+Accessories',
      '-Curl',
      '- 30 10',
    ].join('\n');
    const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    const sections = byKind(objs, 'section');
    expect(sections).toHaveLength(2);
    expect(sections[0].section_ordinal).toBe('1');
    expect(sections[1].section_ordinal).toBe('2');
    expect(sections[1].section_kind).toBe('general');
    // Curl's single session is independently numbered 1, not continuing Bench's count.
    const curlSet = objs.find((o) => o.exercise_name === 'Curl' && o.record_kind === 'set');
    expect(curlSet.session_index).toBe('1');
  });

  test('a single-session section with a dated heading gets that date; a multi-session one does not', () => {
    const dated = ['Wednesday 2026-01-07', '-Deadlift', '- 405 3'].join('\n');
    const datedNote = { id: 'n1', title: 'Dated', isCurrent: true, raw_text: dated };
    const datedObjs = rowsAsObjects(exportWorkoutsCsv([datedNote]), WORKOUT_CSV_COLUMNS);
    const deadliftSet = datedObjs.find((o) => o.exercise_name === 'Deadlift' && o.record_kind === 'set');
    expect(deadliftSet.source_date).toBe('2026-01-07');
    expect(deadliftSet.source_date_origin).toBe('dated_heading');

    const multi = ['Wednesday 2026-01-07', '-Deadlift', '- 405 3', '- 410 3'].join('\n');
    const multiNote = { id: 'n2', title: 'Multi', isCurrent: false, raw_text: multi };
    const multiObjs = rowsAsObjects(exportWorkoutsCsv([multiNote]), WORKOUT_CSV_COLUMNS);
    const multiSets = multiObjs.filter((o) => o.exercise_name === 'Deadlift' && o.record_kind === 'set');
    for (const s of multiSets) {
      expect(s.source_date).toBe('');
      expect(s.source_date_origin).toBe('');
    }
  });

  test('an ordinary weekday-only note (no date evidence) leaves date empty', () => {
    const raw = ['Monday', '-Bench', '- 100 5'].join('\n');
    const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    const set = objs.find((o) => o.record_kind === 'set');
    expect(set.source_date).toBe('');
    expect(set.routine_day).toBe('Monday');
  });

  test('a kg-marked set exports canonical pounds plus authored kg provenance', () => {
    const raw = ['Monday', '-Bench', '- 100kg 5'].join('\n');
    const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    const set = objs.find((o) => o.record_kind === 'set');
    expect(set.authored_unit).toBe('kg');
    expect(set.authored_value).toBe('100');
    expect(Number(set.weight_value_lb)).toBeGreaterThan(0);
  });

  test('a plain lb set has authored_unit=lb and authored_value equal to weight_value_lb', () => {
    const raw = ['Monday', '-Bench', '- 225 5'].join('\n');
    const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    const set = objs.find((o) => o.record_kind === 'set');
    expect(set.authored_unit).toBe('lb');
    expect(set.authored_value).toBe(set.weight_value_lb);
    expect(set.weight_value_lb).toBe('225');
  });

  test('a mark, tail, and multiple comments export as one row-scoped annotation row', () => {
    const raw = [
      'Monday',
      '-Bench',
      '- 225 5,5,5 - RPE 9 *PR',
      '-- felt heavy',
      '-- great pump',
    ].join('\n');
    const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    const annotation = byKind(objs, 'annotation').find((a) => a.annotation_scope === 'performed_row');
    expect(annotation).toBeDefined();
    expect(annotation.mark).toBe('PR');
    expect(annotation.row_tail).toBe('RPE 9');
    expect(JSON.parse(annotation.row_comments)).toEqual(['felt heavy', 'great pump']);
  });

  test('a section-level prose line with no open exercise exports as a section-scoped annotation', () => {
    const raw = ['Monday', '-- deload week', '-Bench', '- 100 5'].join('\n');
    const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    const annotation = byKind(objs, 'annotation').find((a) => a.annotation_scope === 'section');
    expect(annotation).toBeDefined();
    expect(annotation.annotation_text).toBe('deload week');
  });

  test('an unparseable row still occupies its session position, marked is_unparsed', () => {
    const raw = ['Monday', '-Bench', '- 100 5', '- garbage row !!!'].join('\n');
    const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
    const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
    const unparsed = byKind(objs, 'unparsed');
    expect(unparsed.length).toBeGreaterThanOrEqual(1);
    expect(unparsed[0].session_index).toBe('2');
    expect(unparsed[0].raw_unparsed_text.length).toBeGreaterThan(0);
  });

  test('deterministic ordering: current-first, then code-point title, then id tiebreak', () => {
    const notes = [
      { id: 'z2', title: 'Same', isCurrent: false, raw_text: '' },
      { id: 'z1', title: 'Same', isCurrent: false, raw_text: '' },
      { id: 'a1', title: 'Zebra', isCurrent: false, raw_text: '' },
      { id: 'b1', title: 'Apple', isCurrent: true, raw_text: '' },
    ];
    const objs = rowsAsObjects(exportWorkoutsCsv(notes), WORKOUT_CSV_COLUMNS);
    const order = byKind(objs, 'routine').map((r) => r.routine_id);
    // current-first (b1), then title order among the rest (Same < Zebra by
    // code point, "S" < "Z"), then id tiebreak within the two "Same" titles.
    expect(order).toEqual(['b1', 'z1', 'z2', 'a1']);
  });

  // PR #949 review findings — three silent-data-loss regressions.
  describe('review-finding regressions (#578)', () => {
    test('a partially skipped set group ("80 4,-") exports the skip as is_skipped, not a fabricated zero-rep set', () => {
      const raw = ['Monday', '-Bench', '- 80 4,-'].join('\n');
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
      const sets = objs.filter((o) => o.record_kind === 'set');
      expect(sets).toHaveLength(2);
      expect(sets[0]).toMatchObject({ set_ordinal: '1', rep_count: '4', weight_value_lb: '80', is_skipped: '' });
      expect(sets[1]).toMatchObject({ set_ordinal: '2', is_skipped: 'true', rep_count: '', weight_value_lb: '' });
    });

    test('a bare preserved integer with no governing declaration ("8") is not dropped', () => {
      const raw = ['Monday', '-Bench', '8'].join('\n');
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
      const unparsed = byKind(objs, 'unparsed');
      expect(unparsed).toHaveLength(1);
      expect(unparsed[0].session_index).toBe('1');
      expect(unparsed[0].raw_unparsed_text).toBe('8');
    });

    test('a bare malformed line interleaves at its true position among real session_entries', () => {
      const raw = ['Monday', '-Bench', '- 100 5', '8', '- 105 5'].join('\n');
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
      const rows = objs.filter((o) => ['set', 'unparsed'].includes(o.record_kind));
      expect(rows.map((r) => [r.record_kind, r.session_index])).toEqual([
        ['set', '1'],
        ['unparsed', '2'],
        ['set', '3'],
      ]);
    });

    // Review comment 5534430002: sectionMaxSessionCount previously counted
    // only session_entries, disagreeing with the merged sequence buildNoteRows
    // actually exports (session_entries + unparsed_positions) — so a dated
    // section holding one real entry plus one positional-unparsed row was
    // miscounted as 1 session and got the heading date on BOTH positions,
    // even though the contract permits dated_heading only for exactly one
    // exported session.
    test('a dated heading with one real row and one positional-unparsed row does not get a date (two exported positions, not one)', () => {
      const raw = ['Wednesday 2026-01-07', '-Deadlift', '- 405 3', '8'].join('\n');
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
      const positions = objs.filter((o) => ['set', 'unparsed'].includes(o.record_kind));
      expect(positions).toHaveLength(2);
      for (const p of positions) {
        expect(p.source_date).toBe('');
        expect(p.source_date_origin).toBe('');
      }
    });

    test('a rejected parse (missing-space row before any exercise) is preserved as a note-level unparsed record, not an empty routine', () => {
      const note = { id: 'n1', title: 'Broken', isCurrent: true, raw_text: '-230 5' };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);
      expect(byKind(objs, 'routine')).toHaveLength(1);
      expect(byKind(objs, 'section')).toHaveLength(0);
      const unparsed = byKind(objs, 'unparsed');
      expect(unparsed).toHaveLength(1);
      // Leading apostrophe is the documented spreadsheet-trigger neutralization
      // ("-..." starts with a trigger character) — not data loss.
      expect(unparsed[0].raw_unparsed_text).toBe("'-230 5");
      expect(unparsed[0].annotation_scope).toBe('note');
      expect(unparsed[0].annotation_text.length).toBeGreaterThan(0);
    });
  });

  test('identical input produces byte-identical output across repeated calls', () => {
    const notes = [{ id: 'n1', title: 'R', isCurrent: true, raw_text: 'Monday\n-Bench\n- 100 5' }];
    expect(exportWorkoutsCsv(notes)).toBe(exportWorkoutsCsv(notes));
  });

  // Issue #963: the parser's deload branch builds `{ sets, session_entries: [] }`,
  // so the merged sequence was empty and every set row was silently dropped.
  describe('deload sets (issue #963)', () => {
    test('a deload exercise exports its sets with weight, reps, count and units intact', () => {
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: 'Monday\nDeadlift: 315 lbs 3x5' };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

      expect(byKind(objs, 'exercise')).toHaveLength(1);

      const sets = byKind(objs, 'set');
      expect(sets).toHaveLength(3);
      expect(sets.map((s) => s.set_ordinal)).toEqual(['1', '2', '3']);
      for (const set of sets) {
        expect(set.weight_value_lb).toBe('315');
        expect(set.rep_count).toBe('5');
        expect(set.authored_unit).toBe('lb');
        expect(set.authored_value).toBe('315');
      }
    });

    test('an ordinary exercise is not duplicated by the deload fallback', () => {
      // `flushExercise()` assigns `exercise.sets` on every exercise, so the
      // fallback must key off an empty merged sequence, not off `sets` existing.
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: 'Monday\n-Bench\n- 100 5\n- 105 5' };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

      expect(byKind(objs, 'exercise')).toHaveLength(1);
      const sets = byKind(objs, 'set');
      expect(sets).toHaveLength(2);
      expect(sets.map((s) => s.weight_value_lb)).toEqual(['100', '105']);
    });

    test('a deload exercise alongside an ordinary one exports both without cross-contamination', () => {
      const raw = ['Monday', '-Bench', '- 100 5', 'Deadlift: 315 lbs 3x5'].join('\n');
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

      expect(byKind(objs, 'exercise')).toHaveLength(2);
      expect(byKind(objs, 'set')).toHaveLength(4); // 1 bench + 3 deload
    });
  });

  // Issue #963: a `--` comment that cannot attach to a preceding performed
  // entry lands only in `unparsed_rows`, which the exporter never read.
  describe('orphaned exercise comments (issue #963)', () => {
    test('a comment following a skip is exported rather than dropped', () => {
      const raw = ['Monday', '-Bench', '-', '-- knee pain'].join('\n');
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

      const scoped = byKind(objs, 'annotation').filter((o) => o.annotation_scope === 'exercise');
      expect(scoped).toHaveLength(1);
      expect(scoped[0].annotation_text).toBe('knee pain');
      expect(scoped[0].exercise_name).toBe('Bench');
      expect(scoped[0].session_index).toBe('');
      expect(byKind(objs, 'session')).toHaveLength(1);
    });

    test('imported unparsed prose beginning with -- exports once, unaltered (PR #965 review)', () => {
      // workoutNote.js:237-244 copies arbitrary `record.prose` into
      // unparsed_rows AND pushes the entry to session_entries. A `--` prefix
      // filter alone would export it twice and strip its leading dashes.
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const record = encode({ kind: 'unparsed', prose: '--- Evil', rowOrdinal: 0, v: 1 });
      const raw = `-@import-exercise "Bench"\n- @import-record ${record}`;
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

      const scoped = byKind(objs, 'annotation').filter((o) => o.annotation_scope === 'exercise');
      expect(scoped).toHaveLength(0);

      const unparsed = byKind(objs, 'unparsed');
      expect(unparsed).toHaveLength(1);
      expect(unparsed[0].raw_unparsed_text).not.toBe('- Evil');
    });

    test('an orphaned comment is still exported when the exercise also has imported rows', () => {
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const record = encode({ kind: 'unparsed', prose: '--- Evil', rowOrdinal: 0, v: 1 });
      const raw = `-@import-exercise "Bench"\n- @import-record ${record}\n-- real orphan`;
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

      const scoped = byKind(objs, 'annotation').filter((o) => o.annotation_scope === 'exercise');
      expect(scoped).toHaveLength(1);
      expect(scoped[0].annotation_text).toBe('real orphan');
    });

    test('a comment attached to a performed row still exports once, as performed_row', () => {
      // The attachable path routes into `annotation.comments` and never into
      // `unparsed_rows`, so it must not gain a second exercise-scoped row.
      const raw = ['Monday', '-Bench', '- 100 5', '-- felt strong'].join('\n');
      const note = { id: 'n1', title: 'R', isCurrent: true, raw_text: raw };
      const objs = rowsAsObjects(exportWorkoutsCsv([note]), WORKOUT_CSV_COLUMNS);

      const annotations = byKind(objs, 'annotation');
      expect(annotations).toHaveLength(1);
      expect(annotations[0].annotation_scope).toBe('performed_row');
      expect(annotations[0].row_comments).toContain('felt strong');
    });
  });
});

describe('exportWeightCsv', () => {
  test('header matches the contract schema exactly', () => {
    const [header] = parseCsv(exportWeightCsv([]));
    expect(header).toEqual(WEIGHT_CSV_COLUMNS);
  });

  test('live entries only, sorted ascending by logged_at then id, canonical pounds', () => {
    const entries = [
      { id: 'w2', entry_type: 'weight', date: '2026-01-02', logged_at: '2026-01-02T08:00:00.000Z', weight_value: 181, note: 'after cut' },
      { id: 'w1', entry_type: 'weight', date: '2026-01-01', logged_at: '2026-01-01T08:00:00.000Z', weight_value: 180, note: '' },
      { id: 'w3', entry_type: 'weight', date: '2026-01-03', logged_at: '2026-01-03T08:00:00.000Z', weight_value: 179, note: '', deleted_at: '2026-01-04T00:00:00.000Z' },
    ];
    const objs = rowsAsObjects(exportWeightCsv(entries), WEIGHT_CSV_COLUMNS);
    expect(objs).toHaveLength(2);
    expect(objs.map((o) => o.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(objs[0].weight_value_lb).toBe('180');
    expect(objs[1].note).toBe('after cut');
  });
});
