/* ================= GYM TRACKER (Signal Path 3.2) =================
   Lives inside the Health page (click "Gym" next to the title).
   Data: Gym.json via api.loadData / api.saveData. Weights are stored as entered. */
const GMUSCLES = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Other'];
const GSEED = [
  ['Bench Press (Barbell)', 'Chest'], ['Incline Bench Press (Barbell)', 'Chest'], ['Bench Press (Dumbbell)', 'Chest'], ['Incline Bench Press (Dumbbell)', 'Chest'],
  ['Chest Press (Machine)', 'Chest'], ['Chest Fly (Machine)', 'Chest'], ['Cable Fly Crossover', 'Chest'], ['Push Up', 'Chest'], ['Chest Dip', 'Chest'],
  ['Deadlift (Barbell)', 'Back'], ['Bent Over Row (Barbell)', 'Back'], ['Lat Pulldown (Cable)', 'Back'], ['Seated Cable Row', 'Back'], ['Pull Up', 'Back'],
  ['Chin Up', 'Back'], ['T Bar Row', 'Back'], ['Single Arm Row (Dumbbell)', 'Back'], ['Iso-Lateral Row (Machine)', 'Back'], ['Back Extension', 'Back'],
  ['Overhead Press (Barbell)', 'Shoulders'], ['Shoulder Press (Dumbbell)', 'Shoulders'], ['Shoulder Press (Machine)', 'Shoulders'], ['Lateral Raise (Dumbbell)', 'Shoulders'],
  ['Lateral Raise (Cable)', 'Shoulders'], ['Rear Delt Reverse Fly (Machine)', 'Shoulders'], ['Face Pull', 'Shoulders'], ['Shrug (Dumbbell)', 'Shoulders'],
  ['Bicep Curl (Dumbbell)', 'Biceps'], ['Bicep Curl (Barbell)', 'Biceps'], ['Hammer Curl (Dumbbell)', 'Biceps'], ['Preacher Curl (Machine)', 'Biceps'], ['Cable Curl', 'Biceps'],
  ['Triceps Pushdown (Cable)', 'Triceps'], ['Triceps Extension (Dumbbell)', 'Triceps'], ['Skullcrusher (Barbell)', 'Triceps'], ['Triceps Dip', 'Triceps'], ['Overhead Triceps Extension (Cable)', 'Triceps'],
  ['Squat (Barbell)', 'Quads'], ['Hack Squat (Machine)', 'Quads'], ['Leg Press (Machine)', 'Quads'], ['Leg Extension (Machine)', 'Quads'],
  ['Bulgarian Split Squat', 'Quads'], ['Lunge (Dumbbell)', 'Quads'], ['Goblet Squat', 'Quads'],
  ['Romanian Deadlift (Barbell)', 'Hamstrings'], ['Lying Leg Curl (Machine)', 'Hamstrings'], ['Seated Leg Curl (Machine)', 'Hamstrings'], ['Stiff Leg Deadlift', 'Hamstrings'],
  ['Hip Thrust (Barbell)', 'Glutes'], ['Glute Kickback (Machine)', 'Glutes'], ['Hip Abduction (Machine)', 'Glutes'],
  ['Standing Calf Raise (Machine)', 'Calves'], ['Seated Calf Raise (Machine)', 'Calves'],
  ['Crunch', 'Core'], ['Hanging Leg Raise', 'Core'], ['Plank', 'Core'], ['Cable Crunch', 'Core'], ['Ab Wheel', 'Core'],
];
const GY = { loaded: false, d: null, tab: 'log', ed: null, selEx: null, range: '6m', q: '', saveT: null, an: null, gid: 0 };

