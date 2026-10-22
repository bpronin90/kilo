// Hybrid prototype data. Dated occurrence records (one row per exercise per
// session) feed a replica of deriveTrainingBreakdown's bucketing, so every
// range (30D / 90D / All) is a real re-derivation, not a scaled total.
// Records are assumed to already be eligible ordinary history: Recovery notes,
// warm-ups, skipped sets and unparsed rows were excluded upstream, exactly as
// deriveParsedSections does before the breakdown runs.
(function () {
  const TODAY = new Date('2026-10-22T12:00:00');
  const DAY = 86400000;
  // [name, group, primary, secondary, equipment, everyNDays, offset, setsPerSession, firstDayAgo, extra]
  const EX = [
    ['Bench Press', 'horizontal_push', ['pectoralis_major'], ['anterior_deltoid', 'triceps_brachii'], ['barbell', 'flat_bench', 'rack'], 7, 0, 4, 200],
    ['Incline Dumbbell Press', 'horizontal_push', ['pectoralis_major'], ['anterior_deltoid', 'triceps_brachii'], ['dumbbell', 'adjustable_bench'], 7, 3, 3, 150],
    ['Dips', 'vertical_push', ['triceps_brachii', 'pectoralis_major'], ['anterior_deltoid'], ['dip_bars'], 14, 3, 3, 120],
    ['Overhead Press', 'vertical_push', ['anterior_deltoid'], ['lateral_deltoid', 'triceps_brachii'], ['barbell', 'rack'], 7, 3, 3, 200],
    ['Barbell Row', 'horizontal_pull', ['latissimus_dorsi', 'rhomboids'], ['posterior_deltoid', 'biceps_brachii'], ['barbell'], 7, 1, 4, 200],
    ['Seated Cable Row', 'horizontal_pull', ['latissimus_dorsi', 'rhomboids'], ['biceps_brachii'], ['seated_cable_row_machine'], 7, 4, 3, 90],
    ['Pull-ups', 'vertical_pull', ['latissimus_dorsi'], ['biceps_brachii', 'lower_trapezius'], ['pull_up_bar'], 7, 4, 3, 200],
    ['Lat Pulldown', 'vertical_pull', ['latissimus_dorsi'], ['biceps_brachii'], ['lat_pulldown_machine'], 14, 1, 3, 200],
    ['Back Squat', 'squat', ['quadriceps', 'gluteus_maximus'], ['hip_adductors', 'erector_spinae'], ['barbell', 'rack'], 7, 2, 5, 200],
    ['Romanian Deadlift', 'hip_hinge', ['hamstrings', 'gluteus_maximus'], ['erector_spinae'], ['barbell'], 7, 5, 3, 100],
    ['RDL', 'hip_hinge', ['hamstrings', 'gluteus_maximus'], ['erector_spinae'], ['barbell'], 7, 5, 3, 200, { until: 100 }],
    ['Deadlift', 'hip_hinge', ['gluteus_maximus', 'hamstrings', 'erector_spinae'], ['quadriceps', 'forearm_flexors'], ['barbell', 'weight_plates'], 14, 5, 3, 200],
    ['Bulgarian Split Squat', 'lunge_step', ['quadriceps', 'gluteus_maximus'], ['hip_adductors'], ['dumbbell', 'adjustable_bench'], 7, 5, 3, 80],
    ['Cossack Squat', 'lunge_step', ['quadriceps', 'hip_adductors'], ['gluteus_maximus'], [], 14, 2, 2, 60],
    ['Leg Extension', 'knee_extension', ['quadriceps'], [], ['leg_extension_machine'], 7, 2, 3, 45],
    ['Seated Leg Curl', 'knee_flexion', ['hamstrings'], ['gastrocnemius'], ['seated_leg_curl_machine'], 7, 5, 3, 120],
    ['Standing Calf Raise', 'calf_ankle', ['gastrocnemius'], ['soleus'], ['standing_calf_raise_machine'], 7, 2, 3, 120],
    ['Lateral Raise', 'shoulder_isolation', ['lateral_deltoid'], ['upper_trapezius'], ['dumbbell'], 7, 3, 4, 200],
    ['Face Pull', 'shoulder_isolation', ['posterior_deltoid'], ['rhomboids', 'infraspinatus'], ['cable_machine', 'cable_rope_attachment'], 7, 1, 3, 200, { override: 'Pull' }],
    ['EZ Bar Curl', 'elbow_flexion', ['biceps_brachii'], ['brachialis', 'brachioradialis'], ['ez_bar'], 7, 4, 3, 200],
    ['Tricep Pushdown', 'elbow_extension', ['triceps_brachii'], [], ['cable_machine', 'cable_rope_attachment'], 7, 0, 3, 200],
    ['Hanging Leg Raise', 'trunk_movement', ['rectus_abdominis', 'hip_flexors'], ['obliques'], ['pull_up_bar'], 7, 4, 3, 150],
    ['Pallof Press', 'trunk_stability', ['obliques', 'transversus_abdominis'], ['rectus_abdominis'], ['cable_machine'], 14, 2, 3, 120],
    ['Spoto Press', 'unclassified', null, null, null, 14, 0, 3, 70],
    ['Kroc Row', 'horizontal_pull', ['latissimus_dorsi'], ['biceps_brachii'], null, 14, 1, 2, 50],
  ];
  const TIMED = [['Plank', 7, 2, 2, 200], ['Treadmill', 7, 6, 1, 200]];

  const RECORDS = [];
  const iso = (ago) => new Date(TODAY - ago * DAY).toISOString().slice(0, 10);
  for (const [name, group, prim, sec, eq, every, off, sets, first, extra = {}] of EX) {
    for (let ago = first; ago >= (extra.until || 0); ago -= 1) if ((ago + off) % every === 0) {
      RECORDS.push({ date: iso(ago), ago, name, group, prim, sec, eq, sets, override: extra.override || null });
    }
  }
  const TIMED_RECORDS = [];
  for (const [name, every, off, entries, first] of TIMED) {
    for (let ago = first; ago >= 0; ago -= 1) if ((ago + off) % every === 0) TIMED_RECORDS.push({ date: iso(ago), ago, name, entries });
  }

  const GROUP_LABEL = {
    horizontal_push: 'Horizontal push', vertical_push: 'Vertical push', horizontal_pull: 'Horizontal pull', vertical_pull: 'Vertical pull',
    squat: 'Squat', lunge_step: 'Lunge / step', hip_hinge: 'Hip hinge', hip_extension: 'Hip extension', knee_flexion: 'Knee flexion',
    knee_extension: 'Knee extension', calf_ankle: 'Calf / ankle', shoulder_isolation: 'Shoulder isolation', elbow_flexion: 'Elbow flexion',
    elbow_extension: 'Elbow extension', trunk_movement: 'Trunk movement', trunk_stability: 'Trunk stability',
  };
  const human = (id) => { const t = id.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
  function add(map, id, label, ex, sets, extra) {
    let b = map.get(id);
    if (!b) { b = { id, label, sets: 0, exercises: new Map(), ...(extra || {}) }; map.set(id, b); }
    b.sets += sets;
    const e = b.exercises.get(ex); if (e) e.sets += sets; else b.exercises.set(ex, { name: ex, sets });
  }
  const finish = (m) => [...m.values()].map((b) => ({ ...b, exercises: [...b.exercises.values()].sort((a, c) => c.sets - a.sets || a.name.localeCompare(c.name)) }))
    .sort((a, c) => c.sets - a.sets || a.label.localeCompare(c.label));

  // Mirrors deriveTrainingBreakdown's output shape. `regions` is the one
  // prototype-only addition (see README / handoff): distinct sets per region.
  function derive(maxAgo, REGIONS) {
    const rows = RECORDS.filter((r) => r.ago <= maxAgo);
    const mv = new Map(), uncl = new Map(), pr = new Map(), se = new Map(), unkM = new Map(), eq = new Map(), unkE = new Map(), reg = new Map();
    const cov = { total: 0, movement: 0, primary: 0, secondary: 0, equipment: 0, overridden: 0 };
    const exNames = new Set();
    for (const r of rows) {
      cov.total += r.sets; exNames.add(r.name.toLowerCase());
      if (r.override) { cov.movement += r.sets; cov.overridden += r.sets; add(mv, 'legacy:' + r.override, r.override, r.name, r.sets, { source: 'override' }); }
      else if (r.group !== 'unclassified') { cov.movement += r.sets; add(mv, r.group, GROUP_LABEL[r.group], r.name, r.sets, { source: 'library' }); }
      else add(uncl, 'unclassified', 'Unclassified', r.name, r.sets);
      if (r.prim) { cov.primary += r.sets; r.prim.forEach((m) => add(pr, m, human(m), r.name, r.sets)); }
      else add(unkM, 'unknown', 'Unknown muscles', r.name, r.sets);
      if (r.sec) { cov.secondary += r.sets; r.sec.forEach((m) => add(se, m, human(m), r.name, r.sets)); }
      if (r.eq) { cov.equipment += r.sets; if (!r.eq.length) add(eq, 'no_equipment', 'No equipment needed', r.name, r.sets); r.eq.forEach((e) => add(eq, e, human(e), r.name, r.sets)); }
      else add(unkE, 'unknown', 'Unknown equipment', r.name, r.sets);
      // Region: a set counts once per region it targets as PRIMARY.
      if (r.prim) for (const [rid, ids] of Object.entries(REGIONS)) if (r.prim.some((m) => ids.includes(m))) add(reg, rid, rid, r.name, r.sets);
    }
    const timedRows = TIMED_RECORDS.filter((r) => r.ago <= maxAgo);
    const tm = new Map(); timedRows.forEach((r) => add(tm, 'timed', 'Timed and cardio activity', r.name, r.entries, { unit: 'entry' }));
    const c = (k) => ({ knownSets: k, totalSets: cov.total });
    return {
      scope: 'Eligible ordinary history',
      totals: { completedSets: cov.total, activityEntries: timedRows.reduce((s, r) => s + r.entries, 0), exerciseCount: exNames.size },
      movement: { groups: finish(mv), unclassified: finish(uncl)[0] || null, coverage: c(cov.movement), overriddenSets: cov.overridden, unreadableOverrideNotes: 0 },
      muscles: { primary: finish(pr), secondary: finish(se), unknown: finish(unkM)[0] || null, coverage: { primary: c(cov.primary), secondary: c(cov.secondary) }, regions: finish(reg) },
      equipment: { items: finish(eq), unknown: finish(unkE)[0] || null, coverage: c(cov.equipment) },
      timed: finish(tm)[0] || null,
    };
  }
  window.KILO_PROTO = { derive, recordCount: RECORDS.length };
})();
