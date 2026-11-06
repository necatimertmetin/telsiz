// Windows uygulaması yayıncı, karşıda gerçek tarayıcı: ekran yayını hangi kodekle ve kaç pikselde gidiyor.
import {_electron as electron, chromium} from 'playwright-core'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const URL = process.env.URL ?? 'http://localhost:4173/'
const dir = path.resolve('desktop')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-kalite-'))
const app = await electron.launch({executablePath: path.join(dir, 'node_modules/electron/dist/electron.exe'), args: [dir, `--user-data-dir=${data}`], cwd: dir, env: {...process.env, TELSIZ_URL: URL}})
const w = await app.firstWindow()
await w.waitForFunction(() => window.telsiz)
await w.getByLabel('Takma adın').fill('Mert')
await w.getByRole('button', {name: 'Devam'}).click()
await w.getByLabel('Grup adı').fill('Kalite')
await w.getByRole('button', {name: 'Kur'}).click()
const code = await w.evaluate(() => window.telsiz.active)
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const p = await (await browser.newContext()).newPage()
await p.goto(URL)
await p.getByLabel('Takma adın').fill('Ali')
await p.getByRole('button', {name: 'Devam'}).click()
await p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await p.getByRole('button', {name: 'Katıl'}).click()
await w.waitForFunction(() => window.telsiz.session.peers.size === 1, null, {timeout: 60000})
for (const x of [w, p]) await x.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
// Gerçek akış: düğmeye basılır, sesli seçim baştan açıktır, kaynak seçilir.
await w.getByRole('button', {name: 'Ekran paylaş'}).click()
await w.getByRole('button', {name: 'Sesli', exact: true}).waitFor({timeout: 8000})
console.log(await w.getByRole('button', {name: 'Sesli', exact: true}).getAttribute('aria-pressed') === 'true' ? 'OK   sesli seçim açık geliyor' : 'FAIL sesli seçim kapalı')
await w.locator('.sources button').first().click()
await w.waitForFunction(() => window.telsiz.call.streams.screen, null, {timeout: 15000})
await p.waitForFunction(() => [...window.telsiz.call.remote.values()].some(r => r.screen?.getAudioTracks().length), null, {timeout: 20000})
console.log('OK   izleyiciye ses izi ulaştı')
await p.locator('.tilestat').waitFor({timeout: 12000})
await new Promise(r => setTimeout(r, 4000))
console.log('izleyici gösterge:', await p.locator('.tilestat').innerText())
await w.waitForTimeout(9000)
const out = await w.evaluate(async () => {
  const res = []
  for (const pc of Object.values(window.telsiz.session.room.getPeers())) { const rep = await pc.getStats(); rep.forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video' && r.frameWidth) res.push({codec: rep.get(r.codecId)?.mimeType, enc: r.encoderImplementation, w: r.frameWidth, h: r.frameHeight, limit: r.qualityLimitationReason}) }) }
  return res
})
console.log(JSON.stringify(out))
console.log(out.some(o => /H264|VP9/.test(o.codec) && o.h >= 1000) ? 'TAMAM' : 'BAŞARISIZ')
await browser.close()
await app.close().catch(() => {})
