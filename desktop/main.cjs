const {app, BrowserWindow, Menu, Tray, desktopCapturer, globalShortcut, ipcMain, nativeImage, session, shell} = require('electron')
const path = require('path')
const fs = require('fs')

// Canlı siteyi açar: düzeltmeler herkese yeniden kurulum gerekmeden ulaşır.
const HOME = process.env.TELSIZ_URL || 'https://necatimertmetin.github.io/telsiz/'
const ORIGIN = new URL(HOME).origin

// Oyun tam ekrandayken pencere görünmez sayılır; ses ve zamanlayıcılar yavaşlamasın.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

if (!app.requestSingleInstanceLock()) app.quit()

let win, tray, quitting = false, picked = null, pickedAudio = false

// Oyunun içine girmez, sıradan bir üst pencere: tıklamalar oyuna geçer, odak almaz.
// Bu yüzden özel tam ekranda görünmez, pencereli tam ekranda görünür.
let overlay = null
function setOverlay(people) {
  if (!people) { overlay?.hide(); return }
  if (!overlay) {
    overlay = new BrowserWindow({
      x: 12, y: 80, width: 230, height: 300, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
      webPreferences: {preload: path.join(__dirname, 'overlay-preload.cjs'), contextIsolation: true, sandbox: true},
    })
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setIgnoreMouseEvents(true)
    overlay.loadFile(path.join(__dirname, 'overlay.html'))
    overlay.on('closed', () => { overlay = null })
  }
  const send = () => { overlay?.webContents.send('people', people); overlay?.showInactive() }
  if (overlay.webContents.isLoading()) overlay.webContents.once('did-finish-load', send); else send()
}

// Bas-konuş: tuş durumu sorgulanır. Klavye kancası ya da oyuna müdahale yok.
let keyState = null
try {
  keyState = require('koffi').load('user32.dll').func('short __stdcall GetAsyncKeyState(int vKey)')
} catch (e) {
  console.log('ptt kullanılamıyor', e.message)
}
let pttTimer = null, pttDown = false
function setPtt(vk) {
  clearInterval(pttTimer)
  pttDown = false
  if (!vk || !keyState) return
  pttTimer = setInterval(() => {
    const down = (keyState(vk) & 0x8000) !== 0
    if (down !== pttDown) { pttDown = down; win?.webContents.send('ptt', down) }
  }, 25)
}

// Kurulu sürüm kendini günceller. Taşınabilir sürümün yerine yazılacak kurulumu yok.
function setupUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return
  const {autoUpdater} = require('electron-updater')
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', i => console.log('update-available', i.version))
  autoUpdater.on('update-not-available', () => console.log('update-not-available'))
  autoUpdater.on('error', e => console.log('update-error', e.message))
  autoUpdater.on('update-downloaded', () => { console.log('update-downloaded'); win?.webContents.send('update-ready') })
  ipcMain.on('install-update', () => { quitting = true; autoUpdater.quitAndInstall(true, true) })
  const check = () => autoUpdater.checkForUpdates().catch(e => console.log('update-error', e.message))
  check()
  setInterval(check, 6 * 3600 * 1000)
}

// İlk tepsiye inişte söyle: pencere kapandı sanıp bir daha açmaya çalışmasın.
function trayHint() {
  const flag = path.join(app.getPath('userData'), 'tray-hint')
  if (fs.existsSync(flag)) return
  fs.writeFileSync(flag, '1')
  tray?.displayBalloon({title: 'Telsiz çalışmaya devam ediyor', content: 'Saatin yanındaki simgeden açabilirsin. Çıkmak için simgeye sağ tıkla.'})
}

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
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); trayHint() } })
}

app.whenReady().then(() => {
  const ok = new Set(['media', 'display-capture', 'notifications', 'clipboard-sanitized-write', 'fullscreen', 'speaker-selection'])
  const allowed = url => { try { return new URL(url).origin === ORIGIN } catch { return false } }
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(ok.has(perm) && allowed(wc.getURL())))
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => ok.has(perm) && allowed(origin))

  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const list = await desktopCapturer.getSources({types: ['screen', 'window']})
    const source = list.find(s => s.id === picked) ?? list[0]
    const audio = pickedAudio
    picked = null
    pickedAudio = false
    cb(audio ? {video: source, audio: 'loopback'} : {video: source})
  })

  ipcMain.handle('sources', async () => {
    const list = await desktopCapturer.getSources({types: ['screen', 'window'], thumbnailSize: {width: 320, height: 180}})
    return list.map(s => ({id: s.id, name: s.name, thumb: s.thumbnail.toDataURL()}))
  })
  ipcMain.handle('pick', (_e, id, audio) => { picked = id; pickedAudio = !!audio })
  ipcMain.on('flash', () => { if (win && !win.isFocused()) win.flashFrame(true) })
  ipcMain.on('ptt', (_e, vk) => setPtt(vk))
  ipcMain.on('overlay', (_e, people) => setOverlay(people))

  createWindow()

  globalShortcut.register('CommandOrControl+Shift+M', () => win?.webContents.send('hotkey', 'mute'))
  globalShortcut.register('CommandOrControl+Shift+D', () => win?.webContents.send('hotkey', 'deaf'))
  globalShortcut.register('CommandOrControl+Shift+K', () => win?.webContents.send('hotkey', 'clip'))

  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({width: 16, height: 16}))
  tray.setToolTip('Telsiz')
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: 'Telsiz\'i aç', click: () => { win.show(); win.focus() }},
    {label: 'Mikrofonu aç/kapat', click: () => win?.webContents.send('hotkey', 'mute')},
    {label: 'Kulaklığı aç/kapat', click: () => win?.webContents.send('hotkey', 'deaf')},
    {type: 'separator'},
    {label: 'Kapat', click: () => { quitting = true; app.quit() }},
  ]))
  tray.on('click', () => { win.show(); win.focus() })
  setupUpdates()
})

app.on('second-instance', () => { if (win) { win.show(); win.focus() } })
app.on('before-quit', () => { quitting = true; overlay?.destroy() })
app.on('will-quit', () => globalShortcut.unregisterAll())
