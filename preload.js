const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('esper', {
  win: (action) => ipcRenderer.invoke('esper:win', action),
  onToggle: (cb) => ipcRenderer.on('esper:toggle', () => cb())
});
