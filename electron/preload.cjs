const { contextBridge, ipcRenderer } = require('electron');

const tokenArg = process.argv.find((arg) => arg.startsWith('--flexlab-management-token='));
const managementToken = tokenArg
  ? tokenArg.slice('--flexlab-management-token='.length)
  : (process.env.FLEXLAB_MANAGEMENT_TOKEN || '');

contextBridge.exposeInMainWorld('flexlabDesktop', {
  managementToken,
  getInfo: () => ipcRenderer.invoke('desktop:get'),
  setOpenAtLogin: (enabled) => ipcRenderer.invoke('desktop:set-open-at-login', Boolean(enabled)),
  checkUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  openReleases: () => ipcRenderer.invoke('desktop:open-releases'),
});
