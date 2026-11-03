const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('vaughanator', {
  setSession: (data) => ipcRenderer.invoke('session:set', data),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  inspectFiles: (files) => {
    const entries = Array.from(files).map((file) => ({
      name: file.name,
      path: webUtils.getPathForFile(file),
    }));
    return ipcRenderer.invoke('files:inspect', entries);
  },
  publishBatch: (items, concurrency) => ipcRenderer.invoke('batch:publish', { items, concurrency }),
  onStage: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('batch:stage', listener);
    return () => ipcRenderer.removeListener('batch:stage', listener);
  },
  onItemResult: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('batch:item-result', listener);
    return () => ipcRenderer.removeListener('batch:item-result', listener);
  },
  onRequestLog: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('api:request-log', listener);
    return () => ipcRenderer.removeListener('api:request-log', listener);
  },
});
