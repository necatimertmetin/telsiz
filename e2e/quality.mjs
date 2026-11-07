// Ekran yayını kalitesi: hareketli 1080p60 kaynak, gerçek WebRTC, 1 ve 3 izleyici. Çevreyi değil kodlayıcıyı ölçer.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const Q = process.env.Q ?? '1080p60'
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const CODEC = process.env.CODEC ?? '', HINT = process.env.HINT ?? ''
const mock = `
if ('${CODEC}') {
  const add = RTCPeerConnection.prototype.addTrack
  RTCPeerConnection.prototype.addTrack = function (t, ...r) {
    const s = add.call(this, t, ...r)
    if (t.kind === 'video') { const x = this.getTransceivers().find(y => y.sender === s), c = RTCRtpSender.getCapabilities('video').codecs; x.setCodecPreferences([...c.filter(k => k.mimeType === 'video/${CODEC}'), ...c.filter(k => k.mimeType !== 'video/${CODEC}')]) }
    return s
  }
}
navigator.mediaDevices.getDisplayMedia = async () => {
  const can = Object.assign(document.createElement('canvas'), {width: 1920, height: 1080}), x = can.getContext('2d')
  let i = 0
  const draw = () => { i++
    for (let a = 0; a < 90; a++) { x.fillStyle = 'hsl(' + ((a * 37 + i * 3) % 360) + ' 70% ' + (30 + a % 40) + '%)'; x.fillRect((a * 211 + i * 13) % 1920, (a * 131 + i * 7) % 1080, 260, 200) }
    x.fillStyle = '#fff'; x.font = '26px sans-serif'; for (let l = 0; l < 30; l++) x.fillText('Kill feed yazisi ' + (l + i), (l * 97 + i * 5) % 1500, l * 36) }
  setInterval(draw, 16); draw()
  return can.captureStream(60)
}`
const open = async name => {
  const p = await (await browser.newContext()).newPage()
  await p.addInitScript(mock)
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const a = await open('Mert')
await a.getByLabel('Grup adı').fill('Kalite')
await a.getByRole('button', {name: 'Kur'}).click()
const code = await a.evaluate(() => window.telsiz.active)
await a.evaluate(q => { window.telsiz.prefs.screenQ = q; window.telsiz.savePrefs() }, Q)
const join = async name => {
  const p = await open(name)
  await p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
  await p.getByRole('button', {name: 'Katıl'}).click()
  await p.waitForFunction(() => window.telsiz.session.peers.size >= 1, null, {timeout: 60000})
  const host = await a.evaluate(() => window.telsiz.me.uid)
  await p.waitForFunction(h => [...window.telsiz.session.peers.values()].some(q => q.uid === h), host, {timeout: 60000})
  await p.evaluate(async h => { window.telsiz.go({kind: 'voice'}); await window.telsiz.joinVoice(); window.telsiz.call.watch(h, true) }, host)
  return p
}
const first = await join('Ali')
await a.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
await a.evaluate(h => window.telsiz.call.toggleScreen(false).then(() => { if (h) window.telsiz.call.streams.screen.getVideoTracks()[0].contentHint = h }), HINT)

const sample = () => a.evaluate(async () => {
  const out = []
  for (const pc of Object.values(window.telsiz.session.room.getPeers())) {
    const snap = async () => { const m = new Map(); (await pc.getStats()).forEach(r => { if (r.type === 'outbound-rtp' && r.kind === 'video') m.set(r.id, r) }); return [m, await pc.getStats()] }
    const [b] = await snap(); await new Promise(r => setTimeout(r, 2000)); const [c, rep] = await snap()
    for (const [id, r] of c) {
      const o = b.get(id); if (!o || !r.frameWidth) continue
      out.push({codec: rep.get(r.codecId)?.mimeType, enc: r.encoderImplementation, w: r.frameWidth, h: r.frameHeight, fps: r.framesPerSecond, mbps: +((r.bytesSent - o.bytesSent) * 8 / 2e6).toFixed(2), limit: r.qualityLimitationReason, msPerFrame: +(((r.totalEncodeTime - o.totalEncodeTime) / Math.max(1, r.framesEncoded - o.framesEncoded)) * 1000).toFixed(1)})
    }
  }
  return out
})
await new Promise(r => setTimeout(r, 14000))
console.log('1 izleyici', JSON.stringify(await sample()))
const more = [await join('Veli'), await join('Ayse')]
await a.waitForFunction(() => window.telsiz.session.peers.size === 3, null, {timeout: 60000})
await new Promise(r => setTimeout(r, 16000))
const three = await sample()
console.log('3 izleyici', JSON.stringify(three))
console.log(three.length === 3 && three.every(x => x.mbps < 3.6) ? 'OK   3 izleyicide kişi başı ~3 Mb/sn' : 'FAIL 3 izleyici bütçesi')
await browser.close()
