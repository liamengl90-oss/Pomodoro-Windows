const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

let win, root;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const writeCfg = (c) => fs.writeFileSync(cfgFile(), JSON.stringify(c));
/* Safe saving: write to a temp file, then swap it in, so a crash mid-save can't leave a half-written file. */
function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
  catch (e) { fs.writeFileSync(file, data); try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}
const inside = (p) => { const r = path.resolve(p); return r === root || r.startsWith(root + path.sep); };

/* ---------- vault layout (4.93) ----------
   Notes stay where you put them. Everything the panels store (tasks, Gantt, Pomodoro, dashboard, gym, food log, health, finance)
   lives in one folder, "_Signal Path". Older vaults keep working in the "classic" layout until Organize vault is run. */
const SYS = '_Signal Path';
const DATA_SUB = { 'Daily Tasks.tasks.json': 'Tasks', 'Gantt.gantt.json': 'Tasks', 'Pomodoro.pomo.json': 'Tasks', 'Dashboard.json': 'Dashboard', 'Gym.json': 'Health', 'FoodLog.json': 'Health' };
const toNew = (rel) => (DATA_SUB[rel] ? `${SYS}/${DATA_SUB[rel]}/${rel}` : /^(Health|Finance)\//.test(rel) ? `${SYS}/${rel}` : rel);
function toLegacy(rel) {
  if (!rel.startsWith(SYS + '/')) return rel;
  const r = rel.slice(SYS.length + 1), a = r.match(/^(Tasks|Dashboard)\/([^/]+)$/); if (a) return a[2];
  const g = r.match(/^Health\/(Gym\.json|FoodLog\.json)$/); return g ? g[1] : r;
}
const layoutNew = () => !!root && fs.existsSync(path.join(root, SYS));
const sysRel = (rel) => (layoutNew() ? toNew(rel) : rel);
function walkSync(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkSync(p, base, out); else out.push(toPosix(path.relative(base, p))); }
  return out;
}
function pruneDirs(dir) {
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) pruneDirs(path.join(dir, e.name)); if (!fs.readdirSync(dir).length) fs.rmdirSync(dir); } catch { /* ignore */ }
}

function scan(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (dir === root && (e.name === 'Health' || e.name === 'Finance' || e.name === 'attachments' || e.name === SYS)) continue; out.push({ type: 'dir', name: e.name, path: p, children: scan(p) }); }
    else if (e.name.toLowerCase().endsWith('.md')) out.push({ type: 'file', kind: 'note', name: e.name.slice(0, -3), path: p });
    else if (e.name.toLowerCase().endsWith('.canvas')) out.push({ type: 'file', kind: 'canvas', name: e.name.slice(0, -7), path: p });
  }
  return out.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
}

function openVault(dir) {
  root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  if (!fs.readdirSync(root).length) fs.mkdirSync(path.join(root, SYS), { recursive: true });   // a brand-new vault starts out organized
  if (!fs.readdirSync(root).some((f) => f.endsWith('.md'))) {
    fs.writeFileSync(path.join(root, 'Welcome.md'),
      '# Welcome to Signal Path\n\nYour notes are plain markdown files in this folder.\n\n- [ ] Click a checkbox in preview mode\n- [ ] Press Ctrl+N for a new note\n- [x] Open the app\n');
  }
  writeCfg({ ...readCfg(), vault: root });
  return { root, tree: scan(root) };
}

