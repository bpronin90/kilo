// log.jsx — Kilo Log Session screen with live parser

function ParsePreview({ raw }) {
  const parsed = window.parseKiloInput(raw);
  if (!raw || !raw.trim()) {
    return <div style={{ height: 22 }} />;
  }
  if (parsed.skipped) {
    return (
      <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Skipped session
      </div>
    );
  }
  if (parsed.sets.length === 0) {
    return (
      <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.yellow, letterSpacing: '0.06em' }}>
        ⚠ unrecognized — saved as raw
      </div>
    );
  }
  const top = window.topSet(parsed);
  const isDrop = parsed.sets.length > 1 && parsed.sets.some(s => s.weight !== top.weight);
  const totalR = window.totalReps(parsed);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {parsed.sets.map((s, i) => {
        const isTop = s.weight === top.weight;
        return (
          <div key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: isTop ? KILO_C.accentDim : KILO_C.bg2,
            border: `1px solid ${isTop ? 'transparent' : KILO_C.border2}`,
            padding: '3px 7px', borderRadius: 3,
          }}>
            <KiloNum size={11} weight={600} color={isTop ? KILO_C.accent : KILO_C.ink}>{s.weight}</KiloNum>
            <span className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3 }}>×</span>
            <span className="kilo-mono" style={{ fontSize: 11, color: isTop ? KILO_C.accent : KILO_C.ink2, fontWeight: 500 }}>
              {s.reps.join(',')}
            </span>
          </div>
        );
      })}
      <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, marginLeft: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        {isDrop && <span style={{ color: KILO_C.blue, marginRight: 6 }}>drop</span>}
        {totalR}r · {Math.round(window.totalVolume(parsed))}lb
      </div>
    </div>
  );
}

function ExerciseRow({ ex, raw, setRaw, lastRef, focused, setFocused }) {
  const parsed = window.parseKiloInput(raw);
  const ok = raw.trim() && (parsed.sets.length > 0 || parsed.skipped);
  const lastParsed = lastRef ? window.parseKiloInput(lastRef.raw) : null;
  const lastTop = lastParsed ? window.topSet(lastParsed) : null;

  const adj = parsed.sets.length > 0 && ex.po ? window.adjusted1RM(parsed) : null;

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
              background: parsed.skipped ? KILO_C.ink4 : KILO_C.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {!parsed.skipped && <KiloIcon name="check" size={11} color="#000" />}
            </div>
          ) : (
            <div style={{ width: 14, height: 14, borderRadius: 2, border: `1px solid ${KILO_C.border2}` }} />
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

        {/* Input field — terminal style */}
        <div
          onClick={() => setFocused(ex.id)}
          style={{
            marginLeft: 22, padding: '8px 10px',
            background: KILO_C.bg, border: `1px solid ${focused ? KILO_C.accent : KILO_C.border2}`,
            borderRadius: 3,
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'border-color 0.15s',
          }}
        >
          <span className="kilo-mono" style={{ fontSize: 12, color: KILO_C.accent, fontWeight: 600 }}>›</span>
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

        {/* Parse preview */}
        <div style={{ marginTop: 10, marginLeft: 22, minHeight: 22 }}>
          <ParsePreview raw={raw} />
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

  // raw inputs keyed by exercise id
  const [raws, setRaws] = React.useState(() => {
    const m = {};
    [...dayExercises, ...warmupExercises].forEach(e => { m[e.id] = ''; });
    return m;
  });
  const [focused, setFocused] = React.useState(null);
  const [showWarmup, setShowWarmup] = React.useState(false);
  const [ptDone, setPtDone] = React.useState({});
  const [startedAt] = React.useState(new Date());

  const setRaw = (id, val) => setRaws(r => ({ ...r, [id]: val }));

  // last session reference per exercise
  const lastRefs = {};
  for (const ex of [...dayExercises, ...warmupExercises]) {
    for (const s of window.KILO_SESSIONS) {
      const e = s.exercises.find(x => x.exerciseId === ex.id);
      if (e) { lastRefs[ex.id] = e; break; }
    }
  }

  const completedCount = dayExercises.filter(ex => {
    const p = window.parseKiloInput(raws[ex.id]);
    return p.sets.length > 0 || p.skipped;
  }).length;

  const ptCompleted = Object.values(ptDone).filter(Boolean).length;

  const totalVolume = dayExercises.reduce((sum, ex) => {
    const p = window.parseKiloInput(raws[ex.id]);
    return sum + window.totalVolume(p);
  }, 0);

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
        {/* progress hairline */}
        <div style={{ height: 2, background: KILO_C.bg2, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${(completedCount/dayExercises.length)*100}%`, background: KILO_C.accent, transition: 'width 0.3s' }} />
        </div>
      </div>

      <div className="kilo-scroll">
        {/* Warmup section - collapsible */}
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
          <button
            className="kilo-btn"
            disabled={completedCount === 0}
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
