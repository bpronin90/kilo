// weight.jsx — Weight Log screen with graph + entry list

function rollingAvgSeries(weights, n) {
  const out = [];
  for (let i = 0; i < weights.length; i++) {
    if (i + 1 < n) { out.push(null); continue; }
    let sum = 0;
    for (let j = i - n + 1; j <= i; j++) sum += weights[j].weight;
    out.push(sum / n);
  }
  return out;
}

function WeightGraph({ weights, range, target }) {
  // viewport
  const W = 320, H = 180;
  const PAD_L = 8, PAD_R = 8, PAD_T = 14, PAD_B = 22;

  const filtered = weights.slice(-range);
  if (filtered.length === 0) return null;

  const avg7 = rollingAvgSeries(filtered, 7);
  const avg30 = rollingAvgSeries(filtered, 30);

  // y range with 5 lb padding
  let allY = filtered.map(w => w.weight).concat(avg7.filter(x => x != null), avg30.filter(x => x != null));
  if (target) allY.push(target);
  const minY = Math.min(...allY) - 2;
  const maxY = Math.max(...allY) + 2;
  const yRange = maxY - minY;

  const xAt = (i) => PAD_L + (i / (filtered.length - 1)) * (W - PAD_L - PAD_R);
  const yAt = (v) => PAD_T + (1 - (v - minY) / yRange) * (H - PAD_T - PAD_B);

  // gridlines (4 horizontal)
  const gridY = [];
  for (let k = 0; k <= 3; k++) {
    const v = minY + (yRange * k / 3);
    gridY.push({ v, y: yAt(v) });
  }

  // 7-day line path
  const path7 = avg7.map((v, i) => v == null ? null : `${i === 0 || avg7[i-1] == null ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`).filter(Boolean).join(' ');
  const path30 = avg30.map((v, i) => v == null ? null : `${i === 0 || avg30[i-1] == null ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`).filter(Boolean).join(' ');

  // first/last labels for x axis
  const fmtDate = (iso) => {
    const d = new Date(iso);
    return `${d.getMonth()+1}/${d.getDate()}`;
  };

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* gridlines */}
      {gridY.map((g, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={g.y} y2={g.y} stroke={KILO_C.border} strokeWidth="0.5" strokeDasharray="2 3" />
          <text x={W - PAD_R} y={g.y - 3} fill={KILO_C.ink4} fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">{g.v.toFixed(1)}</text>
        </g>
      ))}

      {/* target line */}
      {target && (
        <g>
          <line x1={PAD_L} x2={W - PAD_R} y1={yAt(target)} y2={yAt(target)} stroke={KILO_C.accent} strokeWidth="0.5" strokeDasharray="3 3" opacity="0.6" />
          <text x={PAD_L + 4} y={yAt(target) - 3} fill={KILO_C.accent} fontSize="9" fontFamily="JetBrains Mono">target {target}</text>
        </g>
      )}

      {/* 30-day avg (dashed) */}
      <path d={path30} fill="none" stroke={KILO_C.ink3} strokeWidth="1" strokeDasharray="3 2" opacity="0.7" />

      {/* 7-day avg (solid orange) */}
      <path d={path7} fill="none" stroke={KILO_C.accent} strokeWidth="1.6" />

      {/* dots */}
      {filtered.map((w, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(w.weight)} r="1.6" fill={KILO_C.ink2} opacity="0.8" />
      ))}

      {/* x labels */}
      <text x={PAD_L} y={H - 6} fill={KILO_C.ink4} fontSize="9" fontFamily="JetBrains Mono">{fmtDate(filtered[0].date)}</text>
      <text x={W - PAD_R} y={H - 6} fill={KILO_C.ink4} fontSize="9" fontFamily="JetBrains Mono" textAnchor="end">{fmtDate(filtered[filtered.length - 1].date)}</text>
    </svg>
  );
}

const WEIGHT_STORAGE_KEY = 'kilo_weight_entries';