ipcMain.handle('vault:open', () => { const v = openVault(readCfg().vault || path.join(app.getPath('documents'), 'Signal Path')); setTimeout(bkDailySafe, 4000); return v; });
ipcMain.handle('vault:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null; const v = openVault(r.filePaths[0]); setTimeout(bkDailySafe, 4000); return v;
});
ipcMain.handle('vault:tree', () => scan(root));
ipcMain.handle('note:read', (_, p) => (inside(p) ? fs.readFileSync(p, 'utf8') : ''));
ipcMain.handle('note:write', (_, p, text) => { if (inside(p)) atomicWrite(p, text); });
ipcMain.handle('note:create', (_, dir) => {
  const d = dir && inside(dir) ? dir : root;
  let n = 1, p;
  do { p = path.join(d, n === 1 ? 'Untitled.md' : `Untitled ${n}.md`); n++; } while (fs.existsSync(p));
  fs.writeFileSync(p, '');
  return p;
});
const rename = (p, name, ext) => {
  const clean = name.replace(/[\\/:*?"<>|]/g, '').trim();
  if (!clean || !inside(p)) return p;
  const np = path.join(path.dirname(p), clean + ext);
  if (np === p || fs.existsSync(np)) return p;
  fs.renameSync(p, np);
  return np;
};
/* ---------- attachments (4.7) ----------
   Images live in <vault>/attachments/<note's folder path>/<note name>/ . When a note or folder is renamed or moved its image folder
   follows it, and every note / canvas that points at those files is rewritten so nothing breaks. */
const fsp = fs.promises;
const ATT = 'attachments', IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const toPosix = (p) => p.split(path.sep).join('/');
const relOf = (abs) => toPosix(path.relative(root, abs));
const noteKey = (rel) => rel.replace(/\.(md|canvas)$/i, '');
const encRel = (rel) => rel.split('/').map(encodeURIComponent).join('/');
let rewritten = [], imgIdx = null;
async function walkAll(dir, re, out = []) {
  let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkAll(p, re, out); else if (re.test(e.name)) out.push(p);
  }
  return out;
}
function uniqueIn(dir, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length); let n = 1, p;
  do { p = path.join(dir, n === 1 ? name : `${stem} ${n}${ext}`); n++; } while (fs.existsSync(p));
  return p;
}
/* move an attachments folder; if the target already exists, merge file by file. Returns file-level pairs for any renamed collisions. */
async function mergeMove(src, dst) {
  const extra = [];
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (!fs.existsSync(dst)) { fs.renameSync(src, dst); return extra; }
  for (const f of await walkAll(src, /./)) {
    const sub = path.relative(src, f), tgt = path.join(dst, path.dirname(sub));
    fs.mkdirSync(tgt, { recursive: true });
    const np = uniqueIn(tgt, path.basename(f)); fs.renameSync(f, np);
    if (path.basename(np) !== path.basename(f)) extra.push({ a: relOf(path.join(src, sub)), b: relOf(np), dir: false });
  }
  try { fs.rmSync(src, { recursive: true, force: true }); } catch { /* ignore */ }
  return extra;
}
function pruneEmpty(dir) {
  const stop = path.join(root, ATT);
  try { while (dir.startsWith(stop + path.sep) && fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); } } catch { /* ignore */ }
}
async function rewriteRefs(pairs) {
  if (!pairs.length) return;
  const hit = (v, a) => v === a.a || (a.dir && v.startsWith(a.a + '/'));
  const swap = (v, a) => a.b + v.slice(a.a.length);
  for (const f of await walkAll(root, /\.(md|canvas)$/i)) {
    let t; try { t = await fsp.readFile(f, 'utf8'); } catch { continue; }
    let o = t;
    if (/\.canvas$/i.test(f)) {
      let j; try { j = JSON.parse(t); } catch { continue; }
      let changed = false;
      for (const n of j.nodes || []) if (typeof n.file === 'string') { const a = pairs.find((p) => hit(n.file, p)); if (a) { n.file = swap(n.file, a); changed = true; } }
      if (changed) o = JSON.stringify(j, null, '\t');
    } else {
      for (const a of pairs) {
        if (!a.a.startsWith(ATT + '/')) continue;
        const forms = a.dir ? [[a.a + '/', a.b + '/'], [encRel(a.a) + '/', encRel(a.b) + '/']] : [['(' + a.a + ')', '(' + a.b + ')'], ['(' + encRel(a.a) + ')', '(' + encRel(a.b) + ')']];
        for (const [x, y] of forms) if (o.includes(x)) o = o.split(x).join(y);
      }
    }
    if (o !== t) { atomicWrite(f, o); rewritten.push(f); }
  }
}
async function afterRename(oldAbs, newAbs, isDir) {
  const oldRel = relOf(oldAbs), newRel = relOf(newAbs), pairs = [];
  if (isDir || /\.(md|canvas)$/i.test(oldRel)) {
    const k = (r) => ATT + '/' + (isDir ? r : noteKey(r)), aOld = path.join(root, k(oldRel));
    if (k(oldRel) !== k(newRel) && fs.existsSync(aOld)) {
      const extra = await mergeMove(aOld, path.join(root, k(newRel)));
      pairs.push({ a: k(oldRel), b: k(newRel), dir: true }, ...extra); pruneEmpty(path.dirname(aOld));
    }
  }
  pairs.push({ a: oldRel, b: newRel, dir: isDir });
  await rewriteRefs(pairs);
}
const noteExt = (p) => (/\.canvas$/i.test(p) ? '.canvas' : '.md');
ipcMain.handle('note:rename', async (_, p, name) => { const np = rename(p, name, noteExt(p)); if (np !== p) await afterRename(p, np, false); return np; });
ipcMain.handle('dir:rename', async (_, p, name) => { const np = rename(p, name, ''); if (np !== p) await afterRename(p, np, true); return np; });
ipcMain.handle('dir:create', (_, parent) => {
  const d = parent && inside(parent) ? parent : root;
  let n = 1, p;
  do { p = path.join(d, n === 1 ? 'New folder' : `New folder ${n}`); n++; } while (fs.existsSync(p));
  fs.mkdirSync(p);
  return p;
});
ipcMain.handle('canvas:create', (_, dir) => {
  const d = dir && inside(dir) ? dir : root;
  let n = 1, p;
  do { p = path.join(d, n === 1 ? 'Untitled canvas.canvas' : `Untitled canvas ${n}.canvas`); n++; } while (fs.existsSync(p));
  fs.writeFileSync(p, '{\n\t"nodes": [],\n\t"edges": []\n}');
  return p;
});
ipcMain.handle('fs:move', async (_, src, destDir) => {
  if (!inside(src) || !inside(destDir)) return src;
  const s = path.resolve(src), d = path.resolve(destDir);
  if (s === root || d === s || d.startsWith(s + path.sep) || path.dirname(s) === d) return src;
  const np = path.join(d, path.basename(s));
  if (fs.existsSync(np)) return src;
  const isDir = fs.statSync(s).isDirectory();
  fs.renameSync(s, np);
  await afterRename(s, np, isDir);
  return np;
});
ipcMain.handle('refs:take', () => { const r = [...new Set(rewritten)]; rewritten = []; return r; });

