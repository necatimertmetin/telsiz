const {app, BrowserWindow, Menu, Tray, desktopCapturer, globalShortcut, ipcMain, nativeImage, session, shell} = require('electron')
const path = require('path')

// Canlı siteyi açar: düzeltmeler herkese yeniden kurulum gerekmeden ulaşır.
const HOME = process.env.TELSIZ_URL || 'https://necatimertmetin.github.io/telsiz/'
const ORIGIN = new URL(HOME).origin

// Oyun tam ekrandayken pencere görünmez sayılır; ses ve zamanlayıcılar yavaşlamasın.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

if (!app.requestSingleInstanceLock()) app.quit()

let win, tray, quitting = false, picked = null

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 780, minWidth: 420, minHeight: 500,
    backgroundColor: '#14161a', title: 'Telsiz', autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false},
  })
  win.setMenu(null)
  win.loadURL(HOME)
  win.webContents.on('did-fail-load', (_e, code, _d, _u, isMain) => { if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html')) })
  win.webContents.setWindowOpenHandler(({url}) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return {action: 'deny'}
  })
  win.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== ORIGIN) e.preventDefault() })
  // Çarpı tepsiye indirir: oyundayken görüşme yanlışlıkla kapanmasın.
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide() } })
}

app.whenReady().then(() => {
  const ok = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'])
  const allowed = url => { try { return new URL(url).origin === ORIGIN } catch { return false } }
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ok.has(perm) && allowed(wc.getURL())))
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => ok.has(perm) && allowed(origin))

  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const list = await desktopCapturer.getSources({types: ['screen', 'window']})
    const source = list.find(s => s.id === picked) ?? list[0]
    picked = null
    // Sistem sesi bilerek yok: arkadaşların kendi seslerini geri duyardı.
    cb({video: source})
  })

  ipcMain.handle('sources', async () => {
    const list = await desktopCapturer.getSources({types: ['screen', 'window'], thumbnailSize: {width: 320, height: 180}})
    return list.map(s => ({id: s.id, name: s.name, thumb: s.thumbnail.toDataURL()}))
  })
  ipcMain.handle('pick', (_e, id) => { picked = id })
  ipcMain.on('flash', () => { if (win && !win.isFocused()) win.flashFrame(true) })

  createWindow()

  globalShortcut.register('CommandOrControl+Shift+M', () => win?.webContents.send('hotkey', 'mute'))
  globalShortcut.register('CommandOrControl+Shift+D', () => win?.webContents.send('hotkey', 'deaf'))

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({width: 16, height: 16}))
  tray.setToolTip('Telsiz')
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: 'Aç', click: () => { win.show(); win.focus() }},
    {label: 'Çıkış', click: () => { quitting = true; app.quit() }},
  ]))
  tray.on('click', () => { win.show(); win.focus() })
})

app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => globalShortcut.unregisterAll())
