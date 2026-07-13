// Pure snapshot-to-row builders for bootstrapFromLocal.
// No side effects; all functions return plain objects/arrays.

// ── legacy session → note-first synthesis ──────────────────────────────────

export function synthesizeSessionsNote(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;

  const sorted = sessions.slice().sort((a, b) => a.date.localeCompare(b.date));

  const exerciseOrder = [];
  const seen = new Set();
  for (const session of sorted) {
    for (const item of session.items || []) {
      if (!seen.has(item.exercise_name)) {
        seen.add(item.exercise_name);
        exerciseOrder.push(item.exercise_name);
      }
    }
  }

  const entriesByExercise = new Map();
  for (const name of exerciseOrder) {
    entriesByExercise.set(
      name,
      sorted.map((session) => {
        const item = (session.items || []).find((i) => i.exercise_name === name);
        if (!item) return { kind: 'skip' };

        const weightGroups = [];
        const extraParts = [];

        for (const s of item.sets || []) {
          if (s.weight_value != null && s.rep_count != null) {
            const prev = weightGroups[weightGroups.length - 1];
            if (prev && prev.weight === s.weight_value) {
              prev.reps.push(s.rep_count);
            } else {
              weightGroups.push({ weight: s.weight_value, reps: [s.rep_count] });
            }
            if (s.note_text) extraParts.push(`[${s.note_text}]`);
          } else {
            const parts = [];
            if (s.assistance_value != null) {
              parts.push(
                s.assistance_unit
                  ? `assist:${s.assistance_value} ${s.assistance_unit}`
                  : `assist:${s.assistance_value}`
              );
            }
            if (s.rep_count != null) parts.push(`×${s.rep_count}`);
            if (s.duration_seconds != null) parts.push(`${s.duration_seconds}s`);
            if (s.note_text) parts.push(`[${s.note_text}]`);
            if (parts.length) extraParts.push(parts.join(' '));
          }
        }
        if (item.note_text) extraParts.push(item.note_text);

        if (weightGroups.length > 0) {
          const row = weightGroups
            .map(({ weight, reps }) => `${weight} ${reps.join(',')}`)
            .join(' ');
          const comments = extraParts.length > 0 ? [`-- ${extraParts.join(', ')}`] : [];
          return { kind: 'weight', row, comments };
        }
        if (extraParts.length > 0) {
          return { kind: 'nonweight', text: extraParts.join(', ') };
        }
        return { kind: 'skip' };
      })
    );
  }

  const lines = [`-- ${sorted.map((s) => s.date).join(', ')}`];
  for (const name of exerciseOrder) {
    lines.push(`-${name}`);
    for (const entry of entriesByExercise.get(name)) {
      if (entry.kind === 'weight') {
        lines.push(`- ${entry.row}`);
        for (const c of entry.comments) lines.push(c);
      } else if (entry.kind === 'nonweight') {
        lines.push(`- ${entry.text}`);
      } else {
        lines.push('-');
      }
    }
  }

  return lines.join('\n');
}

// ── payload builders (pure) ─────────────────────────────────────────────────

function buildUserProfileRow(snapshot, userId) {
  const {
    userProfile,
    currentWorkoutId,
    fatigueMultiplier,
    trackedLifts,
    logCurrentCollapsed,
    deloadNote,
  } = snapshot;

  const profile = userProfile || {};

  const row = {
    user_id: userId,
    display_name: profile.display_name ?? null,
    unit_system: profile.unit_system ?? null,
    current_workout_note_id: currentWorkoutId ?? null,
    fatigue_multiplier: fatigueMultiplier ?? null,
    tracked_lifts: trackedLifts ?? {},
    ui_state: { log_current_collapsed: !!logCurrentCollapsed },
    profile_json: null,
    updated_at: new Date().toISOString(),
  };

  if (deloadNote) {
    row.current_deload_note_raw_text = deloadNote.raw_text ?? null;
    row.current_deload_note_saved_at = deloadNote.saved_at ?? null;
    row.current_deload_note_updated_at = deloadNote.updated_at ?? null;
  }

  return row;
}

function buildFeatureTogglesRow(snapshot, userId) {
  return {
    user_id: userId,
    weight_date_edit_enabled: !!snapshot.weightDateEditEnabled,
    deload_date_edit_enabled: !!snapshot.deloadDateEditEnabled,
    fatigue_tracking_enabled: snapshot.fatigueTrackingEnabled !== false,
    deload_mode_enabled: snapshot.deloadModeEnabled !== false,
    updated_at: new Date().toISOString(),
  };
}

function buildWeightEntryRows(snapshot, userId) {
  const now = new Date().toISOString();
  return (snapshot.weightEntries || []).map((e) => ({
    user_id: userId,
    id: e.id,
    entry_type: e.entry_type || 'weight',
    date: e.date ?? null,
    logged_at: e.logged_at ?? null,
    weight_value: e.weight_value,
    note: e.note ?? null,
    saved_at: e.saved_at ?? null,
    updated_at: now,
  }));
}

