// Training breakdown — the approved #1588/#1593/#1597 dashboard, rendered with the same
// structure in both concepts (it is the quality benchmark and is preserved).
(function () {
  const heat = (v, max) => {
    const t = 0.18 + 0.82 * (v / max);
    const pct = Math.round(t * 100);
    return { bg: `color-mix(in srgb, var(--primary) ${pct}%, var(--card))`, fg: t > 0.55 ? 'var(--on-primary)' : 'var(--on)' };
  };
  P.breakdown = function (view = 'movement') {
    const B = window.KILO_DATA.breakdown;
    let body = '';
    if (view === 'movement') {
      const max = B.groups[0][1];
      body = `<div class="cmp">${B.compared.map((c) => {
        const t = c.av + c.bv; const a = Math.round((c.av / t) * 100);
        return `<div class="lr"><span>${c.a} <b>${c.av}</b></span><span><b>${c.bv}</b> ${c.b}</span></div>
          <div class="pb"><i style="flex:${c.av};background:var(--primary-mark)"></i><i style="flex:${c.bv};background:var(--muted);opacity:.7"></i></div>
          <div class="pc2"><span>${a}%</span><span>${100 - a}%</span></div>`;
      }).join('<div style="height:8px"></div>')}</div>
      <div class="ph" style="border-top:1px solid var(--border)"><span class="k">Movement groups</span><span class="cap">each set counted once</span></div>
      <div class="tiles">${B.groups.map(([n, v, p], i) => { const h = heat(v, max); return `<button class="tile ${i < 2 ? 'w3' : 'w2'}" data-act="tbtile" data-id="${n}" style="background:${h.bg};color:${h.fg}"><b>${n}</b><span class="tv">${v}<small>${p}%</small></span></button>`; }).join('')}</div>
      <button class="tb-more" data-act="tbtile" data-id="all">+${B.moreGroups} more groups incl. unclassified <b>View all ›</b></button>
      <div class="cap" style="padding:0 16px 14px">${B.classified}% classified</div>`;
    } else if (view === 'muscles') {
      const max = Math.max(...B.regions.map((r) => r[1]));
      body = `<div class="ph"><span class="k">Body regions</span><span class="cap">primary sets per region</span></div>
      <div class="tiles">${B.regions.map(([n, v, most]) => { const h = heat(v, max); return `<button class="tile w3" data-act="tbtile" data-id="${n}" style="background:${h.bg};color:${h.fg}"><span style="display:flex;justify-content:space-between;align-items:baseline"><b>${n}</b><span class="tv">${v}</span></span><span style="font:400 13px/18px var(--sg);opacity:.85">Most: ${most}</span></button>`; }).join('')}</div>`;
    } else {
      const max = B.equipment[0][1];
      body = `<div class="ph"><span class="k">Equipment</span><span class="cap">completed sets</span></div>
      <div style="padding:0 16px 14px;display:flex;flex-direction:column;gap:10px">${B.equipment.map(([n, v]) => `<div><div style="display:flex;justify-content:space-between;font:400 14px/20px var(--sg)"><span>${n}</span><b class="num">${v}</b></div><div style="height:6px;border-radius:2px;background:var(--section);margin-top:4px"><div style="height:100%;width:${(v / max) * 100}%;background:var(--primary-mark);border-radius:2px"></div></div></div>`).join('')}</div>`;
    }
    return `<div class="tb-top">
        <div class="tb-hero"><div class="t-md">${B.sets}</div><div class="cap">completed sets</div></div>
        <div class="tb-chips"><div class="tb-chip"><b>${B.exercises}</b><span>exercises</span></div><div class="tb-chip"><b>${B.timed}</b><span>timed/cardio</span></div></div>
      </div>
      <div class="tb-tabs">${['movement', 'muscles', 'equipment'].map((v) => `<button class="${v === view ? 'on' : ''}" data-act="tbview" data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}<button class="info ibtn" aria-label="About Training breakdown">${P.icon('info-outline', 20)}</button></div>
      ${body}`;
  };
  P.breakdownSheet = function (id) {
    const rows = id === 'Squat' ? [['Back Squat', 36], ['Leg Press', 28]] : id === 'Hip hinge' ? [['Romanian Deadlift', 24], ['Deadlift', 27], ['Walking Lunge', 6]] : [['Bench Press', 30], ['Incline Dumbbell Press', 6]];
    const max = Math.max(...rows.map((r) => r[1]));
    const total = rows.reduce((s, r) => s + r[1], 0);
    return { title: `${id}`, sub: `${total} sets · Last 12 sessions per exercise`, body: rows.map(([n, v]) => `<div style="padding:10px 16px;border-top:1px solid var(--border)"><div style="display:flex;justify-content:space-between;font:500 15px/20px var(--sg)"><span>${n}</span><b class="num">${v}</b></div><div style="height:6px;border-radius:2px;background:var(--section);margin-top:6px"><div style="height:100%;width:${(v / max) * 100}%;background:var(--primary-mark);border-radius:2px"></div></div></div>`).join('') };
  };
})();