/* images: save pasted / dropped / picked pictures next to their note */
function saveImg(notePath, name, data) {
  if (!inside(notePath)) return null;
  const dir = path.join(root, ATT, noteKey(relOf(path.resolve(notePath))));
  fs.mkdirSync(dir, { recursive: true });
  let base = String(name || 'image.png').replace(/[\\/:*?"<>|]/g, '').trim() || 'image.png';
  if (!IMG_EXT.has(path.extname(base).toLowerCase())) base += '.png';
  const p = uniqueIn(dir, base); fs.writeFileSync(p, Buffer.from(data)); imgIdx = null;
  return relOf(p);
}
ipcMain.handle('img:save', (_, notePath, name, data) => saveImg(notePath, name, data));
ipcMain.handle('img:pick', async (_, notePath) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: [...IMG_EXT].map((e) => e.slice(1)) }] });
  if (r.canceled) return [];
  return r.filePaths.map((f) => saveImg(notePath, path.basename(f), fs.readFileSync(f))).filter(Boolean);
});
/* Obsidian-style ![[name.png]] embeds: find the picture by its file name anywhere in the vault */
ipcMain.handle('img:find', async (_, name) => {
  if (!imgIdx || Date.now() - imgIdx.t > 20000) {
    const m = new Map();
    for (const f of await walkAll(root, new RegExp('\\.(' + [...IMG_EXT].map((e) => e.slice(1)).join('|') + ')$', 'i'))) {
      const k = path.basename(f).toLowerCase(), cur = m.get(k), rel = relOf(f);
      if (!cur || (rel.startsWith(ATT + '/') && !cur.startsWith(ATT + '/'))) m.set(k, rel);
    }
    imgIdx = { t: Date.now(), m };
  }
  return imgIdx.m.get(String(name).toLowerCase().split('/').pop()) || null;
});
ipcMain.handle('shell:show', (_, rel) => { const p = path.join(root, String(rel)); if (inside(p)) shell.showItemInFolder(path.resolve(p)); });
ipcMain.handle('ext:open', (_, url) => { try { const u = new URL(String(url)); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.href); } catch { /* ignore */ } });

/* deleting a note / folder that owns images: ask first, then either trash the images or park them in attachments/_unsorted */
async function attOf(p) {
  const abs = path.resolve(p), isDir = fs.statSync(abs).isDirectory(), rel = relOf(abs);
  const folder = path.join(root, ATT, isDir ? rel : noteKey(rel));
  const files = fs.existsSync(folder) ? await walkAll(folder, /./) : [];
  const gone = (f) => f === abs || f.startsWith(abs + path.sep);
  const rels = files.map(relOf), shared = new Set();
  if (rels.length) {
    for (const f of await walkAll(root, /\.(md|canvas)$/i)) {
      if (gone(f)) continue;
      let t = ''; try { t = await fsp.readFile(f, 'utf8'); } catch { continue; }
      for (const r of rels) if (!shared.has(r) && (t.includes(r) || t.includes(encRel(r)))) shared.add(r);
    }
  }
  return { files, rels, shared, folder };
}
ipcMain.handle('att:inspect', async (_, p) => { if (!inside(p)) return { count: 0, shared: 0 }; const a = await attOf(p); return { count: a.files.length, shared: a.shared.size }; });
ipcMain.handle('att:dispose', async (_, p, mode) => {
  if (!inside(p)) return false;
  const a = await attOf(p); if (!a.files.length) return true;
  const park = path.join(root, ATT, '_unsorted'), pairs = [];
  fs.mkdirSync(park, { recursive: true });
  for (let i = 0; i < a.files.length; i++) {
    const f = a.files[i], rel = a.rels[i];
    if (mode === 'delete' && !a.shared.has(rel)) { try { await shell.trashItem(f); } catch { /* ignore */ } continue; }
    const np = uniqueIn(park, path.basename(f)); fs.renameSync(f, np); pairs.push({ a: rel, b: relOf(np), dir: false });
  }
  await rewriteRefs(pairs);
  try { if (!fs.readdirSync(a.folder).length) { fs.rmdirSync(a.folder); pruneEmpty(path.dirname(a.folder)); } } catch { /* ignore */ }
  return true;
});
ipcMain.handle('fs:trash', async (_, p) => { if (inside(p) && path.resolve(p) !== root) await shell.trashItem(path.resolve(p)); });

const tasksFile = () => path.join(root, sysRel('Daily Tasks.tasks.json'));
ipcMain.handle('tasks:load', () => { try { return fs.readFileSync(tasksFile(), 'utf8'); } catch { return ''; } });
ipcMain.handle('tasks:save', (_, text) => { fs.mkdirSync(path.dirname(tasksFile()), { recursive: true }); atomicWrite(tasksFile(), text); });

const dataFile = (n) => path.join(root, sysRel(path.basename(String(n))));
ipcMain.handle('data:load', (_, n) => { try { return fs.readFileSync(dataFile(n), 'utf8'); } catch { return ''; } });
ipcMain.handle('data:save', (_, n, text) => { if (/\.json$/i.test(String(n))) { fs.mkdirSync(path.dirname(dataFile(n)), { recursive: true }); atomicWrite(dataFile(n), text); } });

