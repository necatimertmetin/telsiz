// Windows uygulaması arkadayken gelen mesaj bildirim sesi çalmalı. Gerçek Electron, karşıda gerçek tarayıcı.
import {_electron as electron, chromium} from 'playwright-core'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const dir = path.resolve('desktop')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-ses-'))
const app = await electron.launch({executablePath: path.join(dir, 'node_modules/electron/dist/electron.exe'), args: [dir, `--user-data-dir=${data}`], cwd: dir, env: {...process.env, TELSIZ_URL: URL}})
const w = await app.firstWindow()
await w.waitForFunction(() => window.telsiz)
// Playwright odağı taklit eder, gerçek odak görülsün diye kapatılır.
await (await w.context().newCDPSession(w)).send('Emulation.setFocusEmulationEnabled', {enabled: false})
await w.evaluate(() => { const A = window.AudioContext; window.__sounds = 0; window.AudioContext = class extends A { constructor(...a) { super(...a); window.__sounds++; setTimeout(() => { window.__state = this.state }, 100) } } })
await w.getByLabel('Takma adın').fill('Mert')
await w.getByRole('button', {name: 'Devam'}).click()
await w.getByLabel('Grup adı').fill('Ses')
await w.getByRole('button', {name: 'Kur'}).click()
const code = await w.evaluate(() => window.telsiz.active)

const browser = await chromium.launch({channel: 'chrome', headless: true})
const p = await (await browser.newContext()).newPage()
await p.goto(URL)
await p.getByLabel('Takma adın').fill('Ali')
await p.getByRole('button', {name: 'Devam'}).click()
await p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await p.getByRole('button', {name: 'Katıl'}).click()
await w.waitForFunction(() => window.telsiz.session.peers.size === 1, null, {timeout: 60000})

const say = async text => {
  const before = await w.evaluate(() => window.__sounds)
  await p.evaluate(t => window.telsiz.session.sendText('genel', t), text)
  await w.waitForFunction(t => (window.telsiz.session.view.msgs.get('genel') ?? []).some(m => m.text === t), text, {timeout: 15000})
  await w.waitForTimeout(400)
  return (await w.evaluate(() => window.__sounds)) - before
}
const win = f => app.evaluate(({BrowserWindow}, f) => { const b = BrowserWindow.getAllWindows().find(x => x !== globalThis.other && x.webContents.getURL().startsWith('http')); return new Function('b', f)(b) }, f)
const look = () => w.evaluate(() => ({hidden: document.hidden, focus: document.hasFocus()}))

await win('b.show(); b.focus()')
await w.waitForTimeout(500)
console.log('önde', await look())
check(await say('onde') === 0, 'pencere öndeyken ve kanal açıkken ses yok')

// Gerçek durum: başka bir pencere öne geçer.
await app.evaluate(({BrowserWindow}) => { const o = new BrowserWindow({width: 300, height: 200, title: 'baska'}); o.show(); o.focus(); globalThis.other = o })
await w.waitForTimeout(800)
console.log('arkada', await look())
check(await say('arkada') === 1, 'pencere arkadayken ses çaldı')

await app.evaluate(() => globalThis.other.destroy())
await win('b.show(); b.focus()')
await w.waitForTimeout(500)
console.log('dönüş', await look())
check(await w.evaluate(() => window.telsiz.session.view.msgs.get('genel').length) === 2, 'mesajlar duruyor')

await win('b.minimize()')
await w.waitForTimeout(500)
console.log('küçük', await look())
check(await say('kucuk') === 1, 'simge durumundayken ses çaldı')

await win('b.hide()')
await w.waitForTimeout(500)
console.log('tepsi', await look())
check(await say('tepsi') === 1, 'tepsideyken ses çaldı')

check(await w.evaluate(() => window.__state) === 'running', 'ses gerçekten akıyor, askıda değil')

await browser.close()
await app.close().catch(() => {})
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
