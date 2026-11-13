/* ================= GOOGLE CALENDAR (Signal Path 4.0, read-only) =================
   Data comes from Google through the main process (see main.js, "gcal:*").
   Nothing here can change your calendar. Edit in the Google Calendar app and it shows up here.
   Page-level preferences (view, week start, hidden calendars, extra holiday calendars) live in localStorage. */
(() => {
  'use strict';
  const el = $('calendar');
  const PREF = 'sp-cal';
  const P = Object.assign({ view: 'month', mon: true, on: {}, hol: [], side: true },
    (() => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; } })());
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(P)); } catch (e) { /* ignore */ } };

  /* ---------- dates ---------- */
  const DAY = 864e5, H = 56;
  const p2 = (n) => String(n).padStart(2, '0');
  const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const keyOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const ymOf = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
  const pd = (s) => { const a = s.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); };
  const wkStart = (d) => addD(d, -((d.getDay() - (P.mon ? 1 : 0) + 7) % 7));
  const dIdx = (a, b) => Math.round((sod(b) - sod(a)) / DAY);
  const sameDay = (a, b) => keyOf(a) === keyOf(b);
  const isoWeek = (d) => { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const n = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - n); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7); };
  const fT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const tStr = (d) => { const s = fT.format(d).replace(/\s/g, '').toLowerCase(); return /[ap]m$/.test(s) ? s.replace(':00', '') : s; };
  const fmt = (d, o) => new Intl.DateTimeFormat(undefined, o).format(d);
  const dowName = (i, o) => fmt(new Date(2024, 0, 1 + i), { weekday: o || 'short' });
  const dowList = (o) => Array.from({ length: 7 }, (_, i) => dowName(P.mon ? i : (i + 6) % 7, o));
  const inTxt = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`; return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ''}`; };
  const lastDay = (e) => sod(e.e > e.s ? new Date(e.e.getTime() - 1) : e.s);
  const colorOk = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : 'var(--a3)');
  // an event's own colour (set per event in Google) beats its calendar's colour
  // like the Gantt, cards use the theme's own palette: each Google colour is sent to the nearest theme colour by hue
  function themed(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'var(--a2)';
    const n = parseInt(m[1], 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    if (d === 0 || d / (1 - Math.abs(2 * l - 1)) < 0.16) return 'var(--a2)';
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
    if (h < 15 || h >= 330) return 'var(--rose)'; if (h < 45) return 'var(--amb)'; if (h < 70) return 'var(--mag)';
    if (h < 171) return 'var(--grn)'; if (h < 206) return 'var(--a3)'; return 'var(--a2)';
  }
  const evColor = (e) => (e.hol ? 'var(--yel)' : themed((e.color && K.colors[e.color]) || e.cal.color));
  const progress = (e) => { const d = e.e - e.s; return d > 0 ? Math.round(Math.min(1, Math.max(0, (Date.now() - e.s) / d)) * 100) : 100; };

  /* ---------- state ---------- */
  const K = {
    status: null, listed: [], mc: new Map(), pending: new Set(), errs: {}, loading: 0, offline: false, banner: '',
    colors: {}, colorsAsked: false, anchor: sod(new Date()), sel: null, dir: 0, pool: [], ev: [], pop: null, connecting: false, attempt: 0,
    setupErr: '', showKeys: false, scrollKey: '', scrollTop: 0, drawT: null, ready: false,
  };

  /* ---------- holiday catalogue (public Google holiday calendars) ---------- */
  const HOLS = [['United States', 'US', 'en.usa'], ['United Kingdom', 'GB', 'en.uk'], ['Taiwan', 'TW', 'en.taiwan'], ['Japan', 'JP', 'en.japanese'], ['South Korea', 'KR', 'en.south_korea'],
    ['China', 'CN', 'en.china'], ['Hong Kong', 'HK', 'en.hong_kong'], ['Singapore', 'SG', 'en.singapore'], ['Malaysia', 'MY', 'en.malaysia'], ['Philippines', 'PH', 'en.philippines'],
    ['Indonesia', 'ID', 'en.indonesian'], ['India', 'IN', 'en.indian'], ['Australia', 'AU', 'en.australian'], ['New Zealand', 'NZ', 'en.new_zealand'], ['Canada', 'CA', 'en.canadian'],
    ['Ireland', 'IE', 'en.irish'], ['Germany', 'DE', 'en.german'], ['France', 'FR', 'en.french'], ['Italy', 'IT', 'en.italian'], ['Spain', 'ES', 'en.spain'], ['Netherlands', 'NL', 'en.dutch'],
    ['Brazil', 'BR', 'en.brazilian'], ['Mexico', 'MX', 'en.mexican'], ['South Africa', 'ZA', 'en.south_africa']].map((x) => ({ name: x[0], code: x[1], id: `${x[2]}#holiday@group.v.calendar.google.com` }));
  const holCode = (c) => { const h = HOLS.find((x) => x.id === c.id); if (h) return h.code; const m = /^([a-z-]+)\.([a-z_]+)#holiday/.exec(c.id); return (m ? m[2] : c.name.replace(/^Holidays in /i, '')).slice(0, 2).toUpperCase(); };

  /* ---------- calendars ---------- */
  function allCals() {
    const out = K.listed.map((c) => ({ ...c, code: c.holiday ? holCode(c) : '' }));
    if (K.status && K.status.connected) out.push({ id: '__tasks', name: 'Tasks', color: '#4f8cf0', selected: true, tasks: true });
    P.hol.forEach((h) => { if (!out.some((c) => c.id === h.id)) out.push({ id: h.id, name: `Holidays in ${h.name}`, color: 'hol', holiday: true, selected: true, extra: true, code: h.code }); });
    return out;
  }
  const isOn = (c) => (P.on[c.id] !== undefined ? P.on[c.id] : c.selected);
  const activeCals = () => allCals().filter(isOn);

  /* ---------- loading ---------- */
  const monthsIn = (a, b) => { const out = []; let m = new Date(a.getFullYear(), a.getMonth(), 1); while (m < b) { out.push(m); m = new Date(m.getFullYear(), m.getMonth() + 1, 1); } return out; };
  function visRange() {
    const a = K.anchor;
    if (P.view === 'month') { const f = wkStart(new Date(a.getFullYear(), a.getMonth(), 1)), l = wkStart(new Date(a.getFullYear(), a.getMonth() + 1, 0)); return [f, addD(l, 7)]; }
    if (P.view === 'week') { const f = wkStart(a); return [f, addD(f, 7)]; }
    return [a, addD(a, 1)];
  }
  const norm = (e) => ({ ...e, s: e.allDay ? pd(e.start) : new Date(e.start), e: e.allDay ? pd(e.end) : new Date(e.end) });
  function onAuthLost(msg) { if (K.status) K.status.connected = false; K.banner = msg; K.setupErr = msg; K.mc.clear(); render(); }
  function noteErr(cal, r) {
    if (r.code === 'reauth' || r.code === 'noauth') return onAuthLost(r.code === 'reauth' && /permission missing/i.test(r.error || '') ? 'Google did not give Signal Path calendar access. Press Disconnect Google, reconnect, and tick the Calendar box on Google\'s page.' : r.code === 'reauth' ? 'Your Google sign-in expired. This happens every 7 days while the Google Cloud app is still in “Testing”. In Google Cloud, open Google Auth Platform → Audience → Publish app, then reconnect.' : 'Not connected to Google.');
    K.errs[cal.id] = r.error || 'Could not load';
    if (r.code === 'forbidden' && !cal.holiday) K.banner = r.error || 'Google refused the request. Check that the Calendar API is switched on for your Google Cloud project.';
  }
  async function loadCals() {
    const r = await api.gcalCalendars();
    if (r.ok) { K.listed = r.items; if (r.offline) K.offline = true; } else noteErr({ id: '_list', holiday: false }, r);
    if (r.ok && !K.colorsAsked) { K.colorsAsked = true; api.gcalColors().then((c) => { if (c && c.ok) { K.colors = c.items; drawSoon(); } }).catch(() => { K.colorsAsked = false; }); }
  }
  async function fetchCal(cal, m1, force) {
    const k = `${cal.id}|${ymOf(m1)}`;
    if ((!force && K.mc.has(k)) || K.pending.has(k)) return;
    K.pending.add(k); K.loading++; bar();
    try {
      const nx = new Date(m1.getFullYear(), m1.getMonth() + 1, 1);
      const r = cal.tasks ? await api.gcalTasks(addD(m1, -1).toISOString(), addD(nx, 1).toISOString()) : await api.gcalEvents(cal.id, addD(m1, -1).toISOString(), addD(nx, 1).toISOString());
      if (r.ok) { K.mc.set(k, r.items.filter((e) => e.rsvp !== 'declined').map(norm)); delete K.errs[cal.id]; if (r.offline) K.offline = true; } else noteErr(cal, r);
    } catch (e) { K.errs[cal.id] = 'Could not load'; } finally { K.pending.delete(k); K.loading--; bar(); drawSoon(); }
  }
  async function load(force) {
    if (!K.status || !K.status.connected) return;
    if (force) { K.offline = false; K.banner = ''; }
    if (!K.listed.length || force) await loadCals();
    if (!K.status.connected) return;
    const [a, b] = visRange(), now = new Date(), ms = new Map();
    monthsIn(a, b).forEach((m) => ms.set(ymOf(m), m)); ms.set(ymOf(now), new Date(now.getFullYear(), now.getMonth(), 1));
    const cals = activeCals(), jobs = [];
    cals.forEach((c) => ms.forEach((m) => jobs.push(fetchCal(c, m, force))));
    await Promise.all(jobs);
    const an = K.anchor, near = [new Date(an.getFullYear(), an.getMonth() - 1, 1), new Date(an.getFullYear(), an.getMonth() + 1, 1)];
    setTimeout(() => { if (K.status && K.status.connected) near.forEach((m) => activeCals().forEach((c) => fetchCal(c, m, false))); }, 600);
  }
  function bar() { const b = el.querySelector('.cal-bar'); if (b) b.classList.toggle('on', K.loading > 0); }
  function drawSoon() { clearTimeout(K.drawT); K.drawT = setTimeout(() => { if (isV('calendar') && K.status && K.status.connected) render(); }, 50); }

  function gather() {
    const cals = new Map(activeCals().map((c) => [c.id, c])), out = [], seen = new Set();
    K.mc.forEach((list, k) => {
      const c = cals.get(k.slice(0, k.lastIndexOf('|'))); if (!c) return;
      list.forEach((e) => { const id = `${c.id}|${e.id}|${e.start}`; if (seen.has(id)) return; seen.add(id); out.push({ ...e, cal: c, hol: !!c.holiday }); });
    });
    /* Google Tasks that already sit on the grid as a timed event (same title, same day) are shown once, as the timed block. */
    const nk = (t) => String(t || '').trim().toLowerCase(), timedKeys = new Set();
    out.forEach((e) => { if (!e.task && !e.hol && !e.allDay) timedKeys.add(`${keyOf(e.s)}|${nk(e.title)}`); });
    return out.filter((e) => !(e.task && timedKeys.has(`${keyOf(e.s)}|${nk(e.title)}`))).sort((a, b) => a.s - b.s);
  }

  /* ---------- lane layout (all-day bars, month rows) ---------- */
  const rank = (e) => (e.hol ? 0 : (e.allDay || dIdx(e.s, lastDay(e)) > 0) ? 1 : 2);
  function lanes(evs, ws, n) {
    const items = [];
    evs.forEach((e) => {
      const f = dIdx(ws, e.s), l = dIdx(ws, lastDay(e));
      if (l < 0 || f > n - 1) return;
      items.push({ e, c0: Math.max(0, f), c1: Math.min(n - 1, l) + 1, cs: f < 0, ce: l > n - 1 });
    });
    items.sort((x, y) => rank(x.e) - rank(y.e) || x.c0 - y.c0 || (y.c1 - y.c0) - (x.c1 - x.c0) || x.e.s - y.e.s);
    const occ = [];
    items.forEach((it) => {
      for (let l = 0; ; l++) {
        if (!occ[l]) occ[l] = Array(n).fill(false);
        let free = true; for (let c = it.c0; c < it.c1; c++) if (occ[l][c]) { free = false; break; }
        if (free) { for (let c = it.c0; c < it.c1; c++) occ[l][c] = true; it.lane = l; break; }
      }
    });
    return { items, n: occ.length };
  }

  /* ---------- small html helpers ---------- */
  const ICO = {
    clock: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/></svg>',
    pin: '<svg viewBox="0 0 16 16"><path d="M8 14.5s4.6-4.1 4.6-7.6A4.6 4.6 0 0 0 3.4 6.9C3.4 10.4 8 14.5 8 14.5z"/><circle cx="8" cy="6.9" r="1.6"/></svg>',
    video: '<svg viewBox="0 0 16 16"><rect x="1.6" y="4" width="8.6" height="8" rx="1.8"/><path d="M10.2 7.2l4-2.2v6l-4-2.2"/></svg>',
    people: '<svg viewBox="0 0 16 16"><circle cx="6" cy="5.6" r="2.3"/><path d="M1.8 13c.3-2.4 2.1-3.6 4.2-3.6s3.9 1.2 4.2 3.6"/><path d="M10.6 3.6a2.2 2.2 0 0 1 0 4.2M12 9.6c1.4.4 2.1 1.5 2.3 3.2"/></svg>',
    text: '<svg viewBox="0 0 16 16"><path d="M2.5 4h11M2.5 8h11M2.5 12h7"/></svg>',
    cal: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.6h12M5.4 1.8v2.6M10.6 1.8v2.6"/></svg>',
    link: '<svg viewBox="0 0 16 16"><path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5"/></svg>',
    side: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M6 3v10"/></svg>',
    refresh: '<svg viewBox="0 0 16 16"><path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3M13.2 2.6v3h-3"/></svg>',
  };
  const ico = (n) => `<i class="ci">${ICO[n]}</i>`;
  const stripHtml = (s) => String(s || '').replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]*>?/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
  const poolAdd = (e) => { K.pool.push(e); return K.pool.length - 1; };

  function chipHtml(it, mode) {
    const e = it.e, now = Date.now(), c = e.cal;
    const multi = !e.hol && (e.allDay || dIdx(e.s, lastDay(e)) > 0);
    const past = e.allDay ? e.e <= sod(new Date()) : e.e.getTime() <= now, live = !e.allDay && !e.hol && e.s.getTime() <= now && e.e.getTime() > now;
    const cls = ['cal-ev', e.hol ? 'hol' : multi ? 'bar' : 'tm']; if (e.task) { cls.push('tk'); if (e.done) cls.push('done'); } if (it.cs) cls.push('cs'); if (it.ce) cls.push('ce'); if (past) cls.push('past'); if (live) cls.push('live');
    const col = evColor(e);
    let inner;
    if (e.hol) inner = `<s>${esc(c.code || '')}</s><span>${esc(e.title)}</span>`;
    else if (!multi) inner = `<i class="cal-dot"></i><b>${tStr(e.s)}</b><span>${esc(e.title)}</span>`;
    else inner = e.task ? `<i class="cal-tkb"></i><span>${esc(e.title)}</span>` : `<span>${esc(e.title)}</span>`;
    return `<button class="${cls.join(' ')}" data-e="${poolAdd(e)}" style="--ec:${col};${live ? `--p:${progress(e)}%;` : ''}grid-column:${it.c0 + 1}/${it.c1 + 1};grid-row:${it.lane + 1}" title="${esc(e.title)}">${inner}</button>`;
  }

  /* ---------- month ---------- */
  function drawMonth() {
    const a = K.anchor, first = wkStart(new Date(a.getFullYear(), a.getMonth(), 1)), last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    const nW = Math.ceil((dIdx(first, last) + 1) / 7), today = sod(new Date());
    let h = `<div class="cal-grid"><div class="cal-dow">${dowList().map((d, i) => `<span class="${(P.mon ? i >= 5 : i === 0 || i === 6) ? 'wk' : ''}">${d}</span>`).join('')}</div><div class="cal-weeks">`;
    for (let w = 0; w < nW; w++) {
      h += `<div class="cal-wk" data-w="${w}"><div class="cal-cells">`;
      for (let i = 0; i < 7; i++) {
        const d = addD(first, w * 7 + i), cls = ['cal-cell']; const dow = d.getDay();
        if (d.getMonth() !== a.getMonth()) cls.push('oth'); if (dow === 0 || dow === 6) cls.push('wknd'); if (sameDay(d, today)) cls.push('today'); if (K.sel && sameDay(d, K.sel)) cls.push('sel');
        h += `<div class="${cls.join(' ')}" data-day="${keyOf(d)}"><button class="cal-dn" data-day="${keyOf(d)}" title="Open day">${d.getDate() === 1 ? `<em>${fmt(d, { month: 'short' })}</em>` : ''}${d.getDate()}</button></div>`;
      }
      h += '</div><div class="cal-evs"></div></div>';
    }
    return h + '</div></div>';
  }
  function layoutMonth() {
    const a = K.anchor, first = wkStart(new Date(a.getFullYear(), a.getMonth(), 1));
    el.querySelectorAll('.cal-wk').forEach((wk) => {
      const w = +wk.dataset.w, ws = addD(first, w * 7), maxL = Math.max(1, Math.floor((wk.clientHeight - 32) / 24));
      const L = lanes(K.ev, ws, 7), over = L.n > maxL, vis = over ? maxL - 1 : L.n;
      let h = L.items.filter((it) => it.lane < vis).map((it) => chipHtml(it)).join('');
      if (over) for (let c = 0; c < 7; c++) {
        const hidden = L.items.filter((it) => it.lane >= vis && it.c0 <= c && it.c1 > c).length;
        if (hidden) h += `<button class="cal-more" data-day="${keyOf(addD(ws, c))}" style="grid-column:${c + 1};grid-row:${maxL}">+${hidden} more</button>`;
      }
      wk.querySelector('.cal-evs').innerHTML = h;
    });
  }

  /* ---------- week / day ---------- */
  function packDay(segs) {
    segs.sort((x, y) => x.a - y.a || y.b - x.b);
    const out = []; let cluster = [], cend = -1;
    const flush = () => { const cols = []; cluster.forEach((s) => { let c = cols.findIndex((end) => end <= s.a); if (c < 0) { c = cols.length; cols.push(0); } cols[c] = s.b; s.col = c; }); cluster.forEach((s) => { s.n = cols.length; out.push(s); }); cluster = []; };
    segs.forEach((s) => { if (cluster.length && s.a >= cend) { flush(); cend = -1; } cluster.push(s); cend = Math.max(cend, s.b); });
    if (cluster.length) flush();
    return out;
  }
  function drawTime(days) {
    const n = days.length, today = sod(new Date()), now = new Date();
    const adL = lanes(K.ev.filter((e) => e.hol || e.allDay), days[0], n);
    const timed = K.ev.filter((e) => !e.hol && !e.allDay);
    let head = `<div class="cal-gut"></div>`;
    days.forEach((d) => { const t = sameDay(d, today); head += `<div class="cal-dh${t ? ' today' : ''}${K.sel && sameDay(d, K.sel) ? ' sel' : ''}" data-day="${keyOf(d)}"><span>${dowName(P.mon ? (d.getDay() + 6) % 7 : (d.getDay() + 6) % 7)}</span><button class="cal-dn" data-day="${keyOf(d)}">${d.getDate()}</button></div>`; });
    head += `<div class="cal-gut cal-gad">all-day</div><div class="cal-ade" style="grid-template-columns:repeat(${n},minmax(0,1fr))">${adL.items.map((it) => chipHtml(it)).join('')}</div>`;
    let cols = '';
    days.forEach((d) => {
      const de = addD(d, 1), segs = [];
      timed.forEach((e) => {
        if (!(e.s < de && (e.e > d || (e.e.getTime() === e.s.getTime() && sameDay(e.s, d))))) return;
        const a = e.s >= d ? e.s.getHours() * 60 + e.s.getMinutes() : 0;
        let b = e.e < de ? e.e.getHours() * 60 + e.e.getMinutes() : 1440; if (b <= a) b = a + 30; b = Math.max(b, a + 30);
        segs.push({ e, a, b: Math.min(b, 1440 + 60) });
      });
      const t = sameDay(d, today), wk = d.getDay() === 0 || d.getDay() === 6;
      cols += `<div class="cal-col${t ? ' today' : ''}${wk ? ' wknd' : ''}" data-day="${keyOf(d)}">`;
      packDay(segs).forEach((s) => {
        const e = s.e, past = e.e.getTime() <= now.getTime(), live = e.s.getTime() <= now.getTime() && e.e.getTime() > now.getTime(), hgt = (s.b - s.a) * H / 60 - 2;
        const sz = hgt < 34 ? ' sm' : hgt < 52 ? ' md' : '';
        const inner = sz === ' sm' ? `<b>${esc(e.title)}</b><span>${tStr(e.s)}</span>` : `<b>${esc(e.title)}</b>${hgt >= 40 ? `<span>${tStr(e.s)} – ${tStr(e.e)}</span>` : ''}${hgt > 64 && e.loc ? `<span class="lc">${esc(e.loc)}</span>` : ''}`;
        cols += `<button class="cal-te${sz}${past ? ' past' : ''}${live ? ' live' : ''}" data-e="${poolAdd(e)}" style="--ec:${evColor(e)};${live ? `--p:${progress(e)}%;` : ''}top:${s.a * H / 60}px;height:${hgt}px;left:calc(${s.col / s.n * 100}% + 2px);width:calc(${100 / s.n}% - 5px)">${inner}</button>`;
      });
      if (t) cols += `<div class="cal-now" style="top:${(now.getHours() * 60 + now.getMinutes()) * H / 60}px"></div>`;
      cols += '</div>';
    });
    const hrs = Array.from({ length: 24 }, (_, i) => `<span style="top:${i * H}px">${i ? tStr(new Date(2024, 0, 1, i)) : ''}</span>`).join('');
    return `<div class="cal-tg" id="cal-tg" style="--n:${n};--H:${H}px"><div class="cal-tgh" style="grid-template-columns:56px repeat(${n},minmax(0,1fr))">${head}</div><div class="cal-tgb" style="grid-template-columns:56px repeat(${n},minmax(0,1fr))"><div class="cal-hrs">${hrs}</div>${cols}</div></div>`;
  }

  /* ---------- side panel ---------- */
  function miniHtml() {
    const a = K.anchor, first = wkStart(new Date(a.getFullYear(), a.getMonth(), 1)), today = sod(new Date());
    const dots = new Set(); K.ev.forEach((e) => { if (e.hol) return; for (let d = sod(e.s), l = lastDay(e), g = 0; d <= l && g < 40; d = addD(d, 1), g++) dots.add(keyOf(d)); });
    let g = '';
    for (let i = 0; i < 42; i++) { const d = addD(first, i), cls = ['mm']; if (d.getMonth() !== a.getMonth()) cls.push('oth'); if (sameDay(d, today)) cls.push('today'); if (K.sel && sameDay(d, K.sel)) cls.push('sel'); if (dots.has(keyOf(d))) cls.push('has'); g += `<button class="${cls.join(' ')}" data-day="${keyOf(d)}" data-mini="1">${d.getDate()}</button>`; }
    return `<div class="cs-mini"><div class="cs-mh"><b>${fmt(a, { month: 'long', year: 'numeric' })}</b><span><button data-a="mprev">‹</button><button data-a="mnext">›</button></span></div><div class="cs-md">${dowList('narrow').map((d) => `<i>${d}</i>`).join('')}</div><div class="cs-mg">${g}</div></div>`;
  }
  function sideHtml() {
    const cals = allCals(), mine = cals.filter((c) => !c.holiday), hol = cals.filter((c) => c.holiday);
    const row = (c) => `<div class="cs-row${isOn(c) ? ' on' : ''}" data-cal="${esc(c.id)}"><span class="cs-chk" style="--ec:${c.holiday ? 'var(--yel)' : colorOk(c.color)}"></span><span class="cs-nm" title="${esc(c.name)}">${esc(c.name)}</span>${K.errs[c.id] ? `<span class="cs-err" title="${esc(K.errs[c.id])}">!</span>` : ''}${c.extra ? `<button class="cs-x" data-rm="${esc(c.id)}" title="Remove">×</button>` : ''}</div>${c.tasks && K.errs[c.id] ? `<div class="cs-tk-note">${esc(K.errs[c.id])}</div>` : ''}`;
    return `<aside class="cal-side">${miniHtml()}<div class="cs-sec"><h4>My calendars</h4>${mine.map(row).join('') || '<div class="cs-none">Loading…</div>'}</div>
      <div class="cs-sec"><h4>Holidays<button data-a="addhol" title="Add a country">+</button></h4>${hol.map(row).join('') || '<div class="cs-none">None yet — add a country with +</div>'}</div>
      <div class="cs-foot"><div class="cs-acct" title="${esc(K.status.email || '')}">${esc(K.status.email || 'Connected')}</div>
      <label class="cs-opt"><span>Week starts Monday</span><span class="cs-sw${P.mon ? ' on' : ''}" data-a="mon"></span></label><button data-a="disc" class="cs-disc">Disconnect Google</button></div></aside>`;
  }

  /* ---------- header + sub line ---------- */
  function periodLabel() {
    const a = K.anchor;
    if (P.view === 'month') return fmt(a, { month: 'long', year: 'numeric' });
    if (P.view === 'week') { const s = wkStart(a); return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(s, addD(s, 6)); }
    return fmt(a, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function nextUp() {
    const now = Date.now(), ev = [];
    K.mc.forEach((list, k) => { const c = activeCals().find((x) => x.id === k.slice(0, k.lastIndexOf('|'))); if (c && !c.holiday) list.forEach((e) => { if (!e.allDay) ev.push({ ...e, cal: c }); }); });
    const live = ev.filter((e) => e.s.getTime() <= now && e.e.getTime() > now).sort((a, b) => a.e - b.e)[0];
    if (live) return { kind: 'Now', e: live, txt: `ends in ${inTxt(live.e - now)}` };
    const nx = ev.filter((e) => e.s.getTime() > now && e.s.getTime() - now < 36 * 36e5).sort((a, b) => a.s - b.s)[0];
    return nx ? { kind: 'Next', e: nx, txt: `in ${inTxt(nx.s - now)} · ${tStr(nx.s)}` } : null;
  }
  function subHtml() {
    const u = nextUp(), left = K.offline ? '<span class="cal-off" title="Google could not be reached. Showing the last saved data.">Offline · saved data</span>' : '';
    if (!u) return `${left}${left ? ' ' : ''}<span class="cal-sub-d">${P.view === 'week' ? `Week ${isoWeek(K.anchor)}` : 'Read-only view of your Google Calendar'}</span>`;
    return `${left}<span class="cal-up"><i style="--ec:${evColor(u.e)}"></i><b>${u.kind}</b> ${esc(u.e.title)} <span>· ${u.txt}</span></span>`;
  }
  /* ---------- setup / connect screens ---------- */
  const GC = 'https://console.cloud.google.com/';
  function setupHtml() {
    const st = K.status, conf = st.configured, keys = !conf || K.showKeys;
    const steps = `<ol class="cs-steps">
      <li><b>Create a project</b> in <a data-open="${GC}projectcreate">Google Cloud Console</a> (free, any name).</li>
      <li><b>Switch on the API:</b> open <a data-open="${GC}apis/library/calendar-json.googleapis.com">Google Calendar API</a> and press Enable.</li>
      <li><b>Set up the app:</b> <a data-open="${GC}auth/overview">Google Auth Platform</a> → Get started → name it “Signal Path”, audience <i>External</i>. Then Audience → <i>Publish app</i> so sign-in never expires.</li>
      <li><b>Add the permission:</b> Data Access → add <code>…/auth/calendar.readonly</code> (view only).</li>
      <li><b>Create the key:</b> <a data-open="${GC}auth/clients">Clients</a> → Create client → <i>Desktop app</i>. Paste the Client ID and secret below.</li></ol>`;
    return `<div class="cal-setup"><div class="cs-card"><div class="cs-hero">${ICO.cal}</div>
      <h2>${conf ? 'Connect your Google Calendar' : 'Bring your Google Calendar in'}</h2>
      <p class="cs-lead">${conf ? 'Your keys are saved. Press connect and approve access in your browser.' : 'Signal Path shows your events in its own look. It can only <b>view</b> your calendar, never change it. One-time setup, about five minutes:'}</p>
      ${K.setupErr ? `<div class="cs-bad">${esc(K.setupErr)}</div>` : ''}
      ${keys ? steps : ''}
      ${keys ? `<div class="cs-fields"><label>Client ID<input id="cs-id" autocomplete="off" spellcheck="false" placeholder="123456789-abc….apps.googleusercontent.com"></label><label>Client secret<input id="cs-sec" type="password" autocomplete="off" spellcheck="false" placeholder="GOCSPX-…"></label></div>` : ''}
      <div class="cs-act">${K.connecting ? `<button class="primary" disabled>Waiting for Google in your browser…</button><button data-a="cancel">Cancel</button>` : `<button class="primary" data-a="${keys ? 'save' : 'connect'}">${keys ? 'Save and connect' : 'Connect Google Calendar'}</button>${conf && !K.showKeys ? '<button data-a="keys">Change keys</button>' : ''}${conf && K.showKeys ? '<button data-a="connect">Use saved keys</button>' : ''}`}</div>
      <div class="cs-note">Your keys and sign-in are stored only on this PC, never sent anywhere except Google.</div></div></div>`;
  }

  /* ---------- main render ---------- */
  function render() {
    if (!K.status) { el.innerHTML = '<div class="cal-setup"><div class="cs-card"><p class="cs-lead">Loading…</p></div></div>'; return; }
    K.pool = [];
    if (!K.status.connected) {
      el.innerHTML = `<div class="t-head cal-head"><div><h1>Calendar</h1><div class="t-sub">Google Calendar, read-only</div></div></div>${setupHtml()}`;
      return;
    }
    K.ev = gather();
    const prevTg = el.querySelector('#cal-tg .cal-tgb') ? el.querySelector('#cal-tg').scrollTop : null;
    const key = `${P.view}|${keyOf(K.anchor)}`, keepScroll = prevTg != null && K.scrollKey === key;
    const dirCls = K.dir > 0 ? ' from-r' : K.dir < 0 ? ' from-l' : '';
    let main;
    if (P.view === 'month') main = drawMonth();
    else main = drawTime(P.view === 'week' ? Array.from({ length: 7 }, (_, i) => addD(wkStart(K.anchor), i)) : [K.anchor]);
    const seg = ['month', 'week', 'day'].map((v) => `<button data-v="${v}" class="${P.view === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');
    el.innerHTML = `<div class="t-head cal-head"><div><h1>Calendar</h1><div class="t-sub" id="cal-sub">${subHtml()}</div></div>
      <div class="cal-ctl"><button data-a="side" class="cal-ib${P.side ? ' on' : ''}" title="Show or hide calendars">${ico('side')}</button>
      <div class="cal-nav"><button data-a="prev" title="Previous (←)">‹</button><button data-a="today" title="Today (T)">Today</button><button data-a="next" title="Next (→)">›</button></div>
      <div class="cal-period">${esc(periodLabel())}</div>
      <div class="cal-seg">${seg}</div><button data-a="refresh" class="cal-ib" title="Refresh from Google">${ico('refresh')}</button></div></div>
      ${K.banner ? `<div class="cal-banner"><span>${esc(K.banner)}</span><button data-a="dismiss">×</button></div>` : ''}
      <div class="cal-body${P.side ? '' : ' noside'}">${P.side ? sideHtml() : ''}<div class="cal-main"><div class="cal-bar${K.loading > 0 ? ' on' : ''}"></div><div class="cal-view${dirCls}">${main}</div></div></div>`;
    K.dir = 0;
    if (P.view === 'month') layoutMonth();
    else {
      const tg = $('cal-tg'); if (tg) {
        if (keepScroll) tg.scrollTop = prevTg;
        else { const t = sameDay(K.anchor, new Date()) || (P.view === 'week' && dIdx(wkStart(K.anchor), new Date()) >= 0 && dIdx(wkStart(K.anchor), new Date()) < 7); tg.scrollTop = Math.max(0, (t ? new Date().getHours() - 1.5 : 7) * H); }
        K.scrollKey = key;
      }
    }
  }

  /* ---------- event popover ---------- */
  function closePop() { if (K.pop) { K.pop.remove(); K.pop = null; } }
  function whenTxt(e) {
    if (e.allDay) { const l = lastDay(e); return sameDay(e.s, l) ? fmt(e.s, { weekday: 'long', day: 'numeric', month: 'long' }) : `${fmt(e.s, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmt(l, { weekday: 'short', day: 'numeric', month: 'short' })}`; }
    const same = sameDay(e.s, e.e) || e.e.getTime() === e.s.getTime(), mins = Math.round((e.e - e.s) / 60000), dur = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;
    return same ? `${fmt(e.s, { weekday: 'long', day: 'numeric', month: 'long' })}<br><span class="pp-t">${tStr(e.s)} – ${tStr(e.e)}${mins > 0 ? ` · ${dur}` : ''}</span>` : `${fmt(e.s, { weekday: 'short', day: 'numeric', month: 'short' })}, ${tStr(e.s)} –<br>${fmt(e.e, { weekday: 'short', day: 'numeric', month: 'short' })}, ${tStr(e.e)}`;
  }
  function openPop(e, anchorEl) {
    closePop();
    const c = e.cal, col = evColor(e), desc = stripHtml(e.desc), rs = { accepted: 'Going', tentative: 'Maybe', needsAction: 'Invited' }[e.rsvp] || '';
    const d = document.createElement('div'); d.className = 'cal-pop'; d.style.setProperty('--ec', col);
    d.innerHTML = `<div class="pp-bar"></div><button class="pp-x" data-pp="x" title="Close (Esc)">×</button><h3>${esc(e.title)}</h3>
      <div class="pp-row">${ico('clock')}<div>${whenTxt(e)}</div></div>
      ${e.loc ? `<div class="pp-row">${ico('pin')}<div>${esc(e.loc)}</div></div>` : ''}
      ${e.meet ? `<div class="pp-row">${ico('video')}<div><button class="pp-join" data-open="${esc(e.meet)}">Join video call</button></div></div>` : ''}
      ${e.guests ? `<div class="pp-row">${ico('people')}<div>${e.guests} guest${e.guests === 1 ? '' : 's'}${rs ? ` · <span class="pp-t">${rs}</span>` : ''}</div></div>` : ''}
      ${desc ? `<div class="pp-row">${ico('text')}<div class="pp-desc">${esc(desc)}</div></div>` : ''}
      <div class="pp-row">${ico('cal')}<div><span class="pp-cal"><i></i>${esc(c.name)}</span></div></div>
      ${e.link ? `<div class="pp-foot"><button data-open="${esc(e.link)}">${ico('link')}Open in Google Calendar</button></div>` : ''}`;
    document.body.appendChild(d); K.pop = d;
    const r = anchorEl.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
    let x = r.right + 10; if (x + w > innerWidth - 12) x = r.left - w - 10; if (x < 12) x = Math.max(12, Math.min(innerWidth - w - 12, r.left));
    let y = r.top - 6; if (y + h > innerHeight - 12) y = innerHeight - h - 12; d.style.left = `${x}px`; d.style.top = `${Math.max(12, y)}px`;
  }
  function dayPop(key, anchorEl) {
    closePop();
    const day = pd(key), de = addD(day, 1), list = K.ev.filter((e) => e.s < de && (e.e > day || (e.e.getTime() === e.s.getTime() && sameDay(e.s, day)))).sort((a, b) => rank(a) - rank(b) || a.s - b.s);
    const d = document.createElement('div'); d.className = 'cal-pop cal-daypop';
    d.innerHTML = `<button class="pp-x" data-pp="x">×</button><h3>${fmt(day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>${list.map((e) => `<button class="pp-item" data-e="${poolAdd(e)}" style="--ec:${evColor(e)}"><i></i><span>${esc(e.title)}</span><em>${e.hol ? esc(e.cal.code || 'Holiday') : e.allDay ? 'all-day' : tStr(e.s)}</em></button>`).join('')}<div class="pp-foot"><button data-day="${key}" data-gotoday="1">Open day view</button></div>`;
    document.body.appendChild(d); K.pop = d;
    const r = anchorEl.getBoundingClientRect(), w = d.offsetWidth, h = d.offsetHeight;
    let x = r.left; if (x + w > innerWidth - 12) x = innerWidth - w - 12; let y = r.bottom + 6; if (y + h > innerHeight - 12) y = Math.max(12, r.top - h - 6);
    d.style.left = `${Math.max(12, x)}px`; d.style.top = `${y}px`;
  }

  /* ---------- dialogs ---------- */
  function dialog(html, onClick, onKey) {
    const ov = document.createElement('div'); ov.className = 't-modal'; ov.innerHTML = `<div class="t-card g-card cal-dlg">${html}</div>`;
    const close = () => ov.remove();
    ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.closest('[data-a]'); if (a) onClick(a.dataset.a, a, close, ov); };
    ov.onkeydown = (e) => { if (e.key === 'Escape') close(); if (onKey) onKey(e, close, ov); };
    document.body.appendChild(ov); return ov;
  }
  function askDisconnect() {
    dialog(`<h3>Disconnect Google?</h3><div class="t-for">Signal Path will forget your Google sign-in and clear its saved calendar data on this PC. Your Google Calendar itself is untouched, and you can reconnect any time.</div><div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Disconnect</button></div>`,
      async (a, b, close) => { if (a === 'x') close(); if (a === 'ok') { close(); await api.gcalDisconnect(); K.listed = []; K.mc.clear(); K.errs = {}; K.banner = ''; K.setupErr = ''; K.status = await api.gcalStatus(); render(); } });
  }
  function addHoliday() {
    const have = new Set(allCals().map((c) => c.id));
    const list = (q) => HOLS.filter((h) => !have.has(h.id) && h.name.toLowerCase().includes(q.toLowerCase())).map((h) => `<button class="ah-row" data-a="pick" data-id="${esc(h.id)}"><s>${h.code}</s>${esc(h.name)}</button>`).join('') || '<div class="cs-none">Nothing else to add</div>';
    const ov = dialog(`<h3>Add holidays</h3><div class="t-for">Public holidays for another country. They appear in gold across every view.</div><input class="ah-q" placeholder="Search countries" autocomplete="off"><div class="ah-list">${list('')}</div><div class="t-actions"><span></span><button data-a="x">Done</button></div>`,
      (a, b, close) => { if (a === 'x') close(); if (a === 'pick') { const h = HOLS.find((x) => x.id === b.dataset.id); if (h) { P.hol.push({ id: h.id, name: h.name, code: h.code }); savePrefs(); b.remove(); load(false); render(); } } });
    const q = ov.querySelector('.ah-q'); q.oninput = () => { ov.querySelector('.ah-list').innerHTML = list(q.value); }; q.focus();
  }

  /* ---------- actions ---------- */
  function go(dir) {
    const a = K.anchor; K.dir = dir; K.sel = null;
    if (P.view === 'month') { const t = new Date(a.getFullYear(), a.getMonth() + dir, 1), now = new Date(); K.anchor = ymOf(t) === ymOf(now) ? sod(now) : t; }
    else K.anchor = addD(a, dir * (P.view === 'week' ? 7 : 1));
    load(false); render();
  }
  function setCalView(v) { if (P.view === v) return; P.view = v; savePrefs(); K.dir = 0; load(false); render(); }
  function toDay(key, view) { K.anchor = pd(key); K.sel = null; if (view) { P.view = view; savePrefs(); } load(false); render(); }
  async function connectNow() {
    const my = ++K.attempt; K.connecting = true; K.setupErr = ''; render();
    const r = await api.gcalConnect();
    if (my !== K.attempt) return;
    K.connecting = false;
    if (r.ok) { K.status = await api.gcalStatus(); K.banner = ''; K.listed = []; K.mc.clear(); K.showKeys = false; await load(true); render(); return; }
    if (!r.cancelled) K.setupErr = r.error || 'Could not connect.';
    render();
  }
  async function saveKeys() {
    const id = $('cs-id') && $('cs-id').value, sec = $('cs-sec') && $('cs-sec').value;
    const r = await api.gcalSetClient(id, sec);
    if (!r.ok) { K.setupErr = r.error; render(); return; }
    K.status = await api.gcalStatus(); K.showKeys = false; connectNow();
  }

  el.addEventListener('click', async (ev) => {
    const t = ev.target, open = t.closest('[data-open]');
    if (open) { api.gcalOpen(open.dataset.open); return; }
    const a = t.closest('[data-a]');
    if (a) {
      const k = a.dataset.a;
      if (k === 'prev') go(-1); else if (k === 'next') go(1);
      else if (k === 'today') { K.dir = sod(new Date()) > K.anchor ? 1 : -1; K.anchor = sod(new Date()); K.sel = null; load(false); render(); }
      else if (k === 'side') { P.side = !P.side; savePrefs(); render(); }
      else if (k === 'refresh') { K.loading++; bar(); await load(true); K.loading--; render(); }
      else if (k === 'dismiss') { K.banner = ''; render(); }
      else if (k === 'mprev' || k === 'mnext') { K.dir = 0; K.anchor = new Date(K.anchor.getFullYear(), K.anchor.getMonth() + (k === 'mnext' ? 1 : -1), 1); load(false); render(); }
      else if (k === 'mon') { P.mon = !P.mon; savePrefs(); render(); }
      else if (k === 'addhol') addHoliday();
      else if (k === 'disc') askDisconnect();
      else if (k === 'save') saveKeys();
      else if (k === 'connect') connectNow();
      else if (k === 'keys') { K.showKeys = true; render(); }
      else if (k === 'cancel') { await api.gcalCancel(); }
      return;
    }
    const v = t.closest('[data-v]'); if (v) { setCalView(v.dataset.v); return; }
    const rm = t.closest('[data-rm]'); if (rm) { const id = rm.dataset.rm; P.hol = P.hol.filter((h) => h.id !== id); delete P.on[id]; savePrefs(); render(); return; }
    const row = t.closest('.cs-row'); if (row) { const c = allCals().find((x) => x.id === row.dataset.cal); if (c) { P.on[c.id] = !isOn(c); savePrefs(); load(false); render(); } return; }
    const mini = t.closest('[data-mini]'); if (mini) { const d = pd(mini.dataset.day); K.sel = d; K.anchor = d; K.dir = 0; load(false); render(); return; }
    const more = t.closest('.cal-more'); if (more) { dayPop(more.dataset.day, more); return; }
    const chip = t.closest('[data-e]'); if (chip && K.pool[+chip.dataset.e]) { openPop(K.pool[+chip.dataset.e], chip); return; }
    const dn = t.closest('.cal-dn'); if (dn) { toDay(dn.dataset.day, 'day'); return; }
    const cell = t.closest('.cal-cell, .cal-dh'); if (cell && P.view === 'month') { const d = pd(cell.dataset.day); K.sel = d; if (d.getMonth() !== K.anchor.getMonth()) K.anchor = d; render(); }
  });
  el.addEventListener('dblclick', (ev) => { const c = ev.target.closest('.cal-cell, .cal-col, .cal-dh'); if (c && !ev.target.closest('[data-e],.cal-more')) toDay(c.dataset.day, 'day'); });
  document.addEventListener('mousedown', (e) => { if (K.pop && !K.pop.contains(e.target) && !e.target.closest('[data-e],.cal-more')) closePop(); });
  document.addEventListener('click', (e) => {
    if (!K.pop || !K.pop.contains(e.target)) return;
    const open = e.target.closest('[data-open]'); if (open) { api.gcalOpen(open.dataset.open); return; }
    if (e.target.closest('[data-pp="x"]')) { closePop(); return; }
    const goto = e.target.closest('[data-gotoday]'); if (goto) { const k = goto.dataset.day; closePop(); toDay(k, 'day'); return; }
    const item = e.target.closest('.pp-item'); if (item && K.pool[+item.dataset.e]) { const ev = K.pool[+item.dataset.e]; openPop(ev, item); }
  });
  document.addEventListener('keydown', (e) => {
    if (!isV('calendar') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { closePop(); return; }
    const tg = e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA' || document.querySelector('.t-modal')) return;
    if (!K.status || !K.status.connected) return;
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    else if (k === 't') { K.dir = 0; K.anchor = sod(new Date()); K.sel = null; load(false); render(); }
    else if (k === 'm') setCalView('month'); else if (k === 'w') setCalView('week'); else if (k === 'd') setCalView('day');
  });
  let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (isV('calendar') && K.status && K.status.connected && P.view === 'month') layoutMonth(); }, 120); });

  /* ---------- entry points ---------- */
  async function show() {
    if (S.view === 'calendar') { showDash(); return; } // clicking Calendar again goes back to the dashboard, like the other buttons
    setView('calendar');
    if (!K.status || !K.status.connected) K.status = await api.gcalStatus();
    render();
    if (K.status.connected) { await load(false); }
  }
  window.calRender = () => { closePop(); render(); };
  window.calShow = show;
  $('btn-cal').onclick = () => show();

  /* background: keep the badge and "next up" fresh, and re-sync every few minutes */
  let syncN = 0;
  setInterval(() => {
    if (isV('calendar') && K.status && K.status.connected && !document.querySelector('.t-modal')) render();
    if (++syncN % 5 === 0 && K.status && K.status.connected) load(true).then(() => { if (isV('calendar')) render(); });
  }, 60000);
  (async () => {
    try { K.status = await api.gcalStatus(); } catch (e) { K.status = { configured: false, connected: false }; }
    if (K.status.connected) await load(false);
    K.ready = true;
  })();
})();
