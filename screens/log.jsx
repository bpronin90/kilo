// log.jsx — Kilo Log Session screen with live parser

function groupSetsByWeight(sets) {
  const groups = [];
  let cur = null;
  for (const s of sets) {
    if (cur && cur.weight === s.weight_value) {
      cur.reps.push(s.rep_count);
    } else {
      cur = { weight: s.weight_value, reps: [s.rep_count] };
      groups.push(cur);
    }
  }
  return groups;
}

function ParsePreview({ raw }) {
  const result = window.parseWorkoutRow(raw);
  if (!raw || !raw.trim() || result.blank) return <div style={{ height: 22 }} />;
  if (result.skipped) {
    return (
      <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Skipped
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.yellow, letterSpacing: '0.06em' }}>
        ⚠ {result.error}
      </div>
    );
  }
  const groups = groupSetsByWeight(result.sets);
  const maxW = Math.max(...groups.filter(g => g.weight !== null).map(g => g.weight), -Infinity);
  const totalR = result.sets.reduce((s, x) => s + x.rep_count, 0);
  const totalV = result.sets.reduce((s, x) => s + (x.weight_value || 0) * x.rep_count, 0);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {groups.map((g, i) => {
        const isTop = g.weight !== null && g.weight === maxW;
        return (
          <div key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: isTop ? KILO_C.accentDim : KILO_C.bg2,
            border: `1px solid ${isTop ? 'transparent' : KILO_C.border2}`,
            padding: '3px 7px', borderRadius: 3,
          }}>
            {g.weight !== null && (
              <>
                <KiloNum size={11} weight={600} color={isTop ? KILO_C.accent : KILO_C.ink}>{g.weight}</KiloNum>
                <span className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3 }}>×</span>
              </>
            )}
            <span className="kilo-mono" style={{ fontSize: 11, color: isTop ? KILO_C.accent : KILO_C.ink2, fontWeight: 500 }}>
              {g.reps.join(',')}
            </span>
          </div>
        );
      })}
      <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, marginLeft: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {totalR}r{totalV > 0 ? ` · ${Math.round(totalV)}lb` : ''}
      </div>
    </div>
  );
}

