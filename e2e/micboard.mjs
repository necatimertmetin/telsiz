// Mikrofondan giren müzik gibi ses (Padoboard VB-Cable yolu) karşıya ne kadar ulaşıyor. Hangi işleme yiyor ölçer.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const WAV = process.env.WAV
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`, '--autoplay-policy=no-user-gesture-required']})
const force = process.env.FORCE ?? ''
const virt = process.env.VIRT === '1' ? `
const list = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
navigator.mediaDevices.enumerateDevices = async () => (await list()).map(d => d.kind === 'audioinput' && d.deviceId === 'default' ? {kind: d.kind, deviceId: d.deviceId, groupId: d.groupId, label: 'Default - CABLE Output (VB-Audio Virtual Cable)'} : d)
` : ''
const mock = virt + `const F = ${JSON.stringify(force ? JSON.parse(force) : null)}
if (F) { const g = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = c => g(c.audio ? {...c, audio: {...c.audio, ...F}} : c) }`
const open = async name => {
  const p = await (await browser.newContext()).newPage()
  await p.addInitScript(mock)
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const a = await open('Mert'), b = await open('Ali')
await a.getByLabel('Grup adı').fill('Pado')
await a.getByRole('button', {name: 'Kur'}).click()
const code = await a.evaluate(() => window.telsiz.active)
await a.evaluate(n => { window.telsiz.prefs.noise = n; window.telsiz.savePrefs() }, process.env.NOISE === '1')
await b.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await b.getByRole('button', {name: 'Katıl'}).click()
await a.waitForFunction(() => window.telsiz.session.peers.size === 1, null, {timeout: 60000})
for (const p of [a, b]) await p.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
await b.waitForFunction(() => [...window.telsiz.call.remote.values()].some(r => r.mic), null, {timeout: 20000})
await new Promise(r => setTimeout(r, 6000))
const m = await b.evaluate(async () => {
  const st = [...window.telsiz.call.remote.values()].find(r => r.mic).mic
  const c = new AudioContext(), an = c.createAnalyser(); an.fftSize = 2048
  c.createMediaStreamSource(st).connect(an)
  const buf = new Float32Array(2048); let max = 0, sum = 0, n = 0, silent = 0, frames = 0
  for (let i = 0; i < 160; i++) { await new Promise(r => setTimeout(r, 50)); an.getFloatTimeDomainData(buf); let e = 0; for (const v of buf) { max = Math.max(max, Math.abs(v)); sum += v * v; e += v * v; n++ } frames++; if (Math.sqrt(e / 2048) < .002) silent++ }
  await c.close()
  return {peak: +max.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4), sessizKare: silent + '/' + frames}
})
console.log(process.env.NAME ?? force, JSON.stringify(m))
await browser.close()
