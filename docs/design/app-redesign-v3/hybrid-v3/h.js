// Final hybrid, revision 3 (compact averages on Weight, latest weigh-in on Bodyweight) — Ledger structure, Center Court hierarchy. Every screen maps to an existing
// production surface; anything that would need new behaviour or data is marked in README.md.
(function () {
  const D = window.KILO_DATA; const S = P.S; const I = P.icon; const W = D.weight; const G = W.goal;
  Object.assign(window.KILO_ICONS, { 'skip-next': 57412, image: 58356, 'call-merge': 57523, 'playlist-add': 57403, undo: 57702, 'filter-list': 57682, pause: 57396 });
  const TABS = [['home', 'Home', 'home'], ['log', 'Log', 'fitness-center'], ['weight', 'Weight', 'monitor-weight'], ['analytics', 'Analytics', 'bar-chart'], ['more', 'More', 'more-horiz']];
  const key = (n) => n.replace(/\W/g, '');
  const EX = {}; D.routine.days.forEach((d) => d.blocks.forEach((b) => b.exercises.forEach((e) => { EX[key(e.name)] = { ...e, day: d.day }; })));

  // ---- Shared pieces ----
  const header = (title, ctx = '', right = '') => `<header class="hdr"><div class="tt"><h1>${title}</h1>${ctx ? `<span class="ctx">${ctx}</span>` : ''}</div>${right}</header>`;
  const tabbar = () => `<nav class="tabbar" role="tablist">${TABS.map(([k, l, ic]) => `<button role="tab" class="${S.tab === k ? 'on' : ''}" data-act="tab" data-v="${k}" aria-selected="${S.tab === k}">${I(ic, 24)}${l}</button>`).join('')}</nav>`;
  const sec = (id, title, right = '') => `<div class="sec-h" id="sec-${id}"><h2>${title}</h2>${right}</div>`;
  const disc = (id, icon, label, body) => { const o = P.isOpen(id); return `<button class="disc" data-act="open" data-id="${id}" aria-expanded="${o}">${I(icon, 20)}<span>${label}</span>${I(o ? 'expand-less' : 'expand-more', 20, 'chev')}</button>${o ? body : ''}`; };
  const pill = (t) => t === 'up' ? `<span class="tp up">${I('arrow-upward', 14)}Progressing</span>` : t === 'down' ? `<span class="tp down">${I('arrow-downward', 14)}Regressing</span>` : `<span class="tp flat">${I('trending-flat', 14)}Steady</span>`;
  const progressLegend = (p = D.progress) => `<div class="legend col"><span><b style="color:var(--completion)">${p.progressing}</b>Progressing</span><span><b style="color:var(--warning)">${p.steady}</b>Steady</span><span><b style="color:${p.regressing ? 'var(--error-text)' : 'var(--muted)'}">${p.regressing}</b>Regressing</span></div>`;
  const ring = (p = D.progress, size = 96) => {
    const r = size / 2 - 6, c = 2 * Math.PI * r; let off = 0;
    const seg = [[p.progressing, 'var(--completion)'], [p.steady, 'var(--warning)'], [p.regressing, 'var(--error-text)']].filter(([v]) => v).map(([v, col]) => { const len = (v / p.tracked) * c; const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="10" stroke-dasharray="${Math.max(0, len - 3)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`; off += len; return s; }).join('');
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${p.progressing} progressing, ${p.steady} steady, ${p.regressing} regressing of ${p.tracked} tracked"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--section)" stroke-width="10"/>${seg}<text x="50%" y="47%" text-anchor="middle" style="font:700 26px var(--mono);fill:var(--on)">${p.tracked}</text><text x="50%" y="66%" text-anchor="middle" style="font:500 11px var(--mono);fill:var(--muted);letter-spacing:.06em">TRACKED</text></svg>`;
  };
  const oneKBar = (h = 10) => { const K = D.oneK; return `<div class="bar" style="height:${h}px" role="img" aria-label="Squat ${K.squat}, bench ${K.bench}, deadlift ${K.deadlift}, ${1000 - K.total} to 1,000"><i style="flex:${K.squat};background:var(--s1)"></i><i style="flex:${K.bench};background:var(--s2)"></i><i style="flex:${K.deadlift};background:var(--s3)"></i><i class="hatch" style="flex:${1000 - K.total}"></i></div>`; };
  const lifts = (tap) => { const K = D.oneK; return `<div class="split three">${[['Squat', K.squat, 's1'], ['Bench', K.bench, 's2'], ['Deadlift', K.deadlift, 's3']].map(([n, v, c]) => `<div>${tap ? `<button class="liftv" data-act="sheet" data-v="plates:${n}" aria-label="${n} ${v} lb, show plate loading">` : ''}<span class="k"><span class="sq" style="background:var(--${c})"></span>${n}</span><span><span class="val">${v}</span><span class="u">lb</span></span>${tap ? '</button>' : ''}</div>`).join('')}</div>`; };
  const goalBar = () => { const pct = Math.round(((G.start - W.latest) / (G.start - G.target)) * 100); return `<div style="display:flex;flex-direction:column;gap:6px"><div class="bar" style="height:10px" role="img" aria-label="${pct}% of the way from ${G.start} to ${G.target}"><i style="flex:${pct};background:var(--completion)"></i><i style="flex:${100 - pct};background:var(--section)"></i></div><div class="zl" style="justify-content:space-between"><span>START ${G.start}</span><span>${pct}%</span><span>TARGET ${G.target}</span></div></div>`; };

  // Weight chart: every weigh-in at its recorded date; line = selected rolling average (7D/30D).
  const md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // Goal-aware change tone, as production's weightTrendTone: toward the goal reads positive, away negative, zero neutral.
  const wdelta = (v, cls = '') => { const tone = !v ? '' : ((v > 0) === (G.mode === 'Bulking') ? 'dn' : 'err'); return `<span class="wd ${tone} ${cls}">${v ? I(v < 0 ? 'arrow-downward' : 'arrow-upward', 14) : ''}${P.signed(v)}</span>`; };
  const rollAt = (p, win) => { const w = W.entries.filter((e) => e.ago >= p.ago && e.ago < p.ago + win); return w.reduce((s, e) => s + e.value, 0) / w.length; };
  function wChart({ w = 326, h = 176, win = 7, goal = true, point = null, axis = true, sw = 2.25, latest = false } = {}) {
    const E = W.entries; const span = E[0].ago; const roll = E.map((p) => rollAt(p, win));
    const vals = E.map((p) => p.value).concat(goal ? [G.target] : []);
    const min = Math.floor(Math.min(...vals) - 0.5), max = Math.ceil(Math.max(...vals) + 0.5);
    const L = 2, R = axis ? 34 : 2, T = 8, B = axis ? 22 : 4;
    const x = (ago) => L + ((span - ago) / span) * (w - L - R); const y = (v) => T + (1 - (v - min) / (max - min)) * (h - T - B);
    let s = `<svg width="100%" viewBox="0 0 ${w} ${h}" role="img" aria-label="Body weight, ${E.length} weigh-ins from ${W.fmtDate(E[0].date)} to ${W.fmtDate(E[E.length - 1].date)}, ${win}-day rolling average">`;
    if (axis) {
      [min, Math.round((min + max) / 2), max].forEach((t) => { s += `<line x1="${L}" x2="${w - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)"/><text x="${w - R + 6}" y="${y(t) + 4}" class="ax">${t}</text>`; });
      [0, Math.floor(E.length / 3), Math.floor((2 * E.length) / 3), E.length - 1].forEach((i, n) => { const e = E[i]; s += `<text x="${x(e.ago)}" y="${h - 4}" class="ax" text-anchor="${n === 0 ? 'start' : n === 3 ? 'end' : 'middle'}">${md(e.date)}</text>`; });
    }
    if (goal) s += `<line x1="${L}" x2="${w - R}" y1="${y(G.target)}" y2="${y(G.target)}" stroke="var(--completion)" stroke-width="1.25" stroke-dasharray="4 4"/>${axis ? `<text x="${L + 2}" y="${y(G.target) - 5}" class="ax" style="fill:var(--completion)">GOAL ${G.target}</text>` : ''}`;
    if (axis) E.forEach((p) => { s += `<circle cx="${x(p.ago)}" cy="${y(p.value)}" r="2" fill="var(--muted)" opacity=".6"/>`; });
    s += `<path d="${E.map((p, i) => `${i ? 'L' : 'M'}${x(p.ago).toFixed(1)},${y(roll[i]).toFixed(1)}`).join('')}" fill="none" stroke="var(--s1)" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const lp = E[E.length - 1]; s += `<circle cx="${x(lp.ago)}" cy="${y(roll[roll.length - 1])}" r="4" fill="var(--s1)" stroke="var(--card)" stroke-width="2"/>`;
    if (latest) s += `<circle cx="${x(lp.ago)}" cy="${y(lp.value)}" r="5" fill="var(--card)" stroke="var(--on)" stroke-width="2"/>`;
    if (point != null) { const p = E[point]; s += `<line x1="${x(p.ago)}" x2="${x(p.ago)}" y1="${T}" y2="${h - B}" stroke="var(--on)" opacity=".35"/><circle cx="${x(p.ago)}" cy="${y(p.value)}" r="4.5" fill="var(--on)" stroke="var(--card)" stroke-width="2"/>`; }
    if (axis) s += `<g>${E.map((p, i) => `<rect data-act="point" data-i="${i}" x="${x(p.ago) - 3}" y="0" width="6" height="${h}" fill="transparent"/>`).join('')}</g>`;
    return { svg: s + '</svg>', x };
  }
  // Top-set load per logged session, straight from the note (no dates, no estimation).
  const loadSeries = (e) => e.sessions.map((s) => (s.load == null ? Math.max(...s.reps) : s.load));

  // ---------------- HOME ----------------
  function home() {
    const R = D.recovery;
    const hero = S.recovery ? `<section class="panel now"><div class="pad">
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="k">Recovery · Week ${R.week}</span><a class="lnk" data-act="go" data-tab="analytics" data-sec="recovery">Evidence ${I('chevron-right', 16)}</a></div>
        <div style="display:flex;align-items:baseline;gap:8px"><span class="hero-n">${R.total}%</span><span class="cap">total recovery vs baseline</span></div>
        ${R.lifts.map(([n, v]) => `<div style="display:flex;flex-direction:column;gap:4px"><div style="display:flex;justify-content:space-between"><span class="body" style="font-weight:600">${n}</span><b class="val" style="font-size:15px">${v}%</b></div><div class="bar" style="height:6px"><i style="flex:${v};background:var(--primary-mark)"></i><i style="flex:${100 - v};background:var(--section)"></i></div></div>`).join('')}
        <div class="btns"><button class="btn pri" data-act="go" data-tab="log">${I('add', 18)}Log workout</button><button class="btn gh" data-act="go" data-tab="weight">Log weight</button></div></div></section>`
      : `<section class="panel now"><div class="pad">
        <span class="k">Current routine · Week ${D.routine.week}</span>
        <h2 style="font:700 22px/28px var(--sg)">${D.routine.title}</h2>
        <button class="hero-row" data-act="go" data-tab="analytics" data-sec="progress" aria-label="Exercise progress: open Progressive Overload">${ring()}<div style="flex:1;display:flex;flex-direction:column;gap:6px"><span class="k" style="color:var(--on)">Exercise progress</span>${progressLegend()}</div>${I('chevron-right', 22, 'chev')}</button>
        <div class="btns"><button class="btn pri" data-act="go" data-tab="log">${I('add', 18)}Log workout</button><button class="btn gh" data-act="go" data-tab="weight">Log weight</button></div></div></section>`;
    const K = D.oneK;
    const onek = S.recovery ? '' : `<section class="panel"><div class="ph"><a class="lnk" style="color:var(--on)" data-act="go" data-tab="analytics" data-sec="strength">1K Progress ${I('chevron-right', 16)}</a><span class="cap">${1000 - K.total} lb to 1,000</span></div>
        <div style="padding:0 16px 12px;display:flex;flex-direction:column;gap:10px"><div><span class="metric">${K.total}</span><span class="u">lb</span></div>${oneKBar(8)}</div>${lifts(false)}</section>`;
    const c = wChart({ w: 120, h: 44, axis: false, goal: true, sw: 2 });
    const wt = `<section class="panel"><div class="ph"><a class="lnk" style="color:var(--on)" data-act="go" data-tab="weight">Body weight ${I('chevron-right', 16)}</a><span class="cap">${md(W.entries[0].date)} – ${md(W.entries[W.entries.length - 1].date)}</span></div>
        <div style="padding:0 16px 14px" class="wcard"><div><span class="metric">${W.latest}</span><span class="u">lb</span><div class="cap" style="margin-top:2px">${G.mode} · ${G.target} lb · <b style="color:var(--on)">${G.weeksLeft}</b> weeks left</div></div><button style="width:120px" data-act="go" data-tab="analytics" data-sec="bodyweight" aria-label="Open the weight trend in Analytics">${c.svg}</button></div></section>`;
    return header(P.wordmark(24).replace('<svg', '<svg style="display:block;margin:2px 0"'), '', `<button class="ib" aria-label="Cloud sync: synced">${I('cloud-done', 22)}</button>`)
      + `<div class="scroll"><div class="content">${hero}${onek}${wt}</div></div>`;
  }

  // ---------------- LOG ----------------
  function exercise(e, day) {
    const id = `ex-${key(e.name)}`; const open = P.isOpen(id); const n = e.sessions.length; const show = open ? e.sessions : e.sessions.slice(-3);
    const lines = show.map((s, i) => { const last = i === show.length - 1; return `<div class="sl ${last ? 'last' : 'old'}" data-act="edit"><span>${s.load == null ? 'BW' : `${s.load} lb`}</span><span>${s.reps.join(', ')}</span>${last ? '<span class="tag">LAST</span>' : '<span></span>'}</div>`; }).join('');
    const sugg = e.name === 'Incline Dumbbell Press' ? `<div class="sugg"><div class="h">${I('trending-up', 18)}Add weight next session<span class="badge">HEURISTIC</span></div><p>10, 10, 9 at 75 lb in a 3x8-10 range. Try 80 lb once every set reaches 10.</p><div class="acts"><button class="pri">Apply to note</button><button>Dismiss</button><button>Mute</button></div></div>` : '';
    return `<div class="exr" data-dbl="edit">
      <div class="nm"><b>${e.name}</b>${e.range ? `<span class="rg">${e.range}</span>` : ''}<button class="ib" style="min-width:40px" data-act="sheet" data-v="hist:${key(e.name)}" aria-label="${e.name} history">${I('history', 20)}</button><button class="trk ${e.tracked ? 'on' : ''}" aria-pressed="${e.tracked}">${e.tracked ? '✓ Tracked' : 'Track'}</button></div>
      ${n > 3 ? `<button class="earlier" data-act="open" data-id="${id}" aria-expanded="${open}">${I(open ? 'unfold-less' : 'unfold-more', 16)}${open ? 'Show last 3' : `${n - 3} earlier sessions`}</button>` : ''}
      ${lines}${sugg}</div>`;
  }
  function log() {
    if (S.editor) return logEditor();
    const R = D.routine; const mode = S.view || 'routine';
    const right = `<button class="ib lbl" data-act="sheet" data-v="plates:" aria-label="Plate calculator">${I('calculate', 18)}Plates</button><button class="ib" data-act="sheet" data-v="actions" aria-label="Routine actions">${I('more-horiz', 26)}</button>`;
    const seg = `<div class="seg" role="tablist">${S.recovery ? `<button class="${mode === 'recovery' ? 'on' : ''}" data-act="lview" data-v="recovery">Recovery</button>` : ''}<button class="${mode === 'routine' ? 'on' : ''}" data-act="lview" data-v="routine">Routine</button><button class="${mode === 'deload' ? 'on' : ''}" data-act="lview" data-v="deload">Deload</button></div>`;
    let body;
    if (mode === 'deload') body = deloadView();
    else if (mode === 'recovery') body = recoveryLog();
    else {
      const collapsed = P.isOpen('rt-collapsed');
      body = `<section class="panel now">
        <div class="rt-h"><div class="t"><button data-act="open" data-id="rt-collapsed" aria-expanded="${!collapsed}" style="text-align:left"><h2>${R.title}</h2></button>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="k">Week ${R.week} · current</span><div class="seg inline" role="tablist"><button class="on">Week A</button><button>Week B</button></div></div></div></div>
        ${collapsed ? '' : `<div class="stick"><div class="days">${R.days.map((d) => `<button class="${S.day === d.key ? 'on' : ''}" data-act="day" data-v="${d.key}"><b>${d.day.slice(0, 3)}</b><span>${d.name}</span></button>`).join('')}</div></div>
        ${R.days.map((d) => `<div id="day-${d.key}"><div class="dayh"><h3>${d.day} — ${d.name}</h3><span class="k">${d.blocks.reduce((s, b) => s + b.exercises.length, 0)} ex</span></div>
          ${d.blocks.map((b) => `<div class="blk">${b.name}</div>${b.exercises.map((e) => exercise(e, d.day)).join('')}`).join('')}</div>`).join('')}`}
      </section>
      <section class="panel"><button class="entry" data-act="lview" data-v="recovery-start">${I('replay', 20)}Start recovery block${I('chevron-right', 20, 'chev')}</button></section>
      <section class="panel"><div class="ph"><span class="k">More routines · ${D.otherRoutines.length}</span><button class="btn qt sm">${I('add', 18)}New routine</button></div>
        ${D.otherRoutines.map((r) => `<div class="row"><div style="flex:1;display:flex;flex-direction:column;gap:2px"><b style="font:var(--title)">${r.title}</b><span class="cap">Created ${r.created}${r.meta ? ` · ${r.meta}` : ''}</span></div><button class="ib" aria-label="${r.title} actions" data-act="sheet" data-v="ractions:${key(r.title)}">${I('more-vert', 22)}</button></div>`).join('')}</section>`;
    }
    return header('Log', '', right) + `<div class="scroll" id="sc"><div class="content">${seg}${body}</div></div>`;
  }
  function deloadView() {
    return `<section class="panel now"><div class="pad"><span class="k">Active deload</span><h2 style="font:700 20px/26px var(--sg)">${D.routine.title} — Deload</h2>
        <p class="cap">Generated from your current note at reduced load. Log it like any routine.</p></div>
        ${D.routine.days.slice(0, 2).map((d) => `<div class="dayh"><h3>${d.day} — ${d.name}</h3></div>${d.blocks[0].exercises.map((e) => { const l = e.sessions[e.sessions.length - 1]; return `<div class="exr"><div class="nm"><b>${e.name}</b></div><div class="sl last"><span>${l.load == null ? 'BW' : `${Math.round(l.load * 0.6 / 5) * 5} lb`}</span><span>${l.reps.map(() => l.reps[0]).slice(0, 2).join(', ')}</span><span></span></div></div>`; }).join('')}`).join('')}</section>
      <section class="panel"><div class="pad"><span class="k">Finish deload</span><div class="qe" style="padding:0"><div class="in"><b>11</b><span class="u">session #</span></div><button class="btn pri" style="flex:none">Confirm deload complete</button></div></div>
        <button class="entry">${I('autorenew', 20)}Regenerate deload${I('chevron-right', 20, 'chev')}</button>
        <button class="entry err" style="border-top:1px solid var(--border)">${I('delete-outline', 20)}<span style="color:var(--error-text)">Delete active deload</span></button></section>`;
  }
  function recoveryLog() {
    const R = D.recovery;
    return `<section class="panel now"><div class="pad"><span class="k">Recovery block · Week ${R.week}</span><h2 style="font:700 20px/26px var(--sg)">Recovery Week ${R.week}</h2><p class="cap">Baseline: ${R.baseline}. Log sessions below; completion is per week.</p></div>
        <div class="dayh"><h3>Monday — Upper</h3></div><div class="exr"><div class="nm"><b>Bench Press</b></div><div class="sl old"><span>185 lb</span><span>5, 5, 5</span><span></span></div><div class="sl last"><span>195 lb</span><span>5, 5, 4</span><span class="tag">LAST</span></div></div></section>
      <section class="panel">${[['check-circle', 'Complete week'], ['playlist-add', 'Add the next recovery week'], ['tune', 'Movement groups'], ['restart-alt', 'Rebuild baseline'], ['flag', 'End block']].map(([ic, l], i) => `<button class="entry" ${i ? 'style="border-top:1px solid var(--border)"' : ''}>${I(ic, 20)}${l}${I('chevron-right', 20, 'chev')}</button>`).join('')}</section>
      <a class="lnk" data-act="go" data-tab="analytics" data-sec="recovery" style="align-self:flex-start">Recovery evidence in Analytics ${I('chevron-right', 16)}</a>`;
  }
  function logEditor() {
    const raw = P.rawNote().split('\n').slice(0, 26);
    const hl = raw.map((l, i) => { const t = l.replace(/&/g, '&amp;').replace(/</g, '&lt;'); const cls = /^(Monday|Tuesday|Thursday|Friday)/.test(l) ? 'd' : l.startsWith('+') ? 'b' : l.startsWith('-') ? 'e' : ''; return `<span class="${cls}">${t}</span>${i === 9 ? '<span class="caret"></span>' : ''}`; }).join('\n');
    const panel = S.timer ? `<div class="tpanel" role="dialog" aria-label="Rest timer"><div class="top"><span class="metric">1:12</span><span class="cap">of 1:30 rest</span></div><div class="prog"><i style="width:20%"></i></div>
      <div class="presets">${['0:30', '1:00', '1:30', '2:00', '3:00'].map((p) => `<button class="${p === '1:30' ? 'on' : ''}" aria-label="Restart at ${p}">${p}</button>`).join('')}</div>
      <div class="btns"><button class="btn qt">Cancel timer</button><button class="btn qt" data-act="timer">Dismiss</button></div></div>` : '';
    return `<header class="hdr"><div class="tt"><h1>Editing</h1><span class="ctx">${D.routine.title} · Week A</span></div><button class="btn pri sm" data-act="done">Done</button></header>
      <div class="scroll"><div class="content" style="gap:12px">
        <section class="panel now" style="position:relative;overflow:visible">
          <div class="ed-bar"><button class="tool ${S.timer ? 'live' : ''}" data-act="timer" aria-label="${S.timer ? 'Rest timer 1:12 remaining' : 'Start rest timer'}">${I('timer', 20)}${S.timer ? '1:12' : 'Rest'}</button><button class="tool" data-act="sheet" data-v="plates:" aria-label="Plate calculator">${I('calculate', 20)}</button><button class="tool" aria-label="Workout syntax help">${I('help-outline', 20)}</button><span class="st">${I('check', 14)}SAVED</span></div>
          ${panel}<div class="ed-area">${hl}</div>
        </section>
        <section class="panel">${[['content-paste', 'Import routine'], ['note-alt', 'Insert example workout note'], ['call-merge', 'Merge Week A and Week B'], ['restart-alt', 'Revert this edit']].map(([ic, l], i) => `<button class="entry" ${i ? 'style="border-top:1px solid var(--border)"' : ''}>${I(ic, 20)}${l}</button>`).join('')}
          <button class="entry" style="border-top:1px solid var(--border)">${I('delete-outline', 20)}<span style="color:var(--error-text)">Delete routine</span></button></section>
      </div></div>`;
  }

  // ---------------- WEIGHT (record + manage; the trend chart lives in Analytics › Bodyweight) ----------------
  function weight() {
    const hist = W.entries.slice().reverse().slice(0, P.isOpen('w-more') ? 14 : 6);
    const editing = P.isOpen('goal-edit');
    const last = W.entries[W.entries.length - 1];
    return header('Weight', `${W.count} weigh-ins · ${G.mode} → ${G.target} lb`) + `<div class="scroll" id="sc"><div class="content">
      <section class="panel now"><div class="ph"><span class="k">Log weigh-in</span></div>
        <div class="qe" style="padding-top:0"><div class="in" aria-label="Weight"><b>187.4</b><span class="u">lb</span></div><button class="dt" aria-label="Date: today">${I('date-range', 18)}Today</button><button class="btn pri sm">Save</button></div>
        <div style="padding:0 12px 6px;margin-top:-6px"><button class="earlier">${I('add', 16)}Add note</button></div></section>
      <section class="panel"><div class="wnow">
        <div><span class="k">Latest · ${W.fmtDate(last.date)}</span><div><span class="hero-n">${W.latest}</span><span class="u">lb</span></div><span class="cap">${wdelta(W.prev)} vs previous</span></div>
        <dl class="avgs"><div><dt>7-day avg</dt><dd><b>${W.avg7.toFixed(1)}</b>${wdelta(W.avg7d)}</dd></div><div><dt>30-day avg</dt><dd><b>${W.avg30.toFixed(1)}</b>${wdelta(W.avg30d)}</dd></div></dl>
      </div><button class="disc" data-act="go" data-tab="analytics" data-sec="bodyweight">${I('show-chart', 20)}<span>Full trend in Analytics</span>${I('chevron-right', 20, 'chev')}</button></section>
      <section class="panel"><div class="ph"><span class="k">Goal · <b style="color:var(--primary-mark)">${G.mode.toUpperCase()}</b></span><span class="cap dn" style="display:inline-flex;gap:4px;align-items:center;padding-right:8px">${I('check', 16)}On Track</span></div>
        ${editing ? `<div class="pad" style="padding-top:0"><div class="qe" style="padding:0"><div class="in"><b>183</b><span class="u">lb target</span></div><button class="dt">${I('date-range', 18)}${G.targetDate}</button></div><div class="btns"><button class="btn pri">Save goal</button><button class="btn qt" data-act="open" data-id="goal-edit">Cancel</button></div></div>`
        : `<div style="padding:0 16px 14px;display:flex;flex-direction:column;gap:10px"><div><span class="metric">${G.toGo}</span><span class="u">lb to go</span><span class="cap"> · ${G.weeksLeft} weeks left</span></div>${goalBar()}</div>`}
        <div class="split"><div><span class="k">Target</span><span><span class="val">${G.target}</span><span class="u">lb</span></span></div><div><span class="k">Target date</span><span class="val">${G.targetDate}</span></div></div>
        <div class="split"><div><span class="k">Target pace</span><span><span class="val">${G.pace}</span><span class="u">lb/wk</span></span></div><div><span class="k">Suggested deficit</span><span><span class="val">${G.deficit}</span><span class="u">cal/day</span></span></div></div>
        <div class="btns" style="padding:10px 16px;border-top:1px solid var(--border)"><button class="btn qt sm" data-act="open" data-id="goal-edit">${I('edit', 16)}Edit</button><button class="btn qt sm">Archive</button><button class="btn dg sm">Clear</button></div></section>
      <section class="panel"><div class="ph"><span class="k">History · ${W.count}</span><span style="display:flex"><button class="ib" data-act="open" data-id="w-filter" aria-label="Filter by date range">${I('filter-list', 22)}</button></span></div>
        ${P.isOpen('w-filter') ? `<div class="qe" style="padding:0 12px 12px"><button class="dt" style="flex:1">${I('date-range', 18)}From 09-01-2026</button><button class="dt" style="flex:1">${I('date-range', 18)}To 10-22-2026</button></div>` : ''}
        <div class="hcols"><span>Weight</span><span class="c">Change</span><span class="d">Date</span><span></span></div>
        ${hist.map((e, i) => { const all = W.entries; const idx = all.length - 1 - i; const prev = all[idx - 1]; const ch = prev ? e.value - prev.value : 0; return `<div class="hrow" aria-label="Edit weigh-in"><span class="w">${e.value.toFixed(1)}${e.note ? `<small>${e.note}</small>` : ''}</span><span class="c ${ch < 0 ? 'dn' : ''}">${P.signed(ch)}</span><span class="d">${md(e.date)}</span><button class="x ib" aria-label="Delete weigh-in ${W.fmtDate(e.date)}">${I('close', 18)}</button></div>`; }).join('')}
        <div class="row" style="justify-content:center;min-height:48px"><button class="lnk" data-act="open" data-id="w-more">${P.isOpen('w-more') ? 'Show fewer' : 'Show more weight entries'}</button></div></section>
      <section class="panel">${disc('goal-hist', 'history', `Goal history · ${W.goalHistory.length}`, W.goalHistory.map((g) => `<div class="row"><div style="flex:1;display:flex;flex-direction:column;gap:2px"><b style="font:var(--title)">${g.mode} → ${g.target} lb</b><span class="cap">Target ${g.targetDate} · ended at ${g.end} lb</span></div><span class="cap dn">✓ ${g.outcome}</span></div>`).join('')).replace('class="disc"', 'class="disc" style="border-top:0"')}</section>
    </div></div>`;
  }

  // ---------------- ANALYTICS: one scroll, four chapters ----------------
  // Old section ids stay as anchors inside the chapters so existing deep links still land.
  const CHAPTER_OF = { strength: 'progress', progress: 'progress', breakdown: 'training', health: 'training', training: 'training', weight: 'bodyweight', bodyweight: 'bodyweight', recovery: 'recovery', rhistory: 'recovery', baseline: 'baseline' };
  const chapters = () => (S.recovery ? [['recovery', 'Recovery'], ['bodyweight', 'Bodyweight'], ['baseline', 'Paused']] : [['progress', 'Progress'], ['training', 'Training'], ['bodyweight', 'Bodyweight'], ['recovery', 'Recovery']]);
  const chapter = (id, n, title, extra = '') => `<div class="ch" id="ch-${id}" data-ch="${id}"><span class="no">${n}</span><h2>${title}</h2>${extra}</div>`;
  const sub = (id, title, right = '') => `<div class="sub-h" id="sec-${id}"><h3>${title}</h3>${right}</div>`;
  function bodyweightChapter(n) {
    const win = S.win === '30' ? 30 : 7; const pt = S.point !== '' ? Number(S.point) : null;
    const c = wChart({ win, point: pt, latest: true }); const last = W.entries[W.entries.length - 1]; const p = pt != null ? W.entries[pt] : null; const px = p ? c.x(p.ago) : 0;
    const callout = p ? `<div class="callout" style="${px > 163 ? `right:${Math.max(0, 326 - px - 16)}px` : `left:${Math.max(0, px - 16)}px`};top:4px"><b>${p.value.toFixed(1)} lb</b> · ${W.fmtDate(p.date)}<br>${win}-day avg ${rollAt(p, win).toFixed(1)}${p.note ? `<br>${p.note}` : ''}</div>` : '';
    return chapter('bodyweight', n, 'Bodyweight') + `<div id="sec-weight"></div><section class="panel"><div class="pad" style="gap:8px">
        <div class="bw-top"><div class="bw-latest"><span class="k">Latest weigh-in</span><div><span class="hero-n">${W.latest}</span><span class="u">lb</span></div></div>
          <div class="seg inline quiet" role="tablist" aria-label="Rolling average"><button class="${win === 7 ? 'on' : ''}" data-act="win" data-v="7">7D avg</button><button class="${win === 30 ? 'on' : ''}" data-act="win" data-v="30">30D avg</button></div></div>
        <span class="cap bw-meta"><span class="mono">${W.fmtDate(last.date)}</span> · ${wdelta(W.prev)} vs previous weigh-in</span>
        <div style="position:relative;margin:4px -2px 0">${callout}${c.svg}</div>
        <span class="cap">${W.count} weigh-ins at recorded dates · Line: ${win}-day rolling average · Ring: latest weigh-in</span></div>
        <div class="split"><div><span class="k">7-day avg</span><span><span class="val">${W.avg7.toFixed(1)}</span> ${wdelta(W.avg7d, 'cap')}</span></div><div><span class="k">30-day avg</span><span><span class="val">${W.avg30.toFixed(1)}</span> ${wdelta(W.avg30d, 'cap')}</span></div></div>
        <div class="split"><div><span class="k">Goal · ${G.mode}</span><span><span class="val">${G.target}</span><span class="u">lb</span> <span class="cap">· ${G.toGo} to go</span></span></div><div><span class="k">Target pace</span><span><span class="val">${G.pace}</span><span class="u">lb/wk</span></span></div></div>
        <button class="disc" data-act="go" data-tab="weight">${I('monitor-weight', 20)}<span>Log or manage weight</span>${I('chevron-right', 20, 'chev')}</button></section>`;
  }
  function analytics() {
    const chs = chapters();
    const active = CHAPTER_OF[S.view] || chs[0][0];
    const K = D.oneK;
    const strength = sub('strength', '1K Progress', `<button class="info" data-act="sheet" data-v="info:1k" aria-label="What is 1K Progress?">${I('info-outline', 20)}</button>`) + `<section class="panel">
        <div class="pad" style="gap:10px"><div style="display:flex;align-items:baseline;gap:6px"><span class="hero-n">${K.total}</span><span class="u">/ 1,000 lb</span><span class="cap" style="margin-left:auto">${1000 - K.total} to go</span></div>${oneKBar(12)}</div>
        ${lifts(true)}
        ${disc('1k-chart', 'show-chart', '1K total by session · existing chart', `<div style="padding:4px 16px 16px"><div style="border:1px dashed var(--border);border-radius:var(--r-lg);min-height:120px;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px" class="cap">Production “1K total over sessions” LineChart renders here unchanged — same calculation, deloads marked. Not re-plotted in this prototype.</div></div>`)}
        ${disc('big3', 'tune', 'Big 3 mapping', `<div class="pad" style="padding-top:4px">${['Squat', 'Bench', 'Deadlift'].map((l, i) => `<div style="display:flex;justify-content:space-between;align-items:center;min-height:44px"><span class="k">${l}</span><span class="body">${K.mapping[i]} ${I('expand-more', 18)}</span></div>`).join('')}</div>`)}</section>`;
    const tbv = S.tbview || 'movement';
    const tb = sub('breakdown', 'Training breakdown', `<div class="seg inline quiet"><button>Last 4</button><button class="on">Last 12</button><button>All</button></div>`) + `<section class="panel">${P.breakdown(tbv)}</section>`;
    const RH = D.routineHealth;
    const health = sub('health', 'Routine health') + `<section class="panel"><div class="pad">
        <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="k">Since deload</span><span class="cap warn" style="font-weight:600">${RH.caption}</span></div>
        <div><span class="metric">${RH.sinceDeload}</span><span class="u">sessions</span></div>
        <div class="zones" role="img" aria-label="${RH.sinceDeload} of 10 sessions before deload"><i style="flex:6;background:var(--completion);opacity:.75"></i><i style="flex:3;background:var(--warning);opacity:.8"></i><i style="flex:2;background:var(--error-text);opacity:.8"></i><span class="knob" style="left:calc(${(RH.sinceDeload / 11) * 100}% - 2px)"></span></div>
        <div class="zl"><span style="flex:6">Building</span><span style="flex:3;text-align:center">Approaching</span><span style="flex:2;text-align:right">Deload</span></div></div>
        <div class="split"><div><span class="k">Total sessions</span><span class="val">${RH.total}</span></div><div><span class="k">Deload mode</span><span class="body" style="font-weight:600">On</span></div></div>
        <div class="ph" style="border-top:1px solid var(--border)"><span class="k">Session check-ins · last 10</span></div>
        <div style="padding:0 16px 14px;display:flex;flex-direction:column;gap:10px"><div class="ckin">${D.checkins.recent.map((c) => `<i class="${c === 'flag' ? 'flag' : ''}">${c === 'flag' ? '!' : ''}</i>`).join('')}</div>
        <div class="legend"><span><b>8</b>No issue</span><span><b class="warn">2</b>Flagged</span><span>Most common: <b style="font-family:var(--sg)">${D.checkins.common}</b></span></div></div></section>`;
    const f = S.filter || 'all'; const pr = D.progress;
    const rows = (g) => g.rows.filter((r) => f === 'all' || (f === 'up' ? r.trend === 'up' : f === 'flat' ? r.trend === 'flat' : r.trend === 'down'));
    const po = sub('progress', 'Progressive Overload', `<button class="lnk" style="color:var(--muted)">${I('unfold-less', 18)}Collapse all</button>`) + `<section class="panel">
        <div class="ph"><span class="k">Exercise progress · ${pr.tracked} tracked</span><button class="info" data-act="sheet" data-v="info:trend" aria-label="What Progressing, Steady, and Regressing mean">${I('info-outline', 20)}</button></div>
        <div style="padding:0 16px 12px;display:flex;flex-direction:column;gap:12px"><div class="bar" style="height:8px"><i style="flex:${pr.progressing};background:var(--completion)"></i><i style="flex:${pr.steady};background:var(--warning)"></i></div>
          <div class="chips" role="radiogroup" aria-label="Filter exercises">${[['all', 'All', pr.tracked], ['up', 'Progressing', pr.progressing], ['flat', 'Steady', pr.steady], ['down', 'Regressing', pr.regressing]].map(([k, l, n]) => `<button role="radio" aria-checked="${f === k}" class="${f === k ? 'on' : ''}" data-act="filter" data-v="${k}">${l}<b>${n}</b></button>`).join('')}</div></div>
        <div class="search">${I('search', 20)}Search tracked exercises...</div>
        <div class="sugg" style="margin:0 16px 12px"><div class="h">${I('trending-up', 18)}Incline Dumbbell Press<span class="badge">SUGGESTION</span></div><p>10, 10, 9 at 75 lb in a 3x8-10 range. Try 80 lb once every set reaches 10.</p><div class="acts"><button data-act="go" data-tab="log">Open in Log</button></div></div>
        <div class="po-cols"><span>Exercise</span><span>1RM</span><span>Kilo</span><span>Best</span></div>
        ${D.po.map((g) => { const id = `pog-${g.day}`; const shut = P.isOpen(id); const rs = rows(g); if (!rs.length) return ''; return `<button class="po-g" data-act="open" data-id="${id}" aria-expanded="${!shut}">${g.day} · ${rs.length}${I(shut ? 'expand-more' : 'expand-less', 20, 'chev')}</button>${shut ? '' : rs.map((r) => `<button class="po-r" data-act="sheet" data-v="ex:${key(r.name)}"><span class="top"><b>${r.name}</b>${pill(r.trend)}</span>
          ${r.reps ? `<span class="cp">Bodyweight · reps</span><span class="n"><small>AVG</small> ${r.avg}</span><span class="n"><small>BEST</small> ${r.bestReps}</span><span class="n na">—</span>` : `<span class="cp">${EX[key(r.name)].sessions.length} sessions</span><span class="n">${r.e1rm}</span><span class="n">${r.kilo}</span><span class="n">${r.best}</span>`}</button>`).join('')}`; }).join('') || `<div class="row cap">No exercises match this filter.</div>`}
        <button class="disc" data-act="sheet" data-v="info:cols">${I('info-outline', 20)}<span>What 1RM, Kilo, Best, and Trend mean</span>${I('chevron-right', 20, 'chev')}</button></section>`;
    const rhist = sub('rhistory', 'Recovery history') + `<section class="panel"><button class="entry">${I('history', 20)}<span style="display:flex;flex-direction:column"><span>1 completed block</span><span class="cap">Opens Recovery management</span></span>${I('chevron-right', 20, 'chev')}</button></section>`;
    const R = D.recovery;
    const rec = sub('recovery', `Week ${R.week} · vs baseline`) + `<section class="panel now"><div class="pad">
        <div style="display:flex;align-items:baseline;gap:8px"><span class="hero-n">${R.total}%</span><span class="cap">total recovery</span></div>
        <div class="bar" style="height:10px"><i style="flex:${R.bands.at};background:var(--band-at)"></i><i style="flex:${R.bands.rebuilding};background:var(--band-reb)"></i><i style="flex:${R.bands.early};background:var(--band-early)"></i><i style="flex:${R.bands.notYet};background:var(--muted);opacity:.45"></i></div>
        <div class="legend"><span><b style="color:var(--band-at)">${R.bands.at}</b>At or above</span><span><b style="color:var(--band-reb)">${R.bands.rebuilding}</b>Rebuilding</span><span><b style="color:var(--band-early)">${R.bands.early}</b>Early</span><span><b>${R.bands.notYet}</b>Not trained yet</span></div></div>
        <div class="weeks">${['1', '2'].map((n) => `<button class="${n === String(R.week) ? 'on' : ''}"><b>Week ${n}</b><span>${n === String(R.week) ? 'Current' : 'Complete'}</span></button>`).join('')}</div>
        ${R.lifts.map(([n, v]) => `<div class="row" style="flex-direction:column;align-items:stretch;gap:6px"><div style="display:flex;justify-content:space-between"><span class="body" style="font-weight:600">${n}</span><b class="val" style="font-size:16px">${v}%</b></div><div class="bar" style="height:6px"><i style="flex:${v};background:var(--primary-mark)"></i><i style="flex:${100 - v};background:var(--section)"></i></div></div>`).join('')}
        <button class="disc" data-act="go" data-tab="log" data-sec="recovery">${I('tune', 20)}<span>Manage recovery in Log</span>${I('chevron-right', 20, 'chev')}</button></section>`;
    let body;
    if (S.recovery) {
      const open = P.isOpen('baseline');
      body = chapter('recovery', '01', 'Recovery', `<span class="tag-now">Active</span>`) + rec + rhist
        + bodyweightChapter('02')
        + chapter('baseline', '03', 'Baseline training', `<span class="tag-paused">Paused</span>`)
        + `<section class="panel paused">${disc('baseline', 'pause', open ? 'Hide paused Progress and Training' : 'Progress and Training · paused during Recovery', '').replace('class="disc"', 'class="disc" style="border-top:0"')}</section>`
        + (open ? `<div class="paused-body">${strength}${po}${tb}${health}</div>` : '');
    } else {
      body = chapter('progress', '01', 'Progress') + strength + po
        + chapter('training', '02', 'Training') + tb + health
        + bodyweightChapter('03')
        + chapter('recovery', '04', 'Recovery') + rhist;
    }
    return header('Analytics', `${D.routine.title} · Week ${D.routine.week}`) + `<nav class="secidx ch-idx" aria-label="Analytics chapters">${chs.map(([k, l]) => `<button class="${active === k ? 'on' : ''}" data-act="sec" data-v="${k}" aria-current="${active === k}">${l}</button>`).join('')}</nav>
      <div class="scroll idx" id="sc"><div class="content">${body}</div></div>`;
  }

  // ---------------- MORE ----------------
  function more() {
    if (S.view === 'settings') return settings();
    const row = (ic, b, sub, act = '') => `<button class="mrow" ${act}>${I(ic, 22)}<span class="tx"><b>${b}</b><span>${sub}</span></span>${I('chevron-right', 22, 'chev')}</button>`;
    const court = { hard: 'Hard', clay: 'Clay', grass: 'Grass' }[S.court];
    return header('More') + `<div class="scroll"><div class="content">
      <section class="panel"><button class="mrow" style="border-top:0"><span class="av">Y</span><span class="tx"><b>${D.account.email}</b><span class="dn" style="display:inline-flex;gap:4px;align-items:center">${I('cloud-done', 16)}Signed in · ${D.account.sync}</span></span>${I('chevron-right', 22, 'chev')}</button></section>
      <div class="k grp-k">Preferences</div>
      <section class="panel">${row('tune', 'Settings', `${court} · ${S.mode === 'dark' ? 'Dark' : 'Light'} · lb · reminders`, 'data-act="view" data-v="settings"')}${row('person', 'User profile', 'Sex, date of birth, height')}</section>
      <div class="k grp-k">Account &amp; data</div>
      <section class="panel">${row('account-circle', 'Account', 'Cloud account and sign-in')}${row('backup', 'Data and backup', 'Cloud · export · import')}${row('content-paste', 'Import routine', 'Paste a shared routine')}</section>
      <div class="k grp-k">Tools &amp; help</div>
      <section class="panel">${row('auto-awesome', 'Routine prompt tools', 'Build a prompt for an external LLM')}${row('help-outline', 'App guide', 'Syntax and walkthrough')}${row('info-outline', 'About Kilo', `Version ${D.account.version}`)}</section>
    </div></div>`;
  }
  function settings() {
    const sw = (c) => { const pal = { hard: ['#080D18', '#101728', '#3B82F6', '#EEF3F9', '#FFFFFF', '#0A4ABF'], clay: ['#141211', '#1F1C1A', '#D86538', '#F8F5EE', '#FFFDF9', '#A23E19'], grass: ['#0C130F', '#15201A', '#2CA864', '#F4F8F5', '#FFFFFF', '#1E5B3A'] }[c]; const [bg, card, pr] = S.mode === 'dark' ? pal : pal.slice(3); return `<div class="sw" style="background:${bg};border:1px solid var(--border)"><i style="left:6px;right:6px;top:8px;height:16px;border-radius:4px;background:${card}"></i><i style="left:6px;bottom:8px;width:30px;height:10px;border-radius:2px;background:${pr}"></i></div>`; };
    const tg = (t, d, on) => `<div class="sr"><div class="tx"><b>${t}</b>${d ? `<span class="cap">${d}</span>` : ''}</div><span class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${t}"></span></div>`;
    const time = (t, v) => `<div class="sr"><div class="tx"><b>${t}</b></div><button class="dt tool">${I('schedule', 18)}${v}</button></div>`;
    return `<header class="hdr sub"><button class="ib" data-act="view" data-v="" aria-label="Back to More">${I('chevron-left', 28)}</button><div class="tt"><h1>Settings</h1></div></header>
      <div class="scroll"><div class="content">
      <div class="k grp-k">Features</div>
      <section class="panel">${tg('Fatigue tracking', 'Check-in after each session', true)}${tg('Deload mode', 'Deload generation and Routine health gauge', true)}${tg('Progression suggestions', 'Notes change only when you apply one', true)}</section>
      <div class="k grp-k">Reminders</div>
      <section class="panel">${tg('Daily weigh-in reminder', '', true)}${time('Reminder time', '7:00 AM')}${tg('Workout day nudge', '', false)}</section>
      <div class="k grp-k">Appearance</div>
      <section class="panel"><div class="ph"><span class="body" style="font-weight:600">Theme</span></div>
        <div class="courts">${['hard', 'clay', 'grass'].map((c) => `<button class="court ${S.court === c ? 'on' : ''}" data-act="court" data-v="${c}" role="radio" aria-checked="${S.court === c}">${sw(c)}<b>${c[0].toUpperCase() + c.slice(1)} Court</b></button>`).join('')}</div>
        <div class="sr"><div class="tx"><b>Mode</b></div><div class="seg inline"><button class="${S.mode === 'light' ? 'on' : ''}" data-act="mode" data-v="light">Light</button><button class="${S.mode === 'dark' ? 'on' : ''}" data-act="mode" data-v="dark">Dark</button><button>System</button></div></div></section>
      <div class="k grp-k">Units</div>
      <section class="panel"><div class="sr"><div class="tx"><b>Weight unit</b></div><div class="seg inline"><button class="on">lb</button><button>kg</button></div></div></section>
      <div class="k grp-k">Fatigue multiplier</div>
      <section class="panel"><div class="sr"><div class="tx"><b>Multiplier</b><span class="cap">Scales Kilo estimates</span></div><div class="stepper"><button aria-label="Decrease">${I('remove', 20)}</button><b>1.07</b><button aria-label="Increase">${I('add', 20)}</button></div></div>
        <div class="row" style="min-height:48px"><button class="lnk">Reset to default (1.07)</button></div></section>
    </div></div>`;
  }

  // ---------------- SHEETS (one component) ----------------
  function sheet() {
    if (!S.sheet) return '';
    const [kind, arg] = S.sheet.split(':'); let title = '', sub = '', body = '';
    if (kind === 'actions') {
      title = 'Routine actions'; sub = D.routine.title;
      body = [['edit', 'Edit'], ['skip-next', 'Skip week'], ['undo', 'Remove skip'], ['calculate', 'Plate calculator'], ['content-copy', 'Copy'], ['share', 'Share'], ['image', 'Share as Image']].map(([ic, l]) => `<button class="am" ${ic === 'edit' ? 'data-act="edit"' : ic === 'calculate' ? 'data-act="sheet" data-v="plates:"' : ''}>${I(ic, 22)}${l}</button>`).join('') + '<p class="cap" style="padding:8px 16px 0">Remove skip appears only when the last week is a skip.</p>';
    } else if (kind === 'ractions') {
      title = arg === 'PushPullLegs' ? 'Push Pull Legs' : 'Strength 5×5'; sub = 'Saved routine';
      body = [['visibility', 'View'], ['check-circle', 'Set as current routine'], ['content-copy', 'Copy'], ['share', 'Share'], ['image', 'Share as Image']].map(([ic, l]) => `<button class="am">${I(ic, 22)}${l}</button>`).join('') + `<button class="am dg">${I('delete-outline', 22)}Delete routine</button>`;
    } else if (kind === 'hist' || kind === 'ex') {
      const e = EX[arg]; const ser = loadSeries(e); const bw = e.sessions[0].load == null;
      title = e.name; sub = `${e.day} · ${e.sessions.length} logged sessions`;
      const row = D.po.flatMap((g) => g.rows).find((r) => r.name === e.name);
      body = `${row && kind === 'ex' ? `<div class="split three" style="border-top:0">${row.reps ? `<div><span class="k">Avg</span><span class="val">${row.avg}</span></div><div><span class="k">Best</span><span class="val">${row.bestReps}</span></div><div><span class="k">Trend</span>${pill(row.trend)}</div>` : `<div><span class="k">1RM</span><span class="val">${row.e1rm}</span></div><div><span class="k">Kilo</span><span class="val">${row.kilo}</span></div><div><span class="k">Best</span><span class="val">${row.best}</span></div>`}</div>` : ''}
        <div style="padding:8px 12px 4px 16px;border-top:1px solid var(--border)"><span class="k">${bw ? 'Top-set reps' : 'Top-set load (lb)'} · by session</span>${P.sessionChart(ser, { w: 358, h: 110, label: `${e.name} ${bw ? 'reps' : 'load'} by logged session` })}</div>
        <div class="hs h"><span>#</span><span>${bw ? 'Load' : 'Load'}</span><span>Reps</span></div>
        ${e.sessions.map((s, i) => ({ s, i })).reverse().map(({ s, i }) => `<div class="hs ${i === e.sessions.length - 1 ? 'latest' : i < e.sessions.length - 3 ? 'older' : ''}"><span>${i + 1}</span><span>${s.load == null ? 'BW' : `${s.load} lb`}</span><span>${s.reps.join(', ')}</span></div>`).join('')}
        <div class="btns" style="padding:12px 16px 0">${kind === 'ex' ? `<button class="btn qt" data-act="go" data-tab="log">View in Log</button>` : `<button class="btn pri" data-act="edit">${I('edit', 16)}Edit in note</button>`}</div>`;
    } else if (kind === 'plates') {
      const lift = arg || ''; const v = { Squat: 274, Bench: 228, Deadlift: 380 }[lift] || 225;
      const load = Math.floor(v / 5) * 5; let side = (load - 45) / 2; const plates = []; [45, 35, 25, 10, 5, 2.5].forEach((p) => { while (side >= p) { plates.push(p); side -= p; } });
      title = lift ? `${lift} · ${v} lb` : 'Plate calculator'; sub = `${load} lb on a 45 lb bar`;
      body = `<div class="plates">${plates.slice().reverse().map((p) => `<i style="width:${p >= 25 ? 14 : 10}px;height:${18 + p * 1.6}px"></i>`).join('')}<span class="bar-s"></span>${plates.map((p) => `<i style="width:${p >= 25 ? 14 : 10}px;height:${18 + p * 1.6}px"></i>`).join('')}</div>
        <div class="row" style="justify-content:space-between"><span class="k">Per side</span><span class="val">${plates.join(' + ')}</span></div>${lift ? '' : `<div class="qe" style="border-top:1px solid var(--border)"><div class="in"><b>225</b><span class="u">lb target</span></div></div>`}`;
    } else if (kind === 'info') {
      const t = { '1k': ['What is 1K Progress?', '1K is your estimated Squat + Bench + Deadlift one-rep max total. It totals your most recent complete Big 3 cycle. Deload sessions appear on the graph as their own marked point.'], trend: ['Progressing, Steady, Regressing', 'Each tracked exercise is compared with its own recent sessions. Wording is unchanged from the current app.'], cols: ['What 1RM, Kilo, Best, and Trend mean', '1RM is the estimated one-rep max, Kilo the fatigue-adjusted estimate, Best the heaviest logged top set. Wording is unchanged from the current app.'] }[arg];
      title = t[0]; body = `<p class="body" style="padding:4px 16px 8px">${t[1]}</p>`;
    } else { const b = P.breakdownSheet(S.sheet); title = b.title; sub = b.sub; body = b.body; }
    return `<div class="scrim" data-act="closesheet"></div><div class="sheet" role="dialog" aria-label="${title}"><div class="grab"></div><div class="sh"><div><h3>${title}</h3>${sub ? `<span class="cap">${sub}</span>` : ''}</div><button class="ib" data-act="closesheet" aria-label="Close">${I('close', 24)}</button></div>${body}</div>`;
  }

  const views = { home, log, weight, analytics, more };
  S.win = new URLSearchParams(location.search).get('win') || '';
  let jump = true; // a navigation asked for a scroll position; otherwise re-renders keep it
  P.render = function () {
    const prev = document.getElementById('sc');
    const keep = !jump && prev ? prev.scrollTop : null; jump = false;
    P.applyTheme();
    const app = document.getElementById('app');
    const timerPill = S.timer && !S.editor ? `<div class="pill-timer" role="timer" aria-label="Rest timer 1:12 remaining">${I('timer', 20)}1:12<button data-act="timer">Dismiss</button></div>` : '';
    app.innerHTML = views[S.tab]() + timerPill + tabbar() + sheet();
    document.getElementById('rail').innerHTML = P.rail('Hybrid · revision 3', 'Analytics reorganised into four chapters (Progress, Training, Bodyweight, Recovery). Weight records, manages and shows compact 7/30-day averages; the trend chart and a prominent Latest weigh-in live in Analytics › Bodyweight. Compare with ../hybrid-v2/.', [
      ['Weight · record + manage', { tab: 'weight' }], ['Weight · goal edit', { tab: 'weight', open: ['goal-edit'] }],
      ['Analytics · Progress', { tab: 'analytics', view: 'progress' }], ['Analytics · Training', { tab: 'analytics', view: 'training' }], ['Analytics · Bodyweight', { tab: 'analytics', view: 'bodyweight' }], ['Analytics · Bodyweight point', { tab: 'analytics', view: 'bodyweight', point: '30' }], ['Analytics · Recovery', { tab: 'analytics', view: 'recovery' }],
      ['Analytics · active Recovery', { tab: 'analytics', recovery: true }], ['Analytics · Recovery, baseline open', { tab: 'analytics', recovery: true, open: ['baseline'], view: 'baseline' }],
      ['Home', { tab: 'home' }], ['Home · Recovery active', { tab: 'home', recovery: true }], ['Log', { tab: 'log' }], ['More · Settings', { tab: 'more', view: 'settings' }]]);
    P.bindRail();
    const sc = document.getElementById('sc');
    if (sc && !S.full) {
      if (keep != null) sc.scrollTop = keep;
      else {
        if (S.tab === 'analytics' && S.view) { const el = document.getElementById(`sec-${S.view}`) || document.getElementById(`ch-${CHAPTER_OF[S.view]}`); if (el) sc.scrollTop = el.offsetTop - 8; }
        if (S.tab === 'log' && !S.editor && S.day !== 'mon') { const el = document.getElementById(`day-${S.day}`); if (el) sc.scrollTop = el.offsetTop - 60; }
        if (S.scroll) sc.scrollTop = Number(S.scroll);
      }
      if (S.tab === 'analytics') spy(sc);
    }
  };
  // Chapter index follows the scroll; the active item is kept visible in the index.
  function markIndex(id) {
    document.querySelectorAll('.ch-idx button').forEach((b) => { const on = b.dataset.v === id; b.classList.toggle('on', on); b.setAttribute('aria-current', on); if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  }
  function spy(sc) {
    const marks = [...sc.querySelectorAll('.ch')];
    sc.onscroll = () => {
      if (sc.dataset.lock) return;
      let cur = marks[0] && marks[0].dataset.ch;
      marks.forEach((m) => { if (m.offsetTop - sc.scrollTop <= 24) cur = m.dataset.ch; });
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) cur = marks[marks.length - 1].dataset.ch;
      markIndex(cur);
    };
  }
  P.bindActions(document.getElementById('app'), {
    tab: (el) => { jump = true; P.set({ tab: el.dataset.v, view: '', sheet: '', open: [], editor: false, point: '', scroll: '' }); },
    go: (el) => { jump = true; P.set({ tab: el.dataset.tab, view: el.dataset.sec || '', sheet: '', open: [], point: '', scroll: '', editor: false }); },
    open: (el) => P.toggleOpen(el.dataset.id),
    day: (el) => P.set({ day: el.dataset.v }, false),
    sec: (el) => {
      const v = el.dataset.v; S.view = v; history.replaceState(null, '', location.search.replace(/([?&])view=[^&]*/, '$1').replace(/[?&]$/, '') + (location.search ? '&' : '?') + `view=${v}`);
      const sc = document.getElementById('sc'); const t = document.getElementById(`ch-${v}`); if (!sc || !t) return;
      markIndex(v); sc.dataset.lock = '1'; sc.scrollTo({ top: t.offsetTop - 8, behavior: 'smooth' }); setTimeout(() => { delete sc.dataset.lock; }, 600);
    },
    view: (el) => { jump = true; P.set({ view: el.dataset.v }); },
    lview: (el) => P.set({ view: el.dataset.v === 'recovery-start' ? '' : el.dataset.v, recovery: el.dataset.v === 'recovery-start' ? true : S.recovery }, false),
    win: (el) => { S.win = el.dataset.v; P.set({ point: '' }, false); },
    court: (el) => P.set({ court: el.dataset.v }, false),
    mode: (el) => P.set({ mode: el.dataset.v }, false),
    tbview: (el) => { S.tbview = el.dataset.v; P.render(); },
    tbtile: (el) => P.set({ sheet: el.dataset.id === 'all' ? 'Squat' : el.dataset.id }),
    filter: (el) => { S.filter = el.dataset.v; P.render(); },
    sheet: (el) => P.set({ sheet: el.dataset.v }),
    closesheet: () => P.set({ sheet: '' }),
    point: (el) => P.set({ point: el.dataset.i }, false),
    timer: () => P.set({ timer: !S.timer }, false),
    done: () => P.set({ editor: false, timer: false }),
    edit: () => P.set({ editor: true, sheet: '' }),
  });
  P.render();
})();
