const {contextBridge, ipcRenderer} = require('electron')

contextBridge.exposeInMainWorld('telsizDesktop', {
  onHotkey: cb => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
  listSources: () => ipcRenderer.invoke('sources'),
  pickSource: (id, audio) => ipcRenderer.invoke('pick', id, audio),
  flash: () => ipcRenderer.send('flash'),
})
