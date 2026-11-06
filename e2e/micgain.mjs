// Görüşme menüsündeki mikrofon ve duyduğum ses çubukları, gerçek WebRTC üstünden ölçülür.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const wait = ms => new Promise(r => setTimeout(r, ms))
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${process.env.WAV}`, '--autoplay-policy=no-user-gesture-required']})
const open = async name => {
  const p = await (await browser.newContext()).newPage()
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const a = await open('Mert'), b = await open('Ali')
await a.getByLabel('Grup adı').fill('Ses')
await a.getByRole('button', {name: 'Kur'}).click()
const code = await a.evaluate(() => window.telsiz.active)
await b.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await b.getByRole('button', {name: 'Katıl'}).click()
await a.waitForFunction(() => window.telsiz.session.peers.size === 1, null, {timeout: 60000})
for (const p of [a, b]) await p.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
await b.waitForFunction(() => [...window.telsiz.call.remote.values()].some(r => r.mic), null, {timeout: 20000})
await wait(4000)
const level = () => b.evaluate(async () => {
  const st = [...window.telsiz.call.remote.values()].find(r => r.mic).mic
  const c = new AudioContext(), an = c.createAnalyser(); an.fftSize = 2048
  c.createMediaStreamSource(st).connect(an)
  const buf = new Float32Array(2048); let max = 0, sum = 0, n = 0
  for (let i = 0; i < 90; i++) { await new Promise(r => setTimeout(r, 50)); an.getFloatTimeDomainData(buf); for (const v of buf) { max = Math.max(max, Math.abs(v)); sum += v * v; n++ } }
  await c.close()
  return {peak: +max.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4)}
})
const base = await level()
console.log('%100', base)
check(await a.evaluate(() => !window.telsiz.call.micChain), '%100 de ses doğrudan gidiyor')
await a.getByRole('button', {name: 'Mikrofon seç'}).click()
await a.getByLabel('Mikrofon sesi').fill('2')
await wait(1200)
await a.screenshot({path: 'e2e/out/micgain.png'})
const up = await level()
console.log('%200', up)
check(up.rms > base.rms * 1.5, 'mikrofon yükseltilince karşıda ses artıyor')
await a.getByLabel('Mikrofon sesi').fill('3')
await wait(1200)
const top = await level()
console.log('%300', top)
check(top.peak <= 1.01, 'en yüksekte patlamıyor')
await a.getByLabel('Mikrofon sesi').fill('0.5')
await wait(1200)
const low = await level()
console.log('%50', low)
check(low.rms < base.rms * .75, 'kısılınca karşıda ses düşüyor')
check(await a.evaluate(() => window.telsiz.call.send.readyState === 'live' && window.telsiz.call.streams.mic.getAudioTracks().length === 1), 'tek canlı ses izi var')
await b.getByRole('button', {name: 'Ses çıkışı seç'}).click()
await b.getByLabel('Duyduğum ses').fill('0.4')
await wait(400)
check(await b.evaluate(() => [...window.telsiz.call.audios.values()].every(e => Math.abs(e.volume - .4) < .01)), 'duyduğum ses sesi kısıyor')
await b.reload()
await b.waitForFunction(() => window.telsiz?.prefs)
check(await b.evaluate(() => window.telsiz.prefs.outVol === .4), 'ayar hatırlanıyor')
await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
