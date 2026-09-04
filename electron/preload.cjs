const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  chooseModelPaths: () => ipcRenderer.invoke('desktop:choose-model-paths'),
  importModelPaths: (paths) => ipcRenderer.invoke('desktop:import-model-paths', Array.isArray(paths) ? paths : []),
  updateModel: (id, patch) => ipcRenderer.invoke('desktop:update-model', String(id || ''), patch || {}),
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
