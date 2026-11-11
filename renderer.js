const $ = (id) => document.getElementById(id);
const isV = (k) => S.view === k || S.side === k;
const S = { root: '', tree: [], tabs: [], active: null, open: new Set(), filter: '', target: null, range: null };
let saveTimer;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dirOf = (p) => p.replace(/[\\/][^\\/]+$/, '');
const baseName = (p) => p.split(/[\\/]/).pop().replace(/\.md$/i, '');
const cur = () => S.tabs.find((t) => t.path === S.active);
const under = (p, src) => p === src || (p.startsWith(src) && /^[\\/]/.test(p.slice(src.length)));

/* ---------- markdown <-> editor ---------- */
const inl = (s) => esc(s)
  .replace(/&lt;span style="([\w\s:;,.'#%-]*)"&gt;/g, '<span style="$1">')
  .replace(/&lt;\/span&gt;/g, '</span>').replace(/&lt;(\/?)u&gt;/g, '<$1u>')
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|\W)\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
  .replace(/~~([^~]+)~~/g, '<s>$1</s>')
  .replace(/\[\[([^\]]+)\]\]/g, '<span class="wl">$1</span>');

const taskHtml = (h, done, ind) =>
  `<div class="task${done ? ' done' : ''}" data-done="${done ? 1 : 0}" data-ind="${ind}" style="margin-left:${ind * 8}px"><span class="box" contenteditable="false"></span><span class="tx">${h || '<br>'}</span></div>`;
function taskEl(h, done, ind) { const d = document.createElement('div'); d.innerHTML = taskHtml(h, done, ind); return d.firstChild; }

const TROW = /^\s*\|.*\|\s*$/, TSEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const splitRow = (r) => r.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
function tableHtml(rows) {
  const grid = rows.map(splitRow), n = Math.max(...grid.map((r) => r.length));
  const cell = (c, tag) => {
    const m = c.match(/^\[( |x|X)\] ?(.*)$/), tx = m ? m[2] : c;
    return `<${tag}${m ? ` data-cb="${m[1] === ' ' ? 0 : 1}"` : ''}>${inl(tx) || '<br>'}</${tag}>`;
  };
  return '<table class="tbl"><tbody>' + grid.map((r, i) => '<tr>' + Array.from({ length: n }, (_, k) => cell(r[k] || '', i ? 'td' : 'th')).join('') + '</tr>').join('') + '</tbody></table>';
}
function fromMd(src) {
  let h = '', ul = false, code = null;
  const endUl = () => { if (ul) { h += '</ul>'; ul = false; } };
  const pre = () => { h += `<pre class="code" data-lang="${code.lang}">${esc(code.txt.join('\n'))}</pre>`; code = null; };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]; let m;
    if (code) { if (/^```/.test(ln)) pre(); else code.txt.push(ln); continue; }
    if ((m = ln.match(/^```(.*)$/))) { endUl(); code = { lang: m[1].replace(/[^\w-]/g, ''), txt: [] }; continue; }
    if (TROW.test(ln) && i + 1 < lines.length && TSEP.test(lines[i + 1])) {
      endUl(); const rows = [ln]; i += 2;
      while (i < lines.length && TROW.test(lines[i])) rows.push(lines[i++]);
      i--; h += tableHtml(rows); continue;
    }
    if ((m = ln.match(/^(\s*)[-*] \[( |x|X)\] ?(.*)$/))) { endUl(); h += taskHtml(inl(m[3]), m[2] !== ' ', m[1].length); continue; }
    if ((m = ln.match(/^[-*] (.*)$/))) { if (!ul) { h += '<ul>'; ul = true; } h += `<li>${inl(m[1])}</li>`; continue; }
    endUl();
    if ((m = ln.match(/^(#{1,3}) (.*)$/))) { h += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`; continue; }
    if ((m = ln.match(/^> ?(.*)$/))) { h += `<blockquote>${inl(m[1])}</blockquote>`; continue; }
    h += `<div>${inl(ln) || '<br>'}</div>`;
  }
  endUl(); if (code) pre();
  return h || '<div><br></div>';
}

const wrap = (m, i) => { const core = i.trim(); return core ? i.slice(0, i.length - i.trimStart().length) + m + core + m + i.slice(i.trimEnd().length) : i; };
function inlineMd(node) {
  let s = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { s += c.nodeValue.replace(/\u00a0/g, ' '); return; }
    if (c.nodeType !== 1 || c.tagName === 'BR' || c.classList.contains('box')) return;
    const i = inlineMd(c), t = c.tagName;
    if (t === 'B' || t === 'STRONG') s += wrap('**', i);
    else if (t === 'I' || t === 'EM') s += wrap('*', i);
    else if (t === 'S' || t === 'STRIKE' || t === 'DEL') s += wrap('~~', i);
    else if (t === 'U') s += i ? `<u>${i}</u>` : '';
    else if (t === 'CODE') s += i ? '`' + i + '`' : '';
    else if (t === 'SPAN' && c.classList.contains('wl')) s += `[[${i}]]`;
    else if (t === 'SPAN') { const st = (c.getAttribute('style') || '').trim().replace(/"/g, "'"); s += st && i ? `<span style="${st}">${i}</span>` : i; }
    else s += i;
  });
  return s;
}
function toMd(ed) {
  const out = [];
  const blk = (n) => {
    if (n.nodeType === 3) { out.push(n.nodeValue.replace(/\u00a0/g, ' ')); return; }
    if (n.nodeType !== 1) return;
    const t = n.tagName;
    if (n.classList.contains('task')) { out.push(' '.repeat(+n.dataset.ind || 0) + `- [${n.dataset.done === '1' ? 'x' : ' '}] ` + inlineMd(n.querySelector('.tx'))); return; }
    if (t === 'TABLE') {
      if (n.previousElementSibling && n.previousElementSibling.tagName === 'TABLE') out.push('');
      const rows = [...n.rows].map((r) => [...r.cells].map((c) => ((c.dataset.cb ? `[${c.dataset.cb === '1' ? 'x' : ' '}] ` : '') + inlineMd(c).replace(/\s*\n\s*/g, ' ').trim()).trim().replace(/\|/g, '\\|')));
      rows.forEach((r, i) => { out.push('| ' + r.join(' | ') + ' |'); if (!i) out.push('| ' + r.map(() => '---').join(' | ') + ' |'); }); return;
    }
    if (/^H[1-3]$/.test(t)) { out.push('#'.repeat(+t[1]) + ' ' + inlineMd(n)); return; }
    if (t === 'UL') { n.querySelectorAll(':scope > li').forEach((li) => out.push('- ' + inlineMd(li))); return; }
    if (t === 'BLOCKQUOTE') { out.push('> ' + inlineMd(n)); return; }
    if (t === 'PRE') { out.push('```' + (n.dataset.lang || ''), n.textContent.replace(/\n$/, ''), '```'); return; }
    if (t === 'DIV' && [...n.children].some((c) => /^(DIV|H[1-3]|UL|BLOCKQUOTE|PRE|TABLE)$/.test(c.tagName))) { n.childNodes.forEach(blk); return; }
    out.push(inlineMd(n));
  };
  ed.childNodes.forEach(blk);
  return out.join('\n');
}

/* ---------- library tree ---------- */
async function refreshTree() { S.tree = await api.tree(); renderTree(); }
const hasMatch = (d, f) => d.children.some((c) => (c.type === 'dir' ? hasMatch(c, f) : c.name.toLowerCase().includes(f)));

function renderTree() {
  const el = $('tree'); el.innerHTML = ''; const f = S.filter.toLowerCase();
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      if (n.type === 'dir') {
        if (f && !hasMatch(n, f)) continue;
        const open = !!f || S.open.has(n.path);
        const r = mk(n, depth, `<span class="chev">${open ? '▾' : '▸'}</span><span class="fi"></span><span class="nm">${esc(n.name)}</span>`, 'dir' + (S.target === n.path ? ' sel' : ''));
        r.onclick = () => { S.target = n.path; if (open && !f) S.open.delete(n.path); else S.open.add(n.path); renderTree(); };
        el.appendChild(r);
        if (open) walk(n.children, depth + 1);
      } else if (!f || n.name.toLowerCase().includes(f)) {
        const r = mk(n, depth, `<span class="ni"></span><span class="nm">${esc(n.name)}</span>`, n.path === S.active ? 'active' : '');
        r.onclick = () => openNote(n.path);
        el.appendChild(r);
      }
    }
  };
  walk(S.tree, 0);
  if (!el.children.length) el.innerHTML = `<div class="empty">${f ? 'No notes match.' : 'No notes yet. Press Ctrl+N.'}</div>`;
}

function mk(n, depth, html, cls) {
  const d = document.createElement('div');
  d.className = 'row ' + cls; d.dataset.path = n.path; d.draggable = true;
  d.style.paddingLeft = 8 + depth * 14 + (n.type === 'file' ? 14 : 0) + 'px'; d.innerHTML = html;
  const dest = n.type === 'dir' ? n.path : dirOf(n.path);
  d.ondragstart = (e) => { e.dataTransfer.setData('text/plain', n.path); e.dataTransfer.effectAllowed = 'move'; };
  d.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); d.classList.add('drop'); };
  d.ondragleave = () => d.classList.remove('drop');
  d.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); drop(e.dataTransfer.getData('text/plain'), dest); };
  d.oncontextmenu = (e) => { e.preventDefault(); menu(e, n, d); };
  return d;
}

const flush = () => Promise.all(S.tabs.filter((t) => t.dirty).map(saveNow));
function remap(src, np) {
  const f = (p) => (under(p, src) ? np + p.slice(src.length) : p);
  S.tabs.forEach((t) => { t.path = f(t.path); t.name = baseName(t.path); });
  if (S.active) S.active = f(S.active);
  if (S.target) S.target = f(S.target);
  S.open = new Set([...S.open].map(f));
}
async function drop(src, dest) {
  if (!src) return;
  await flush();
  const np = await api.move(src, dest);
  if (np !== src) { remap(src, np); S.open.add(dest); }
  await refreshTree(); renderTabs();
}

function menu(e, n, row) {
  const m = $('ctx'); m.innerHTML = '';
  const add = (l, fn) => { const b = document.createElement('div'); b.textContent = l; b.onclick = () => { m.hidden = true; fn(); }; m.appendChild(b); };
  if (n.type === 'dir') { add('Rename', () => renameDir(n, row)); add('New note here', () => { S.target = n.path; newNote(); }); }
  add('Delete', () => uiConfirm({ title: 'Move to trash?', msg: `“${n.name}” will be moved to the trash.`, ok: 'Move to trash', danger: true, cb: async () => {
    await flush(); await api.trash(n.path);
    S.tabs = S.tabs.filter((t) => !under(t.path, n.path));
    if (!cur()) S.active = S.tabs.length ? S.tabs[S.tabs.length - 1].path : null;
    await refreshTree(); renderTabs(); renderPane();
  } }));
  m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px'; m.hidden = false;
}

function renameDir(n, row) {
  const nm = row.querySelector('.nm'), i = document.createElement('input');
  i.className = 'rn'; i.value = n.name; nm.replaceWith(i); i.focus(); i.select();
  let done = false;
  const fin = async (ok) => {
    if (done) return; done = true;
    if (ok && i.value.trim() && i.value !== n.name) { await flush(); const np = await api.renameDir(n.path, i.value); if (np !== n.path) remap(n.path, np); }
    await refreshTree(); renderTabs();
  };
  i.onkeydown = (e) => { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); };
  i.onblur = () => fin(true); i.onclick = (e) => e.stopPropagation();
}

/* ---------- tabs + notes ---------- */
async function openNote(path) {
  if (!S.tabs.find((t) => t.path === path)) {
    const text = await api.read(path);
    if (/^---\r?\n[\s\S]*?\btype: health\b[\s\S]*?\r?\n---/.test(text)) { const y = (text.match(/\nyear: (\d{4})/) || [])[1]; showHealth(y ? +y : null, true); return; }
    S.tabs.push({ path, name: baseName(path), text, dirty: false });
  }
  S.active = path; S.target = dirOf(path); render();
}
function closeTab(path) {
  const i = S.tabs.findIndex((t) => t.path === path); if (i < 0) return;
  if (S.tabs[i].dirty) saveNow(S.tabs[i]);
  S.tabs.splice(i, 1);
  if (S.active === path) S.active = S.tabs[Math.max(0, i - 1)]?.path || null;
  render();
}
function renderTabs() {
  const el = $('tabs'); el.innerHTML = '';
  for (const t of S.tabs) {
    const d = document.createElement('div'); d.className = 'tab' + (t.path === S.active ? ' on' : '');
    d.innerHTML = `${t.dirty ? '<i class="mod"></i>' : ''}<span>${esc(t.name)}</span><span class="x">×</span>`;
    d.onclick = () => { S.active = t.path; render(); };
    d.querySelector('.x').onclick = (e) => { e.stopPropagation(); closeTab(t.path); };
    el.appendChild(d);
  }
}

const FONTS = [['Sans', 'Segoe UI, sans-serif'], ['Serif', 'Georgia, serif'], ['Mono', 'Consolas, monospace'], ['Rounded', 'Trebuchet MS, sans-serif']];
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40];

function renderPane() {
  const t = cur(), pane = $('pane'); S.range = null;
  if (!t) { pane.innerHTML = '<div class="hint">Open a note from the library, or press Ctrl+N.</div>'; return; }
  pane.innerHTML = `
    <div class="tools" id="tools">
      <select id="f-font" title="Font"><option value="">Font</option>${FONTS.map(([n, v]) => `<option value="${v}">${n}</option>`).join('')}</select>
      <select id="f-size" title="Size"><option value="">Size</option>${SIZES.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
      <span class="sep"></span>
      <button data-c="bold" title="Bold"><b>B</b></button><button data-c="italic" title="Italic"><i>I</i></button>
      <button data-c="underline" title="Underline"><u>U</u></button><button data-c="strike" title="Strikethrough"><s>S</s></button>
      <span class="sep"></span>
      <button data-c="h1" title="Heading">H1</button><button data-c="h2" title="Subheading">H2</button>
      <span class="sep"></span>
      <button data-c="ul" title="Bullet list">• List</button>
      <button data-c="task" class="tick" title="Tick box (inside a table it ticks the cell)">☑ Tick box</button>
      <button data-c="table" class="tick" title="Insert table">▦ Insert table</button>
    </div>
    <div class="doc"><div class="sheet">
      <input class="title" id="title" value="${esc(t.name)}" spellcheck="false">
      <div class="ed" id="ed" contenteditable="true" spellcheck="true"></div>
    </div></div>`;
  const ed = $('ed'), tools = $('tools'), title = $('title');
  ed.innerHTML = fromMd(t.text); nBase(t);

  title.onkeydown = (e) => { if (e.key === 'Enter') { title.blur(); ed.focus(); } };
  title.onblur = async () => {
    const np = await api.rename(t.path, title.value);
    if (np !== t.path) { if (S.active === t.path) S.active = np; t.path = np; t.name = baseName(np); await refreshTree(); }
    title.value = t.name; renderTabs();
  };

  tools.onmousedown = (e) => { if (e.target.tagName !== 'SELECT') e.preventDefault(); };
  tools.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.c === 'table') { e.stopPropagation(); tablePicker(b); } else cmd(b.dataset.c); };
  $('f-font').onchange = (e) => { applyStyle('fontFamily', e.target.value); e.target.value = ''; };
  $('f-size').onchange = (e) => { applyStyle('fontSize', e.target.value + 'px'); e.target.value = ''; };

  ed.addEventListener('input', changed);
  ed.addEventListener('keydown', keys);
  ed.addEventListener('drop', (e) => e.preventDefault());
  ed.addEventListener('paste', (e) => { e.preventDefault(); let tx = e.clipboardData.getData('text/plain'); if (closestIn(getSelection().anchorNode, 'td,th')) tx = tx.replace(/\s*\r?\n\s*/g, ' '); document.execCommand('insertText', false, tx); });
  ed.addEventListener('contextmenu', (e) => { const c = e.target.closest && e.target.closest('td,th'); if (c && ed.contains(c)) { e.preventDefault(); e.stopPropagation(); tableMenu(e, c); } });
  ed.addEventListener('mousemove', (e) => { const c = e.target.closest && e.target.closest('td[data-cb],th[data-cb]'); ed.style.cursor = c && e.clientX - c.getBoundingClientRect().left < 34 ? 'pointer' : ''; });
  ed.addEventListener('mousedown', (e) => {
    const cc = e.target.closest && e.target.closest('td[data-cb],th[data-cb]');
    if (cc && e.button === 0 && e.clientX - cc.getBoundingClientRect().left < 34) { e.preventDefault(); cc.dataset.cb = cc.dataset.cb === '1' ? '0' : '1'; changed(); return; }
    const b = e.target.closest && e.target.closest('.box'); if (!b) return;
    e.preventDefault(); const tk = b.parentElement, d = tk.dataset.done !== '1';
    tk.dataset.done = d ? '1' : '0'; tk.classList.toggle('done', d); changed();
  });

}

function changed() {
  const ed = $('ed'), t = cur(); if (!ed || !t) return;
  if (!ed.firstChild) { ed.innerHTML = '<div><br></div>'; caret(ed.firstChild, true); }
  t.text = toMd(ed); markDirty(t); nRec(t);
}
const markDirty = (t) => { if (!t.dirty) { t.dirty = true; renderTabs(); } clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow(t), 600); };
async function saveNow(t) { await api.write(t.path, t.text); t.dirty = false; renderTabs(); }

/* ---------- editor commands ---------- */
document.addEventListener('selectionchange', () => {
  const ed = $('ed'), s = getSelection();
  if (ed && s.rangeCount && ed.contains(s.anchorNode)) {
    S.range = s.getRangeAt(0).cloneRange();
    const c = closestIn(s.anchorNode, 'td,th'), o = ed.querySelector('.cur');
    if (o !== c) { if (o) o.classList.remove('cur'); if (c) c.classList.add('cur'); }
    syncTick();
  }
});
function syncTick() {
  const s = getSelection(), ed = $('ed'), tb = document.querySelector('#tools [data-c=task]');
  if (!tb || !ed || !s.rangeCount || !ed.contains(s.anchorNode)) return;
  const c = closestIn(s.anchorNode, 'td,th'); tb.classList.toggle('on', c ? !!c.dataset.cb : !!closestIn(s.anchorNode, '.task'));
}
function restoreSel() { if (S.range) { const s = getSelection(); s.removeAllRanges(); s.addRange(S.range); } }
function caret(el, start) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(!!start); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function closestIn(node, sel) { const e = node && (node.nodeType === 1 ? node : node.parentElement), c = e && e.closest(sel); return c && $('ed').contains(c) ? c : null; }
function blockOf() { let n = getSelection().anchorNode; const ed = $('ed'); while (n && n.parentNode !== ed) n = n.parentNode; return n; }

function cmd(c) {
  const ed = $('ed'); ed.focus(); restoreSel();
  const sl = getSelection(), cell = sl.rangeCount ? closestIn(sl.anchorNode, 'td,th') : null;
  if (cell) {
    if (c === 'task') { if (cell.dataset.cb) delete cell.dataset.cb; else cell.dataset.cb = '0'; changed(); syncTick(); return; }
    if (c === 'h1' || c === 'h2' || c === 'ul') return;
  }
  if (c === 'bold' || c === 'italic' || c === 'underline') document.execCommand(c);
  else if (c === 'strike') document.execCommand('strikeThrough');
  else if (c === 'h1' || c === 'h2') { const b = blockOf(); document.execCommand('formatBlock', false, b && b.tagName && b.tagName.toLowerCase() === c ? 'div' : c); }
  else if (c === 'ul') document.execCommand('insertUnorderedList');
  else if (c === 'task') toggleTask();
  changed(); syncTick();
}
function toggleTask() {
  const b = blockOf(); if (!b || b.nodeType !== 1) return;
  if (b.classList.contains('task')) {
    const d = document.createElement('div'); d.innerHTML = b.querySelector('.tx').innerHTML || '<br>'; b.replaceWith(d); caret(d); return;
  }
  if (b.tagName === 'UL') { let last; [...b.children].forEach((li) => { last = taskEl(li.innerHTML, false, 0); b.before(last); }); b.remove(); caret(last.querySelector('.tx')); return; }
  const tk = taskEl(b.tagName === 'DIV' ? b.innerHTML : esc(b.textContent), false, 0);
  b.replaceWith(tk); caret(tk.querySelector('.tx'));
}
/* ---------- tables ---------- */
const newRow = (n) => { const tr = document.createElement('tr'); for (let i = 0; i < n; i++) tr.appendChild(Object.assign(document.createElement('td'), { innerHTML: '<br>' })); return tr; };
const toCell = (c) => { if (!c) return; c.scrollIntoView({ block: 'nearest' }); caret(c, !c.textContent); };
function buildTable(cols, rows) {
  const t = document.createElement('table'); t.className = 'tbl'; const b = document.createElement('tbody'); t.appendChild(b);
  for (let r = 0; r < rows; r++) { const tr = newRow(cols); if (!r) [...tr.cells].forEach((td, i) => { const th = document.createElement('th'); th.innerHTML = '<br>'; td.replaceWith(th); }); b.appendChild(tr); }
  return t;
}
function insertTable(cols, rows) {
  const ed = $('ed'); ed.focus(); restoreSel();
  const t = buildTable(cols, rows); let b = getSelection().rangeCount ? blockOf() : null;
  if (b && b.nodeType === 1 && b.tagName === 'DIV' && !b.textContent.trim() && !b.querySelector('.box')) { b.replaceWith(t); }
  else if (b && b.nodeType === 1) b.after(t); else ed.appendChild(t);
  const gap = () => { const d = document.createElement('div'); d.innerHTML = '<br>'; return d; };
  if (!t.nextSibling || t.nextElementSibling.tagName === 'TABLE') t.after(gap());
  if (t.previousElementSibling && t.previousElementSibling.tagName === 'TABLE') t.before(gap());
  caret(t.rows[0].cells[0], true); changed();
}
function tablePicker(btn) {
  if (tablePicker.close) { const was = !!document.querySelector('.tpick'); tablePicker.close(); if (was) return; }
  const pk = document.createElement('div'); pk.className = 'tpick'; const C = 8, R = 8;
  btn.classList.add('on');
  const shut = () => { pk.remove(); btn.classList.remove('on'); document.removeEventListener('mousedown', away, true); tablePicker.close = null; };
  tablePicker.close = shut;
  pk.innerHTML = `<div class="tp-grid">${Array.from({ length: C * R }, (_, i) => `<i data-c="${i % C + 1}" data-r="${Math.floor(i / C) + 1}"></i>`).join('')}</div><div class="tp-lab">Pick a size</div>`;
  const lab = pk.querySelector('.tp-lab'), cells = [...pk.querySelectorAll('i')];
  const r = btn.getBoundingClientRect(); pk.style.left = Math.min(r.left, innerWidth - 190) + 'px'; pk.style.top = r.bottom + 6 + 'px';
  pk.onmousedown = (e) => e.preventDefault();
  pk.onmouseover = (e) => { const i = e.target.closest('i'); if (!i) return; const c = +i.dataset.c, rw = +i.dataset.r; cells.forEach((x) => x.classList.toggle('on', +x.dataset.c <= c && +x.dataset.r <= rw)); lab.textContent = `${c} columns × ${rw} rows`; };
  pk.onclick = (e) => { e.stopPropagation(); const i = e.target.closest('i'); if (!i) return; shut(); insertTable(+i.dataset.c, +i.dataset.r); };
  function away(e) { if (!pk.contains(e.target) && !btn.contains(e.target)) shut(); }
  document.body.appendChild(pk); setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}
function tableKeys(e, cell) {
  const tbl = cell.closest('table'), tr = cell.parentElement, ri = tr.rowIndex, ci = cell.cellIndex, n = tr.cells.length;
  const go = (r, c) => { let row = tbl.rows[r]; if (!row) { row = newRow(n); tbl.tBodies[0].appendChild(row); changed(); } toCell(row.cells[c]); };
  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) { if (ci > 0) go(ri, ci - 1); else if (ri > 0) go(ri - 1, n - 1); }
    else if (ci < n - 1) go(ri, ci + 1); else go(ri + 1, 0);
  } else if (e.key === 'Enter') { e.preventDefault(); if (!e.shiftKey) go(ri + 1, ci); }
}
function tableMenu(e, cell) {
  const tbl = cell.closest('table'), tr = cell.parentElement, ri = tr.rowIndex, ci = cell.cellIndex, n = tr.cells.length, ed = $('ed');
  const rowAt = (i) => { const r = newRow(n); tbl.tBodies[0].insertBefore(r, tbl.rows[i] || null); changed(); toCell(r.cells[ci]); };
  const colAt = (i) => { [...tbl.rows].forEach((r, k) => { const c = document.createElement(k ? 'td' : 'th'); c.innerHTML = '<br>'; r.insertBefore(c, r.cells[i] || null); }); changed(); toCell(tr.cells[i]); };
  const items = [];
  if (ri > 0) items.push(['Add row above', () => rowAt(ri)]);
  items.push(['Add row below', () => rowAt(ri + 1)], ['Add column left', () => colAt(ci)], ['Add column right', () => colAt(ci + 1)], null);
  items.push([cell.dataset.cb ? 'Remove tick box' : 'Add tick box', () => { if (cell.dataset.cb) delete cell.dataset.cb; else cell.dataset.cb = '0'; changed(); syncTick(); }], null);
  if (ri > 0) items.push(['Delete row', () => { tr.remove(); changed(); }, 'danger']);
  if (n > 1) items.push(['Delete column', () => { [...tbl.rows].forEach((r) => r.cells[ci] && r.cells[ci].remove()); changed(); }, 'danger']);
  items.push(['Delete table', () => confirmTable(tbl), 'danger']);
  ctxAt(e, items);
}
function confirmTable(tbl) {
  const ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = '<div class="t-card"><h3>Delete this table?</h3><div class="t-for">The table and everything in it will be removed from this note.</div><div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Delete table</button></div></div>';
  const close = () => ov.remove();
  const ok = () => { close(); tbl.remove(); const ed = $('ed'); if (!ed.firstChild) ed.innerHTML = '<div><br></div>'; changed(); };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  document.body.appendChild(ov); ov.tabIndex = -1; ov.focus();
}
function applyStyle(prop, val) {
  const ed = $('ed'); restoreSel();
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed || !ed.contains(sel.anchorNode)) return;
  const r = sel.getRangeAt(0), sp = document.createElement('span');
  sp.style[prop] = val; sp.appendChild(r.extractContents());
  sp.querySelectorAll('span').forEach((s) => { s.style[prop] = ''; });
  r.insertNode(sp); const nr = document.createRange(); nr.selectNodeContents(sp); sel.removeAllRanges(); sel.addRange(nr);
  changed();
}
function keys(e) {
  const s = getSelection(); if (!s.rangeCount) return;
  const cell = closestIn(s.anchorNode, 'td,th'); if (cell) { tableKeys(e, cell); return; }
  const tk = closestIn(s.anchorNode, '.task'); if (!tk) return;
  const tx = tk.querySelector('.tx'), toPara = () => { const d = document.createElement('div'); d.innerHTML = tx.innerHTML || '<br>'; tk.replaceWith(d); caret(d, true); changed(); };
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!tx.textContent.trim()) { toPara(); return; }
    const r = document.createRange(); r.selectNodeContents(tx);
    if (tx.contains(s.anchorNode)) r.setStart(s.anchorNode, s.anchorOffset); else r.collapse(false);
    const frag = r.extractContents(), nt = taskEl('', false, +tk.dataset.ind || 0), nx = nt.querySelector('.tx');
    nx.innerHTML = ''; nx.appendChild(frag); if (!nx.textContent) nx.innerHTML = '<br>';
    if (!tx.textContent) tx.innerHTML = '<br>';
    tk.after(nt); caret(nx, true); changed();
  } else if (e.key === 'Backspace' && s.isCollapsed && tx.contains(s.anchorNode)) {
    const pre = document.createRange(); pre.selectNodeContents(tx); pre.setEnd(s.anchorNode, s.anchorOffset);
    if (!pre.toString()) { e.preventDefault(); toPara(); }
  }
}

