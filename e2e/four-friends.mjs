// Dört ayrı tarayıcı profili, gerçek sinyal röleleri ve gerçek WebRTC ile uçtan uca sınama.
// Kullanım: önce `npx vite preview --port 4173`, sonra `node e2e/four-friends.mjs`
import {chromium} from 'playwright-core'
import {writeFileSync, mkdirSync} from 'node:fs'

const URL = process.env.URL ?? 'http://localhost:4173/'
const NAMES = ['Mert', 'Ali', 'Veli', 'Can']
mkdirSync('e2e/out', {recursive: true})
const big = 'e2e/out/demo.dem'
writeFileSync(big, Buffer.alloc(40 * 1024 * 1024, 7)) // 40 MB: elle indirilmesi gereken sınırın üstü

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
})
// Chrome'un sahte kamerası bu ortamda kendiliğinden 'ended' oluyor (uygulamasız yalın getUserMedia'da da).
// Görüntü hattını sınamak için kamera yerine hareketli canvas veriyoruz.
const fakeCam = () => {
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = async c => {
    if (!c.video) return real(c)
    const cv = Object.assign(document.createElement('canvas'), {width: 640, height: 360})
    const x = cv.getContext('2d'); let i = 0
    setInterval(() => { x.fillStyle = `hsl(${i++ * 7 % 360} 80% 50%)`; x.fillRect(0, 0, 640, 360) }, 40)
    return cv.captureStream(24)
  }
}
const pass = (m) => console.log('OK  ', m)
const fail = (m) => { console.log('FAIL', m); process.exitCode = 1 }
const check = (c, m) => c ? pass(m) : fail(m)

const users = []
for (const name of NAMES) {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}})
  const page = await ctx.newPage()
  await page.addInitScript(fakeCam)
  page.on('pageerror', e => fail(`${name} sayfa hatası: ${e.message}`))
  await page.goto(URL)
  await page.getByLabel('Takma adın').fill(name)
  await page.getByRole('button', {name: 'Devam'}).click()
  users.push({name, ctx, page})
}
const [a, b, c, d] = users

await a.page.getByLabel('Grup adı').fill('Hafta Sonu CS')
await a.page.getByRole('button', {name: 'Kur'}).click()
const code = await a.page.evaluate(() => window.telsiz.active)
await a.page.getByRole('textbox', {name: 'Mesaj'}).fill('ilk mesaj, herkes gelmeden')
await a.page.keyboard.press('Enter')
for (const u of [b, c]) {
  await u.page.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
  await u.page.getByRole('button', {name: 'Katıl'}).click()
}
const t0 = Date.now()
const peers = (u) => u.page.evaluate(() => window.telsiz.session?.peers.size ?? 0)
const waitFor = async (fn, ms, label) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 250)) }
  fail(label)
  return false
}
if (await waitFor(async () => (await peers(a)) === 2 && (await peers(b)) === 2, 45000, 'üç kişi bağlanamadı')) pass(`üç kişi ${((Date.now() - t0) / 1000).toFixed(1)} sn içinde bağlandı`)

await waitFor(() => b.page.getByText('ilk mesaj, herkes gelmeden').isVisible(), 8000, 'geç gelen eski mesajı alamadı') && pass('geç gelen eski mesajı aldı')
await waitFor(async () => (await c.page.evaluate(() => window.telsiz.session.view.title)) === 'Hafta Sonu CS', 5000, 'grup adı eşitlenmedi') && pass('grup adı eşitlendi')

await b.page.getByRole('textbox', {name: 'Mesaj'}).fill('naber')
await b.page.keyboard.press('Enter')
await waitFor(() => a.page.locator('.txt', {hasText: 'naber'}).isVisible(), 5000, 'canlı mesaj gelmedi') && pass('canlı mesaj geldi')

// Dördüncü kişi: anlık bağlanır, küçük resim ve büyük dosya
await d.page.getByLabel('Davet linki ya da kod').fill(code)
await d.page.getByRole('button', {name: 'Katıl'}).click()
await waitFor(async () => (await peers(d)) === 3, 45000, 'dördüncü kişi bağlanamadı') && pass('dört kişi tam örgü bağlı')

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
await a.page.locator('input[type=file]').setInputFiles({name: 'nade.png', mimeType: 'image/png', buffer: png})
await waitFor(() => d.page.locator('img[alt="nade.png"]').isVisible(), 10000, 'küçük resim otomatik gelmedi') && pass('küçük resim otomatik geldi ve önizlendi')