function ExerciseRow({ ex, raw, setRaw, lastRef, focused, setFocused, saveError }) {
  const result = window.parseWorkoutRow(raw);
  const ok = result.ok && !result.blank;
  const lastParsed = lastRef ? window.parseKiloInput(lastRef.raw) : null;
  const lastTop = lastParsed ? window.topSet(lastParsed) : null;

  // 1RM via legacy parser (read-only analytics, unchanged)
  const legacyParsed = window.parseKiloInput(raw);
  const adj = legacyParsed.sets.length > 0 && ex.po ? window.adjusted1RM(legacyParsed) : null;

  const hasError = !!saveError;

  return (
    <div style={{
      borderBottom: `1px solid ${KILO_C.border}`,
      background: focused ? KILO_C.surface : 'transparent',
      transition: 'background 0.15s',
    }}>
      <div style={{ padding: '14px 16px 12px' }}>
        {/* Heading */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          {ok ? (
            <div style={{
              width: 14, height: 14, borderRadius: 2,
              background: result.skipped ? KILO_C.ink4 : KILO_C.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {!result.skipped && <KiloIcon name="check" size={11} color="#000" />}
            </div>
          ) : (
            <div style={{ width: 14, height: 14, borderRadius: 2, border: `1px solid ${hasError ? KILO_C.red : KILO_C.border2}` }} />
          )}
          <div style={{ flex: 1, fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' }}>
            {ex.name}
          </div>
          {ex.po && <KiloPill kind="accent">PO</KiloPill>}
          {!ex.po && <KiloPill kind="muted">∗</KiloPill>}
        </div>

        {/* Spec line */}
        <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.04em', marginBottom: 10, marginLeft: 22 }}>
          {ex.sets} × {ex.repMin}–{ex.repMax}
          {lastTop && (
            <span style={{ marginLeft: 12 }}>
              <span style={{ color: KILO_C.ink4 }}>last</span>{' '}
              <span style={{ color: KILO_C.ink2 }}>{lastTop.weight}×{lastParsed.sets[0].reps.join(',')}</span>
            </span>
          )}
        </div>

        {/* Input field */}
        <div
          onClick={() => setFocused(ex.id)}
          style={{
            marginLeft: 22, padding: '8px 10px',
            background: KILO_C.bg,
            border: `1px solid ${hasError ? KILO_C.red : focused ? KILO_C.accent : KILO_C.border2}`,
            borderRadius: 3,
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'border-color 0.15s',
          }}
        >
          <span className="kilo-mono" style={{ fontSize: 12, color: hasError ? KILO_C.red : KILO_C.accent, fontWeight: 600 }}>›</span>
          <input
            className="kilo-input"
            style={{ fontSize: 13, fontWeight: 500 }}
            value={raw}
            onChange={(e) => setRaw(ex.id, e.target.value)}
            onFocus={() => setFocused(ex.id)}
            placeholder={lastTop ? `${lastTop.weight} ${lastParsed.sets[0].reps.join(',')}` : 'weight reps,reps,reps'}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>

        {/* Parse preview or save error */}
        <div style={{ marginTop: 10, marginLeft: 22, minHeight: 22 }}>
          {saveError ? (
            <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.red, letterSpacing: '0.06em' }}>
              ✕ {saveError}
            </div>
          ) : (
            <ParsePreview raw={raw} />
          )}
        </div>

        {/* 1RM preview when PO */}
        {adj && (
          <div style={{ marginTop: 8, marginLeft: 22, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              est 1RM
            </span>
            <KiloNum size={12} weight={600} color={KILO_C.accent}>{adj.adjusted}</KiloNum>
            <span className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink4 }}>
              raw {adj.raw} · +{adj.fatigueAdd} fatigue
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const SESSION_STORAGE_KEY = 'kilo_workout_sessions';

// Merge stored user sessions into window.KILO_SESSIONS once at load time.
(function initStoredSessions() {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '[]');
    if (stored.length) {
      const userSessions = stored.map(s => ({ ...s, isUserEntry: true }));
      const existingIds = new Set(window.KILO_SESSIONS.map(s => s.id));
      const uniqueNew = userSessions.filter(s => !existingIds.has(s.id));
      window.KILO_SESSIONS = [...uniqueNew, ...window.KILO_SESSIONS]
        .sort((a, b) => b.date.localeCompare(a.date));
    }
  } catch {}
})();

function persistWorkoutSession(session) {
  const sessionToStore = { ...session, isUserEntry: true };
  const stored = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || '[]');
  stored.push(sessionToStore);
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
}

function KiloLog({ goToTab }) {
  const today = window.KILO_TODAY;
  const dow = window.dayOfWeek ? window.dayOfWeek(today) : (() => {
    const d = new Date(today);
    return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
  })();
  const split = window.KILO_SPLIT[dow];
  const allDayExercises = window.KILO_EXERCISES.filter(e => e.day === dow);
  const dayExercises = allDayExercises.filter(e => !e.isWarmup);
  const warmupExercises = allDayExercises.filter(e => e.isWarmup);

  const [raws, setRaws] = React.useState(() => {
    const m = {};
    [...dayExercises, ...warmupExercises].forEach(e => { m[e.id] = ''; });
    return m;
  });
  const [focused, setFocused] = React.useState(null);
  const [showWarmup, setShowWarmup] = React.useState(false);
  const [ptDone, setPtDone] = React.useState({});
  const [startedAt] = React.useState(new Date());
  const [saveErrors, setSaveErrors] = React.useState({});
  const [saveStatus, setSaveStatus] = React.useState(null); // null | 'success' | 'error'

  const setRaw = (id, val) => {
    setRaws(r => ({ ...r, [id]: val }));
    if (saveErrors[id]) setSaveErrors(e => { const n = { ...e }; delete n[id]; return n; });
    if (saveStatus === 'error') setSaveStatus(null);
  };

  const lastRefs = {};
  for (const ex of [...dayExercises, ...warmupExercises]) {
    for (const s of window.KILO_SESSIONS) {
      const e = s.exercises.find(x => x.exerciseId === ex.id);
      if (e) { lastRefs[ex.id] = e; break; }
    }
  }

  const completedCount = dayExercises.filter(ex => {
    const r = window.parseWorkoutRow(raws[ex.id]);
    return r.ok && !r.blank;
  }).length;

  const ptCompleted = Object.values(ptDone).filter(Boolean).length;

  const totalVolume = dayExercises.reduce((sum, ex) => {
    const r = window.parseWorkoutRow(raws[ex.id]);
    if (!r.ok || !r.sets) return sum;
    return sum + r.sets.reduce((s, x) => s + (x.weight_value || 0) * x.rep_count, 0);
  }, 0);

  function handleSave() {
    // Include warmup exercises so any entered input is validated and persisted, not silently dropped.
    const allExercises = [...warmupExercises, ...dayExercises];
    const items = allExercises.map(ex => ({ exerciseName: ex.name, raw: raws[ex.id] || '' }));
    const result = window.parseWorkoutEntry(items, today);

    if (!result.ok) {
      const errorMap = {};
      if (result.rowErrors) {
        for (const re of result.rowErrors) {
          const ex = allExercises.find(e => e.name === re.exerciseName);
          if (ex) errorMap[ex.id] = re.error;
        }
      }
      setSaveErrors(errorMap);
      setSaveStatus('error');
      // Expand warmup section if any warmup row has an error so it's visible
      if (warmupExercises.some(ex => errorMap[ex.id])) setShowWarmup(true);
      return;
    }

    const newSession = {
      id: `s_${result.workout_date}_${dow}_${Date.now()}`,
      entry_type: 'workout',
      isUserEntry: true,
      date: result.workout_date,
      saved_at: new Date().toISOString(),
      day: dow,
      duration: Math.round((Date.now() - startedAt.getTime()) / 60000),
      exercises: allExercises
        .filter(ex => raws[ex.id] && raws[ex.id].trim())
        .map(ex => ({ exerciseId: ex.id, raw: raws[ex.id].trim() })),
      items: result.items,
    };

    try {
      persistWorkoutSession(newSession);
    } catch (e) {
      console.error('Save failed', e);
      setSaveStatus('error');
      return;
    }

    // Persist to KILO_SESSIONS with canonical items embedded so the normalized
    // structure is readable by all existing session queries and history screens.
    window.KILO_SESSIONS.unshift(newSession);

    setSaveErrors({});
    setSaveStatus('success');
  }


  if (saveStatus === 'success') {
    return (
      <div className="kilo-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        <div style={{
          width: 48, height: 48, borderRadius: 8,
          background: KILO_C.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <KiloIcon name="check" size={28} color="#000" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Workout saved</div>
          <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 6 }}>
            {completedCount} exercise{completedCount !== 1 ? 's' : ''} · {Math.round(totalVolume).toLocaleString()} lb
          </div>
        </div>
        <button
          className="kilo-btn"
          onClick={() => goToTab('home')}
          style={{
            marginTop: 8, padding: '12px 24px', borderRadius: 3,
            background: KILO_C.surface, border: `1px solid ${KILO_C.border2}`,
            color: KILO_C.ink, fontFamily: KILO_FONT, fontWeight: 600, fontSize: 13,
            letterSpacing: '0.04em',
          }}
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="kilo-screen">
      {/* Header with progress bar */}
      <div style={{ background: KILO_C.bg, borderBottom: `1px solid ${KILO_C.border}` }}>
        <div style={{ padding: '14px 16px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>
                {dow.toUpperCase().slice(0,3)} · LOG SESSION
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{split.label}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <KiloNum size={20} weight={600} color={KILO_C.accent}>{completedCount}<span style={{ color: KILO_C.ink3, fontWeight: 400 }}>/{dayExercises.length}</span></KiloNum>
              <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 2 }}>done</div>
            </div>
          </div>
        </div>
        <div style={{ height: 2, background: KILO_C.bg2, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${(completedCount/dayExercises.length)*100}%`, background: KILO_C.accent, transition: 'width 0.3s' }} />
        </div>
      </div>

      <div className="kilo-scroll">
        {/* Warmup section */}
        <button
          className="kilo-btn"
          onClick={() => setShowWarmup(s => !s)}
          style={{
            width: '100%', textAlign: 'left',
            background: 'transparent', padding: '10px 16px',
            borderBottom: `1px solid ${KILO_C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            color: KILO_C.ink3,
          }}
        >
          <span className="kilo-mono" style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            + Warmup ({warmupExercises.length}) {showWarmup ? '— hide' : '— optional'}
          </span>
          <KiloIcon name={showWarmup ? 'arrowU' : 'arrowD'} size={12} />
        </button>

        {showWarmup && warmupExercises.map(ex => (
          <ExerciseRow
            key={ex.id}
            ex={ex}
            raw={raws[ex.id]}
            setRaw={setRaw}
            lastRef={lastRefs[ex.id]}
            focused={focused === ex.id}
            setFocused={setFocused}
            saveError={saveErrors[ex.id] || null}
          />
        ))}

        {/* Lifting exercises */}
        {dayExercises.map(ex => (
          <ExerciseRow
            key={ex.id}
            ex={ex}
            raw={raws[ex.id]}
            setRaw={setRaw}
            lastRef={lastRefs[ex.id]}
            focused={focused === ex.id}
            setFocused={setFocused}
            saveError={saveErrors[ex.id] || null}
          />
        ))}

        {/* PT section */}
        <KiloSection title="Shoulder PT" right={
          <span className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.1em' }}>
            {ptCompleted}/{window.KILO_PT.length}
          </span>
        }>
          <div style={{ borderTop: `1px solid ${KILO_C.border}` }}>
            {window.KILO_PT.map(p => {
              const done = !!ptDone[p.id];
              return (
                <button
                  key={p.id}
                  className="kilo-btn kilo-no-tap"
                  onClick={() => setPtDone(d => ({ ...d, [p.id]: !d[p.id] }))}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '12px 16px', background: 'transparent',
                    borderBottom: `1px solid ${KILO_C.border}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                    color: KILO_C.ink,
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 2,
                    border: done ? 'none' : `1px solid ${KILO_C.border2}`,
                    background: done ? KILO_C.accent : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {done && <KiloIcon name="check" size={11} color="#000" />}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: done ? KILO_C.ink3 : KILO_C.ink, textDecoration: done ? 'line-through' : 'none' }}>
                    {p.name}
                  </span>
                </button>
              );
            })}
          </div>
        </KiloSection>

        {/* Footer summary + save */}
        <div style={{ padding: 16, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <SummaryStat label="Volume" val={`${Math.round(totalVolume).toLocaleString()} lb`} />
            <SummaryStat label="Exercises" val={`${completedCount}/${dayExercises.length}`} />
            <SummaryStat label="PT" val={`${ptCompleted}/${window.KILO_PT.length}`} />
          </div>

          {saveStatus === 'error' && Object.keys(saveErrors).length === 0 && (
            <div className="kilo-mono" style={{
              fontSize: 10, color: KILO_C.red, letterSpacing: '0.06em',
              marginBottom: 10, padding: '8px 10px',
              background: 'rgba(239,68,68,0.08)', borderRadius: 3,
              border: `1px solid rgba(239,68,68,0.2)`,
            }}>
              ✕ Complete at least one exercise before saving
            </div>
          )}

          <button
            className="kilo-btn"
            disabled={completedCount === 0}
            onClick={handleSave}
            style={{
              width: '100%', padding: '14px', borderRadius: 3,
              background: completedCount === 0 ? KILO_C.surface2 : KILO_C.accent,
              color: completedCount === 0 ? KILO_C.ink4 : '#000',
              fontFamily: KILO_FONT, fontWeight: 700, fontSize: 13,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              border: 'none', opacity: completedCount === 0 ? 0.5 : 1,
            }}
          >
            Save Session
          </button>
          <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink4, textAlign: 'center', marginTop: 8, letterSpacing: '0.1em' }}>
            ENTER `−` TO SKIP AN EXERCISE
          </div>
        </div>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function SummaryStat({ label, val }) {
  return (
    <div style={{ flex: 1, padding: '10px 12px', background: KILO_C.surface, border: `1px solid ${KILO_C.border}`, borderRadius: 3 }}>
      <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <KiloNum size={13} weight={600}>{val}</KiloNum>
    </div>
  );
}

window.KiloLog = KiloLog;
window.persistWorkoutSession = persistWorkoutSession;