/* ---------- app actions ---------- */
async function newNote() {
  if (SP.page !== 'notes') setView('notes');
  const dir = S.target || S.root; S.open.add(dir);
  const p = await api.create(dir); await refreshTree(); await openNote(p);
  const ti = $('title'); ti.focus(); ti.select();
}
async function newFolder() {
  if (SP.page !== 'notes') setView('notes');
  const dir = S.target || S.root; S.open.add(dir);
  const p = await api.createDir(dir); await refreshTree();
  const row = [...$('tree').children].find((r) => r.dataset.path === p);
  if (row) renameDir({ path: p, name: p.split(/[\\/]/).pop() }, row);
}
async function chooseVault() { const v = await api.chooseVault(); if (v) { S.tabs = []; S.active = null; S.target = null; S.open = new Set(); loadVault(v); } }
function loadVault(v) { if (typeof INC !== 'undefined') INC.loaded = false; if (typeof U !== 'undefined') U.s = {}; if (typeof DB !== 'undefined') DB.loaded = false; S.tasks = null; S.gantt = null; P.loaded = false; S.root = v.root; S.tree = v.tree; $('vault-name').textContent = v.root; render(); }
function render() { setView('notes'); renderTabs(); renderTree(); renderPane(); }

$('btn-new').onclick = newNote; $('btn-dir').onclick = newFolder; $('btn-notes').onclick = () => setView('notes');
$('filter').oninput = (e) => { S.filter = e.target.value; renderTree(); };
$('tree').ondragover = (e) => e.preventDefault();
$('tree').ondrop = (e) => { e.preventDefault(); drop(e.dataTransfer.getData('text/plain'), S.root); };
document.addEventListener('click', () => { $('ctx').hidden = true; });
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return; const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); e.shiftKey ? newFolder() : newNote(); }
  else if (k === 'o') { e.preventDefault(); chooseVault(); }
  else if (k === 's') { e.preventDefault(); const t = cur(); if (t) saveNow(t); }
  else if (k === 'w') { e.preventDefault(); if (S.active) closeTab(S.active); }
});
window.addEventListener('beforeunload', () => S.tabs.forEach((t) => t.dirty && api.write(t.path, t.text)));

document.execCommand('defaultParagraphSeparator', false, 'div');
api.openVault().then((v) => { loadVault(v); const w = v.tree.find((n) => n.type === 'file'); if (w) openNote(w.path); });

/* ---------- daily tasks ---------- */
/* ---------- themes ---------- */
const THEMES = {
  cyberpunk: { label: 'Cyberpunk', c: { mag: '#d62bd0', a2: '#8b5cf6', a3: '#22d3ee', rose: '#fb7185', amb: '#f59e0b', grn: '#34d399', blu: '#60a5fa', yel: '#facc15' } },
  bossman: { label: 'Bossman', c: { mag: '#d4b06a', a2: '#8fa3b5', a3: '#86b3c7', rose: '#c9707e', amb: '#b8864a', grn: '#73ad98', blu: '#5f86a3', yel: '#ecd29a' } },
};
const TC = Object.assign({}, THEMES.cyberpunk.c);
const PAL = [TC.mag, TC.a2, TC.a3, TC.rose, TC.amb, TC.grn];
let FCOL = [];
const uid = () => Math.random().toString(36).slice(2, 9);
const mv = (a, i, d) => { const j = i + d; if (j >= 0 && j < a.length) [a[i], a[j]] = [a[j], a[i]]; };
let tSave = null;
const tip = document.createElement('div'); tip.id = 't-tip'; tip.hidden = true; document.body.appendChild(tip);

function setView(v) { S.view = v; $('btn-notes').classList.toggle('on', v === 'notes'); document.body.classList.toggle('view-tasks', v === 'tasks'); document.body.classList.toggle('view-gantt', v === 'gantt'); $('btn-tasks').classList.toggle('on', v === 'tasks'); $('btn-gantt').classList.toggle('on', v === 'gantt'); document.body.classList.toggle('view-pomo', v === 'pomo'); $('btn-pomo').classList.toggle('on', v === 'pomo'); document.body.classList.toggle('view-health', v === 'health'); $('btn-health').classList.toggle('on', v === 'health'); document.body.classList.toggle('view-finance', v === 'finance'); $('btn-finance').classList.toggle('on', v === 'finance'); document.body.classList.toggle('view-calendar', v === 'calendar'); $('btn-cal').classList.toggle('on', v === 'calendar'); document.body.classList.toggle('view-dash', v === 'dash'); $('btn-dash').classList.toggle('on', v === 'dash'); tip.hidden = true; }
function tSaveNow() { clearTimeout(tSave); tSave = null; if (S.tasks) api.saveTasks(JSON.stringify(S.tasks, null, 1)); }
function tChanged() { uNote('tasks'); try { dbTaskTick(); } catch { /* dashboard not ready yet */ } renderTasks(); clearTimeout(tSave); tSave = setTimeout(tSaveNow, 300); }
window.addEventListener('beforeunload', () => { if (tSave) tSaveNow(); });

async function showTasks() {
  if (S.view === 'tasks') { render(); return; }
  await loadTasksData();
  setView('tasks'); renderTasks();
}

function ctxAt(e, items) {
  const m = $('ctx'); m.innerHTML = '';
  items.forEach((it) => {
    const b = document.createElement('div');
    if (!it) b.className = 'sp'; else { b.textContent = it[0]; if (it[2]) b.className = it[2]; b.onclick = () => { m.hidden = true; it[1](); }; }
    m.appendChild(b);
  });
  m.style.left = Math.min(e.clientX, innerWidth - 190) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - items.length * 30 - 20) + 'px'; m.hidden = false;
}
function inlineEdit(span, value, save) {
  const i = document.createElement('input'); i.className = 't-edit'; i.value = value; span.replaceWith(i); i.focus(); i.select();
  let done = false;
  const fin = (ok) => { if (done) return; done = true; const v = i.value.trim(); if (ok && v && v !== value) save(v); else renderTasks(); };
  i.onkeydown = (e) => { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); };
  i.onblur = () => fin(true);
}
function showTip(row, text) {
  tip.textContent = text; tip.hidden = false;
  const r = row.getBoundingClientRect(); let x = r.right + 10;
  if (x + tip.offsetWidth > innerWidth - 10) x = Math.max(10, r.left - tip.offsetWidth - 10);
  tip.style.left = x + 'px'; tip.style.top = r.top + 'px';
}
function noteModal(t) {
  const ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = `<div class="t-card"><h3>Note</h3><div class="t-for">${esc(t.text)}</div><textarea placeholder="Write a note for this task…">${esc(t.note || '')}</textarea>
    <div class="t-actions">${t.note ? '<button data-a="del">Remove note</button>' : ''}<span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Save</button></div></div>`;
  const ta = ov.querySelector('textarea'), close = () => ov.remove();
  const ok = () => { t.note = ta.value.trim(); close(); tChanged(); };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); if (a === 'del') { t.note = ''; close(); tChanged(); } };
  ta.onkeydown = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.ctrlKey) ok(); };
  document.body.appendChild(ov); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

function renderTasks() {
  tip.hidden = true;
  const el = $('tasks'), T = S.tasks, old = el.querySelector('.t-board');
  const sl = old ? old.scrollLeft : 0, st = old ? old.scrollTop : 0;
  const mp = mullProgress(), done = mp.done, pct = mp.tot ? Math.round(done / mp.tot * 100) : 0, wo = !!(T.mull && T.mull.workOnly);
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const mm = !!S.mullMode, mt = mm ? mullTotals() : null; el.classList.toggle('mulling', mm);
  el.innerHTML = `<div class="t-head"><div><h1>${mm ? 'Mulling setup' : 'Daily tasks'}</h1><div class="t-sub">${mm ? `Tick what should come up today, untick what to leave out · ${mt.on} of ${mt.tot} in play · press Mulling again when you’re done` : (T.categories.length ? (mp.tot ? `${date} · ${done} of ${mp.tot} mulling tasks done${wo ? ' · work only' : ''}` : `${date} · no tasks selected for mulling`) : 'Add a category to build your routine')}</div></div>
    ${mm ? '' : `<div class="t-prog" title="${pct}%"><i style="width:${pct}%"></i></div>`}<button id="t-mull" class="t-mullbtn${mm ? ' on' : ''}" title="Choose which tasks the Pomodoro mulling box can pick from">Mulling</button>${mm ? '' : '<button id="t-reset" title="Uncheck every task in row 1 (daily tasks)">Uncheck row 1</button>'}</div><div class="t-board"></div>`;
  $('t-mull').onclick = () => { S.mullMode = !S.mullMode; renderTasks(); };
  const rb = $('t-reset'); if (rb) rb.onclick = () => uiSure({ title: 'Uncheck row 1?', msg: 'Every box in the Daily tasks row will be unchecked.', ok: 'Uncheck row 1', cb: () => { T.categories.forEach((c) => { if (!c.row) c.tasks.forEach((t) => setTaskDone(t, false)); }); tChanged(); } });
  const board = el.querySelector('.t-board');
  ['Daily tasks', 'Work tasks'].forEach((name, row) => {
    const sec = document.createElement('div'); sec.className = 't-sec';
    sec.innerHTML = `<div class="t-sech"><span>${name}</span><i></i></div>`;
    const line = document.createElement('div'); line.className = 't-line';
    T.categories.forEach((c, ci) => { if ((c.row ? 1 : 0) === row) line.appendChild(colEl(c, ci)); });
    line.appendChild(ghostCol(row)); sec.appendChild(line); board.appendChild(sec);
  });
  board.scrollLeft = sl; board.scrollTop = st;
  if (S.focusAdd) { const i = el.querySelector(`.t-add[data-cat="${S.focusAdd}"]`); if (i) i.focus(); S.focusAdd = null; }
}

function colEl(c, ci) {
  const T = S.tasks, d = document.createElement('section'); d.className = 't-col' + (S.mullMode && c.noMull ? ' catoff' : ''); d.style.setProperty('--c', PAL[c.color % PAL.length]);
  const n = c.tasks.filter((t) => t.done).length, p = c.tasks.length ? n / c.tasks.length * 100 : 0;
  const mm = !!S.mullMode, mc = mm ? catCounts(c) : null;
  d.innerHTML = `<header class="t-ch">${mm ? `<button class="t-cbox${c.noMull ? '' : ' on'}" title="Include this whole category in mulling"></button>` : ''}<span class="t-name">${esc(c.name)}</span>${mm ? `<span class="t-count" title="tasks in play">${mc.on}/${mc.tot}</span>` : `<span class="t-count">${n}/${c.tasks.length}</span>`}<button class="t-more" title="Category options">⋯</button></header><div class="t-bar"><i style="width:${p}%"></i></div><div class="t-list"></div>`;
  const catMenu = (e) => ctxAt(e, [
    ['Rename', () => inlineEdit(d.querySelector('.t-name'), c.name, (v) => { c.name = v; tChanged(); })],
    ['Change color', () => { c.color = (c.color + 1) % PAL.length; tChanged(); }],
    mm && ['Check all for mulling', () => uiSure({ title: 'Check all for mulling?', msg: `Every task in “${c.name}” will be included in mulling.`, ok: 'Check all', cb: () => { c.noMull = false; c.tasks.forEach((t) => { t.noMull = false; (t.subs || []).forEach((x) => { x.noMull = false; }); }); tChanged(); } })],
    mm
      ? ['Uncheck from mulling', () => { c.noMull = true; c.tasks.forEach((t) => { t.noMull = true; (t.subs || []).forEach((x) => { x.noMull = true; }); }); tChanged(); }]
      : ['Uncheck all', () => uiSure({ title: `Uncheck all boxes in “${c.name}”?`, msg: 'Every task in this list will be marked as not done.', ok: 'Uncheck all', cb: () => { c.tasks.forEach((t) => setTaskDone(t, false)); tChanged(); } })],
    ...rowMoves(c, ci),
    null,
    ['Delete category', () => { const go = () => { T.categories.splice(ci, 1); tChanged(); }; if (c.tasks.length) uiConfirm({ title: 'Delete this category?', msg: `“${c.name}” and its ${c.tasks.length} task${c.tasks.length === 1 ? '' : 's'} will be deleted.`, ok: 'Delete', danger: true, cb: go }); else go(); }, 'danger'],
  ].filter((x) => x !== false));
  d.querySelector('.t-ch').oncontextmenu = (e) => { e.preventDefault(); catMenu(e); };
  d.querySelector('.t-more').onclick = (e) => { e.stopPropagation(); catMenu(e); };
  const cb = d.querySelector('.t-cbox'); if (cb) cb.onclick = () => { c.noMull = !c.noMull; tChanged(); };

  const list = d.querySelector('.t-list');
  c.tasks.forEach((t, ti) => {
    t.subs = t.subs || [];
    const hasSubs = t.subs.length > 0, nsub = t.subs.filter((x) => x.done).length;
    const r = document.createElement('div'); r.className = 't-row' + (mm ? ` mm-${taskMullState(t)}${t.done ? ' strike' : ''}` : (t.done ? ' done' : '')) + (t.note ? ' has-note' : '');
    r.innerHTML = `<span class="t-box"></span><span class="t-text">${esc(t.text)}</span>${mm && !t.done && !c.noMull && taskMullState(t) !== 'off' ? holdChip(t) : ''}${hasSubs ? `<span class="t-cnt">${nsub}/${t.subs.length}</span><span class="t-chev" title="Show or hide subtasks">${t.collapsed ? '▸' : '▾'}</span>` : ''}${!mm && !t.done && !c.noMull && taskMullState(t) !== 'off' ? holdChip(t, true) : ''}`;
    const rename = () => inlineEdit(r.querySelector('.t-text'), t.text, (v) => { t.text = v; tChanged(); });
    r.querySelector('.t-box').onclick = () => { if (mm) toggleMullTask(t); else setTaskDone(t, !t.done); tChanged(); };
    r.querySelector('.t-text').ondblclick = rename;
    if (hasSubs) r.querySelectorAll('.t-cnt, .t-chev').forEach((x) => { x.onclick = () => { t.collapsed = !t.collapsed; tChanged(); }; });
    if (t.note) { r.onmouseenter = () => showTip(r, t.note); r.onmouseleave = () => { tip.hidden = true; }; }
    r.oncontextmenu = (e) => {
      e.preventDefault(); tip.hidden = true;
      ctxAt(e, [
        ['Add subtasks…', () => subModal(t)],
        mm && hasSubs && [t.tether ? 'Untether subtasks' : 'Tether subtasks', () => { t.tether = !t.tether; tChanged(); }],
        ...holdMenu(t, mm && !c.noMull && taskMullState(t) !== 'off'),
        [t.note ? 'Edit note' : 'Add note', () => noteModal(t)],
        ['Rename', rename],
        ti > 0 && ['Move up', () => { mv(c.tasks, ti, -1); tChanged(); }],
        ti < c.tasks.length - 1 && ['Move down', () => { mv(c.tasks, ti, 1); tChanged(); }],
        null,
        ['Delete task', () => { c.tasks.splice(ti, 1); tChanged(); }, 'danger'],
      ].filter((x) => x !== false));
    };
    if (hasSubs && t.tether) {
      const grp = document.createElement('div'); grp.className = 't-grp'; grp.appendChild(r);
      if (!t.collapsed) t.subs.forEach((x, si) => grp.appendChild(subRow(t, x, si)));
      list.appendChild(grp);
    } else { list.appendChild(r); if (hasSubs && !t.collapsed) t.subs.forEach((x, si) => list.appendChild(subRow(t, x, si))); }
  });
  const add = document.createElement('input'); add.className = 't-add'; add.placeholder = '+ Add task'; add.dataset.cat = c.id;
  add.onkeydown = (e) => { if (e.key === 'Enter' && add.value.trim()) { c.tasks.push({ id: uid(), text: add.value.trim(), done: false, note: '', subs: [] }); S.focusAdd = c.id; tChanged(); } };
  d.appendChild(add);
  return d;
}

function ghostCol(row) {
  const g = document.createElement('button'); g.className = 't-ghost'; g.innerHTML = '<span>+</span> Add category';
  g.onclick = () => {
    const i = document.createElement('input'); i.className = 't-ghost-in'; i.placeholder = 'Category name'; g.replaceWith(i); i.focus();
    let done = false;
    const fin = (ok) => {
      if (done) return; done = true; const v = i.value.trim();
      if (ok && v) { const c = { id: uid(), name: v, color: S.tasks.categories.length % PAL.length, tasks: [], row: row || 0 }; S.tasks.categories.push(c); S.focusAdd = c.id; tChanged(); } else renderTasks();
    };
    i.onkeydown = (e) => { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); };
    i.onblur = () => fin(!!i.value.trim());
  };
  return g;
}
$('btn-tasks').onclick = showTasks;

/* ---------- gantt ---------- */
const RH = 36, LW = 320, ZOOM = { day: 36, week: 14, month: 5 };
const G = { zoom: 'day', drag: null, hover: null, save: null, focusAdd: null, lo: null, hi: null, lockLo: null, lockHi: null };
const pad2 = (n) => String(n).padStart(2, '0');
const dn = (s) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const ds = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const todayN = () => { const d = new Date(); return dn(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`); };
const fmtD = (n) => new Date(n * 864e5).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const gTasks = () => S.gantt.groups.flatMap((g) => g.tasks);
const gFind = (id) => gTasks().find((t) => t.id === id);
const gGroup = (id) => S.gantt.groups.find((g) => g.id === id);
const gGroupOf = (tid) => S.gantt.groups.find((g) => g.tasks.some((t) => t.id === tid));
const gColor = (g) => PAL[g.color % PAL.length];
const gSpan = (g) => (g.tasks.length ? [Math.min(...g.tasks.map((t) => dn(t.start))), Math.max(...g.tasks.map((t) => dn(t.end)))] : null);

function gSaveNow() { clearTimeout(G.save); G.save = null; if (S.gantt) api.saveData('Gantt.gantt.json', JSON.stringify(S.gantt, null, 1)); }
function gChanged() { uNote('gantt'); renderGantt(); clearTimeout(G.save); G.save = setTimeout(gSaveNow, 300); }
window.addEventListener('beforeunload', () => { if (G.save) gSaveNow(); });

/* a task may never start before its predecessors finish; pushing forward cascades to dependents */
function cascade(id, depth = 0) {
  if (depth > 60) return;
  const t = gFind(id), end = dn(t.end);
  gTasks().forEach((s) => {
    if (!s.deps.includes(id)) return;
    const ss = dn(s.start);
    if (ss <= end) { const dur = dn(s.end) - ss; s.start = ds(end + 1); s.end = ds(end + 1 + dur); cascade(s.id, depth + 1); }
  });
}
function descendants(id, out = new Set()) {
  gTasks().forEach((s) => { if (s.deps.includes(id) && !out.has(s.id)) { out.add(s.id); descendants(s.id, out); } });
  return out;
}

async function showGantt() {
  if (S.view === 'gantt') { render(); return; }
  if (!S.gantt) {
    try { S.gantt = JSON.parse(await api.loadData('Gantt.gantt.json')); } catch { S.gantt = null; }
    if (!S.gantt || !Array.isArray(S.gantt.groups)) S.gantt = { groups: [] };
    S.gantt.groups.forEach((g) => g.tasks.forEach((t) => { t.deps = t.deps || []; t.progress = t.progress || 0; }));
  }
  setView('gantt'); renderGantt(true);
}

function renderGantt(toToday) {
  tip.hidden = true; G.hover = null;
  const el = $('gantt'), D = S.gantt, ppd = ZOOM[G.zoom], old = el.querySelector('.g-scroll');
  const sl = old ? old.scrollLeft : 0, st = old ? old.scrollTop : 0;
  const all = gTasks(), tn = todayN();
  const pct = all.length ? Math.round(all.reduce((a, t) => a + (t.progress || 0), 0) / all.length) : 0;
  let html = `<div class="t-head"><div><h1>Gantt</h1><div class="t-sub">${all.length} task${all.length === 1 ? '' : 's'} · ${pct}% complete · drag bars to move, drag edges to resize</div></div>
    <div class="g-tools"><div class="seg">${['day', 'week', 'month'].map((z) => `<button data-act="z-${z}" class="${G.zoom === z ? 'on' : ''}">${z[0].toUpperCase() + z.slice(1)}</button>`).join('')}</div>
    <button data-act="today">Today</button><button class="g-primary" data-act="addproj">+ Project</button></div></div>`;
  if (!D.groups.length) {
    el.innerHTML = html + `<div class="g-empty"><h2>Plan something big</h2><p>Create a project, add tasks, then drag the bars to schedule them. Link tasks together and the chart reshuffles itself when dates move.</p><button class="g-primary" data-act="addproj">+ Add project</button> <button data-act="example">Load example</button></div>`;
    return;
  }
  let lo = Math.min(tn, ...all.map((t) => dn(t.start))) - 10, hi = Math.max(tn, ...all.map((t) => dn(t.end))) + 45;
  if (G.drag && G.lockLo != null) { lo = G.lockLo; hi = Math.max(G.lockHi, hi); } else lo -= ((lo + 3) % 7 + 7) % 7;
  hi = Math.max(hi, lo + 90);
  const prevLo = G.lo; G.lo = lo; G.hi = hi;
  const W = (hi - lo + 1) * ppd, x = (n) => (n - lo) * ppd;

  let mo = '', dy = '', segStart = lo, key = ds(lo).slice(0, 7);
  for (let n = lo; n <= hi + 1; n++) {
    const k = n <= hi ? ds(n).slice(0, 7) : '';
    if (k !== key) {
      const label = new Date(segStart * 864e5).toLocaleDateString(undefined, { month: ppd >= 14 ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
      mo += `<div class="g-mo" style="left:${x(segStart)}px;width:${(n - segStart) * ppd}px">${label}</div>`; segStart = n; key = k;
    }
  }
  let we = '';
  for (let n = lo; n <= hi; n++) {
    const wd = (n + 3) % 7, d = new Date(n * 864e5).getUTCDate();
    if (ppd >= 28) dy += `<div class="g-dy${wd >= 5 ? ' we' : ''}${n === tn ? ' td' : ''}" style="left:${x(n)}px;width:${ppd}px">${d}<small>${'MTWTFSS'[wd]}</small></div>`;
    else if (ppd >= 10 && wd === 0) dy += `<div class="g-dy wk" style="left:${x(n)}px;width:${7 * ppd}px">${d}</div>`;
    if (ppd >= 10 && wd >= 5) we += `<div class="g-we" style="left:${x(n)}px;width:${ppd}px"></div>`;
  }

  const R = [];
  D.groups.forEach((g) => { R.push({ k: 'g', g }); if (!g.collapsed) { g.tasks.forEach((t) => R.push({ k: 't', g, t })); R.push({ k: 'a', g }); } });
  const ri = {}; R.forEach((r, i) => { if (r.k === 't') ri[r.t.id] = i; });
  let list = '', plot = '', bars = '', svg = '';
  R.forEach((r, i) => {
    const c = gColor(r.g), top = i * RH;
    if (r.k === 'g') {
      const g = r.g, n = g.tasks.filter((t) => t.progress >= 100).length, sp = gSpan(g);
      list += `<div class="g-r g-grow" data-gid="${g.id}" style="--c:${c}"><span class="g-chev">${g.collapsed ? '▸' : '▾'}</span><span class="g-dot"></span><span class="g-nm">${esc(g.name)}</span><span class="g-cnt">${n}/${g.tasks.length}</span><button class="g-more" data-act="gmenu" title="Project options">⋯</button></div>`;
      plot += `<div class="g-gbg" style="top:${top}px;height:${RH}px;--c:${c}"></div>`;
      if (sp) bars += `<div class="g-sum" style="left:${x(sp[0])}px;width:${(sp[1] - sp[0] + 1) * ppd}px;top:${top + 13}px;--c:${c}"></div>`;
    } else if (r.k === 't') {
      const t = r.t, s = dn(t.start), e = dn(t.end), w = (e - s + 1) * ppd, p = Math.max(0, Math.min(100, t.progress || 0));
      list += `<div class="g-r g-trow${p >= 100 ? ' done' : ''}" data-id="${t.id}" style="--c:${c}"><span class="g-nm">${esc(t.name)}</span><span class="g-dt">${fmtD(s)} – ${fmtD(e)}</span></div>`;
      bars += `<div class="g-bar${p >= 100 ? ' done' : ''}" data-id="${t.id}" style="left:${x(s)}px;width:${w}px;top:${top + 7}px;height:${RH - 14}px;--c:${c}"><i class="g-fill" style="width:${p}%"></i><span class="g-bl">${w > 50 ? p + '%' : ''}</span><b class="g-h g-h-l"></b><b class="g-h g-h-r"></b></div>`;
    } else {
      list += `<div class="g-r g-arow" style="--c:${c}"><input class="g-add" data-gid="${r.g.id}" placeholder="+ Add task"></div>`;
    }
  });
  list += `<div class="g-r g-arow"><button class="g-addp" data-act="addproj">+ Add project</button></div>`;
  R.forEach((r) => {
    if (r.k !== 't') return;
    r.t.deps.forEach((pid) => {
      const p = gFind(pid); if (!p || ri[pid] === undefined) return;
      const x1 = x(dn(p.end) + 1), y1 = ri[pid] * RH + RH / 2, x2 = x(dn(r.t.start)), y2 = ri[r.t.id] * RH + RH / 2;
      svg += `<path d="M${x1} ${y1} C${x1 + 26} ${y1} ${x2 - 26} ${y2} ${x2 - 3} ${y2}"/><path class="ah" d="M${x2} ${y2} l-7 -4 v8 z"/>`;
    });
  });
  const gw = ppd >= 28 ? ppd : 7 * ppd;
  html += `<div class="g-scroll"><div class="g-inner" style="width:${LW + W}px">
    <div class="g-hdr"><div class="g-corner">Projects &amp; tasks</div><div class="g-scale" style="width:${W}px">${mo}${dy}<i class="g-tf" style="left:${x(tn) + ppd / 2}px"></i></div></div>
    <div class="g-rows"><div class="g-list">${list}</div>
      <div class="g-plot" style="width:${W}px;height:${(R.length + 1) * RH}px;background-size:${gw}px 100%,100% ${RH}px">${plot}${we}<svg class="g-svg" width="${W}" height="${(R.length + 1) * RH}">${svg}</svg>${bars}<i class="g-today" style="left:${x(tn) + ppd / 2}px"></i></div></div></div></div>`;
  el.innerHTML = html;

  const sc = el.querySelector('.g-scroll');
  if (toToday) sc.scrollLeft = Math.max(0, x(tn) - 240);
  else { sc.scrollLeft = sl + (prevLo != null ? (prevLo - lo) * ppd : 0); sc.scrollTop = st; }
  if (G.focusAdd) { const i = el.querySelector(`.g-add[data-gid="${G.focusAdd}"]`); if (i) i.focus({ preventScroll: true }); G.focusAdd = null; }
}

function gEdit(span, value, save) {
  const i = document.createElement('input'); i.className = 't-edit'; i.value = value; span.replaceWith(i); i.focus(); i.select();
  let done = false;
  const fin = (ok) => { if (done) return; done = true; const v = i.value.trim(); if (ok && v && v !== value) save(v); else renderGantt(); };
  i.onkeydown = (e) => { if (e.key === 'Enter') fin(true); if (e.key === 'Escape') fin(false); };
  i.onblur = () => fin(true);
}
function renameTask(id) { const t = gFind(id), nm = $('gantt').querySelector(`.g-trow[data-id="${id}"] .g-nm`); if (nm) gEdit(nm, t.name, (v) => { t.name = v; gChanged(); }); }
function renameGroup(id) { const g = gGroup(id), nm = $('gantt').querySelector(`.g-grow[data-gid="${id}"] .g-nm`); if (nm) gEdit(nm, g.name, (v) => { g.name = v; gChanged(); }); }
function addProject() {
  const g = { id: uid(), name: 'New project', color: S.gantt.groups.length % PAL.length, collapsed: false, tasks: [] };
  S.gantt.groups.push(g); gChanged(); renameGroup(g.id);
}
function addTask(gid, name) {
  const g = gGroup(gid), last = g.tasks[g.tasks.length - 1], s = last ? dn(last.end) + 1 : todayN();
  g.tasks.push({ id: uid(), name, start: ds(s), end: ds(s + 2), progress: 0, deps: [], note: '' });
  G.focusAdd = gid; gChanged();
}
function delTask(id) {
  const g = gGroupOf(id); g.tasks = g.tasks.filter((t) => t.id !== id);
  gTasks().forEach((t) => { t.deps = t.deps.filter((d) => d !== id); }); gChanged();
}
function loadExample() {
  const t0 = todayN(), mk = (name, off, len, p, deps = []) => ({ id: uid(), name, start: ds(t0 + off), end: ds(t0 + off + len - 1), progress: p, deps, note: '' });
  const a = mk('Write script', 0, 3, 100), b = mk('Record footage', 3, 2, 60, [a.id]), c = mk('Edit video', 5, 4, 20, [b.id]), d = mk('Design thumbnail', 5, 2, 0, [b.id]), e = mk('Publish & promote', 9, 2, 0, [c.id, d.id]);
  S.gantt.groups.push({ id: uid(), name: 'Video launch', color: 0, collapsed: false, tasks: [a, b, c, d, e] }); gChanged();
}
function scrollToday() { const sc = $('gantt').querySelector('.g-scroll'); if (sc) sc.scrollTo({ left: Math.max(0, (todayN() - G.lo) * ZOOM[G.zoom] - 240), behavior: 'smooth' }); }

function taskMenu(e, id) {
  const t = gFind(id), g = gGroupOf(id), i = g.tasks.indexOf(t);
  ctxAt(e, [
    ['Edit details…', () => taskModal(t)],
    ['Rename', () => renameTask(id)],
    t.progress < 100 ? ['Mark complete', () => { t.progress = 100; gChanged(); }] : ['Reset progress', () => { t.progress = 0; gChanged(); }],
    i > 0 && ['Move up', () => { mv(g.tasks, i, -1); gChanged(); }],
    i < g.tasks.length - 1 && ['Move down', () => { mv(g.tasks, i, 1); gChanged(); }],
    null,
    ['Delete task', () => delTask(id), 'danger'],
  ].filter((x) => x !== false));
}
function groupMenu(e, gid) {
  const D = S.gantt, g = gGroup(gid), i = D.groups.indexOf(g);
  ctxAt(e, [
    ['Rename', () => renameGroup(gid)],
    ['Add task', () => { g.collapsed = false; G.focusAdd = gid; gChanged(); }],
    ['Change color', () => { g.color = (g.color + 1) % PAL.length; gChanged(); }],
    i > 0 && ['Move up', () => { mv(D.groups, i, -1); gChanged(); }],
    i < D.groups.length - 1 && ['Move down', () => { mv(D.groups, i, 1); gChanged(); }],
    null,
    ['Delete project', () => {
      const go = () => {
        const ids = new Set(g.tasks.map((t) => t.id)); D.groups.splice(i, 1);
        gTasks().forEach((t) => { t.deps = t.deps.filter((d) => !ids.has(d)); }); gChanged();
      };
      if (g.tasks.length) uiConfirm({ title: 'Delete this project?', msg: `“${g.name}” and its ${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'} will be deleted.`, ok: 'Delete', danger: true, cb: go }); else go();
    }, 'danger'],
  ].filter((x) => x !== false));
}

