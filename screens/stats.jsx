// stats.jsx — Exercise History + 1RM Calculator (combined Stats tab)

function OneRMTrendGraph({ exId }) {
  const W = 320, H = 110;
  const PAD = 10, PAD_B = 14;
  // Build series of estimated 1RMs per session
  const series = [];
  for (let i = window.KILO_SESSIONS.length - 1; i >= 0; i--) {
    const s = window.KILO_SESSIONS[i];
    const e = s.exercises.find(x => x.exerciseId === exId);
    if (!e) continue;
    const p = window.parseKiloInput(e.raw);
    const adj = window.adjusted1RM(p);
    if (adj) series.push({ date: s.date, value: adj.adjusted });
  }
  if (series.length < 2) return <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink4, padding: 12 }}>not enough data</div>;
  const minY = Math.min(...series.map(s => s.value)) - 5;
  const maxY = Math.max(...series.map(s => s.value)) + 5;
  const xAt = (i) => PAD + (i / (series.length - 1)) * (W - PAD * 2);
  const yAt = (v) => PAD + (1 - (v - minY) / (maxY - minY)) * (H - PAD - PAD_B);
  const path = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(s.value)}`).join(' ');
  const fillPath = `${path} L ${xAt(series.length - 1)} ${H - PAD_B} L ${xAt(0)} ${H - PAD_B} Z`;
  const last = series[series.length - 1];
  const first = series[0];
  const change = last.value - first.value;

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="orm-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={KILO_C.accent} stopOpacity="0.25" />
            <stop offset="100%" stopColor={KILO_C.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill="url(#orm-grad)" />
        <path d={path} fill="none" stroke={KILO_C.accent} strokeWidth="1.5" />
        {series.map((s, i) => (
          <circle key={i} cx={xAt(i)} cy={yAt(s.value)} r="1.4" fill={KILO_C.accent} />
        ))}
        <text x={PAD} y={H - 2} fill={KILO_C.ink4} fontSize="9" fontFamily="JetBrains Mono">
          {new Date(first.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </text>
        <text x={W - PAD} y={H - 2} fill={KILO_C.ink4} fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">
          {new Date(last.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </text>
      </svg>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 12px' }}>
        <div>
          <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>est 1RM</div>
          <KiloNum size={22} weight={700} color={KILO_C.accent}>{Math.round(last.value)}</KiloNum>
          <span className="kilo-mono" style={{ fontSize: 11, color: KILO_C.ink3, marginLeft: 4 }}>lb</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>6wk</div>
          <KiloNum size={14} weight={600} color={change >= 0 ? KILO_C.green : KILO_C.red}>
            {change >= 0 ? '+' : ''}{Math.round(change)}
          </KiloNum>
        </div>
      </div>
    </div>
  );
}

function ExerciseHistoryView({ exId, back }) {
  const ex = window.KILO_EXERCISES.find(e => e.id === exId);
  const sessions = window.KILO_SESSIONS
    .map(s => ({ s, e: s.exercises.find(x => x.exerciseId === exId) }))
    .filter(x => x.e);

  // best ever set
  let best = null;
  for (const { e } of sessions) {
    const p = window.parseKiloInput(e.raw);
    const top = window.topSet(p);
    if (top && (!best || top.weight > best.weight)) best = { ...top, raw: e.raw };
  }

  return (
    <div className="kilo-screen">
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={back} className="kilo-btn" style={{ background: 'transparent', padding: 0, color: KILO_C.ink2 }}>
          <KiloIcon name="arrowL" size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 2 }}>
            {ex.day.slice(0,3).toUpperCase()} · {ex.cat.replace('_', ' ')}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{ex.name}</div>
        </div>
        {ex.po ? <KiloPill kind="accent">PO</KiloPill> : <KiloPill kind="muted">∗</KiloPill>}
      </div>
      <div className="kilo-scroll">
        <div style={{ padding: '14px 0 0' }}>
          <OneRMTrendGraph exId={exId} />
        </div>

        {best && (
          <KiloSection title="Best ever">
            <div style={{ padding: '0 16px' }}>
              <div style={{ background: KILO_C.surface, border: `1px solid ${KILO_C.border}`, padding: '12px 14px', borderRadius: 3 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <KiloNum size={20} weight={700} color={KILO_C.accent}>{best.weight}</KiloNum>
                  <span className="kilo-mono" style={{ color: KILO_C.ink3 }}>×</span>
                  <KiloNum size={16} weight={600}>{best.reps.join(',')}</KiloNum>
                </div>
                <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, marginTop: 6, letterSpacing: '0.04em' }}>
                  raw: {best.raw}
                </div>
              </div>
            </div>
          </KiloSection>
        )}

        <KiloSection title={`History · ${sessions.length} sessions`}>
          <div style={{ borderTop: `1px solid ${KILO_C.border}` }}>
            {sessions.slice(0, 14).map(({ s, e }, i) => {
              const p = window.parseKiloInput(e.raw);
              const top = window.topSet(p);
              const adj = window.adjusted1RM(p);
              return (
                <div key={s.id} style={{ padding: '12px 16px', borderBottom: `1px solid ${KILO_C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      {new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </div>
                    {adj && (
                      <KiloNum size={11} color={KILO_C.accent}>1RM {Math.round(adj.adjusted)}</KiloNum>
                    )}
                  </div>
                  <div className="kilo-mono" style={{ fontSize: 12, color: KILO_C.ink, fontWeight: 500 }}>
                    {e.raw}
                  </div>
                </div>
              );
            })}
          </div>
        </KiloSection>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function KiloStats({ goToTab }) {
  const [view, setView] = React.useState('list'); // 'list' | exId
  const [filterDay, setFilterDay] = React.useState('all');

  if (view !== 'list') {
    return <ExerciseHistoryView exId={view} back={() => setView('list')} />;
  }

  // Compute big-3 1RMs for header
  const big3 = ['squat', 'db_bench', 'deadlift'];
  const oneRMs = big3.map(id => {
    const last = window.KILO_SESSIONS.find(s => s.exercises.find(x => x.exerciseId === id));
    if (!last) return { id, value: null };
    const e = last.exercises.find(x => x.exerciseId === id);
    const adj = window.adjusted1RM(window.parseKiloInput(e.raw));
    return { id, value: adj ? Math.round(adj.adjusted) : null };
  });
  const total = oneRMs.reduce((s, x) => s + (x.value || 0), 0);

  const days = ['all', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  const exercises = window.KILO_EXERCISES.filter(e => filterDay === 'all' || e.day === filterDay);

  return (
    <div className="kilo-screen">
      <KiloHeader title="Stats" sub="1RM · HISTORY" />
      <div className="kilo-scroll">
        {/* Big 3 1RM */}
        <div style={{ padding: '16px 16px 0' }}>
          <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
            Estimated 1RM · Big Three
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: KILO_C.border }}>
            {oneRMs.map(o => {
              const ex = window.KILO_EXERCISES.find(e => e.id === o.id);
              const goal = window.KILO_GOALS.find(g => g.lift === o.id);
              return (
                <button
                  key={o.id}
                  className="kilo-btn"
                  onClick={() => setView(o.id)}
                  style={{ background: KILO_C.surface, padding: '12px 14px', textAlign: 'left', color: KILO_C.ink }}
                >
                  <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
                    {ex.name.replace(' Press','').replace('Back ','')}
                  </div>
                  <KiloNum size={22} weight={700} color={KILO_C.accent}>{o.value}</KiloNum>
                  {goal && (
                    <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, marginTop: 3 }}>
                      → {goal.target}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: 8, padding: '10px 12px', background: KILO_C.surface, border: `1px solid ${KILO_C.border}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Total
            </div>
            <KiloNum size={18} weight={600}>{total}<span style={{ color: KILO_C.ink4, fontWeight: 400, fontSize: 12 }}> / 1000</span></KiloNum>
          </div>
        </div>

        {/* Day filter */}
        <div style={{ marginTop: 20, padding: '0 16px', display: 'flex', gap: 4, overflowX: 'auto' }}>
          {days.map(d => (
            <button
              key={d}
              onClick={() => setFilterDay(d)}
              className="kilo-btn"
              style={{
                padding: '6px 10px', borderRadius: 3,
                background: filterDay === d ? KILO_C.accentDim : 'transparent',
                color: filterDay === d ? KILO_C.accent : KILO_C.ink3,
                border: `1px solid ${filterDay === d ? 'transparent' : KILO_C.border2}`,
                fontFamily: KILO_MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {d === 'all' ? 'All' : d.slice(0, 3)}
            </button>
          ))}
        </div>

        {/* Exercise list */}
        <KiloSection title={`Exercises · ${exercises.length}`}>
          <div style={{ borderTop: `1px solid ${KILO_C.border}` }}>
            {exercises.map(ex => {
              // get last 1RM
              const last = window.KILO_SESSIONS.find(s => s.exercises.find(x => x.exerciseId === ex.id));
              const e = last && last.exercises.find(x => x.exerciseId === ex.id);
              const adj = e ? window.adjusted1RM(window.parseKiloInput(e.raw)) : null;
              return (
                <button
                  key={ex.id}
                  onClick={() => setView(ex.id)}
                  className="kilo-btn"
                  style={{ width: '100%', textAlign: 'left', background: 'transparent', padding: '12px 16px', borderBottom: `1px solid ${KILO_C.border}`, color: KILO_C.ink, display: 'flex', alignItems: 'center', gap: 12 }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{ex.name}</div>
                    <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.04em' }}>
                      {ex.day.slice(0,3).toUpperCase()} · {ex.sets}×{ex.repMin}–{ex.repMax}
                      {!ex.po && ' · ∗'}
                    </div>
                  </div>
                  {adj && (
                    <div style={{ textAlign: 'right' }}>
                      <KiloNum size={14} weight={600} color={KILO_C.accent}>{Math.round(adj.adjusted)}</KiloNum>
                      <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink4, letterSpacing: '0.1em', textTransform: 'uppercase' }}>1RM</div>
                    </div>
                  )}
                  <KiloIcon name="arrow" size={14} color={KILO_C.ink4} />
                </button>
              );
            })}
          </div>
        </KiloSection>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

window.KiloStats = KiloStats;
