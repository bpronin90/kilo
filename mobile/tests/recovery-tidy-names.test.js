// Pure Tidy names planner and text splice (#1309). Owner-supplied real-data
// fixtures (Squat and DB Bench, weeks 1-6) drive the table; the rest pin the
// text contract (bytes, CRLF, comments, attachment) and the fail-closed rules.
import { captureRecoveryBaselineFromText } from '../lib/data/recoveryBlocks';
import { deriveRecoveryStrength, LIFT_STATE } from '../lib/data/recoveryStrength';
import { normalizeExerciseKey, parseWorkoutNote } from '../lib/parser';
import { planTidyNames } from '../lib/data/recoveryTidyNames';
import { applyTidyEdits, buildOccurrenceEdit, firstValidRowLine, verifyTidyEdits } from '../lib/data/recoveryTidyText';
import { planBaselineNameMatches } from '../lib/data/recoveryBaselineNames';
import { preserveNameMatches } from '../lib/data/recoveryStrengthBaseline';
import { canonicalDisplayName, canonicalMatchKey } from '../lib/data/recoveryStrengthBaseline';

const STAMP = '2026-05-01T00:00:00Z';
const SQUAT_HEADERS = [
  'Squat — empty bar or very light, 3x8 (movement/pain test, not a working set)',
  'Squat 3x6-8, step up from empty bar 135-155',
  'Squat 3x6-8, step up',
  'Squat 3x6-8, step up',
  'Squat 3x8',
  'Squat 3x8',
];
const DB_HEADERS = [
  'DB Bench Press — 3×6-8, start at 70 lbs, build up if clean',
  ...Array(5).fill('DB Bench Press 3x6-8, step up'),
];

// `names` overrides frozen row display names (index order), keyed the way an
// authored per-week spelling would have been (the owner's DB Bench baseline).
function fixture({ baselineText, weekTexts, names = null, over = {} }) {
  const captured = captureRecoveryBaselineFromText(baselineText);
  const baseline = names
    ? { ...captured, exercises: captured.exercises.map((r, i) => (names[i] ? { ...r, ...(typeof names[i] === 'string' ? { name: names[i], key: normalizeExerciseKey(names[i]) } : names[i]) } : r)) }
    : captured;
  const block = { id: 'rb1', baseline, started_at: STAMP, completed_at: null, deleted_at: null, ...over };
  const notes = weekTexts.map((t, i) => ({ id: `n${i + 1}`, raw_text: t, updated_at: STAMP, deleted_at: null }));
  const weeks = weekTexts.map((_t, i) => ({ id: `w${i + 1}`, block_id: 'rb1', note_id: `n${i + 1}`, week_number: i + 1, deleted_at: null }));
  return { block, weeks, notes };
}
const squatWeek = (h, n) => `-${h}\n- 135 8,8,8\n-Bench\n- 100 5 \n`.replace('100 5 ', `${100 + n} 5`);
const squatFixture = () => fixture({
  baselineText: '-Squat\n- 225 5,5,5\n-Bench\n- 185 5',
  weekTexts: SQUAT_HEADERS.map(squatWeek),
});
const apply = (fx, plan) => fx.notes.map(n => {
  const w = plan.noteWrites.find(x => x.note_id === n.id);
  return w ? { ...n, raw_text: w.next_raw_text } : n;
});

describe('clean-name helpers (same strips as canonicalMatchKey)', () => {
  test('display name keeps original case; key is its normalization', () => {
    expect(canonicalDisplayName('Core: Plank  3x45 sec')).toBe('Plank');
    expect(canonicalDisplayName('DB Bench Press — 3×6-8, start at 70 lbs')).toBe('DB Bench Press');
    expect(canonicalMatchKey('Squat 3x6-8, step up')).toBe('squat');
    expect(canonicalMatchKey('DB Bench Press 3x6-8, step up')).toBe('db bench press');
  });
});

