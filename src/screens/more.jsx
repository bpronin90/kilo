// more.jsx — Goals, Deload generator, PT streak, Settings

function GoalsView({ back }) {
  const goals = window.KILO_GOALS;
  return (
    <div className="kilo-screen">
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={back} className="kilo-btn" style={{ background: 'transparent', padding: 0, color: KILO_C.ink2 }}>
          <KiloIcon name="arrowL" size={18} />
        </button>
        <div style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>Goals</div>
        <button className="kilo-btn" style={{ background: KILO_C.accent, color: '#000', padding: '5px 10px', borderRadius: 3, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          + Add
        </button>
      </div>
      <div className="kilo-scroll">
        <div style={{ padding: '14px 16px' }}>
          {goals.map(g => {
            const pct = Math.min(100, Math.round((g.current / g.target) * 100));
            const remain = g.target - g.current;
            return (
              <div key={g.id} style={{ background: KILO_C.surface, border: `1px solid ${g.featured ? KILO_C.accent : KILO_C.border}`, borderRadius: 4, padding: 14, marginBottom: 10, position: 'relative' }}>
                {g.featured && (
                  <div style={{ position: 'absolute', top: -1, right: 12, background: KILO_C.accent, color: '#000', padding: '2px 6px', fontSize: 8, fontFamily: KILO_MONO, fontWeight: 700, letterSpacing: '0.12em' }}>FEATURED</div>
                )}
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{g.label}</div>
                  <span className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{g.type.replace('_', ' ')}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                  <KiloNum size={22} weight={700} color={g.featured ? KILO_C.accent : KILO_C.ink}>{g.current}</KiloNum>
                  <span className="kilo-mono" style={{ fontSize: 11, color: KILO_C.ink3 }}>/ {g.target}</span>
                  <div style={{ flex: 1 }} />
                  <span className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3 }}>{remain > 0 ? `${remain.toFixed(remain < 10 ? 1 : 0)} to go` : 'reached!'}</span>
                </div>
                <div style={{ height: 3, background: KILO_C.bg2, borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: g.featured ? KILO_C.accent : KILO_C.ink2 }} />
                </div>
                {g.targetDate && (
                  <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, marginTop: 8, letterSpacing: '0.06em' }}>
                    target {new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function DeloadView({ back }) {
  // pull last week of working weights, apply 60-70%
  const dayKeys = ['monday','tuesday','wednesday','thursday','friday'];
  const lastWeek = {};
  for (const d of dayKeys) {
    const sess = window.KILO_SESSIONS.find(s => s.day === d);
    if (sess) lastWeek[d] = sess;
  }

  const [pct, setPct] = React.useState(0.65);

  return (
    <div className="kilo-screen">
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={back} className="kilo-btn" style={{ background: 'transparent', padding: 0, color: KILO_C.ink2 }}>
          <KiloIcon name="arrowL" size={18} />
        </button>
        <div style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>Deload week</div>
        <button className="kilo-btn" style={{ background: 'transparent', color: KILO_C.ink3, padding: 4 }}>
          <KiloIcon name="edit" size={16} />
        </button>
      </div>
      <div className="kilo-scroll">
        <div style={{ padding: '16px 16px 8px' }}>
          <div className="kilo-mono" style={{ fontSize: 11, color: KILO_C.ink2, lineHeight: 1.5 }}>
            Generated from your last full week. PO exercises at <span style={{ color: KILO_C.accent }}>{Math.round(pct*100)}%</span>, sets reduced by 1, asterisked exercises kept as-is.
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            {[0.6, 0.65, 0.7].map(p => (
              <button
                key={p}
                onClick={() => setPct(p)}
                className="kilo-btn"
                style={{
                  flex: 1, padding: '8px', borderRadius: 3,
                  background: pct === p ? KILO_C.accentDim : 'transparent',
                  color: pct === p ? KILO_C.accent : KILO_C.ink3,
                  border: `1px solid ${pct === p ? 'transparent' : KILO_C.border2}`,
                  fontFamily: KILO_MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                }}
              >
                {Math.round(p * 100)}%
              </button>
            ))}
          </div>
        </div>

        {dayKeys.map(d => {
          const sess = lastWeek[d];
          if (!sess) return null;
          const split = window.KILO_SPLIT[d];
          return (
            <div key={d} style={{ marginTop: 18 }}>
              <div style={{ padding: '0 16px 8px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 600 }}>
                  {d.slice(0,3).toUpperCase()} · {split.label}
                </div>
              </div>
              <div style={{ borderTop: `1px solid ${KILO_C.border}` }}>
                {sess.exercises.map((e, i) => {
                  const ex = window.KILO_EXERCISES.find(x => x.id === e.exerciseId);
                  const parsed = window.parseKiloInput(e.raw);
                  const top = window.topSet(parsed);
                  if (!top) return null;
                  const newW = ex.po ? Math.round((top.weight * pct) / 5) * 5 : top.weight;
                  const newSets = ex.po ? Math.max(1, parsed.sets[0].reps.length - 1) : parsed.sets[0].reps.length;
                  const newReps = parsed.sets[0].reps[0]; // keep top rep target
                  return (
                    <div key={i} style={{ padding: '10px 16px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{ex.name}</div>
                        <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink4 }}>
                          last {top.weight}×{parsed.sets[0].reps.join(',')}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <KiloNum size={14} weight={600} color={KILO_C.accent}>{newW}</KiloNum>
                        <span className="kilo-mono" style={{ fontSize: 11, color: KILO_C.ink3, marginLeft: 4 }}>×{Array(newSets).fill(newReps).join(',')}</span>
                      </div>
                      {!ex.po && <KiloPill kind="muted">∗</KiloPill>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div style={{ padding: 16, marginTop: 8 }}>
          <button className="kilo-btn" style={{ width: '100%', padding: '12px', background: KILO_C.surface, border: `1px solid ${KILO_C.border2}`, color: KILO_C.ink, borderRadius: 3, fontWeight: 600, fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Export as text
          </button>
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function PTView({ back }) {
  const today = window.KILO_TODAY;
  const [done, setDone] = React.useState({});
  // build fake streak: 14 days
  const streakDays = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    streakDays.push({ date: d.toISOString().slice(0,10), done: i !== 5 && i !== 11 });
  }
  const totalDone = streakDays.filter(d => d.done).length;
  const completedToday = Object.values(done).filter(Boolean).length;

  return (
    <div className="kilo-screen">
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={back} className="kilo-btn" style={{ background: 'transparent', padding: 0, color: KILO_C.ink2 }}>
          <KiloIcon name="arrowL" size={18} />
        </button>
        <div style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>Shoulder PT</div>
        <KiloNum size={16} weight={600} color={KILO_C.accent}>{completedToday}<span style={{ color: KILO_C.ink3, fontWeight: 400 }}>/{window.KILO_PT.length}</span></KiloNum>
      </div>
      <div className="kilo-scroll">
        {/* Streak grid */}
        <div style={{ padding: '16px 16px 0' }}>
          <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 10 }}>
            Last 14 days · {totalDone}/14 done
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 3 }}>
            {streakDays.map((d, i) => (
              <div key={d.date} style={{
                aspectRatio: '1',
                background: d.done ? KILO_C.accent : KILO_C.surface2,
                border: i === 13 ? `1px solid ${KILO_C.accent}` : 'none',
                borderRadius: 2,
              }} />
            ))}
          </div>
        </div>

        {/* Today's checklist */}
        <KiloSection title="Today">
          <div style={{ borderTop: `1px solid ${KILO_C.border}` }}>
            {window.KILO_PT.map(p => {
              const isDone = !!done[p.id];
              return (
                <button
                  key={p.id}
                  onClick={() => setDone(d => ({ ...d, [p.id]: !d[p.id] }))}
                  className="kilo-btn kilo-no-tap"
                  style={{ width: '100%', padding: '14px 16px', background: 'transparent', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 12, color: KILO_C.ink, textAlign: 'left' }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: 2,
                    border: isDone ? 'none' : `1px solid ${KILO_C.border2}`,
                    background: isDone ? KILO_C.accent : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isDone && <KiloIcon name="check" size={12} color="#000" />}
                  </div>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: isDone ? KILO_C.ink3 : KILO_C.ink, textDecoration: isDone ? 'line-through' : 'none' }}>{p.name}</span>
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

function ExerciseSettingsView({ back }) {
  const [day, setDay] = React.useState('monday');
  const days = ['monday','tuesday','wednesday','thursday','friday'];
  const exs = window.KILO_EXERCISES.filter(e => e.day === day);
  return (
    <div className="kilo-screen">
      <div style={{ padding: '14px 16px 12px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={back} className="kilo-btn" style={{ background: 'transparent', padding: 0, color: KILO_C.ink2 }}>
          <KiloIcon name="arrowL" size={18} />
        </button>
        <div style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>Exercises</div>
      </div>
      <div className="kilo-scroll">
        <div style={{ padding: '12px 16px 0', display: 'flex', gap: 4, overflowX: 'auto' }}>
          {days.map(d => (
            <button
              key={d}
              onClick={() => setDay(d)}
              className="kilo-btn"
              style={{
                padding: '6px 12px', borderRadius: 3,
                background: day === d ? KILO_C.accentDim : 'transparent',
                color: day === d ? KILO_C.accent : KILO_C.ink3,
                border: `1px solid ${day === d ? 'transparent' : KILO_C.border2}`,
                fontFamily: KILO_MONO, fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {d.slice(0,3)} · {window.KILO_SPLIT[d].label}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, borderTop: `1px solid ${KILO_C.border}` }}>
          {exs.map(ex => (
            <div key={ex.id} style={{ padding: '14px 16px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{ex.name}</div>
                <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3 }}>
                  {ex.sets} × {ex.repMin}–{ex.repMax} · {ex.cat.replace('_', ' ')}
                </div>
              </div>
              {ex.po ? <KiloPill kind="accent">PO</KiloPill> : <KiloPill kind="muted">∗</KiloPill>}
              <KiloIcon name="arrow" size={14} color={KILO_C.ink4} />
            </div>
          ))}
        </div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function KiloMore({ goToTab }) {
  const [view, setView] = React.useState('list'); // list | goals | deload | pt | exercises

  if (view === 'goals') return <GoalsView back={() => setView('list')} />;
  if (view === 'deload') return <DeloadView back={() => setView('list')} />;
  if (view === 'pt') return <PTView back={() => setView('list')} />;
  if (view === 'exercises') return <ExerciseSettingsView back={() => setView('list')} />;

  const items = [
    { id: 'goals',     label: 'Goals',           icon: 'goal',    sub: `${window.KILO_GOALS.filter(g => g.active).length} active` },
    { id: 'deload',    label: 'Deload generator', icon: 'deload', sub: 'Generate a deload week' },
    { id: 'pt',        label: 'Shoulder PT',     icon: 'pt',      sub: 'Daily checklist · streak' },
    { id: 'exercises', label: 'Exercises & split', icon: 'gear', sub: `${window.KILO_EXERCISES.length} exercises · 5 days` },
  ];

  return (
    <div className="kilo-screen">
      <KiloHeader title="More" sub="TOOLS · SETTINGS" />
      <div className="kilo-scroll">
        <div style={{ borderBottom: `1px solid ${KILO_C.border}` }} />
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            className="kilo-btn"
            style={{ width: '100%', padding: '16px', background: 'transparent', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 14, color: KILO_C.ink, textAlign: 'left' }}
          >
            <div style={{ width: 32, height: 32, background: KILO_C.surface, border: `1px solid ${KILO_C.border}`, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: KILO_C.accent }}>
              <KiloIcon name={it.icon} size={16} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{it.label}</div>
              <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, marginTop: 2, letterSpacing: '0.04em' }}>{it.sub}</div>
            </div>
            <KiloIcon name="arrow" size={14} color={KILO_C.ink4} />
          </button>
        ))}

        {/* Footer brand line */}
        <div style={{ padding: '40px 16px 16px', textAlign: 'center' }}>
          <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink4, letterSpacing: '0.3em', textTransform: 'uppercase' }}>Kilo · v{window.KILO_VERSION}</div>
          <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink4, letterSpacing: '0.1em', marginTop: 4 }}>built for one</div>
        </div>
      </div>
    </div>
  );
}

window.KiloMore = KiloMore;