/* ---------- small helpers ---------- */
const ge = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const gn = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
const gfmt = (n) => (Math.round(n * 10) / 10).toLocaleString('en');
const gk = (n) => (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : gfmt(n));
const gToday = () => { const t = new Date(); return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`; };
const gDateLbl = (s, long) => new Date(dn(s) * 864e5).toLocaleDateString('en', long ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' } : { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const gOrm = (kg, r) => (r <= 0 ? 0 : r === 1 ? kg : kg * (1 + r / 30));
const gEx = (id) => GY.d.ex.find((x) => x.id === id);
const gExName = (id) => (gEx(id) ? gEx(id).name : 'Deleted exercise');
const gU = () => GY.d.unit || 'kg';
const gClone = (o) => JSON.parse(JSON.stringify(o));
const gMon = (n) => { const dow = (new Date(n * 864e5).getUTCDay() + 6) % 7; return n - dow; };

async function gLoad() {
  if (GY.loaded) return;
  let d = null;
  try { const t = await api.loadData('Gym.json'); if (t) d = JSON.parse(t); } catch (e) { d = null; }
  if (!d || !Array.isArray(d.wk)) {
    d = { v: 1, unit: 'kg', ex: GSEED.map(([name, muscle]) => ({ id: uid(), name, muscle })), wk: [], rt: [] };
    GY.d = d; gSaveSoon(true);
  }
  d.rt = d.rt || []; d.ex = d.ex || []; d.unit = d.unit || 'kg';
  GY.d = d; GY.loaded = true;
}
function gSaveSoon(now) {
  if (typeof uNote === 'function') uNote('gym');
  clearTimeout(GY.saveT);
  const run = () => { GY.saveT = null; try { api.saveData('Gym.json', JSON.stringify(GY.d)); } catch (e) { /* ignore */ } };
  if (now) run(); else GY.saveT = setTimeout(run, 250);
}
window.addEventListener('beforeunload', () => { if (GY.saveT) { clearTimeout(GY.saveT); try { api.saveData('Gym.json', JSON.stringify(GY.d)); } catch (e) { /* ignore */ } } });
function gToast(msg) {
  const t = document.createElement('div'); t.className = 'gy-toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2200); setTimeout(() => t.remove(), 2700);
}

/* ---------- analysis: volume, PRs, "beat last time" ---------- */
const gSorted = () => GY.d.wk.slice().sort((a, b) => (a.date === b.date ? (a.ts || 0) - (b.ts || 0) : a.date < b.date ? -1 : 1));
function gAn() {
  if (GY.an) return GY.an;
  const best = {}, hist = {}, res = new Map(), byName = {};
  gSorted().forEach((w) => {
    const r = { vol: 0, sets: 0, prs: [], up: 0, cmp: 0, prevWk: null, prevVol: 0, volDelta: 0, ex: w.items.length }, exVol = {};
    w.items.forEach((it) => {
      const valid = it.sets.filter((s) => s.reps > 0), work = valid.filter((s) => s.t !== 'W');
      let top = 0, orm = 0, sv = 0, vol = 0, tr = 0;
      work.forEach((s) => { const k = s.kg || 0; top = Math.max(top, k); orm = Math.max(orm, gOrm(k, s.reps)); sv = Math.max(sv, k * s.reps); vol += k * s.reps; tr = Math.max(tr, s.reps); });
      r.vol += vol; r.sets += work.length; exVol[it.ex] = (exVol[it.ex] || 0) + vol;
      const b = best[it.ex] || (best[it.ex] = { w: 0, o: 0, s: 0, r: 0, n: 0 }), h = hist[it.ex] || (hist[it.ex] = []);
      const prev = h[h.length - 1], pr = new Set();
      if (work.length) {
        if (b.n > 0) {
          if (top > b.w) { pr.add('weight'); r.prs.push({ ex: it.ex, k: 'weight', val: top, was: b.w }); }
          if (orm > b.o + 0.05 && top > 0) { pr.add('orm'); r.prs.push({ ex: it.ex, k: 'orm', val: orm, was: b.o }); }
          if (sv > b.s && top > 0) { pr.add('set'); r.prs.push({ ex: it.ex, k: 'set', val: sv, was: b.s }); }
          if (top === 0 && b.w === 0 && tr > b.r) { pr.add('reps'); r.prs.push({ ex: it.ex, k: 'reps', val: tr, was: b.r }); }
        }
        b.w = Math.max(b.w, top); b.o = Math.max(b.o, orm); b.s = Math.max(b.s, sv); b.r = Math.max(b.r, tr); b.n++;
        let up = 0, cmp = 0;
        if (prev) { work.forEach((s, i) => { const p = prev.work[i]; if (!p) return; cmp++; if ((s.kg || 0) > p.kg || ((s.kg || 0) === p.kg && s.reps > p.reps)) up++; }); }
        r.up += up; r.cmp += cmp;
        h.push({ date: w.date, n: dn(w.date), wk: w.id, top, orm, sv, vol, tr, sets: work.length, work: work.map((s) => ({ kg: s.kg || 0, reps: s.reps })), pr });
      }
    });
    const key = (w.name || '').trim().toLowerCase();
    const pw = key && byName[key];
    if (pw) { // compare only the exercises both sessions have, so a short workout isn't judged against a full one
      const common = Object.keys(exVol).filter((id) => pw.ex[id] != null);
      if (common.length) { r.prevWk = pw; r.prevVol = common.reduce((a, id) => a + pw.ex[id], 0); r.volDelta = common.reduce((a, id) => a + exVol[id], 0) - r.prevVol; r.partial = common.length < Object.keys(exVol).length; }
    }
    if (key) byName[key] = { id: w.id, vol: r.vol, name: w.name, ex: exVol };
    res.set(w.id, r);
  });
  GY.an = { res, hist, best };
  return GY.an;
}
function gPrev(exId, date, excludeId) {
  let pick = null;
  GY.d.wk.forEach((w) => {
    if (w.id === excludeId || w.date > date) return;
    const it = w.items.find((i) => i.ex === exId); if (!it) return;
    if (!pick || w.date > pick.w.date || (w.date === pick.w.date && (w.ts || 0) > (pick.w.ts || 0))) pick = { w, it };
  });
  return pick ? { date: pick.w.date, sets: pick.it.sets } : null;
}
function gDelta(s, p) {
  if (!p || !(s.reps > 0)) return 0;
  const k = s.kg || 0, pk = p.kg || 0;
  if (k > pk || (k === pk && s.reps > p.reps)) return 1;
  if (k < pk || (k === pk && s.reps < p.reps)) return -1;
  return 0;
}
const gNewItem = (exId, date, excludeId) => {
  const p = gPrev(exId, date, excludeId);
  return { ex: exId, note: '', sets: p ? p.sets.map((s) => ({ t: s.t, kg: s.kg, reps: s.reps })) : [{ t: 'N', kg: null, reps: null }, { t: 'N', kg: null, reps: null }, { t: 'N', kg: null, reps: null }] };
};

/* ---------- modals ---------- */
function gModal(html, cls) {
  const m = document.createElement('div'); m.className = 'gy-modal'; m.innerHTML = `<div class="gy-box ${cls || ''}">${html}</div>`;
  const close = () => { m.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  m.addEventListener('mousedown', (e) => { if (e.target === m) close(); });
  document.addEventListener('keydown', onKey); document.body.appendChild(m);
  m.close = close; return m;
}
function uiConfirm({ title, msg, ok, danger, cb, alt }) {
  const m = gModal(`<h3>${ge(title)}</h3><p class="gy-cmsg">${ge(msg || '')}</p><div class="gy-mact"><button data-x="no">Cancel</button>${alt ? `<button data-x="alt">${ge(alt.label)}</button>` : ''}<button class="gy-primary${danger ? ' gy-danger' : ''}" data-x="ok">${ge(ok || 'OK')}</button></div>`, 'gy-confirm');
  m.querySelector('[data-x=no]').onclick = m.close;
  m.querySelector('[data-x=ok]').onclick = () => { m.close(); cb(); };
  if (alt) m.querySelector('[data-x=alt]').onclick = () => { m.close(); alt.cb(); };
  m.querySelector('[data-x=no]').focus();
}
function uiSure({ title, msg, ok, cb }) {
  uiConfirm({ title, msg, ok, cb: () => uiConfirm({ title: 'Are you REALLY sure?', msg: 'This can\u2019t be undone.', ok: 'Yes, do it', danger: true, cb }) });
}
function gAsk({ title, fields, ok, cb }) {
  const m = gModal(`<h3>${ge(title)}</h3>${fields.map((f) => `<label class="gy-fld"><span>${ge(f.label)}</span>${f.opts ? `<select data-k="${f.k}">${f.opts.map((o) => `<option${o === f.val ? ' selected' : ''}>${ge(o)}</option>`).join('')}</select>` : `<input class="f-in" data-k="${f.k}" value="${ge(f.val || '')}" placeholder="${ge(f.ph || '')}">`}</label>`).join('')}<div class="gy-mact"><button data-x="no">Cancel</button><button class="gy-primary" data-x="ok">${ge(ok || 'Save')}</button></div>`);
  const go = () => { const v = {}; m.querySelectorAll('[data-k]').forEach((i) => { v[i.dataset.k] = i.value.trim(); }); if (cb(v) !== false) m.close(); };
  m.querySelector('[data-x=no]').onclick = m.close; m.querySelector('[data-x=ok]').onclick = go;
  m.querySelectorAll('input').forEach((i) => { i.onkeydown = (e) => { if (e.key === 'Enter') go(); }; });
  const f = m.querySelector('input'); if (f) { f.focus(); f.select(); }
}
function gPick(cb, title) {
  const an = gAn(), last = {};
  Object.keys(an.hist).forEach((id) => { const h = an.hist[id]; last[id] = h[h.length - 1]; });
  const m = gModal(`<h3>${ge(title || 'Choose exercise')}</h3><input class="f-in gy-pq" placeholder="Search or type a new exercise name…"><div class="gy-plist"></div>`, 'gy-pick');
  const q = m.querySelector('.gy-pq'), list = m.querySelector('.gy-plist');
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    let rows = GY.d.ex.filter((x) => !t || x.name.toLowerCase().includes(t) || (x.muscle || '').toLowerCase().includes(t));
    rows.sort((a, b) => ((last[b.id] ? last[b.id].date : '') > (last[a.id] ? last[a.id].date : '') ? 1 : (last[b.id] ? last[b.id].date : '') < (last[a.id] ? last[a.id].date : '') ? -1 : a.name.localeCompare(b.name)));
    rows = rows.slice(0, 60);
    const exact = GY.d.ex.some((x) => x.name.toLowerCase() === t);
    const mk = t && !exact ? `<div class="gy-prow gy-pnew" data-new="1"><b>+ Create “${ge(q.value.trim())}”</b><small>new exercise</small></div>` : '';
    list.innerHTML = (rows.length ? '' : mk) + rows.map((x) => { const l = last[x.id]; return `<div class="gy-prow" data-id="${x.id}"><b>${ge(x.name)}</b><small>${ge(x.muscle || '')}${l ? ` · last ${gfmt(l.work[l.work.length - 1].kg)}${gU()} × ${l.work[l.work.length - 1].reps}` : ''}</small></div>`; }).join('') + (rows.length ? mk : '');
  };
  q.oninput = draw; draw(); q.focus();
  const pickNew = () => { const name = q.value.trim(); if (!name) return; const x = { id: uid(), name, muscle: 'Other' }; GY.d.ex.push(x); gSaveSoon(); m.close(); cb(x.id); };
  list.onclick = (e) => { const r = e.target.closest('.gy-prow'); if (!r) return; if (r.dataset.new) return pickNew(); m.close(); cb(r.dataset.id); };
  q.onkeydown = (e) => { if (e.key !== 'Enter') return; const r = list.querySelector('.gy-prow'); if (r) r.click(); };
}

/* ---------- charts ---------- */
function gNice(lo, hi, n) {
  const span = Math.max(hi - lo, 1e-9), raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
}
function gLine(pts, o) {
  const W = 600, h = o.h || 200, L = 46, R = 14, T = 14, B = 26, id = 'gl' + (++GY.gid), col = o.color;
  if (!pts.length) return '<div class="gy-empty">Nothing logged in this range yet.</div>';
  let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x)); if (x1 === x0) { x0 -= 3; x1 += 3; }
  let y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y)); const pad = (y1 - y0 || y1 || 1) * 0.15; y0 = Math.max(0, y0 - pad); y1 += pad;
  const nz = gNice(y0, y1, 3); y0 = Math.max(0, nz.lo); y1 = nz.hi <= y0 ? y0 + nz.step : nz.hi; const ticks = []; for (let v = y0; v <= y1 + 1e-6; v += nz.step) ticks.push(v);
  const px = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R), py = (y) => T + (1 - (y - y0) / (y1 - y0)) * (h - T - B);
  let s = `<svg class="h-svg" viewBox="0 0 ${W} ${h}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".32"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
  ticks.forEach((v) => { const y = py(v); s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y + 3.5}" text-anchor="end" font-size="10" style="fill:var(--dim)">${gk(v)}</text>`; });
  const n = Math.min(5, pts.length > 1 ? 5 : 1);
  for (let i = 0; i < n; i++) { const xv = n === 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * i) / (n - 1); s += `<text x="${px(xv)}" y="${h - 8}" text-anchor="${i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}" font-size="10" style="fill:var(--dim)">${dayLbl(Math.round(xv))}</text>`; }
  if (pts.length > 1) {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
    s += `<path d="${d} L${px(pts[pts.length - 1].x).toFixed(1)} ${h - B} L${px(pts[0].x).toFixed(1)} ${h - B} Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }
  pts.forEach((p) => {
    if (p.pr) s += `<path d="M${px(p.x)} ${py(p.y) - 8} l2.3 4.8 5.2.7 -3.8 3.6 .9 5.2 -4.6 -2.5 -4.6 2.5 .9 -5.2 -3.8 -3.6 5.2 -.7z" fill="${TC.yel}" stroke="var(--bg)" stroke-width=".8"><title>${ge(p.tip)} — PR</title></path>`;
    else s += `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="3.4" fill="var(--bg)" stroke="${col}" stroke-width="2"><title>${ge(p.tip)}</title></circle>`;
  });
  return s + '</svg>';
}
function gBars(items, color, h, W) {
  h = h || 190; W = W || 600; const L = 46, R = 10, T = 18, B = 26, nz = gNice(0, Math.max(1, ...items.map((i) => i.v)) * 1.08, 3), mx = nz.hi, id = 'gb' + (++GY.gid);
  const gw = (W - L - R) / items.length, bw = Math.min(34, gw * 0.62);
  let s = `<svg class="h-svg" viewBox="0 0 ${W} ${h}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".25"/></linearGradient></defs>`;
  for (let v = 0; v <= mx + 1e-6; v += nz.step) { const y = T + (1 - v / mx) * (h - T - B); s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 8}" y="${y + 3.5}" text-anchor="end" font-size="10" style="fill:var(--dim)">${gk(v)}</text>`; }
  items.forEach((it, i) => {
    const bh = (it.v / mx) * (h - T - B), x = L + gw * i + (gw - bw) / 2, y = h - B - bh;
    s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, bh).toFixed(1)}" rx="4" fill="${it.v ? `url(#${id})` : 'var(--raised)'}" ${it.cur ? `stroke="${color}"` : ''}><title>${ge(it.tip)}</title></rect>`;
    if (it.v && items.length <= 14) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="9.5" style="fill:var(--text)">${gk(it.v)}</text>`;
    if (i % (items.length > 10 ? 2 : 1) === 0 || i === items.length - 1) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10" style="fill:var(--dim)">${ge(it.l)}</text>`;
  });
  return s + '</svg>';
}