function buildWeightGoalRow(snapshot, userId) {
  const g = snapshot.weightGoal;
  if (!g) return null;
  const PROMOTED = new Set([
    'target_weight',
    'target_date',
    'start_weight',
    'start_date',
    'saved_at',
  ]);
  const goalJson = {};
  for (const [k, v] of Object.entries(g)) {
    if (!PROMOTED.has(k)) goalJson[k] = v;
  }
  return {
    user_id: userId,
    target_weight: g.target_weight ?? null,
    target_date: g.target_date ?? null,
    start_weight: g.start_weight ?? null,
    start_date: g.start_date ?? null,
    goal_json: Object.keys(goalJson).length ? goalJson : null,
    saved_at: g.saved_at ?? null,
    updated_at: new Date().toISOString(),
  };
}

function buildWorkoutNoteRows(snapshot, userId) {
  const now = new Date().toISOString();
  const byId = new Map();
  const currentId = snapshot.currentWorkoutId ?? null;

  const put = (row) => {
    if (!row || !row.id) return;
    byId.set(row.id, row);
  };

  for (const n of snapshot.workoutNotes || []) {
    put({
      user_id: userId,
      id: n.id,
      title: n.title ?? null,
      raw_text: n.raw_text ?? '',
      saved_at: n.saved_at ?? null,
      updated_at: n.updated_at ?? now,
      tracked_exercises: n.tracked_exercises ?? null,
      one_k_exercises: n.one_k_exercises ?? null,
      skip_markers: n.skip_markers ?? null,
      attendance_flags: n.attendance_flags ?? null,
      exercise_classifications: n.exercise_classifications ?? null,
      session_checkins: n.session_checkins ?? null,
      is_current: currentId != null && n.id === currentId,
      source_snapshot: null,
    });
  }

  // Only import the legacy single note when the notebook has no entries.
  // Mirrors migrateToNotebook's no-op guard: if the user is already in
  // multi-note mode, the legacy kilo_workout_note has already been consumed
  // by the local migration (or is intentionally absent from the notebook).
  // Importing it here when workoutNotes is non-empty creates a phantom
  // "Routine 1" copy even when the user never created one.
  const legacy = snapshot.workoutNote;
  const notebookHasEntries = (snapshot.workoutNotes || []).length > 0;
  if (legacy && legacy.raw_text != null && !notebookHasEntries) {
    const alreadyImported = [...byId.values()].some(
      (r) => r.raw_text === legacy.raw_text
    );
    if (!alreadyImported) {
      const id = `wn_legacy_${userId}`;
      put({
        user_id: userId,
        id,
        title: 'Routine 1',
        raw_text: legacy.raw_text ?? '',
        saved_at: legacy.saved_at ?? null,
        updated_at: legacy.updated_at ?? now,
        tracked_exercises: legacy.tracked_exercises ?? null,
        one_k_exercises: legacy.one_k_exercises ?? null,
        skip_markers: null,
        attendance_flags: null,
        exercise_classifications: null,
        session_checkins: null,
        is_current: currentId === id,
        source_snapshot: { async_storage_key: 'kilo_workout_note' },
      });
    }
  }

  const sessions = snapshot.workoutSessions;
  if (Array.isArray(sessions) && sessions.length > 0) {
    const rawText = synthesizeSessionsNote(sessions);
    if (rawText != null) {
      const id = `wn_sessions_${userId}`;
      put({
        user_id: userId,
        id,
        title: 'Imported sessions',
        raw_text: rawText,
        saved_at: null,
        updated_at: now,
        tracked_exercises: null,
        one_k_exercises: null,
        skip_markers: null,
        attendance_flags: null,
        exercise_classifications: null,
        session_checkins: null,
        is_current: currentId === id,
        source_snapshot: {
          async_storage_key: 'kilo_workout_sessions',
          sessions,
        },
      });
    }
  }

  return [...byId.values()];
}

function buildDeloadHistoryRows(snapshot, userId) {
  const now = new Date().toISOString();
  const PROMOTED = new Set(['id', 'date', 'raw_text', 'saved_at']);
  return (snapshot.deloadHistory || []).map((r) => {
    const recordJson = {};
    for (const [k, v] of Object.entries(r)) {
      if (!PROMOTED.has(k)) recordJson[k] = v;
    }
    return {
      user_id: userId,
      id: r.id,
      date: r.date ?? null,
      raw_text: r.raw_text ?? null,
      record_json: Object.keys(recordJson).length ? recordJson : null,
      saved_at: r.saved_at ?? null,
      updated_at: now,
    };
  });
}

export function buildBootstrapPlan(snapshot, userId) {
  return {
    user_profile: [buildUserProfileRow(snapshot, userId)],
    feature_toggles: [buildFeatureTogglesRow(snapshot, userId)],
    weight_entries: buildWeightEntryRows(snapshot, userId),
    weight_goal: (() => {
      const row = buildWeightGoalRow(snapshot, userId);
      return row ? [row] : [];
    })(),
    workout_notes: buildWorkoutNoteRows(snapshot, userId),
    deload_history: buildDeloadHistoryRows(snapshot, userId),
  };
}