function taskModal(t) {
  const bad = descendants(t.id); bad.add(t.id);
  const cands = S.gantt.groups.flatMap((g) => g.tasks.filter((s) => !bad.has(s.id)).map((s) => ({ s, g })));
  const ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = `<div class="t-card g-card"><h3>Task details</h3>
    <div class="g-f"><label>Name</label><input class="g-in" id="gm-n" value="${esc(t.name).replace(/"/g, '&quot;')}"></div>
    <div class="g-row"><div class="g-f"><label>Start</label><input type="date" class="g-in" id="gm-s" value="${t.start}"></div><div class="g-f"><label>End</label><input type="date" class="g-in" id="gm-e" value="${t.end}"></div></div>
    <div class="g-f"><label>Progress <b id="gm-pv">${t.progress}%</b></label><input type="range" min="0" max="100" step="5" id="gm-p" value="${t.progress}"></div>
    <div class="g-f"><label>Starts after</label><div class="g-deps">${cands.length ? cands.map(({ s, g }) => `<label><input type="checkbox" value="${s.id}"${t.deps.includes(s.id) ? ' checked' : ''}><span>${esc(g.name)} · ${esc(s.name)}</span></label>`).join('') : '<span class="g-none">No other tasks yet</span>'}</div></div>
    <div class="g-f"><label>Notes</label><textarea id="gm-t">${esc(t.note || '')}</textarea></div>
    <div class="t-actions"><button data-a="del">Delete</button><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Save</button></div></div>`;
  const close = () => ov.remove(), q = (id) => ov.querySelector('#' + id);
  q('gm-p').oninput = () => { q('gm-pv').textContent = q('gm-p').value + '%'; };
  const ok = () => {
    let s = q('gm-s').value && dn(q('gm-s').value), e = q('gm-e').value && dn(q('gm-e').value);
    if (!s || !e) return;
    if (e < s) [s, e] = [e, s];
    t.name = q('gm-n').value.trim() || t.name; t.progress = +q('gm-p').value; t.note = q('gm-t').value.trim();
    t.deps = [...ov.querySelectorAll('.g-deps input:checked')].map((c) => c.value);
    t.deps.forEach((pid) => { const need = dn(gFind(pid).end) + 1; if (s < need) { e += need - s; s = need; } });
    t.start = ds(s); t.end = ds(e); cascade(t.id); close(); gChanged();
  };
  ov.onclick = (e) => {
    if (e.target === ov) close();
    const a = e.target.dataset && e.target.dataset.a;
    if (a === 'x') close(); if (a === 'ok') ok(); if (a === 'del') { close(); delTask(t.id); }
  };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.ctrlKey) ok(); };
  document.body.appendChild(ov); q('gm-n').focus(); q('gm-n').select();
}

function gTip(b, text) {
  tip.textContent = text; tip.hidden = false;
  const r = b.getBoundingClientRect(); let y = r.bottom + 6;
  if (y + tip.offsetHeight > innerHeight - 10) y = r.top - tip.offsetHeight - 6;
  tip.style.left = Math.max(10, Math.min(r.left, innerWidth - tip.offsetWidth - 10)) + 'px'; tip.style.top = y + 'px';
}

const gEl = $('gantt');
gEl.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (a) {
    const act = a.dataset.act;
    if (act.startsWith('z-')) { G.zoom = act.slice(2); renderGantt(true); }
    else if (act === 'today') scrollToday();
    else if (act === 'addproj') addProject();
    else if (act === 'example') loadExample();
    else if (act === 'gmenu') { e.stopPropagation(); groupMenu(e, a.closest('.g-r').dataset.gid); }
    return;
  }
  if (e.target.closest('.g-chev')) { const g = gGroup(e.target.closest('.g-grow').dataset.gid); g.collapsed = !g.collapsed; gChanged(); }
});
gEl.addEventListener('dblclick', (e) => {
  const bar = e.target.closest('.g-bar'); if (bar) { taskModal(gFind(bar.dataset.id)); return; }
  const nm = e.target.closest('.g-nm'); if (!nm) return;
  const row = nm.closest('.g-r');
  if (row.dataset.id) renameTask(row.dataset.id); else if (row.classList.contains('g-grow')) renameGroup(row.dataset.gid);
});
gEl.addEventListener('contextmenu', (e) => {
  const bar = e.target.closest('.g-bar'), tr = e.target.closest('.g-trow'), gr = e.target.closest('.g-grow');
  const id = (bar && bar.dataset.id) || (tr && tr.dataset.id);
  if (id) { e.preventDefault(); taskMenu(e, id); } else if (gr) { e.preventDefault(); groupMenu(e, gr.dataset.gid); }
});
gEl.addEventListener('keydown', (e) => {
  const i = e.target;
  if (i.classList && i.classList.contains('g-add') && e.key === 'Enter' && i.value.trim()) addTask(i.dataset.gid, i.value.trim());
});
gEl.addEventListener('mouseover', (e) => {
  if (G.drag) return;
  const b = e.target.closest('.g-bar'); if (b === G.hover) return;
  G.hover = b; if (!b) { tip.hidden = true; return; }
  const t = gFind(b.dataset.id); if (!t) return;
  const s = dn(t.start), en = dn(t.end);
  gTip(b, `${t.name}\n${fmtD(s)} → ${fmtD(en)} · ${en - s + 1} day${en > s ? 's' : ''}\n${t.progress}% complete` + (t.note ? `\n\n${t.note}` : ''));
});
gEl.addEventListener('mousedown', (e) => {
  const b = e.target.closest('.g-bar'); if (!b || e.button !== 0) return;
  const t = gFind(b.dataset.id); if (!t) return;
  e.preventDefault(); tip.hidden = true;
  const mode = e.target.classList.contains('g-h-l') ? 'l' : e.target.classList.contains('g-h-r') ? 'r' : 'move';
  G.drag = { id: t.id, mode, x0: e.clientX, s0: dn(t.start), e0: dn(t.end), last: 0, moved: false };
  G.lockLo = G.lo; G.lockHi = G.hi; document.body.classList.add('g-drag');
});
document.addEventListener('mousemove', (e) => {
  const k = G.drag; if (!k) return;
  const d = Math.round((e.clientX - k.x0) / ZOOM[G.zoom]); if (d === k.last) return;
  k.last = d; k.moved = true;
  const t = gFind(k.id), minS = Math.max(G.lockLo, ...t.deps.map((id) => { const p = gFind(id); return p ? dn(p.end) + 1 : -Infinity; }));
  let s = k.s0, en = k.e0;
  if (k.mode === 'move') { const dd = Math.max(d, minS - s); s += dd; en += dd; }
  else if (k.mode === 'l') s = Math.max(Math.min(s + d, en), minS);
  else en = Math.max(en + d, s);
  t.start = ds(s); t.end = ds(en); cascade(t.id); renderGantt();
});
document.addEventListener('mouseup', () => {
  const k = G.drag; if (!k) return;
  G.drag = null; G.lockLo = G.lockHi = null; document.body.classList.remove('g-drag');
  if (k.moved) { renderGantt(); clearTimeout(G.save); G.save = setTimeout(gSaveNow, 300); }
});
$('btn-gantt').onclick = showGantt;

/* ---------- pomodoro ---------- */
const P = {
  cfg: { focus: 25, short: 5, long: 15, rounds: 4, autoBreak: true, autoFocus: false, sound: true, notify: true, style: 'ring', tally: false },
  mode: 'focus', total: 1500, left: 1500, running: false, endAt: 0, round: 1, task: '', stats: {},
  tick: null, loaded: false, lit: -1, save: null,
};
const LIM = { focus: [1, 120], short: [1, 60], long: [1, 90], rounds: [2, 12] };
const MODES = { focus: 'Focus', short: 'Short break', long: 'Long break' };
const CIRC = 2 * Math.PI * 148;
const mmss = (s) => `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
const pk = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const pSaveSoon = () => { clearTimeout(P.save); P.save = setTimeout(() => api.saveData('Pomodoro.pomo.json', JSON.stringify({ cfg: P.cfg, stats: P.stats })), 400); };

async function showPomo() {
  if (S.view === 'pomo') { render(); return; }
  if (!P.loaded) {
    try { const d = JSON.parse(await api.loadData('Pomodoro.pomo.json')); Object.assign(P.cfg, d.cfg || {}); P.stats = d.stats || {}; } catch { /* first run */ }
    P.loaded = true;
    if (!P.running && P.left === P.total) { P.total = P.left = P.cfg[P.mode] * 60; }
  }
  await loadTasksData();
  setView('pomo'); renderPomo();
}

function chime() {
  if (!P.cfg.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), t0 = ctx.currentTime;
    [[659.25, 0], [783.99, 0.2], [1046.5, 0.4]].forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t0 + t); g.gain.linearRampToValueAtTime(0.18, t0 + t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 1.3);
      o.connect(g); g.connect(ctx.destination); o.start(t0 + t); o.stop(t0 + t + 1.4);
    });
    setTimeout(() => ctx.close(), 2500);
  } catch { /* no audio */ }
}
function notify(title, body) { if (P.cfg.notify && 'Notification' in window) { try { new Notification(title, { body, silent: true }); } catch { /* ignore */ } } }

function start() {
  if (P.running) return;
  if (P.left <= 0) P.left = P.total;
  P.running = true; P.endAt = Date.now() + P.left * 1000;
  clearInterval(P.tick); P.tick = setInterval(ptick, 250); renderPomo();
}
function pause() {
  if (!P.running) return;
  P.left = Math.max(0, Math.ceil((P.endAt - Date.now()) / 1000)); clearInterval(P.tick); P.running = false; renderPomo();
}
function resetT() { clearInterval(P.tick); P.running = false; P.left = P.total; renderPomo(); }
function ptick() {
  P.left = Math.max(0, Math.ceil((P.endAt - Date.now()) / 1000));
  if (P.left <= 0) finish(); else updPomo();
}
function finish() {
  clearInterval(P.tick); P.running = false; chime();
  if (P.mode === 'focus') notify('Focus complete', P.round >= P.cfg.rounds ? 'Great work. Time for a long break.' : 'Nice one. Take a short break.');
  else notify('Break over', 'Ready to focus?');
  advance(true);
}
function setMode(m, auto) {
  clearInterval(P.tick); P.running = false; P.mode = m; P.total = P.left = P.cfg[m] * 60;
  renderPomo(); if (auto) start();
}
function advance(record) {
  const wasFocus = P.mode === 'focus';
  if (wasFocus && record) { const k = pk(new Date()), s = P.stats[k] || (P.stats[k] = { n: 0, min: 0 }); s.n++; s.min += P.cfg.focus; pSaveSoon(); }
  let next;
  if (wasFocus) next = P.round >= P.cfg.rounds ? 'long' : 'short';
  else { P.round = P.mode === 'long' ? 1 : P.round + 1; next = 'focus'; }
  setMode(next, record && (wasFocus ? P.cfg.autoBreak : P.cfg.autoFocus));
}

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z"/></svg>',
};

const STY = [['ring', 'Ring'], ['glass', 'Hourglass'], ['meter', 'Level meter'], ['term', 'Terminal'], ['flip', 'Flip clock']];
const GLASS = 'M36 20H164V40Q164 104 108 146V154Q164 196 164 260V280H36V260Q36 196 92 154V146Q36 104 36 40Z';
const dotsHtml = () => {
  const done = P.mode === 'focus' ? P.round - 1 : P.round;
  return Array.from({ length: P.cfg.rounds }, (_, i) => `<i class="p-dot${i < done ? ' on' : ''}${P.mode === 'focus' && i === P.round - 1 ? ' cur' : ''}"></i>`).join('');
};
const flipHtml = (t) => [...t].map((ch) => (ch === ':' ? '<i class="pfc">:</i>' : `<b class="pf">${ch}</b>`)).join('');

function visual() {
  const st = P.cfg.style, t = mmss(P.left), lab = `<div class="p-lab">${MODES[P.mode]}</div>`, dots = `<div class="p-dots">${dotsHtml()}</div>`;
  if (st === 'glass') {
    return `<div class="p-glass"><svg viewBox="0 0 200 300"><defs><clipPath id="gclip"><path d="${GLASS}"/></clipPath><linearGradient id="gsand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--pa)"/><stop offset="1" style="stop-color:var(--pb)"/></linearGradient></defs>
      <g clip-path="url(#gclip)"><rect id="g-top" class="p-sand" x="30" width="140"/><rect id="g-bot" class="p-sand" x="30" width="140"/><line id="g-str" class="p-stream" x1="100" x2="100"/></g>
      <path d="${GLASS}" class="p-gl"/><rect x="24" y="8" width="152" height="12" rx="5" class="p-gcap"/><rect x="24" y="280" width="152" height="12" rx="5" class="p-gcap"/></svg>
      <div class="p-gt">${lab}<div class="p-time" id="p-time">${t}</div>${dots}</div></div>`;
  }
  if (st === 'meter') {
    return `<div class="p-meter">${lab}<div class="p-time" id="p-time">${t}</div><div class="p-leds" id="p-leds">${Array.from({ length: 40 }, (_, i) => `<i style="--t:${(i / 39 * 100).toFixed(0)}%;height:${(30 + i / 39 * 70).toFixed(0)}%"></i>`).join('')}</div><div class="p-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100%</span></div>${dots}</div>`;
  }
  if (st === 'term') {
    return `<div class="p-term"><div class="p-tl dim">signal-path ~ focus --session ${P.round}/${P.cfg.rounds}</div>${lab}<div class="p-time" id="p-time">${t}</div><div class="p-tbar" id="p-tbar"></div><div class="p-tlines" id="p-tlines"></div></div>`;
  }
  if (st === 'flip') return `<div class="p-flip">${lab}<div class="p-fl" id="p-fl">${flipHtml(t)}</div>${dots}</div>`;
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const a = (i * 6 - 90) * Math.PI / 180, r1 = i % 5 === 0 ? 166 : 171, r2 = 187;
    ticks += `<line class="p-tk${i % 5 === 0 ? ' m' : ''}" x1="${(200 + r1 * Math.cos(a)).toFixed(1)}" y1="${(200 + r1 * Math.sin(a)).toFixed(1)}" x2="${(200 + r2 * Math.cos(a)).toFixed(1)}" y2="${(200 + r2 * Math.sin(a)).toFixed(1)}"/>`;
  }
  return `<div class="p-ring"><svg viewBox="0 0 400 400"><defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--pa)"/><stop offset="1" style="stop-color:var(--pb)"/></linearGradient></defs>
    <circle class="p-inner" cx="200" cy="200" r="124"/>${ticks}<circle class="p-track" cx="200" cy="200" r="148"/>
    <circle class="p-prog" id="p-prog" cx="200" cy="200" r="148" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/></svg>
    <div class="p-center">${lab}<div class="p-time" id="p-time">${t}</div>${dots}</div></div>`;
}

function renderPomo() {
  const m = document.querySelector('#pomo .p-msubs'), st = m ? m.scrollTop : 0;
  renderPomoRaw();
  const n = st && document.querySelector('#pomo .p-msubs'); if (n) n.scrollTop = st;
}
function renderPomoRaw() {
  const el = $('pomo'), c = P.cfg; el.dataset.mode = P.mode; P.lit = -1; P.noteEl = null;
  const today = pk(new Date()), st = P.stats[today] || { n: 0, min: 0 };
  const step = (k, label, unit) => `<div class="p-row"><span>${label}</span><div class="p-step"><button data-k="${k}" data-d="-1">−</button><b>${c[k]}${unit}</b><button data-k="${k}" data-d="1">+</button></div></div>`;
  const sw = (k, label) => `<div class="p-row"><span>${label}</span><button class="p-sw${c[k] ? ' on' : ''}" data-t="${k}"><i></i></button></div>`;
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return { d, n: (P.stats[pk(d)] || { n: 0 }).n }; });
  const mx = Math.max(1, ...days.map((x) => x.n));
  const week = days.map((x, i) => `<div class="p-col"><i class="p-bar${x.n ? '' : ' empty'}${i === 6 ? ' today' : ''}" style="height:${x.n ? Math.max(6, x.n / mx * 52) : 3}px" title="${x.n} session${x.n === 1 ? '' : 's'}"></i><small>${'SMTWTFS'[x.d.getDay()]}</small></div>`).join('');
  el.innerHTML = `
    <div class="t-head"><div><h1>Pomodoro</h1><div class="t-sub">Today · ${st.n} session${st.n === 1 ? '' : 's'} · ${st.min} min of focus</div></div></div>
    <div class="p-wrap">
      <div class="p-stage">
        <div class="seg p-modes">${Object.entries(MODES).map(([m, l]) => `<button data-m="${m}" class="${P.mode === m ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${visual()}
        <div class="p-ctrl"><button class="p-btn" id="p-reset" title="Reset">${ICON.reset}</button><button class="p-go" id="p-go" title="Start / pause (Space)">${P.running ? ICON.pause : ICON.play}</button><button class="p-btn" id="p-skip" title="Skip to next">${ICON.skip}</button></div>
        ${mullHtml()}
        <div class="p-tally" id="p-tally" hidden></div>
      </div>
      <aside class="p-side">
        <div class="p-card"><h3>Timer</h3>${step('focus', 'Focus', ' min')}${step('short', 'Short break', ' min')}${step('long', 'Long break', ' min')}${step('rounds', 'Rounds before long break', '')}</div>
        <div class="p-card"><h3>Automation &amp; alerts</h3>${sw('autoBreak', 'Auto-start breaks')}${sw('autoFocus', 'Auto-start focus')}${sw('sound', 'Chime when done')}${sw('notify', 'Desktop notification')}</div>
        <div class="p-card"><h3>Your focus</h3><div class="p-stats"><div class="p-stat"><b>${st.n}</b><small>sessions today</small></div><div class="p-stat"><b>${st.min}</b><small>minutes today</small></div></div><div class="p-week">${week}</div></div>
        <div class="p-card"><h3>Look</h3><select class="p-sel">${STY.map(([k, l]) => `<option value="${k}"${c.style === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
        ${workHtml()}
      </aside>
    </div>`;
  updPomo(); updTally();
}

function updPomo() {
  const frac = P.total ? 1 - P.left / P.total : 0, st = P.cfg.style, t = mmss(P.left), pt = $('p-time');
  if (pt) pt.textContent = t;
  if (st === 'glass' && $('g-top')) {
    const th = 130 * (1 - frac), bh = 130 * frac, s = $('g-str');
    $('g-top').setAttribute('y', 150 - th); $('g-top').setAttribute('height', th);
    $('g-bot').setAttribute('y', 280 - bh); $('g-bot').setAttribute('height', bh);
    s.setAttribute('y1', 148); s.setAttribute('y2', 280 - bh); s.style.display = P.running && frac < 1 ? '' : 'none';
  } else if (st === 'meter' && $('p-leds')) {
    const n = Math.round(frac * 40);
    if (n !== P.lit) { P.lit = n; $('p-leds').querySelectorAll('i').forEach((l, i) => l.classList.toggle('on', i < n)); }
  } else if (st === 'term' && $('p-tbar')) {
    const n = Math.round(frac * 30), state = P.running ? 'RUNNING' : P.left === P.total ? 'READY' : 'PAUSED';
    $('p-tbar').textContent = `[${'█'.repeat(n)}${'░'.repeat(30 - n)}] ${Math.round(frac * 100)}%`;
    $('p-tlines').innerHTML = `<div>&gt; mode     ${MODES[P.mode].toUpperCase()}</div><div>&gt; task     ${esc(mullText()) || '–'}</div><div>&gt; elapsed  ${mmss(P.total - P.left)}</div><div>&gt; status   ${state}<span class="p-cur">█</span></div>`;
  } else if (st === 'flip' && $('p-fl')) {
    const cs = [...$('p-fl').querySelectorAll('.pf')], chars = t.replace(':', '').split('');
    if (cs.length !== chars.length) $('p-fl').innerHTML = flipHtml(t);
    else cs.forEach((c, i) => { if (c.textContent !== chars[i]) { c.textContent = chars[i]; c.classList.remove('flip'); void c.offsetWidth; c.classList.add('flip'); } });
  } else if ((st === 'ring' || !st) && $('p-prog')) {
    $('p-prog').style.strokeDashoffset = CIRC * (1 - frac);
    const n = Math.floor(frac * 60);
    if (n !== P.lit) { P.lit = n; $('pomo').querySelectorAll('.p-tk').forEach((k, i) => k.classList.toggle('on', i < n)); }
  }
  const b = $('btn-pomo'); b.textContent = P.running ? `${P.mode === 'focus' ? '●' : '☕'} ${mmss(P.left)}` : 'Pomodoro'; b.classList.toggle('live', P.running);
  document.title = P.running ? `${mmss(P.left)} · ${MODES[P.mode]}` : 'Signal Path';
}

$('pomo').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mull) { mullAct(b.dataset.mull, b.dataset.sid); return; }
  if (b.dataset.sty) { P.cfg.style = b.dataset.sty; pSaveSoon(); renderPomo(); }
  else if (b.dataset.m) setMode(b.dataset.m, false);
  else if (b.dataset.k) {
    const k = b.dataset.k, [lo, hi] = LIM[k];
    P.cfg[k] = Math.max(lo, Math.min(hi, P.cfg[k] + +b.dataset.d));
    if (!P.running && P.left === P.total) P.total = P.left = P.cfg[P.mode] * 60;
    if (k === 'rounds') P.round = Math.min(P.round, P.cfg.rounds);
    pSaveSoon(); renderPomo();
  } else if (b.dataset.t) { const k = b.dataset.t; P.cfg[k] = !P.cfg[k]; if (k === 'sound' && P.cfg.sound) chime(); pSaveSoon(); renderPomo(); }
  else if (b.id === 'p-go') { if (P.running) pause(); else start(); }
  else if (b.id === 'p-reset') resetT();
  else if (b.id === 'p-skip') advance(false);
});
$('pomo').addEventListener('change', (e) => { if (e.target.classList.contains('p-sel')) { P.cfg.style = e.target.value; pSaveSoon(); renderPomo(); } else if (e.target.hasAttribute('data-wo')) setWorkOnly(e.target.checked); else if (e.target.hasAttribute('data-tally')) { P.cfg.tally = e.target.checked; pSaveSoon(); updTally(); } });
document.addEventListener('keydown', (e) => {
  if (!isV('pomo') || e.code !== 'Space' || /INPUT|TEXTAREA|BUTTON|SELECT/.test(e.target.tagName)) return;
  e.preventDefault(); if (P.running) pause(); else start();
});
window.addEventListener('beforeunload', () => { if (P.save) { clearTimeout(P.save); api.saveData('Pomodoro.pomo.json', JSON.stringify({ cfg: P.cfg, stats: P.stats })); } });
$('btn-pomo').onclick = showPomo;


