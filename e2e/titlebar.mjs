// Windows başlık çubuğu: kabuğun kendi çubuğu gizli, düğmeler sayfaya biner; sayfa yer ayırır ve üst çubuktan sürüklenir.
// Önce `npx vite preview --port 4173` açık olmalı. Klasik ve Frekans arayüzünde bakar, ekran görüntüsü e2e/out'a.
import {_electron as electron} from 'playwright-core'
import path from 'node:path'

const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const dir = path.resolve('desktop')
const app = await electron.launch({executablePath: path.join(dir, 'node_modules/electron/dist/electron.exe'), args: [dir, '--user-data-dir=' + path.resolve('e2e/out/electron-profile')], cwd: dir, env: {...process.env, TELSIZ_URL: 'http://localhost:4173/'}})
const w = await app.firstWindow()
w.on('pageerror', e => check(false, 'sayfa hatası: ' + e.message))
await w.waitForLoadState()
await w.waitForFunction(() => window.telsiz)
if (!(await w.evaluate(() => window.telsiz.me.name))) {
  await w.getByLabel('Takma adın').fill('Masaustu')
  await w.getByRole('button', {name: 'Devam'}).click()
}
if (!(await w.evaluate(() => window.telsiz.groups.length))) await w.getByRole('button', {name: 'Kur'}).click()
const ui0 = await w.evaluate(() => window.telsiz.prefs.ui)

const look = sel => w.evaluate(sel => {
  const r = document.documentElement, el = document.querySelector(sel), cs = getComputedStyle(el)
  const btns = [...el.querySelectorAll('button')].map(b => b.getBoundingClientRect())
  const wcoLeft = innerWidth - parseFloat(getComputedStyle(r).getPropertyValue('--wco-w'))
  return {
    wco: r.classList.contains('wco'),
    w: parseFloat(getComputedStyle(r).getPropertyValue('--wco-w')),
    drag: cs.getPropertyValue('app-region') || cs.webkitAppRegion,
    clear: btns.every(b => b.right <= wcoLeft || b.bottom <= 0),
  }
}, sel)

await w.evaluate(() => { window.telsiz.prefs.ui = 'klasik'; window.telsiz.prefs.hideMembers = true; window.telsiz.savePrefs() })
await w.waitForTimeout(400)
let x = await look('.topbar')
check(x.wco && x.w > 80, `düğme alanı ayrıldı (${x.w}px)`)
check(x.drag === 'drag', 'klasik üst çubuk sürüklenir')
check(x.clear, 'klasik üst çubuktaki düğmeler pencere düğmelerinin altında kalmıyor')
await w.screenshot({path: 'e2e/out/titlebar-klasik.png'})

await w.evaluate(() => { window.telsiz.prefs.ui = 'frekans'; window.telsiz.prefs.hideMembers = false; window.telsiz.savePrefs() })
await w.locator('.fq').waitFor()
await w.waitForTimeout(400)
x = await look('.fq-top')
check(x.drag === 'drag', 'Frekans üst çubuğu sürüklenir')
check(x.clear, 'Frekans düğmeleri pencere düğmelerinin altında kalmıyor')
await w.screenshot({path: 'e2e/out/titlebar-frekans.png'})

await w.evaluate(ui => { window.telsiz.prefs.ui = ui; window.telsiz.prefs.hideMembers = false; window.telsiz.savePrefs() }, ui0)
console.log(process.exitCode ? 'HATA' : 'TAMAM')
await app.close()