describe('owner Squat fixture', () => {
  test('before tidy only W5/W6 match; after tidy W1-W6 all score against the same frozen pair', () => {
    const fx = squatFixture();
    const row = (b) => b.baseline.exercises.find(r => r.key === 'squat');
    const frozen = { w: row(fx.block).best_e1rm_weight, r: row(fx.block).best_e1rm_reps };
    const squatOf = (i, notes) => deriveRecoveryStrength({ block: fx.block, weeks: [fx.weeks[i]], notes: [notes[i]] })
      .lifts.find(l => l.key === 'squat');
    expect([0, 1, 2, 3, 4, 5].map(i => squatOf(i, fx.notes).state === LIFT_STATE.SCORED))
      .toEqual([false, false, false, false, true, true]);
    const plan = planTidyNames(fx);
    expect(plan.ok).toBe(true);
    expect(plan.occurrences.map(o => o.weekNumber)).toEqual([1, 2, 3, 4]);
    const tidied = apply(fx, plan);
    for (let i = 0; i < 6; i++) expect(squatOf(i, tidied).state).toBe(LIFT_STATE.SCORED);
    // Scores come from the unchanged working sets against the unchanged frozen pair.
    expect(squatOf(0, tidied).percent).toBe(squatOf(4, fx.notes).percent);
    expect(row(fx.block).best_e1rm_weight).toBe(frozen.w);
    expect(row(fx.block).best_e1rm_reps).toBe(frozen.r);
  });

  test('W1 does not promote its mid-text scheme: the whole descriptor stays in the note', () => {
    const plan = planTidyNames(squatFixture());
    const w1 = plan.noteWrites[0].next_raw_text;
    expect(w1.split('\n').slice(0, 3)).toEqual([
      '-Squat',
      '- 135 8,8,8',
      '-- empty bar or very light, 3x8 (movement/pain test, not a working set)',
    ]);
    const w2 = plan.noteWrites[1].next_raw_text.split('\n');
    expect(w2.slice(0, 3)).toEqual(['-Squat 3x6-8', '- 135 8,8,8', '-- step up from empty bar 135-155']);
  });

  test('preview lists every occurrence with scheme and moved comment, and cleans nothing else', () => {
    const plan = planTidyNames(squatFixture());
    expect(plan.occurrences).toHaveLength(4);
    expect(plan.occurrences[2]).toMatchObject({ weekNumber: 3, to: 'Squat 3x6-8', scheme: '3x6-8', comment: 'step up' });
    expect(plan.baseline).toEqual([]);
    expect(plan.unchanged).toEqual([{ name: 'Bench' }]);
    expect(plan.noteWrites.map(w => w.week_number)).toEqual([1, 2, 3, 4]);
  });

  test('is idempotent: tidied notes plan nothing and add no second comment', () => {
    const fx = squatFixture();
    const once = planTidyNames(fx);
    const next = { ...fx, notes: apply(fx, once) };
    const again = planTidyNames(next);
    expect(again.empty).toBe(true);
    expect(again.unchanged).toEqual([{ name: 'Squat' }, { name: 'Bench' }]);
    expect(next.notes[1].raw_text.match(/^-- /gm)).toHaveLength(1);
  });
});

describe('owner DB Bench fixture', () => {
  const dbFixture = () => fixture({
    baselineText: '-DB Bench Press\n- 70 8,8,8',
    names: [DB_HEADERS[0]],
    weekTexts: DB_HEADERS.map(h => `-${h}\n- 70 8,8,8\n`),
  });

  test('cleans the baseline row and every linked week together; W1 scheme is promoted', () => {
    const fx = dbFixture();
    expect(fx.block.baseline.exercises[0].name).toBe(DB_HEADERS[0]);
    const plan = planTidyNames(fx);
    expect(plan.ok).toBe(true);
    expect(plan.baseline).toEqual([{
      from_key: fx.block.baseline.exercises[0].key, from_name: DB_HEADERS[0], to_key: 'db bench press', to_name: 'DB Bench Press',
    }]);
    expect(plan.noteWrites).toHaveLength(6);
    expect(plan.noteWrites[0].next_raw_text).toBe(
      '-DB Bench Press 3×6-8\n- 70 8,8,8\n-- start at 70 lbs, build up if clean\n'
    );
    expect(plan.noteWrites[1].next_raw_text).toBe('-DB Bench Press 3x6-8\n- 70 8,8,8\n-- step up\n');
  });
});

