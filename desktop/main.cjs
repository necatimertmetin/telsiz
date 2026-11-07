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

// Radyoda çalan şarkı: yayın akışının içine gömülü "StreamTitle" okunur. Tarayıcı çoğu yayında
// bunu engeller (CORS), uygulama doğrudan okur. En fazla 400 KB ve 10 sn, sonra bağlantı kapanır.
async function radioTitle(url) {
  if (typeof url !== 'string' || !/^https:\/\/[^\s"'<>]+$/.test(url)) return null
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 10000)
  try {
    const r = await fetch(url, {headers: {'Icy-MetaData': '1'}, signal: ac.signal})
    const rd = r.body.getReader()
    let buf = Buffer.alloc(0)
    while (buf.length < 400000) {
      const {value, done} = await rd.read()
      if (done) break
      buf = Buffer.concat([buf, value])
      const i = buf.indexOf("StreamTitle='")
      if (i < 0) continue
      const j = buf.indexOf("';", i + 13)
      if (j < 0) continue
      const raw = buf.subarray(i + 13, j), s = raw.toString('utf8')
      return (s.includes(String.fromCharCode(0xfffd)) ? new TextDecoder('windows-1254').decode(raw) : s).slice(0, 200)
    }
    return null
  } catch { return null } finally { clearTimeout(t); ac.abort() }
}

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

// Küçük pencere: simge durumuna küçültünce izlenecek görüntü varsa (YouTube, ekran, kamera) pencere küçülüp
// sağ altta üstte kalır, sayfa sadece görüntüyü gösterir. Görüntü yoksa normal küçülür. Büyüt eski boyuta döner.
let pipAvail = false, pipBounds = null
// Windows başlık çubuğu: kendi çubuğu gizli, küçült/büyüt/kapat düğmeleri sayfanın üstüne biner (Snap korunur).
// Renkleri sayfa temaya göre yollar. Küçük pencerede düğmeler alçalır.
const WIN = process.platform === 'win32'
const TB_H = 48, TB_PIP = 32
let tb = {color: '#14161a', symbolColor: '#e8e6e1'}
const applyTb = () => { if (WIN && win) try { win.setTitleBarOverlay({...tb, height: pipBounds ? TB_PIP : TB_H}) } catch { /* eski Electron */ } }
function enterPip() {
  if (!win || pipBounds || !pipAvail) return
  pipBounds = win.getNormalBounds()
  const a = require('electron').screen.getDisplayMatching(pipBounds).workArea
  const w = 420, h = 290
  win.restore()
  win.setMinimumSize(260, 180)
  win.setBounds({x: a.x + a.width - w - 16, y: a.y + a.height - h - 16, width: w, height: h})
  win.setAlwaysOnTop(true, 'floating')
  applyTb()
  win.webContents.send('pip-mode', true)
}
function exitPip() {
  if (!win || !pipBounds) return
  win.setAlwaysOnTop(false)
  win.setMinimumSize(420, 500)
  if (win.isMinimized()) win.restore()
  win.setBounds(pipBounds)
  pipBounds = null
  applyTb()
  win.webContents.send('pip-mode', false)
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

let checkUpdate = async () => false

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
  checkUpdate = () => autoUpdater.checkForUpdates().then(() => true, () => false)
}

// Reklam engeli (deneysel, varsayılan kapalı): YouTube reklam isteklerini sadece bu uygulamada keser.
// Liste bir kez indirilip saklanır, haftada bir yenilenir.
const adFile = () => path.join(app.getPath('userData'), 'adblock.json')
const adOnDisk = () => { try { return JSON.parse(fs.readFileSync(adFile(), 'utf8')).on === true } catch { return false } }
let blocker = null
async function setAdblock(on) {
  try { fs.writeFileSync(adFile(), JSON.stringify({on: !!on})) } catch { /* yok */ }
  try {
    const ses = session.defaultSession
    if (on) {
      if (!blocker) {
        const {ElectronBlocker} = require('@ghostery/adblocker-electron')
        const cache = path.join(app.getPath('userData'), 'adblock-engine.bin')
        try { if (Date.now() - fs.statSync(cache).mtimeMs > 7 * 864e5) fs.unlinkSync(cache) } catch { /* yok */ }
        blocker = await ElectronBlocker.fromPrebuiltAdsOnly(fetch, {path: cache, read: fs.promises.readFile, write: fs.promises.writeFile})
      }
      if (!blocker.isBlockingEnabled(ses)) blocker.enableBlockingInSession(ses)
    } else if (blocker?.isBlockingEnabled(ses)) blocker.disableBlockingInSession(ses)
    return true
  } catch (e) {
    console.log('adblock-error', e.message)
    return false
  }
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
    ...(WIN ? {titleBarStyle: 'hidden', titleBarOverlay: {...tb, height: TB_H}} : {}),
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
  win.on('minimize', () => { if (pipAvail && !pipBounds) setTimeout(enterPip, 60) })
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
  ipcMain.handle('app-version', () => app.getVersion())
  ipcMain.handle('check-update', () => checkUpdate())
  ipcMain.handle('adblock', (_e, on) => setAdblock(!!on))
  ipcMain.handle('adblock-on', () => adOnDisk())
  ipcMain.handle('radio-title', (_e, url) => radioTitle(url))
  if (adOnDisk()) void setAdblock(true)
  ipcMain.on('flash', () => { if (win && !win.isFocused()) win.flashFrame(true) })
  ipcMain.on('ptt', (_e, vk) => setPtt(vk))
  ipcMain.on('overlay', (_e, people) => setOverlay(people))
  ipcMain.on('pip-avail', (_e, on) => { pipAvail = !!on; if (!pipAvail) exitPip() })
  ipcMain.on('pip-exit', () => exitPip())
  ipcMain.on('titlebar', (_e, o) => {
    const hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)
    if (!hex(o?.color) || !hex(o?.symbolColor)) return
    tb = {color: o.color, symbolColor: o.symbolColor}
    applyTb()
  })

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
