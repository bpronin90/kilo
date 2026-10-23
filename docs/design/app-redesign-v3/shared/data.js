// Realistic prototype data. Mirrors the fixture used for the baseline capture
// (baseline/capture-baseline.cjs) and the values the current app derived from it
// (Exercise Progress 5/4/0, the Progressive Overload table, weight trends, Training
// breakdown Last 12). Workout history is SESSION-based: each set line under an exercise
// is one session; no session carries a date. Only weigh-ins and goals are dated.
(function () {
  const prog = (start, step, n, reps) => Array.from({ length: n }, (_, i) => ({ load: start + step * Math.floor(i / 2), reps }));
  const bw = (arr) => arr.map((reps) => ({ load: null, reps }));
  const ex = (name, tracked, sessions, extra = {}) => ({ name, tracked, sessions, ...extra });

  const days = [
    { key: 'mon', day: 'Monday', name: 'Upper', blocks: [
      { name: 'Strength', exercises: [
        ex('Bench Press', true, prog(205, 5, 10, [5, 5, 5])),
        ex('Barbell Row', true, prog(165, 5, 10, [8, 8, 8])),
      ] },
      { name: 'Accessories', exercises: [
        ex('Incline Dumbbell Press', true, prog(60, 5, 8, [10, 10, 9]), { range: '3x8-10' }),
        ex('Lateral Raise', false, prog(20, 0, 8, [15, 15, 12])),
        ex('Triceps Pushdown', false, prog(55, 5, 8, [12, 12, 10])),
      ] },
    ] },
    { key: 'tue', day: 'Tuesday', name: 'Lower', blocks: [
      { name: 'Strength', exercises: [
        ex('Back Squat', true, prog(275, 5, 10, [5, 5, 5])),
        ex('Romanian Deadlift', true, prog(205, 10, 8, [8, 8, 8])),
      ] },
      { name: 'Accessories', exercises: [
        ex('Leg Press', true, prog(360, 20, 8, [10, 10, 10])),
        ex('Standing Calf Raise', false, prog(180, 0, 8, [15, 15, 15])),
      ] },
    ] },
    { key: 'thu', day: 'Thursday', name: 'Upper', blocks: [
      { name: 'Strength', exercises: [
        ex('Overhead Press', true, prog(115, 5, 9, [6, 6, 6])),
        ex('Pull Up', true, bw([[8, 8, 7], [8, 8, 8], [9, 8, 8], [9, 9, 8], [10, 9, 8], [10, 9, 9], [10, 10, 9], [10, 10, 10]])),
      ] },
      { name: 'Accessories', exercises: [
        ex('Face Pull', false, prog(50, 0, 8, [15, 15, 15])),
        ex('EZ Bar Curl', false, prog(65, 5, 8, [10, 10, 8])),
      ] },
    ] },
    { key: 'fri', day: 'Friday', name: 'Lower', blocks: [
      { name: 'Strength', exercises: [
        ex('Deadlift', true, prog(365, 10, 9, [3, 3, 3])),
        ex('Walking Lunge', false, prog(40, 5, 8, [10, 10])),
        ex('Cable Crunch', false, bw([[12, 12, 12], [12, 12, 12], [15, 12, 12], [15, 15, 12], [15, 15, 15], [15, 15, 15]])),
      ] },
    ] },
  ];

  // Progressive Overload values exactly as the current app derived them for this note.
  const po = [
    { day: 'Monday', rows: [
      { name: 'Bench Press', e1rm: 228, kilo: 261, best: 195, trend: 'up' },
      { name: 'Barbell Row', e1rm: 234, kilo: 237, best: 185, trend: 'flat' },
      { name: 'Incline Dumbbell Press', e1rm: 100, kilo: 95, best: 75, trend: 'flat' },
    ] },
    { day: 'Tuesday', rows: [
      { name: 'Back Squat', e1rm: 274, kilo: 335, best: 235, trend: 'up' },
      { name: 'Romanian Deadlift', e1rm: 298, kilo: 298, best: 235, trend: 'flat' },
      { name: 'Leg Press', e1rm: 560, kilo: 556, best: 420, trend: 'flat' },
    ] },
    { day: 'Thursday', rows: [
      { name: 'Overhead Press', e1rm: 162, kilo: 159, best: 135, trend: 'up' },
      { name: 'Pull Up', reps: true, avg: 10, bestReps: 10, trend: 'up' },
    ] },
    { day: 'Friday', rows: [
      { name: 'Deadlift', e1rm: 380, kilo: 441, best: 345, trend: 'up' },
    ] },
  ];

  // Per-session e1RM (Epley on the top set) for sparklines, from the same note.
  const byName = {};
  days.forEach((d) => d.blocks.forEach((b) => b.exercises.forEach((e) => { byName[e.name] = e; })));
  const e1rmSeries = (name) => {
    const e = byName[name];
    if (!e) return [];
    const raw = e.sessions.map((s) => (s.load == null ? Math.max(...s.reps) : s.load * (1 + Math.max(...s.reps) / 30)));
    // Anchor to the Progressive Overload row so the chart's last point matches the table, and
    // plateau the last four sessions for Steady rows so the shape never contradicts the label.
    const row = po.flatMap((g) => g.rows).find((r) => r.name === name);
    const end = row ? (row.reps ? row.avg : row.e1rm) : raw[raw.length - 1];
    const k = end / raw[raw.length - 1];
    const out = raw.map((v) => Math.round(v * k));
    if (row && row.trend !== 'up') for (let i = out.length - 4; i < out.length; i += 1) out[i] = end + (i % 2 ? 0 : -1);
    out[out.length - 1] = end;
    return out;
  };

  // Weigh-ins: dated (weight is the one date-based history in Kilo).
  const today = new Date(2026, 9, 22);
  const weights = [];
  for (let d = 62; d >= 0; d -= (d % 3 === 0 ? 2 : 1)) {
    const w = 192.4 - (62 - d) * 0.075 + Math.sin(d * 1.7) * 0.6;
    const dt = new Date(today.getTime() - d * 86400000);
    weights.push({ ago: d, date: dt, value: Math.round(w * 10) / 10, note: d % 9 === 0 ? 'Morning, fasted' : '' });
  }
  const fmtDate = (dt) => `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}-${dt.getFullYear()}`;

  window.KILO_DATA = {
    routine: { title: 'Upper / Lower — Block 3', week: 9, weekLetter: 'A', hasWeekB: true, days },
    otherRoutines: [
      { title: 'Push Pull Legs', created: '05-11-2026', meta: 'Week B' },
      { title: 'Strength 5×5', created: '02-02-2026', meta: '' },
    ],
    progress: { progressing: 5, steady: 4, regressing: 0, tracked: 9 },
    po, e1rmSeries,
    oneK: { total: 882, squat: 274, bench: 228, deadlift: 380, mapping: ['Back Squat', 'Bench Press', 'Deadlift'],
      // 1K total by logged session (x = session index, not dates).
      bySession: [812, 818, 829, 834, 846, 851, 858, 866, 874, 882] },
    routineHealth: { sinceDeload: 7, total: 10, caption: 'Fatigue setting in', deloadMode: true },
    checkins: { recent: ['ok', 'ok', 'flag', 'ok', 'ok', 'ok', 'flag', 'ok', 'ok', 'ok'], common: 'Poor sleep' },
    weight: {
      unit: 'lb', entries: weights, fmtDate,
      latest: 187.8, prev: -0.6, avg7: 188.0, avg7d: -0.7, avg30: 188.9, avg30d: -2.3, count: 43,
      goal: { mode: 'Cutting', target: 183, start: 192.4, targetDate: '01-01-2027', toGo: 4.8, pace: 0.47, deficit: 237, weeksLeft: 10, status: 'On goal' },
      goalHistory: [{ mode: 'Bulking', target: 195, end: 194.6, targetDate: '06-30-2026', outcome: 'Met' }],
    },
    breakdown: {
      window: 'Last 12', sets: 416, exercises: 16, timed: 0,
      compared: [{ a: 'Push', av: 63, b: 'Pull', bv: 54 }, { a: 'Knee-dominant', av: 80, b: 'Hip-dominant', bv: 57 }],
      groups: [['Squat', 64, 15], ['Hip hinge', 57, 14], ['Horizontal push', 36, 9], ['Horizontal pull', 30, 7], ['Vertical push', 27, 6]],
      moreGroups: 7, classified: 88,
      regions: [['Chest', 58, 'Pecs'], ['Back', 92, 'Lats'], ['Shoulders', 64, 'Side delts'], ['Arms', 72, 'Biceps'], ['Legs', 104, 'Quads'], ['Core', 26, 'Abs']],
      equipment: [['Barbell', 166], ['Dumbbell', 64], ['Cable machine', 62], ['Machine', 48], ['Bodyweight', 52]],
    },
    recovery: { week: 2, total: 86, lifts: [['Back Squat', 92], ['Bench Press', 81], ['Deadlift', 88]],
      bands: { at: 3, rebuilding: 4, early: 1, notYet: 2 }, baseline: 'Upper / Lower — Block 3' },
    account: { email: 'you@example.com', sync: 'Synced', version: '1.21.2' },
  };
})();
