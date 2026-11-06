// Seçilen mikrofon gerçekten açılan mikrofon mu? Gerçek cihazlarla, ses çıkarmadan bakar.
import {_electron as electron} from 'playwright-core'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const dir = path.resolve('desktop')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-mik-'))
const app = await electron.launch({executablePath: path.join(dir, 'node_modules/electron/dist/electron.exe'), args: [dir, `--user-data-dir=${data}`], cwd: dir, env: {...process.env, TELSIZ_URL: process.env.URL ?? 'http://localhost:4173/'}})
const w = await app.firstWindow()
await w.waitForFunction(() => window.telsiz)
await w.getByLabel('Takma adın').fill('Mert')
await w.getByRole('button', {name: 'Devam'}).click()
await w.getByLabel('Grup adı').fill('Mik')
await w.getByRole('button', {name: 'Kur'}).click()
const pick = async (label, n) => w.evaluate(async ({label, n}) => {
  (await navigator.mediaDevices.getUserMedia({audio: true})).getTracks().forEach(t => t.stop())
  const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.kind === 'audioinput' && x.label.startsWith(label) )
  window.telsiz.prefs.micId = n ?? d.deviceId; window.telsiz.savePrefs()
  window.telsiz.go({kind: 'voice'})
  await window.telsiz.joinVoice()
  const c = window.telsiz.call, r = {acilan: c.raw.label, sanal: c.virtualMic, islem: c.raw.getSettings().echoCancellation}
  window.telsiz.leaveVoice()
  return r
}, {label, n})
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const cable = await pick('CABLE Output')
console.log(cable)
check(cable.acilan.startsWith('CABLE Output') && cable.sanal, 'CABLE seçilince gerçekten CABLE açılıyor, sanal tanınıyor')
const mic = await pick('Mikrofon (SteelSeries')
console.log(mic)
check(mic.acilan.startsWith('Mikrofon (SteelSeries') && !mic.sanal, 'normal mikrofon normal açılıyor')
// Hatırlama: seçim yeniden açılışta kalır, kimlik değişse de addan bulunur.
await w.evaluate(async () => { const d = (await navigator.mediaDevices.enumerateDevices()).find(x => x.label.startsWith('CABLE Output')); await window.telsiz.setMic(d.deviceId) })
await w.reload()
await w.waitForFunction(() => window.telsiz?.session)
const back = await w.evaluate(async () => {
  window.telsiz.go({kind: 'voice'}); await window.telsiz.joinVoice()
  const l = window.telsiz.call.raw.label; window.telsiz.leaveVoice()
  window.telsiz.prefs.micId = 'eski-kimlik'; window.telsiz.savePrefs()
  await window.telsiz.joinVoice()
  const m = window.telsiz.call.raw.label; window.telsiz.leaveVoice()
  return {yeniden: l, eskiKimlik: m, kayit: window.telsiz.prefs.micLabel}
})
console.log(back)
check(back.yeniden.startsWith('CABLE Output'), 'yeniden açılınca seçim duruyor')
check(back.eskiKimlik.startsWith('CABLE Output'), 'kimlik değişse de aynı cihaz bulunuyor')
await w.evaluate(() => { window.telsiz.prefs.micLabel = ''; window.telsiz.savePrefs() })

const gone = await pick('', 'yok-olan-cihaz')
console.log(gone)
check(!!gone.acilan && !gone.sanal, 'cihaz çıkarılmışsa varsayılana dönüyor')
await app.close().catch(() => {})
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
