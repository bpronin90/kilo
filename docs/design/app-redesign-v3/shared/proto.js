// Shared prototype runtime: URL state, theme application, control rail, icons, SVG charts.
(function () {
  const q = new URLSearchParams(location.search);
  const S = {
    court: q.get('court') || 'hard',
    mode: q.get('mode') || 'dark',
    tab: q.get('tab') || 'home',
    recovery: q.get('recovery') === '1',
    view: q.get('view') || '',      // sub-view inside a tab (e.g. settings, detail)
    sheet: q.get('sheet') || '',    // open bottom sheet id
    open: (q.get('open') || '').split(',').filter(Boolean), // expanded row ids
    editor: q.get('editor') === '1',
    timer: q.get('timer') === '1',
    day: q.get('day') || 'mon',
    full: q.get('full') === '1',
    scroll: q.get('scroll') || '',
    point: q.get('point') || '',
  };
  window.P = {
    S,
    set(patch, push = true) {
      Object.assign(S, patch);
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(S)) {
        if (v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
        p.set(k, Array.isArray(v) ? v.join(',') : v === true ? '1' : v);
      }
      history[push ? 'pushState' : 'replaceState'](null, '', `?${p}`);
      P.render();
    },
    toggleOpen(id) { const o = new Set(S.open); o.has(id) ? o.delete(id) : o.add(id); P.set({ open: [...o] }, false); },
    isOpen(id) { return S.open.includes(id); },
    icon(name, size = 20, cls = '') {
      const cp = window.KILO_ICONS[name];
      return `<span class="mi ${cls}" aria-hidden="true" style="font-size:${size}px;width:${size}px;height:${size}px">${cp ? String.fromCodePoint(cp) : '?'}</span>`;
    },
    applyTheme() {
      document.documentElement.dataset.court = S.court;
      document.documentElement.dataset.mode = S.mode;
      document.body.classList.toggle('full', S.full);
    },
    rail(conceptName, blurb, states) {
      const opt = (key, vals) => `<div class="opts">${vals.map(([v, l]) => `<button class="${String(S[key]) === String(v) ? 'on' : ''}" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
      return `<aside class="rail">
        <h1>${conceptName}</h1><p>${blurb}</p>
        <div><h2>Court</h2>${opt('court', [['hard', 'Hard'], ['clay', 'Clay'], ['grass', 'Grass']])}</div>
        <div><h2>Mode</h2>${opt('mode', [['light', 'Light'], ['dark', 'Dark']])}</div>
        <div><h2>Tab</h2>${opt('tab', [['home', 'Home'], ['log', 'Log'], ['weight', 'Weight'], ['analytics', 'Analytics'], ['more', 'More']])}</div>
        <div><h2>States</h2><div class="opts">${states.map(([label, patch]) => `<button data-patch='${JSON.stringify(patch)}'>${label}</button>`).join('')}</div></div>
        <p><a href="../index.html">← Comparison</a> · <a href="#" data-reset>Reset state</a></p>
      </aside>`;
    },
    bindRail() {
      document.querySelectorAll('.rail [data-k]').forEach((b) => b.onclick = () => {
        const k = b.dataset.k; const v = b.dataset.v;
        P.set(k === 'tab' ? { tab: v, view: '', sheet: '', open: [], editor: false, timer: false, point: '' } : { [k]: v });
      });
      document.querySelectorAll('.rail [data-patch]').forEach((b) => b.onclick = () => P.set({ view: '', sheet: '', open: [], editor: false, timer: false, point: '', recovery: false, ...JSON.parse(b.dataset.patch) }));
      const r = document.querySelector('.rail [data-reset]'); if (r) r.onclick = (e) => { e.preventDefault(); P.set({ view: '', sheet: '', open: [], editor: false, timer: false, recovery: false, point: '' }); };
    },
    // Delegated actions: elements with data-act="name" call handlers[name](el, ev).
    bindActions(root, handlers) {
      root.onclick = (ev) => { const el = ev.target.closest('[data-act]'); if (!el || !root.contains(el)) return; const h = handlers[el.dataset.act]; if (h) { ev.preventDefault(); h(el, ev); } };
      root.ondblclick = (ev) => { const el = ev.target.closest('[data-dbl]'); if (el && handlers[el.dataset.dbl]) handlers[el.dataset.dbl](el, ev); };
    },
    fmt(n, d = 0) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); },
    signed(n, d = 1) { return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(d)}`; },
    // ---- SVG helpers (strings) ----
    spark(vals, w = 64, h = 20, color = 'var(--s1)', opts = {}) {
      if (!vals.length) return '';
      const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1, pad = 2;
      const pts = vals.map((v, i) => [pad + (i * (w - pad * 2)) / Math.max(1, vals.length - 1), h - pad - ((v - min) / span) * (h - pad * 2)]);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
      const last = pts[pts.length - 1];
      const area = opts.area ? `<path d="${d}L${last[0]},${h}L${pts[0][0]},${h}Z" fill="${color}" opacity=".14"/>` : '';
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="${opts.sw || 1.75}" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0]}" cy="${last[1]}" r="${opts.r || 2.5}" fill="${color}"/></svg>`;
    },
    // Weight chart: raw points, 7-day rolling line, goal line, optional selected point.
    weightChart({ w = 358, h = 160, days = 30, goal = null, point = null, area = false, axis = true }) {
      const W = window.KILO_DATA.weight;
      const pts = W.entries.filter((e) => e.ago <= days);
      const roll = pts.map((p) => { const win = W.entries.filter((e) => e.ago >= p.ago && e.ago < p.ago + 7); return win.reduce((s, e) => s + e.value, 0) / win.length; });
      const vals = pts.map((p) => p.value).concat(roll).concat(goal ? [goal] : []);
      const min = Math.floor(Math.min(...vals) - 0.5), max = Math.ceil(Math.max(...vals) + 0.5);
      const L = axis ? 4 : 2, R = axis ? 40 : 2, T = 8, B = axis ? 22 : 4;
      const x = (ago) => L + ((days - ago) / days) * (w - L - R);
      const y = (v) => T + (1 - (v - min) / (max - min)) * (h - T - B);
      let s = `<svg width="100%" viewBox="0 0 ${w} ${h}" class="wchart" role="img" aria-label="Body weight, last ${days} days, 7-day rolling average">`;
      if (axis) {
        const ticks = [min, (min + max) / 2, max];
        ticks.forEach((t) => { s += `<line x1="${L}" x2="${w - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)" stroke-width="1"/><text x="${w - R + 6}" y="${y(t) + 4}" class="ax">${t.toFixed(0)}</text>`; });
        const first = pts[0].date, last = pts[pts.length - 1].date;
        const md = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        s += `<text x="${L}" y="${h - 4}" class="ax">${md(first)}</text><text x="${w - R}" y="${h - 4}" class="ax" text-anchor="end">${md(last)}</text>`;
      }
      if (goal) s += `<line x1="${L}" x2="${w - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="var(--completion)" stroke-width="1.25" stroke-dasharray="4 4"/>${axis ? `<text x="${L + 2}" y="${y(goal) - 5}" class="ax" fill="var(--completion)" style="fill:var(--completion)">GOAL ${goal}</text>` : ''}`;
      pts.forEach((p) => { s += `<circle cx="${x(p.ago)}" cy="${y(p.value)}" r="2" fill="var(--muted)" opacity=".55"/>`; });
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.ago).toFixed(1)},${y(roll[i]).toFixed(1)}`).join('');
      if (area) s += `<path d="${d}L${x(0)},${h - B}L${x(pts[0].ago)},${h - B}Z" fill="var(--s1)" opacity=".12"/>`;
      s += `<path d="${d}" fill="none" stroke="var(--s1)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>`;
      const lp = pts[pts.length - 1];
      s += `<circle cx="${x(lp.ago)}" cy="${y(roll[roll.length - 1])}" r="4" fill="var(--s1)" stroke="var(--card)" stroke-width="2"/>`;
      if (point != null) {
        const i = Math.min(pts.length - 1, Math.max(0, Number(point)));
        const p = pts[i];
        s += `<line x1="${x(p.ago)}" x2="${x(p.ago)}" y1="${T}" y2="${h - B}" stroke="var(--on)" stroke-width="1" opacity=".35"/><circle cx="${x(p.ago)}" cy="${y(p.value)}" r="4.5" fill="var(--on)" stroke="var(--card)" stroke-width="2"/>`;
      }
      s += `<g class="hit">${pts.map((p, i) => `<rect data-act="point" data-i="${i}" x="${x(p.ago) - 4}" y="0" width="8" height="${h}" fill="transparent"/>`).join('')}</g>`;
      return s + '</svg>';
    },
    weightPoint(i, days = 30) {
      const W = window.KILO_DATA.weight; const pts = W.entries.filter((e) => e.ago <= days); const p = pts[Math.min(pts.length - 1, Number(i))];
      const win = W.entries.filter((e) => e.ago >= p.ago && e.ago < p.ago + 7);
      return { ...p, roll: win.reduce((s, e) => s + e.value, 0) / win.length, dateStr: W.fmtDate(p.date) };
    },
    // Line over sessions (x = session index; no dates).
    sessionChart(vals, { w = 358, h = 120, color = 'var(--s1)', target = null, label = '' } = {}) {
      const all = vals.concat(target ? [target] : []);
      const min = Math.min(...all) - 10, max = Math.max(...all) + 10;
      const L = 4, R = 40, T = 10, B = 22;
      const x = (i) => L + (i / (vals.length - 1)) * (w - L - R);
      const y = (v) => T + (1 - (v - min) / (max - min)) * (h - T - B);
      let s = `<svg width="100%" viewBox="0 0 ${w} ${h}" class="wchart" role="img" aria-label="${label}">`;
      [min + 10, max - 10].forEach((t) => { s += `<line x1="${L}" x2="${w - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--border)"/><text x="${w - R + 6}" y="${y(t) + 4}" class="ax">${Math.round(t)}</text>`; });
      if (target) s += `<line x1="${L}" x2="${w - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--completion)" stroke-dasharray="4 4" stroke-width="1.25"/><text x="${L + 2}" y="${y(target) + 13}" class="ax" style="fill:var(--completion)">${target}</text>`;
      const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
      s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.25" stroke-linejoin="round"/>`;
      vals.forEach((v, i) => { s += `<circle cx="${x(i)}" cy="${y(v)}" r="${i === vals.length - 1 ? 4 : 2.25}" fill="${color}" ${i === vals.length - 1 ? 'stroke="var(--card)" stroke-width="2"' : ''}/>`; });
      s += `<text x="${L}" y="${h - 4}" class="ax">SESSION 1</text><text x="${w - R}" y="${h - 4}" class="ax" text-anchor="end">LATEST</text>`;
      return s + '</svg>';
    },
    // KiloWordmark (components/KiloWordmark.js), same paths; #FF5C00 is the one fixed brand color.
    wordmark(h = 24) {
      const c = 'var(--on)';
      return `<svg height="${h}" viewBox="0 0 303 106" aria-label="Kilo"><rect x="8" y="9" width="7" height="88" rx="3.5" fill="${c}"/><path d="M 21 52 L 43 52 L 78 12 M 43 52 L 78 92" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><rect x="102" y="30" width="7" height="66" rx="3.5" fill="${c}"/><rect x="102" y="10" width="7" height="15" rx="3.5" fill="#FF5C00"/><path d="M 136.5 12.5 V 80.5 A 12 12 0 0 0 148.5 92.5 H 178.5" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/><rect x="187" y="89.5" width="16" height="7" rx="3.5" fill="#FF5C00"/><path d="M 251.5 11.5 C 282.7 11.5 290.5 19.7 290.5 52.5 C 290.5 85.3 282.7 93.5 251.5 93.5 C 220.3 93.5 212.5 85.3 212.5 52.5 C 212.5 19.7 220.3 11.5 251.5 11.5 Z" fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/></svg>`;
    },
    setLine(s) {
      const reps = s.reps.join(', ');
      return s.load == null ? `<span class="rp">${reps}</span>` : `<span class="ld">${s.load} lb</span> <span class="rp">${reps}</span>`;
    },
    rawNote() {
      const R = window.KILO_DATA.routine; const out = [];
      R.days.forEach((d) => { out.push(`${d.day} — ${d.name}`); d.blocks.forEach((b) => { out.push(`+${b.name}`); b.exercises.forEach((e) => { out.push(`-${e.name}${e.range ? ': ' + e.range : ''}`); e.sessions.forEach((s) => out.push(`${s.load == null ? '' : s.load + ' '}${s.reps.join(',')}`)); }); }); });
      return out.join('\n');
    },
  };
  window.addEventListener('popstate', () => location.reload());
})();