// Merge stored user entries into window.KILO_WEIGHTS once at load time.
// handleLog and remounts read the global directly — no re-merge, no duplication.
// Rehydrate weights from localStorage on module load
(function() {
  try {
    const stored = JSON.parse(localStorage.getItem(WEIGHT_STORAGE_KEY) || '[]');
    if (stored.length) {
      const userEntries = stored.map(e => ({ ...e, isUserEntry: true }));
      window.KILO_WEIGHTS = [...window.KILO_WEIGHTS, ...userEntries]
        .sort((a, b) => a.date.localeCompare(b.date));
    }
  } catch {}
})();

function persistWeightEntry(entry) {
  const entryToStore = { ...entry, isUserEntry: true };
  const stored = JSON.parse(localStorage.getItem(WEIGHT_STORAGE_KEY) || '[]');
  stored.push(entryToStore);
  localStorage.setItem(WEIGHT_STORAGE_KEY, JSON.stringify(stored));
}

function KiloWeight({ goToTab }) {
  const today = window.KILO_TODAY;
  const [weights, setWeights] = React.useState(() => window.KILO_WEIGHTS);
  const [range, setRange] = React.useState(30);
  const [showNote, setShowNote] = React.useState(false);
  const [entry, setEntry] = React.useState('');
  const [note, setNote] = React.useState('');
  const [status, setStatus] = React.useState(null); // null | { ok: true } | { ok: false, error }

  // Clear success status after delay
  React.useEffect(() => {
    if (status && status.ok) {
      const t = setTimeout(() => setStatus(null), 3000);
      return () => clearTimeout(t);
    }
  }, [status]);

  const lastEntry = weights[weights.length - 1];
  const loggedToday = lastEntry && (lastEntry.logged_at ? lastEntry.logged_at.startsWith(today) : lastEntry.date === today);

  const filtered = range === 9999 ? weights : weights.slice(-range);
  const getWeight = (w) => w.weight_value ?? w.weight;
  const getDate = (w) => w.logged_at ? w.logged_at.slice(0, 10) : w.date;

  const avg7Series = rollingAvgSeries(weights.map(w => ({ ...w, weight: getWeight(w) })), 7);
  const avg7 = avg7Series[avg7Series.length - 1];
  const avg30Series = rollingAvgSeries(weights.map(w => ({ ...w, weight: getWeight(w) })), 30);
  const avg30 = avg30Series[avg30Series.length - 1];
  const avg7Prev = rollingAvgSeries(weights.slice(0, -7).map(w => ({ ...w, weight: getWeight(w) })), 7);
  const wow = avg7 - avg7Prev[avg7Prev.length - 1];

  function handleLog() {
    const result = window.parseWeightEntry(entry);
    if (!result.ok) {
      setStatus({ ok: false, error: result.error });
      return;
    }

    const newEntry = {
      id: `w_${Date.now()}`,
      entry_type: 'weight',
      isUserEntry: true,
      weight_value: result.weight_value,
      weight_unit: result.weight_unit,
      logged_at: result.logged_at,
      saved_at: new Date().toISOString(),
      note_text: note.trim() || null,
      // Legacy fields for backward compatibility with graph/list code if not fully updated
      date: today,
      weight: result.weight_value
    };

    try {
      persistWeightEntry(newEntry);
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
    setNote('');
    setShowNote(false);
    setStatus({ ok: true });
  }

  function handleDelete(id) {
    if (window.deleteWeightEntry(id)) {
      setWeights([...window.KILO_WEIGHTS]);
    }
  }

  function handleEdit(id, currentVal) {
    const newVal = window.prompt('Edit weight (lbs):', currentVal);
    if (newVal !== null) {
      const result = window.parseWeightEntry(newVal);
      if (result.ok) {
        if (window.updateWeightEntry(id, result.weight_value)) {
          setWeights([...window.KILO_WEIGHTS]);
        }
      } else {
        window.alert(result.error);
      }
    }
  }

  const cutGoal = window.KILO_GOALS.find(g => g.type === 'body_weight' && g.active);

  // Trend alert: 7-day moving wrong direction for 10+ days?
  let wrongDir = 0;
  if (cutGoal) {
    for (let i = avg7Series.length - 1; i >= 1; i--) {
      if (avg7Series[i] == null || avg7Series[i-1] == null) break;
      const movingAway = cutGoal.direction === 'cut'
        ? avg7Series[i] > avg7Series[i-1]
        : avg7Series[i] < avg7Series[i-1];
      if (movingAway) wrongDir++;
      else break;
    }
  }
  const trendAlert = wrongDir >= 10;

  const ranges = [
    { v: 7, label: '7D' },
    { v: 30, label: '30D' },
    { v: 90, label: '90D' },
    { v: 9999, label: 'ALL' },
  ];

  return (
    <div className="kilo-screen">
      <KiloHeader title="Weight" sub="DAILY · LBS" />

      <div className="kilo-scroll">
        {/* Quick entry */}
        <div style={{ padding: '14px 16px 0' }}>
          <div style={{
            background: KILO_C.surface,
            border: `1px solid ${status?.ok ? KILO_C.green : status ? KILO_C.red : KILO_C.border}`,
            borderRadius: 4, padding: '14px 16px',
            transition: 'border-color 0.2s',
          }}>
            <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              Today · {new Date(today + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              {!loggedToday && <span className="kilo-blink" style={{ color: KILO_C.accent, marginLeft: 8 }}>● needs entry</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: showNote ? 12 : 0 }}>
              <span className="kilo-mono" style={{ fontSize: 24, color: status?.ok ? KILO_C.green : KILO_C.accent, fontWeight: 600 }}>›</span>
              <input
                className="kilo-input"
                style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.02em', color: status?.ok ? KILO_C.green : KILO_C.ink }}
                placeholder="000.0"
                value={entry}
                onChange={(e) => { setEntry(e.target.value); setStatus(null); }}
                onKeyDown={(e) => e.key === 'Enter' && entry && handleLog()}
                inputMode="decimal"
              />
              <span className="kilo-mono" style={{ fontSize: 14, color: KILO_C.ink3 }}>lb</span>
            </div>
            {showNote && (
              <input
                className="kilo-input"
                style={{ fontSize: 12, color: KILO_C.ink2, paddingTop: 8, borderTop: `1px solid ${KILO_C.border}` }}
                placeholder="note (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <button className="kilo-btn" onClick={() => setShowNote(s => !s)} style={{ background: 'transparent', color: KILO_C.ink3, padding: 0, fontSize: 11 }}>
                <span className="kilo-mono" style={{ letterSpacing: '0.06em' }}>{showNote ? '− note' : '+ note'}</span>
              </button>
              <button
                className="kilo-btn"
                disabled={!entry || status?.ok}
                onClick={handleLog}
                style={{
                  background: !entry || status?.ok ? KILO_C.surface2 : KILO_C.accent,
                  color: !entry || status?.ok ? KILO_C.ink4 : '#000',
                  padding: '6px 16px', borderRadius: 3, fontWeight: 700, fontSize: 11,
                  letterSpacing: '0.1em', textTransform: 'uppercase',
                  transition: 'all 0.2s',
                }}
              >
                {status?.ok ? 'Saved' : 'Log'}
              </button>
            </div>
            {status && (
              <div className="kilo-mono" style={{ marginTop: 8, fontSize: 11, color: status.ok ? KILO_C.green : KILO_C.red }}>
                {status.ok ? '✓ Weight saved successfully' : `✕ ${status.error}`}
              </div>
            )}
          </div>
        </div>

        {/* Trend alert */}
        {trendAlert && (
          <div style={{ margin: '12px 16px 0', padding: '10px 12px', background: 'rgba(250,204,21,0.08)', border: `1px solid ${KILO_C.yellow}`, borderRadius: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: KILO_C.yellow, fontSize: 13 }}>⚠</span>
              <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.yellow, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                7-day avg moving away from goal · {wrongDir}d
              </div>
            </div>
          </div>
        )}

        {/* Range tabs */}
        <div style={{ padding: '20px 16px 0', display: 'flex', gap: 4 }}>
          {ranges.map(r => (
            <button
              key={r.v}
              className="kilo-btn"
              onClick={() => setRange(r.v)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 3,
                background: range === r.v ? KILO_C.accentDim : 'transparent',
                color: range === r.v ? KILO_C.accent : KILO_C.ink3,
                border: `1px solid ${range === r.v ? 'transparent' : KILO_C.border2}`,
                fontFamily: KILO_MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.1em',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Graph */}
        <div style={{ padding: '12px 12px 0' }}>
          <WeightGraph weights={weights.map(w => ({ ...w, weight: getWeight(w), date: getDate(w) }))} range={range === 9999 ? weights.length : range} target={cutGoal && cutGoal.target} />
        </div>

        {/* Stats grid */}
        <div style={{ padding: '12px 16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: KILO_C.border }}>
          <StatCell label="7-day avg" val={avg7.toFixed(1)} unit="lb" big />
          <StatCell label="30-day avg" val={avg30 ? avg30.toFixed(1) : '—'} unit="lb" />
          <StatCell label="WoW Δ" val={(wow >= 0 ? '+' : '') + wow.toFixed(2)} unit="lb" color={wow < 0 ? KILO_C.green : KILO_C.yellow} />
          <StatCell label="Days logged" val={`${filtered.length}`} unit={range === 9999 ? '/ all' : `/ ${range}`} />
        </div>

        {/* Goal progress */}
        {cutGoal && (
          <div style={{ padding: '20px 16px 0' }}>
            <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
              Cut goal · {cutGoal.label}
            </div>
            <div style={{ background: KILO_C.surface, border: `1px solid ${KILO_C.border}`, padding: '12px 14px', borderRadius: 3 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <KiloNum size={18} weight={600}>{avg7.toFixed(1)}</KiloNum>
                <span className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3 }}>→</span>
                <KiloNum size={14} color={KILO_C.accent}>{cutGoal.target}</KiloNum>
                <span className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3 }}>({(avg7 - cutGoal.target).toFixed(1)} to go)</span>
              </div>
              <div style={{ height: 4, background: KILO_C.bg2, borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
                {(() => {
                  // For cut: progress from start to target
                  const startVal = getWeight(weights[0]);
                  const pct = Math.min(100, Math.max(0, ((startVal - avg7) / (startVal - cutGoal.target)) * 100));
                  return <div style={{ height: '100%', width: `${pct}%`, background: KILO_C.accent }} />;
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Entry list */}
        <KiloSection title="Entries">
          <div style={{ borderTop: `1px solid ${KILO_C.border}` }}>
            {weights.slice().reverse().slice(0, 12).map((w, i) => {
              const prev = weights[weights.length - 2 - i];
              const val = getWeight(w);
              const prevVal = prev ? getWeight(prev) : null;
              const delta = prevVal !== null ? val - prevVal : null;
              const d = new Date(getDate(w) + 'T12:00:00');
              return (
                <div key={w.id || w.date} style={{ padding: '11px 16px', borderBottom: `1px solid ${KILO_C.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3, width: 76 }}>
                    {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
                  </div>
                  <KiloNum size={14} weight={500}>{val.toFixed(1)}</KiloNum>
                  {delta != null && (
                    <span className="kilo-mono" style={{ fontSize: 10, color: delta < 0 ? KILO_C.green : delta > 0 ? KILO_C.ink3 : KILO_C.ink4 }}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  {w.note_text && <KiloIcon name="more" size={12} color={KILO_C.ink4} />}
                  {w.isUserEntry && (
                    <>
                      <button className="kilo-btn" onClick={() => handleEdit(w.id, val)} style={{ background: 'transparent', padding: 0, marginLeft: 8 }}>
                        <KiloIcon name="edit" size={12} color={KILO_C.ink4} />
                      </button>
                      <button className="kilo-btn" onClick={() => window.confirm('Delete this entry?') && handleDelete(w.id)} style={{ background: 'transparent', padding: 0, marginLeft: 8 }}>
                        <KiloIcon name="close" size={12} color={KILO_C.red} />
                      </button>
                    </>
                  )}
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

function StatCell({ label, val, unit, color, big }) {
  return (
    <div style={{ padding: '12px 14px', background: KILO_C.bg }}>
      <div className="kilo-mono" style={{ fontSize: 9, color: KILO_C.ink3, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <KiloNum size={big ? 22 : 16} weight={600} color={color}>{val}</KiloNum>
        {unit && <span className="kilo-mono" style={{ fontSize: 10, color: KILO_C.ink3 }}>{unit}</span>}
      </div>
    </div>
  );
}

window.KiloWeight = KiloWeight;
window.persistWeightEntry = persistWeightEntry;
