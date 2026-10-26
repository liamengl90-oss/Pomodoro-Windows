const { app, BrowserWindow, ipcMain, globalShortcut, Menu } = require('electron');
const path = require('path');

app.setAppUserModelId('app.esper.focus');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

let win;
function create() {
  win = new BrowserWindow({
    width: 980, height: 700, minWidth: 560, minHeight: 460,
    frame: false, backgroundColor: '#020403', title: 'ESPER // Focus', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false          // keep the timer and sounds exact when minimized
    }
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
}

Menu.setApplicationMenu(null);
app.whenReady().then(() => {
  create();
  globalShortcut.register('CommandOrControl+Alt+Space', () => win && win.webContents.send('esper:toggle'));
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());

ipcMain.handle('esper:win', (_e, action) => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'full') win.setFullScreen(!win.isFullScreen());
  else if (action === 'close') win.close();
  else if (action === 'pin') { const on = !win.isAlwaysOnTop(); win.setAlwaysOnTop(on, 'floating'); return on; }
});