/* ---------- rendering: shell ---------- */
function gymRender() {
  const root = $('gym-root'); if (!root) return;
  if (!GY.loaded) { root.innerHTML = '<div class="gy-empty">Loading…</div>'; gLoad().then(gymRender); return; }
  const keep = root.scrollTop;
  root.innerHTML = GY.ed ? gEditorHtml() : gMainHtml();
  root.scrollTop = keep;
  root.onclick = gClick; root.oninput = gInput; root.onchange = gChange;
  const sub = $('h-sub'); if (sub) sub.textContent = `${GY.d.wk.length} workout${GY.d.wk.length === 1 ? '' : 's'} logged · ${GY.d.ex.length} exercises`;
  if (GY.ed) gLive();
}
$('health').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-ht]'); if (!t) return;
  const v = t.dataset.ht; if ((H.tab === 'gym' ? 'gym' : 'health') === v) return;
  H.tab = v; if (v === 'gym') await gLoad(); renderHealth();
});

function gMainHtml() {
  const tabs = [['log', 'Workouts'], ['prog', 'Progress'], ['exs', 'Exercises'], ['rts', 'Routines']];
  const body = GY.tab === 'prog' ? gProgHtml() : GY.tab === 'exs' ? gExsHtml() : GY.tab === 'rts' ? gRtsHtml() : gLogHtml();
  return `<div class="gy-bar"><div class="gy-tabs">${tabs.map(([k, l]) => `<button class="gy-tab${GY.tab === k ? ' on' : ''}" data-a="tab" data-id="${k}">${l}</button>`).join('')}</div>
    <div class="gy-right"><label class="gy-unit">Units <select id="gy-unit"><option${gU() === 'kg' ? ' selected' : ''}>kg</option><option${gU() === 'lb' ? ' selected' : ''}>lb</option></select></label>
    <button class="gy-primary" data-a="new">+ New workout</button></div></div>${body}`;
}