const healthDir = () => path.join(root, layoutNew() ? SYS + '/Health' : 'Health');
ipcMain.handle('health:load', (_, year) => { try { return fs.readFileSync(path.join(healthDir(), `Health ${Number(year)}.md`), 'utf8'); } catch { return ''; } });
ipcMain.handle('health:save', (_, year, text) => { fs.mkdirSync(healthDir(), { recursive: true }); atomicWrite(path.join(healthDir(), `Health ${Number(year)}.md`), text); });

const finPath = (ym) => (/^\d{4}-\d{2}$/.test(String(ym)) ? path.join(root, layoutNew() ? SYS + '/Finance' : 'Finance', `Outgoing ${ym}.md`) : null);
ipcMain.handle('finance:load', (_, ym) => { const p = finPath(ym); try { return p ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } });
const incomeFile = () => path.join(root, layoutNew() ? SYS + '/Finance' : 'Finance', 'Income.md');
ipcMain.handle('income:load', () => { try { return fs.readFileSync(incomeFile(), 'utf8'); } catch { return ''; } });
ipcMain.handle('income:save', (_, text) => { fs.mkdirSync(path.dirname(incomeFile()), { recursive: true }); atomicWrite(incomeFile(), String(text)); });
ipcMain.handle('finance:save', (_, ym, text) => { const p = finPath(ym); if (!p) return; fs.mkdirSync(path.dirname(p), { recursive: true }); atomicWrite(p, text); });


/* ================= GOOGLE CALENDAR (Signal Path 4.0, read-only) =================
   Everything Google-related runs here in the main process: the sign-in (OAuth with a loopback
   redirect + PKCE), token refresh and the API calls. The page only ever receives plain event data.
   Secrets (client secret, refresh token) are encrypted with the OS keychain when it is available. */
const G_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly';
const gFile = () => path.join(app.getPath('userData'), 'google.json');
const gCacheFile = () => path.join(app.getPath('userData'), 'google-cache.json');
const seal = (t) => { try { if (safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(t).toString('base64'); } catch { /* fall through */ } return 'p:' + t; };
const unseal = (v) => { if (!v) return ''; try { return v.startsWith('e:') ? safeStorage.decryptString(Buffer.from(v.slice(2), 'base64')) : v.slice(2); } catch { return ''; } };
const gRead = () => { try { return JSON.parse(fs.readFileSync(gFile(), 'utf8')); } catch { return {}; } };
const gWrite = (o) => fs.writeFileSync(gFile(), JSON.stringify(o));
let gAccess = { token: '', exp: 0 };

const gClient = () => { const g = gRead(); return { id: g.clientId || '', secret: unseal(g.secret) }; };
const gForm = (o) => new URLSearchParams(o).toString();
async function gTokenCall(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: gForm(params) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error_description || j.error || `HTTP ${r.status}`); e.code = j.error || 'token'; throw e; }
  return j;
}
async function gAccessToken() {
  if (gAccess.token && Date.now() < gAccess.exp - 60000) return gAccess.token;
  const g = gRead(), c = gClient(), rt = unseal(g.refresh);
  if (!c.id || !rt) { const e = new Error('Not connected'); e.code = 'noauth'; throw e; }
  try {
    const j = await gTokenCall({ client_id: c.id, client_secret: c.secret, refresh_token: rt, grant_type: 'refresh_token' });
    gAccess = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
    return gAccess.token;
  } catch (err) {
    if (err.code === 'invalid_grant') { const e = new Error('Google sign-in expired'); e.code = 'reauth'; throw e; }
    throw err;
  }
}
async function gApi(url, retry = true) {
  const tok = await gAccessToken();
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (r.status === 401 && retry) { gAccess = { token: '', exp: 0 }; return gApi(url, false); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || `HTTP ${r.status}`); e.code = r.status === 404 ? 'notfound' : r.status === 403 ? 'forbidden' : 'api'; if (/insufficient authentication scopes/i.test(e.message)) { e.code = 'reauth'; e.message = 'Calendar permission missing'; } throw e; }
  return j;
}

ipcMain.handle('gcal:status', () => { const g = gRead(); return { configured: !!g.clientId && !!g.secret, connected: !!unseal(g.refresh), email: g.email || '' }; });
ipcMain.handle('gcal:setClient', (_, id, secret) => {
  const cid = String(id || '').trim(), sec = String(secret || '').trim();
  if (!cid || !sec) return { ok: false, error: 'Both the Client ID and the Client secret are needed.' };
  const g = gRead(); g.clientId = cid; g.secret = seal(sec); delete g.refresh; delete g.email; gWrite(g); gAccess = { token: '', exp: 0 };
  return { ok: true };
});
ipcMain.handle('gcal:disconnect', () => {
  const g = gRead(); delete g.refresh; delete g.email; gWrite(g); gAccess = { token: '', exp: 0 };
  try { fs.unlinkSync(gCacheFile()); } catch { /* none */ }
  return true;
});
ipcMain.handle('gcal:forgetClient', () => { try { fs.unlinkSync(gFile()); fs.unlinkSync(gCacheFile()); } catch { /* none */ } gAccess = { token: '', exp: 0 }; return true; });