/* ---------- health ---------- */
/* health:data:start */
const HK = [
  { k: 'weight', name: 'Weight', color: TC.a3, dur: false },
  { k: 'cal', name: 'Calories', color: TC.amb, dur: false },
  { k: 'pro', name: 'Protein', color: TC.mag, dur: false },
  { k: 'card', name: 'Cardio', color: TC.grn, dur: true },
  { k: 'sleep', name: 'Sleep', color: TC.a2, dur: true },
  { k: 'steps', name: 'Steps', color: TC.rose, dur: false },
];
const HD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DK = ['weight', 'cal', 'pro', 'card', 'steps', 'sleep'];
const OK = ['weight', 'cal', 'pro', 'card', 'steps', 'sleep'];
const DUR = new Set(['card', 'sleep']);
const H = { year: new Date().getFullYear(), w: [], meat: [], sel: 0, range: 'all', show: { weight: true, cal: true }, saveT: null, created: false, loaded: false, geo: null };
const mon = (n) => new Date(n * 864e5).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' });
const dayLbl = (n) => `${mon(n)} ${new Date(n * 864e5).getUTCDate()}`;
const fmtDur = (m) => { if (m == null) return ''; m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
function parseDur(s) {
  s = String(s == null ? '' : s).trim().toLowerCase(); if (!s) return null; let m;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?\s*(?:(\d+)\s*m?(?:in)?)?$/))) return Math.round(+m[1] * 60 + (+m[2] || 0));
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*m(?:ins?)?$/))) return Math.round(+m[1]);
  if (/^\d+(?:\.\d+)?$/.test(s)) return Math.round(+s);
  return null;
}
const parseNum = (s) => { const v = parseFloat(String(s == null ? '' : s).replace(/,/g, '')); return Number.isFinite(v) ? v : null; };
const rd = (k, s) => (DUR.has(k) ? parseDur(s) : parseNum(s));
const inStr = (k, v) => (v == null ? '' : DUR.has(k) ? fmtDur(v) : String(v));
const cell = (k, v, round) => (v == null ? '' : DUR.has(k) ? fmtDur(v) : k === 'weight' ? String(round ? Math.round(v * 10) / 10 : v) : String(round ? Math.round(v) : v));
const fmtVal = (k, v) => (v == null ? '' : DUR.has(k) ? fmtDur(v) : k === 'weight' ? v.toFixed(1) : String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
const pipe = (s) => String(s || '').replace(/\|/g, '/').replace(/\r?\n/g, ' ');
const sum = (a) => a.reduce((x, y) => x + y, 0);
const avgOf = (a) => (a.length ? sum(a) / a.length : null);
const vals = (w, k) => w.days.map((d) => d[k]).filter((v) => v != null);

function genWeeks(year) {
  const j1 = dn(`${year}-01-01`), j31 = dn(`${year}-12-31`), s0 = j1 - ((j1 + 3) % 7), out = [];
  for (let s = s0, i = 1; s <= j31; s += 7, i++) {
    const ms = [...new Set(Array.from({ length: 7 }, (_, d) => mon(s + d)))];
    out.push({ n: i, start: s, months: ms.join(' · '), mid: mon(s + 3), days: Array.from({ length: 7 }, () => ({})), ov: {} });
  }
  return out;
}
function toMdH() {
  let o = `---\ntype: health\nyear: ${H.year}\n---\n# Health ${H.year}\n\nWeight in lb. Cardio and sleep are shown as hours and minutes. Weeks run Monday to Sunday, and week 1 is the week that contains 1 January.\n\n## Year overview\n| Week | Dates | Months | Weight | Calories | Protein | Cardio | Steps | Sleep |\n|---|---|---|---|---|---|---|---|---|\n`;
  H.w.forEach((w) => { o += `| ${w.n} | ${dayLbl(w.start)} – ${dayLbl(w.start + 6)} | ${w.months} | ${OK.map((k) => cell(k, w.ov[k])).join(' | ')} |\n`; });
  o += '\n## Meat schedule\n| Day | Meat | Notes |\n|---|---|---|\n';
  H.meat.forEach((m, i) => { o += `| ${HD[i]} | ${pipe(m.meat)} | ${pipe(m.notes)} |\n`; });
  const logged = H.w.filter((w) => w.days.some((d) => DK.some((k) => d[k] != null)));
  if (logged.length) {
    o += '\n## Daily logs\n';
    logged.forEach((w) => {
      o += `\n### Week ${w.n} · ${dayLbl(w.start)} – ${dayLbl(w.start + 6)}\n| Day | Weight | Calories | Protein | Cardio | Steps | Sleep |\n|---|---|---|---|---|---|---|\n`;
      w.days.forEach((d, i) => { o += `| ${HD[i]} | ${DK.map((k) => cell(k, d[k])).join(' | ')} |\n`; });
      o += `| **Weekly summary** | ${DK.map((k) => (k === 'card' ? cell(k, vals(w, k).length ? sum(vals(w, k)) : null) : cell(k, avgOf(vals(w, k)), true))).join(' | ')} |\n`;
    });
  }
  return o;
}
function fromMdH(text) {
  let sec = '', wk = null, dcols = null;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*/g, ''));
  for (const l of text.split(/\r?\n/)) {
    let m;
    if ((m = l.match(/^## (.+)/))) { sec = m[1].trim().toLowerCase(); wk = null; continue; }
    if ((m = l.match(/^### Week (\d+)/))) { wk = H.w.find((w) => w.n === +m[1]) || null; continue; }
    if (!l.startsWith('|')) continue;
    const c = cells(l);
    if (sec === 'year overview') { const w = H.w.find((x) => x.n === +c[0]); if (w) OK.forEach((k, i) => { w.ov[k] = rd(k, c[3 + i]); }); }
    else if (sec === 'meat schedule') { const i = HD.indexOf(c[0]); if (i >= 0) H.meat[i] = { meat: c[1] || '', notes: c[2] || '' }; }
    else if (sec === 'daily logs' && wk) {
      if (c[0] === 'Day') dcols = c.slice(1).map((h) => ({ weight: 'weight', calories: 'cal', protein: 'pro', cardio: 'card', steps: 'steps', sleep: 'sleep' })[h.toLowerCase()]);
      else { const i = HD.indexOf(c[0]); if (i >= 0) (dcols || DK).forEach((k, j) => { if (k) wk.days[i][k] = rd(k, c[1 + j]); }); }
    }
  }
}
/* health:data:end */

async function showHealth(year, force) {
  if (S.view === 'health' && year == null && !force) { render(); return; }
  if (H.saveT) await hSaveNow();
  await loadHealth(year == null ? (H.loaded ? H.year : new Date().getFullYear()) : year);
  setView('health'); renderHealth();
}
async function loadHealth(year) {
  H.year = year; H.w = genWeeks(year); H.meat = HD.map(() => ({ meat: '', notes: '' }));
  const text = await api.healthLoad(year); H.created = !!text; if (text) fromMdH(text);
  const t = todayN(), ci = H.w.findIndex((w) => t >= w.start && t <= w.start + 6);
  H.sel = ci >= 0 ? ci : 0; H.loaded = true;
}
function hSaveSoon() { uNote('health'); clearTimeout(H.saveT); H.saveT = setTimeout(hSaveNow, 500); }
async function hSaveNow() { clearTimeout(H.saveT); H.saveT = null; await api.healthSave(H.year, toMdH()); if (!H.created) { H.created = true; refreshTree(); } }
window.addEventListener('beforeunload', () => { if (H.saveT) api.healthSave(H.year, toMdH()); });

const ovSeries = (k) => H.w.map((w) => (w.ov[k] == null ? null : w.ov[k]));
const hasData = (w) => OK.some((k) => w.ov[k] != null);
const lastIdx = () => { let L = -1; H.w.forEach((w, i) => { if (hasData(w)) L = i; }); return L; };
const lastN = (k, n) => ovSeries(k).filter((v) => v != null).slice(-n);

function renderHealth() {
  const el = $('health');
  const gym = H.tab === 'gym';
  el.innerHTML = `<div class="t-head"><div><h1 class="h-titles"><span class="h-ttl${gym ? '' : ' on'}" data-ht="health">Health</span><span class="h-ttl${gym ? ' on' : ''}" data-ht="gym">Gym</span></h1><div class="t-sub" id="h-sub"></div></div>
    ${gym ? '' : `<div class="g-tools"><button data-h="prev">‹</button><b class="h-yr">${H.year}</b><button data-h="next">›</button></div>`}</div>
    ${gym ? '<div class="h-scroll gym" id="gym-root"></div>' : ''}
    <div class="h-scroll"${gym ? ' hidden' : ''}><div class="h-stats" id="h-stats"></div><div class="p-card" id="h-main"></div><div class="h-grid" id="h-minis"></div>
      <div class="h-cols"><div class="h-colL"><div class="p-card" id="h-daily"></div><div class="p-card" id="h-food"></div><div class="p-card" id="h-meat"></div></div><div class="p-card h-colR" id="h-year"></div></div></div>`;
  if (gym) { gymRender(); return; }
  hCharts(); renderHDaily(); renderHFood(); renderHMeat(); renderHYear();
}
function hCharts() {
  const n = H.w.filter(hasData).length;
  $('h-sub').textContent = `${H.year} · ${n} of ${H.w.length} weeks logged`;
  renderHStats(); renderHMain(); renderHMinis();
}

function spark(v, color) {
  if (v.length < 2) return '<svg class="h-spark" viewBox="0 0 120 34"></svg>';
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1, id = 'sg' + color.slice(1);
  const d = 'M' + v.map((x, i) => `${(4 + i * (112 / (v.length - 1))).toFixed(1)} ${(30 - ((x - mn) / r) * 26).toFixed(1)}`).join(' L');
  return `<svg class="h-spark" viewBox="0 0 120 34"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${d} L116 34 L4 34 Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function renderHStats() {
  $('h-stats').innerHTML = HK.filter((x) => x.k !== 'steps').map((x) => {
    const all = lastN(x.k, 99), recent = all.slice(-4); let big = '', sub = 'No data yet';
    if (all.length) {
      if (x.k === 'weight') {
        const ws = ovSeries('weight'); let li = ws.length - 1; while (li >= 0 && ws[li] == null) li--;
        let pi = li - 4; while (pi >= 0 && ws[pi] == null) pi--;
        big = fmtVal('weight', ws[li]) + '<em>lb</em>';
        if (pi >= 0) { const d = ws[li] - ws[pi]; sub = `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)} lb since 4 weeks ago`; } else sub = 'Not enough history yet';
      }
      else { big = fmtVal(x.k, avgOf(recent)) + (x.k === 'cal' ? '<em>kcal</em>' : x.k === 'pro' ? '<em>g</em>' : ''); sub = x.k === 'sleep' ? 'avg per night, last 4 weeks' : x.k === 'card' ? 'avg weekly total, last 4 weeks' : 'avg, last 4 weeks'; }
    }
    return `<div class="h-stat" style="--c:${x.color}"><small>${x.name}</small><b>${big || '–'}</b><small>${sub}</small>${spark(all.slice(-12), x.color)}</div>`;
  }).join('');
}

function visibleIdx() {
  const n = H.w.length, L = Math.max(lastIdx(), 0), first = H.w.findIndex(hasData);
  if (H.range === 'year') return [...Array(n).keys()];
  if (H.range === '12') { const len = Math.min(12, L + 1); return Array.from({ length: len }, (_, i) => L - len + 1 + i); }
  const a = first < 0 ? 0 : first, b = Math.min(n - 1, Math.max(L, a + 7));
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
function smooth(p) {
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
    d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function segments(pts, X, Y) {
  const out = []; let seg = [];
  pts.forEach((p) => { if (p) seg.push([X(p[0]), Y(p[1])]); else { if (seg.length) out.push(seg); seg = []; } });
  if (seg.length) out.push(seg);
  return out;
}
function chartSVG(idx, act, W0) {
  const Wd = W0 || 900, Ht = 300, L = 60, R = 60, T = 16, Bm = 46, pw = Wd - L - R, ph = Ht - T - Bm, n = idx.length;
  const X = (j) => L + (n === 1 ? pw / 2 : (j / (n - 1)) * pw), bottom = T + ph;
  let defs = '', body = '', axes = '', grid = '';
  for (let g = 0; g <= 4; g++) { const y = T + (g / 4) * ph; grid += `<line x1="${L}" x2="${Wd - R}" y1="${y}" y2="${y}" class="h-grid-l"/>`; }
  const used = [];
  act.forEach((s) => {
    const pts = idx.map((i, j) => (H.w[i].ov[s.k] == null ? null : [j, H.w[i].ov[s.k]])), vs = pts.filter(Boolean).map((p) => p[1]);
    if (!vs.length) return;
    let mn = Math.min(...vs), mx = Math.max(...vs); const pad = (mx - mn || Math.abs(mx) * 0.1 || 1) * 0.14; mn -= pad; mx += pad;
    const Y = (v) => T + (1 - (v - mn) / (mx - mn)) * ph, first = used.length === 0;
    used.push({ s, pts, Y, mn, mx });
    defs += `<linearGradient id="ag-${s.k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".30"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
    segments(pts, X, Y).forEach((seg) => {
      if (seg.length > 1) {
        if (first) body += `<path d="${smooth(seg)} L${seg[seg.length - 1][0].toFixed(1)} ${bottom} L${seg[0][0].toFixed(1)} ${bottom} Z" fill="url(#ag-${s.k})"/>`;
        body += `<path d="${smooth(seg)}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round" style="filter:drop-shadow(0 0 5px ${s.color})"/>`;
      }
      if (n <= 30 || seg.length === 1) seg.forEach((p) => { body += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${s.color}"/>`; });
    });
  });
  (() => { const wu = used.find((u) => u.s.k === 'weight'), lu = wu ? used.find((u) => u !== wu) : used[0], ru = wu || used[1]; return [[lu, 'start', L - 10], [ru, 'end', Wd - R + 10]]; })().forEach(([u, anchor, x]) => {
    if (!u) return;
    for (let g = 0; g <= 4; g++) { const v = u.mn + (1 - g / 4) * (u.mx - u.mn); axes += `<text x="${x}" y="${T + (g / 4) * ph + 4}" text-anchor="${anchor === 'start' ? 'end' : 'start'}" fill="${u.s.color}" class="h-ax">${fmtVal(u.s.k, v)}</text>`; }
  });
  const step = n > 26 ? 4 : n > 12 ? 2 : 1; let xl = '';
  idx.forEach((i, j) => { if (j % step === 0) xl += `<text x="${X(j).toFixed(1)}" y="${Ht - 24}" text-anchor="middle" class="h-ax">W${H.w[i].n}</text><text x="${X(j).toFixed(1)}" y="${Ht - 9}" text-anchor="middle" class="h-ax dim">${H.w[i].mid}</text>`; });
  H.geo = { X, n, L, pw, Wd, used, top: T, bottom };
  return `<div class="h-chart"><svg viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}"><defs>${defs}</defs>${grid}${body}${axes}${xl}<line id="h-vl" y1="${T}" y2="${bottom}" class="h-vl" style="display:none"/>${used.map((u) => `<circle id="h-dot-${u.s.k}" r="5" fill="${u.s.color}" stroke="#0a0a0f" stroke-width="2" style="display:none"/>`).join('')}</svg><div class="h-tip"></div></div>`;
}
function bindHover(idx) {
  const box = $('h-main').querySelector('.h-chart'), svg = box.querySelector('svg'), tp = box.querySelector('.h-tip'), g = H.geo, vl = $('h-vl');
  box.onmousemove = (e) => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (g.Wd / r.width);
    const j = g.n === 1 ? 0 : Math.max(0, Math.min(g.n - 1, Math.round(((x - g.L) / g.pw) * (g.n - 1)))), w = H.w[idx[j]], gx = g.X(j);
    vl.setAttribute('x1', gx); vl.setAttribute('x2', gx); vl.style.display = '';
    let rows = '';
    g.used.forEach((u) => {
      const dot = $('h-dot-' + u.s.k), v = u.pts[j] ? u.pts[j][1] : null;
      if (v == null) { dot.style.display = 'none'; return; }
      dot.setAttribute('cx', gx); dot.setAttribute('cy', u.Y(v)); dot.style.display = '';
      rows += `<div><i style="background:${u.s.color}"></i>${u.s.name} <b>${fmtVal(u.s.k, v)}</b></div>`;
    });
    tp.innerHTML = `<strong>Week ${w.n} · ${dayLbl(w.start)} – ${dayLbl(w.start + 6)}</strong>${rows || '<div class="dim">No data</div>'}`; tp.style.display = 'block';
    const px = (gx / g.Wd) * r.width; tp.style.left = (px > r.width - 230 ? px - tp.offsetWidth - 14 : px + 14) + 'px';
  };
  box.onmouseleave = () => { tp.style.display = 'none'; vl.style.display = 'none'; g.used.forEach((u) => { $('h-dot-' + u.s.k).style.display = 'none'; }); };
}
function renderHMain() {
  const idx = visibleIdx(), act = HK.filter((x) => H.show[x.k]), el = $('h-main');
  const chips = HK.map((x) => `<button class="h-chip${H.show[x.k] ? ' on' : ''}" data-h="tog" data-k="${x.k}" style="--c:${x.color}"><i></i>${x.name}</button>`).join('');
  const rng = [['all', 'All data'], ['12', 'Last 12 weeks'], ['year', 'Full year']].map(([v, l]) => `<button data-h="range" data-v="${v}" class="${H.range === v ? 'on' : ''}">${l}</button>`).join('');
  const has = act.some((x) => idx.some((i) => H.w[i].ov[x.k] != null));
  el.innerHTML = `<div class="h-ch"><h3>Trends</h3><div class="h-chips">${chips}</div><div class="seg">${rng}</div></div>` +
    (has ? chartSVG(idx, act, chartW('h-main')) : `<div class="h-empty">${act.length ? 'Add weekly values in the year table below and your trends will show up here.' : 'Switch on at least one measure above.'}</div>`);
  if (has) bindHover(idx);
}

function bars(v, labels, color, fmt, line) {
  const w = 440, h = 170, L = 40, B = 24, T = 10, n = v.length, step = (w - L - 6) / Math.max(n, 1), bw = Math.max(3, Math.min(26, step * 0.6)), mx = Math.max(...v.filter((x) => x != null), 1), ph = h - T - B, id = 'bg' + color.slice(1);
  let s = `<svg viewBox="0 0 ${w} ${h}" class="h-svg"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".25"/></linearGradient></defs>`;
  for (let g = 0; g <= 2; g++) { const y = T + (g / 2) * ph; s += `<line x1="${L}" x2="${w - 4}" y1="${y}" y2="${y}" class="h-grid-l"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" class="h-ax">${fmt(mx * (1 - g / 2))}</text>`; }
  v.forEach((x, i) => {
    const cx = L + step * i + step / 2;
    if (x != null) { const bh = (x / mx) * ph; s += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(T + ph - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#${id})" style="filter:drop-shadow(0 0 4px ${color}66)"><title>${labels[i]} · ${fmt(x)}</title></rect>`; }
    if (n <= 14 || i % Math.ceil(n / 12) === 0) s += `<text x="${cx.toFixed(1)}" y="${h - 7}" text-anchor="middle" class="h-ax">${labels[i]}</text>`;
  });
  if (line) {
    const lv = line.v.filter((x) => x != null);
    if (lv.length) {
      const mn = Math.min(...lv), hi = Math.max(...lv), r = hi - mn || 1, pts = line.v.map((x, i) => (x == null ? null : [i, x]));
      segments(pts, (i) => L + step * i + step / 2, (x) => T + 6 + (1 - (x - mn) / r) * (ph - 12)).forEach((seg) => {
        if (seg.length > 1) s += `<path d="${smooth(seg)}" fill="none" stroke="${line.color}" stroke-width="2" style="filter:drop-shadow(0 0 4px ${line.color})"/>`;
        seg.forEach((p) => { s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${line.color}"/>`; });
      });
    }
  }
  return s + '</svg>';
}
function renderHMinis() {
  const t = todayN(), n = H.w.filter(hasData).length;
  const heat = H.w.map((w) => `<i class="h-cell${hasData(w) ? ' on' : ''}${t >= w.start && t <= w.start + 6 ? ' cur' : ''}" title="Week ${w.n} · ${dayLbl(w.start)} – ${dayLbl(w.start + 6)}${hasData(w) ? '' : ' · nothing logged'}"></i>`).join('');
  $('h-minis').innerHTML = `<div class="p-card"><div class="h-ch"><h3>Weeks logged</h3><span class="h-hint">${n} of ${H.w.length}</span></div><div class="h-heat">${heat}</div></div>`;
}
function renderHDaily() {
  const w = H.w[H.sel], el = $('h-daily');
  const rows = HD.map((d, i) => `<tr><td class="dn">${d}<small>${new Date((w.start + i) * 864e5).getUTCDate()}</small></td>${DK.map((k) => `<td><input class="h-in" data-s="d" data-r="${i}" data-c="${k}" value="${inStr(k, w.days[i][k])}"></td>`).join('')}</tr>`).join('');
  el.innerHTML = `<div class="h-ch"><h3>Week log</h3><div class="h-wk"><button data-h="wprev">‹</button><span>Week ${w.n} · ${dayLbl(w.start)} – ${dayLbl(w.start + 6)}</span><button data-h="wnext">›</button></div></div>
    <table class="h-tbl h-wtbl"><thead><tr><th>Day</th><th>Weight</th><th>Calories</th><th>Protein</th><th>Cardio</th><th>Steps</th><th>Sleep</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td></td>${DK.map((k) => `<td id="h-avg-${k}"></td>`).join('')}</tr></tfoot></table>
    <div class="h-actions"><button data-h="fill" title="Writes this week's average weight, calories, protein, steps and sleep, and total cardio, into the year table">Copy to year table</button><span class="h-hint">Cardio and sleep accept 7h 30m, 7:30 or plain minutes.</span></div>`;
  hFoot();
}
function hFoot() {
  const w = H.w[H.sel];
  DK.forEach((k) => { const v = vals(w, k); $('h-avg-' + k).textContent = v.length ? (k === 'card' ? cell(k, sum(v)) : cell(k, avgOf(v), true)) : ''; });
}
/* ---------- Food log: one plain text area; the text stays until you delete it (FoodLog.json) ---------- */
const HF = { text: null, t: null, loading: false };
function hfSave(now) {
  clearTimeout(HF.t);
  const run = () => { HF.t = null; try { api.saveData('FoodLog.json', JSON.stringify({ note: HF.text || '' })); } catch (e) { /* ignore */ } };
  if (now) run(); else HF.t = setTimeout(run, 400);
}
window.addEventListener('beforeunload', () => { if (HF.t) hfSave(true); });
async function hfLoad() {
  if (HF.text != null || HF.loading) return; HF.loading = true;
  let txt = '';
  try {
    const d = JSON.parse((await api.loadData('FoodLog.json')) || '{}');
    if (typeof d.note === 'string') txt = d.note;
    else { const k = Object.keys(d).filter((x) => typeof d[x] === 'string').sort().pop(); if (k) txt = d[k]; } // carry over text typed in 3.6
  } catch (e) { txt = ''; }
  HF.text = txt; HF.loading = false; renderHFood();
}
function renderHFood() {
  const el = $('h-food'); if (!el) return;
  if (HF.text == null) hfLoad();
  el.innerHTML = `<div class="h-ch"><h3>Food log</h3></div>
    <textarea class="h-food-ta" id="h-foodta" spellcheck="false" placeholder="Jot down what you eat as you go — total it in your calorie app at the end of the day."${HF.text == null ? ' disabled' : ''}>${esc(HF.text || '')}</textarea>`;
  const ta = $('h-foodta'); ta.oninput = () => { HF.text = ta.value; hfSave(); };
}
function renderHMeat() {
  $('h-meat').innerHTML = `<div class="h-ch"><h3>Meat schedule</h3></div><table class="h-tbl"><thead><tr><th>Day</th><th>Meat</th><th>Notes</th></tr></thead><tbody>${HD.map((d, i) => `<tr><td class="dn">${d}</td><td><input class="h-in" data-s="m" data-r="${i}" data-c="meat" value="${esc(H.meat[i].meat).replace(/"/g, '&quot;')}"></td><td><input class="h-in" data-s="m" data-r="${i}" data-c="notes" value="${esc(H.meat[i].notes).replace(/"/g, '&quot;')}"></td></tr>`).join('')}</tbody></table>`;
}
function renderHYear() {
  const t = todayN(), names = { weight: 'Weight', cal: 'Calories', pro: 'Protein', card: 'Cardio', steps: 'Steps', sleep: 'Sleep' };
  const midM = (w) => new Date((w.start + 3) * 864e5).getUTCMonth();
  const monthName = (w) => new Date((w.start + 3) * 864e5).toLocaleDateString('en', { month: 'long', timeZone: 'UTC' });
  const range = (w) => `${dayLbl(w.start)}–${mon(w.start) === mon(w.start + 6) ? new Date((w.start + 6) * 864e5).getUTCDate() : dayLbl(w.start + 6)}`;
  let rows = '', i = 0;
  while (i < H.w.length) {
    let j = i; while (j < H.w.length && midM(H.w[j]) === midM(H.w[i])) j++;
    for (let k = i; k < j; k++) {
      const w = H.w[k];
      rows += `<tr data-wi="${k}" class="m${midM(w) % 2}${k === H.sel ? ' sel' : ''}${t >= w.start && t <= w.start + 6 ? ' now' : ''}">${k === i ? `<td class="mo" rowspan="${j - i}">${monthName(w)}</td>` : ''}<td class="wk">${w.n}</td><td class="dt">${range(w)}</td>${OK.map((key) => `<td><input class="h-in" data-s="o" data-r="${k}" data-c="${key}" value="${inStr(key, w.ov[key])}"></td>`).join('')}</tr>`;
    }
    if (j < H.w.length) rows += '<tr class="gap"><td colspan="9"></td></tr>';
    i = j;
  }
  $('h-year').innerHTML = `<div class="h-ch"><h3>Year overview</h3><span class="h-hint">Typed in by hand. Nothing here is filled in for you.</span></div>
    <div class="h-yscroll"><table class="h-ytbl"><colgroup><col style="width:78px"><col style="width:34px"><col style="width:112px">${OK.map(() => '<col>').join('')}</colgroup><thead><tr><th>Month</th><th>Wk</th><th>Dates</th>${OK.map((k) => `<th>${names[k]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const ys = $('h-year').querySelector('.h-yscroll'), sel = $('h-year').querySelector('tr.sel');
  if (ys && sel) ys.scrollTop = Math.max(0, sel.offsetTop - ys.clientHeight / 2);
}
function hSelect(i) {
  H.sel = Math.max(0, Math.min(H.w.length - 1, i));
  const y = $('h-year'); y.querySelectorAll('tr.sel').forEach((r) => r.classList.remove('sel')); const row = y.querySelector(`tr[data-wi="${H.sel}"]`); if (row) row.classList.add('sel');
  renderHDaily(); renderHMinis();
}

const hEl = $('health');
hEl.addEventListener('click', async (e) => {
  const tr = e.target.closest('tr[data-wi]');
  if (tr && e.target.closest('td.wk, td.dt')) { hSelect(+tr.dataset.wi); return; }
  const b = e.target.closest('button'); if (!b || !b.dataset.h) return; const a = b.dataset.h;
  if (a === 'prev' || a === 'next') { if (H.saveT) await hSaveNow(); await loadHealth(H.year + (a === 'next' ? 1 : -1)); renderHealth(); }
  else if (a === 'tog') { H.show[b.dataset.k] = !H.show[b.dataset.k]; renderHMain(); }
  else if (a === 'range') { H.range = b.dataset.v; renderHMain(); renderHMinis(); }
  else if (a === 'wprev') hSelect(H.sel - 1);
  else if (a === 'wnext') hSelect(H.sel + 1);
  else if (a === 'fill') {
    const w = H.w[H.sel], f = {};
    ['weight', 'cal', 'pro', 'steps', 'sleep'].forEach((k) => { const v = vals(w, k); if (v.length) f[k] = k === 'weight' ? Math.round(avgOf(v) * 10) / 10 : Math.round(avgOf(v)); });
    const c = vals(w, 'card'); if (c.length) f.card = sum(c);
    if (!Object.keys(f).length) return;
    const apply = () => {
      Object.assign(w.ov, f);
      Object.keys(f).forEach((k) => { const i = hEl.querySelector(`input[data-s="o"][data-r="${H.sel}"][data-c="${k}"]`); if (i) i.value = inStr(k, f[k]); });
      hCharts(); hSaveSoon();
    };
    if (Object.keys(f).some((k) => w.ov[k] != null)) uiConfirm({ title: 'Replace existing values?', msg: `Week ${w.n} of the year table already has values. Fill them from the week log?`, ok: 'Replace', danger: true, cb: apply }); else apply();
  }
});
hEl.addEventListener('change', (e) => {
  const i = e.target; if (!i.classList.contains('h-in')) return;
  const s = i.dataset.s, k = i.dataset.c, r = +i.dataset.r;
  if (s === 'm') { H.meat[r][k] = i.value.trim(); hSaveSoon(); return; }
  const raw = i.value.trim(), v = raw === '' ? null : rd(k, raw), tgt = s === 'd' ? H.w[H.sel].days[r] : H.w[r].ov;
  if (raw !== '' && v == null) { i.classList.add('bad'); i.value = inStr(k, tgt[k]); setTimeout(() => i.classList.remove('bad'), 900); return; }
  tgt[k] = v; i.value = inStr(k, v);
  if (s === 'd') hFoot(); else hCharts();
  hSaveSoon();
});
hEl.addEventListener('keydown', (e) => {
  const i = e.target; if (e.key !== 'Enter' || !i.classList || !i.classList.contains('h-in')) return;
  const nx = hEl.querySelector(`input[data-s="${i.dataset.s}"][data-c="${i.dataset.c}"][data-r="${+i.dataset.r + 1}"]`);
  i.blur(); if (nx) nx.focus();
});
$('btn-health').onclick = () => showHealth();

function rowMoves(c, ci) {
  const T = S.tasks, same = T.categories.map((x, i) => i).filter((i) => (T.categories[i].row || 0) === (c.row || 0)), p = same.indexOf(ci), out = [];
  const swap = (j) => { [T.categories[ci], T.categories[j]] = [T.categories[j], T.categories[ci]]; tChanged(); };
  if (p > 0) out.push(['Move left', () => swap(same[p - 1])]);
  if (p < same.length - 1) out.push(['Move right', () => swap(same[p + 1])]);
  out.push([c.row ? 'Move to daily tasks' : 'Move to work tasks', () => { c.row = c.row ? 0 : 1; tChanged(); }]);
  return out;
}

/* ---------- finance (outgoing) ---------- */
/* finance:data:start */
const FCOL_K = ['a3', 'mag', 'amb', 'a2', 'grn', 'rose', 'blu', 'yel'];
FCOL = FCOL_K.map((k) => TC[k]);
const F = { ym: '', cur: '$', cats: ['Food', 'Bills', 'Fun', 'Other'], tx: [], filter: '', cache: {}, saveT: null, draft: { date: '', cat: 'Food' }, geo: null, msg: '' };
const ymNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const ymAdd = (ym, k) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5) - 1 + k, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };
const ymLabel = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1).toLocaleDateString('en', { month: 'long', year: 'numeric' });
const dimOf = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate();
const money = (v) => { if (v == null) return '–'; const a = Math.abs(v), s = Math.abs(a - Math.round(a)) < 0.005 ? Math.round(a).toLocaleString('en-US') : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return (v < 0 ? '−' : '') + F.cur + s; };
const short = (v) => { const a = Math.abs(v); return (v < 0 ? '−' : '') + F.cur + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : Math.round(a)); };
const ea = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fcol = (c) => { const i = F.cats.indexOf(c); return i < 0 ? '#6b7280' : FCOL[i % FCOL.length]; };
const cleanCat = (s) => String(s || '').replace(/[,|]/g, ' ').trim();

function parseF(text) {
  const out = { cur: '$', cats: [], tx: [] };
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) fm[1].split(/\r?\n/).forEach((l) => {
    const m = l.match(/^(\w+):\s*(.*)$/); if (!m) return;
    if (m[1] === 'currency') out.cur = m[2] || '$'; else if (m[1] === 'categories') out.cats = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  });
  let sec = '';
  text.split(/\r?\n/).forEach((l) => {
    let m; if ((m = l.match(/^## (.+)/))) { sec = m[1].trim().toLowerCase(); return; }
    if (sec !== 'transactions' || !l.startsWith('|')) return;
    const c = l.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
    if (/^\d{4}-\d{2}-\d{2}$/.test(c[0]) && parseNum(c[2]) != null) out.tx.push({ id: uid(), date: c[0], det: c[1] || '', amt: parseNum(c[2]), cat: c[3] || 'Other', note: c[4] || '' });
  });
  out.tx.forEach((t) => { if (!out.cats.includes(t.cat)) out.cats.push(t.cat); });
  if (!out.cats.length) out.cats = ['Food', 'Bills', 'Fun', 'Other'];
  return out;
}
function fStats() {
  const dim = dimOf(F.ym), byDay = Array(dim).fill(0), byDow = Array(7).fill(0), byCat = {};
  let total = 0, count = 0;
  F.tx.forEach((t) => {
    if (t.date.slice(0, 7) !== F.ym) return;
    count++; byDay[+t.date.slice(8, 10) - 1] += t.amt; byDow[(dn(t.date) + 3) % 7] += t.amt; byCat[t.cat] = (byCat[t.cat] || 0) + t.amt; total += t.amt;
  });
  return { dim, byDay, byDow, byCat, total, count };
}
const monthsBetween = (a, b) => { const out = []; for (let n = a; n <= b; n++) { const ym = ds(n).slice(0, 7); if (!out.includes(ym)) out.push(ym); } return out; };
function avg30Range() {
  const now = ymNow(); if (F.ym > now) return null;
  const end = F.ym === now ? todayN() : dn(`${F.ym}-${pad2(dimOf(F.ym))}`);
  return [end - 29, end];
}
function calcAvg30() {
  const r = avg30Range(); if (!r) return null;
  let total = 0, missing = false;
  monthsBetween(r[0], r[1]).forEach((ym) => {
    const tx = ym === F.ym ? F.tx : F.cache[ym];
    if (tx === undefined) { missing = true; return; }
    tx.forEach((t) => { const d = dn(t.date); if (d >= r[0] && d <= r[1]) total += t.amt; });
  });
  return { avg: total / 30, missing, end: r[1] };
}
function toMdF() {
  const st = fStats(), a = calcAvg30(), pct = (v) => (st.total ? Math.round((v / st.total) * 100) : 0);
  let o = `---\ntype: outgoing\nmonth: ${F.ym}\ncurrency: ${F.cur}\ncategories: ${F.cats.join(', ')}\n---\n# ${ymLabel(F.ym)} · Outgoing\n\n## Summary\n| Spent this month | Daily average (last 30 days) | Transactions |\n|---|---|---|\n| ${money(st.total)} | ${a && !a.missing ? money(a.avg) : ''} | ${st.count} |\n\n## Breakdown\n| Category | Total | % |\n|---|---|---|\n`;
  F.cats.forEach((c) => { o += `| ${c} | ${money(st.byCat[c] || 0)} | ${pct(st.byCat[c] || 0)}% |\n`; });
  o += '\n## Transactions\n| Date | Details | Amount | Category | Comment |\n|---|---|---|---|---|\n';
  F.tx.map((t, i) => [t, i]).sort((x, y) => x[0].date.localeCompare(y[0].date) || x[1] - y[1]).forEach(([t]) => { o += `| ${t.date} | ${pipe(t.det)} | ${t.amt} | ${t.cat} | ${pipe(t.note)} |\n`; });
  return o;
}
/* finance:data:end */

async function showFinance(ym) {
  if (S.view === 'finance' && ym == null) { render(); return; }
  if (F.saveT) await fSaveNow();
  F.cache = {}; await loadFinance(ym || F.ym || ymNow());
  if (F.tab === 'income' && !INC.loaded) await incLoadSafe();
  setView('finance'); renderFinance(); fFillCache(); fFillPrev();
}
async function loadFinance(ym) {
  F.ym = ym; F.tx = []; F.filter = ''; F.msg = ''; F.cats = ['Food', 'Bills', 'Fun', 'Other'];
  const text = await api.financeLoad(ym);
  if (text) { const p = parseF(text); F.cur = p.cur; F.cats = p.cats; F.tx = p.tx; }
  else for (let k = 1; k <= 12; k++) { const t = await api.financeLoad(ymAdd(ym, -k)); if (t) { const p = parseF(t); F.cur = p.cur; F.cats = p.cats; break; } }
  F.draft = { date: ym === ymNow() ? `${ym}-${pad2(new Date().getDate())}` : `${ym}-01`, cat: F.cats[0] };
}
async function fGo(ym) {
  if (F.saveT) await fSaveNow();
  F.cache[F.ym] = F.tx.slice(); await loadFinance(ym); renderFinance(); fFillCache(); fFillPrev();
}
async function fFillCache() {
  const r = avg30Range(); if (!r) return; const ym0 = F.ym; let loaded = false;
  for (const ym of monthsBetween(r[0], r[1])) if (ym !== F.ym && F.cache[ym] === undefined) { const t = await api.financeLoad(ym); F.cache[ym] = t ? parseF(t).tx : []; loaded = true; }
  if (loaded && isV('finance') && F.ym === ym0 && F.tab !== 'income') renderFStats(fStats());
}
function fSaveSoon() { uNote('fin'); clearTimeout(F.saveT); F.saveT = setTimeout(fSaveNow, 500); }
async function fSaveNow() { clearTimeout(F.saveT); F.saveT = null; await api.financeSave(F.ym, toMdF()); }
window.addEventListener('beforeunload', () => { if (F.saveT) api.financeSave(F.ym, toMdF()); });

function renderFinance() {
  if (F.tab === 'income' && typeof incomeRender === 'function') { incomeRender(); return; }
  $('finance').innerHTML = `<div class="t-head"><div><h1 class="h-titles"><span class="h-ttl on" data-ft="finance">Finance</span><span class="h-ttl" data-ft="income">Income</span></h1><div class="t-sub" id="f-sub"></div></div>
    <div class="g-tools"><button data-f="prev">‹</button><b class="f-month">${ymLabel(F.ym)}</b><button data-f="next">›</button><button data-f="now">This month</button><label class="f-curl">Currency <input id="f-cur" value="${ea(F.cur)}" maxlength="4"></label></div></div>
    <div class="f-scroll"><div class="f-stats2" id="f-stats"></div><div class="p-card" id="f-add"></div><div class="f-charts" id="f-charts"></div><div class="p-card" id="f-tx"></div><div class="p-card" id="f-glance"></div></div>`;
  renderFAdd(); fRefresh();
}
function fRefresh() {
  const st = fStats();
  $('f-sub').textContent = F.msg || `${st.count} transaction${st.count === 1 ? '' : 's'} this month`; F.msg = '';
  renderFStats(st); renderFCharts(st); renderFTx(); renderFGlance(st);
}
function renderFAdd() {
  $('f-add').innerHTML = `<div class="f-addrow"><input type="date" id="f-ad" class="f-in" value="${F.draft.date}" min="${F.ym}-01" max="${F.ym}-${pad2(dimOf(F.ym))}"><input id="f-adet" class="f-in f-grow" placeholder="Details" autocomplete="off"><input id="f-aam" class="f-in f-amt" placeholder="Amount" inputmode="decimal" autocomplete="off"><input id="f-an" class="f-in f-grow" placeholder="Comment (optional)" autocomplete="off"><button class="g-primary" data-f="add">Add</button></div><div class="f-cats" id="f-cats"></div>`;
  fCats();
}
function fCats() {
  $('f-cats').innerHTML = F.cats.map((c) => `<button class="f-cat${F.draft.cat === c ? ' on' : ''}" data-f="pick" data-c="${ea(c)}" style="--c:${fcol(c)}" title="Right-click to rename"><i></i>${esc(c)}</button>`).join('');
}
function fAdd() {
  const amt = parseNum($('f-aam').value), date = $('f-ad').value;
  if (amt == null || !date || date.slice(0, 7) !== F.ym) { const i = $('f-aam'); i.classList.add('bad'); setTimeout(() => i.classList.remove('bad'), 900); i.focus(); return; }
  F.draft.date = date; F.tx.push({ id: uid(), date, det: $('f-adet').value.trim(), amt, cat: F.draft.cat, note: $('f-an').value.trim() });
  $('f-adet').value = ''; $('f-aam').value = ''; $('f-an').value = ''; $('f-adet').focus();
  fRefresh(); fSaveSoon();
}

function renderFStats(st) {
  const a = calcAvg30(), cm = F.ym === ymNow(), mname = new Date(+F.ym.slice(0, 4), +F.ym.slice(5) - 1, 1).toLocaleDateString('en', { month: 'long' });
  $('f-stats').innerHTML = `
    <div class="h-stat" style="--c:${TC.mag}"><small>${cm ? 'Spent this month' : 'Spent in ' + mname}</small><b>${money(st.total)}</b><small>${st.count} transaction${st.count === 1 ? '' : 's'}</small></div>
    <div class="h-stat" style="--c:${TC.a3}"><small>Daily average</small><b>${a ? (a.missing ? '…' : money(a.avg)) : '–'}</b><small>${a ? (cm ? 'over the last 30 days' : `30 days up to ${dayLbl(a.end)}`) : 'no data for future months'}</small></div>`;
}

function fDaily(st, W0) {
  if (!st.total) return '<div class="h-empty">Add a transaction to see how the month is going.</div>';
  const Wd = W0 || 900, Ht = 270, L = 58, R = 58, T = 14, Bm = 30, pw = Wd - L - R, ph = Ht - T - Bm, n = st.dim, step = pw / n, bw = Math.max(4, step * 0.62);
  const mxB = Math.max(...st.byDay, 1); let run = 0; const cum = st.byDay.map((v) => (run += v));
  const now = ymNow(), upto = F.ym === now ? new Date().getDate() : n, mxC = Math.max(run, 1);
  const X = (i) => L + step * i + step / 2, Yb = (v) => T + ph - (v / mxB) * ph, Yc = (v) => T + ph - (v / mxC) * ph;
  let s = `<defs><linearGradient id="fbar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TC.amb}"/><stop offset="1" stop-color="${TC.amb}" stop-opacity=".2"/></linearGradient></defs>`;
  for (let g = 0; g <= 4; g++) { const y = T + (g / 4) * ph; s += `<line x1="${L}" x2="${Wd - R}" y1="${y}" y2="${y}" class="h-grid-l"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" class="h-ax" style="fill:${TC.amb}">${short(mxB * (1 - g / 4))}</text><text x="${Wd - R + 8}" y="${y + 4}" class="h-ax" style="fill:${TC.a3}">${short(mxC * (1 - g / 4))}</text>`; }
  st.byDay.forEach((v, i) => { if (v > 0) s += `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Yb(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(T + ph - Yb(v)).toFixed(1)}" rx="3" fill="url(#fbar)" style="filter:drop-shadow(0 0 4px ${TC.amb}66)"/>`; });
  s += `<path d="M${cum.slice(0, upto).map((c, i) => `${X(i).toFixed(1)} ${Yc(c).toFixed(1)}`).join(' L')}" fill="none" stroke="${TC.a3}" stroke-width="2.4" stroke-linejoin="round" style="filter:drop-shadow(0 0 5px ${TC.a3})"/>`;
  for (let i = 0; i < n; i += n > 20 ? 2 : 1) s += `<text x="${X(i).toFixed(1)}" y="${Ht - 10}" text-anchor="middle" class="h-ax">${i + 1}</text>`;
  F.geo = { X, n, L, Wd, cum, byDay: st.byDay, Yc, step };
  return `<div class="h-chart f-chart"><svg viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}">${s}<line id="f-vl" y1="${T}" y2="${T + ph}" class="h-vl" style="display:none"/><circle id="f-dot" r="5" fill="${TC.a3}" stroke="#0a0a0f" stroke-width="2" style="display:none"/></svg><div class="h-tip"></div></div>`;
}
function bindFDaily() {
  const box = $('f-charts').querySelector('.f-chart'); if (!box) return;
  const svg = box.querySelector('svg'), tp = box.querySelector('.h-tip'), g = F.geo, vl = $('f-vl'), dot = $('f-dot');
  box.onmousemove = (e) => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) * (g.Wd / r.width), i = Math.max(0, Math.min(g.n - 1, Math.floor((x - g.L) / g.step))), gx = g.X(i);
    vl.setAttribute('x1', gx); vl.setAttribute('x2', gx); vl.style.display = ''; dot.setAttribute('cx', gx); dot.setAttribute('cy', g.Yc(g.cum[i])); dot.style.display = '';
    const dl = `${HD[(dn(`${F.ym}-${pad2(i + 1)}`) + 3) % 7]} ${i + 1}`;
    tp.innerHTML = `<strong>${dl}</strong><div><i style="background:${TC.amb}"></i>Spent <b>${money(g.byDay[i])}</b></div><div><i style="background:${TC.a3}"></i>Running total <b>${money(g.cum[i])}</b></div>`;
    tp.style.display = 'block'; const px = (gx / g.Wd) * r.width; tp.style.left = (px > r.width - 240 ? px - tp.offsetWidth - 14 : px + 14) + 'px';
  };
  box.onmouseleave = () => { tp.style.display = 'none'; vl.style.display = 'none'; dot.style.display = 'none'; };
}
function fDonut(st) {
  const cats = Object.keys(st.byCat).filter((c) => st.byCat[c] > 0).sort((a, b) => st.byCat[b] - st.byCat[a]);
  if (!st.total || !cats.length) return '<div class="h-empty">No spending yet.</div>';
  const C = 2 * Math.PI * 70; let off = 0, seg = '';
  cats.forEach((c) => {
    const v = st.byCat[c], len = (v / st.total) * C;
    seg += `<circle class="f-slice${F.filter === c ? ' on' : ''}" data-f="cat" data-c="${ea(c)}" cx="100" cy="100" r="70" fill="none" stroke="${fcol(c)}" stroke-width="24" stroke-dasharray="${Math.max(len - 2, 0.5).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-off).toFixed(1)}" transform="rotate(-90 100 100)" style="filter:drop-shadow(0 0 5px ${fcol(c)}77)"><title>${esc(c)} · ${money(v)}</title></circle>`; off += len;
  });
  const legend = [...cats, ...F.cats.filter((c) => !cats.includes(c))].map((c) => `<div class="f-leg${F.filter === c ? ' on' : ''}" data-f="cat" data-c="${ea(c)}" style="--c:${fcol(c)}"><i></i><span>${esc(c)}</span><b>${money(st.byCat[c] || 0)}</b><em>${Math.round((st.byCat[c] || 0) / st.total * 100)}%</em><u style="width:${((st.byCat[c] || 0) / st.total * 100).toFixed(1)}%"></u></div>`).join('');
  return `<div class="f-donut"><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="70" fill="none" stroke="var(--raised)" stroke-width="24"/>${seg}<text x="100" y="100" text-anchor="middle" class="f-dc">${short(st.total)}</text><text x="100" y="118" text-anchor="middle" class="h-ax">spent</text></svg><div class="f-legend">${legend}</div></div>`;
}
function fHeat(st) {
  const off = (dn(`${F.ym}-01`) + 3) % 7, mx = Math.max(...st.byDay, 1), now = ymNow() === F.ym ? new Date().getDate() : 0;
  let cells = HD.map((d) => `<div class="f-hd">${d[0]}</div>`).join('') + '<i></i>'.repeat(off);
  st.byDay.forEach((v, i) => { cells += `<div class="f-day${i + 1 === now ? ' now' : ''}" title="${i + 1} · ${money(v)}" style="${v ? `background:color-mix(in srgb,var(--pa) ${Math.round(12 + (v / mx) * 78)}%,#1b1b27)` : ''}"><span>${i + 1}</span>${v ? `<small>${short(v)}</small>` : ''}</div>`; });
  return `<div class="f-heat">${cells}</div>`;
}
function renderFCharts(st) {
  $('f-charts').innerHTML = `
    <div class="p-card f-wide"><div class="h-ch"><h3>Daily spending</h3><span class="h-hint">bars: per day · line: running total</span></div>${fDaily(st, chartW('f-charts'))}</div>
    <div class="p-card"><div class="h-ch"><h3>Where it goes</h3><span class="h-hint">click to filter</span></div>${fDonut(st)}</div>
    <div class="p-card" id="f-c-cmp">${cmpInner(st)}</div>`;
  bindFDaily(); fitCmp(st);
}
function fitCmp(st) { const b = $('f-c-cmp'); if (b) b.innerHTML = cmpInner(st); }
function renderFGlance(st) { $('f-glance').innerHTML = `<div class="h-ch"><h3>Month at a glance</h3></div>${fHeat(st)}`; }

function renderFTx() {
  const chips = [['', 'All'], ...F.cats.map((c) => [c, c])].map(([c, l]) => `<button class="f-cat${F.filter === c ? ' on' : ''}" data-f="filter" data-c="${ea(c)}" style="--c:${c ? fcol(c) : '#ffffff'}"${c ? ' title="Right-click to rename"' : ''}><i></i>${esc(l)}</button>`).join('');
  $('f-tx').innerHTML = `<div class="h-ch"><h3>Transactions</h3><span class="h-hint" id="f-shown"></span><div class="h-chips">${chips}</div><button data-f="paste">Paste from Sheets</button></div>
    <div class="f-txs"><table class="h-tbl f-tbl"><thead><tr><th>Date</th><th>Details</th><th>Amount</th><th>Category</th><th>Comment</th><th></th></tr></thead><tbody id="f-rows"></tbody></table></div>
    <div class="f-foot"><button data-f="newcat">+ Add category</button><span class="h-hint">Right-click a category to rename it.</span></div>`;
  renderFRows();
}
function renderFRows() {
  const max = pad2(dimOf(F.ym)), rows = F.tx.map((t, i) => [t, i]).filter(([t]) => !F.filter || t.cat === F.filter).sort((a, b) => a[0].date.localeCompare(b[0].date) || a[1] - b[1]);
  $('f-rows').innerHTML = rows.map(([t]) => `<tr data-id="${t.id}"><td><input type="date" class="f-in" data-k="date" value="${t.date}" min="${F.ym}-01" max="${F.ym}-${max}"></td><td><input class="f-in" data-k="det" value="${ea(t.det)}"></td><td><input class="f-in f-num" data-k="amt" value="${t.amt}"></td><td><select class="f-in f-sel" data-k="cat" style="--c:${fcol(t.cat)}">${F.cats.map((c) => `<option${c === t.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td><td><input class="f-in" data-k="note" value="${ea(t.note)}"></td><td><button class="f-x" data-f="del" title="Delete">×</button></td></tr>`).join('') || '<tr><td colspan="6" class="h-empty">No transactions to show.</td></tr>';
  $('f-shown').textContent = `${rows.length} shown · ${money(rows.reduce((a, [t]) => a + t.amt, 0))}`;
}

function fRename(old) {
  const used = F.tx.filter((t) => t.cat === old).length, ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = `<div class="t-card g-card"><h3>Rename category</h3><div class="g-f"><label>New name</label><input class="g-in" id="fr-n" value="${ea(old)}" maxlength="30"></div>
    <label class="f-chk"><input type="checkbox" id="fr-c" checked><span>Also change the ${used} transaction${used === 1 ? '' : 's'} in ${ymLabel(F.ym)} that use “${esc(old)}”</span></label>
    <div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Rename</button></div></div>`;
  const close = () => ov.remove();
  const ok = () => {
    const nv = cleanCat(ov.querySelector('#fr-n').value), upd = ov.querySelector('#fr-c').checked; close();
    if (!nv || nv === old) return;
    const i = F.cats.indexOf(old), j = F.cats.findIndex((c, k) => k !== i && c.toLowerCase() === nv.toLowerCase());
    let target = nv;
    if (j >= 0) { target = F.cats[j]; F.cats.splice(i, 1); } else F.cats[i] = nv;
    if (upd) F.tx.forEach((t) => { if (t.cat === old) t.cat = target; });
    else if (F.tx.some((t) => t.cat === old)) F.cats.push(old);
    if (F.draft.cat === old) F.draft.cat = target;
    if (F.filter === old) F.filter = target;
    F.msg = `Renamed “${old}” to “${target}”${upd && used ? ` and updated ${used} transaction${used === 1 ? '' : 's'}` : ''}`;
    renderFAdd(); fRefresh(); fSaveSoon();
  };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.target.id === 'fr-n') ok(); };
  document.body.appendChild(ov); const n = ov.querySelector('#fr-n'); n.focus(); n.select();
}
function fPaste() {
  const ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = `<div class="t-card g-card"><h3>Paste from Google Sheets</h3><div class="t-for">Copy rows (Date, Details, Amount, Category, Comment) and paste them here. Dates like “01, Thursday” are read as that day of this month.</div><textarea style="height:180px"></textarea><div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Import</button></div></div>`;
  const ta = ov.querySelector('textarea'), close = () => ov.remove();
  const ok = () => {
    let n = 0, skipped = 0;
    ta.value.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const c = line.split('\t').map((s) => s.trim()), amt = parseNum((c[2] || '').replace(/[^\d.\-,]/g, '')), dm = (c[0] || '').match(/^(\d{4}-\d{2}-\d{2})|^(\d{1,2})/);
      if (amt == null || !dm) { skipped++; return; }
      const date = dm[1] || `${F.ym}-${pad2(+dm[2])}`, day = +date.slice(8, 10);
      if (date.slice(0, 7) !== F.ym || day < 1 || day > dimOf(F.ym)) { skipped++; return; }
      let cat = cleanCat(c[3]); const hit = F.cats.find((x) => x.toLowerCase() === cat.toLowerCase());
      if (hit) cat = hit; else if (cat) F.cats.push(cat); else cat = F.cats[F.cats.length - 1];
      F.tx.push({ id: uid(), date, det: c[1] || '', amt, cat, note: c[4] || '' }); n++;
    });
    close(); renderFAdd(); F.msg = `Imported ${n} row${n === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}`; fRefresh(); fSaveSoon();
  };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  document.body.appendChild(ov); ta.focus();
}

const fEl = $('finance');
fEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-f]'); if (!el) return; const a = el.dataset.f;
  if (a === 'prev' || a === 'next') fGo(ymAdd(F.ym, a === 'next' ? 1 : -1));
  else if (a === 'now') fGo(ymNow());
  else if (a === 'add') fAdd();
  else if (a === 'pick') { F.draft.cat = el.dataset.c; fCats(); }
  else if (a === 'newcat') {
    const i = document.createElement('input'); i.className = 'f-in f-newcat'; i.placeholder = 'Category name'; el.replaceWith(i); i.focus(); let done = false;
    const fin = (ok) => {
      if (done) return; done = true; const v = cleanCat(i.value);
      if (ok && v && !F.cats.some((c) => c.toLowerCase() === v.toLowerCase())) { F.cats.push(v); F.draft.cat = v; fSaveSoon(); renderFAdd(); }
      fRefresh();
    };
    i.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); }; i.onblur = () => fin(true);
  }
  else if (a === 'cat' || a === 'filter') { const c = el.dataset.c || ''; F.filter = F.filter === c ? '' : c; fRefresh(); }
  else if (a === 'del') {
    const id = el.closest('tr').dataset.id, t = F.tx.find((x) => x.id === id); if (!t) return;
    uiConfirm({ title: 'Delete this entry?', msg: `${t.det || 'No details'} · ${F.cur}${t.amt} · ${t.date}`, ok: 'Delete', danger: true, cb: () => { F.tx = F.tx.filter((x) => x.id !== id); fRefresh(); fSaveSoon(); } });
  }
  else if (a === 'paste') fPaste();
});
fEl.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-c]'); if (!el || !el.dataset.c || !['pick', 'filter', 'cat'].includes(el.dataset.f)) return;
  e.preventDefault(); ctxAt(e, [['Rename category…', () => fRename(el.dataset.c)]]);
});
fEl.addEventListener('change', (e) => {
  const i = e.target;
  if (i.id === 'f-cur') { F.cur = i.value.trim() || '$'; fSaveSoon(); fRefresh(); return; }
  if (!i.dataset.k || !i.closest('#f-tx')) return;
  const t = F.tx.find((x) => x.id === i.closest('tr').dataset.id), k = i.dataset.k; if (!t) return;
  if (k === 'amt') { const v = parseNum(i.value); if (v == null) { i.value = t.amt; return; } t.amt = v; i.value = v; }
  else if (k === 'date') { if (!i.value || i.value.slice(0, 7) !== F.ym) { i.value = t.date; return; } t.date = i.value; }
  else t[k] = i.value.trim();
  fSaveSoon(); const st = fStats(); renderFStats(st); renderFCharts(st); renderFRows(); renderFGlance(st);
});
fEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT' || e.target.classList.contains('f-newcat')) return;
  if (e.target.closest('#f-add')) fAdd(); else if (e.target.dataset.k || e.target.id === 'f-cur') e.target.blur();
});
$('btn-finance').onclick = () => showFinance();

/* ---------- subtasks + mulling ---------- */
/* mull:start */
function setTaskDone(t, v) { t.done = v; if (t.subs && t.subs.length) t.subs.forEach((x) => { x.done = v; }); }
function expandRepeat(line) {
  const m = line.trim().match(/^(.*?)\s*[x×]\s*(\d{1,2})$/i);
  if (m && m[1] && +m[2] >= 2) return Array.from({ length: +m[2] }, (_, i) => `${m[1]} (${i + 1}/${m[2]})`);
  return line.trim() ? [line.trim()] : [];
}
const leavesOf = (t) => (t.subs && t.subs.length ? t.subs : [t]);
/* time-based tasks: x.after = { min: minutes since midnight }; repeats every day (the time is kept until you remove it). Old saves also carry a 'day' field, which is now ignored */
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
function holdState(x) { const h = x && x.after; if (!h) return 'none'; return nowMin() >= h.min ? 'open' : 'wait'; }
const fmtMin = (m) => { const d = new Date(); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
const HOURGLASS = '<svg class="hg" viewBox="0 0 12 14" width="10" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 1h8M2 13h8M3 1v2.2c0 1.3 1.2 2.2 3 3.8-1.8 1.6-3 2.5-3 3.8V13M9 1v2.2c0 1.3-1.2 2.2-3 3.8 1.8 1.6 3 2.5 3 3.8V13"/></svg>';
function holdChip(x, mini) {
  const st = holdState(x); if (st === 'none') return '';
  const tt = st === 'wait' ? `Joins the mulling rotation at ${fmtMin(x.after.min)} every day` : `In the mulling rotation since ${fmtMin(x.after.min)} · resets at midnight`;
  if (mini) return `<span class="t-hold mini ${st}" title="${tt}">${HOURGLASS}</span>`;
  return `<span class="t-hold ${st}" title="${st === 'wait' ? `Joins the mulling rotation at ${fmtMin(x.after.min)} every day` : `In the mulling rotation since ${fmtMin(x.after.min)} · resets at midnight`}">${HOURGLASS}<em>${fmtMin(x.after.min)}</em></span>`;
}
const live = (x) => !x.noMull && holdState(x) !== 'wait';
function sweepHolds() { return false; } // times no longer expire at midnight
function holdSigNow() {
  const out = [dayKey()];
  S.tasks.categories.forEach((c) => c.tasks.forEach((t) => [t, ...(t.subs || [])].forEach((x) => { if (x.after) out.push(holdState(x)); })));
  return out.join(',');
}
let holdSig = '';
setInterval(() => {
  if (!S.tasks) return;
  const swept = sweepHolds(), sig = holdSigNow();
  if (sig === holdSig && !swept) return;
  const ae = document.activeElement; if (isV('tasks') && ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;
  holdSig = sig; if (swept) { clearTimeout(tSave); tSave = setTimeout(tSaveNow, 300); }
  if (isV('tasks')) renderTasks();
  if ($('p-mull')) renderMull();
}, 15000);
function mullPending() {
  const T = S.tasks, wo = !!(T.mull && T.mull.workOnly); let best = null;
  T.categories.forEach((c) => { if (c.noMull || (wo && !c.row)) return; c.tasks.forEach((t) => {
    const ts = holdState(t) === 'wait' ? t.after.min : -1;
    leavesOf(t).forEach((x) => {
      if (x.done || x.noMull) return;
      const m = Math.max(ts, x !== t && holdState(x) === 'wait' ? x.after.min : -1);
      if (m >= 0) best = best === null ? m : Math.min(best, m);
    });
  }); });
  return best;
}
function taskMullState(t) { const L = leavesOf(t), n = L.filter((x) => !x.noMull).length; return n === L.length ? 'on' : n === 0 ? 'off' : 'part'; }
function toggleMullTask(t) { const on = taskMullState(t) === 'on'; t.noMull = on; (t.subs || []).forEach((x) => { x.noMull = on; }); }
function toggleMullSub(t, s) { s.noMull = !s.noMull; t.noMull = t.subs.every((x) => x.noMull); }
function catCounts(c) { let on = 0, tot = 0; c.tasks.forEach((t) => leavesOf(t).forEach((x) => { if (x.done) return; tot++; if (!c.noMull && !x.noMull) on++; })); return { on, tot }; }
function mullTotals() { let on = 0, tot = 0; S.tasks.categories.forEach((c) => { const k = catCounts(c); on += k.on; tot += k.tot; }); return { on, tot }; }
function mullProgress() {
  const wo = !!(S.tasks.mull && S.tasks.mull.workOnly); let done = 0, tot = 0;
  S.tasks.categories.forEach((c) => { if (c.noMull || (wo && !c.row)) return; c.tasks.forEach((t) => leavesOf(t).forEach((x) => { if (x.noMull) return; tot++; if (x.done) done++; })); });
  return { done, tot };
}
function mullNext(c) {
  if (c.noMull || (S.tasks.mull && S.tasks.mull.workOnly && !c.row)) return null;
  for (const t of c.tasks) {
    if (holdState(t) === 'wait') continue;
    if (t.subs && t.subs.length) {
      const open = t.subs.filter((x) => !x.done && live(x));
      if (open.length) return t.tether ? { cid: c.id, tid: t.id, sid: null, group: true } : { cid: c.id, tid: t.id, sid: open[0].id };
    } else if (!t.done && !t.noMull) return { cid: c.id, tid: t.id, sid: null };
  }
  return null;
}
function mullFind(it) {
  const c = S.tasks.categories.find((x) => x.id === it.cid), t = c && c.tasks.find((x) => x.id === it.tid), s = t && it.sid ? (t.subs || []).find((x) => x.id === it.sid) : null;
  return { c, t, s, group: !!it.group, ok: !!(c && t && (it.group || !it.sid || s)) };
}
const mullDone = (it) => { const f = mullFind(it); if (!f.ok) return false; if (it.group) { const L = f.t.subs.filter(live); return L.length > 0 && L.every((x) => x.done); } return it.sid ? f.s.done : f.t.done; };
const mullIn = (f) => !f.c.noMull && !(S.tasks.mull && S.tasks.mull.workOnly && !f.c.row) && holdState(f.t) !== 'wait' && (f.group ? f.t.subs.some(live) : !(f.s ? !live(f.s) : f.t.noMull));
function mullAssign() {
  const T = S.tasks, M = T.mull || (T.mull = { cur: null, served: [], last: null }), cands = T.categories.filter((c) => mullNext(c));
  if (!cands.length) { M.cur = null; return false; }
  let fresh = cands.filter((c) => !M.served.includes(c.id));
  if (!fresh.length) { M.served = []; fresh = cands.filter((c) => c.id !== M.last); if (!fresh.length) fresh = cands; }
  const c = fresh[Math.floor(Math.random() * fresh.length)];
  M.served.push(c.id); M.last = c.id; M.cur = mullNext(c); return true;
}
/* mull:end */

async function loadTasksData() {
  if (S.tasks) return;
  try { S.tasks = JSON.parse(await api.loadTasks()); } catch { S.tasks = null; }
  if (!S.tasks || !Array.isArray(S.tasks.categories)) S.tasks = { categories: [] };
  S.tasks.categories.forEach((c) => c.tasks.forEach((t) => { t.subs = t.subs || []; if (t.subs.length && t.noMull) t.subs.forEach((x) => { x.noMull = true; }); }));
  sweepHolds(); holdSig = holdSigNow();
  try { dbLoadFile().then(() => { if (DB.d.stats.lastDone == null && S.tasks) { DB.d.stats.lastDone = dbDoneCount(); dbSaveQuiet(); } }); } catch { /* dashboard code not ready */ }
}
function mullText() {
  const T = S.tasks, M = T && T.mull; if (!M || !M.cur) return '';
  const f = mullFind(M.cur); return f.ok && !mullDone(M.cur) && mullIn(f) ? (f.group ? f.t.text : f.s ? f.s.text : f.t.text) : '';
}
function mullHtml() {
  const T = S.tasks; if (!T) return '<div class="p-mull idle" id="p-mull"><span>Loading tasks…</span></div>';
  const M = T.mull, f0 = M && M.cur ? mullFind(M.cur) : null, f = f0 && f0.ok && (mullDone(M.cur) || mullIn(f0)) ? f0 : null, left = T.categories.some((c) => mullNext(c)), pend = left ? null : mullPending();
  if (f && f.ok) {
    const done = mullDone(M.cur), col = PAL[f.c.color % PAL.length];
    const tail = done ? (left ? '<button class="p-mnext" data-mull="next">Assign next task</button>' : pend !== null ? `<small class="p-mall p-wait">${HOURGLASS}Next at ${fmtMin(pend)}</small>` : '<small class="p-mall">That was the last one</small>') : '';
    if (f.group) {
      const subs = f.t.subs.filter(live), nd = subs.filter((x) => x.done).length;
      return `<div class="p-mull grp${done ? ' done' : ''}${f.t.note ? ' has-note' : ''}" id="p-mull" style="--c:${col}"><div class="p-mrow"><button class="p-mbox" data-mull="tick" title="${done ? 'Untick all' : 'Tick all'}"></button><div class="p-mt"><b>${esc(f.t.text)}</b><small>${esc(f.c.name)} · ${nd}/${subs.length}</small></div>${tail}</div><div class="p-msubs">${subs.map((x) => `<button class="p-msub${x.done ? ' on' : ''}" data-mull="sub" data-sid="${x.id}"><i></i><span>${esc(x.text)}</span></button>`).join('')}</div></div>`;
    }
    const title = f.s ? f.s.text : f.t.text, crumb = f.s ? `${f.c.name} › ${f.t.text}` : f.c.name;
    return `<div class="p-mull${done ? ' done' : ''}${f.t.note ? ' has-note' : ''}" id="p-mull" style="--c:${col}"><button class="p-mbox" data-mull="tick" title="${done ? 'Mark as not done' : 'Mark as done'}"></button><div class="p-mt"><b>${esc(title)}</b><small>${esc(crumb)}</small></div>${tail}</div>`;
  }
  return `<div class="p-mull idle" id="p-mull">${left ? '<span>Ready when you are</span><button class="p-mnext" data-mull="next">Assign a task</button>' : pend !== null ? `<span class="p-wait">${HOURGLASS}<span>Nothing right now · next task unlocks at ${fmtMin(pend)}</span></span>` : '<span>Nothing left to mull. Everything’s ticked off.</span>'}</div>`;
}
function renderMull() {
  const el = $('p-mull'); P.noteEl = null; tip.hidden = true;
  const ms = el && el.querySelector('.p-msubs'), st = ms ? ms.scrollTop : 0;
  if (el) el.outerHTML = mullHtml();
  const ns = st && $('p-mull') && $('p-mull').querySelector('.p-msubs'); if (ns) ns.scrollTop = st;
  updPomo(); updTally();
}
function mullAct(a, sid) {
  const T = S.tasks; if (!T) return; const M = T.mull;
  if (a === 'next') mullAssign();
  else if (M && M.cur) {
    const f = mullFind(M.cur); if (!f.ok) return;
    if (a === 'tick') {
      const v = !mullDone(M.cur);
      if (f.group) { f.t.subs.forEach((x) => { if (live(x)) x.done = v; }); f.t.done = f.t.subs.every((x) => x.done); }
      else if (f.s) { f.s.done = v; f.t.done = f.t.subs.every((x) => x.done); } else setTaskDone(f.t, v);
    } else if (a === 'sub' && f.group) {
      const s = f.t.subs.find((x) => x.id === sid); if (s) { s.done = !s.done; f.t.done = f.t.subs.every((x) => x.done); }
    }
  }
  tChanged(); renderMull();
}

function subRow(t, s, si) {
  const r = document.createElement('div'); const mm = !!S.mullMode; r.className = 't-row t-sub' + (mm ? ` mm-${s.noMull ? 'off' : 'on'}${s.done ? ' strike' : ''}` : (s.done ? ' done' : ''));
  r.innerHTML = `<span class="t-box"></span><span class="t-text">${esc(s.text)}</span>${!s.done && !s.noMull ? holdChip(s, !mm) : ''}`;
  const rename = () => inlineEdit(r.querySelector('.t-text'), s.text, (v) => { s.text = v; tChanged(); });
  r.querySelector('.t-box').onclick = () => { if (mm) toggleMullSub(t, s); else { s.done = !s.done; t.done = t.subs.every((x) => x.done); } tChanged(); };
  r.querySelector('.t-text').ondblclick = rename;
  r.oncontextmenu = (e) => {
    e.preventDefault();
    ctxAt(e, [
      ['Add subtasks…', () => subModal(t)],
      ...holdMenu(s, mm && !s.noMull),
      ['Rename', rename],
      si > 0 && ['Move up', () => { mv(t.subs, si, -1); tChanged(); }],
      si < t.subs.length - 1 && ['Move down', () => { mv(t.subs, si, 1); tChanged(); }],
      null,
      ['Delete subtask', () => { t.subs.splice(si, 1); if (t.subs.length) t.done = t.subs.every((x) => x.done); tChanged(); }, 'danger'],
    ].filter((x) => x !== false));
  };
  return r;
}
function holdMenu(x, ok) {
  if (!ok) return [];
  return holdState(x) === 'none'
    ? [['Make time-based…', () => holdModal(x)]]
    : [['Change time…', () => holdModal(x)], ['Remove time', () => { delete x.after; tChanged(); }]];
}
function holdModal(x) {
  const cur = holdState(x) !== 'none' ? x.after.min : Math.min(23 * 60 + 59, (Math.floor(nowMin() / 60) + 1) * 60);
  const ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = `<div class="t-card g-card"><h3>${HOURGLASS} Make time-based</h3><div class="t-for">${esc(x.text)}</div><input type="time" class="t-time" value="${pad2(Math.floor(cur / 60))}:${pad2(cur % 60)}"><div class="t-for" style="margin:10px 0 0;font-size:12.5px;color:var(--dim)">Every day it joins the mulling rotation at this time and stays in until midnight. Before that time it stays out of the rotation.</div><div class="t-actions">${x.after ? '<button data-a="del">Remove time</button>' : ''}<span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Set time</button></div></div>`;
  const inp = ov.querySelector('input'), close = () => ov.remove();
  const ok = () => { const m = /^(\d{1,2}):(\d{2})$/.exec(inp.value); if (!m) return; x.after = { min: +m[1] * 60 + +m[2] }; close(); tChanged(); };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); if (a === 'del') { delete x.after; close(); tChanged(); } };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter') ok(); };
  document.body.appendChild(ov); inp.focus();
}
function subModal(t) {
  const ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = `<div class="t-card g-card"><h3>Add subtasks</h3><div class="t-for">${esc(t.text)}</div><textarea style="height:140px" placeholder="One per line. End a line with x4 to repeat it, for example: Edit 5 minutes x4"></textarea><div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Add</button></div></div>`;
  const ta = ov.querySelector('textarea'), close = () => ov.remove();
  const ok = () => {
    const names = ta.value.split(/\r?\n/).flatMap(expandRepeat); close(); if (!names.length) return;
    t.subs = t.subs || []; names.forEach((n) => t.subs.push({ id: uid(), text: n, done: false, noMull: !!t.noMull }));
    t.done = t.subs.every((x) => x.done); t.collapsed = false; tChanged();
  };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && e.ctrlKey) ok(); };
  document.body.appendChild(ov); ta.focus();
}

function workHtml() {
  const T = S.tasks, on = !!(T && T.mull && T.mull.workOnly);
  return `<div class="p-card"><h3>Mulling</h3><label class="p-chk"><input type="checkbox" data-wo${on ? ' checked' : ''}${T ? '' : ' disabled'}><span>Work tasks only<small>Skip row 1 (daily tasks) and only feed me row 2 (work tasks)</small></span></label><label class="p-chk"><input type="checkbox" data-tally${P.cfg.tally ? ' checked' : ''}><span>Display mulling task tally<small>Show how many mulling tasks are complete under the task box</small></span></label></div>`;
}
function setWorkOnly(v) {
  const T = S.tasks; if (!T) return;
  const M = T.mull || (T.mull = { cur: null, served: [], last: null });
  M.workOnly = v; M.served = []; tChanged(); renderMull();
}

/* ---------- chart sizing ---------- */
const chartW = (id) => Math.max(360, Math.floor(($(id).clientWidth || 0) - 34));
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (isV('health')) renderHMain(); else if (isV('finance') && F.tab !== 'income') renderFCharts(fStats()); }, 150);
});

function mullNote() {
  const T = S.tasks, M = T && T.mull; if (!M || !M.cur) return '';
  const f = mullFind(M.cur); return f.ok && f.t.note ? f.t.note : '';
}
$('pomo').addEventListener('mouseover', (e) => {
  const m = e.target.closest && e.target.closest('.p-mull.has-note');
  if (m === P.noteEl) return; P.noteEl = m;
  if (!m) { tip.hidden = true; return; }
  const n = mullNote(); if (n) gTip(m, n);
});

function updTally() {
  const el = $('p-tally'); if (!el) return;
  if (!P.cfg.tally || !S.tasks) { el.hidden = true; return; }
  const mp = mullProgress(); el.hidden = false; el.textContent = `Tasks complete: ${mp.done}/${mp.tot}`;
  el.classList.toggle('all', mp.tot > 0 && mp.done === mp.tot);
}

/* cmp:start */
const mshort = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5) - 1, 1).toLocaleDateString('en', { month: 'short' });
function cmpData(st) {
  const tx = F.cache[ymAdd(F.ym, -1)]; if (tx === undefined) return null;
  const prev = {}; let pt = 0; tx.forEach((t) => { prev[t.cat] = (prev[t.cat] || 0) + t.amt; pt += t.amt; });
  const cats = [...F.cats]; [...Object.keys(st.byCat), ...Object.keys(prev)].forEach((c) => { if (!cats.includes(c)) cats.push(c); });
  return { prev, pt, cats };
}
function fCompare(st) {
  const d = cmpData(st); if (!d) return '<div class="h-empty">Loading last month…</div>';
  if (!st.total && !d.pt) return '<div class="h-empty">No spending in either month yet.</div>';
  const rows = d.cats.filter((c) => (st.byCat[c] || 0) > 0 || (d.prev[c] || 0) > 0).sort((x, y) => ((st.byCat[y] || 0) - (st.byCat[x] || 0)) || ((d.prev[y] || 0) - (d.prev[x] || 0)));
  const mx = Math.max(1, ...rows.flatMap((c) => [st.byCat[c] || 0, d.prev[c] || 0]));
  const html = rows.map((c, i) => {
    const pv = d.prev[c] || 0, cv = st.byCat[c] || 0, diff = cv - pv, col = fcol(c);
    const chip = pv === 0 ? ['new', '● new'] : diff === 0 ? ['flat', '— same'] : diff > 0 ? ['up', `▲ ${short(diff)}`] : ['down', `▼ ${short(-diff)}`];
    return `<div class="cmp-row${F.filter === c ? ' on' : ''}" data-f="cat" data-c="${ea(c)}" style="--c:${col};--i:${i}" title="${ea(c)} · ${mshort(ymAdd(F.ym, -1))} ${money(pv)} → ${mshort(F.ym)} ${money(cv)}">
      <div class="cmp-name"><i></i><span>${esc(c)}</span></div>
      <div class="cmp-bars">
        <div class="cmp-bar prev"><span class="cmp-trk"><u style="width:${(pv / mx * 100).toFixed(1)}%"></u></span><em>${pv ? short(pv) : '–'}</em></div>
        <div class="cmp-bar cur"><span class="cmp-trk"><u style="width:${(cv / mx * 100).toFixed(1)}%"></u></span><em>${cv ? short(cv) : '–'}</em></div>
      </div>
      <div class="cmp-delta ${chip[0]}">${chip[1]}</div>
    </div>`;
  }).join('');
  return `<div class="cmp-rows">${html}</div>`;
}
function cmpInner(st) {
  const d = cmpData(st), pm = mshort(ymAdd(F.ym, -1)), cm = mshort(F.ym), pct = d && d.pt ? Math.round((st.total - d.pt) / d.pt * 100) : null;
  const anim = d && F.cmpAnim !== F.ym; if (d) F.cmpAnim = F.ym;
  const pill = d && (st.total || d.pt) ? (pct == null ? '<span class="cmp-pill new">new spending</span>' : `<span class="cmp-pill ${pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'}">${pct > 0 ? '▲' : pct < 0 ? '▼' : '—'} ${Math.abs(pct)}%</span>`) : '';
  const sum = d && (st.total || d.pt) ? `<div class="cmp-sum"><div><small>${pm}</small><b>${money(d.pt)}</b></div><div class="cmp-arrow">→</div><div><small>${cm}</small><b>${money(st.total)}</b></div>${pill}</div>` : '';
  return `<div class="cmp-card${anim ? ' cmp-anim' : ''}"><div class="h-ch"><h3>This month vs last month</h3><span class="h-hint"><i class="cmp-k prev"></i>${pm} <i class="cmp-k cur"></i>${cm}</span></div>${sum}${fCompare(st)}</div>`;
}
/* cmp:end */
async function fFillPrev() {
  const p = ymAdd(F.ym, -1), ym0 = F.ym;
  if (F.cache[p] === undefined) { const t = await api.financeLoad(p); F.cache[p] = t ? parseF(t).tx : []; }
  if (isV('finance') && F.ym === ym0) { if ($('f-c-cmp')) fitCmp(fStats()); }
}


/* ---------- theme switcher ---------- */
const HKC = { weight: 'a3', cal: 'amb', pro: 'mag', card: 'grn', sleep: 'a2', steps: 'rose' };
function applyTheme(name, rerender) {
  if (!THEMES[name]) name = 'cyberpunk';
  Object.assign(TC, THEMES[name].c);
  PAL.splice(0, PAL.length, TC.mag, TC.a2, TC.a3, TC.rose, TC.amb, TC.grn);
  FCOL = FCOL_K.map((k) => TC[k]);
  HK.forEach((x) => { x.color = TC[HKC[x.k]]; });
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem('sp-theme', name); } catch (e) { /* ignore */ }
  const b = $('btn-theme'); if (b) b.title = `Theme: ${THEMES[name].label} · menu also has Open vault and backups`;
  if (rerender) {
    [S.view, S.side].forEach((v) => {
      if (v === 'tasks') renderTasks(); else if (v === 'gantt') renderGantt(); else if (v === 'pomo') renderPomo();
      else if (v === 'health') renderHealth(); else if (v === 'finance') { renderFinance(); fFillCache(); fFillPrev(); } else if (v === 'dash') renderDash();
      else if (v === 'calendar' && typeof calRender === 'function') calRender();
    });
  }
}
function curTheme() { return document.documentElement.dataset.theme || 'cyberpunk'; }
$('btn-theme').onclick = (e) => {
  e.stopPropagation();
  const r = e.currentTarget.getBoundingClientRect();
  ctxAt({ clientX: r.left, clientY: r.bottom + 6, preventDefault() {}, stopPropagation() {} }, Object.keys(THEMES).map((k) => [`${curTheme() === k ? '●' : '○'}  ${THEMES[k].label}`, () => applyTheme(k, true)]).concat([null, ['Open vault…', chooseVault], ['Back up now', backupNow], ['Restore from backup…', restoreDlg]]));
};
let savedTheme = 'cyberpunk'; try { savedTheme = localStorage.getItem('sp-theme') || 'cyberpunk'; } catch (e) { /* ignore */ }
applyTheme(savedTheme, false);

/* ================= INCOME (Signal Path 4.1) =================
   Second page under Finance. Stored as Finance/Income.md (readable in Obsidian).
   To invoice = entries not yet invoiced. Withdrawing = invoiced entries. In bank is typed by hand.
   Real total = To invoice + Withdrawing + In bank. */
const INC = { rows: [], bank: 0, filter: 'all', client: '', saveT: null, loaded: false, msg: '' };
const incAmt = (s) => parseNum(String(s == null ? '' : s).replace(/[^\d.\-,]/g, ''));
const incYes = (s) => /^(y|yes|true|x|✓|✔|1)$/i.test(String(s || '').trim());

function incParse(text) {
  const out = { bank: 0, rows: [] }; if (!text) return out;
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) fm[1].split(/\r?\n/).forEach((l) => { const m = l.match(/^(\w+):\s*(.*)$/); if (m && m[1] === 'in_bank') out.bank = parseNum(m[2]) || 0; });
  let sec = '';
  text.split(/\r?\n/).forEach((l) => {
    let m; if ((m = l.match(/^## (.+)/))) { sec = m[1].trim().toLowerCase(); return; }
    if (sec !== 'entries' || !l.startsWith('|')) return;
    const c = l.trim().replace(/^\||\|$/g, '').split('|').map((s) => s.trim());
    if (incAmt(c[2]) == null) return;
    out.rows.push({ id: uid(), client: c[0] || '', job: c[1] || '', amt: incAmt(c[2]), note: c[3] || '', inv: incYes(c[4]) });
  });
  return out;
}
function incTot() {
  let to = 0, wd = 0, nt = 0, nw = 0;
  INC.rows.forEach((r) => { if (r.inv) { wd += r.amt; nw++; } else { to += r.amt; nt++; } });
  return { to, wd, nt, nw, bank: INC.bank, real: to + wd + INC.bank };
}
function incMd() {
  const t = incTot();
  let o = `---\ntype: income\ncurrency: ${F.cur}\nin_bank: ${INC.bank}\n---\n# Income\n\n## Summary\n| To invoice | Withdrawing | In bank | Real total |\n|---|---|---|---|\n| ${money(t.to)} | ${money(t.wd)} | ${money(t.bank)} | ${money(t.real)} |\n\n## Entries\n| Client | Job | Price | Comments | Invoiced |\n|---|---|---|---|---|\n`;
  INC.rows.forEach((r) => { o += `| ${pipe(r.client)} | ${pipe(r.job)} | ${r.amt} | ${pipe(r.note)} | ${r.inv ? 'yes' : ''} |\n`; });
  return o;
}
async function incLoadSafe() { try { await incLoad(); } catch (err) { INC.rows = []; INC.bank = 0; INC.loaded = true; INC.msg = 'Could not read Income.md: ' + err.message; } }
async function incLoad() { const p = incParse(await api.incomeLoad()); INC.rows = p.rows; INC.bank = p.bank; INC.loaded = true; }
function incSaveSoon() { uNote('income'); clearTimeout(INC.saveT); INC.saveT = setTimeout(incSaveNow, 500); }
async function incSaveNow() { clearTimeout(INC.saveT); INC.saveT = null; try { await api.incomeSave(incMd()); } catch (err) { const s = $('i-sub'); if (s) s.textContent = 'Could not save Income.md: ' + err.message; } }
window.addEventListener('beforeunload', () => { if (INC.saveT) api.incomeSave(incMd()); });

function incMixHtml(t) {
  const parts = [['To invoice', t.to, TC.a3], ['Withdrawing', t.wd, TC.amb], ['In bank', t.bank, TC.grn]].map(([l, v, c]) => [l, Math.max(0, v), c]);
  const sum = parts.reduce((a, p) => a + p[1], 0); if (sum <= 0) return '';
  return `<div class="i-mix">${parts.filter((p) => p[1] > 0).map(([l, v, c]) => `<i style="flex:${v};background:${c}" title="${l} ${money(v)}"></i>`).join('')}</div>
    <div class="i-leg">${parts.map(([l, v, c]) => `<span style="--c:${c}"><i></i>${l} · ${Math.round(v / sum * 100)}%</span>`).join('')}</div>`;
}
function incStats() {
  const t = incTot();
  $('i-stats').innerHTML = `
    <div class="h-stat" style="--c:${TC.a3}"><small>To invoice</small><b>${money(t.to)}</b><small>${t.nt} job${t.nt === 1 ? '' : 's'} waiting</small></div>
    <div class="h-stat" style="--c:${TC.amb}"><small>Withdrawing</small><b>${money(t.wd)}</b><small>${t.nw} invoiced</small></div>
    <div class="h-stat" style="--c:${TC.grn}"><small>In bank</small><div class="i-bankrow"><span>${esc(F.cur)}</span><input id="i-bank" class="i-bankin" inputmode="decimal" autocomplete="off" value="${INC.bank}"></div><small>type this one in by hand</small></div>
    <div class="h-stat i-real" style="--c:${TC.mag}"><small>Real total</small><b id="i-real-v">${money(t.real)}</b><small>to invoice + withdrawing + in bank</small></div>`;
  $('i-mixw').innerHTML = incMixHtml(t);
}
function incLive() {
  const t = incTot(); const v = $('i-real-v'); if (v) v.textContent = money(t.real);
  $('i-mixw').innerHTML = incMixHtml(t);
}

function incomeRender() {
  $('finance').innerHTML = `<div class="t-head"><div><h1 class="h-titles"><span class="h-ttl" data-ft="finance">Finance</span><span class="h-ttl on" data-ft="income">Income</span></h1><div class="t-sub" id="i-sub"></div></div></div>
    <div class="f-scroll"><div class="i-stats" id="i-stats"></div><div id="i-mixw"></div>
      <div class="p-card"><div class="f-addrow" id="i-add"><input id="i-cl" class="f-in" style="width:170px" placeholder="Client" list="i-clients" autocomplete="off" value="${ea(INC.client)}"><input id="i-jb" class="f-in f-grow" placeholder="Job" autocomplete="off"><input id="i-pr" class="f-in f-amt" placeholder="Price" inputmode="decimal" autocomplete="off"><input id="i-cm" class="f-in f-grow" placeholder="Comments (optional)" autocomplete="off"><button class="g-primary" data-i="add">Add</button></div></div>
      <div class="p-card" id="i-card"></div></div><datalist id="i-clients"></datalist>`;
  incStats(); incTable();
}
function incTable() {
  const t = incTot(), n = INC.rows.length;
  const chips = [['all', 'All', n], ['to', 'To invoice', t.nt], ['inv', 'Invoiced', t.nw]].map(([k, l, c]) => `<button class="f-cat${INC.filter === k ? ' on' : ''}" data-i="filter" data-v="${k}" style="--c:${k === 'to' ? TC.a3 : k === 'inv' ? TC.amb : '#ffffff'}"><i></i>${l} · ${c}</button>`).join('');
  $('i-card').innerHTML = `<div class="h-ch"><h3>Entries</h3><span class="h-hint" id="i-shown"></span><div class="h-chips">${chips}</div><button data-i="paste">Paste from Sheets</button></div>
    <div class="f-txs"><table class="h-tbl f-tbl i-tbl"><thead><tr><th style="width:15%">Client</th><th style="width:22%">Job</th><th style="width:11%">Price</th><th>Comments</th><th style="width:118px">Invoiced?</th><th style="width:34px"></th></tr></thead><tbody id="i-rows"></tbody></table></div>`;
  incRows();
}
function incRows() {
  const rows = INC.rows.filter((r) => INC.filter === 'all' || (INC.filter === 'inv') === r.inv);
  $('i-rows').innerHTML = rows.map((r) => `<tr data-id="${r.id}"${r.inv ? ' class="inv"' : ''}><td><input class="f-in" data-k="client" list="i-clients" value="${ea(r.client)}"></td><td><input class="f-in" data-k="job" value="${ea(r.job)}"></td><td><input class="f-in f-num" data-k="amt" value="${r.amt}"></td><td><input class="f-in" data-k="note" value="${ea(r.note)}"></td><td><button class="i-tick${r.inv ? ' on' : ''}" data-i="inv" title="${r.inv ? 'Move back to To invoice' : 'Mark as invoiced: moves it into Withdrawing'}"><i></i>${r.inv ? 'Invoiced' : 'Invoice'}</button></td><td><button class="f-x" data-i="del" title="Delete">×</button></td></tr>`).join('') || `<tr><td colspan="6" class="h-empty">${INC.rows.length ? 'Nothing in this view.' : 'No income entries yet. Add your first one above.'}</td></tr>`;
  $('i-shown').textContent = `${rows.length} shown · ${money(rows.reduce((a, r) => a + r.amt, 0))}`;
  $('i-clients').innerHTML = [...new Set(INC.rows.map((r) => r.client).filter(Boolean))].map((c) => `<option value="${ea(c)}">`).join('');
  const t = incTot(); $('i-sub').textContent = INC.msg || `${INC.rows.length} entr${INC.rows.length === 1 ? 'y' : 'ies'} · ${t.nt} to invoice`; INC.msg = '';
}
function incRefresh() { incStats(); incTable(); }

function incAdd() {
  const amt = incAmt($('i-pr').value);
  if (amt == null) { const i = $('i-pr'); i.classList.add('bad'); setTimeout(() => i.classList.remove('bad'), 900); i.focus(); return; }
  INC.client = $('i-cl').value.trim();
  INC.rows.push({ id: uid(), client: INC.client, job: $('i-jb').value.trim(), amt, note: $('i-cm').value.trim(), inv: false });
  ['i-jb', 'i-pr', 'i-cm'].forEach((k) => { $(k).value = ''; }); $('i-jb').focus();
  incRefresh(); incSaveSoon();
}
function incPaste() {
  const ov = document.createElement('div'); ov.className = 't-modal';
  ov.innerHTML = `<div class="t-card g-card"><h3>Paste from Google Sheets</h3><div class="t-for">Copy rows (Client, Job, Price, Comments, Invoiced) and paste them here. “YES” in the last column marks a row as invoiced.</div><textarea style="height:180px"></textarea><div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Import</button></div></div>`;
  const ta = ov.querySelector('textarea'), close = () => ov.remove();
  const ok = () => {
    let n = 0, skipped = 0;
    ta.value.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) return;
      const c = line.split('\t').map((s) => s.trim()), amt = incAmt(c[2]);
      if (amt == null) { skipped++; return; }
      INC.rows.push({ id: uid(), client: c[0] || '', job: c[1] || '', amt, note: c[3] || '', inv: incYes(c[4]) }); n++;
    });
    close(); INC.msg = `Imported ${n} row${n === 1 ? '' : 's'}${skipped ? `, skipped ${skipped}` : ''}`; incRefresh(); incSaveSoon();
  };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  document.body.appendChild(ov); ta.focus();
}

const incEl = $('finance');
incEl.addEventListener('click', async (e) => {
  const tt = e.target.closest('[data-ft]');
  if (tt) {
    const v = tt.dataset.ft; if ((F.tab === 'income' ? 'income' : 'finance') === v) return;
    if (F.saveT) await fSaveNow(); if (INC.saveT) await incSaveNow();
    if (v === 'income' && !INC.loaded) await incLoadSafe();
    F.tab = v; renderFinance(); if (v === 'finance') { fFillCache(); fFillPrev(); } return;
  }
  const el = e.target.closest('[data-i]'); if (!el) return; const a = el.dataset.i;
  if (a === 'add') incAdd();
  else if (a === 'paste') incPaste();
  else if (a === 'filter') { INC.filter = el.dataset.v; incTable(); }
  else if (a === 'inv') { const r = INC.rows.find((x) => x.id === el.closest('tr').dataset.id); if (!r) return; r.inv = !r.inv; incRefresh(); incSaveSoon(); }
  else if (a === 'del') {
    const r = INC.rows.find((x) => x.id === el.closest('tr').dataset.id); if (!r) return;
    uiConfirm({ title: 'Delete this entry?', msg: `${r.client || 'No client'} · ${r.job || 'No job'} · ${money(r.amt)}`, ok: 'Delete', danger: true, cb: () => { INC.rows = INC.rows.filter((x) => x.id !== r.id); incRefresh(); incSaveSoon(); } });
  }
});
incEl.addEventListener('input', (e) => { if (e.target.id !== 'i-bank') return; INC.bank = incAmt(e.target.value) || 0; incLive(); incSaveSoon(); });
incEl.addEventListener('change', (e) => {
  const i = e.target;
  if (i.id === 'i-bank') { i.value = INC.bank; return; }
  if (!i.dataset.k || !i.closest('#i-rows')) return;
  const r = INC.rows.find((x) => x.id === i.closest('tr').dataset.id), k = i.dataset.k; if (!r) return;
  if (k === 'amt') { const v = incAmt(i.value); if (v == null) { i.value = r.amt; return; } r.amt = v; i.value = v; } else r[k] = i.value.trim();
  incSaveSoon(); incStats(); incRows();
});
incEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  if (e.target.closest('#i-add')) incAdd(); else if (e.target.id === 'i-bank') e.target.blur();
});

/* ================= UNDO / REDO (Signal Path 4.2) =================
   Each page keeps its own history (up to U.max steps) of snapshots of its data. Notes keep one history per
   open note. A quick burst of changes (typing, dragging) counts as one step. History lives in memory only. */
const U = { s: {}, max: 100, budget: 40e6 };
const USN = {
  tasks: () => (S.tasks ? JSON.stringify(S.tasks) : null),
  gantt: () => (S.gantt ? JSON.stringify(S.gantt) : null),
  health: () => (H.loaded ? toMdH() : null),
  fin: () => (F.ym ? JSON.stringify({ ym: F.ym, cur: F.cur, cats: F.cats, tx: F.tx }) : null),
  income: () => (INC.loaded ? JSON.stringify({ rows: INC.rows, bank: INC.bank }) : null),
  gym: () => (typeof GY !== 'undefined' && GY.loaded && GY.d ? JSON.stringify(GY.d) : null),
  dash: () => (DB.loaded ? JSON.stringify({ goals: DB.d.goals, quotes: DB.d.quotes }) : null),
};
const UAP = {
  tasks(s) { S.tasks = JSON.parse(s); renderTasks(); if ($('p-mull')) renderMull(); tSaveNow(); },
  gantt(s) { S.gantt = JSON.parse(s); renderGantt(); gSaveNow(); },
  health(s) { H.w = genWeeks(H.year); H.meat = HD.map(() => ({ meat: '', notes: '' })); fromMdH(s); renderHealth(); hSaveNow(); },
  fin(s) { const o = JSON.parse(s); F.cur = o.cur; F.cats = o.cats; F.tx = o.tx; F.cache = {}; renderFinance(); fFillCache(); fFillPrev(); fSaveNow(); },
  income(s) { const o = JSON.parse(s); INC.rows = o.rows; INC.bank = o.bank; incomeRender(); incSaveNow(); },
  gym(s) { GY.d = JSON.parse(s); gymRender(); gSaveSoon(true); },
  dash(s) { const o = JSON.parse(s); DB.d.goals = o.goals; DB.d.quotes = o.quotes; dbRenderGoals(); DB.order = []; dbQuoteNext(true); dbSaveNow(); },
};
const uKey = (k) => (k === 'health' ? 'health:' + H.year : k === 'fin' ? 'fin:' + F.ym : k);
const uSt = (key) => U.s[key] || (U.s[key] = { u: [], r: [], last: null, t: 0 });
function uKindNow() {
  const v = S.view;
  if (v === 'notes') return 'notes';
  if (v === 'tasks' || v === 'pomo') return 'tasks';
  if (v === 'gantt') return 'gantt';
  if (v === 'dash') return 'dash';
  if (v === 'health') return H.tab === 'gym' ? (typeof GY !== 'undefined' && GY.ed ? null : 'gym') : 'health';
  if (v === 'finance') return F.tab === 'income' ? 'income' : 'fin';
  return null;
}
function uTrim(st) {
  const sz = (x) => (x.s || x.text || '').length;
  while (st.u.length > U.max) st.u.shift();
  let b = st.u.reduce((a, x) => a + sz(x), 0); while (b > U.budget && st.u.length > 1) b -= sz(st.u.shift());
}
function uBase(kind) { const st = uSt(uKey(kind)); if (st.last !== null) return; const s = USN[kind](); if (s !== null) st.last = s; }
function uNote(kind) {
  if (U.busy) return; const s = USN[kind](); if (s === null) return;
  const st = uSt(uKey(kind)), now = Date.now();
  if (st.last === null) { st.last = s; return; }
  if (s === st.last) return;
  if (now - st.t > 350) { st.u.push({ s: st.last }); uTrim(st); }
  st.last = s; st.t = now; st.r = []; uUI();
}
function uUI() {
  const ub = $('btn-undo'), rb = $('btn-redo'); if (!ub) return;
  const kind = uKindNow(); let u = 0, r = 0;
  if (kind === 'notes') { const t = cur(); if (t && t.hist) { u = t.hist.u.length; r = t.hist.r.length; } }
  else if (kind) { const st = U.s[uKey(kind)]; if (st) { u = st.u.length; r = st.r.length; } }
  ub.disabled = !u; rb.disabled = !r;
  ub.title = !kind ? 'Undo isn’t available on this page' : u ? `Undo (Ctrl+Z) · ${u} step${u === 1 ? '' : 's'}` : 'Nothing to undo';
  rb.title = !kind ? 'Redo isn’t available on this page' : r ? `Redo (Ctrl+Y) · ${r} step${r === 1 ? '' : 's'}` : 'Nothing to redo';
}
function uStep(dir) {
  const kind = uKindNow(); if (!kind) return;
  if (kind === 'notes') { nStep(dir); return; }
  const st = uSt(uKey(kind)); st.t = 0; uNote(kind);
  const from = dir < 0 ? st.u : st.r, to = dir < 0 ? st.r : st.u; if (!from.length) return;
  const e = from.pop(); to.push({ s: st.last });
  U.busy = true; try { UAP[kind](e.s); } finally { U.busy = false; }
  st.last = e.s; st.t = 0; uUI();
  if (typeof gToast === 'function') gToast(dir < 0 ? 'Undone' : 'Redone');
}
function uWrap(name, kind) {
  const f = window[name]; if (typeof f !== 'function') return;
  window[name] = function (...a) { if (kind) uBase(kind); const out = f.apply(this, a); uUI(); return out; };
}
uWrap('renderTasks', 'tasks'); uWrap('renderGantt', 'gantt'); uWrap('renderHealth', 'health'); uWrap('renderFinance', 'fin'); uWrap('incomeRender', 'income'); uWrap('setView', null);

/* notes: one history per open note, kept as markdown snapshots plus the caret position */
function nOff() {
  const ed = $('ed'), s = getSelection(); if (!ed || !s.rangeCount || !ed.contains(s.anchorNode)) return null;
  const r = document.createRange(); r.selectNodeContents(ed); r.setEnd(s.anchorNode, s.anchorOffset); return r.toString().length;
}
function nSetOff(off) {
  const ed = $('ed'); if (off == null) { caret(ed, false); return; }
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n, acc = 0;
  while ((n = w.nextNode())) {
    const l = n.nodeValue.length;
    if (acc + l >= off) { const r = document.createRange(); r.setStart(n, off - acc); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; }
    acc += l;
  }
  caret(ed, false);
}
function nBase(t) { t.hist = t.hist || { u: [], r: [], last: null, t: 0, off: null }; if (t.hist.last === null) t.hist.last = t.text; uUI(); }
function nRec(t) {
  const h = t.hist || (t.hist = { u: [], r: [], last: null, t: 0, off: null }), now = Date.now();
  if (h.last === null) { h.last = t.text; return; }
  if (t.text === h.last) return;
  if (now - h.t > 700) { h.u.push({ text: h.last, off: h.off }); uTrim(h); }
  h.last = t.text; h.t = now; h.off = nOff(); h.r = []; uUI();
}
function nStep(dir) {
  const t = cur(), ed = $('ed'); if (!t || !t.hist || !ed) return;
  const h = t.hist, from = dir < 0 ? h.u : h.r, to = dir < 0 ? h.r : h.u; if (!from.length) return;
  const e = from.pop(); to.push({ text: h.last, off: h.off });
  ed.innerHTML = fromMd(e.text); t.text = toMd(ed); h.last = t.text; h.off = e.off; h.t = 0; S.range = null;
  markDirty(t); ed.focus(); nSetOff(e.off); uUI();
}

$('btn-undo').onclick = () => uStep(-1); $('btn-redo').onclick = () => uStep(1);
['btn-undo', 'btn-redo'].forEach((id) => { $(id).onmousedown = (e) => { if (S.view === 'notes') e.preventDefault(); }; });
document.addEventListener('focusin', (e) => { const el = e.target; if (el && el.value !== undefined) el.__v = el.value; });
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase(), isUndo = k === 'z' && !e.shiftKey, isRedo = k === 'y' || (k === 'z' && e.shiftKey);
  if (!isUndo && !isRedo) return;
  const el = document.activeElement, kind = uKindNow(); if (!kind) return;
  if (kind === 'notes') {
    const inEd = el && el.closest && el.closest('#ed');
    if (el && el !== document.body && !inEd) return;
    e.preventDefault(); nStep(isUndo ? -1 : 1); return;
  }
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.value !== el.__v) return;
  e.preventDefault(); uStep(isUndo ? -1 : 1);
});
uUI();

