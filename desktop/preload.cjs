const {contextBridge, ipcRenderer} = require('electron')

contextBridge.exposeInMainWorld('telsizDesktop', {
  onHotkey: cb => ipcRenderer.on('hotkey', (_e, k) => cb(k)),
  listSources: () => ipcRenderer.invoke('sources'),
  pickSource: (id, audio) => ipcRenderer.invoke('pick', id, audio),
  flash: () => ipcRenderer.send('flash'),
  setPtt: vk => ipcRenderer.send('ptt', vk),
  onPtt: cb => ipcRenderer.on('ptt', (_e, d) => cb(d)),
  onUpdate: cb => ipcRenderer.on('update-ready', () => cb()),
  installUpdate: () => ipcRenderer.send('install-update'),
  appVersion: () => ipcRenderer.invoke('app-version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  setOverlay: people => ipcRenderer.send('overlay', people),
  setAdblock: on => ipcRenderer.invoke('adblock', on),
  adblockOn: () => ipcRenderer.invoke('adblock-on'),
})