const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const donePage = (ok, msg) => `<!doctype html><meta charset="utf-8"><title>Signal Path</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#08080d;color:#cfd0de;font:16px 'Segoe UI',system-ui,sans-serif"><div style="text-align:center;max-width:420px;padding:40px;border:1px solid #262636;border-radius:14px;background:#12121a"><div style="font-size:42px;color:${ok ? '#d62bd0' : '#ff5b7f'}">${ok ? '&#10003;' : '&#9888;'}</div><h2 style="margin:8px 0 6px;color:#f0eef8;font-weight:600">${ok ? 'Calendar connected' : 'Could not connect'}</h2><p style="color:#777a92;margin:0">${msg}</p></div>`;

let gCancel = null;
ipcMain.handle('gcal:cancel', () => { if (gCancel) gCancel({ ok: false, cancelled: true, error: 'Cancelled.' }); return true; });
ipcMain.handle('gcal:connect', async () => {
  const c = gClient(); if (!c.id || !c.secret) return { ok: false, error: 'Add your Client ID and secret first.' };
  if (gCancel) gCancel({ ok: false, cancelled: true, error: 'Cancelled.' });
  const verifier = b64u(crypto.randomBytes(48)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest()), state = b64u(crypto.randomBytes(16));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (res) => { if (settled) return; settled = true; clearTimeout(timer); try { srv.close(); } catch { /* closed */ } gCancel = null; if (win && !win.isDestroyed()) { win.show(); win.focus(); } resolve(res); };
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/cb') { res.writeHead(404); res.end(); return; }
      const code = u.searchParams.get('code'), err = u.searchParams.get('error');
      const reply = (ok, msg) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(donePage(ok, msg)); };
      if (err || !code || u.searchParams.get('state') !== state) { reply(false, 'Google did not approve the sign-in. You can close this tab and try again from Signal Path.'); return finish({ ok: false, error: err === 'access_denied' ? 'Sign-in was cancelled.' : 'Google did not approve the sign-in.' }); }
      try {
        const j = await gTokenCall({ code, client_id: c.id, client_secret: c.secret, redirect_uri: `http://127.0.0.1:${srv.address().port}/cb`, grant_type: 'authorization_code', code_verifier: verifier });
        if (!/calendar\.readonly/.test(j.scope || '')) { reply(false, 'The calendar permission was not ticked on Google\'s page. Go back to Signal Path and try again, and tick the Calendar box.'); return finish({ ok: false, error: 'Google signed you in, but the Calendar permission box was not ticked. Press Connect again and tick the box that says “See and download any calendar…” before pressing Continue.' }); }
        if (!j.refresh_token) { reply(false, 'Google did not return a long-lived sign-in. Remove Signal Path at myaccount.google.com/permissions and try again.'); return finish({ ok: false, error: 'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.' }); }
        let email = ''; try { email = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64').toString('utf8')).email || ''; } catch { /* optional */ }
        const g = gRead(); g.refresh = seal(j.refresh_token); g.email = email; gWrite(g);
        gAccess = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
        reply(true, 'You can close this tab and go back to Signal Path.'); finish({ ok: true, email });
      } catch (e) { reply(false, 'Something went wrong while finishing the sign-in. You can close this tab.'); finish({ ok: false, error: e.message }); }
    });
    gCancel = finish;
    const timer = setTimeout(() => finish({ ok: false, error: 'Sign-in timed out. Try again.' }), 5 * 60 * 1000);
    srv.on('error', (e) => finish({ ok: false, error: e.message }));
    srv.listen(0, '127.0.0.1', () => {
      const q = gForm({ client_id: c.id, redirect_uri: `http://127.0.0.1:${srv.address().port}/cb`, response_type: 'code', scope: G_SCOPES, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
      shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
    });
  });
});

const gcache = () => { try { return JSON.parse(fs.readFileSync(gCacheFile(), 'utf8')); } catch { return {}; } };
const gcacheSet = (k, v) => {
  const c = gcache(); c[k] = { at: Date.now(), v };
  const keys = Object.keys(c); if (keys.length > 160) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - 160).forEach((x) => delete c[x]);
  try { fs.writeFileSync(gCacheFile(), JSON.stringify(c)); } catch { /* cache is optional */ }
};
const netDown = (e) => !e.code || e.code === 'api' ? /fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(String(e.message) + String(e.cause && e.cause.code || '')) : false;
const errOut = (e) => (netDown(e) ? { ok: false, code: 'offline', error: 'Can\'t reach Google. Check your internet connection.' } : { ok: false, code: e.code || 'error', error: e.message || 'Something went wrong' });