await a.page.locator('input[type=file]').setInputFiles(big)
await waitFor(() => c.page.getByText('demo.dem').isVisible(), 8000, 'büyük dosya mesajı gelmedi')
const t1 = Date.now()
await c.page.locator('.filecard', {hasText: 'demo.dem'}).getByRole('button', {name: 'İndir'}).click()
const ok = await waitFor(async () => (await c.page.locator('.filecard', {hasText: 'demo.dem'}).innerText()).includes('Hazır'), 60000, '40 MB dosya inmedi')
if (ok) {
  const size = await c.page.evaluate(async () => {
    const s = window.telsiz.session
    const f = [...s.view.byId.values()].find(m => m.file?.name === 'demo.dem').file
    const b = await s.getBlob(f)
    const u = new Uint8Array(await b.slice(b.size - 1024).arrayBuffer())
    return {size: b.size, intact: u.every(x => x === 7)}
  })
  check(size.size === 40 * 1024 * 1024 && size.intact, `40 MB dosya bozulmadan indi (${((Date.now() - t1) / 1000).toFixed(1)} sn)`)
}

// GIF, sesli mesaj, özel sohbet, görüldü
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
await a.page.locator('input[type=file]').setInputFiles({name: 'komik.gif', mimeType: 'image/gif', buffer: gif})
await waitFor(() => d.page.locator('img[alt="komik.gif"]').isVisible(), 8000, 'GIF gösterilmedi') && pass('GIF gruba düştü ve gösterildi')
await b.page.getByRole('button', {name: 'Ses kaydet'}).click()
await new Promise(r => setTimeout(r, 1500))
await b.page.getByRole('button', {name: 'Kaydı gönder'}).click()
await waitFor(() => a.page.locator('.chat audio').count().then(n => n > 0), 8000, 'sesli mesaj gelmedi') && pass('sesli mesaj geldi ve oynatıcı çıktı')
const {dmCh, text} = await a.page.evaluate(([n]) => {
  const s = window.telsiz.session, uid = [...s.peers.values()].find(p => p.name === n).uid
  const dmCh = 'dm:' + [window.telsiz.me.uid, uid].sort().join(':')
  s.sendText(dmCh, 'bu sadece sana')
  return {dmCh, text: 'bu sadece sana'}
}, ['Ali'])
const has = (u) => u.page.evaluate(t => [...window.telsiz.session.view.byId.values()].some(m => m.text === t), text)
await waitFor(() => has(b), 5000, 'özel mesaj karşıya gitmedi') && pass('özel mesaj karşıya gitti')
await new Promise(r => setTimeout(r, 1500))
check(!(await has(c)) && !(await has(d)), 'özel mesaj gruptaki diğerlerine gitmedi')
await a.page.evaluate(ch => window.telsiz.go({kind: 'text', ch}), dmCh)
await b.page.evaluate(ch => window.telsiz.go({kind: 'text', ch}), dmCh)
await waitFor(() => a.page.getByText('Görüldü: Ali').isVisible(), 5000, 'görüldü bilgisi gelmedi') && pass('görüldü bilgisi geldi')
await a.page.evaluate(() => window.telsiz.go({kind: 'text', ch: 'genel'}))
await b.page.evaluate(() => window.telsiz.go({kind: 'text', ch: 'genel'}))

// Yedek kodu: yeni profil aynı kimlik ve grupla dönüyor, geçmiş arkadaştan iniyor
const backup = await b.page.evaluate(() => window.telsiz.backupCode())
const bUid = await b.page.evaluate(() => window.telsiz.me.uid)
const rctx = await browser.newContext({viewport: {width: 1280, height: 800}})
const rp = await rctx.newPage()
await rp.goto(URL)
await rp.getByRole('button', {name: /yedek kodum var/}).click()
await rp.getByLabel('Yedek kodu').fill(backup)
await rp.getByRole('button', {name: 'Geri yükle'}).click()
await waitFor(() => rp.getByText('ilk mesaj, herkes gelmeden').isVisible().catch(() => false), 30000, 'yedekten dönen geçmişi alamadı') && pass('yedek kodu yeni cihazda kimliği, grubu ve geçmişi geri getirdi')
check(await rp.evaluate(() => window.telsiz.me.uid) === bUid, 'kimlik aynı kaldı')
check(await waitFor(() => rp.evaluate(() => [...window.telsiz.session.view.byId.values()].some(m => m.text === 'bu sadece sana')), 8000, 'özel sohbet yedekle dönmedi'), 'özel sohbet de geri geldi')
await rctx.close()

