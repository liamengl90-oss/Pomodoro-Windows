/* Signal Path canvas (4.7)
   An infinite board of cards, notes, images, links and groups, stored as a standard Obsidian-compatible .canvas file (JSON Canvas),
   so Obsidian can still open it. Text cards and note cards use the same editor as the Notes page. */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg', GRID = 24;
  const DIR = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
  const OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const pal = () => ({ 1: TC.rose, 2: TC.amb, 3: TC.yel, 4: TC.grn, 5: TC.a3, 6: TC.a2 });
  const colorOf = (c) => (c ? pal()[c] || c : null);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };
  const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const svg = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; };
  const norm = (p) => String(p).replace(/\\/g, '/');
  const rel2abs = (rel) => S.root.replace(/[\\/]+$/, '') + '/' + rel;
  const abs2rel = (abs) => norm(abs).slice(norm(S.root).length).replace(/^\/+/, '');
  const isImg = (f) => IMGX.test(f || '');
  let C = null;
  const byId = (id) => C.nodes.find((n) => n.id === id);
  const ICON = {
    sel: '<svg viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-3 6z"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V11m0-4a1.5 1.5 0 0 1 3 0v7.5a6 6 0 0 1-6 6h-.5a6 6 0 0 1-5-2.7L4 13.5a1.5 1.5 0 0 1 2.4-1.7L8 14"/></svg>',
  };

  /* ---------- open / close ---------- */
  const fixNode = (n) => {
    n.id = typeof n.id === 'string' && n.id ? n.id : rid(); n.type = ['text', 'file', 'link', 'group'].includes(n.type) ? n.type : 'text';
    n.x = +n.x || 0; n.y = +n.y || 0; n.width = Math.max(40, +n.width || 260); n.height = Math.max(30, +n.height || 120);
    if (n.type === 'text' && typeof n.text !== 'string') n.text = '';
    return n;
  };
  const fixEdge = (e) => { e.id = typeof e.id === 'string' && e.id ? e.id : rid(); e.fromSide = DIR[e.fromSide] ? e.fromSide : 'right'; e.toSide = DIR[e.toSide] ? e.toSide : 'left'; return e; };

  window.cvOpen = (pane, tab) => {
    cvClose();
    C = { tab, pane, nodes: [], edges: [], v: { x: 0, y: 0, k: 1 }, sel: new Set(), edge: null, tool: 'select', space: false, snap: store.get('cv-snap') !== false, grid: store.get('cv-grid:' + tab.path) !== false, mini: store.get('cv-mini') !== false,
      pathing: store.get('cv-path:' + tab.path) || 'bezier', rcache: new Map(), fast: false, els: new Map(), eels: new Map(), lels: new Map(), meta: new Map(), edit: null, G: null, clip: null, clipMark: '', off: [], hits: [], hi: 0, mouse: null, saves: new Map(), toolsKey: '' };
    nBase(tab); pane.classList.add('cvp');
    pane.innerHTML = `
      <div class="cv-bar">
        <input class="cv-title" spellcheck="false" value="${qa(tab.name)}" title="Canvas name">
        <span class="sep"></span>
        <button data-a="tool-select" class="ic on" title="Select and move (V)">${ICON.sel}</button><button data-a="tool-hand" class="ic" title="Hand: drag to pan (H, or hold Space)">${ICON.hand}</button>
        <span class="sep"></span>
        <span class="cv-add"><button data-a="add-text" title="New text card (T, or double-click the board)">+ Card</button><button data-a="add-note" title="Add a note from your library">+ Note</button><button data-a="add-img" title="Add pictures">+ Image</button><button data-a="add-link" title="Add a web link">+ Link</button><button data-a="add-group" title="Group the selection, or add an empty group (Ctrl+G)">+ Group</button></span>
        <button class="cv-addbtn" data-a="addmenu" title="Add a card, note, image, link or group">+ Add ▾</button>
        <span class="cv-fmt" hidden><span class="sep"></span>
          <button data-c="bold" title="Bold"><b>B</b></button><button data-c="italic" title="Italic"><i>I</i></button><button data-c="underline" title="Underline"><u>U</u></button><button data-c="strike" title="Strikethrough"><s>S</s></button>
          <button data-c="h1">H1</button><button data-c="h2">H2</button><button data-c="ul">• List</button><button data-c="task" class="tick">☑ Tick</button><button data-c="table" class="tick">▦ Table</button><button data-c="image" class="tick">▣ Image</button><button data-c="hr" class="tick" title="Insert a divider line">― Divider</button><button data-c="fold" class="tick" title="Collapse the text under this line">▾ Fold</button>
        </span>
        <span class="grow"></span>
        <span class="cv-vopts"><button data-a="find" title="Search this canvas (Ctrl+F)">Search</button><button data-a="lines" title="How connections are drawn: curved, straight, square or smart">Lines ▾</button><button data-a="grid" class="tick${C.grid ? ' on' : ''}" title="Show the background grid">Grid</button><button data-a="snap" class="tick${C.snap ? ' on' : ''}" title="Snap cards to a grid (guides to other cards are always on; hold Alt to move freely)">Snap</button><button data-a="mini" class="tick${C.mini ? ' on' : ''}" title="Mini-map">Map</button></span>
        <button class="cv-morebtn" data-a="moremenu" title="Search, line style, snap, mini-map">⋯</button>
        <span class="sep"></span>
        <span class="cv-zoom"><button data-a="zout" class="ic" title="Zoom out (-)">−</button><button data-a="z100" class="cv-zl" title="Reset to 100% (Ctrl+1)">100%</button><button data-a="zin" class="ic" title="Zoom in (+)">+</button><button data-a="fit" title="Fit everything (Ctrl+0)">Fit</button></span>
      </div>
      <div class="cv-view" tabindex="0">
        <div class="cv-grid"></div>
        <div class="cv-world"><svg class="cv-edges" width="1" height="1"></svg><div class="cv-nodes"></div><div class="cv-labels"></div></div>
        <svg class="cv-ov"></svg>
        <div class="cv-marq" hidden></div>
        <div class="cv-sel" hidden><div class="cv-frame"></div>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i class="cv-rh" data-h="${h}"></i>`).join('')}</div>
        <div class="cv-eh-wrap"></div>
        <div class="cv-seltools" hidden></div>
        <div class="cv-find" hidden><input placeholder="Find in this canvas" spellcheck="false"><span class="cv-fc"></span></div>
        <canvas class="cv-minimap" width="220" height="150"></canvas>
        <div class="cv-empty">Double-click to add a card<small>Drag notes in from the library · paste or drop pictures · drag from a card’s edge dot to connect</small></div>
      </div>`;
    const q = (s) => pane.querySelector(s);
    Object.assign(C, { bar: q('.cv-bar'), view: q('.cv-view'), gridEl: q('.cv-grid'), world: q('.cv-world'), edgeLayer: q('.cv-edges'), nodeLayer: q('.cv-nodes'), labelLayer: q('.cv-labels'),
      ov: q('.cv-ov'), marq: q('.cv-marq'), selBox: q('.cv-sel'), ehWrap: q('.cv-eh-wrap'), tools: q('.cv-seltools'), find: q('.cv-find'), miniCv: q('.cv-minimap'), empty: q('.cv-empty'), fmt: q('.cv-fmt'), zl: q('.cv-zl') });
    C.miniCv.hidden = !C.mini;
    let d = {}; try { d = JSON.parse(tab.text || '{}') || {}; } catch { d = {}; }
    load(d);
    wire();
    const sv = store.get('cv-view:' + tab.path);
    if (sv && isFinite(sv.k) && C.nodes.length) C.v = { x: +sv.x || 0, y: +sv.y || 0, k: clamp(+sv.k || 1, .05, 3) }; else fit(null, 1, true);
    applyView(); requestAnimationFrame(() => { if (C) { if (!sv && C.nodes.length) fit(null, 1, true); applyView(); } });
    C.view.focus({ preventScroll: true });
  };
  window.cvClose = () => {
    if (!C) return;
    try { endEdit(); } catch { /* ignore */ }
    for (const [, s] of C.saves) { clearTimeout(s.t); api.write(s.path, s.md); }
    saveView(true); C.off.forEach((f) => f()); C.pane.classList.remove('cvp'); C = null;
  };

  function load(d) {
    C.nodes = (Array.isArray(d.nodes) ? d.nodes : []).filter((n) => n && typeof n === 'object').map(fixNode);
    const ids = new Set(C.nodes.map((n) => n.id));
    C.edges = (Array.isArray(d.edges) ? d.edges : []).filter((e) => e && ids.has(e.fromNode) && ids.has(e.toNode)).map(fixEdge);
    C.els.forEach((e) => e.remove()); C.els.clear(); C.eels.forEach((e) => e.remove()); C.eels.clear(); C.lels.forEach((e) => e.remove()); C.lels.clear(); C.meta.clear();
    C.nodes.forEach((n) => { makeEl(n); paintNode(n); }); C.edges.forEach(paintEdge); schedule();
  }

  /* ---------- history + saving ---------- */
  const serial = () => JSON.stringify({ nodes: C.nodes, edges: C.edges }, null, '\t');
  function commit(coalesce) {
    const t = C.tab, h = t.hist, text = serial(); if (text === t.text) return;
    const now = Date.now();
    if (!(coalesce && now - (h.t || 0) < 700)) { h.u.push({ text: h.last }); uTrim(h); }
    h.t = now; h.r = []; h.last = text; t.text = text; markDirty(t); uUI(); if (!C.fast) repaintRouted(); schedule();
  }
  window.cvStep = (dir) => {
    if (!C) return; const t = C.tab, h = t.hist; if (!h) return;
    const from = dir < 0 ? h.u : h.r, to = dir < 0 ? h.r : h.u; if (!from.length) return;
    endEdit(); const e = from.pop(); to.push({ text: h.last }); h.last = e.text; t.text = e.text; h.t = 0;
    let d = {}; try { d = JSON.parse(e.text); } catch { d = {}; }
    C.sel.clear(); C.edge = null; C.rcache.clear(); load(d); markDirty(t); uUI(); refreshSel(); if (typeof gToast === 'function') gToast(dir < 0 ? 'Undone' : 'Redone');
  };
  let viewT = 0;
  function saveView(now) { if (!C) return; const f = () => { if (C) store.set('cv-view:' + C.tab.path, C.v); }; clearTimeout(viewT); if (now) f(); else viewT = setTimeout(f, 400); }

  /* ---------- geometry ---------- */
  const anchor = (n, s) => (s === 'top' ? [n.x + n.width / 2, n.y] : s === 'right' ? [n.x + n.width, n.y + n.height / 2] : s === 'bottom' ? [n.x + n.width / 2, n.y + n.height] : [n.x, n.y + n.height / 2]);
  function geom(e) {
    const fr = e._free, a = byId(e.fromNode), b = byId(e.toNode), f0 = fr && fr.end === 'from', f1 = fr && fr.end === 'to';
    if ((!a && !f0) || (!b && !f1)) return null;
    const p0 = f0 ? fr.p : anchor(a, e.fromSide), p1 = f1 ? fr.p : anchor(b, e.toSide), d0 = f0 ? fr.d : DIR[e.fromSide], d1 = f1 ? fr.d : DIR[e.toSide], d = Math.max(45, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * .35);
    return { p0, p1, d0, d1, c0: [p0[0] + d0[0] * d, p0[1] + d0[1] * d], c1: [p1[0] + d1[0] * d, p1[1] + d1[1] * d] };
  }
  /* ---- connection routing (4.9): curve, direct, square, smart (A*). Stored per connection as styleAttributes.pathfindingMethod, like the Advanced Canvas plugin ---- */
  const PATHS = [['bezier', 'Curve'], ['direct', 'Direct'], ['square', 'Square'], ['a-star', 'Smart (goes around cards)']];
  const edgeStyle = (e) => { const v = e.styleAttributes && e.styleAttributes.pathfindingMethod; return PATHS.some((p) => p[0] === v) ? v : C.pathing; };
  const unit = (a, b) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  function simplify(pts) {
    const o = []; for (const p of pts) { const l = o[o.length - 1]; if (l && Math.abs(l[0] - p[0]) < .01 && Math.abs(l[1] - p[1]) < .01) continue; o.push(p); }
    for (let i = o.length - 2; i > 0; i--) { const a = o[i - 1], b = o[i], q = o[i + 1]; if ((Math.abs(a[0] - b[0]) < .01 && Math.abs(b[0] - q[0]) < .01) || (Math.abs(a[1] - b[1]) < .01 && Math.abs(b[1] - q[1]) < .01)) o.splice(i, 1); }
    return o;
  }
  function squarePts(g) {
    const s = 24, p0 = g.p0, p1 = g.p1, a = [p0[0] + g.d0[0] * s, p0[1] + g.d0[1] * s], b = [p1[0] + g.d1[0] * s, p1[1] + g.d1[1] * s], h0 = g.d0[0] !== 0, h1 = g.d1[0] !== 0; let mid;
    if (h0 && h1) { const mx = g.d0[0] === g.d1[0] ? (g.d0[0] > 0 ? Math.max(a[0], b[0]) : Math.min(a[0], b[0])) : (a[0] + b[0]) / 2; mid = [[mx, a[1]], [mx, b[1]]]; }
    else if (!h0 && !h1) { const my = g.d0[1] === g.d1[1] ? (g.d0[1] > 0 ? Math.max(a[1], b[1]) : Math.min(a[1], b[1])) : (a[1] + b[1]) / 2; mid = [[a[0], my], [b[0], my]]; }
    else if (h0) mid = [[b[0], a[1]]]; else mid = [[a[0], b[1]]];
    return simplify([p0, a, ...mid, b, p1]);
  }
  /* orthogonal A* on a sparse grid built from the card edges, with a penalty for every bend so routes stay tidy */
  function astarPts(g) {
    const s = 22, pad = 16, M = 240, BEND = 36, p0 = g.p0, p1 = g.p1, a = [p0[0] + g.d0[0] * s, p0[1] + g.d0[1] * s], b = [p1[0] + g.d1[0] * s, p1[1] + g.d1[1] * s];
    const x0 = Math.min(a[0], b[0]) - M, x1 = Math.max(a[0], b[0]) + M, y0 = Math.min(a[1], b[1]) - M, y1 = Math.max(a[1], b[1]) + M, obs = [];
    C.nodes.forEach((n) => { if (n.type === 'group' || n.x >= x1 || n.x + n.width <= x0 || n.y >= y1 || n.y + n.height <= y0) return; obs.push([n.x - pad, n.y - pad, n.x + n.width + pad, n.y + n.height + pad]); });
    const sig = [g.d0, g.d1, a, b, obs].join('|'), hit = C.rcache.get(sig); if (hit) return hit.map((p) => p.slice());
    const inObs = (x, y) => obs.some((o) => x > o[0] + .01 && x < o[2] - .01 && y > o[1] + .01 && y < o[3] - .01);
    if (inObs(a[0], a[1]) || inObs(b[0], b[1])) return null;
    const xs = new Set([a[0], b[0], x0, x1]), ys = new Set([a[1], b[1], y0, y1]); obs.forEach((o) => { xs.add(o[0]); xs.add(o[2]); ys.add(o[1]); ys.add(o[3]); });
    const mids = (A) => { const o = []; for (let i = 0; i < A.length; i++) { o.push(A[i]); if (i + 1 < A.length && A[i + 1] - A[i] > 12) o.push((A[i] + A[i + 1]) / 2); } return o; };
    const X = mids([...xs].sort((p, q) => p - q)), Y = mids([...ys].sort((p, q) => p - q)), NX = X.length, NY = Y.length; if (NX * NY > 90000) return null;
    const xi = new Map(X.map((v, i) => [v, i])), yi = new Map(Y.map((v, i) => [v, i])), blk = new Int8Array(NX * NY).fill(-1);
    const blocked = (i, j) => { const k = i * NY + j; if (blk[k] < 0) blk[k] = inObs(X[i], Y[j]) ? 1 : 0; return blk[k] === 1; };
    const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]], si = xi.get(a[0]), sj = yi.get(a[1]), gi = xi.get(b[0]), gj = yi.get(b[1]);
    const d0 = DIRS.findIndex((d) => d[0] === g.d0[0] && d[1] === g.d0[1]), gd = DIRS.findIndex((d) => d[0] === -g.d1[0] && d[1] === -g.d1[1]);
    const N = NX * NY * 4, G = new Float64Array(N).fill(Infinity), par = new Int32Array(N).fill(-1), heap = [];
    const push = (f, st, gg) => { heap.push([f, st, gg]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const s0 = (si * NY + sj) * 4 + d0; G[s0] = 0; push(0, s0, 0); let goal = -1, guard = 0;
    while (heap.length && guard++ < 250000) {
      const [, st, gg] = pop(); if (gg > G[st]) continue; const dir = st & 3, cell = st >> 2, i = (cell / NY) | 0, j = cell % NY;
      if (i === gi && j === gj) { goal = st; break; }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((dir + 2) & 3)) continue; const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1]; if (ni < 0 || nj < 0 || ni >= NX || nj >= NY || blocked(ni, nj)) continue;
        if (inObs((X[i] + X[ni]) / 2, (Y[j] + Y[nj]) / 2)) continue;
        const cost = Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (nd !== dir ? BEND : 0) + (ni === gi && nj === gj && nd !== gd ? BEND : 0), ng = gg + cost, ns = (ni * NY + nj) * 4 + nd;
        if (ng < G[ns]) { G[ns] = ng; par[ns] = st; push(ng + Math.abs(X[ni] - b[0]) + Math.abs(Y[nj] - b[1]), ns, ng); }
      }
    }
    if (goal < 0) return null;
    const path = []; for (let st = goal; st >= 0; st = par[st]) { const cell = st >> 2; path.push([X[(cell / NY) | 0], Y[cell % NY]]); }
    path.reverse(); const out = simplify([p0, ...path, p1]);
    if (C.rcache.size > 500) C.rcache.clear(); C.rcache.set(sig, out.map((p) => p.slice())); return out;
  }
  function roundPath(pts, r) {
    let d = `M${pt(pts[0])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i - 1], q = pts[i], n = pts[i + 1], l1 = Math.hypot(q[0] - p[0], q[1] - p[1]), l2 = Math.hypot(n[0] - q[0], n[1] - q[1]), rr = Math.min(r, l1 / 2, l2 / 2);
      d += ` L${pt([q[0] + (p[0] - q[0]) / l1 * rr, q[1] + (p[1] - q[1]) / l1 * rr])} Q${pt(q)} ${pt([q[0] + (n[0] - q[0]) / l2 * rr, q[1] + (n[1] - q[1]) / l2 * rr])}`;
    }
    return d + ` L${pt(pts[pts.length - 1])}`;
  }
  function route(e) {
    const g = geom(e); if (!g) return null; const st = edgeStyle(e);
    if (st === 'bezier') return { g, d: `M${pt(g.p0)} C${pt(g.c0)} ${pt(g.c1)} ${pt(g.p1)}`, mid: bez(g, .5), u0: [-g.d0[0], -g.d0[1]], u1: [-g.d1[0], -g.d1[1]] };
    const pts = st === 'direct' ? [g.p0, g.p1] : st === 'square' ? squarePts(g) : ((!C.fast && astarPts(g)) || squarePts(g)), n = pts.length;
    let tot = 0; for (let i = 1; i < n; i++) tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    let mid = pts[0], run = 0; for (let i = 1; i < n; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (run + L >= tot / 2) { const f = (tot / 2 - run) / (L || 1); mid = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; break; } run += L; }
    return { g, d: st === 'direct' ? `M${pt(pts[0])} L${pt(pts[n - 1])}` : roundPath(pts, 10), mid, u0: unit(pts[1], pts[0]), u1: unit(pts[n - 2], pts[n - 1]) };
  }
  const repaintRouted = () => { if (C.edges.some((e) => edgeStyle(e) === 'a-star')) C.edges.forEach((e) => { if (edgeStyle(e) === 'a-star') paintEdge(e); }); };
  const bez = (g, t) => { const u = 1 - t; return [0, 1].map((i) => u * u * u * g.p0[i] + 3 * u * u * t * g.c0[i] + 3 * u * t * t * g.c1[i] + t * t * t * g.p1[i]); };
  const toWorld = (cx, cy) => { const r = C.view.getBoundingClientRect(); return [(cx - r.left - C.v.x) / C.v.k, (cy - r.top - C.v.y) / C.v.k]; };
  const toScreen = (wx, wy) => [C.v.x + wx * C.v.k, C.v.y + wy * C.v.k];
  const bboxOf = (ids) => {
    let l = 1e12, t = 1e12, r = -1e12, b = -1e12, any = false;
    ids.forEach((id) => { const n = byId(id); if (!n) return; any = true; l = Math.min(l, n.x); t = Math.min(t, n.y); r = Math.max(r, n.x + n.width); b = Math.max(b, n.y + n.height); });
    return any ? { x: l, y: t, w: r - l, h: b - t } : null;
  };
  const inside = (n, g) => n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height;
  const nearestSide = (n, wx, wy) => { let best = 'right', bd = 1e12; for (const s of Object.keys(DIR)) { const a = anchor(n, s), d = Math.hypot(a[0] - wx, a[1] - wy); if (d < bd) { bd = d; best = s; } } return best; };
  const autoSides = (a, b) => { const dx = b.x + b.width / 2 - (a.x + a.width / 2), dy = b.y + b.height / 2 - (a.y + a.height / 2); return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ['right', 'left'] : ['left', 'right']) : (dy > 0 ? ['bottom', 'top'] : ['top', 'bottom']); };

  /* ---------- view ---------- */
  let raf = 0;
  function schedule() { if (raf || !C) return; raf = requestAnimationFrame(() => { raf = 0; if (C) { updateOverlay(); drawMini(); C.empty.hidden = C.nodes.length > 0; } }); }
  function applyView() {
    if (!C) return; const { x, y, k } = C.v;
    C.world.style.transform = `translate(${x}px,${y}px) scale(${k})`; C.world.style.setProperty('--k', k);
    C.gridEl.hidden = !C.grid; C.gridEl.style.backgroundSize = `${GRID * k}px ${GRID * k}px`; C.gridEl.style.backgroundPosition = `${x}px ${y}px`; C.gridEl.style.opacity = clamp(k * 1.5, .12, 1);
    C.view.classList.toggle('low', k < .5); C.view.classList.toggle('tiny', k < .2);
    C.zl.textContent = Math.round(k * 100) + '%'; C.eels.forEach(zones); schedule(); saveView();
  }
  function zoomAt(cx, cy, f) {
    const r = C.view.getBoundingClientRect(), px = cx - r.left, py = cy - r.top, k = clamp(C.v.k * f, .05, 3), g = k / C.v.k;
    C.v = { x: px - (px - C.v.x) * g, y: py - (py - C.v.y) * g, k }; applyView();
  }
  let anim = 0;
  function animateTo(v1, instant) {
    cancelAnimationFrame(anim); if (instant) { C.v = v1; applyView(); return; }
    const v0 = { ...C.v }, t0 = performance.now(), ms = 240;
    const step = (t) => { if (!C) return; const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3); C.v = { x: v0.x + (v1.x - v0.x) * e, y: v0.y + (v1.y - v0.y) * e, k: v0.k + (v1.k - v0.k) * e }; applyView(); if (p < 1) anim = requestAnimationFrame(step); };
    anim = requestAnimationFrame(step);
  }
  function fit(ids, maxK, instant) {
    const bb = bboxOf(ids && ids.size ? ids : C.nodes.map((n) => n.id)), r = C.view.getBoundingClientRect(); if (!r.width) return;
    if (!bb) { animateTo({ x: r.width / 2, y: r.height / 2, k: 1 }, instant); return; }
    const pad = 80, k = clamp(Math.min((r.width - pad * 2) / Math.max(bb.w, 1), (r.height - pad * 2) / Math.max(bb.h, 1)), .05, maxK || 1);
    animateTo({ x: r.width / 2 - (bb.x + bb.w / 2) * k, y: r.height / 2 - (bb.y + bb.h / 2) * k, k }, instant);
  }
  const centerWorld = () => { const r = C.view.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

  /* ---------- nodes ---------- */
  function makeEl(n) {
    const el = mk('div', 'cv-node t-' + n.type); el.dataset.id = n.id;
    el.innerHTML = '<div class="cv-head"></div><div class="cv-body"></div>' + (n.type === 'group' ? ['t', 'r', 'b', 'l'].map((s) => `<i class="gb gb-${s}"></i>`).join('') : '') +
      '<div class="cv-ports">' + ['top', 'right', 'bottom', 'left'].map((s) => `<i class="cv-port" data-s="${s}"></i>`).join('') + '</div>';
    const body = el.querySelector('.cv-body');
    if (n.type === 'text' || (n.type === 'file' && /\.md$/i.test(n.file || ''))) { body.dataset.card = n.id; wireEd(body); }
    C.els.set(n.id, el); C.meta.set(n.id, {}); C.nodeLayer.appendChild(el);
    return el;
  }
  function posNode(n) { const el = C.els.get(n.id); if (!el) return; el.style.transform = `translate(${n.x}px, ${n.y}px)`; el.style.width = n.width + 'px'; el.style.height = n.height + 'px'; }
  const nodeStyle = (n, k) => n.styleAttributes && n.styleAttributes[k];
  function setNodeStyle(k, v) {
    C.sel.forEach((id) => { const n = byId(id); if (!n) return; const sa = Object.assign({}, n.styleAttributes); if (v) sa[k] = v; else delete sa[k]; if (Object.keys(sa).length) n.styleAttributes = sa; else delete n.styleAttributes; paintNode(n); });
    commit(); schedule();
  }
  function stylePop(btn) {
    const n = byId([...C.sel][0]); if (!n) return; const nb = nodeStyle(n, 'border') === 'invisible', nt = nodeStyle(n, 'background') === 'transparent';
    popup(btn, `<div class="al-grid one"><button data-v="border">${nb ? '☐' : '☑'} Show border</button><button data-v="bg">${nt ? '☐' : '☑'} Solid background</button></div>`, (v) => { if (v === 'border') setNodeStyle('border', nb ? null : 'invisible'); else setNodeStyle('background', nt ? null : 'transparent'); stylePop(btn); });
  }
  function paintNode(n) {
    const el = C.els.get(n.id); if (!el) return; const m = C.meta.get(n.id), body = el.querySelector('.cv-body'), head = el.querySelector('.cv-head');
    posNode(n); const col = colorOf(n.color); if (col) el.style.setProperty('--c', col); else el.style.removeProperty('--c');
    el.classList.toggle('colored', !!col); el.classList.toggle('sel', C.sel.has(n.id));
    el.classList.toggle('no-border', nodeStyle(n, 'border') === 'invisible'); el.classList.toggle('no-bg', nodeStyle(n, 'background') === 'transparent');
    const editing = C.edit && C.edit.id === n.id;
    if (n.type === 'text') {
      const key = n.text || '';
      if (m.key !== key && !editing) { body.innerHTML = key.trim() ? fromMd(key) : ''; imgResolve(body); m.key = key; }
      el.classList.toggle('empty', !key.trim());
    } else if (n.type === 'group') { if (!el.classList.contains('lab-edit')) head.textContent = n.label || ''; }
    else if (n.type === 'link') {
      let host = n.url || '', rest = ''; try { const u = new URL(n.url); host = u.hostname.replace(/^www\./, ''); rest = (u.pathname + u.search).replace(/^\/$/, ''); } catch { /* keep raw */ }
      head.innerHTML = `<span class="ft">${qa(host)}</span><button class="cv-open" title="Open in your browser">↗</button>`; body.innerHTML = `<div class="cv-url">${qa(rest || n.url || '')}</div>`;
    } else if (n.type === 'file') paintFile(n, el, m, body, head, editing);
  }
  function paintFile(n, el, m, body, head, editing) {
    const f = n.file || '', name = f.split('/').pop();
    if (isImg(f)) {
      el.classList.add('is-img'); head.textContent = '';
      if (m.key !== f) {
        m.key = f; body.innerHTML = `<img draggable="false" src="${qa(fileUrl(f))}">`; const im = body.firstChild;
        im.onload = () => { m.ar = im.naturalWidth / (im.naturalHeight || 1); }; im.onerror = () => { body.innerHTML = `<div class="cv-miss">Image not found<small>${qa(f)}</small></div>`; };
      }
    } else if (/\.md$/i.test(f)) {
      head.innerHTML = `<span class="ft">${qa(name.replace(/\.md$/i, ''))}</span><button class="cv-open" title="Open this note in a tab">↗</button>`; body.dataset.owner = rel2abs(f);
      if (!editing) loadNote(n, body, m);
    } else {
      head.innerHTML = `<span class="ft">${qa(name)}</span>${/\.canvas$/i.test(f) ? '<button class="cv-open" title="Open this canvas">↗</button>' : ''}`;
      body.innerHTML = `<div class="cv-miss">${/\.canvas$/i.test(f) ? 'Canvas' : 'File'}<small>${qa(f)}</small></div>`;
    }
  }
  async function loadNote(n, body, m) {
    const abs = rel2abs(n.file), tt = S.tabs.find((x) => norm(x.path) === norm(abs));
    let text = tt ? tt.text : null;
    if (text == null) { try { text = await api.read(abs); } catch { text = null; } }
    if (!C || !C.els.has(n.id) || (C.edit && C.edit.id === n.id)) return;
    if (text == null) { m.text = null; body.innerHTML = `<div class="cv-miss">Note not found<small>${qa(n.file)}</small></div>`; m.key = '#missing'; return; }
    m.text = text;
    if (m.key !== text) { body.innerHTML = fromMd(text.length > 9000 ? text.slice(0, 9000) + '\n…' : text); imgResolve(body); m.key = text; }
  }
  function repaintAll() { C.nodes.forEach(paintNode); C.edges.forEach(paintEdge); }
  function reorderDom() { C.nodes.forEach((n) => { const el = C.els.get(n.id); if (el) C.nodeLayer.appendChild(el); }); }

  /* ---------- edges ---------- */
  const pt = (p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1);
  const arrow = (p, u) => { const L = 15, W = 7.5, pp = [-u[1], u[0]]; return [p, [p[0] - u[0] * L + pp[0] * W, p[1] - u[1] * L + pp[1] * W], [p[0] - u[0] * L - pp[0] * W, p[1] - u[1] * L - pp[1] * W]].map(pt).join(' '); };
  function paintEdge(e) {
    const rt = route(e); let el = C.eels.get(e.id);
    if (!rt) { if (el) { el.remove(); C.eels.delete(e.id); } return; }
    if (!el) { el = svg('g', { class: 'cv-edge' }); el.dataset.id = e.id; el.append(svg('path', { class: 'hit' }), svg('path', { class: 'line' }), svg('polygon', { class: 'ah a1' }), svg('polygon', { class: 'ah a0' }), svg('path', { class: 'endz', 'data-end': 'from' }), svg('path', { class: 'endz', 'data-end': 'to' }));
      el.children[4].appendChild(svg('title')).textContent = 'Drag this end to another card or side'; el.children[5].appendChild(svg('title')).textContent = 'Drag this end to another card or side'; C.edgeLayer.appendChild(el); C.eels.set(e.id, el); }
    const g = rt.g, [hit, line, a1, a0] = el.children;
    hit.setAttribute('d', rt.d); line.setAttribute('d', rt.d); el.children[4].setAttribute('d', rt.d); el.children[5].setAttribute('d', rt.d); el._L = line.getTotalLength ? line.getTotalLength() : 0; zones(el);
    a1.setAttribute('points', arrow(g.p1, rt.u1)); a1.style.display = e.toEnd === 'none' ? 'none' : '';
    a0.setAttribute('points', arrow(g.p0, rt.u0)); a0.style.display = e.fromEnd === 'arrow' ? '' : 'none';
    const col = colorOf(e.color); if (col) el.style.setProperty('--c', col); else el.style.removeProperty('--c');
    el.classList.toggle('colored', !!col); el.classList.toggle('sel', C.edge === e.id);
    let lb = C.lels.get(e.id);
    if (e.label) {
      if (!lb) { lb = mk('div', 'cv-elab'); lb.dataset.id = e.id; C.labelLayer.appendChild(lb); C.lels.set(e.id, lb); }
      lb.textContent = e.label; lb.style.left = rt.mid[0] + 'px'; lb.style.top = rt.mid[1] + 'px';
      if (col) lb.style.setProperty('--c', col); else lb.style.removeProperty('--c'); lb.classList.toggle('sel', C.edge === e.id);
    } else if (lb) { lb.remove(); C.lels.delete(e.id); }
  }
  /* the grab zones are the last ~46 screen pixels at each end of the arrow, so they keep their size when zooming */
  function zones(el) {
    const L = el._L || 0, a = el.children[4], b = el.children[5]; if (!L || !a) return; const seg = Math.min(46 / C.v.k, L * .4);
    a.style.strokeDasharray = `${seg} ${L + 10}`; b.style.strokeDasharray = `0 ${L - seg} ${seg} ${L + 10}`;
  }
  const edgesOf = (ids) => C.edges.filter((e) => ids.has(e.fromNode) || ids.has(e.toNode));
  function addEdge(from, fs, to, ts) {
    if (from === to) return null;
    if (C.edges.some((e) => e.fromNode === from && e.toNode === to && e.fromSide === fs && e.toSide === ts)) return null;
    const e = { id: rid(), fromNode: from, fromSide: fs, toNode: to, toSide: ts, toEnd: 'arrow' }; C.edges.push(e); paintEdge(e); return e;
  }

  /* ---------- selection ---------- */
  function select(ids, add) { if (!add) C.sel.clear(); ids.forEach((id) => C.sel.add(id)); C.edge = null; refreshSel(); }
  function selectEdge(id) { C.sel.clear(); C.edge = id; refreshSel(); }
  function refreshSel() { C.els.forEach((el, id) => el.classList.toggle('sel', C.sel.has(id))); C.eels.forEach((el, id) => el.classList.toggle('sel', C.edge === id)); C.lels.forEach((el, id) => el.classList.toggle('sel', C.edge === id)); C.toolsKey = ''; schedule(); }
  function updateOverlay() {
    if (!C) return;
    const ids = [...C.sel].filter((id) => byId(id)), bb = ids.length ? bboxOf(new Set(ids)) : null;
    if (bb) {
      const [sx, sy] = toScreen(bb.x, bb.y), w = bb.w * C.v.k, h = bb.h * C.v.k, st = C.selBox.style;
      st.left = sx + 'px'; st.top = sy + 'px'; st.width = w + 'px'; st.height = h + 'px'; C.selBox.hidden = false;
      C.selBox.classList.toggle('multi', ids.length > 1 || !!C.edit); C.selBox.classList.toggle('moving', !!(C.G && C.G.type === 'move' && C.G.moved));
    } else C.selBox.hidden = true;
    // while an arrow is hovered or selected, the connection dots at its two attachment points step out of the way
    C.els.forEach((el) => { if (el.dataset.hs) delete el.dataset.hs; });
    { const he = C.edge || C.hover, hed = he && !C.G && C.edges.find((x) => x.id === he);
      if (hed) [[hed.fromNode, hed.fromSide], [hed.toNode, hed.toSide]].forEach(([id, s]) => { const el = C.els.get(id); if (el) el.dataset.hs = ((el.dataset.hs || '') + ' ' + s).trim(); }); }
    // edge end handles
    C.ehWrap.innerHTML = '';
    let anchorPt = null;
    if (!C.G && C.edge) { const e = C.edges.find((x) => x.id === C.edge), rt = e && route(e); if (rt) { const m = toScreen(...rt.mid); anchorPt = [m[0], m[1] - 14]; } }
    if (!C.edge && bb && !(C.G && C.G.type === 'move' && C.G.moved) && !C.edit) { const [sx, sy] = toScreen(bb.x, bb.y); anchorPt = [sx + bb.w * C.v.k / 2, sy - 8]; }
    buildTools(ids, anchorPt);
  }
  function buildTools(ids, ap) {
    const t = C.tools; if (!ap || C.G && (C.G.type === 'move' || C.G.type === 'resize' || C.G.type === 'marquee' || C.G.type === 'conn')) { t.hidden = true; return; }
    const key = C.edge ? 'e:' + C.edge : 'n:' + ids.join(',');
    if (C.toolsKey !== key) {
      C.toolsKey = key; closePop();
      const b = (a, label, title) => `<button data-t="${a}" title="${title || label}">${label}</button>`;
      if (C.edge) t.innerHTML = b('color', '● Color') + b('line', 'Line') + b('dir', 'Arrows') + b('label', 'Label') + '<span class="sep"></span>' + b('del', 'Delete');
      else {
        const single = ids.length === 1 ? byId(ids[0]) : null;
        t.innerHTML = b('color', '● Color') + (single && (single.type === 'text' || (single.type === 'file' && /\.md$/i.test(single.file))) ? b('edit', 'Edit') : '') + (single && single.type === 'file' && /\.md$/i.test(single.file) ? b('open', 'Open') : '') +
          b('style', 'Style') + (ids.length > 1 ? b('align', 'Align') + b('group', 'Group') : '') + b('dup', 'Duplicate') + '<span class="sep"></span>' + b('del', 'Delete');
      }
    }
    t.hidden = false; const r = C.view.getBoundingClientRect(), w = t.offsetWidth || 200;
    t.style.left = clamp(ap[0] - w / 2, 8, r.width - w - 8) + 'px'; t.style.top = (ap[1] - 36 < 6 ? ap[1] + 56 : ap[1] - 36) + 'px';
  }

  /* ---------- pop-ups (colour, align, arrows) ---------- */
  function closePop() { C && C.view.querySelectorAll('.cv-pop').forEach((p) => p.remove()); }
  function popup(btn, html, on) {
    closePop(); const p = mk('div', 'cv-pop', html), r = C.view.getBoundingClientRect(), br = btn.getBoundingClientRect();
    p.style.left = clamp(br.left - r.left, 6, Math.max(6, r.width - 240)) + 'px'; p.style.top = Math.max(6, br.bottom - r.top + 6) + 'px'; p.onmousedown = (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); e.stopPropagation(); };
    p.onclick = (e) => { const el = e.target.closest('[data-v]'); if (el) { on(el.dataset.v); } };
    C.view.appendChild(p); return p;
  }
  function colorPop(btn) {
    const cur = C.edge ? (C.edges.find((e) => e.id === C.edge) || {}).color : (byId([...C.sel][0]) || {}).color, P = pal();
    const p = popup(btn, `<div class="sw-row">${Object.keys(P).map((k) => `<i class="sw${cur === k ? ' on' : ''}" data-v="${k}" style="--c:${P[k]}"></i>`).join('')}<i class="sw none" data-v="" title="No colour"></i></div><label class="sw-cu">Custom <input type="color" value="${/^#[0-9a-f]{6}$/i.test(cur || '') ? cur : '#d4b06a'}"></label>`, (v) => { setColor(v || null); closePop(); });
    p.querySelector('input').oninput = (e) => setColor(e.target.value);
  }
  function setColor(c) {
    if (C.edge) { const e = C.edges.find((x) => x.id === C.edge); if (e) { if (c) e.color = c; else delete e.color; paintEdge(e); } }
    else C.sel.forEach((id) => { const n = byId(id); if (n) { if (c) n.color = c; else delete n.color; paintNode(n); } });
    commit(true);
  }
  function alignPop(btn) {
    const B = (v, t) => `<button data-v="${v}">${t}</button>`;
    popup(btn, `<div class="al-grid">${B('l', 'Left')}${B('c', 'Centre')}${B('r', 'Right')}${B('t', 'Top')}${B('m', 'Middle')}${B('b', 'Bottom')}${B('dh', 'Space across')}${B('dv', 'Space down')}</div>`, (v) => { align(v); closePop(); });
  }
  function align(how) {
    const ns = [...C.sel].map(byId).filter((n) => n && n.type !== 'group' || (n && C.sel.size > 1)).filter(Boolean); if (ns.length < 2) return;
    const bb = bboxOf(new Set(ns.map((n) => n.id)));
    if (how === 'l') ns.forEach((n) => { n.x = bb.x; }); else if (how === 'r') ns.forEach((n) => { n.x = bb.x + bb.w - n.width; }); else if (how === 'c') ns.forEach((n) => { n.x = bb.x + (bb.w - n.width) / 2; });
    else if (how === 't') ns.forEach((n) => { n.y = bb.y; }); else if (how === 'b') ns.forEach((n) => { n.y = bb.y + bb.h - n.height; }); else if (how === 'm') ns.forEach((n) => { n.y = bb.y + (bb.h - n.height) / 2; });
    else if (how === 'dh' || how === 'dv') {
      const h = how === 'dh', s = [...ns].sort((a, b) => (h ? a.x - b.x : a.y - b.y)), tot = s.reduce((a, n) => a + (h ? n.width : n.height), 0), gap = ((h ? bb.w : bb.h) - tot) / (s.length - 1); let at = h ? bb.x : bb.y;
      s.forEach((n) => { if (h) n.x = at; else n.y = at; at += (h ? n.width : n.height) + gap; });
    }
    ns.forEach(posNode); edgesOf(new Set(ns.map((n) => n.id))).forEach(paintEdge); commit(); schedule();
  }
  function dirPop(btn) {
    const B = (v, t) => `<button data-v="${v}">${t}</button>`;
    popup(btn, `<div class="al-grid one">${B('to', 'Arrow at the end  →')}${B('from', 'Arrow at the start  ←')}${B('both', 'Arrows at both ends  ↔')}${B('none', 'No arrows  —')}</div>`, (v) => { setDir(v); closePop(); });
  }
  function setDir(v) {
    const e = C.edges.find((x) => x.id === C.edge); if (!e) return;
    e.toEnd = v === 'to' || v === 'both' ? 'arrow' : 'none'; if (v === 'from' || v === 'both') e.fromEnd = 'arrow'; else delete e.fromEnd; paintEdge(e); commit();
  }
  function setEdgeStyle(e, v) {
    const sa = Object.assign({}, e.styleAttributes); if (v === 'bezier' && C.pathing === 'bezier') delete sa.pathfindingMethod; else sa.pathfindingMethod = v;
    if (Object.keys(sa).length) e.styleAttributes = sa; else delete e.styleAttributes; paintEdge(e); commit(); schedule();
  }
  function setDefaultPath(v, all) {
    C.pathing = v; store.set('cv-path:' + C.tab.path, v);
    if (all) { C.edges.forEach((e) => { if (e.styleAttributes) { delete e.styleAttributes.pathfindingMethod; if (!Object.keys(e.styleAttributes).length) delete e.styleAttributes; } }); commit(); }
    C.edges.forEach(paintEdge); schedule();
  }
  function linesPop(btn) {
    const row = (v, t, cur) => `<button data-v="${v}"${cur ? ' class="on"' : ''}>${t}</button>`;
    popup(btn, `<div class="pp-h">Connection style for this canvas</div><div class="al-grid one">${PATHS.map(([v, t]) => row('def:' + v, t, v === C.pathing)).join('')}</div><div class="pp-h">Or restyle everything</div><div class="al-grid one">${PATHS.map(([v, t]) => row('all:' + v, 'Make every connection ' + t.split(' ')[0].toLowerCase())).join('')}</div>`, (v) => { const [k, s] = v.split(':'); setDefaultPath(s, k === 'all'); closePop(); });
  }
  function linePop(btn) {
    const e = C.edges.find((x) => x.id === C.edge); if (!e) return; const cur = edgeStyle(e);
    popup(btn, `<div class="al-grid one">${PATHS.map(([v, t]) => `<button data-v="${v}"${v === cur ? ' class="on"' : ''}>${t}</button>`).join('')}</div>`, (v) => { setEdgeStyle(e, v); closePop(); });
  }
  function editEdgeLabel(e) {
    const rt = route(e); if (!rt) return; closePop(); const [x, y] = toScreen(...rt.mid), i = mk('input', 'cv-lin'); i.value = e.label || ''; i.placeholder = 'Label'; i.style.left = x + 'px'; i.style.top = y + 'px';
    C.view.appendChild(i); i.focus(); i.select(); let done = false;
    const fin = (ok) => { if (done) return; done = true; if (ok) { const v = i.value.trim(); if (v) e.label = v; else delete e.label; paintEdge(e); commit(); } i.remove(); C.view.focus({ preventScroll: true }); };
    i.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); }; i.onblur = () => fin(true); i.onmousedown = (ev) => ev.stopPropagation();
  }

  /* ---------- creating / removing ---------- */
  function freeSpot(x, y) { let n = 0; while (C.nodes.some((o) => o.type !== 'group' && Math.abs(o.x - x) < 14 && Math.abs(o.y - y) < 14) && n++ < 40) { x += 28; y += 28; } return [x, y]; }
  function addNode(n, opt) {
    opt = opt || {}; fixNode(n); if (n.type !== 'group') [n.x, n.y] = freeSpot(n.x, n.y);
    if (n.type === 'group') C.nodes.unshift(n); else C.nodes.push(n);
    makeEl(n); if (n.type === 'group') C.nodeLayer.prepend(C.els.get(n.id)); paintNode(n); select([n.id]);
    if (opt.edit) { C.meta.get(n.id).fresh = true; startEdit(n.id); } else commit();
    return n;
  }
  const addText = (wx, wy) => { const p = wx == null ? centerWorld() : [wx, wy]; return addNode({ type: 'text', text: '', x: p[0] - 130, y: p[1] - 40, width: 260, height: 110 }, { edit: true }); };
  const addFile = (rel, p) => { const q = p || centerWorld(), md = /\.md$/i.test(rel), cv = /\.canvas$/i.test(rel); return addNode({ type: 'file', file: rel, x: q[0] - 170, y: q[1] - 120, width: md ? 340 : 280, height: md ? 260 : cv ? 90 : 200 }); };
  function addImageNode(rel, p, i) {
    const q = p || centerWorld(), probe = new Image();
    probe.onload = () => { if (!C) return; const w = Math.min(420, probe.naturalWidth || 320), h = Math.round(w * (probe.naturalHeight || 240) / (probe.naturalWidth || 320)); addNode({ type: 'file', file: rel, x: q[0] - w / 2 + (i || 0) * 28, y: q[1] - h / 2 + (i || 0) * 28, width: w, height: h }); };
    probe.onerror = () => { if (C) addNode({ type: 'file', file: rel, x: q[0] - 160, y: q[1] - 110, width: 320, height: 220 }); };
    probe.src = fileUrl(rel);
  }
  async function importImgs(files, p) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i], bytes = new Uint8Array(await f.arrayBuffer()), generic = !f.name || /^image\.\w+$/i.test(f.name), ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const rel = await api.imgSave(C.tab.path, generic ? `Pasted image ${stamp()}.${ext}` : f.name, bytes); if (rel && C) addImageNode(rel, p, i);
    }
  }
  async function pickImgs(p) { const rels = await api.imgPick(C.tab.path); rels.forEach((r, i) => addImageNode(r, p, i)); }
  function addLinkDlg(p) {
    gAsk({ title: 'Add a link', fields: [{ k: 'url', label: 'Web address', ph: 'https://…' }], ok: 'Add', cb: (v) => {
      let u = (v.url || '').trim(); if (!u) return false; if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
      const q = p || centerWorld(); addNode({ type: 'link', url: u, x: q[0] - 150, y: q[1] - 45, width: 300, height: 90 });
    } });
  }
  function noteDlg(p, cb) {
    const items = []; (function walk(ns) { ns.forEach((n) => { if (n.type === 'dir') walk(n.children); else if (norm(n.path) !== norm(C.tab.path)) items.push({ name: n.name, rel: abs2rel(n.path), canvas: n.kind === 'canvas' }); }); })(S.tree);
    const ov = mk('div', 't-modal'); ov.innerHTML = '<div class="t-card cv-pick"><h3>Add a note</h3><input class="f-in" placeholder="Search your notes and canvases" spellcheck="false"><div class="cv-plist"></div><div class="t-actions"><span></span><button data-a="x">Cancel</button></div></div>';
    const inp = ov.querySelector('input'), list = ov.querySelector('.cv-plist'); let shown = [];
    const draw = () => { const f = inp.value.trim().toLowerCase(); shown = items.filter((i) => !f || i.rel.toLowerCase().includes(f)).slice(0, 80); list.innerHTML = shown.map((i, k) => `<div class="cv-pi" data-k="${k}"><b>${qa(i.name)}</b><small>${qa(i.rel.includes('/') ? i.rel.slice(0, i.rel.lastIndexOf('/')) : '')}${i.canvas ? ' · canvas' : ''}</small></div>`).join('') || '<div class="empty">Nothing matches.</div>'; };
    const pick = (i) => { ov.remove(); if (i) (cb ? cb(i.rel) : addFile(i.rel, p)); };
    ov.onclick = (e) => { if (e.target === ov || e.target.dataset.a === 'x') ov.remove(); const r = e.target.closest('.cv-pi'); if (r) pick(shown[+r.dataset.k]); };
    inp.oninput = draw; inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') pick(shown[0]); if (e.key === 'Escape') ov.remove(); };
    document.body.appendChild(ov); draw(); inp.focus();
  }
  function groupSel() {
    const bb = bboxOf(C.sel); if (!bb || C.sel.size < 2) { const c = centerWorld(); return addNode({ type: 'group', label: 'Group', x: c[0] - 220, y: c[1] - 150, width: 440, height: 300 }); }
    return addNode({ type: 'group', label: 'Group', x: bb.x - 30, y: bb.y - 52, width: bb.w + 60, height: bb.h + 82 });
  }
  function removeSel() {
    if (C.edge) { const i = C.edges.findIndex((e) => e.id === C.edge); if (i >= 0) { C.edges.splice(i, 1); } C.eels.get(C.edge) && C.eels.get(C.edge).remove(); C.eels.delete(C.edge); C.lels.get(C.edge) && C.lels.get(C.edge).remove(); C.lels.delete(C.edge); C.edge = null; commit(); refreshSel(); return; }
    if (!C.sel.size) return; const ids = new Set(C.sel);
    C.edges.filter((e) => ids.has(e.fromNode) || ids.has(e.toNode)).forEach((e) => { C.eels.get(e.id) && C.eels.get(e.id).remove(); C.eels.delete(e.id); C.lels.get(e.id) && C.lels.get(e.id).remove(); C.lels.delete(e.id); });
    C.edges = C.edges.filter((e) => !ids.has(e.fromNode) && !ids.has(e.toNode)); C.nodes = C.nodes.filter((n) => !ids.has(n.id));
    ids.forEach((id) => { C.els.get(id).remove(); C.els.delete(id); C.meta.delete(id); }); C.sel.clear(); commit(); refreshSel();
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function copySel() { const ids = new Set(C.sel); if (!ids.size) return null; return { nodes: C.nodes.filter((n) => ids.has(n.id)).map(clone), edges: C.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode)).map(clone) }; }
  function pasteClip(clip, at) {
    const bb = (() => { let l = 1e12, t = 1e12; clip.nodes.forEach((n) => { l = Math.min(l, n.x); t = Math.min(t, n.y); }); return { l, t }; })(), map = new Map(), dx = at ? at[0] - bb.l : 36, dy = at ? at[1] - bb.t : 36, fresh = [];
    clip.nodes.forEach((o) => { const n = clone(o); map.set(o.id, n.id = rid()); n.x += dx; n.y += dy; if (n.type === 'group') C.nodes.unshift(n); else C.nodes.push(n); makeEl(n); if (n.type === 'group') C.nodeLayer.prepend(C.els.get(n.id)); paintNode(n); fresh.push(n.id); });
    clip.edges.forEach((o) => { const e = clone(o); e.id = rid(); e.fromNode = map.get(o.fromNode); e.toNode = map.get(o.toNode); C.edges.push(e); paintEdge(e); });
    select(fresh); commit();
  }

  /* ---------- editing ---------- */
  function startEdit(id) {
    const n = byId(id), el = C.els.get(id); if (!n || !el) return;
    if (n.type === 'group') { editGroup(n, el); return; }
    if (n.type === 'link') { gAsk({ title: 'Edit link', fields: [{ k: 'url', label: 'Web address', val: n.url }], ok: 'Save', cb: (v) => { const u = (v.url || '').trim(); if (!u) return false; n.url = /^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? u : 'https://' + u; paintNode(n); commit(); } }); return; }
    if (n.type === 'file' && !/\.md$/i.test(n.file || '')) { if (isImg(n.file)) lightbox(fileUrl(n.file)); else if (/\.canvas$/i.test(n.file)) openNote(rel2abs(n.file)); return; }
    if (C.edit && C.edit.id !== id) endEdit();
    const m = C.meta.get(id), body = el.querySelector('.cv-body'); C.edit = { id }; C.sel = new Set([id]); C.edge = null; refreshSel(); el.classList.add('editing');
    if (n.type === 'file') { const base = m.text == null ? '' : m.text; body.innerHTML = fromMd(base); m.base = base; } else body.innerHTML = n.text ? fromMd(n.text) : '<div><br></div>';
    imgResolve(body); body.contentEditable = 'true'; body.id = 'ed'; C.fmt.hidden = false; body.focus(); caret(body.lastElementChild || body, !body.textContent); S.range = null; schedule();
  }
  function endEdit() {
    if (!C || !C.edit) return; const id = C.edit.id, n = byId(id), el = C.els.get(id); C.edit = null;
    if (!n || !el) { C.fmt.hidden = true; return; }
    const body = el.querySelector('.cv-body'), m = C.meta.get(id); body.contentEditable = 'false'; body.removeAttribute('id'); el.classList.remove('editing'); C.fmt.hidden = true;
    if (n.type === 'text') {
      n.text = toMd(body); if (!n.text.trim() && m.fresh) { m.fresh = false; C.sel.delete(id); C.nodes = C.nodes.filter((x) => x !== n); el.remove(); C.els.delete(id); C.meta.delete(id); refreshSel(); return; }
      m.key = null; m.fresh = false; paintNode(n); commit();
    } else if (n.type === 'file') { const md = toMd(body); flushNote(n, md); m.key = null; m.text = md; paintNode(n); }
    schedule();
  }
  function editGroup(n, el) {
    const head = el.querySelector('.cv-head'); el.classList.add('lab-edit'); head.contentEditable = 'plaintext-only'; head.focus(); const r = document.createRange(); r.selectNodeContents(head); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const fin = (ok) => { head.removeEventListener('blur', onb); head.removeEventListener('keydown', onk); head.contentEditable = 'false'; el.classList.remove('lab-edit'); if (ok) { n.label = head.textContent.trim(); commit(); } paintNode(n); if (C) C.view.focus({ preventScroll: true }); };
    const onb = () => fin(true), onk = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); fin(true); } if (e.key === 'Escape') fin(false); };
    head.addEventListener('blur', onb); head.addEventListener('keydown', onk);
  }
  /* typing into a text card or a note card */
  window.cvCardChanged = (body) => {
    if (!C) return; const id = body.dataset.card, n = byId(id); if (!n) return; const md = toMd(body), m = C.meta.get(id);
    if (n.type === 'text') { n.text = md; m.key = md; grow(n, body); commit(true); }
    else if (n.type === 'file') { m.text = md; m.key = md; flushNoteSoon(n, md); }
  };
  function grow(n, body) { const need = Math.ceil(body.scrollHeight + 2); if (need > n.height) { n.height = need; posNode(n); edgesOf(new Set([n.id])).forEach(paintEdge); schedule(); } }
  function flushNoteSoon(n, md) {
    const path = rel2abs(n.file), s = C.saves.get(path) || {}; clearTimeout(s.t); s.path = path; s.md = md; s.t = setTimeout(() => { api.write(path, md); C.saves.delete(path); }, 500); C.saves.set(path, s);
    const tt = S.tabs.find((x) => norm(x.path) === norm(path)); if (tt) { tt.text = md; if (tt.hist) tt.hist.last = md; }
  }
  function flushNote(n, md) { const path = rel2abs(n.file), s = C.saves.get(path); if (s) { clearTimeout(s.t); C.saves.delete(path); } if (md !== (C.meta.get(n.id) || {}).base) { api.write(path, md); const tt = S.tabs.find((x) => norm(x.path) === norm(path)); if (tt) { tt.text = md; if (tt.hist) tt.hist.last = md; } } }

  /* ---------- snapping ---------- */
  let guides = [];
  function snapMove(bb, ids, free) {
    guides = []; if (free) return { dx: 0, dy: 0 };
    const thr = 7 / C.v.k, xs = [bb.x, bb.x + bb.w / 2, bb.x + bb.w], ys = [bb.y, bb.y + bb.h / 2, bb.y + bb.h]; let bx = null, by = null;
    for (const n of C.nodes) {
      if (ids.has(n.id) || n.type === 'group' && false) continue;
      const nx = [n.x, n.x + n.width / 2, n.x + n.width], ny = [n.y, n.y + n.height / 2, n.y + n.height];
      xs.forEach((a) => nx.forEach((b) => { const d = b - a; if (Math.abs(d) < thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: b, n }; }));
      ys.forEach((a) => ny.forEach((b) => { const d = b - a; if (Math.abs(d) < thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: b, n }; }));
    }
    let dx = bx ? bx.d : 0, dy = by ? by.d : 0;
    if (!bx && C.snap) dx = Math.round(bb.x / GRID) * GRID - bb.x; if (!by && C.snap) dy = Math.round(bb.y / GRID) * GRID - bb.y;
    if (bx) guides.push({ v: true, at: bx.at, a: Math.min(bb.y + dy, bx.n.y) - 24, b: Math.max(bb.y + dy + bb.h, bx.n.y + bx.n.height) + 24 });
    if (by) guides.push({ v: false, at: by.at, a: Math.min(bb.x + dx, by.n.x) - 24, b: Math.max(bb.x + dx + bb.w, by.n.x + by.n.width) + 24 });
    return { dx, dy };
  }
  /* live preview while connecting: a real arrow that follows the cursor. Moving an existing arrow fades the original and shows the new one in its colour/style. */
  function pvStart(G) {
    const base = G.edge ? { ...G.edge } : { fromNode: G.from, fromSide: G.side, toNode: '__free', toSide: 'left', toEnd: 'arrow' };
    delete base.label; base.id = '__pv'; G.pv = base;
    if (G.edge) { const el = C.eels.get(G.edge.id), lb = C.lels.get(G.edge.id); if (el) el.classList.add('moving'); if (lb) lb.classList.add('moving'); }
    pvUpdate(G);
  }
  function pvUpdate(G) {
    const pv = G.pv; if (!pv) return; const free = G.edge ? G.end : 'to', hot = G.hot, hn = hot && byId(hot.id); let p, d;
    if (hn) { p = anchor(hn, hot.side); d = DIR[hot.side]; }
    else { p = toWorld(G.x, G.y); const dx = G.anchor[0] - p[0], dy = G.anchor[1] - p[1]; d = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1]; }
    pv._free = { end: free, p, d }; if (free === 'from') pv.fromNode = '__free'; else pv.toNode = '__free';
    paintEdge(pv); const el = C.eels.get('__pv'); if (el) el.classList.add(G.edge ? 'repo' : 'pv');
  }
  function pvEnd(G) {
    const el = C.eels.get('__pv'); if (el) el.remove(); C.eels.delete('__pv'); G.pv = null;
    if (G.edge) { const e1 = C.eels.get(G.edge.id), lb = C.lels.get(G.edge.id); if (e1) e1.classList.remove('moving'); if (lb) lb.classList.remove('moving'); }
  }
  function drawOv() {
    C.ov.innerHTML = '';
    guides.forEach((g) => { const [x0, y0] = g.v ? toScreen(g.at, g.a) : toScreen(g.a, g.at), [x1, y1] = g.v ? toScreen(g.at, g.b) : toScreen(g.b, g.at); C.ov.appendChild(svg('line', { class: 'gl', x1: x0, y1: y0, x2: x1, y2: y1 })); });
  }

  /* ---------- pointer gestures ---------- */
  function wire() {
    const V = C.view, on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); C.off.push(() => t.removeEventListener(ev, fn, o)); };
    const cap = (e) => { try { V.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
    const rel = (e) => { const r = V.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    on(V, 'pointerdown', (e) => {
      const t = e.target; if (t.closest('.cv-seltools, .cv-pop, .cv-find, .cv-minimap, .cv-lin')) return; if (!t.closest('.cv-pop')) closePop();
      if (e.button === 2) return;
      if (!C.edit) { const s = getSelection(); if (s && s.rangeCount) s.removeAllRanges(); }
      const ne0 = t.closest('.cv-node'); if (C.edit && ne0 && ne0.dataset.id === C.edit.id) return; if (C.edit) endEdit();
      if (!t.closest('.box, .rsz, .fold-c')) V.focus({ preventScroll: true });
      if (e.button === 1 || C.tool === 'hand' || C.space) { e.preventDefault(); C.G = { type: 'pan', cx: e.clientX, cy: e.clientY, v: { ...C.v } }; V.classList.add('panning'); cap(e); return; }
      const port = t.closest('.cv-port'), ez = t.closest('.endz'), rh = t.closest('.cv-rh');
      if (port) {
        const id = port.closest('.cv-node').dataset.id; select([id]); C.fast = true;
        C.G = { type: 'conn', from: id, side: port.dataset.s, anchor: anchor(byId(id), port.dataset.s), x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, hot: null, moved: false }; pvStart(C.G); cap(e); e.preventDefault(); return;
      }
      if (ez) {
        const ed = C.edges.find((x) => x.id === ez.parentNode.dataset.id); if (!ed) return; C.sel.clear(); C.edge = ed.id; C.hover = null; refreshSel(); C.fast = true;
        const fixed = ez.dataset.end === 'from' ? ['toNode', 'toSide'] : ['fromNode', 'fromSide'];
        C.G = { type: 'conn', edge: ed, end: ez.dataset.end, from: ed[fixed[0]], side: ed[fixed[1]], anchor: anchor(byId(ed[fixed[0]]), ed[fixed[1]]), x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, hot: null, moved: false }; pvStart(C.G); cap(e); e.preventDefault(); return;
      }
      if (rh) { const n = byId([...C.sel][0]); if (!n) return; C.fast = true; C.G = { type: 'resize', id: n.id, h: rh.dataset.h, r0: { x: n.x, y: n.y, w: n.width, h: n.height }, cx: e.clientX, cy: e.clientY, lock: n.type === 'file' && isImg(n.file) }; cap(e); e.preventDefault(); return; }
      if (ne0) {
        const id = ne0.dataset.id; if (t.closest('.cv-open, .box, .rsz, .fold-c')) { if (!C.sel.has(id)) select([id]); return; }
        if (e.shiftKey || e.ctrlKey || e.metaKey) { if (C.sel.has(id)) { C.sel.delete(id); refreshSel(); return; } select([id], true); }
        else if (!C.sel.has(id)) select([id]);
        startMove(e, id); cap(e); return;
      }
      const eg = t.closest('.cv-edge, .cv-elab'); if (eg) { selectEdge(eg.dataset.id); return; }
      if (!e.shiftKey) { C.sel.clear(); C.edge = null; refreshSel(); }
      const [rx, ry] = rel(e); C.G = { type: 'marquee', x0: rx, y0: ry, base: new Set(C.sel) }; cap(e);
    });
    on(V, 'pointermove', (e) => {
      C.mouse = [e.clientX, e.clientY]; const G = C.G;
      if (!G) {
        { const wp = toWorld(e.clientX, e.clientY), m = 30 / C.v.k; let hn = null, gh = null;
          for (let i = C.nodes.length - 1; i >= 0; i--) { const n = C.nodes[i]; if (wp[0] > n.x - m && wp[0] < n.x + n.width + m && wp[1] > n.y - m && wp[1] < n.y + n.height + m) { if (n.type === 'group') gh = gh || n.id; else { hn = n.id; break; } } }
          hn = hn || gh; if (hn !== C.hn) { const o = C.hn && C.els.get(C.hn), nn = hn && C.els.get(hn); if (o) o.classList.remove('hov'); if (nn) nn.classList.add('hov'); C.hn = hn; } }
        const he = e.target.closest && e.target.closest('.cv-edge, .cv-elab'), id = he ? he.dataset.id : null;
        if (id) { clearTimeout(C.hT); C.hT = 0; if (id !== C.hover) { C.hover = id; schedule(); } }
        else if (C.hover && !C.hT) C.hT = setTimeout(() => { C.hT = 0; if (C) { C.hover = null; schedule(); } }, 250);
        return;
      }
      if (e.buttons === 0 && e.pointerType !== 'touch') { up(e); return; }            // the button was released somewhere we did not hear about
      if (G.type === 'pan') { C.v = { ...C.v, x: G.v.x + e.clientX - G.cx, y: G.v.y + e.clientY - G.cy }; applyView(); }
      else if (G.type === 'move') moveTo(e);
      else if (G.type === 'resize') resizeTo(e);
      else if (G.type === 'marquee') marquee(e);
      else if (G.type === 'conn') { G.x = e.clientX; G.y = e.clientY; if (Math.hypot(e.clientX - G.sx, e.clientY - G.sy) > 4) G.moved = true; connHot(e); pvUpdate(G); }
    });
    const up = (e) => {
      const G = C.G; if (!G) return; C.G = null; V.classList.remove('panning'); try { V.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (G.type === 'move') { C.fast = false; if (G.moved) { repaintRouted(); commit(); } else if (G.collapse) select([G.id]); guides = []; drawOv(); }
      else if (G.type === 'resize') { C.fast = false; repaintRouted(); commit(); }
      else if (G.type === 'marquee') { C.marq.hidden = true; }
      else if (G.type === 'conn') { pvEnd(G); C.fast = false; connEnd(G, e); repaintRouted(); }
      C.ov.innerHTML = ''; C.view.querySelectorAll('.cv-port.hot, .cv-node.target').forEach((p) => p.classList.remove('hot', 'target')); C.view.classList.remove('connecting'); C.toolsKey = ''; schedule();
    };
    on(V, 'pointerup', up); on(V, 'pointercancel', up); on(V, 'lostpointercapture', (e) => { if (C && C.G) up(e); });
    on(V, 'pointerleave', () => { if (C && !C.G) { if (C.hn) { const o = C.els.get(C.hn); if (o) o.classList.remove('hov'); C.hn = null; } if (C.hover) { C.hover = null; schedule(); } } });
    // no browser text-selection or drag-and-drop ghost while working on the board (typing in a card still works)
    on(V, 'dragstart', (e) => { if (!e.target.closest || !e.target.closest('.cv-node.editing .cv-body')) e.preventDefault(); });
    on(V, 'mousedown', (e) => { if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')) return; e.preventDefault(); });
    on(V, 'dblclick', (e) => {
      const t = e.target; if (t.closest('.cv-seltools, .cv-pop, .cv-find, .cv-minimap, .cv-lin')) return;
      const ne = t.closest('.cv-node'), le = t.closest('.cv-edge, .cv-elab');
      if (le) { const ed = C.edges.find((x) => x.id === le.dataset.id); if (ed) editEdgeLabel(ed); return; }
      if (ne) {
        const n = byId(ne.dataset.id); if (!n || t.closest('.imgb')) return; if (n.type === 'link') { api.openExternal(n.url); return; }
        if (n.type === 'group') { if (t.closest('.cv-head, .gb')) startEdit(n.id); else { const [wx, wy] = toWorld(e.clientX, e.clientY); addText(wx, wy); } return; }
        startEdit(n.id); return;
      }
      const [wx, wy] = toWorld(e.clientX, e.clientY); addText(wx, wy);
    });
    on(V, 'click', (e) => {
      const o = e.target.closest('.cv-open'), tb = e.target.closest('[data-t]');
      if (o) { const n = byId(o.closest('.cv-node').dataset.id); if (!n) return; if (n.type === 'link') api.openExternal(n.url); else if (n.file) openNote(rel2abs(n.file)); return; }
      if (tb) toolAct(tb.dataset.t, tb);
    });
    on(V, 'contextmenu', ctxMenu);
    on(V, 'wheel', (e) => {
      const sc = e.target.closest && e.target.closest('.cv-node.sel .cv-body'); if (sc && !e.ctrlKey && sc.scrollHeight > sc.clientHeight + 2 && !C.edit) { return; }
      if (e.target.closest('.cv-plist, .cv-pop, .cv-find')) return;
      if (C.edit && e.target.closest('.cv-node.editing')) { const b = e.target.closest('.cv-body'); if (b && b.scrollHeight > b.clientHeight + 2) return; }
      e.preventDefault(); cancelAnimationFrame(anim);
      if (e.shiftKey && !e.ctrlKey) { C.v = { ...C.v, x: C.v.x - e.deltaY }; applyView(); return; }
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0013)));
    }, { passive: false });
    on(V, 'keydown', onKey); on(V, 'keyup', (e) => { if (e.key === ' ') { C.space = false; V.classList.remove('hand'); } });
    on(V, 'copy', (e) => { if (C.edit) return; const c = copySel(); if (!c) return; e.preventDefault(); C.clip = c; const one = c.nodes.length === 1 && c.nodes[0].type === 'text' ? c.nodes[0].text : ''; C.clipMark = one || 'sp-canvas:' + Date.now(); e.clipboardData.setData('text/plain', C.clipMark); });
    on(V, 'cut', (e) => { if (C.edit) return; const c = copySel(); if (!c) return; e.preventDefault(); C.clip = c; C.clipMark = 'sp-canvas:' + Date.now(); e.clipboardData.setData('text/plain', C.clipMark); removeSel(); });
    on(V, 'paste', (e) => {
      if (C.edit) return; e.preventDefault(); const cd = e.clipboardData, files = imgFiles(cd), text = (cd.getData('text/plain') || '').trim(), at = C.mouse ? toWorld(...C.mouse) : centerWorld(), r = V.getBoundingClientRect();
      const p = at[0] * C.v.k + C.v.x > 0 && at[0] * C.v.k + C.v.x < r.width ? at : centerWorld();
      if (files.length && !text) importImgs(files, p);
      else if (C.clip && text === C.clipMark) pasteClip(C.clip, [p[0] - 40, p[1] - 30]);
      else if (/^https?:\/\/\S+$/i.test(text)) addNode({ type: 'link', url: text, x: p[0] - 150, y: p[1] - 45, width: 300, height: 90 });
      else if (text) addNode({ type: 'text', text, x: p[0] - 130, y: p[1] - 40, width: 280, height: Math.min(420, 56 + 22 * Math.ceil(text.length / 38)) });
    });
    on(V, 'dragover', (e) => { if (e.dataTransfer && (imgFiles(e.dataTransfer).length || [...(e.dataTransfer.types || [])].some((t) => t === 'text/plain' || t === 'Files'))) { e.preventDefault(); V.classList.add('dropping'); } });
    on(V, 'dragleave', (e) => { if (!V.contains(e.relatedTarget)) V.classList.remove('dropping'); });
    on(V, 'drop', (e) => {
      V.classList.remove('dropping'); e.preventDefault(); const p = toWorld(e.clientX, e.clientY), files = imgFiles(e.dataTransfer);
      if (files.length) { importImgs(files, p); return; }
      const txt = (e.dataTransfer.getData('text/plain') || '').trim(); if (!txt) return;
      if (norm(txt).startsWith(norm(S.root) + '/')) { if (/\.(md|canvas)$/i.test(txt) && norm(txt) !== norm(C.tab.path)) addFile(abs2rel(txt), p); return; }
      if (/^https?:\/\/\S+$/i.test(txt)) addNode({ type: 'link', url: txt, x: p[0] - 150, y: p[1] - 45, width: 300, height: 90 }); else addNode({ type: 'text', text: txt, x: p[0] - 130, y: p[1] - 40, width: 280, height: 120 });
    });
    // toolbar
    on(C.bar, 'mousedown', (e) => { if (e.target.closest('button') && !e.target.closest('input')) e.preventDefault(); });
    const barAct = (a, b) => {
      const r = C.view.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (a === 'tool-select' || a === 'tool-hand') setTool(a === 'tool-hand' ? 'hand' : 'select');
      else if (a === 'add-text') addText(); else if (a === 'add-note') noteDlg(); else if (a === 'add-img') pickImgs(); else if (a === 'add-link') addLinkDlg(); else if (a === 'add-group') groupSel();
      else if (a === 'zin') zoomAt(cx, cy, 1.25); else if (a === 'zout') zoomAt(cx, cy, .8); else if (a === 'z100') animateTo({ x: C.v.x + (cx - r.left - C.v.x) * (1 - 1 / C.v.k), y: C.v.y + (cy - r.top - C.v.y) * (1 - 1 / C.v.k), k: 1 });
      else if (a === 'fit') fit(null, 1); else if (a === 'find') openFind(); else if (a === 'lines') linesPop(b);
      else if (a === 'snap') { C.snap = !C.snap; store.set('cv-snap', C.snap); C.bar.querySelectorAll('[data-a=snap]').forEach((x) => x.classList.toggle('on', C.snap)); }
      else if (a === 'grid') { C.grid = !C.grid; store.set('cv-grid:' + C.tab.path, C.grid); C.bar.querySelectorAll('[data-a=grid]').forEach((x) => x.classList.toggle('on', C.grid)); applyView(); }
      else if (a === 'mini') { C.mini = !C.mini; store.set('cv-mini', C.mini); C.bar.querySelectorAll('[data-a=mini]').forEach((x) => x.classList.toggle('on', C.mini)); C.miniCv.hidden = !C.mini; schedule(); }
      else if (a === 'addmenu') popup(b, '<div class="al-grid one"><button data-v="add-text">New text card</button><button data-v="add-note">Add a note…</button><button data-v="add-img">Add pictures…</button><button data-v="add-link">Add a link…</button><button data-v="add-group">Group / new group</button></div>', (v) => { closePop(); barAct(v, b); });
      else if (a === 'moremenu') popup(b, `<div class="al-grid one"><button data-v="find">Search this canvas</button><button data-v="lines">Connection style…</button><button data-v="grid">Background grid: ${C.grid ? 'on' : 'off'}</button><button data-v="snap">Snap to grid: ${C.snap ? 'on' : 'off'}</button><button data-v="mini">Mini-map: ${C.mini ? 'on' : 'off'}</button></div>`, (v) => { closePop(); barAct(v, b); });
    };
    on(C.bar, 'click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.c) { if (b.dataset.c === 'table') { e.stopPropagation(); tablePicker(b); } else if (b.dataset.c === 'image') pickImages($('ed')); else if (b.dataset.c === 'hr') insertDivider($('ed')); else if (b.dataset.c === 'fold') foldDialog($('ed'), b); else cmd(b.dataset.c); return; }
      barAct(b.dataset.a, b);
    });
    const ti = C.bar.querySelector('.cv-title'); ti.onkeydown = (e) => { if (e.key === 'Enter') ti.blur(); }; ti.onblur = () => { if (ti.value.trim() && ti.value.trim() !== C.tab.name) renameTab(C.tab, ti.value); else ti.value = C.tab.name; };
    // find
    const fi = C.find.querySelector('input'); fi.oninput = () => runFind(); fi.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') stepFind(e.shiftKey ? -1 : 1); if (e.key === 'Escape') closeFind(); };
    // minimap
    let mdrag = false; const mm = (e) => { const T = C.miniT; if (!T) return; const rr = C.miniCv.getBoundingClientRect(), px = (e.clientX - rr.left) * (C.miniCv.width / rr.width), py = (e.clientY - rr.top) * (C.miniCv.height / rr.height), wx = (px - T.ox) / T.s, wy = (py - T.oy) / T.s, vr = V.getBoundingClientRect(); C.v = { ...C.v, x: vr.width / 2 - wx * C.v.k, y: vr.height / 2 - wy * C.v.k }; applyView(); };
    on(C.miniCv, 'pointerdown', (e) => { mdrag = true; C.miniCv.setPointerCapture(e.pointerId); mm(e); }); on(C.miniCv, 'pointermove', (e) => { if (mdrag) mm(e); }); on(C.miniCv, 'pointerup', () => { mdrag = false; });
    const ro = new ResizeObserver(() => schedule()); ro.observe(V); C.off.push(() => ro.disconnect());
    // formatting buttons keep the card focused
    on(C.fmt, 'mousedown', (e) => { if (e.target.tagName !== 'SELECT') e.preventDefault(); });
  }
  function setTool(t) { C.tool = t; C.view.classList.toggle('hand', t === 'hand'); C.bar.querySelectorAll('[data-a^=tool-]').forEach((b) => b.classList.toggle('on', b.dataset.a === 'tool-' + t)); }

  function startMove(e, id) {
    const ids = new Set(C.sel);
    [...ids].forEach((gid) => { const g = byId(gid); if (g && g.type === 'group') C.nodes.forEach((n) => { if (n.id !== gid && inside(n, g)) ids.add(n.id); }); });
    C.fast = true; C.G = { type: 'move', ids, id, start: new Map([...ids].map((i) => [i, { x: byId(i).x, y: byId(i).y }])), cx: e.clientX, cy: e.clientY, bb: bboxOf(ids), moved: false, collapse: C.sel.size > 1 && !e.shiftKey && !e.ctrlKey };
  }
  function moveTo(e) {
    const G = C.G; if (!G.moved && Math.hypot(e.clientX - G.cx, e.clientY - G.cy) < 3) return; G.moved = true;
    const k = C.v.k, dx0 = (e.clientX - G.cx) / k, dy0 = (e.clientY - G.cy) / k, s = snapMove({ x: G.bb.x + dx0, y: G.bb.y + dy0, w: G.bb.w, h: G.bb.h }, G.ids, e.altKey), dx = dx0 + s.dx, dy = dy0 + s.dy;
    G.ids.forEach((id) => { const n = byId(id), st = G.start.get(id); n.x = st.x + dx; n.y = st.y + dy; posNode(n); }); edgesOf(G.ids).forEach(paintEdge); drawOv(); schedule();
  }
  function resizeTo(e) {
    const G = C.G, n = byId(G.id), k = C.v.k, dx = (e.clientX - G.cx) / k, dy = (e.clientY - G.cy) / k, h = G.h, r0 = G.r0, MINW = n.type === 'group' ? 120 : 80, MINH = n.type === 'group' ? 80 : 40;
    let x = r0.x, y = r0.y, w = r0.w, hh = r0.h;
    if (h.includes('e')) w = r0.w + dx; if (h.includes('s')) hh = r0.h + dy; if (h.includes('w')) { w = r0.w - dx; } if (h.includes('n')) { hh = r0.h - dy; }
    const free = e.altKey, corner = h.length === 2;
    if (corner && (G.lock !== e.shiftKey)) { const f = Math.max(w / r0.w, hh / r0.h); w = r0.w * f; hh = r0.h * f; }
    if (C.snap && !free && !(corner && (G.lock !== e.shiftKey))) {
      const rx = h.includes('w') ? r0.x + r0.w - w : r0.x, ry = h.includes('n') ? r0.y + r0.h - hh : r0.y;
      if (h.includes('e')) w = Math.round((rx + w) / GRID) * GRID - rx; if (h.includes('w')) w = r0.x + r0.w - Math.round((r0.x + r0.w - w) / GRID) * GRID;
      if (h.includes('s')) hh = Math.round((ry + hh) / GRID) * GRID - ry; if (h.includes('n')) hh = r0.y + r0.h - Math.round((r0.y + r0.h - hh) / GRID) * GRID;
    }
    w = Math.max(MINW, w); hh = Math.max(MINH, hh);
    if (h.includes('w')) x = r0.x + r0.w - w; if (h.includes('n')) y = r0.y + r0.h - hh;
    n.x = x; n.y = y; n.width = w; n.height = hh; posNode(n); edgesOf(new Set([n.id])).forEach(paintEdge); schedule();
  }
  function marquee(e) {
    const G = C.G, [rx, ry] = [e.clientX - C.view.getBoundingClientRect().left, e.clientY - C.view.getBoundingClientRect().top], l = Math.min(G.x0, rx), t = Math.min(G.y0, ry), w = Math.abs(rx - G.x0), h = Math.abs(ry - G.y0), s = C.marq.style;
    if (w + h < 4) return; C.marq.hidden = false; s.left = l + 'px'; s.top = t + 'px'; s.width = w + 'px'; s.height = h + 'px';
    const a = [(l - C.v.x) / C.v.k, (t - C.v.y) / C.v.k], b = [(l + w - C.v.x) / C.v.k, (t + h - C.v.y) / C.v.k], hit = new Set(G.base);
    C.nodes.forEach((n) => { const ov = n.x < b[0] && n.x + n.width > a[0] && n.y < b[1] && n.y + n.height > a[1]; if (n.type === 'group' ? (n.x >= a[0] && n.y >= a[1] && n.x + n.width <= b[0] && n.y + n.height <= b[1]) : ov) hit.add(n.id); });
    C.sel = hit; C.edge = null; C.els.forEach((el, id) => el.classList.toggle('sel', hit.has(id))); schedule();
  }
  function connHot(e) {
    const G = C.G; C.view.classList.add('connecting'); C.view.querySelectorAll('.cv-port.hot, .cv-node.target').forEach((p) => p.classList.remove('hot', 'target')); G.hot = null;
    const els = document.elementsFromPoint(e.clientX, e.clientY), ne = els.map((x) => x.closest && x.closest('.cv-node')).find((x) => x && x.dataset.id !== G.from);
    if (!ne) return; const n = byId(ne.dataset.id), [wx, wy] = toWorld(e.clientX, e.clientY); if (!n) return;
    const side = nearestSide(n, wx, wy); G.hot = { id: n.id, side }; ne.classList.add('target'); const p = ne.querySelector(`.cv-port[data-s=${side}]`); if (p) p.classList.add('hot');
  }
  function connEnd(G, e) {
    if (G.edge) {
      if (!G.moved && !G.hot) { selectEdge(G.edge.id); return; }
      if (G.hot) { if (G.end === 'from') { G.edge.fromNode = G.hot.id; G.edge.fromSide = G.hot.side; } else { G.edge.toNode = G.hot.id; G.edge.toSide = G.hot.side; } paintEdge(G.edge); commit(); }
      return;
    }
    if (G.hot) { const ed = addEdge(G.from, G.side, G.hot.id, G.hot.side); if (ed) { selectEdge(ed.id); commit(); } return; }
    if (!G.moved) return;
    const [wx, wy] = toWorld(e.clientX, e.clientY), from = G.from, side = G.side, oside = OPP[side];
    const place = (w, h) => { const o = { top: [wx - w / 2, wy], bottom: [wx - w / 2, wy - h], left: [wx, wy - h / 2], right: [wx - w, wy - h / 2] }[oside]; return o; };
    const hook = (nn) => { const ed = addEdge(from, side, nn.id, oside); if (ed) commit(); };
    ctxAt(e, [['New text card', () => { const [x, y] = place(260, 110); const nn = addNode({ type: 'text', text: '', x, y, width: 260, height: 110 }, { edit: true }); addEdge(from, side, nn.id, oside); paintEdge(C.edges[C.edges.length - 1]); }],
      ['Existing note…', () => noteDlg(null, (rel) => { const [x, y] = place(340, 260); const nn = addNode({ type: 'file', file: rel, x, y, width: 340, height: 260 }); hook(nn); })],
      ['New group', () => { const [x, y] = place(360, 240); const nn = addNode({ type: 'group', label: 'Group', x, y, width: 360, height: 240 }); hook(nn); }]]);
  }
  /* ---------- selection toolbar + context menu + keys ---------- */
  function toolAct(a, btn) {
    if (a === 'color') colorPop(btn); else if (a === 'align') alignPop(btn); else if (a === 'dir') dirPop(btn); else if (a === 'line') linePop(btn); else if (a === 'style') stylePop(btn);
    else if (a === 'del') removeSel(); else if (a === 'dup') { const c = copySel(); if (c) pasteClip(c); }
    else if (a === 'group') groupSel(); else if (a === 'edit') startEdit([...C.sel][0]);
    else if (a === 'open') { const n = byId([...C.sel][0]); if (n && n.file) openNote(rel2abs(n.file)); }
    else if (a === 'label') { const e = C.edges.find((x) => x.id === C.edge); if (e) editEdgeLabel(e); }
  }
  function ctxMenu(e) {
    e.preventDefault(); if (e.target.closest('.cv-seltools, .cv-pop')) return;
    if (C.edit && e.target.closest('.cv-node.editing')) { const c = e.target.closest('td,th'); if (c) tableMenu(e, c); return; }
    const ne = e.target.closest('.cv-node'), le = e.target.closest('.cv-edge, .cv-elab'), p = toWorld(e.clientX, e.clientY), items = [];
    if (le) {
      selectEdge(le.dataset.id); const ed = C.edges.find((x) => x.id === le.dataset.id);
      items.push(['Edit label', () => editEdgeLabel(ed)], ...PATHS.map(([v, t]) => ['Line: ' + t.split(' ')[0], () => setEdgeStyle(ed, v)]), null, ['Arrow at the end', () => setDir('to')], ['Arrows at both ends', () => setDir('both')], ['No arrows', () => setDir('none')], null, ['Delete connection', () => removeSel(), 'danger']);
    } else if (ne) {
      const n = byId(ne.dataset.id); if (!C.sel.has(n.id)) select([n.id]);
      if (n.type === 'text' || (n.type === 'file' && /\.md$/i.test(n.file))) items.push([n.type === 'file' ? 'Edit note here' : 'Edit card', () => startEdit(n.id)]);
      if (n.type === 'group') items.push(['Rename group', () => startEdit(n.id)]);
      if (n.type === 'file' && /\.(md|canvas)$/i.test(n.file)) items.push(['Open in a tab', () => openNote(rel2abs(n.file))]);
      if (n.type === 'file' && isImg(n.file)) items.push(['View full size', () => lightbox(fileUrl(n.file))], ['Show in folder', () => api.showInFolder(n.file)]);
      if (n.type === 'link') items.push(['Open link', () => api.openExternal(n.url)], ['Edit address', () => startEdit(n.id)]);
      const hasB = nodeStyle(n, 'border') !== 'invisible', hasT = nodeStyle(n, 'background') === 'transparent';
      items.push(null, [hasB ? 'Hide border' : 'Show border', () => setNodeStyle('border', hasB ? 'invisible' : null)], [hasT ? 'Solid background' : 'Transparent background', () => setNodeStyle('background', hasT ? null : 'transparent')], ['Colour…', () => { const b = C.tools.querySelector('[data-t=color]'); if (b) colorPop(b); }], ['Duplicate', () => { const c = copySel(); if (c) pasteClip(c); }]);
      if (C.sel.size > 1) items.push(['Group selection', () => groupSel()]);
      items.push(['Bring to front', () => zOrder(true)], ['Send to back', () => zOrder(false)], null, [C.sel.size > 1 ? `Delete ${C.sel.size} cards` : 'Delete', () => removeSel(), 'danger']);
    } else {
      items.push(['New text card here', () => addText(p[0], p[1])], ['Add note…', () => noteDlg(p)], ['Add image…', () => pickImgs(p)], ['Add link…', () => addLinkDlg(p)], ['New group here', () => addNode({ type: 'group', label: 'Group', x: p[0] - 200, y: p[1] - 130, width: 400, height: 260 })], null);
      if (C.clip) items.push(['Paste', () => pasteClip(C.clip, [p[0], p[1]])]);
      items.push(['Select all', () => select(C.nodes.map((n) => n.id))], ['Fit to content', () => fit(null, 1)]);
    }
    ctxAt(e, items);
  }
  function zOrder(front) {
    const ids = new Set(C.sel), picked = C.nodes.filter((n) => ids.has(n.id)), rest = C.nodes.filter((n) => !ids.has(n.id)); C.nodes = front ? [...rest, ...picked] : [...picked, ...rest]; reorderDom(); commit();
  }
  function onKey(e) {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (C.G && e.key === 'Escape') { const G = C.G; C.G = null; if (G.type === 'conn') { pvEnd(G); C.fast = false; } else if (G.type === 'move') { G.start.forEach((s, id) => { const n = byId(id); n.x = s.x; n.y = s.y; posNode(n); }); C.fast = false; repaintRouted(); } C.marq.hidden = true; C.ov.innerHTML = ''; guides = []; C.view.classList.remove('connecting', 'panning'); schedule(); return; }
    if (C.edit) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endEdit(); C.view.focus({ preventScroll: true }); } return; }
    if (e.target.closest && e.target.closest('.cv-node.lab-edit')) return;
    const k = e.key, lk = k.toLowerCase(), ctrl = e.ctrlKey || e.metaKey, r = C.view.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (k === ' ') { e.preventDefault(); if (!C.space) { C.space = true; C.view.classList.add('hand'); } return; }
    if (ctrl && lk === 'a') { e.preventDefault(); select(C.nodes.map((n) => n.id)); }
    else if (ctrl && lk === 'd') { e.preventDefault(); const c = copySel(); if (c) pasteClip(c); }
    else if (ctrl && lk === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else groupSel(); }
    else if (ctrl && lk === 'f') { e.preventDefault(); openFind(); }
    else if (ctrl && k === '0') { e.preventDefault(); fit(null, 1); }
    else if (ctrl && k === '1') { e.preventDefault(); animateTo({ x: C.v.x + (cx - r.left - C.v.x) * (1 - 1 / C.v.k), y: C.v.y + (cy - r.top - C.v.y) * (1 - 1 / C.v.k), k: 1 }); }
    else if (ctrl) return;
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeSel(); }
    else if (k === 'Escape') { if (!C.find.hidden) closeFind(); else { closePop(); C.sel.clear(); C.edge = null; refreshSel(); } }
    else if (k === 'Enter' || k === 'F2') { if (C.edge) { const ed = C.edges.find((x) => x.id === C.edge); if (ed) editEdgeLabel(ed); } else if (C.sel.size === 1) { e.preventDefault(); startEdit([...C.sel][0]); } }
    else if (k === '+' || k === '=') zoomAt(cx, cy, 1.25); else if (k === '-' || k === '_') zoomAt(cx, cy, .8);
    else if (lk === 'f') fit(C.sel.size ? C.sel : null, 1.5);
    else if (lk === 'v') setTool('select'); else if (lk === 'h') setTool('hand');
    else if (lk === 't') { const at = C.mouse ? toWorld(...C.mouse) : centerWorld(); addText(at[0], at[1]); e.preventDefault(); }
    else if (k === ']') zOrder(true); else if (k === '[') zOrder(false);
    else if (k.startsWith('Arrow')) {
      e.preventDefault(); const st = (e.shiftKey ? 10 : 1) * (C.snap ? GRID / (e.shiftKey ? 2.4 : 1) : 8), dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
      if (C.sel.size) { C.sel.forEach((id) => { const n = byId(id); n.x += dx; n.y += dy; posNode(n); }); edgesOf(C.sel).forEach(paintEdge); commit(true); schedule(); } else { C.v = { ...C.v, x: C.v.x - dx * C.v.k, y: C.v.y - dy * C.v.k }; applyView(); }
    }
  }
  function ungroup() { const gs = [...C.sel].map(byId).filter((n) => n && n.type === 'group'); if (!gs.length) return; C.sel = new Set(); gs.forEach((g) => { C.nodes = C.nodes.filter((n) => n !== g); C.els.get(g.id).remove(); C.els.delete(g.id); }); commit(); refreshSel(); }

  /* ---------- search ---------- */
  const textOf = (n) => { const m = C.meta.get(n.id) || {}; return ((n.text || '') + ' ' + (n.label || '') + ' ' + (n.url || '') + ' ' + (n.file || '') + ' ' + (m.text || '')).toLowerCase(); };
  function openFind() { C.find.hidden = false; const i = C.find.querySelector('input'); i.focus(); i.select(); runFind(); }
  function closeFind() { C.find.hidden = true; C.hits = []; C.els.forEach((el) => el.classList.remove('dim', 'hit')); C.view.focus({ preventScroll: true }); }
  function runFind() {
    const f = C.find.querySelector('input').value.trim().toLowerCase(); C.hits = f ? C.nodes.filter((n) => textOf(n).includes(f)).map((n) => n.id) : []; C.hi = -1;
    C.els.forEach((el, id) => { el.classList.toggle('dim', !!f && !C.hits.includes(id)); el.classList.toggle('hit', !!f && C.hits.includes(id)); });
    C.find.querySelector('.cv-fc').textContent = f ? (C.hits.length ? `${C.hits.length} found` : 'No matches') : '';
  }
  function stepFind(d) {
    if (!C.hits.length) return; C.hi = (C.hi + d + C.hits.length) % C.hits.length; const id = C.hits[C.hi]; select([id]); fit(new Set([id]), 1);
    C.find.querySelector('.cv-fc').textContent = `${C.hi + 1} of ${C.hits.length}`;
  }

  /* ---------- mini-map ---------- */
  function drawMini() {
    if (!C || !C.mini) return; const cv = C.miniCv, ctx = cv.getContext('2d'), W = cv.width, H = cv.height, vr = C.view.getBoundingClientRect();
    ctx.clearRect(0, 0, W, H); const vw = { x: -C.v.x / C.v.k, y: -C.v.y / C.v.k, w: vr.width / C.v.k, h: vr.height / C.v.k };
    let l = vw.x, t = vw.y, r = vw.x + vw.w, b = vw.y + vw.h; C.nodes.forEach((n) => { l = Math.min(l, n.x); t = Math.min(t, n.y); r = Math.max(r, n.x + n.width); b = Math.max(b, n.y + n.height); });
    const bw = Math.max(r - l, 1), bh = Math.max(b - t, 1), s = Math.min((W - 12) / bw, (H - 12) / bh), ox = (W - bw * s) / 2 - l * s, oy = (H - bh * s) / 2 - t * s; C.miniT = { s, ox, oy };
    C.nodes.forEach((n) => { const col = colorOf(n.color); ctx.globalAlpha = n.type === 'group' ? .35 : .85; ctx.fillStyle = col || (n.type === 'group' ? '#888' : '#9aa0b8'); ctx.fillRect(n.x * s + ox, n.y * s + oy, Math.max(2, n.width * s), Math.max(2, n.height * s)); });
    ctx.globalAlpha = 1; ctx.strokeStyle = TC.mag; ctx.lineWidth = 1.5; ctx.strokeRect(vw.x * s + ox, vw.y * s + oy, vw.w * s, vw.h * s);
  }
})();