ipcMain.handle('gcal:calendars', async () => {
  try {
    const out = []; let pt = '';
    do { const j = await gApi('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&minAccessRole=freeBusyReader' + (pt ? `&pageToken=${encodeURIComponent(pt)}` : '')); (j.items || []).forEach((c) => out.push({ id: c.id, name: c.summaryOverride || c.summary || c.id, color: c.backgroundColor || '#4f8cf0', primary: !!c.primary, holiday: /#holiday@group\.v\.calendar\.google\.com$/.test(c.id), selected: !!c.selected })); pt = j.nextPageToken || ''; } while (pt);
    gcacheSet('calendars', out); return { ok: true, items: out };
  } catch (e) { const c = gcache().calendars; if (c && netDown(e)) return { ok: true, items: c.v, offline: true, at: c.at }; return errOut(e); }
});

const tidy = (e) => {
  const allDay = !!(e.start && e.start.date);
  const start = allDay ? e.start.date : (e.start && e.start.dateTime), end = allDay ? e.end.date : (e.end && e.end.dateTime);
  const meet = e.hangoutLink || (e.conferenceData && (e.conferenceData.entryPoints || []).filter((x) => x.entryPointType === 'video').map((x) => x.uri)[0]) || '';
  return { id: e.id, title: e.summary || '(No title)', allDay, start, end, loc: e.location || '', desc: String(e.description || '').slice(0, 1500), link: e.htmlLink || '', meet, status: e.status, guests: (e.attendees || []).length, rsvp: ((e.attendees || []).find((a) => a.self) || {}).responseStatus || '', type: e.eventType || 'default', color: e.colorId || '' };
};
ipcMain.handle('gcal:events', async (_, calId, startISO, endISO) => {
  const id = String(calId || ''), a = String(startISO || ''), b = String(endISO || '');
  if (!id || !/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(a) || !/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(b)) return { ok: false, code: 'bad', error: 'Bad request' };
  const key = `ev|${id}|${a.slice(0, 10)}|${b.slice(0, 10)}`;
  try {
    const out = []; let pt = '';
    do {
      const q = gForm({ singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeMin: a, timeMax: b }) + (pt ? `&pageToken=${encodeURIComponent(pt)}` : '');
      const j = await gApi(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${q}`);
      (j.items || []).filter((e) => e.status !== 'cancelled' && e.start).forEach((e) => out.push(tidy(e))); pt = j.nextPageToken || '';
    } while (pt);
    gcacheSet(key, out); return { ok: true, items: out };
  } catch (e) { const c = gcache()[key]; if (c && netDown(e)) return { ok: true, items: c.v, offline: true, at: c.at }; return errOut(e); }
});
/* Google Tasks with a due date show in the all-day row, like they do in Google Calendar. Read-only. */
ipcMain.handle('gcal:tasks', async (_, startISO, endISO) => {
  const a = String(startISO || ''), b = String(endISO || '');
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(a) || !/^\d{4}-\d{2}-\d{2}T[\d:.+Z-]+$/.test(b)) return { ok: false, code: 'bad', error: 'Bad request' };
  const key = `tk|${a.slice(0, 10)}|${b.slice(0, 10)}`;
  try {
    const lo = new Date(Date.parse(a) - 864e5).toISOString(), hi = new Date(Date.parse(b) + 864e5).toISOString();
    const lists = await gApi('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100'), out = [];
    for (const l of (lists.items || [])) {
      let pt = '';
      do {
        const q = gForm({ showCompleted: 'true', showHidden: 'true', maxResults: '100', dueMin: lo, dueMax: hi }) + (pt ? `&pageToken=${encodeURIComponent(pt)}` : '');
        const j = await gApi(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks?${q}`);
        (j.items || []).filter((t) => t.due).forEach((t) => {
          const d = String(t.due).slice(0, 10), nx = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10);
          out.push({ id: t.id, title: t.title || '(No title)', allDay: true, start: d, end: nx, loc: '', desc: String(t.notes || '').slice(0, 1500), link: t.webViewLink || '', meet: '', status: 'confirmed', guests: 0, rsvp: '', type: 'task', color: '', task: true, done: t.status === 'completed', list: l.title || '' });
        });
        pt = j.nextPageToken || '';
      } while (pt);
    }
    gcacheSet(key, out); return { ok: true, items: out };
  } catch (e) {
    const c = gcache()[key]; if (c && netDown(e)) return { ok: true, items: c.v, offline: true, at: c.at };
    if (netDown(e)) return errOut(e);
    const msg = String(e.message || '');
    if (e.code === 'reauth' || /insufficient|scope/i.test(msg)) return { ok: false, code: 'tasks', error: 'To show your Google Tasks, press Disconnect Google below, reconnect, and tick the Tasks box on Google’s page.' };
    if (e.code === 'forbidden' || /has not been used|disabled|accessNotConfigured/i.test(msg)) return { ok: false, code: 'tasks', error: 'Switch on the “Google Tasks API” in your Google Cloud project (APIs & Services → Library), then press refresh.' };
    return errOut(e);
  }
});
ipcMain.handle('gcal:colors', async () => {
  try { const j = await gApi('https://www.googleapis.com/calendar/v3/colors'); const out = {}; Object.keys(j.event || {}).forEach((k) => { out[k] = j.event[k].background; }); gcacheSet('colors', out); return { ok: true, items: out }; }
  catch (e) { const c = gcache().colors; if (c) return { ok: true, items: c.v, offline: true }; return errOut(e); }
});
ipcMain.handle('gcal:open', (_, url) => { try { const u = new URL(String(url)); if (u.protocol === 'https:' && /(^|\.)(google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com)$/.test(u.hostname)) shell.openExternal(u.href); } catch { /* ignore */ } });

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 340, minHeight: 460,
    backgroundColor: '#0c0d12', autoHideMenuBar: true, title: 'Signal Path', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadFile('index.html');
});
app.on('window-all-closed', () => app.quit());

/* ================= BACKUPS (Signal Path 4.2) =================
   Once a day (on open, and hourly while the app stays open) every .md and .json file in the vault is
   snapshotted into <vault>/.signal-backups. Files are stored by content hash, so a file that has not
   changed costs nothing; each snapshot is a small list of "file -> content". Images and attachments are
   not copied. Snapshots older than BK_DAYS are deleted along with any content nothing else uses. */