// Arama ve sabitleme
await a.page.getByRole('button', {name: 'Ara', exact: true}).click()
await a.page.getByLabel('Mesajlarda ara').fill('naber')
await new Promise(r => setTimeout(r, 200))
check(await a.page.locator('.msg').count() === 1, 'arama tek sonucu buldu')
await a.page.getByRole('button', {name: 'Ara', exact: true}).click()
await a.page.evaluate(() => { const s = window.telsiz.session; s.emit({t: 'pin', target: [...s.view.byId.values()].find(m => m.text === 'naber').id, on: true}) })
await waitFor(() => b.page.locator('.pinbar').isVisible(), 5000, 'sabit mesaj gelmedi') && pass('sabit mesaj herkese göründü')

// Ses ve görüntü
await a.page.getByRole('button', {name: 'Telsiz odası'}).click()
await a.page.getByRole('button', {name: 'Sesli katıl'}).last().click()
for (const u of [b, c, d]) {
  await u.page.getByRole('button', {name: 'Telsiz odası'}).click()
  await u.page.getByRole('button', {name: 'Görüntülü katıl'}).last().click()
}
const remotes = (u) => u.page.evaluate(() => {
  const c = window.telsiz.call
  return {mic: [...c.remote.values()].filter(r => r.mic).length, cam: [...c.remote.values()].filter(r => r.cam).length}
})
await waitFor(async () => {
  const r = await Promise.all(users.map(remotes))
  return r.every(x => x.mic === 3) && r[0].cam === 3 && r[1].cam === 2
}, 30000, `ses/görüntü örgüsü kurulamadı: ${JSON.stringify(await Promise.all(users.map(remotes)))}`) && pass('4 kişi herkes herkesi duyuyor, 3 kamera akıyor')

await new Promise(r => setTimeout(r, 4000))
// Bitler gerçekten akıyor mu ve video kareleri çözülüyor mu
const flow = await a.page.evaluate(async () => {
  const out = {audioIn: 0, videoIn: 0, frames: 0, audioOut: 0}
  for (const pc of Object.values(window.telsiz.session.room.getPeers())) {
    (await pc.getStats()).forEach(x => {
      if (x.type === 'inbound-rtp' && x.kind === 'audio') out.audioIn += x.bytesReceived
      if (x.type === 'inbound-rtp' && x.kind === 'video') { out.videoIn += x.bytesReceived; out.frames += x.framesDecoded }
      if (x.type === 'outbound-rtp' && x.kind === 'audio') out.audioOut += x.bytesSent
    })
  }
  return out
})
console.log('     akış', flow)
const sample = () => a.page.evaluate(async () => {
  let sent = 0, jb = 0, em = 0, rtt = 0
  for (const pc of Object.values(window.telsiz.session.room.getPeers()))
    (await pc.getStats()).forEach(x => {
      if (x.type === 'outbound-rtp' && x.kind === 'audio') sent = x.packetsSent
      if (x.type === 'inbound-rtp' && x.kind === 'audio') { jb += x.jitterBufferDelay; em += x.jitterBufferEmittedCount }
      if (x.type === 'candidate-pair' && x.nominated) rtt = x.currentRoundTripTime
    })
  return {sent, jb, em, rtt}
})
const s1 = await sample(); await new Promise(r => setTimeout(r, 3000)); const s2 = await sample()
const pps = (s2.sent - s1.sent) / 3
console.log(`     ses paketi ${pps.toFixed(0)}/sn (~${(1000 / pps).toFixed(0)} ms), jitter tamponu ${((s2.jb - s1.jb) / (s2.em - s1.em) * 1000).toFixed(0)} ms`)
check(pps > 80, 'ses 10 ms paketle gidiyor')
check(flow.audioIn > 5000 && flow.audioOut > 1000, 'ses paketleri iki yönde akıyor')
check(flow.frames > 20, 'video kareleri çözülüyor')
const vids = await a.page.locator('.tile video').evaluateAll(v => v.map(x => x.videoWidth))
check(vids.filter(w => w > 0).length === 3, `arayüzde 3 kamera görünüyor (${vids})`)