describe('text contract', () => {
  const edit = (text, name = 'Squat') => {
    const lines = text.split('\n');
    const ex = parseWorkoutNote(text).sections[0].exercises[0];
    const built = buildOccurrenceEdit(lines, ex, name);
    return { built, out: built.ok ? applyTidyEdits(text, [built.edit]) : null };
  };

  test('changes only the header and one inserted line; CRLF is preserved', () => {
    const text = '-Squat 3x6-8, step up\r\n- 135 8\r\n- 145 6\r\n-- note\r\n';
    const { built, out } = edit(text);
    expect(out).toBe('-Squat 3x6-8\r\n- 135 8\r\n-- step up\r\n- 145 6\r\n-- note\r\n');
    expect(verifyTidyEdits(text, out, [built.edit])).toBeNull();
  });

  test('keeps a missing terminal newline and adopts the file line ending', () => {
    const lf = '-Squat 3x6-8, step up\n- 135 8';
    expect(edit(lf).out).toBe('-Squat 3x6-8\n- 135 8\n-- step up');
    const crlf = '-Squat 3x6-8, step up\r\n- 135 8';
    expect(edit(crlf).out).toBe('-Squat 3x6-8\r\n- 135 8\r\n-- step up');
  });

  test('attaches under a bare first row and before existing comment lines', () => {
    const text = '-Squat 3x6-8, step up\n135 8,8\n-- existing\n';
    const { out, built } = edit(text);
    expect(out).toBe('-Squat 3x6-8\n135 8,8\n-- step up\n-- existing\n');
    expect(verifyTidyEdits(text, out, [built.edit])).toBeNull();
  });

  test('skipped, unparsed and no-set rows never take the comment', () => {
    const text = '-Squat 3x6-8, step up\n-\n- felt heavy\n- 135 8\n';
    expect(firstValidRowLine(text.split('\n'), 1)).toBe(4);
    expect(edit(text).out).toBe('-Squat 3x6-8\n-\n- felt heavy\n- 135 8\n-- step up\n');
    expect(edit('-Squat 3x6-8, step up\n-\n').built).toMatchObject({ ok: false });
    expect(edit('-Squat 3x6-8, step up\n').built).toMatchObject({ ok: false });
  });

  test('numbered headers keep their marker; unsupported headers are refused', () => {
    expect(edit('1. Squat 3x6-8, step up\n- 135 8\n').out).toBe('1. Squat 3x6-8\n- 135 8\n-- step up\n');
    expect(edit('-Squat 3x6-8, step up @135\n- 135 8\n').built).toMatchObject({ ok: false });
    expect(edit('-Squat 3x6-8, step up *PR\n- 135 8\n').built).toMatchObject({ ok: false });
  });

  test('a header whose rows depend on its scheme is refused by the reparse proof', () => {
    const text = '-Squat — warm, 3x8 and 3x10 (rpe)\n8\n8\n';
    const lines = text.split('\n');
    const ex = parseWorkoutNote(text).sections[0].exercises[0];
    const built = buildOccurrenceEdit(lines, ex, 'Squat');
    expect(built.ok).toBe(true);
    expect(built.edit.scheme).toBeNull();
    const out = applyTidyEdits(text, [built.edit]);
    expect(verifyTidyEdits(text, out, [built.edit])).not.toBeNull();
  });

  test('only a compact leading scheme is promoted and cut from the note with its separator', () => {
    expect(edit('-Squat — 3x6-8, start light\n- 45 8\n').out).toBe('-Squat 3x6-8\n- 45 8\n-- start light\n');
    expect(edit('-Squat — 3×8; easy\n- 45 8\n').out).toBe('-Squat 3×8\n- 45 8\n-- easy\n');
    expect(edit('-Squat — 3X6–8 (rpe)\r\n- 45 8').out).toBe('-Squat 3X6–8\r\n- 45 8\r\n-- (rpe)');
    expect(edit('-Squat 3x6-8, step 3x8 more\n- 45 8\n').out).toBe('-Squat 3x6-8\n- 45 8\n-- step 3x8 more\n');
  });

  test.each([
    'do not do 3x8 today',
    '3x8 seconds, easy',
    'light, 3x8-1000, then heavy',
    'light, 3 x 6 - 8, then heavy',
    '3 x 6 - 8, then heavy',
    '3x6-8-10, easy',
    '3x8seconds, easy',
    '10x10, easy',
    'start at 70x8, build up',
    'step @ 135x5 today',
    'try with 10x10 today',
    '3x6-8 or 3x8, step up',
    'light (try 3x8 maybe)',
    '3x8-1000, easy',
    '3x8 , easy',
    '3x8\t(rpe)',
    '3x100, easy',
  ])('"%s" is not promoted and stays byte-for-byte in the note', (d) => {
    const text = `-Squat — ${d}\n- 45 8\n`;
    const { built, out } = edit(text);
    expect(built.ok).toBe(true);
    expect(built.edit.scheme).toBeNull();
    expect(out).toBe(`-Squat\n- 45 8\n-- ${d}\n`);
    expect(verifyTidyEdits(text, out, [built.edit])).toBeNull();
    const plan = planTidyNames(fixture({ baselineText: '-Squat\n- 45 8', weekTexts: [text] }));
    expect(plan.ok).toBe(true);
    expect(plan.noteWrites[0].next_raw_text).toBe(out);
    expect(plan.occurrences[0]).toMatchObject({ scheme: null, comment: d });
  });

  test('scheme-only and parser-folded trailing-scheme headers are skipped with a reason', () => {
    for (const h of ['Squat — 3x8', 'Squat — light, 3x8']) {
      const plan = planTidyNames(fixture({ baselineText: '-Squat\n- 45 8', weekTexts: [`-${h}\n- 45 8\n`] }));
      expect(plan.noteWrites).toEqual([]);
      expect(plan.skipped.map(x => x.name)).toContain('Squat');
    }
  });
});