/* ---------- Workouts tab ---------- */
function gLogHtml() {
  const an = gAn(), wks = gSorted().reverse(), t = dn(gToday()), mon = gMon(t);
  const inR = (w, a, b) => { const n = dn(w.date); return n >= a && n < b; };
  const thisWk = wks.filter((w) => inR(w, mon, mon + 7));
  const v7 = wks.filter((w) => inR(w, t - 6, t + 1)).reduce((a, w) => a + an.res.get(w.id).vol, 0);
  const v7p = wks.filter((w) => inR(w, t - 13, t - 6)).reduce((a, w) => a + an.res.get(w.id).vol, 0);
  const prs30 = wks.filter((w) => inR(w, t - 29, t + 1)).reduce((a, w) => a + new Set(an.res.get(w.id).prs.map((p) => p.ex)).size, 0);
  const dv = v7 - v7p;
  const stats = `<div class="gy-stats">
    <div class="h-stat" style="--c:${TC.mag}"><small>This week</small><b>${thisWk.length}<em>workout${thisWk.length === 1 ? '' : 's'}</em></b><small>${gfmt(thisWk.reduce((a, w) => a + an.res.get(w.id).sets, 0))} working sets</small></div>
    <div class="h-stat" style="--c:${TC.a3}"><small>Volume, last 7 days</small><b>${gk(v7)}<em>${gU()}</em></b><small>${v7p ? `${dv >= 0 ? '▲' : '▼'} ${gk(Math.abs(dv))} vs the 7 days before` : 'total weight lifted'}</small></div>
    <div class="h-stat" style="--c:${TC.yel}"><small>PRs, last 30 days</small><b>${prs30}<em>exercises</em></b><small>${prs30 ? 'keep it going' : 'beat last time to earn one'}</small></div>
    <div class="h-stat" style="--c:${TC.grn}"><small>All time</small><b>${wks.length}<em>workouts</em></b><small>${gk(wks.reduce((a, w) => a + an.res.get(w.id).vol, 0))} ${gU()} lifted</small></div></div>`;
  if (!wks.length) return stats + `<div class="p-card gy-hero"><h3>Log your first workout</h3><p>Hit <b>+ New workout</b>, add your exercises and sets, and Signal Path will remember what you lifted so you always know what to beat next time. PRs and volume records get celebrated automatically.</p><button class="gy-primary" data-a="new">+ New workout</button></div>`;
  return stats + wks.map((w) => {
    const r = an.res.get(w.id), nm = new Set(r.prs.map((p) => p.ex)).size;
    const lines = w.items.slice(0, 5).map((it) => { const work = it.sets.filter((s) => s.t !== 'W' && s.reps > 0), tp = work.slice().sort((a, b) => (b.kg || 0) - (a.kg || 0) || b.reps - a.reps)[0]; return `<div><span>${ge(gExName(it.ex))}</span><i>${work.length} sets · top ${tp ? `${tp.kg ? gfmt(tp.kg) + gU() + ' × ' : ''}${tp.reps}` : '–'}</i></div>`; }).join('') + (w.items.length > 5 ? `<div class="more">+ ${w.items.length - 5} more</div>` : '');
    const vs = r.prevWk ? `<span class="${r.volDelta >= 0 ? 'gy-up' : 'gy-dn'}">${r.volDelta >= 0 ? '▲' : '▼'} ${gk(Math.abs(r.volDelta))} ${gU()} vs last ${ge(w.name)}</span>` : '';
    return `<div class="p-card gy-wk" data-a="open" data-id="${w.id}"><div class="gy-wk-h"><div><b>${ge(w.name || 'Workout')}</b><small>${gDateLbl(w.date, true)}</small></div>
      <div class="gy-badges">${nm ? `<span class="gy-badge pr">★ ${nm} PR${nm > 1 ? 's' : ''}</span>` : ''}${r.cmp && r.up ? `<span class="gy-badge gy-up">▲ ${r.up}/${r.cmp} sets beat</span>` : ''}</div>
      <button class="gy-dots" data-a="wkmenu" data-id="${w.id}" title="More">⋯</button></div>
      <div class="gy-wk-s">${r.ex} exercise${r.ex === 1 ? '' : 's'} · ${r.sets} sets · <b>${gfmt(r.vol)} ${gU()}</b> ${vs}</div><div class="gy-wk-l">${lines}</div></div>`;
  }).join('');
}