const BK_DAYS = 30;
const bkDir = () => path.join(root, '.signal-backups');
const bkSnapDir = () => path.join(bkDir(), 'snapshots');
const bkBlob = (h) => path.join(bkDir(), 'blobs', h.slice(0, 2), h);
const bkSnapFile = (id) => path.join(bkSnapDir(), id + '.json');
const pad = (n) => String(n).padStart(2, '0');
const bkDayId = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const bkTimeId = (d = new Date()) => `${bkDayId(d)}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
let bkBusy = false;
const yieldNow = () => new Promise((r) => setImmediate(r));
function bkWalk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) bkWalk(p, base, out);
    else if (/\.(md|json|canvas)$/i.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}
const bkIndexFile = () => path.join(bkDir(), 'index.json');
async function bkSnapshot(id, label) {
  const fsp = fs.promises;
  fs.mkdirSync(bkSnapDir(), { recursive: true });
  let idx = {}; try { idx = JSON.parse(fs.readFileSync(bkIndexFile(), 'utf8')); } catch { idx = {}; }
  const files = bkWalk(root, root, []), man = {}, nidx = {}; let n = 0;
  for (const rel of files) {
    if (++n % 40 === 0) await yieldNow();
    try {
      const full = path.join(root, rel), st = fs.statSync(full), c = idx[rel];
      let h = c && c.m === st.mtimeMs && c.s === st.size && fs.existsSync(bkBlob(c.h)) ? c.h : null;
      if (!h) {
        const buf = await fsp.readFile(full); h = crypto.createHash('sha1').update(buf).digest('hex');
        if (!fs.existsSync(bkBlob(h))) { fs.mkdirSync(path.dirname(bkBlob(h)), { recursive: true }); fs.writeFileSync(bkBlob(h), buf); }
      }
      man[rel] = h; nidx[rel] = { m: st.mtimeMs, s: st.size, h };
    } catch { /* file vanished or locked: skip it this time */ }
  }
  atomicWrite(bkSnapFile(id), JSON.stringify({ id, label, ts: Date.now(), files: man }));
  atomicWrite(bkIndexFile(), JSON.stringify(nidx));
  return { id, count: Object.keys(man).length };
}
function bkReadSnaps() {
  let names = []; try { names = fs.readdirSync(bkSnapDir()); } catch { return []; }
  const out = [];
  for (const f of names) { if (!f.endsWith('.json')) continue; try { out.push(JSON.parse(fs.readFileSync(path.join(bkSnapDir(), f), 'utf8'))); } catch { /* skip unreadable */ } }
  return out.sort((a, b) => b.ts - a.ts);
}
function bkPrune() {
  const snaps = bkReadSnaps(), cut = Date.now() - BK_DAYS * 864e5;
  snaps.forEach((s, i) => { if (i >= 3 && s.ts < cut) { try { fs.unlinkSync(bkSnapFile(s.id)); } catch { /* ignore */ } } });
  const keep = new Set(); bkReadSnaps().forEach((s) => Object.values(s.files || {}).forEach((h) => keep.add(h)));
  const bd = path.join(bkDir(), 'blobs'); let subs = []; try { subs = fs.readdirSync(bd); } catch { return; }
  for (const d of subs) {
    let fl = []; try { fl = fs.readdirSync(path.join(bd, d)); } catch { continue; }
    for (const h of fl) if (!keep.has(h)) { try { fs.unlinkSync(path.join(bd, d, h)); } catch { /* ignore */ } }
  }
}
async function bkDaily() {
  if (!root || bkBusy) return; bkBusy = true;
  try { if (!fs.existsSync(bkSnapFile(bkDayId()))) { await bkSnapshot(bkDayId(), 'Daily'); bkPrune(); } } finally { bkBusy = false; }
}
function bkDailySafe() { bkDaily().catch(() => { bkBusy = false; }); }
const bkScope = (rel0, sc) => {
  const rel = toLegacy(rel0), top = rel.split('/')[0];
  if (sc === 'all') return true;
  if (sc === 'gym') return rel === 'Gym.json';
  if (sc === 'tasks') return ['Daily Tasks.tasks.json', 'Gantt.gantt.json', 'Pomodoro.pomo.json', 'Dashboard.json'].includes(rel);
  if (sc === 'health') return top === 'Health' || rel === 'FoodLog.json';
  if (sc === 'finance') return top === 'Finance';
  if (sc === 'notes') return /\.(md|canvas)$/i.test(rel) && top !== 'Health' && top !== 'Finance';
  return false;
};
const bkSha = (full) => { try { return crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex'); } catch { return null; } };
function bkDiff(id, sc) {
  const snap = bkReadSnaps().find((s) => s.id === id); if (!snap) return null;
  const todo = [];
  for (const [rel, h] of Object.entries(snap.files || {})) {
    if (rel.includes('..') || !bkScope(rel, sc)) continue;
    const full = path.resolve(root, layoutNew() ? toNew(toLegacy(rel)) : toLegacy(rel)); if (!inside(full)) continue;
    if (bkSha(full) !== h && fs.existsSync(bkBlob(h))) todo.push([rel, h, full]);
  }
  return { snap, todo };
}
ipcMain.handle('backup:list', () => bkReadSnaps().map((s) => ({ id: s.id, label: s.label, ts: s.ts, count: Object.keys(s.files || {}).length })));
ipcMain.handle('backup:now', async () => { while (bkBusy) await yieldNow(); bkBusy = true; try { const r = await bkSnapshot(bkTimeId(), 'Manual'); bkPrune(); return r; } finally { bkBusy = false; } });
ipcMain.handle('backup:preview', (_, id, sc) => { const d = bkDiff(String(id), String(sc)); return d ? d.todo.length : -1; });
ipcMain.handle('backup:restore', async (_, id, sc) => {
  while (bkBusy) await yieldNow(); bkBusy = true;
  try {
    const d = bkDiff(String(id), String(sc)); if (!d) return -1;
    await bkSnapshot(bkTimeId() + '_before-restore', 'Before a restore');
    for (const [, h, full] of d.todo) { fs.mkdirSync(path.dirname(full), { recursive: true }); atomicWrite(full, fs.readFileSync(bkBlob(h))); }
    return d.todo.length;
  } finally { bkBusy = false; }
});
setInterval(bkDailySafe, 3600e3);


/* ================= ORGANIZE VAULT (4.93) ================= */
function orgPlan(opts) {
  const moves = [];
  for (const n of Object.keys(DATA_SUB)) if (fs.existsSync(path.join(root, n))) moves.push({ from: n, to: toNew(n), kind: 'data' });
  for (const d of ['Health', 'Finance']) {
    const abs = path.join(root, d);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) for (const f of walkSync(abs)) moves.push({ from: d + '/' + f, to: SYS + '/' + d + '/' + f, kind: 'data' });
  }
  const inbox = opts && opts.inbox ? String(opts.inbox).replace(/[\\/:*?"<>|]/g, '').trim() : '';
  if (inbox) for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isFile() && /\.(md|canvas)$/i.test(e.name)) moves.push({ from: e.name, to: inbox + '/' + e.name, kind: 'note' });
  moves.forEach((x) => { x.conflict = fs.existsSync(path.join(root, x.to)); });
  return moves;
}
const orgLog = () => path.join(root, SYS, '.migration-log.json');
ipcMain.handle('org:state', () => {
  const plan = orgPlan({ inbox: '' }), loose = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile() && /\.(md|canvas)$/i.test(e.name)).length;
  return { organized: layoutNew(), pending: plan.length, loose, undo: fs.existsSync(orgLog()) };
});
ipcMain.handle('org:apply', async (_, opts) => {
  const plan = orgPlan(opts || {}).filter((x) => !x.conflict), done = [];
  if (!plan.length && !layoutNew()) { fs.mkdirSync(path.join(root, SYS), { recursive: true }); return { moved: 0 }; }
  while (bkBusy) await yieldNow(); bkBusy = true;
  try { await bkSnapshot(bkTimeId() + '_before-organize', 'Before organizing the vault'); } catch { /* carry on, files are only moved */ } finally { bkBusy = false; }
  fs.mkdirSync(path.join(root, SYS), { recursive: true });
  for (const x of plan.filter((p) => p.kind === 'data')) {          // data files first, in one go, so nothing can write to the old place meanwhile
    try { fs.mkdirSync(path.dirname(path.join(root, x.to)), { recursive: true }); fs.renameSync(path.join(root, x.from), path.join(root, x.to)); done.push(x); } catch { /* leave it where it is */ }
  }
  for (const d of ['Health', 'Finance']) pruneDirs(path.join(root, d));
  for (const x of plan.filter((p) => p.kind === 'note')) {
    try { const a = path.join(root, x.from), b = path.join(root, x.to); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.renameSync(a, b); await afterRename(a, b, false); done.push(x); } catch { /* leave it where it is */ }
  }
  let prev = []; try { prev = JSON.parse(fs.readFileSync(orgLog(), 'utf8')).moves || []; } catch { prev = []; }
  atomicWrite(orgLog(), JSON.stringify({ ts: Date.now(), moves: [...prev, ...done] }, null, 1));
  return { moved: done.length, skipped: plan.length - done.length };
});
ipcMain.handle('org:undo', async () => {
  if (!layoutNew()) return { moved: 0 };
  let log = { moves: [] }; try { log = JSON.parse(fs.readFileSync(orgLog(), 'utf8')); } catch { /* none */ }
  let n = 0;
  for (const rel of walkSync(path.join(root, SYS)).filter((f) => !f.startsWith('.'))) {           // every data file that is in the organized folder goes back
    const from = path.join(root, SYS, rel), back = toLegacy(SYS + '/' + rel), to = path.join(root, back);
    if (fs.existsSync(to)) continue; try { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); n++; } catch { /* skip */ }
  }
  for (const x of (log.moves || []).filter((y) => y.kind === 'note').reverse()) {
    const a = path.join(root, x.to), b = path.join(root, x.from); if (!fs.existsSync(a) || fs.existsSync(b)) continue;
    try { fs.renameSync(a, b); await afterRename(a, b, false); n++; } catch { /* skip */ }
  }
  try { fs.unlinkSync(orgLog()); } catch { /* ignore */ }
  pruneDirs(path.join(root, SYS)); try { if (fs.existsSync(path.join(root, SYS)) && !fs.readdirSync(path.join(root, SYS)).length) fs.rmdirSync(path.join(root, SYS)); } catch { /* ignore */ }
  return { moved: n };
});