describe('fail-closed rules', () => {
  const base = () => squatFixture();

  test('a missing, deleted or unparseable linked note fails the whole operation', () => {
    const fx = base();
    expect(planTidyNames({ ...fx, notes: fx.notes.slice(1) })).toMatchObject({ ok: false });
    expect(planTidyNames({ ...fx, notes: fx.notes.map((n, i) => (i === 2 ? { ...n, deleted_at: STAMP } : n)) })).toMatchObject({ ok: false });
    expect(planTidyNames({ ...fx, notes: fx.notes.map((n, i) => (i === 0 ? { ...n, raw_text: null } : n)) })).toMatchObject({ ok: false });
    expect(planTidyNames({ ...fx, block: { ...fx.block, baseline: { version: 1, exercises: [] } } })).toMatchObject({ ok: false });
    expect(planTidyNames({ ...fx, block: { ...fx.block, deleted_at: STAMP } })).toMatchObject({ ok: false });
  });

  test('two baseline rows with one canonical identity skip the lift only', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 225 5\n-Pause Squat\n- 205 5\n-Bench\n- 185 5',
      names: [null, 'Squat 3x5'],
      weekTexts: ['-Squat 3x6-8, step up\n- 135 8\n-Bench 3x5, heavy\n- 185 5\n'],
    });
    const plan = planTidyNames(fx);
    expect(plan.ok).toBe(true);
    expect(plan.skipped.map(s => s.name)).toContain('Squat');
    expect(plan.noteWrites[0].next_raw_text).toContain('-Squat 3x6-8, step up');
    expect(plan.noteWrites[0].next_raw_text).toContain('-Bench 3x5\n- 185 5\n-- heavy');
  });

  test('a target-key collision skips the lift with a reason', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 135 8\n-Row\n- 225 5',
      names: ['Squat — light, 3x8', 'Squat'],
      weekTexts: ['-Squat 3x6-8, step up\n- 135 8\n'],
    });
    const plan = planTidyNames(fx);
    expect(plan.noteWrites).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });

  test('distinct same-canonical entries in one week would merge: skip the whole lift', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 225 5',
      weekTexts: ['-Squat 3x6-8, step up\n- 135 8\n-Squat\n- 225 5\n'],
    });
    const plan = planTidyNames(fx);
    expect(plan.noteWrites).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/merge/);
  });

  test('separate occurrences sharing one messy identity are all rewritten with sets unchanged', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 225 5',
      weekTexts: ['-Squat 3x6-8, step up\n- 135 8\n-Bench\n- 100 5\n-Squat 3x6-8, step up\n- 155 6\n'],
    });
    const plan = planTidyNames(fx);
    expect(plan.occurrences).toHaveLength(2);
    expect(plan.noteWrites[0].next_raw_text).toBe(
      '-Squat 3x6-8\n- 135 8\n-- step up\n-Bench\n- 100 5\n-Squat 3x6-8\n- 155 6\n-- step up\n'
    );
  });

  test('warmups are never rewritten; a colliding messy warmup skips the lift', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 225 5',
      weekTexts: ['+WARMUP\n-Squat 3x6-8, step up\n- 45 8\n+LIFT\n-Squat 3x6-8, step up\n- 135 8\n'],
    });
    const plan = planTidyNames(fx);
    expect(plan.noteWrites).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/warmup/i);
    const ok = fixture({
      baselineText: '-Squat\n- 225 5',
      weekTexts: ['+WARMUP\n-Squat\n- 45 8\n+LIFT\n-Squat 3x6-8, step up\n- 135 8\n'],
    });
    const next = planTidyNames(ok).noteWrites[0].next_raw_text;
    expect(next).toBe('+WARMUP\n-Squat\n- 45 8\n+LIFT\n-Squat 3x6-8\n- 135 8\n-- step up\n');
  });

  test('an unsafe occurrence skips the entire lift, never a subset', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 225 5',
      weekTexts: ['-Squat 3x6-8, step up\n- 135 8\n', '-Squat 3x6-8, step up\n-\n'],
    });
    const plan = planTidyNames(fx);
    expect(plan.noteWrites).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/Week 2/);
  });

  test('baseline-only rows with no logged evidence stay untouched; empty plan is explicit', () => {
    const fx = fixture({ baselineText: '-Squat\n- 135 8', names: ['Squat — light, 3x8'], weekTexts: ['-Bench\n- 100 5\n'] });
    const plan = planTidyNames(fx);
    expect(plan).toMatchObject({ ok: true, empty: true, baseline: [], noteWrites: [] });
  });

  test('cosmetic baseline cleanup shows when the key already equals the target', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 135 8',
      names: [{ name: 'Squat 3x8', key: 'squat' }],
      weekTexts: ['-Squat\n- 135 8\n'],
    });
    const row = fx.block.baseline.exercises[0];
    expect(row.key).toBe('squat');
    const plan = planTidyNames(fx);
    expect(plan.baseline).toEqual([{ from_key: 'squat', from_name: 'Squat 3x8', to_key: 'squat', to_name: 'Squat' }]);
    expect(plan.noteWrites).toEqual([]);
  });

  test('unit preference never affects the plan', () => {
    const fx = squatFixture();
    expect(planTidyNames(fx).signature).toBe(planTidyNames(squatFixture()).signature);
  });

  test('plan signature and evidence change with any reviewed input', () => {
    const fx = squatFixture();
    const plan = planTidyNames(fx);
    const edited = { ...fx, notes: fx.notes.map((n, i) => (i === 0 ? { ...n, updated_at: 'later' } : n)) };
    expect(planTidyNames(edited).evidence).not.toBe(plan.evidence);
    const done = { ...fx, block: { ...fx.block, completed_at: STAMP } };
    expect(planTidyNames(done).signature).not.toBe(plan.signature);
  });
});