/* ================= BACKUP MENU (Signal Path 4.2) ================= */
async function flushAll() {
  await flush(); tSaveNow(); if (G.save) gSaveNow();
  if (H.saveT) await hSaveNow(); if (F.saveT) await fSaveNow(); if (INC.saveT) await incSaveNow();
  if (typeof GY !== 'undefined' && GY.saveT) gSaveSoon(true);
}
async function backupNow() {
  await flushAll(); const r = await api.backupNow();
  if (typeof gToast === 'function') gToast(`Backup saved · ${r.count} files`);
}
const BK_SCOPES = [['all', 'Everything'], ['notes', 'Notes'], ['tasks', 'Tasks, Gantt, Pomodoro & Dashboard'], ['health', 'Health'], ['finance', 'Finance & Income'], ['gym', 'Gym']];
async function restoreDlg() {
  await flushAll();
  const list = await api.backupList();
  const ov = document.createElement('div'); ov.className = 't-modal';
  const when = (s) => { const d = new Date(s.ts); return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + (s.label === 'Daily' ? '' : ' · ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })); };
  if (!list.length) {
    ov.innerHTML = '<div class="t-card g-card"><h3>Restore from backup</h3><div class="t-for">No backups yet. One is made automatically each day when the app opens, or you can use “Back up now” in the logo menu.</div><div class="t-actions"><span></span><button class="primary" data-a="x">OK</button></div></div>';
    ov.onclick = (e) => { if (e.target === ov || (e.target.dataset && e.target.dataset.a === 'x')) ov.remove(); };
    document.body.appendChild(ov); return;
  }
  let sel = list[0].id, step = 0;
  const draw = async () => {
    const sc = (ov.querySelector('#bk-sc') || {}).value || 'all';
    const n = await api.backupPreview(sel, sc);
    ov.innerHTML = `<div class="t-card g-card bk-card"><h3>Restore from backup</h3><div class="t-for">Pick a day. Backups keep about 30 days of notes and data (images aren’t included).</div>
      <div class="bk-list">${list.map((s) => `<button class="bk-row${s.id === sel ? ' on' : ''}" data-id="${ea(s.id)}"><b>${esc(when(s))}</b><span>${esc(s.label)} · ${s.count} files</span></button>`).join('')}</div>
      <div class="g-f"><label>What to restore</label><select id="bk-sc" class="g-in">${BK_SCOPES.map(([k, l]) => `<option value="${k}"${k === sc ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="t-for bk-note">${step ? '<b>Restore these files? A backup of how things are right now is taken first, so this can itself be undone.</b>' : n <= 0 ? 'Nothing in this selection differs from that backup.' : `${n} file${n === 1 ? '' : 's'} will go back to how they were. Anything created after that day is left alone.`}</div>
      <div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok"${n <= 0 ? ' disabled' : ''}>${step ? 'Yes, restore' : 'Restore…'}</button></div></div>`;
  };
  ov.onclick = async (e) => {
    if (e.target === ov) { ov.remove(); return; }
    const row = e.target.closest('.bk-row'), a = e.target.dataset && e.target.dataset.a;
    if (row) { sel = row.dataset.id; step = 0; draw(); }
    else if (a === 'x') ov.remove();
    else if (a === 'ok') {
      if (!step) { step = 1; draw(); return; }
      const btn = e.target; btn.disabled = true; btn.textContent = 'Restoring…';
      await api.backupRestore(sel, ov.querySelector('#bk-sc').value); location.reload();
    }
  };
  ov.onchange = (e) => { if (e.target.id === 'bk-sc') { step = 0; draw(); } };
  ov.onkeydown = (e) => { if (e.key === 'Escape') ov.remove(); };
  document.body.appendChild(ov); draw();
}

/* ================= DASHBOARD (Signal Path 4.3) =================
   An overview page. Goals and quotes are typed in by hand and kept in Dashboard.json; everything else is
   read (never changed) from the other pages' data when the page opens. */
const DB = { d: { goals: {}, quotes: [], stats: { tasks: 0, goals: 0, first: '', lastDone: null } }, loaded: false, X: null, qT: null, qi: -1, order: [], saveT: null, cT: null, just: '', burst: false };
const dbDay = () => pk(new Date());
async function dbLoadFile() {
  if (DB.loaded) return;
  try { const d = JSON.parse(await api.loadData('Dashboard.json')); if (d && typeof d === 'object') { DB.d.goals = d.goals || {}; DB.d.quotes = Array.isArray(d.quotes) ? d.quotes : []; DB.d.stats = Object.assign(DB.d.stats, d.stats || {}); } } catch { /* first run */ }
  DB.loaded = true; if (!DB.d.stats.first) { DB.d.stats.first = dbDay(); dbSaveQuiet(); }
}
function dbSaveSoon() { uNote('dash'); clearTimeout(DB.saveT); DB.saveT = setTimeout(dbSaveNow, 400); }
function dbSaveQuiet() { clearTimeout(DB.saveT); DB.saveT = setTimeout(dbSaveNow, 600); }
function dbDoneCount() { let n = 0; S.tasks.categories.forEach((c) => c.tasks.forEach((t) => leavesOf(t).forEach((x) => { if (x.done) n++; }))); return n; }
/* lifetime counter: every newly ticked task adds one; a couple of un-ticks take it back; a bulk reset (like Uncheck row 1) is ignored */
function dbTaskTick() {
  if (!S.tasks) return; if (!DB.loaded) { dbLoadFile().then(dbTaskTick); return; }
  const st = DB.d.stats, n = dbDoneCount();
  if (st.lastDone == null) { st.lastDone = n; dbSaveQuiet(); return; }
  const d = n - st.lastDone; if (!d) return;
  if (d > 0) st.tasks += d; else if (d >= -2) st.tasks = Math.max(0, st.tasks + d);
  st.lastDone = n; dbSaveQuiet();
}
function dbSaveNow() {
  clearTimeout(DB.saveT); DB.saveT = null;
  const cut = pk(new Date(Date.now() - 90 * 864e5)); Object.keys(DB.d.goals).forEach((k) => { if (k < cut) delete DB.d.goals[k]; });
  api.saveData('Dashboard.json', JSON.stringify(DB.d));
}
window.addEventListener('beforeunload', () => { if (DB.saveT) dbSaveNow(); });

/* ---------- gather (read-only) ---------- */
async function dbGather() {
  const X = {}, now = new Date(), ym = ymNow(), today = dn(pk(now));
  try {
    await loadTasksData(); const mp = mullProgress(); X.tasks = { done: mp.done, tot: mp.tot, next: [], later: [] };
    S.tasks.categories.forEach((c, ci) => { if (c.noMull) return; c.tasks.forEach((t) => leavesOf(t).forEach((x) => {
      if (x.done || x.noMull) return; const item = { text: x.text, cat: c.name, col: PAL[ci % PAL.length] };
      if (holdState(x) === 'wait') X.tasks.later.push({ ...item, min: x.after.min }); else X.tasks.next.push(item);
    })); });
    X.tasks.later.sort((a, b) => a.min - b.min);
  } catch { /* skip */ }
  try {
    if (!P.loaded) { try { const d = JSON.parse(await api.loadData('Pomodoro.pomo.json')); Object.assign(P.cfg, d.cfg || {}); P.stats = d.stats || {}; } catch { /* first run */ } P.loaded = true; if (!P.running && P.left === P.total) { P.total = P.left = P.cfg[P.mode] * 60; } }
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); const s = P.stats[pk(d)] || { n: 0, min: 0 }; return { d, n: s.n, min: s.min }; });
    let streak = 0; for (let i = 0; i < 60; i++) { const d = new Date(); d.setDate(d.getDate() - i); const s = P.stats[pk(d)]; if (s && s.n > 0) streak++; else if (i > 0) break; }
    X.focus = { today: days[6], days, streak, week: days.reduce((a, d) => a + d.min, 0) };
  } catch { /* skip */ }
  try {
    const cur = parseF(await api.financeLoad(ym) || '').tx, prev = parseF(await api.financeLoad(ymAdd(ym, -1)) || '').tx;
    const sum = (a) => a.reduce((s, t) => s + t.amt, 0), byCat = {}; cur.forEach((t) => { byCat[t.cat] = (byCat[t.cat] || 0) + t.amt; });
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0], dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    X.spend = { total: sum(cur), prev: sum(prev), top, proj: now.getDate() ? sum(cur) / now.getDate() * dim : 0, month: mshort(ym), pm: mshort(ymAdd(ym, -1)) };
  } catch { /* skip */ }
  try {
    const p = incParse(await api.incomeLoad() || ''); let to = 0, wd = 0; p.rows.forEach((r) => { if (r.inv) wd += r.amt; else to += r.amt; });
    X.income = { to, wd, bank: p.bank, real: to + wd + p.bank, any: p.rows.length > 0 || p.bank !== 0 };
  } catch { /* skip */ }
  try {
    const y = now.getFullYear(), text = await api.healthLoad(y);
    if (text) {
      const sv = { w: H.w, meat: H.meat, year: H.year, created: H.created }, pts = [], steps = [];
      try { H.w = genWeeks(y); H.meat = HD.map(() => ({ meat: '', notes: '' })); fromMdH(text); H.w.forEach((w) => w.days.forEach((d, i) => { if (d.weight != null) pts.push({ n: w.start + i, v: d.weight }); if (d.steps != null) steps.push({ n: w.start + i, v: d.steps }); })); }
      finally { H.w = sv.w; H.meat = sv.meat; H.year = sv.year; H.created = sv.created; }
      pts.sort((a, b) => a.n - b.n); steps.sort((a, b) => a.n - b.n);
      if (pts.length) { const last = pts[pts.length - 1], ref = [...pts].reverse().find((p) => p.n <= last.n - 7) || pts[0]; X.weight = { last: last.v, delta: last.v - ref.v, spark: pts.slice(-24).map((p) => p.v), n: pts.length }; }
      const s7 = steps.filter((s) => s.n > today - 7); if (s7.length) X.steps = Math.round(s7.reduce((a, s) => a + s.v, 0) / s7.length);
    }
  } catch { /* skip */ }
  try {
    await gLoad(); const mon0 = today - ((today + 3) % 7), wk = GY.d.wk.filter((w) => w.date), inWeek = wk.filter((w) => dn(w.date) >= mon0 && dn(w.date) <= mon0 + 6), last = [...wk].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    X.gym = { week: inWeek.length, dots: Array.from({ length: 7 }, (_, i) => ({ on: inWeek.some((w) => dn(w.date) === mon0 + i), now: mon0 + i === today })), last: last ? { name: last.name || 'Workout', ago: today - dn(last.date) } : null, total: wk.length };
  } catch { /* skip */ }
  try {
    if (!S.gantt) { try { S.gantt = JSON.parse(await api.loadData('Gantt.gantt.json')); } catch { S.gantt = null; } if (!S.gantt || !Array.isArray(S.gantt.groups)) S.gantt = { groups: [] }; S.gantt.groups.forEach((g) => g.tasks.forEach((t) => { t.deps = t.deps || []; t.progress = t.progress || 0; })); }
    const items = []; S.gantt.groups.forEach((g, gi) => g.tasks.forEach((t) => { if ((t.progress || 0) >= 100) return; const s = dn(t.start), e = dn(t.end); if (e < today - 21 || s > today + 21) return; items.push({ name: t.name, p: t.progress || 0, left: e - today, col: PAL[gi % PAL.length], g: g.name, s, e }); }));
    items.sort((a, b) => a.left - b.left); X.gantt = items.slice(0, 4);
  } catch { /* skip */ }
  try {
    const keys = Object.keys(P.stats).filter((k) => (P.stats[k].n || 0) > 0).sort(); let tm = 0, ts = 0, best = null, run = 0, longest = 0, prev = null;
    keys.forEach((k) => { const s = P.stats[k]; tm += s.min || 0; ts += s.n || 0; if (!best || (s.min || 0) > best.min) best = { k, min: s.min || 0 }; const dnum = dn(k); run = prev !== null && dnum - prev === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = dnum; });
    X.life = { min: tm, sessions: ts, best, longest, pstats: P.stats };
  } catch { /* skip */ }
  try { let n = 0; const walk = (a) => a.forEach((x) => (x.type === 'dir' ? walk(x.children || []) : n++)); walk(S.tree || []); X.notes = n; } catch { /* skip */ }
  return X;
}

