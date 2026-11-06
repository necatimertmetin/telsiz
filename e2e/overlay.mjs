// Üst pencere gerçekten açılıyor mu, tıklamayı geçiriyor mu, sesten çıkınca kayboluyor mu.
import {_electron as electron} from 'playwright-core'
import path from 'node:path'

const dir = path.resolve('desktop')
const app = await electron.launch({executablePath: path.join(dir, 'node_modules/electron/dist/electron.exe'), args: [dir], cwd: dir, env: {...process.env, TELSIZ_URL: 'http://localhost:4173/'}})
const w = await app.firstWindow()
w.on('pageerror', e => console.log('ERR', e.message))
await w.waitForFunction(() => window.telsiz)
if (!(await w.evaluate(() => window.telsiz.me.name))) {
  await w.getByLabel('Takma adın').fill('Masaustu')
  await w.getByRole('button', {name: 'Devam'}).click()
}
if (!(await w.evaluate(() => window.telsiz.groups.length))) await w.getByRole('button', {name: 'Kur'}).click()
const state = () => app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().filter(b => b.webContents.getURL().endsWith('overlay.html')).map(b => ({visible: b.isVisible(), top: b.isAlwaysOnTop(), focusable: b.isFocusable(), bounds: b.getBounds()})))
console.log('once', await state())
await w.evaluate(() => window.telsiz.joinVoice())
await w.waitForTimeout(1500)
console.log('seste', await state())
const pages = app.windows()
const o = pages.find(p => p.url().endsWith('overlay.html'))
console.log('liste', await o?.evaluate(() => document.getElementById('list').innerText))
await o?.screenshot({path: 'e2e/out/overlay.png'})
await w.evaluate(() => window.telsiz.leaveVoice())
await w.waitForTimeout(800)
console.log('cikis', await state())
await app.evaluate(({app}) => app.exit(0))