describe('regressions with Match names and the baseline rebuild', () => {
  test('tidy leaves no false Match names candidates, before or after', () => {
    const fx = squatFixture();
    expect(planBaselineNameMatches(fx)).toEqual([]);
    const tidied = { ...fx, notes: apply(fx, planTidyNames(fx)) };
    expect(planBaselineNameMatches(tidied)).toEqual([]);
  });

  test('a tidied identity stays matched through an eligible rebuild when the routine still has a messy name', () => {
    const previous = captureRecoveryBaselineFromText('-Squat\n- 225 5');
    const next = captureRecoveryBaselineFromText('-Squat — heavy, 3x5\n- 225 5');
    const kept = preserveNameMatches(previous, next, { loggedKeys: new Set(['squat']) });
    expect(kept.ok).toBe(true);
    expect(kept.baseline.exercises.map(r => [r.key, r.name])).toEqual([['squat', 'Squat']]);
  });

  test('kg-marked and lb rows are untouched by the splice', () => {
    const fx = fixture({
      baselineText: '-Squat\n- 225 5',
      weekTexts: ['-Squat 3x6-8, step up\n- 100kg 5\n- 225 5 *PR\n'],
    });
    const plan = planTidyNames(fx);
    expect(plan.noteWrites[0].next_raw_text).toBe('-Squat 3x6-8\n- 100kg 5\n-- step up\n- 225 5 *PR\n');
  });
});

