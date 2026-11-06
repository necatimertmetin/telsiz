const {contextBridge, ipcRenderer} = require('electron')

contextBridge.exposeInMainWorld('telsizDesktop', {
  onHotkey: cb => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
  listSources: () => ipcRenderer.invoke('sources'),
  pickSource: id => ipcRenderer.invoke('pick', id),
  flash: () => ipcRenderer.send('flash'),
})
