// home.jsx — Kilo Home / Dashboard

function rollingAvg(weights, n) {
  if (!weights.length) return null;
  const recent = weights.slice(-n);
  return recent.reduce((sum, w) => sum + w.weight, 0) / recent.length;
}

function dayOfWeek(iso) {
  const d = new Date(iso + 'T12:00:00');
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][d.getDay()];
}

function lastSessionFor(exId) {
  for (const s of window.KILO_SESSIONS) {
    const e = s.exercises.find(x => x.exerciseId === exId);
    if (e) return { session: s, ex: e };
  }
  return null;
}

function KiloHome({ goToTab, openSession }) {
  const today = window.KILO_TODAY;
  const [weights, setWeights] = React.useState(() => window.KILO_WEIGHTS);
  const [entry, setEntry] = React.useState('');
  const [status, setStatus] = React.useState(null); // null | { ok: true } | { ok: false, error }
  const [, setTick] = React.useState(0);
  const refresh = () => {
    setTick(t => t + 1);
    setWeights([...window.KILO_WEIGHTS]);
  };

  // Clear success status after delay
  React.useEffect(() => {
    if (status && status.ok) {
      const t = setTimeout(() => setStatus(null), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  const handleDelete = (id, type) => {
    if (type === 'workout') {
      if (window.deleteWorkoutSession(id)) refresh();
    } else {
      if (window.deleteWeightEntry(id)) refresh();
    }
  };

  const dow = dayOfWeek(today);
  const split = window.KILO_SPLIT[dow];
  const todayStr = new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const getWeight = (w) => w.weight_value ?? w.weight;
  const getDate = (w) => w.logged_at ? w.logged_at.slice(0, 10) : w.date;

  const avg7 = rollingAvg(weights.map(w => ({ ...w, weight: getWeight(w) })), 7);
  const avg7Prev = rollingAvg(weights.slice(0, -7).map(w => ({ ...w, weight: getWeight(w) })), 7);
  const wow = avg7 - avg7Prev;
  const lastWeight = weights[weights.length - 1];
  const loggedToday = lastWeight && (lastWeight.logged_at ? lastWeight.logged_at.startsWith(today) : lastWeight.date === today);

  function handleQuickLog() {
    const result = window.parseWeightEntry(entry);
    if (!result.ok) {
      setStatus({ ok: false, error: result.error });
      return;
    }
    const newEntry = {
      id: `w_${Date.now()}`,
      entry_type: 'weight',
      weight_value: result.weight_value,
      weight_unit: result.weight_unit,
      logged_at: result.logged_at,
      saved_at: new Date().toISOString(),
      date: today,
      weight: result.weight_value
    };
    try {
      window.persistWeightEntry(newEntry);
    } catch {
      setStatus({ ok: false, error: 'Save failed — storage unavailable' });
      return;
    }
    const updated = [...weights, newEntry].sort((a, b) => {
      const da = a.logged_at ?? a.date;
      const db = b.logged_at ?? b.date;
      return da.localeCompare(db);
    });
    window.KILO_WEIGHTS = updated;
    setWeights(updated);
    setEntry('');
    setStatus({ ok: true });
  }

  // 1RM estimates for big three
  const big3 = ['squat', 'db_bench', 'deadlift'];
  const oneRMs = big3.map(id => {
    const last = lastSessionFor(id);
    if (!last) return { id, value: null };
    const parsed = window.parseKiloInput(last.ex.raw);
    const adj = window.adjusted1RM(parsed);
    return { id, value: adj ? adj.adjusted : null, ex: window.KILO_EXERCISES.find(e => e.id === id) };
  });
  const total = oneRMs.reduce((sum, x) => sum + (x.value || 0), 0);

  // Featured goal
  const goal = window.KILO_GOALS.find(g => g.featured);
  const goalPct = goal ? Math.min(100, Math.round((total / goal.target) * 100)) : 0;

  // Streak: count consecutive days backward with weight log
  let streak = 0;
  const dates = new Set(weights.map(w => w.date));
  let cursor = new Date(today);
  while (dates.has(cursor.toISOString().slice(0,10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Sessions this week
  const startOfWeek = new Date(today);
  startOfWeek.setDate(startOfWeek.getDate() - (startOfWeek.getDay() === 0 ? 6 : startOfWeek.getDay() - 1));
  const sessionsThisWeek = window.KILO_SESSIONS.filter(s => new Date(s.date) >= startOfWeek).length;

  return (
    <div className="kilo-screen">
      <KiloHeader
        title="Kilo"
        sub={todayStr.toUpperCase()}
        right={
          <button className="kilo-btn" onClick={() => goToTab('more')} style={{ background: 'transparent', color: KILO_C.ink3, padding: 6 }}>
            <KiloIcon name="gear" size={20} />
          </button>
        }
      />

      <div className="kilo-scroll">
        {/* TODAY card — hero */}
        <div style={{ padding: '20px 16px 0' }}>
          <button
            className="kilo-btn kilo-no-tap"
            onClick={openSession}
            style={{
              width: '100%', textAlign: 'left',
              background: KILO_C.surface, border: `1px solid ${KILO_C.border}`,
              padding: '20px 18px', borderRadius: 4,
              position: 'relative', overflow: 'hidden',
            }}
          >
            {/* corner mark */}
            <div style={{ position: 'absolute', top: 0, right: 0, width: 8, height: 8, background: KILO_C.accent }} />
            <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: 10 }}>
              Today · {dow.slice(0,3).toUpperCase()}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1 }}>{split.label}</div>
                <div style={{ fontSize: 12, color: KILO_C.ink3, marginTop: 6 }}>{split.sub}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: KILO_C.accent }}>
                <span className="kilo-mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Log</span>
                <KiloIcon name="arrow" size={16} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${KILO_C.border}` }}>
              <Stat label="Exercises" val={window.KILO_EXERCISES.filter(e => e.day === dow).length} />
              <Stat label="Last week" val={(() => {
                const lastWeekSession = window.KILO_SESSIONS.find(s => s.day === dow);
                return lastWeekSession ? `${lastWeekSession.duration}m` : '—';
              })()} />
              <Stat label="Streak" val={`${sessionsThisWeek}/5`} />
            </div>
          </button>
        </div>

        {/* Weight quick-entry */}
        <KiloSection title="Body weight" right={
          <button className="kilo-btn" onClick={() => goToTab('weight')} style={{ background: 'transparent', color: KILO_C.ink3, fontSize: 11, padding: 0 }}>
            <span className="kilo-mono" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>Log →</span>
          </button>
        }>
          <div style={{ padding: '0 16px' }}>
            {!loggedToday ? (
              <div style={{
                background: KILO_C.surface, border: `1px solid ${status?.ok === false ? KILO_C.red : status?.ok ? KILO_C.green : KILO_C.border}`,
                padding: '14px 16px', borderRadius: 4, transition: 'border-color 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span className="kilo-mono" style={{ fontSize: 18, color: status?.ok ? KILO_C.green : KILO_C.accent, fontWeight: 600 }}>›</span>
                    <input
                      className="kilo-input"
                      style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: status?.ok ? KILO_C.green : KILO_C.ink }}
                      placeholder="000.0"
                      value={entry}
                      onChange={(e) => { setEntry(e.target.value); setStatus(null); }}
                      onKeyDown={(e) => e.key === 'Enter' && entry && handleQuickLog()}
                      inputMode="decimal"
                    />
                    <span className="kilo-mono" style={{ fontSize: 11, color: KILO_C.ink3 }}>lb</span>
                  </div>
                  <button
                    className="kilo-btn"
                    disabled={!entry || status?.ok}
                    onClick={handleQuickLog}
                    style={{
                      background: !entry || status?.ok ? KILO_C.surface2 : KILO_C.accent,
                      color: !entry || status?.ok ? KILO_C.ink4 : '#000',
                      padding: '6px 14px', borderRadius: 3, fontWeight: 700, fontSize: 10,
                      letterSpacing: '0.08em', textTransform: 'uppercase',
                    }}
                  >
                    {status?.ok ? 'Saved' : 'Log'}
                  </button>
                </div>
                {status && (
                  <div className="kilo-mono" style={{ marginTop: 8, fontSize: 11, color: status.ok ? KILO_C.green : KILO_C.red }}>
                    {status.ok ? '✓ Weight saved' : `✕ ${status.error}`}
                  </div>
                )}
              </div>
            ) : (
              <button
                className="kilo-btn kilo-no-tap"
                onClick={() => goToTab('weight')}
                style={{
                  width: '100%', textAlign: 'left', background: KILO_C.surface,
                  border: `1px solid ${status?.ok ? KILO_C.green : KILO_C.border}`,
                  padding: '14px 16px', borderRadius: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'border-color 0.5s',
                }}
              >
                <div>
                  <div className="kilo-mono" style={{ fontSize: 9, color: status?.ok ? KILO_C.green : KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>
                    {status?.ok ? '✓ Saved successfully' : '7-day avg'}
                  </div>
                  <KiloNum size={28} weight={600} color={status?.ok ? KILO_C.green : KILO_C.ink}>{avg7.toFixed(1)}</KiloNum>
                  <span className="kilo-mono" style={{ fontSize: 11, color: KILO_C.ink3, marginLeft: 4 }}>lb</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 6 }}>WoW</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                    <KiloIcon name={wow < 0 ? 'arrowD' : 'arrowU'} size={12} color={wow < 0 ? KILO_C.green : KILO_C.yellow} />
                    <KiloNum size={14} color={wow < 0 ? KILO_C.green : KILO_C.yellow}>{(wow >= 0 ? '+' : '') + wow.toFixed(2)}</KiloNum>
                  </div>
                  <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, marginTop: 2 }}>streak {streak}d</div>
                </div>
              </button>
            )}
          </div>
        </KiloSection>

        {/* Goal — 1000 lb club */}
        {goal && (
          <KiloSection title={`Featured goal · ${goal.label}`} right={
            <button className="kilo-btn" onClick={() => goToTab('more')} style={{ background: 'transparent', color: KILO_C.ink3, fontSize: 11, padding: 0 }}>
              <span className="kilo-mono" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>All →</span>
            </button>
          }>
            <div style={{ padding: '0 16px' }}>
              <div style={{ background: KILO_C.surface, border: `1px solid ${KILO_C.border}`, padding: '14px 16px', borderRadius: 4 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                  <KiloNum size={26} weight={600}>{Math.round(total)}<span style={{ color: KILO_C.ink3, fontSize: 14, fontWeight: 400 }}> / {goal.target}</span></KiloNum>
                  <span className="kilo-mono" style={{ fontSize: 10, color: KILO_C.accent, letterSpacing: '0.12em' }}>{goalPct}%</span>
                </div>
                <div style={{ height: 4, background: KILO_C.bg2, borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                  <div style={{ height: '100%', width: `${goalPct}%`, background: KILO_C.accent }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, gap: 12 }}>
                  {oneRMs.map(o => (
                    <div key={o.id} style={{ flex: 1 }}>
                      <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>
                        {o.id === 'squat' ? 'Sq' : o.id === 'db_bench' ? 'Bn' : 'Dl'}
                      </div>
                      <KiloNum size={16} weight={600}>{o.value ? Math.round(o.value) : '—'}</KiloNum>
                    </div>
                  ))}
                  <div style={{ flex: 1, textAlign: 'right' }}>
                    <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>To go</div>
                    <KiloNum size={16} weight={600} color={KILO_C.accent}>{goal.target - Math.round(total)}</KiloNum>
                  </div>
                </div>
              </div>
            </div>
          </KiloSection>
        )}

        {/* Recent history */}
        <KiloSection title="Recent history" right={
          <button className="kilo-btn" onClick={() => goToTab('stats')} style={{ background: 'transparent', color: KILO_C.ink3, fontSize: 11, padding: 0 }}>
            <span className="kilo-mono" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>All →</span>
          </button>
        }>
          <div style={{ borderTop: `1px solid ${KILO_C.border}` }}>
            {(() => {
              const sessions = (window.KILO_SESSIONS || []).map(s => ({ ...s, sortDate: s.saved_at || s.date + 'T23:59:59Z' }));
              const weights = (window.KILO_WEIGHTS || []).map(w => ({ ...w, sortDate: w.saved_at || (w.logged_at ?? w.date + 'T08:00:00Z') }));
              const history = [...sessions, ...weights].sort((a, b) => b.sortDate.localeCompare(a.sortDate)).slice(0, 4);
              
              return history.map(e => {
                const date = new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const isUserEntry = !!e.isUserEntry;

                if (e.entry_type === 'workout') {
                  const sp = window.KILO_SPLIT[e.day];
                  return (
                    <div key={e.id} style={{ padding: '14px 16px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.1em', textTransform: 'uppercase', width: 80, paddingTop: 3 }}>
                        {date}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{sp.label}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {e.exercises.map((ex, i) => {
                            const exerciseDef = window.KILO_EXERCISES.find(d => d.id === ex.exerciseId);
                            const parsed = window.parseKiloInput(ex.raw);
                            return (
                              <div key={i} className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink2, lineHeight: 1.4 }}>
                                <span style={{ color: KILO_C.ink3 }}>{exerciseDef ? exerciseDef.name : 'Unknown'}</span> · {window.formatParsed(parsed)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {isUserEntry && (
                        <button className="kilo-btn" onClick={() => window.confirm('Delete this session?') && handleDelete(e.id, 'workout')} style={{ background: 'transparent', padding: 8 }}>
                          <KiloIcon name="close" size={14} color={KILO_C.red} />
                        </button>
                      )}
                      <KiloIcon name="log" size={14} color={KILO_C.ink4} style={{ marginTop: 3 }} />
                    </div>
                  );
                } else {
                  return (
                    <div key={e.id} style={{ padding: '14px 16px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.1em', textTransform: 'uppercase', width: 80 }}>
                        {date}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>Weight</div>
                        <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, marginTop: 2 }}>
                          <KiloNum size={10} weight={600}>{e.weight_value.toFixed(1)}</KiloNum> lb
                        </div>
                      </div>
                      {isUserEntry && (
                        <button className="kilo-btn" onClick={() => window.confirm('Delete this entry?') && handleDelete(e.id, 'weight')} style={{ background: 'transparent', padding: 8 }}>
                          <KiloIcon name="close" size={14} color={KILO_C.red} />
                        </button>
                      )}
                      <KiloIcon name="weight" size={14} color={KILO_C.ink4} />
                    </div>
                  );
                }
              });
            })()}
          </div>
        </KiloSection>

        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

function Stat({ label, val }) {
  return (
    <div style={{ flex: 1 }}>
      <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <KiloNum size={14} weight={500}>{val}</KiloNum>
    </div>
  );
}

window.KiloHome = KiloHome;
