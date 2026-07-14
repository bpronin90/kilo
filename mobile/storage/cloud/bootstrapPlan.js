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

// ── shared upload allowlists (issues #471/#475) ─────────────────────────────
//
// Exported so the ongoing sync path (storage/cloud/syncAdapter.js, issue #489)
// promotes exactly the same fields bootstrap does. Keeping one definition
// prevents the two paths from drifting into uploading different column sets.

// The only fields the local weight-goal object legitimately promotes to the
// cloud `weight_goal` row. Production audit (2026-07-13) found goal_json empty
// on every row, so nothing else is forwarded — an unknown key added to the local
// goal object must not upload silently via an Object.entries catch-all.
export const WEIGHT_GOAL_SYNC_FIELDS = Object.freeze([
  'target_weight',
  'target_date',
  'start_weight',
  'start_date',
  'goal_json',
  'saved_at',
]);

// The fitness metadata the app legitimately carries in `deload_history.record_json`,
// per the production audit (2026-07-13) of the live deload_history row. Any other
// local key is dropped instead of uploaded.
export const DELOAD_RECORD_JSON_FIELDS = Object.freeze([
  'completed_at',
  'deload_session_ordinal',
  'generated_at',
  'note_id',
  'session_count',
]);

// ── payload builders (pure) ─────────────────────────────────────────────────

// Account settings only. The six health values this row used to carry moved to
// user_health_profile in #487 and are built by buildUserHealthProfileRow below.
//
// A consent-capable client must NOT write them here, for two reasons: it would be
// an ungated health write while the gate is armed, and the contract migration drops
// those columns outright — an upsert naming them would then fail with PGRST204 and
// break profile sync entirely. display_name, unit_system, and ui_state are ordinary
// preferences and keep syncing for a user who refuses health consent.
function buildUserProfileRow(snapshot, userId) {
  const { userProfile, logCurrentCollapsed } = snapshot;

  const profile = userProfile || {};

  return {
    user_id: userId,
    display_name: profile.display_name ?? null,
    unit_system: profile.unit_system ?? null,
    ui_state: { log_current_collapsed: !!logCurrentCollapsed },
    updated_at: new Date().toISOString(),
  };
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
  // Explicit allowlist (issue #475): see WEIGHT_GOAL_SYNC_FIELDS above.
  const row = { user_id: userId, updated_at: new Date().toISOString() };
  for (const field of WEIGHT_GOAL_SYNC_FIELDS) {
    row[field] = g[field] ?? null;
  }
  // goal_json has never carried anything in production; bootstrap keeps writing
  // it as null rather than promoting whatever a local goal object happens to hold.
  row.goal_json = null;
  return row;
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

// Project one local deload-history record onto its cloud `record_json` payload.
// Shared with the ongoing sync path so both promote the same keys (issue #489).
export function buildDeloadRecordJson(record) {
  const recordJson = {};
  for (const key of DELOAD_RECORD_JSON_FIELDS) {
    if (record[key] !== undefined) recordJson[key] = record[key];
  }
  return Object.keys(recordJson).length ? recordJson : null;
}

function buildDeloadHistoryRows(snapshot, userId) {
  const now = new Date().toISOString();
  // Explicit allowlist (issue #475): id, date, raw_text, and saved_at are
  // promoted to named columns; everything else must go through
  // DELOAD_RECORD_JSON_FIELDS. No Object.entries catch-all.
  return (snapshot.deloadHistory || []).map((r) => {
    const recordJson = buildDeloadRecordJson(r);
    return {
      user_id: userId,
      id: r.id,
      date: r.date ?? null,
      raw_text: r.raw_text ?? null,
      record_json: recordJson,
      saved_at: r.saved_at ?? null,
      updated_at: now,
    };
  });
}

// The six values that used to ride along on the mixed user_profile row. They are
// data concerning health under Art. 9, so they now live in their own consent-gated
// table (issue #487) and are uploaded separately. During the expand phase the
// server still mirrors them back onto user_profile for older clients; after the
// contract migration those columns are gone and this is the only place they exist.
function buildUserHealthProfileRow(snapshot, userId) {
  const { currentWorkoutId, fatigueMultiplier, trackedLifts, deloadNote } = snapshot;
  const note = deloadNote || {};

  return {
    user_id: userId,
    current_workout_note_id: currentWorkoutId ?? null,
    fatigue_multiplier: fatigueMultiplier ?? null,
    tracked_lifts: trackedLifts ?? {},
    current_deload_note_raw_text: note.raw_text ?? null,
    current_deload_note_saved_at: note.saved_at ?? null,
    current_deload_note_updated_at: note.updated_at ?? null,
  };
}

export function buildBootstrapPlan(snapshot, userId) {
  return {
    user_profile: [buildUserProfileRow(snapshot, userId)],
    user_health_profile: [buildUserHealthProfileRow(snapshot, userId)],
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