await a.page.getByRole('button', {name: 'Mikrofon seç'}).click()
await new Promise(r => setTimeout(r, 300))
check(await a.page.getByRole('menuitemradio').count() >= 2, 'mikrofon menüsü cihazları listeliyor')
await a.page.screenshot({path: 'e2e/out/call-desktop.png'})
await a.page.locator('.menuscrim').click({position: {x: 5, y: 5}})
await b.page.getByRole('button', {name: 'Kamera seç'}).click()
await b.page.getByRole('menuitemradio').last().click()
await new Promise(r => setTimeout(r, 1000))
check(await b.page.evaluate(() => window.telsiz.call.streams.cam?.getVideoTracks()[0]?.readyState === 'live'), 'görüşme sırasında kamera değişti')

// Sustur durumu karşıya yansır, çıkan kişi düşer
await b.page.getByRole('button', {name: 'Mikrofon', exact: true}).last().click()
await waitFor(() => a.page.evaluate(() => [...window.telsiz.session.peers.values()].some(p => p.voice.muted)), 4000, 'susturma yansımadı') && pass('susturma karşıya yansıdı')
await d.page.getByRole('button', {name: 'Çık', exact: true}).click()
await waitFor(async () => (await remotes(a)).mic === 2, 6000, 'çıkan kişi düşmedi') && pass('sesten çıkan düştü, yazıda kaldı')

// Çevrimdışıyken yazılan mesaj: sayfa yenilenince geçmiş korunur
await c.page.reload()
await c.page.getByRole('button', {name: /genel/}).click()
await waitFor(() => c.page.locator('.txt', {hasText: 'naber'}).isVisible(), 8000, 'yenilemede geçmiş gitti') && pass('yenileme sonrası geçmiş duruyor')

// Mobil görünüm
const m = await browser.newContext({viewport: {width: 375, height: 760}, hasTouch: true, isMobile: true})
const p = await m.newPage()
await p.goto(URL + `#/katil/${code}`)
await p.getByLabel('Takma adın').fill('Telefon')
await p.getByRole('button', {name: 'Devam'}).click()
await waitFor(() => p.evaluate(() => (window.telsiz.session?.peers.size ?? 0) >= 2), 45000, 'mobil davet linkiyle giremedi') && pass('davet linkiyle mobil girdi')
await waitFor(() => p.locator('.txt', {hasText: 'naber'}).isVisible(), 8000, 'mobil geçmiş yok')
check(await p.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'mobilde yatay taşma yok')
await p.screenshot({path: 'e2e/out/mobile-chat.png'})
await p.getByRole('textbox', {name: 'Mesaj'}).fill('silinecek mesaj')
await p.keyboard.press('Enter')
await waitFor(() => a.page.evaluate(() => [...window.telsiz.session.view.byId.values()].some(m => m.text === 'silinecek mesaj')), 6000, 'silinecek mesaj gelmedi')
p.on('dialog', d => d.accept())
await p.getByText('silinecek mesaj').tap()
await p.getByRole('button', {name: 'Sil', exact: true}).tap()
await waitFor(() => a.page.evaluate(() => ![...window.telsiz.session.view.byId.values()].some(m => m.text === 'silinecek mesaj')), 6000, 'silme karşıya yansımadı') && pass('telefonda dokunup silindi, herkesten gitti')
await p.evaluate(() => { for (let i = 0; i < 80; i++) window.telsiz.session.sendText('genel', 'uzun sohbet ' + i) })
await new Promise(r => setTimeout(r, 600))
const fits = () => p.evaluate(() => {
  const l = document.querySelector('.log'), c = document.querySelector('.composer').getBoundingClientRect()
  return {page: document.documentElement.scrollHeight === innerHeight, scrolls: l.scrollHeight > l.clientHeight, composer: c.bottom <= innerHeight, bottom: l.scrollHeight - l.scrollTop - l.clientHeight < 5}
})
const f = await fits()
check(f.page && f.scrolls && f.composer && f.bottom, `uzun sohbette sayfa taşmıyor, kaydırma çalışıyor ${JSON.stringify(f)}`)
await p.getByRole('button', {name: 'Menü'}).click()
await new Promise(r => setTimeout(r, 300))
await p.screenshot({path: 'e2e/out/mobile-drawer.png'})
await a.page.getByRole('button', {name: /genel/}).click()
await new Promise(r => setTimeout(r, 300))
await a.page.screenshot({path: 'e2e/out/chat-desktop.png'})

await browser.close()
process.exit(process.exitCode ?? 0)