/* ---------- small pieces ---------- */
const dbEsc = (s) => esc(s);
function dbRing(p, size, label, sub) {
  const r = 34, C = 2 * Math.PI * r, off = C * (1 - Math.max(0, Math.min(1, p)));
  return `<div class="db-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="${r}" class="rt"/><circle cx="40" cy="40" r="${r}" class="rf" style="--C:${C.toFixed(1)};--off:${off.toFixed(1)};stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}" transform="rotate(-90 40 40)"/></svg><div class="rc"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
}
function dbSpark(vals, col) {
  if (vals.length < 2) return '';
  const W = 160, H2 = 46, mn = Math.min(...vals), mxv = Math.max(...vals), rg = mxv - mn || 1, pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, 5 + (1 - (v - mn) / rg) * (H2 - 10)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' '), lp = pts[pts.length - 1];
  return `<svg class="db-spark" viewBox="0 0 ${W} ${H2}" preserveAspectRatio="none"><defs><linearGradient id="dbsg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs><path d="${line} L${W} ${H2} L0 ${H2} Z" fill="url(#dbsg)"/><path class="dl" d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/><circle cx="${lp[0].toFixed(1)}" cy="${lp[1].toFixed(1)}" r="3.4" fill="${col}"/></svg>`;
}
const dbChip = (pct, goodDown) => (pct == null ? '' : `<span class="db-chip ${pct === 0 ? 'flat' : (pct > 0) === !goodDown ? 'good' : 'bad'}">${pct > 0 ? '▲' : pct < 0 ? '▼' : '—'} ${Math.abs(pct)}%</span>`);
const dbN = (n, f) => `<span data-n="${n}" data-f="${f}">${f === 'money' ? money(n) : f === 'hrs' ? n.toFixed(1) : Math.round(n)}</span>`;

/* ---------- goals ---------- */
function dbGoalsHtml() {
  const gs = DB.d.goals[dbDay()] || [], done = gs.filter((g) => g.done).length, all = gs.length > 0 && done === gs.length;
  const yk = pk(new Date(Date.now() - 864e5)), ys = DB.d.goals[yk] || [], yd = ys.filter((g) => g.done).length;
  const rows = gs.map((g) => `<div class="db-goal${g.done ? ' done' : ''}${DB.just === g.id ? ' just' : ''}" data-id="${g.id}"><button class="db-chk" data-a="tick" aria-label="Done"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button><span class="db-gt" data-a="edit" title="Double-click to edit">${dbEsc(g.text)}</span><button class="db-x" data-a="del" title="Remove">×</button></div>`).join('');
  return `<div class="db-gh"><div><h3>Today’s goals</h3><small>${gs.length ? (all ? 'Everything you set out to do is done.' : `${gs.length - done} to go`) : 'What has to happen today? Type it out.'}${ys.length ? ` · yesterday ${yd}/${ys.length}` : ''}</small></div>${gs.length ? dbRing(done / gs.length, 54, `${done}/${gs.length}`) : ''}</div>
    <div class="db-glist">${rows || '<div class="db-empty">No goals yet. Typing them yourself is the point.</div>'}</div>
    <div class="db-gadd"><input id="db-goal" placeholder="Add a goal for today and press Enter…" autocomplete="off" spellcheck="false"></div>${all ? '<div class="db-glow"></div>' : ''}`;
}
function dbRenderGoals(refocus) {
  const el = $('db-goals'); if (!el) return;
  const all = (DB.d.goals[dbDay()] || []).length > 0 && (DB.d.goals[dbDay()] || []).every((g) => g.done);
  el.classList.toggle('all', all); el.innerHTML = dbGoalsHtml();
  if (DB.burst) { DB.burst = false; const b = document.createElement('div'); b.className = 'db-burst'; b.innerHTML = Array.from({ length: 16 }, (_, i) => `<i style="--a:${i * 22.5}deg;--d:${60 + (i % 3) * 22}px"></i>`).join(''); el.appendChild(b); setTimeout(() => b.remove(), 1200); }
  DB.just = ''; if (refocus) { const i = $('db-goal'); if (i) i.focus(); }
}
function dbGoalAct(a, id, el) {
  const gs = DB.d.goals[dbDay()] || (DB.d.goals[dbDay()] = []), g = gs.find((x) => x.id === id);
  if (a === 'tick' && g) { g.done = !g.done; DB.d.stats.goals = Math.max(0, DB.d.stats.goals + (g.done ? 1 : -1)); if (g.done) { DB.just = g.id; if (gs.every((x) => x.done)) DB.burst = true; } dbSaveSoon(); dbRenderGoals(); }
  else if (a === 'del' && g) { DB.d.goals[dbDay()] = gs.filter((x) => x.id !== id); dbSaveSoon(); dbRenderGoals(); }
  else if (a === 'edit' && g) {
    const i = document.createElement('input'); i.className = 'db-edit'; i.value = g.text; el.replaceWith(i); i.focus(); i.select(); let fin = false;
    const done = (ok) => { if (fin) return; fin = true; const v = i.value.trim(); if (ok && v && v !== g.text) { g.text = v; dbSaveSoon(); } dbRenderGoals(); };
    i.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }; i.onblur = () => done(true);
  }
}