/* ---------- Progress tab ---------- */
function gProgHtml() {
  const an = gAn(), t = dn(gToday()), ids = Object.keys(an.hist).filter((id) => gEx(id));
  ids.sort((a, b) => an.hist[b][an.hist[b].length - 1].date.localeCompare(an.hist[a][an.hist[a].length - 1].date));
  // weekly volume, last 12 weeks
  const mon = gMon(t), wk = [];
  for (let i = 11; i >= 0; i--) wk.push({ s: mon - i * 7, v: 0, c: 0 });
  GY.d.wk.forEach((w) => { const m = gMon(dn(w.date)), b = wk.find((x) => x.s === m); if (b) { b.v += an.res.get(w.id).vol; b.c++; } });
  const wkBars = wk.map((b) => ({ v: b.v, l: dayLbl(b.s), cur: b.s === mon, tip: `Week of ${dayLbl(b.s)}: ${gfmt(b.v)} ${gU()} · ${b.c} workout${b.c === 1 ? '' : 's'}` }));
  let html = `<div class="p-card"><div class="h-ch"><h3>Weekly volume</h3><small class="gy-hint">total weight lifted (working sets) · last 12 weeks</small></div>${gBars(wkBars, TC.mag, 180, 1100)}</div>`;
  if (!ids.length) return html + '<div class="p-card gy-hero"><h3>Exercise progress</h3><p>Log a workout and your per-exercise charts will show up here.</p></div>';
  if (!GY.selEx || !an.hist[GY.selEx]) GY.selEx = ids[0];
  const hs = an.hist[GY.selEx], cut = { '3m': t - 91, '6m': t - 183, '1y': t - 365, all: -1e9 }[GY.range], vis = hs.filter((x) => x.n >= cut);
  const bw = Math.max(...hs.map((x) => x.top)) === 0, u = gU();
  const bestW = Math.max(...hs.map((x) => x.top)), bestO = Math.max(...hs.map((x) => x.orm)), bestS = Math.max(...hs.map((x) => x.sv)), bestR = Math.max(...hs.map((x) => x.tr));
  const first = hs[0], lastS = hs[hs.length - 1], gain = lastS.top - first.top;
  const tipS = (x) => `${gDateLbl(x.date)} · ${x.work.map((s) => `${s.kg ? gfmt(s.kg) + u + ' × ' : ''}${s.reps}`).join(', ')}`;
  html += `<div class="p-card"><div class="h-ch"><select id="gy-selex">${ids.map((id) => `<option value="${id}"${id === GY.selEx ? ' selected' : ''}>${ge(gExName(id))}</option>`).join('')}</select>
    <div class="h-chips">${['3m', '6m', '1y', 'all'].map((r) => `<button class="h-chip${GY.range === r ? ' on' : ''}" style="--c:${TC.mag}" data-a="range" data-id="${r}"><i></i>${r === 'all' ? 'All' : r.toUpperCase()}</button>`).join('')}</div></div>
    <div class="gy-chips">${bw ? `<div><small>Best reps</small><b>${bestR}</b></div>` : `<div><small>Heaviest</small><b>${gfmt(bestW)}<em>${u}</em></b></div><div><small>Best est. 1RM</small><b>${gfmt(bestO)}<em>${u}</em></b></div><div><small>Best set</small><b>${gfmt(bestS)}<em>${u}</em></b></div>`}
    <div><small>Sessions</small><b>${hs.length}</b></div><div><small>Since first log</small><b class="${gain >= 0 ? 'gy-up' : 'gy-dn'}">${bw ? `${lastS.tr - first.tr >= 0 ? '+' : ''}${lastS.tr - first.tr}<em>reps</em>` : `${gain >= 0 ? '+' : ''}${gfmt(gain)}<em>${u}</em>`}</b></div></div></div>`;
  html += `<div class="gy-two"><div class="p-card"><div class="h-ch"><h3>${bw ? 'Top reps' : 'Top set weight'}</h3><small class="gy-hint">★ = personal record</small></div>${gLine(vis.map((x) => ({ x: x.n, y: bw ? x.tr : x.top, pr: x.pr.has('weight') || x.pr.has('reps'), tip: tipS(x) })), { color: TC.a3 })}</div>
    <div class="p-card"><div class="h-ch"><h3>${bw ? 'Session volume (reps)' : 'Estimated 1RM'}</h3><small class="gy-hint">${bw ? 'total reps' : 'Epley estimate'}</small></div>${gLine(vis.map((x) => ({ x: x.n, y: bw ? x.work.reduce((a, s) => a + s.reps, 0) : x.orm, pr: !bw && x.pr.has('orm'), tip: tipS(x) })), { color: TC.mag })}</div></div>`;
  if (!bw) html += `<div class="p-card"><div class="h-ch"><h3>Volume per session</h3><small class="gy-hint">sets × reps × weight</small></div>${gBars(vis.slice(-14).map((x) => ({ v: x.vol, l: dayLbl(x.n), tip: `${tipS(x)} — ${gfmt(x.vol)} ${u}` })), TC.a2, 190, 1100)}</div>`;
  html += `<div class="p-card"><div class="h-ch"><h3>Recent sessions</h3></div><div class="gy-sess">${hs.slice(-8).reverse().map((x) => `<div><span>${gDateLbl(x.date, true)}${x.pr.size ? ' <em class="gy-badge pr">★ PR</em>' : ''}</span><i>${x.work.map((s) => `${s.kg ? gfmt(s.kg) + ' × ' : ''}${s.reps}`).join('  ·  ')}</i></div>`).join('')}</div></div>`;
  return html;
}

