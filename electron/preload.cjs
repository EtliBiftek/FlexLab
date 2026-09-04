const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flexlabDesktop', {
  managementToken: process.env.FLEXLAB_MANAGEMENT_TOKEN || '',
  getInfo: () => ipcRenderer.invoke('desktop:get'),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('desktop:set-open-at-login', Boolean(enabled)),
  checkUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  openReleases: () => ipcRenderer.invoke('desktop:open-releases'),
});