/* ---------- quotes ---------- */
function dbQuoteHtml(q) {
  const words = q.text.split(/\s+/), n = words.length, size = q.text.length <= 70 ? 27 : q.text.length <= 140 ? 22 : 18;
  return `<div class="db-qt" style="font-size:${size}px">${words.map((w, i) => `<span class="qw" style="--d:${i * 55}ms">${dbEsc(w)}</span>`).join(' ')}</div>${q.by ? `<div class="db-qby" style="--d:${n * 55 + 200}ms">— ${dbEsc(q.by)}</div>` : ''}`;
}
function dbQuoteNext(first) {
  clearTimeout(DB.qT); const body = $('db-qbody'); if (!body) return;
  const qs = DB.d.quotes; if (!qs.length) { body.innerHTML = '<div class="db-qempty">Add the words that fire you up. One will appear here at a time.</div>'; return; }
  if (!DB.order.length) { DB.order = qs.map((_, i) => i); for (let i = DB.order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [DB.order[i], DB.order[j]] = [DB.order[j], DB.order[i]]; } if (DB.order[0] === DB.qi && DB.order.length > 1) DB.order.push(DB.order.shift()); }
  DB.qi = DB.order.shift(); const q = qs[DB.qi] || qs[0], dur = Math.max(12000, Math.min(28000, 9000 + q.text.length * 80));
  const show = () => { body.innerHTML = dbQuoteHtml(q); body.classList.remove('leaving'); const pr = $('db-qprog'); if (pr) { pr.style.animation = 'none'; void pr.offsetWidth; pr.style.animation = `dbProg ${dur}ms linear forwards`; } };
  if (first) show(); else { body.classList.add('leaving'); setTimeout(show, 380); }
  DB.qT = setTimeout(() => { if (isV('dash')) dbQuoteNext(); else DB.qT = setTimeout(() => dbQuoteNext(), 4000); }, dur);
}
function dbQuoteModal() {
  const ov = document.createElement('div'); ov.className = 't-modal';
  const lines = DB.d.quotes.map((q) => (q.by ? `${q.text} — ${q.by}` : q.text)).join('\n');
  ov.innerHTML = `<div class="t-card g-card"><h3>Your quotes</h3><div class="t-for">One per line. Put “ — Name” at the end to credit someone. They show up one at a time on the dashboard.</div><textarea style="height:210px" spellcheck="false" placeholder="The only way out is through. — Robert Frost">${esc(lines)}</textarea><div class="t-actions"><span></span><button data-a="x">Cancel</button><button class="primary" data-a="ok">Save</button></div></div>`;
  const ta = ov.querySelector('textarea'), close = () => ov.remove();
  const ok = () => {
    DB.d.quotes = ta.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*\S)\s+[—–]\s+(.+)$/) || l.match(/^(.*\S)\s+--?\s+([^-]+)$/); return { id: uid(), text: (m ? m[1] : l).replace(/^["“]|["”]$/g, ''), by: m ? m[2].trim() : '' }; });
    close(); dbSaveSoon(); DB.order = []; DB.qi = -1; dbQuoteNext(true);
  };
  ov.onclick = (e) => { if (e.target === ov) close(); const a = e.target.dataset && e.target.dataset.a; if (a === 'x') close(); if (a === 'ok') ok(); };
  ov.onkeydown = (e) => { if (e.key === 'Escape') close(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ok(); };
  document.body.appendChild(ov); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
}

