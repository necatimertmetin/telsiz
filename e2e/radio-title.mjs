// Radyoda çalan şarkı adı: tarayıcıda izin veren gerçek bir yayınla (Radyo Seymen) dener. İnternet gerekir.
// Uygulamalarda (Windows, Android) aynı ad yerel kodla okunur; o yol burada sınanmaz.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const b = await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']})
const p = await (await b.newContext({viewport: {width: 1300, height: 850}})).newPage()
p.on('pageerror', e => check(false, 'sayfa hatası: ' + e.message))
await p.goto(URL)
await p.getByLabel('Takma adın').fill('Mert')
await p.getByRole('button', {name: 'Devam'}).click()
await p.getByLabel('Grup adı').fill('Radyo')
await p.getByRole('button', {name: 'Kur'}).click()
const q = new URLSearchParams({name: 'Radyo Seymen', hidebroken: 'true', is_https: 'true', limit: '5'})
const st = (await (await fetch('https://de1.api.radio-browser.info/json/stations/search?' + q)).json()).find(x => x.hls !== 1)
check(!!st, 'Radyo Seymen listede bulundu')
const rid = await p.evaluate(u => {
  const s = window.telsiz.session
  const rid = s.makeRoom('Radyo', 'radio')
  s.addStation({title: 'Seymen', url: u, tag: ''})
  return rid
}, st.url_resolved)
await p.waitForFunction(() => window.telsiz.session.view.stations.length === 1 && window.telsiz.session.view.rooms.some(r => r.kind === 'radio'))
await p.evaluate(() => { const s = window.telsiz.session; const r = s.view.rooms.find(x => x.kind === 'radio'); s.tune(r.id, s.view.stations[0].id); return window.telsiz.joinVoice(false, false, r.id) })
await p.evaluate(() => { const r = window.telsiz.session.view.rooms.find(x => x.kind === 'radio'); return window.telsiz.enterRoom(r.id) })
await p.getByText('Grubun radyoları').waitFor({timeout: 15000})
const song = await p.locator('.radiosong').innerText({timeout: 30000}).catch(() => '')
check(song.length > 3, `çalan şarkı görünüyor: "${song}"`)
await p.screenshot({path: 'e2e/out/radio-title.png'})
void rid
await b.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
