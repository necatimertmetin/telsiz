// Ekran sesi ve efekt düzeyi. Ekran sesi taklit kaynaktan gerçek WebRTC ile geçip karşıda ölçülür.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const mock = `
navigator.mediaDevices.getDisplayMedia = async () => {
  const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(), d = c.createMediaStreamDestination()
  g.gain.value = window.__amp; o.connect(g).connect(d); o.start(); window.__src = g
  const can = Object.assign(document.createElement('canvas'), {width: 320, height: 180})
  setInterval(() => can.getContext('2d').fillRect(Math.random() * 300, 0, 9, 9), 100)
  const s = can.captureStream(10); s.addTrack(d.stream.getAudioTracks()[0]); window.__raw = d.stream.getAudioTracks()[0]; return s
}
window.__amp = .1`
const open = async name => {
  const p = await (await browser.newContext()).newPage()
  await p.addInitScript(mock)
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
await a.evaluate(() => window.telsiz.call.toggleScreen(true))
await b.waitForFunction(() => [...window.telsiz.call.remote.values()].some(r => r.screen?.getAudioTracks().length), null, {timeout: 20000})
const peak = () => b.evaluate(async () => {
  const st = [...window.telsiz.call.remote.values()].find(r => r.screen).screen
  const c = new AudioContext(), an = c.createAnalyser(); an.fftSize = 2048
  c.createMediaStreamSource(st).connect(an)
  const buf = new Float32Array(2048); let max = 0, sum = 0, n = 0
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 50)); an.getFloatTimeDomainData(buf); for (const v of buf) { max = Math.max(max, Math.abs(v)); sum += v * v; n++ } }
  await c.close()
  return {max, rms: Math.sqrt(sum / n)}
})
await new Promise(r => setTimeout(r, 2500))
const low = await peak()
console.log('kısık kaynak 0.10 →', low)
check(low.max > .2, 'kısık sistem sesi en az iki kat yükseliyor')
await a.evaluate(() => { window.__src.gain.value = .95 })
await new Promise(r => setTimeout(r, 1500))
const high = await peak()
console.log('yüksek kaynak 0.95 →', high)
check(high.max <= 1.01, 'yüksek ses patlamıyor')

// Yayıncı ve izleyici ayarı: düğmeler görünür, yayıncınınki gerçekten giden sesi değiştirir.
await a.evaluate(() => { window.__src.gain.value = .1 })
await a.locator('input[aria-label="Yayın ses düzeyi"]').waitFor({timeout: 5000})
check(await a.getByLabel('Yayın ses düzeyi').isVisible(), 'yayıncı ayarı görünüyor')
await a.getByLabel('Yayın ses düzeyi').fill('0.25')
await new Promise(r => setTimeout(r, 1500))
const less = await peak()
console.log('yayıncı %25 →', less)
check(less.max < low.max * .5, 'yayıncı kısınca karşıda ses düşüyor')
await a.getByLabel('Yayın ses düzeyi').fill('1')
check(await b.getByLabel('Mert ekran sesi').isVisible(), 'izleyici ayarı görünüyor')
await b.getByLabel('Mert ekran sesi').fill('0.3')
check(await b.evaluate(() => [...document.querySelectorAll('video')].some(v => !v.muted && Math.abs(v.volume - .3) < .01)), 'izleyici kısınca oynatıcı düşüyor')
check(await b.getByText('Ses %30').isVisible(), 'yüzde yazıyor')
await a.screenshot({path: 'e2e/out/screen-vol.png'})

await a.evaluate(() => {
  window.__gains = []
  const f = AudioParam.prototype.setValueAtTime
  AudioParam.prototype.setValueAtTime = function (v, t) { window.__gains.push(v); return f.call(this, v, t) }
  for (const id of ['bomb', 'ding', 'noob']) window.telsiz.sendSfx(id)
})
await new Promise(r => setTimeout(r, 300))
const sfx = await a.evaluate(() => Math.max(...window.__gains))
console.log('efekt tepe', sfx)
check(sfx >= .2, 'efekt eski 0.06 düzeyinin en az üç katı')

await a.evaluate(() => window.telsiz.call.toggleScreen())
check(await a.evaluate(() => window.__raw.readyState) === 'ended', 'yayın kapanınca ham ses de kapanıyor')
await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