describe('review inventory, byte fidelity and preview inventory', () => {
  test('lists already-clean occurrences of a changing lift (W5/W6) and every warmup occurrence', () => {
    const plan = planTidyNames(squatFixture());
    expect(plan.clean.filter(c => c.name === 'Squat').map(c => c.weekNumber)).toEqual([5, 6]);
    const fx = fixture({
      baselineText: '-Squat\n- 225 5',
      weekTexts: ['+WARMUP\n-Squat\n- 45 8\n+LIFT\n-Squat 3x6-8, step up\n- 135 8\n'],
    });
    expect(planTidyNames(fx).warmups).toEqual([{ weekNumber: 1, name: 'Squat' }]);
  });

  test('keeps the original spacing before the scheme byte for byte', () => {
    const text = '-Squat  3x6-8, step up\n- 135 8\n';
    const ex = parseWorkoutNote(text).sections[0].exercises[0];
    const built = buildOccurrenceEdit(text.split('\n'), ex, 'Squat');
    expect(applyTidyEdits(text, [built.edit])).toBe('-Squat  3x6-8\n- 135 8\n-- step up\n');
    expect(verifyTidyEdits(text, applyTidyEdits(text, [built.edit]), [built.edit])).toBeNull();
  });

  test('an invalid frozen baseline (incomplete best-set pair) refuses the whole action', () => {
    const fx = squatFixture();
    const bad = { ...fx.block, baseline: { ...fx.block.baseline, exercises: fx.block.baseline.exercises.map((r, i) => (i ? r : { ...r, best_e1rm_reps: undefined })) } };
    const plan = planTidyNames({ ...fx, block: bad });
    expect(plan.ok).toBe(false);
    expect(planTidyNames(squatFixture()).ok).toBe(true);
  });

  test('wholly-unchanged lifts list their per-week occurrences, and warmups are listed whatever their name', () => {
    const fx = fixture({ baselineText: '-Bench\n- 185 5', weekTexts: ['+WARMUP\n-Jumping jacks\n- 10\n+LIFT\n-Bench\n- 185 5\n', '-Bench\n- 185 5\n'] });
    const plan = planTidyNames(fx);
    expect(plan.empty).toBe(true);
    expect(plan.clean).toEqual([{ weekNumber: 1, name: 'Bench' }, { weekNumber: 2, name: 'Bench' }]);
    expect(plan.warmups).toEqual([{ weekNumber: 1, name: 'Jumping jacks' }]);
  });

  test('a removed section prefix joins the single moved note and is previewed', () => {
    const withDesc = fixture({ baselineText: '-Squat\n- 225 5', weekTexts: ['-Core: Squat 3x8, step up\n- 135 8\n'] });
    const plan = planTidyNames(withDesc);
    expect(plan.noteWrites[0].next_raw_text).toBe('-Squat 3x8\n- 135 8\n-- Core: step up\n');
    expect(plan.occurrences[0]).toMatchObject({ to: 'Squat 3x8', comment: 'Core: step up' });
    const bare = fixture({ baselineText: '-Squat\n- 225 5', weekTexts: ['-Core: Squat\n- 135 8\n'] });
    expect(planTidyNames(bare).noteWrites[0].next_raw_text).toBe('-Squat\n- 135 8\n-- Core:\n');
  });

  test.each([
    ['routine_order 99', r => ({ ...r, routine_order: 99 })],
    ['unknown basis', r => ({ ...r, basis: 'invalid' })],
    ['string metric', r => ({ ...r, volume: '3375' })],
    ['null name', r => ({ ...r, name: null })],
  ])('an invalid frozen baseline (%s) refuses the whole action', (_n, mutate) => {
    const fx = squatFixture();
    const bad = { ...fx.block, baseline: { ...fx.block.baseline, exercises: fx.block.baseline.exercises.map((r, i) => (i ? r : mutate(r))) } };
    const plan = planTidyNames({ ...fx, block: bad });
    expect(plan.ok).toBe(false);
    expect(plan.noteWrites).toBeUndefined();
  });
});
