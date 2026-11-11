const { contextBridge, ipcRenderer } = require('electron');
const call = (c) => (...a) => ipcRenderer.invoke(c, ...a);
contextBridge.exposeInMainWorld('api', {
  openVault: call('vault:open'), chooseVault: call('vault:choose'), tree: call('vault:tree'),
  read: call('note:read'), write: call('note:write'), create: call('note:create'), rename: call('note:rename'),
  createDir: call('dir:create'), renameDir: call('dir:rename'), move: call('fs:move'), trash: call('fs:trash'),
  loadTasks: call('tasks:load'), saveTasks: call('tasks:save'),
  loadData: call('data:load'), saveData: call('data:save'),
  healthLoad: call('health:load'), healthSave: call('health:save'),
  financeLoad: call('finance:load'), financeSave: call('finance:save'), incomeLoad: call('income:load'), incomeSave: call('income:save'),
  backupList: call('backup:list'), backupNow: call('backup:now'), backupPreview: call('backup:preview'), backupRestore: call('backup:restore'),
  gcalStatus: call('gcal:status'), gcalSetClient: call('gcal:setClient'), gcalConnect: call('gcal:connect'), gcalDisconnect: call('gcal:disconnect'), gcalCancel: call('gcal:cancel'),
  gcalForgetClient: call('gcal:forgetClient'), gcalCalendars: call('gcal:calendars'), gcalEvents: call('gcal:events'), gcalTasks: call('gcal:tasks'), gcalOpen: call('gcal:open'), gcalColors: call('gcal:colors'),
});
