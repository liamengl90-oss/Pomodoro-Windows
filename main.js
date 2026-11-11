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

function scan(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (dir === root && (e.name === 'Health' || e.name === 'Finance')) continue; out.push({ type: 'dir', name: e.name, path: p, children: scan(p) }); }
    else if (e.name.toLowerCase().endsWith('.md')) out.push({ type: 'file', name: e.name.slice(0, -3), path: p });
  }
  return out.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1);
}

function openVault(dir) {
  root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
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
ipcMain.handle('note:rename', (_, p, name) => rename(p, name, '.md'));
ipcMain.handle('dir:rename', (_, p, name) => rename(p, name, ''));
ipcMain.handle('dir:create', (_, parent) => {
  const d = parent && inside(parent) ? parent : root;
  let n = 1, p;
  do { p = path.join(d, n === 1 ? 'New folder' : `New folder ${n}`); n++; } while (fs.existsSync(p));
  fs.mkdirSync(p);
  return p;
});
ipcMain.handle('fs:move', (_, src, destDir) => {
  if (!inside(src) || !inside(destDir)) return src;
  const s = path.resolve(src), d = path.resolve(destDir);
  if (s === root || d === s || d.startsWith(s + path.sep) || path.dirname(s) === d) return src;
  const np = path.join(d, path.basename(s));
  if (fs.existsSync(np)) return src;
  fs.renameSync(s, np);
  return np;
});
ipcMain.handle('fs:trash', async (_, p) => { if (inside(p) && path.resolve(p) !== root) await shell.trashItem(path.resolve(p)); });

const tasksFile = () => path.join(root, 'Daily Tasks.tasks.json');
ipcMain.handle('tasks:load', () => { try { return fs.readFileSync(tasksFile(), 'utf8'); } catch { return ''; } });
ipcMain.handle('tasks:save', (_, text) => { atomicWrite(tasksFile(), text); });

const dataFile = (n) => path.join(root, path.basename(String(n)));
ipcMain.handle('data:load', (_, n) => { try { return fs.readFileSync(dataFile(n), 'utf8'); } catch { return ''; } });
ipcMain.handle('data:save', (_, n, text) => { if (/\.json$/i.test(String(n))) atomicWrite(dataFile(n), text); });

const healthDir = () => path.join(root, 'Health');
ipcMain.handle('health:load', (_, year) => { try { return fs.readFileSync(path.join(healthDir(), `Health ${Number(year)}.md`), 'utf8'); } catch { return ''; } });
ipcMain.handle('health:save', (_, year, text) => { fs.mkdirSync(healthDir(), { recursive: true }); atomicWrite(path.join(healthDir(), `Health ${Number(year)}.md`), text); });

const finPath = (ym) => (/^\d{4}-\d{2}$/.test(String(ym)) ? path.join(root, 'Finance', `Outgoing ${ym}.md`) : null);
ipcMain.handle('finance:load', (_, ym) => { const p = finPath(ym); try { return p ? fs.readFileSync(p, 'utf8') : ''; } catch { return ''; } });
const incomeFile = () => path.join(root, 'Finance', 'Income.md');
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
    else if (/\.(md|json)$/i.test(e.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
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
const bkScope = (rel, sc) => {
  const top = rel.split('/')[0];
  if (sc === 'all') return true;
  if (sc === 'gym') return rel === 'Gym.json';
  if (sc === 'tasks') return ['Daily Tasks.tasks.json', 'Gantt.gantt.json', 'Pomodoro.pomo.json', 'Dashboard.json'].includes(rel);
  if (sc === 'health') return top === 'Health' || rel === 'FoodLog.json';
  if (sc === 'finance') return top === 'Finance';
  if (sc === 'notes') return /\.md$/i.test(rel) && top !== 'Health' && top !== 'Finance';
  return false;
};
const bkSha = (full) => { try { return crypto.createHash('sha1').update(fs.readFileSync(full)).digest('hex'); } catch { return null; } };
function bkDiff(id, sc) {
  const snap = bkReadSnaps().find((s) => s.id === id); if (!snap) return null;
  const todo = [];
  for (const [rel, h] of Object.entries(snap.files || {})) {
    if (rel.includes('..') || !bkScope(rel, sc)) continue;
    const full = path.resolve(root, rel); if (!inside(full)) continue;
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