/* ---------- Exercises tab ---------- */
function gExsHtml() {
  const an = gAn(), q = GY.q.toLowerCase();
  return `<div class="p-card"><div class="h-ch"><h3>Exercise library</h3><input id="gy-q" class="f-in gy-search" placeholder="Search exercises or muscle groups…" value="${ge(GY.q)}"><button class="gy-primary" data-a="newex">+ New exercise</button></div><div id="gy-exlist">${gExRows(an, q)}</div></div>`;
}
function gExRows(an, q) {
  const rows = GY.d.ex.filter((x) => !q || x.name.toLowerCase().includes(q) || (x.muscle || '').toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  if (!rows.length) return '<div class="gy-empty">No exercises match.</div>';
  return `<div class="gy-exh"><span>Exercise</span><span>Muscle</span><span>Sessions</span><span>Best</span><span>Last done</span><span></span></div>` + rows.map((x) => {
    const h = an.hist[x.id], b = an.best[x.id];
    return `<div class="gy-exrow" data-a="exprog" data-id="${x.id}"><span class="nm">${ge(x.name)}</span><span><em class="gy-mus">${ge(x.muscle || 'Other')}</em></span><span>${h ? h.length : '–'}</span><span>${b && b.w ? gfmt(b.w) + ' ' + gU() : b && b.r ? b.r + ' reps' : '–'}</span><span>${h ? gDateLbl(h[h.length - 1].date) : 'never'}</span><button class="gy-dots" data-a="exmenu" data-id="${x.id}">⋯</button></div>`;
  }).join('');
}

/* ---------- Routines tab ---------- */
function gRtsHtml() {
  const rows = GY.d.rt;
  return `<div class="p-card"><div class="h-ch"><h3>Routines</h3><small class="gy-hint">saved templates — tap one to start a workout from it</small><button class="gy-primary" data-a="newrt">+ New routine</button></div>
    ${rows.length ? `<div class="gy-rts">${rows.map((r) => `<div class="gy-rt"><div class="gy-rt-h"><b>${ge(r.name)}</b><button class="gy-dots" data-a="rtmenu" data-id="${r.id}">⋯</button></div><div class="gy-rt-l">${r.items.map((it) => `<div><span>${ge(gExName(it.ex))}</span><i>${it.sets.length} sets</i></div>`).join('')}</div><button class="gy-primary" data-a="startrt" data-id="${r.id}">Start workout</button></div>`).join('')}</div>` : '<div class="gy-empty">No routines yet. Build a workout you repeat (like Push Day) and use <b>Save as routine</b>, or make one here.</div>'}</div>`;
}

/* ---------- Editor ---------- */
function gEditorHtml() {
  const e = GY.ed, routine = e.mode === 'routine';
  return `<div class="gy-ed"><div class="gy-ed-top"><button data-a="back">‹ Back</button>
    <input class="f-in gy-wname" id="gy-wname" placeholder="${routine ? 'Routine name (e.g. Push Day)' : 'Workout name (e.g. Leg Day)'}" value="${ge(e.name)}">
    ${routine ? '' : `<input type="date" class="f-in" id="gy-wdate" value="${ge(e.date)}">`}<span class="gy-live" id="gy-live"></span>
    <div class="gy-sp"></div>${routine ? '' : '<button data-a="saveasrt">Save as routine</button>'}<button class="gy-primary" data-a="save">${routine ? 'Save routine' : e.isNew ? 'Save workout' : 'Save changes'}</button></div>
    ${e.items.map((it, ei) => gItemHtml(it, ei)).join('') || '<div class="p-card gy-hero"><p>Add the first exercise to get started.</p></div>'}
    <button class="gy-add" data-a="addex">+ Add exercise</button></div>`;
}
function gSetLabel(items, ei, si) { const s = items[ei].sets[si]; if (s.t !== 'N') return s.t; let n = 0; for (let i = 0; i <= si; i++) if (items[ei].sets[i].t === 'N') n++; return n; }
function gItemHtml(it, ei) {
  const e = GY.ed, prev = e.mode === 'routine' ? null : gPrev(it.ex, e.date, e.id), u = gU();
  return `<div class="p-card gy-ex" data-ei="${ei}"><div class="gy-ex-h"><b>${ge(gExName(it.ex))}</b><small>${ge((gEx(it.ex) || {}).muscle || '')}</small><div class="gy-sp"></div>
    ${prev ? `<button class="gy-mini" data-a="uselast" data-ei="${ei}" title="Copy sets from ${gDateLbl(prev.date)}">↺ Use last</button>` : ''}<button class="gy-mini" data-a="swap" data-ei="${ei}" title="Swap for another exercise">⇄ Swap</button><button class="gy-dots" data-a="itmenu" data-ei="${ei}">⋯</button></div>
    ${it.note != null && it.noteOn ? `<input class="f-in gy-note" data-ei="${ei}" data-f="note" placeholder="Exercise note…" value="${ge(it.note)}">` : ''}
    <div class="gy-set gy-set-h"><span>Set</span><span>Previous</span><span>${u.toUpperCase()}</span><span>Reps</span><span></span><span></span></div>
    ${it.sets.map((s, si) => gSetHtml(it, ei, si, prev)).join('')}
    <button class="gy-addset" data-a="addset" data-ei="${ei}">+ Add set</button></div>`;
}
function gSetHtml(it, ei, si, prev) {
  const s = it.sets[si], p = prev && prev.sets[si], lab = gSetLabel(GY.ed.items, ei, si), d = p ? gDelta(s, p) : 0;
  return `<div class="gy-set" data-ei="${ei}" data-si="${si}"><button class="gy-st t${s.t}" data-a="settype" data-ei="${ei}" data-si="${si}">${lab}</button>
    <span class="gy-prev">${p ? `${p.kg ? gfmt(p.kg) + gU() + ' × ' : ''}${p.reps}` : '—'}</span>
    <input class="f-in gy-num" type="number" step="0.5" min="0" inputmode="decimal" data-ei="${ei}" data-si="${si}" data-f="kg" value="${s.kg == null ? '' : s.kg}" placeholder="${p && p.kg ? p.kg : ''}">
    <input class="f-in gy-num" type="number" step="1" min="0" inputmode="numeric" data-ei="${ei}" data-si="${si}" data-f="reps" value="${s.reps == null ? '' : s.reps}" placeholder="${p ? p.reps : ''}">
    <span class="gy-dl ${d > 0 ? 'gy-up' : d < 0 ? 'gy-dn' : ''}" id="gy-dl-${ei}-${si}">${d > 0 ? '▲' : d < 0 ? '▼' : ''}</span>
    <button class="gy-x" data-a="delset" data-ei="${ei}" data-si="${si}" title="Remove set">✕</button></div>`;
}
function gLive() {
  const el = $('gy-live'); if (!el) return; let sets = 0, vol = 0;
  GY.ed.items.forEach((it) => it.sets.forEach((s) => { if (s.reps > 0 && s.t !== 'W') { sets++; vol += (s.kg || 0) * s.reps; } }));
  el.textContent = `${sets} sets · ${gfmt(vol)} ${gU()}`;
}
function gRowUpdate(ei, si) {
  const it = GY.ed.items[ei], prev = GY.ed.mode === 'routine' ? null : gPrev(it.ex, GY.ed.date, GY.ed.id), p = prev && prev.sets[si], d = p ? gDelta(it.sets[si], p) : 0, el = $(`gy-dl-${ei}-${si}`);
  if (el) { el.className = 'gy-dl ' + (d > 0 ? 'gy-up' : d < 0 ? 'gy-dn' : ''); el.textContent = d > 0 ? '▲' : d < 0 ? '▼' : ''; }
  gLive();
}
const gSnap = (e) => JSON.stringify({ n: e.name, d: e.date, i: e.items });
const gDirty = () => !!GY.ed && gSnap(GY.ed) !== GY.ed.snap && (GY.ed.items.length > 0 || !GY.ed.isNew);
function gOpenEditor(w) {
  w.snap = gSnap(w); GY.ed = w; gymRender(); const r = $('gym-root'); if (r) r.scrollTop = 0;
}
function gStartRoutine(id) {
  const r = GY.d.rt.find((x) => x.id === id), d = gToday(); if (!r) return;
  gNewWorkout(r.items.map((it) => { const p = gPrev(it.ex, d, null); return { ex: it.ex, note: '', sets: (p ? p.sets : it.sets).map((s) => ({ t: s.t, kg: s.kg, reps: s.reps })) }; }), r.name);
}
function gStartPrompt() {
  if (!GY.d.rt.length) return gNewWorkout();
  const m = gModal(`<h3>Start a workout</h3><small class="gy-hint">Pick a routine — your latest weights and reps load in automatically.</small>
    <div class="gy-plist gy-startlist">${GY.d.rt.map((r) => `<div class="gy-prow" data-id="${r.id}"><b>${ge(r.name)}</b><small>${r.items.length} exercise${r.items.length === 1 ? '' : 's'}</small></div>`).join('')}</div>
    <div class="gy-prow gy-blank" data-blank="1"><b>Blank workout</b><small>start empty</small></div>`, 'gy-pick');
  m.onclick = (e) => { const r = e.target.closest('.gy-prow'); if (!r) return; m.close(); if (r.dataset.blank) gNewWorkout(); else gStartRoutine(r.dataset.id); };
  const f = m.querySelector('.gy-prow'); if (f) f.setAttribute('tabindex', '0');
}
function gNewWorkout(items, name) { gOpenEditor({ mode: 'workout', isNew: true, id: null, name: name || '', date: gToday(), items: items || [] }); }

/* ---------- events ---------- */
function gInput(e) {
  const t = e.target;
  if (t.id === 'gy-wname') { GY.ed.name = t.value; return; }
  if (t.id === 'gy-q') { GY.q = t.value; $('gy-exlist').innerHTML = gExRows(gAn(), GY.q.toLowerCase()); return; }
  if (!GY.ed || t.dataset.f == null) return;
  const it = GY.ed.items[+t.dataset.ei];
  if (t.dataset.f === 'note') { it.note = t.value; return; }
  const si = +t.dataset.si; it.sets[si][t.dataset.f] = gn(t.value); gRowUpdate(+t.dataset.ei, si);
}
function gChange(e) {
  const t = e.target;
  if (t.id === 'gy-wdate') { GY.ed.date = t.value || gToday(); gymRender(); return; }
  if (t.id === 'gy-selex') { GY.selEx = t.value; gymRender(); return; }
  if (t.id === 'gy-unit') {
    const to = t.value, from = gU(); if (to === from) return;
    const apply = (conv) => {
      if (conv) {
        const f = from === 'kg' ? 2.20462 : 1 / 2.20462, cv = (x) => (x == null ? x : Math.round(x * f * 2) / 2);
        GY.d.wk.forEach((w) => w.items.forEach((i) => i.sets.forEach((s) => { s.kg = cv(s.kg); })));
        GY.d.rt.forEach((r) => r.items.forEach((i) => i.sets.forEach((s) => { s.kg = cv(s.kg); })));
      }
      GY.d.unit = to; GY.an = null; gSaveSoon(); gymRender();
    };
    t.value = from;
    return uiConfirm({ title: `Switch to ${to}?`, msg: `Convert all logged weights from ${from} to ${to} (rounded to 0.5), or just change the label and keep the numbers as they are?`, ok: 'Convert numbers', alt: { label: 'Label only', cb: () => apply(false) }, cb: () => apply(true) });
  }
}
function gClick(e) {
  const a = e.target.closest('[data-a]'); if (!a) return;
  const A = a.dataset.a, id = a.dataset.id, ei = +a.dataset.ei, si = +a.dataset.si, ed = GY.ed;
  if (['wkmenu', 'exmenu', 'rtmenu', 'settype', 'itmenu'].includes(A)) e.stopPropagation();
  if (A === 'tab') { GY.tab = id; return gymRender(); }
  if (A === 'range') { GY.range = id; return gymRender(); }
  if (A === 'new') return gStartPrompt();
  if (A === 'open') { const w = GY.d.wk.find((x) => x.id === id); if (w) gOpenEditor({ mode: 'workout', isNew: false, id: w.id, name: w.name || '', date: w.date, ts: w.ts, items: gClone(w.items).map((i) => ({ ...i, noteOn: !!i.note })) }); return; }
  if (A === 'wkmenu') {
    e.stopPropagation(); const w = GY.d.wk.find((x) => x.id === id);
    return ctxAt(e, [['Edit', () => a.closest('.gy-wk').click()], ['Duplicate to today', () => { gNewWorkout(gClone(w.items).map((i) => ({ ...i, noteOn: !!i.note })), w.name); }], null,
      ['Delete workout', () => uiConfirm({ title: 'Delete this workout?', msg: `${w.name || 'Workout'} from ${gDateLbl(w.date, true)} will be removed, and your exercise history and PRs will be recalculated without it.`, ok: 'Delete', danger: true, cb: () => { GY.d.wk = GY.d.wk.filter((x) => x.id !== id); GY.an = null; gSaveSoon(); gymRender(); } }), 'danger']]);
  }
  if (A === 'newex') return gAsk({ title: 'New exercise', fields: [{ k: 'name', label: 'Name', ph: 'e.g. Cable Row (Wide Grip)' }, { k: 'muscle', label: 'Muscle group', opts: GMUSCLES, val: 'Other' }], ok: 'Add', cb: (v) => { if (!v.name) return false; GY.d.ex.push({ id: uid(), name: v.name, muscle: v.muscle }); gSaveSoon(); gymRender(); } });
  if (A === 'exprog') { GY.selEx = id; GY.tab = 'prog'; return gymRender(); }
  if (A === 'exmenu') {
    e.stopPropagation(); const x = gEx(id);
    return ctxAt(e, [['Rename / change muscle', () => gAsk({ title: 'Edit exercise', fields: [{ k: 'name', label: 'Name', val: x.name }, { k: 'muscle', label: 'Muscle group', opts: GMUSCLES, val: x.muscle }], cb: (v) => { if (!v.name) return false; x.name = v.name; x.muscle = v.muscle; gSaveSoon(); gymRender(); } })], null,
      ['Delete exercise', () => { const n = GY.d.wk.filter((w) => w.items.some((i) => i.ex === id)).length; if (n) return gToast(`Used in ${n} workout${n > 1 ? 's' : ''} — can't delete`); GY.d.ex = GY.d.ex.filter((y) => y.id !== id); gSaveSoon(); gymRender(); }, 'danger']]);
  }
  if (A === 'newrt') return gOpenEditor({ mode: 'routine', isNew: true, id: null, name: '', date: gToday(), items: [] });
  if (A === 'startrt') return gStartRoutine(id);
  if (A === 'rtmenu') {
    e.stopPropagation(); const r = GY.d.rt.find((x) => x.id === id);
    return ctxAt(e, [['Edit routine', () => gOpenEditor({ mode: 'routine', isNew: false, id: r.id, name: r.name, date: gToday(), items: gClone(r.items) })], ['Rename', () => gAsk({ title: 'Rename routine', fields: [{ k: 'name', label: 'Name', val: r.name }], cb: (v) => { if (!v.name) return false; r.name = v.name; gSaveSoon(); gymRender(); } })], null,
      ['Delete routine', () => uiConfirm({ title: 'Delete this routine?', msg: `“${r.name}” will be removed. Your logged workouts and exercise history are not affected.`, ok: 'Delete', danger: true, cb: () => { GY.d.rt = GY.d.rt.filter((x) => x.id !== id); gSaveSoon(); gymRender(); } }), 'danger']]);
  }
  if (!ed) return;
  if (A === 'back') {
    const leave = () => { GY.ed = null; gymRender(); };
    if (gDirty()) return uiConfirm({ title: 'Discard changes?', msg: ed.isNew ? 'This workout hasn\u2019t been saved yet.' : 'You have unsaved changes to this workout.', ok: 'Discard', danger: true, cb: leave });
    return leave();
  }
  if (A === 'addex') return gPick((exId) => { ed.items.push(gNewItem(exId, ed.date, ed.id)); gymRender(); const r = $('gym-root'); r.scrollTop = r.scrollHeight; });
  if (A === 'swap') return gPick((exId) => { ed.items[ei].ex = exId; gymRender(); }, `Swap “${gExName(ed.items[ei].ex)}” for…`);
  if (A === 'uselast') { const p = gPrev(ed.items[ei].ex, ed.date, ed.id); if (p) { ed.items[ei].sets = p.sets.map((s) => ({ t: s.t, kg: s.kg, reps: s.reps })); gymRender(); } return; }
  if (A === 'addset') { const ss = ed.items[ei].sets, l = ss[ss.length - 1]; ss.push({ t: 'N', kg: l ? l.kg : null, reps: l ? l.reps : null }); return gymRender(); }
  if (A === 'delset') { ed.items[ei].sets.splice(si, 1); return gymRender(); }
  if (A === 'settype') {
    const set = (t) => () => { ed.items[ei].sets[si].t = t; gymRender(); };
    return ctxAt(e, [['W   Warm up set', set('W')], ['1   Normal set', set('N')], ['F   Failure set', set('F')], ['D   Drop set', set('D')], null, ['Remove set', () => { ed.items[ei].sets.splice(si, 1); gymRender(); }, 'danger']]);
  }
  if (A === 'itmenu') {
    return ctxAt(e, [['Swap exercise', () => a.parentElement.querySelector('[data-a=swap]').click()], ['Move up', () => { if (ei > 0) { const [x] = ed.items.splice(ei, 1); ed.items.splice(ei - 1, 0, x); gymRender(); } }], ['Move down', () => { if (ei < ed.items.length - 1) { const [x] = ed.items.splice(ei, 1); ed.items.splice(ei + 1, 0, x); gymRender(); } }],
      ['Add / hide note', () => { ed.items[ei].noteOn = !ed.items[ei].noteOn; gymRender(); }], null, ['Remove exercise', () => { ed.items.splice(ei, 1); gymRender(); }, 'danger']]);
  }
  if (A === 'saveasrt') return gAsk({ title: 'Save as routine', fields: [{ k: 'name', label: 'Routine name', val: ed.name }], ok: 'Save', cb: (v) => { if (!v.name) return false; if (!ed.items.length) { gToast('Add an exercise first'); return false; } GY.d.rt.push({ id: uid(), name: v.name, items: ed.items.map((it) => ({ ex: it.ex, sets: it.sets.map((s) => ({ t: s.t, kg: s.kg, reps: s.reps })) })) }); gSaveSoon(); gToast('Routine saved'); } });
  if (A === 'save') return gSave();
}

/* ---------- save + rewards ---------- */
function gSave() {
  const e = GY.ed, num = (v) => (v == null || isNaN(v) ? null : v);
  if (e.mode === 'routine') {
    if (!e.name.trim()) return gToast('Give the routine a name');
    if (!e.items.length) return gToast('Add at least one exercise');
    const items = e.items.map((it) => ({ ex: it.ex, sets: it.sets.map((s) => ({ t: s.t, kg: num(s.kg), reps: num(s.reps) })) }));
    if (e.id) { const r = GY.d.rt.find((x) => x.id === e.id); r.name = e.name.trim(); r.items = items; } else GY.d.rt.push({ id: uid(), name: e.name.trim(), items });
    GY.ed = null; GY.tab = 'rts'; gSaveSoon(true); gymRender(); return gToast('Routine saved');
  }
  const items = e.items.map((it) => ({ ex: it.ex, note: (it.note || '').trim(), sets: it.sets.filter((s) => s.reps > 0).map((s) => ({ t: s.t, kg: num(s.kg) || 0, reps: s.reps })) })).filter((it) => it.sets.length);
  if (!items.length) return gToast('Add at least one set with reps');
  const w = { id: e.id || uid(), date: e.date || gToday(), name: e.name.trim(), items, ts: e.ts || Date.now() };
  const i = GY.d.wk.findIndex((x) => x.id === w.id); if (i >= 0) GY.d.wk[i] = w; else GY.d.wk.push(w);
  GY.an = null; gSaveSoon(true);
  const r = gAn().res.get(w.id); GY.ed = null; GY.tab = 'log'; gymRender();
  if (e.isNew || r.prs.length) gCelebrate(w, r); else gToast('Changes saved');
}
const gPrLabel = { weight: 'Heaviest weight', orm: 'Best est. 1RM', set: 'Best set', reps: 'Most reps' };
function gCelebrate(w, r) {
  const u = gU(), win = r.prs.length > 0 || (r.prevWk && r.volDelta > 0) || r.up > 0;
  const by = {}; r.prs.forEach((p) => { (by[p.ex] = by[p.ex] || []).push(p); });
  const prHtml = Object.keys(by).map((id) => `<div class="gy-pr"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 4h10v4a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M10 17h4v4h-4z" fill="none" stroke="${TC.yel}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div><b>${ge(gExName(id))}</b>${by[id].map((p) => `<span>${gPrLabel[p.k]}: <em>${gfmt(p.val)}${p.k === 'reps' ? '' : ' ' + u}</em> <small>(was ${gfmt(p.was)})</small></span>`).join('')}</div></div>`).join('');
  const vol = r.prevWk ? `<div class="gy-line ${r.volDelta >= 0 ? 'gy-up' : 'gy-dn'}">${r.volDelta >= 0 ? '▲ +' : '▼ −'}${gfmt(Math.abs(r.volDelta))} ${u} vs your last ${ge(w.name)} <small>(${gfmt(r.prevVol)} ${u}${r.partial ? ', same exercises' : ''})</small></div>` : (w.name ? `<div class="gy-line">First “${ge(w.name)}” on record — ${gfmt(r.vol)} ${u} is the number to beat.</div>` : '');
  const beat = r.cmp ? `<div class="gy-line ${r.up ? 'gy-up' : ''}">${r.up ? '▲' : '•'} Beat last time on ${r.up} of ${r.cmp} comparable sets</div>` : '';
  const cols = [TC.mag, TC.a3, TC.yel, TC.a2, TC.grn], conf = win ? `<div class="gy-conf">${Array.from({ length: 46 }, () => `<i style="--x:${Math.random() * 100}%;--dx:${(Math.random() - 0.5) * 220}px;--rot:${Math.random() * 720}deg;--d:${1.8 + Math.random() * 1.8}s;--dl:${Math.random() * 0.5}s;--c:${cols[(Math.random() * cols.length) | 0]}"></i>`).join('')}</div>` : '';
  const m = gModal(`${conf}<div class="gy-win-h">${r.prs.length ? '<span class="gy-star">★</span><h2>New personal record!</h2>' : win ? '<span class="gy-star">▲</span><h2>Stronger than last time</h2>' : '<h2>Workout logged</h2>'}<small>${ge(w.name || 'Workout')} · ${gDateLbl(w.date, true)}</small></div>
    <div class="gy-win-s"><div><b>${gfmt(r.vol)}</b><small>${u} volume</small></div><div><b>${r.sets}</b><small>working sets</small></div><div><b>${r.ex}</b><small>exercises</small></div></div>${prHtml}${vol}${beat}
    <div class="gy-mact"><button class="gy-primary" data-x="ok">${win ? 'Nice' : 'Done'}</button></div>`, 'gy-win');
  m.querySelector('[data-x=ok]').onclick = m.close;
}
if (typeof uWrap === 'function') { uWrap('gymRender', 'gym'); uUI(); }