/* ---------- page ---------- */
const DAYN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dbGreeting(h) { return h < 5 ? 'Burning the midnight oil' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Winding down'; }
function dbClock() {
  const t = $('db-time'); if (!t) return; const d = new Date(), pct = (d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60) / 1440;
  t.innerHTML = `${pad2(d.getHours())}<i>:</i>${pad2(d.getMinutes())}<small>${pad2(d.getSeconds())}</small>`;
  const f = $('db-dayfill'); if (f) f.style.width = (pct * 100).toFixed(2) + '%';
  const l = $('db-daylab'); if (l) { const left = 1440 - (d.getHours() * 60 + d.getMinutes()); l.textContent = `${Math.round(pct * 100)}% of today gone · ${Math.floor(left / 60)}h ${left % 60}m left`; }
}
/* moon phase: simple astronomy, accurate to about a day */
const SYN = 29.530588853;
function moonInfo(now) {
  const days = (now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5, p = (((days / SYN) % 1) + 1) % 1, lit = (1 - Math.cos(2 * Math.PI * p)) / 2;
  const name = p < 0.03 || p >= 0.97 ? 'New moon' : p < 0.22 ? 'Waxing crescent' : p < 0.28 ? 'First quarter' : p < 0.47 ? 'Waxing gibbous' : p < 0.53 ? 'Full moon' : p < 0.72 ? 'Waning gibbous' : p < 0.78 ? 'Last quarter' : 'Waning crescent';
  return { p, lit, name, toFull: (((0.5 - p) % 1 + 1) % 1) * SYN, toNew: (((1 - p) % 1 + 1) % 1) * SYN };
}
function moonSvg(p) {
  const r = 44, cx = 50, cy = 50, k = Math.cos(2 * Math.PI * p), rx = Math.abs(k) * r, waxing = p < 0.5;
  const path = `M${cx} ${cy - r} A${r} ${r} 0 0 1 ${cx} ${cy + r} A${rx.toFixed(2)} ${r} 0 0 ${k > 0 ? 0 : 1} ${cx} ${cy - r} Z`;
  return `<svg viewBox="0 0 100 100"><defs><radialGradient id="dbmg" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#fbf4dc"/><stop offset="1" stop-color="#cdbf94"/></radialGradient></defs><circle cx="50" cy="50" r="${r}" class="mb"/><g transform="${waxing ? '' : 'translate(100 0) scale(-1 1)'}"><path d="${path}" fill="url(#dbmg)"/></g><circle cx="50" cy="50" r="${r}" fill="none" stroke="#ffffff22" stroke-width="1"/></svg>`;
}
function dbPixels(X) {
  const now = new Date(), yr = now.getFullYear(), ps = (X.life && X.life.pstats) || {}, jan1 = new Date(yr, 0, 1), off = (jan1.getDay() + 6) % 7, diy = (yr % 4 === 0 && (yr % 100 || yr % 400 === 0)) ? 366 : 365, tk = dbDay();
  let cells = '<i class="e"></i>'.repeat(off), active = 0; const labels = [];
  for (let i = 0; i < diy; i++) {
    const d = new Date(yr, 0, 1 + i), k = pk(d), s = ps[k], min = s ? s.min || 0 : 0, gs = DB.d.goals[k] || [], gd = gs.filter((g) => g.done).length;
    const lvl = min <= 0 ? 0 : min < 25 ? 1 : min < 60 ? 2 : min < 120 ? 3 : 4; if (min > 0) active++;
    if (d.getDate() === 1 || i === 0) labels.push([Math.floor((off + i) / 7), d.toLocaleDateString('en', { month: 'short' })]);
    cells += `<i class="${k > tk ? 'f' : 'l' + lvl}${k === tk ? ' now' : ''}${gs.length && gd === gs.length ? ' g' : ''}" title="${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}${k > tk ? '' : ` · ${min} min focus${gs.length ? ` · goals ${gd}/${gs.length}` : ''}`}"></i>`;
  }
  const cols = Math.ceil((off + diy) / 7);
  return `<div class="db-pxm" style="grid-template-columns:repeat(${cols},1fr)">${labels.map(([c, m]) => `<span style="grid-column:${c + 1}">${m}</span>`).join('')}</div><div class="db-px" style="grid-template-columns:repeat(${cols},1fr)">${cells}</div>
    <div class="db-pxf"><span>${active} day${active === 1 ? '' : 's'} with focus time in ${yr}</span><span class="lg">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More<em><i class="gk"></i> all goals done</em></span></div>`;
}
function renderDash(X) {
  X = X || DB.X || {}; DB.X = X; const now = new Date(), yr = now.getFullYear(), doy = Math.round((Date.UTC(yr, now.getMonth(), now.getDate()) - Date.UTC(yr, 0, 0)) / 864e5), diy = (yr % 4 === 0 && (yr % 100 || yr % 400 === 0)) ? 366 : 365;
  let i = 0; const c = (cls, inner, nav, id) => `<div class="db-card ${cls}${nav ? ' nav' : ''}"${nav ? ` data-nav="${nav}"` : ''}${id ? ` id="${id}"` : ''} style="--i:${i++}">${inner}</div>`;
  const T = X.tasks, Fo = X.focus, Sp = X.spend, In = X.income, W = X.weight, Gy = X.gym;
  const tiles = [
    c('db-tile', `<div class="tl"><small>Tasks complete</small><b>${T ? `${dbN(T.done, 'int')}<em>/${T.tot}</em>` : '–'}</b><span class="ts">${T ? (T.tot && T.done === T.tot ? 'All clear' : `${T.next.length} open now`) : 'no task data'}</span></div>${T && T.tot ? dbRing(T.done / T.tot, 62, `${Math.round(T.done / T.tot * 100)}%`) : ''}`, 'tasks'),
    c('db-tile', `<div class="tl"><small>Focus today</small><b>${Fo ? `${dbN(Fo.today.min, 'int')}<em>min</em>` : '–'}</b><span class="ts">${Fo ? `${Fo.today.n} session${Fo.today.n === 1 ? '' : 's'}${Fo.streak ? ` · ${Fo.streak} day streak` : ''}` : ''}</span></div>`, 'pomo'),
    c('db-tile', `<div class="tl"><small>Spent in ${Sp ? Sp.month : 'this month'}</small><b>${Sp ? dbN(Sp.total, 'money') : '–'}</b><span class="ts">${Sp && Sp.prev ? `${dbChip(Math.round((Sp.total - Sp.prev) / Sp.prev * 100), true)} vs ${Sp.pm}` : Sp && Sp.total ? 'no last-month data' : ''}</span></div>`, 'finance'),
    c('db-tile', `<div class="tl"><small>Real total</small><b>${In && In.any ? dbN(In.real, 'money') : '–'}</b><span class="ts">${In && In.any ? `${money(In.to)} still to invoice` : 'set up on Finance → Income'}</span></div>`, 'income'),
  ].join('');
  const nextRows = T ? T.next.slice(0, 5).map((t) => `<div class="db-li" style="--c:${t.col}"><i></i><span>${dbEsc(t.text)}</span><em>${dbEsc(t.cat)}</em></div>`).join('') : '';
  const laterRow = T && T.later.length ? `<div class="db-later">${HOURGLASS}<span>${T.later.length} unlock${T.later.length === 1 ? 's' : ''} later today · next at <b>${fmtMin(T.later[0].min)}</b></span></div>` : '';
  const upNext = c('db-wide', `<div class="db-ch"><h3>Up next</h3><small>${T ? `${T.next.length} open` : ''}</small></div><div class="db-list">${nextRows || '<div class="db-empty">Nothing open right now.</div>'}</div>${T && T.next.length > 5 ? `<div class="db-more">+${T.next.length - 5} more</div>` : ''}${laterRow}`, 'tasks');
  const gRows = X.gantt && X.gantt.length ? X.gantt.map((g) => `<div class="db-gr" style="--c:${g.col}"><div class="gn"><span>${dbEsc(g.name)}</span><em class="${g.left < 0 ? 'late' : g.left <= 2 ? 'soon' : ''}">${g.left < 0 ? `${-g.left}d overdue` : g.left === 0 ? 'due today' : `${g.left}d left`}</em></div><div class="gb"><u style="width:${g.p}%"></u></div></div>`).join('') : '<div class="db-empty">No active roadmap items.</div>';
  const road = c('db-wide', `<div class="db-ch"><h3>Roadmap</h3><small>Gantt</small></div><div class="db-list">${gRows}</div>`, 'gantt');
  const cash = c('db-wide', `<div class="db-ch"><h3>Cash flow</h3><small>Income</small></div>${In && In.any ? `<div class="db-cash"><div style="--c:${TC.a3}"><small>To invoice</small><b>${money(In.to)}</b></div><div style="--c:${TC.amb}"><small>Withdrawing</small><b>${money(In.wd)}</b></div><div style="--c:${TC.grn}"><small>In bank</small><b>${money(In.bank)}</b></div></div>${(() => { const p = [Math.max(0, In.to), Math.max(0, In.wd), Math.max(0, In.bank)], s = p[0] + p[1] + p[2] || 1; return `<div class="db-mix">${p.map((v, k) => `<i style="flex:${v};background:${[TC.a3, TC.amb, TC.grn][k]}"></i>`).join('')}</div>`; })()}` : '<div class="db-empty">No income entries yet.</div>'}${Sp && Sp.total ? `<div class="db-foot">${Sp.top ? `Biggest spend: <b>${dbEsc(Sp.top[0])}</b> ${money(Sp.top[1])}` : ''}${now.getDate() > 4 ? ` · on pace for ${money(Sp.proj)}` : ''}</div>` : ''}`, 'income');
  const mxm = Math.max(1, ...(Fo ? Fo.days.map((d) => d.min) : [1]));
  const week = c('db-half', `<div class="db-ch"><h3>Focus this week</h3><small>${Fo ? `${Fo.week} min` : ''}</small></div><div class="db-bars">${Fo ? Fo.days.map((d, k) => `<div class="db-b${k === 6 ? ' now' : ''}"><div class="bt"><u style="height:${Math.max(d.min ? 8 : 3, d.min / mxm * 100)}%;--k:${k}"></u></div><small>${DAYN[d.d.getDay()][0]}</small><em>${d.min || ''}</em></div>`).join('') : ''}</div>`, 'pomo');
  const body = c('db-half', `<div class="db-ch"><h3>Body &amp; training</h3><small>Health</small></div><div class="db-body"><div class="bw">${W ? `<small>Weight</small><b>${W.last.toFixed(1)}</b><span class="${Math.abs(W.delta) < 0.05 ? 'flat' : W.delta > 0 ? 'up' : 'down'}">${W.delta > 0 ? '+' : W.delta < 0 ? '−' : ''}${Math.abs(W.delta).toFixed(1)} this week</span>${dbSpark(W.spark, TC.a3)}` : '<div class="db-empty">No weight logged yet.</div>'}</div><div class="bg"><small>Workouts this week</small><b>${Gy ? dbN(Gy.week, 'int') : '–'}</b><div class="dots">${Gy ? Gy.dots.map((d, k) => `<i class="${d.on ? 'on' : ''}${d.now ? ' now' : ''}" title="${DAYN[(k + 1) % 7]}"></i>`).join('') : ''}</div><span>${Gy && Gy.last ? `Last: ${dbEsc(Gy.last.name)} · ${Gy.last.ago === 0 ? 'today' : Gy.last.ago === 1 ? 'yesterday' : Gy.last.ago + 'd ago'}` : ''}${X.steps ? `${Gy && Gy.last ? '<br>' : ''}${X.steps.toLocaleString('en')} steps/day this week` : ''}</span></div></div>`, 'health');
  const L = X.life, st = DB.d.stats, fdate = st.first ? new Date(+st.first.slice(0, 4), +st.first.slice(5, 7) - 1, +st.first.slice(8, 10)) : now, together = Math.max(1, Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(fdate.getFullYear(), fdate.getMonth(), fdate.getDate())) / 864e5) + 1);
  const lf = (n, f, lab, sub) => `<div class="lf"><b>${dbN(n, f)}</b><small>${lab}</small><span>${sub || ''}</span></div>`;
  const life = c('db-life', `<div class="db-ch"><h3>Lifetime</h3><small>the long game</small></div><div class="db-lf">${[
    lf(st.tasks, 'int', 'Tasks ticked off', `counting since ${fdate.toLocaleDateString('en', { day: 'numeric', month: 'short' })}`),
    lf(st.goals, 'int', 'Goals hit', 'typed and done'),
    lf(L ? L.min / 60 : 0, 'hrs', 'Hours focused', L ? `${L.sessions} sessions${L.best ? ` · best day ${Math.floor(L.best.min / 60)}h ${L.best.min % 60}m` : ''}` : ''),
    lf(L ? L.longest : 0, 'int', 'Longest focus streak', 'days in a row'),
    lf(Gy ? Gy.total : 0, 'int', 'Workouts logged', Gy && Gy.last ? `latest: ${dbEsc(Gy.last.name)}` : ''),
    lf(together, 'int', 'Days with Signal Path', `since ${fdate.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' })}`),
  ].join('')}</div>`);
  const mo = moonInfo(now), dow = now.getDay(), toSat = dow === 6 || dow === 0 ? 0 : 6 - dow, eoy = Math.round((Date.UTC(yr, 11, 31) - Date.UTC(yr, now.getMonth(), now.getDate())) / 864e5), nextFull = new Date(now.getTime() + mo.toFull * 864e5), nextNew = new Date(now.getTime() + mo.toNew * 864e5);
  const sky = c('db-sky', `<div class="db-ch"><h3>Tonight’s sky</h3><small>moon &amp; calendar</small></div><div class="db-skyin"><div class="db-moon">${moonSvg(mo.p)}</div><div class="sk"><b>${mo.name}</b><span>${Math.round(mo.lit * 100)}% lit</span><span>${mo.name === 'Full moon' ? 'Full tonight' : `Full moon ${nextFull.toLocaleDateString('en', { day: 'numeric', month: 'short' })} · in ${Math.round(mo.toFull)} days`}</span><span>New moon ${nextNew.toLocaleDateString('en', { day: 'numeric', month: 'short' })}</span></div></div><div class="db-cd"><div><b>${toSat === 0 ? 'Now' : toSat}</b><small>${toSat === 0 ? 'it’s the weekend' : toSat === 1 ? 'day to the weekend' : 'days to the weekend'}</small></div><div><b>${Math.ceil(eoy / 7)}</b><small>weeks left in ${yr}</small></div><div><b>${Math.round(doy / diy * 100)}%</b><small>of ${yr} done</small></div></div>`);
  const px = c('db-px-card', `<div class="db-ch"><h3>${yr} in pixels</h3><small>every square is a day · brighter means more focus time</small></div>${dbPixels(X)}`);
  const goals = c('db-goals-card', ``, '', 'db-goals');
  const quote = c('db-quote', `<svg class="db-qm" viewBox="0 0 48 40"><path d="M0 40V22C0 9 7 2 19 0l2 5c-6 2-9 6-9 12h9v23H0zm27 0V22c0-13 7-20 19-22l2 5c-6 2-9 6-9 12h9v23H27z"/></svg><div class="db-qbody" id="db-qbody"></div><div class="db-qfoot"><div class="db-qbar"><i id="db-qprog"></i></div><button data-a="qnext" title="Next quote">↻</button><button data-a="qedit" title="Edit your quotes">✎</button></div>`, '', 'db-quote');
  $('dash').innerHTML = `<div class="db-bg"><i></i><i></i><i></i></div><div class="db-scroll">
    <div class="db-hero"><div class="hl"><div class="gr">${dbGreeting(now.getHours())}</div><div class="dt">${DAYN[now.getDay()]}, ${now.toLocaleDateString('en', { day: 'numeric', month: 'long' })}</div></div><div class="hc"><div class="tm" id="db-time"></div><div class="dbar"><u id="db-dayfill"></u></div><div class="dlab" id="db-daylab"></div></div><div class="hr"><b>Day ${doy}</b><small>${diy - doy} days left in ${yr}</small>${X.notes != null ? `<small>${X.notes} notes in the vault</small>` : ''}</div></div>
    <div class="db-grid">${goals}${quote}${tiles}${upNext}${road}${cash}${week}${body}${life}${sky}${px}</div></div>`;
  dbRenderGoals(); DB.order = []; dbQuoteNext(true); dbClock(); dbCount();
  if (!DB.cT) DB.cT = setInterval(() => { if (isV('dash')) dbClock(); }, 1000);
}
function dbCount() {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('#dash [data-n]').forEach((el) => {
    const n = +el.dataset.n, f = el.dataset.f, fmt = (v) => (f === 'money' ? money(v) : f === 'hrs' ? v.toFixed(1) : String(Math.round(v)));
    if (reduce || !n) { el.textContent = fmt(n); return; }
    const t0 = performance.now(), dur = 900; const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(n * e); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
  });
}
async function showDash() {
  await dbLoadFile();
  const X = await Promise.race([dbGather(), new Promise((r) => setTimeout(() => r({}), 2500))]);
  setView('dash'); renderDash(X);
}
$('btn-dash').onclick = showDash;
$('dash').addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]');
  if (a) {
    const act = a.dataset.a;
    if (act === 'qnext') { DB.order = DB.order.length ? DB.order : []; dbQuoteNext(); return; }
    if (act === 'qedit') { dbQuoteModal(); return; }
    const row = a.closest('.db-goal'); if (row) dbGoalAct(act, row.dataset.id, a); return;
  }
  const n = e.target.closest('[data-nav]'); if (!n) return; const v = n.dataset.nav;
  if (v === 'tasks') showTasks(); else if (v === 'pomo') showPomo(); else if (v === 'gantt') showGantt(); else if (v === 'health') showHealth();
  else if (v === 'finance') { F.tab = 'finance'; showFinance(); } else if (v === 'income') { F.tab = 'income'; showFinance(); }
});
$('dash').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.id !== 'db-goal') return;
  const v = e.target.value.trim(); if (!v) return;
  (DB.d.goals[dbDay()] || (DB.d.goals[dbDay()] = [])).push({ id: uid(), text: v, done: false }); dbSaveSoon(); dbRenderGoals(true);
});

uWrap('renderDash', 'dash');


/* ================= SIDE PANEL (4.5) =================
   Pops a second page out on the right. The page's own section is moved into the panel (same page, same data, same timers),
   so a page can only be in one place at a time: opening it in the main area (or the panel) hands it over. */
const SP = { open: false, page: null, hold: null, w: 0 };
const SP_PAGES = [
  ['dash', 'Dashboard', 'dash', () => showDash()],
  ['notes', 'Notes', null, null],
  ['tasks', 'Tasks', 'tasks', () => showTasks()],
  ['gantt', 'Gantt', 'gantt', () => showGantt()],
  ['pomo', 'Pomodoro', 'pomo', () => showPomo()],
  ['health', 'Health', 'health', () => showHealth()],
  ['finance', 'Finance', 'finance', () => showFinance()],
  ['calendar', 'Calendar', 'calendar', () => window.calShow && window.calShow()],
];
(function () {
  const body = document.querySelector('.body'), host = document.createElement('aside');
  host.id = 'sidepane';
  host.innerHTML = '<div id="sp-grip" title="Drag to resize"></div><div id="sp-head"><button id="sp-back" title="Back to the page list" hidden>‹ Pages</button><b id="sp-title">Side panel</b></div><div id="sp-list"></div><div id="sp-host" hidden></div>';
  body.appendChild(host);
  const btn = $('btn-side'), list = $('sp-list'), hostEl = $('sp-host');
  const nudge = () => { clearTimeout(SP.rt); SP.rt = setTimeout(() => window.dispatchEvent(new Event('resize')), 60); };
  const clamp = (w) => Math.max(300, Math.min(w, window.innerWidth - 380));
  let w0 = 0; try { w0 = +localStorage.getItem('sp-width') || 0; } catch (e) { /* ignore */ }
  SP.w = w0 || 520; host.style.setProperty('--spw', clamp(SP.w) + 'px');

  const nodes = (k) => (k === 'notes' ? [document.querySelector('.body > .side'), document.querySelector('.body > .main')] : [$(k === 'calendar' ? 'calendar' : k)]);
  function drawList() {
    list.innerHTML = '<div class="sp-hint">Open a page here</div>' + SP_PAGES.map(([k, name]) => {
      const here = S.view === k;
      return `<button class="sp-item" data-k="${k}"${here ? ' disabled' : ''}><i></i><span>${name}</span>${here ? '<em>in main view</em>' : ''}</button>`;
    }).join('');
  }
  function release() {
    if (!SP.page) return;
    const k = SP.page; SP.page = null; S.side = null;
    (SP.hold || []).forEach(([n, ph]) => { n.classList.remove('in-side'); ph.replaceWith(n); });
    SP.hold = null; hostEl.hidden = true; hostEl.className = '';
    $('sp-back').hidden = true; $('sp-title').textContent = 'Side panel'; list.hidden = false; drawList(); nudge();
  }
  async function place(k) {
    const [, name, , show] = SP_PAGES.find((p) => p[0] === k);
    if (S.view === k) return;
    release();
    if (show) { S.sidePending = k; try { await show(); } finally { S.sidePending = null; } }
    const ns = nodes(k).filter(Boolean);
    SP.hold = ns.map((n) => { const ph = document.createComment('sp'); n.replaceWith(ph); hostEl.appendChild(n); n.classList.add('in-side'); return [n, ph]; });
    SP.page = k; S.side = k; hostEl.hidden = false; hostEl.className = 'k-' + k; list.hidden = true;
    $('sp-back').hidden = false; $('sp-title').textContent = name;
    if (k === 'notes') { renderTabs(); renderTree(); renderPane(); }
    nudge();
  }
  function toggle(force) {
    SP.open = force != null ? force : !SP.open;
    document.body.classList.toggle('sp-open', SP.open); btn.classList.toggle('on', SP.open);
    if (SP.open) { host.style.setProperty('--spw', clamp(SP.w) + 'px'); drawList(); } else release();
    nudge();
  }
  btn.onclick = () => toggle();
  $('sp-back').onclick = release;
  list.onclick = (e) => { const b = e.target.closest('.sp-item'); if (b && !b.disabled) place(b.dataset.k); };

  /* the main area and the panel hand pages over to each other */
  const baseSetView = window.setView;
  window.setView = function (v, ...a) {
    if (S.sidePending && v === S.sidePending) { S.sidePending = null; return; }           // the panel is loading this page: leave the main view alone
    if (SP.page && v === SP.page) release();                                              // the main area takes the page over
    const out = baseSetView.call(this, v, ...a);
    if (SP.open && !SP.page) drawList();
    return out;
  };

  /* drag to resize */
  $('sp-grip').addEventListener('pointerdown', (e) => {
    e.preventDefault(); const g = e.currentTarget; g.setPointerCapture(e.pointerId); document.body.classList.add('sp-drag');
    const mv = (ev) => { SP.w = clamp(window.innerWidth - ev.clientX); host.style.setProperty('--spw', SP.w + 'px'); nudge(); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); document.body.classList.remove('sp-drag'); try { localStorage.setItem('sp-width', String(Math.round(SP.w))); } catch (x) { /* ignore */ } nudge(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });
  $('sp-grip').addEventListener('dblclick', () => { SP.w = 520; host.style.setProperty('--spw', clamp(SP.w) + 'px'); nudge(); });
  window.addEventListener('resize', () => { if (SP.open) host.style.setProperty('--spw', clamp(SP.w) + 'px'); });
})();
