const {contextBridge, ipcRenderer} = require('electron')

contextBridge.exposeInMainWorld('telsizOverlay', {
  onData: cb => ipcRenderer.on('people', (_e, list) => cb(list)),
})
