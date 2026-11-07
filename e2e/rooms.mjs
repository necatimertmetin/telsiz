// Çoklu ses odaları, yetki tablosu, /takim ile odalara dağıtma, radyo odası.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const open = async name => {
  const p = await (await browser.newContext({viewport: {width: 1280, height: 800}, permissions: ['microphone', 'camera']})).newPage()
  p.on('pageerror', e => check(false, `${name} sayfa hatası: ${e.message}`))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const T = {timeout: 30000}
const peers = (p, n) => p.waitForFunction(x => window.telsiz.session?.peers.size === x, n, {timeout: 60000})
const uid = p => p.evaluate(() => window.telsiz.me.uid)
const micPeers = p => p.evaluate(() => [...window.telsiz.call.remote.values()].filter(r => r.mic).length)
const waitMic = (p, n) => p.waitForFunction(x => [...window.telsiz.call.remote.values()].filter(r => r.mic).length === x, n, T)

const mert = await open('Mert'), ali = await open('Ali'), veli = await open('Veli')
await mert.getByLabel('Grup adı').fill('Kanka')
await mert.getByRole('button', {name: 'Kur'}).click()
const code = await mert.evaluate(() => window.telsiz.active)
for (const p of [ali, veli]) {
  await p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
  await p.getByRole('button', {name: 'Katıl', exact: true}).click()
}
for (const p of [mert, ali, veli]) await peers(p, 2)
await ali.waitForFunction(() => window.telsiz.session.view.people.size === 3, null, T)

// Üye oda kuramaz: düğme görünmez, olay da sayılmaz.
check(await ali.getByRole('button', {name: 'Oda kur'}).count() === 0, 'üyede Oda kur düğmesi yok')
await ali.evaluate(() => window.telsiz.session.makeRoom('Gizli'))
await mert.waitForTimeout(1500)
check(await mert.evaluate(() => window.telsiz.session.view.rooms.length) === 0, 'üyenin kurduğu oda sayılmıyor')

// Kurucu arayüzden oda kurar.
await mert.getByRole('button', {name: 'Oda kur'}).click()
await mert.getByLabel('Oda adı').fill('Strateji')
await mert.getByRole('button', {name: 'Odayı kur'}).click()
await ali.waitForFunction(() => window.telsiz.session.view.rooms.some(r => r.title === 'Strateji'), null, T)
check(true, 'kurucunun odası herkese gitti')

// Herkes ana odada: üçü birbirini duyar.
for (const p of [mert, ali, veli]) await p.evaluate(() => window.telsiz.joinVoice(false, false, ''))
for (const p of [mert, ali, veli]) await waitMic(p, 2)
check(true, 'ana odada herkes birbirini duyuyor')

// /takim ve Odalara dağıt
await ali.evaluate(() => window.telsiz.go({kind: 'text', ch: 'genel'}))
await ali.getByLabel('Mesaj').fill('/takim')
await ali.getByLabel('Mesaj').press('Enter')
await mert.waitForFunction(() => [...window.telsiz.session.view.byId.values()].some(m => m.teams), null, T)
const teams = await mert.evaluate(() => [...window.telsiz.session.view.byId.values()].find(m => m.teams).teams)
check(teams.flat().length === 3, 'takım mesajı üç kişiyi kimlikle taşıyor')
await ali.getByRole('button', {name: 'Odalara dağıt'}).click()
const ids = {Mert: await uid(mert), Ali: await uid(ali), Veli: await uid(veli)}
const teamOf = id => teams.findIndex(t => t.includes(id))
for (const [n, p] of Object.entries({Mert: mert, Ali: ali, Veli: veli})) {
  const want = `Takım ${teamOf(ids[n]) + 1}`
  const ok = await p.waitForFunction(w => { const s = window.telsiz.session; return s.view.rooms.find(r => r.id === s.voice.room)?.title === w }, want, T).then(() => true, () => false)
  check(ok, `${n} ${want} odasına geçti`)
}
const together = teams.find(t => t.length === 2)
const alone = teams.find(t => t.length === 1)
const pageOf = id => ({[ids.Mert]: mert, [ids.Ali]: ali, [ids.Veli]: veli})[id]
await waitMic(pageOf(together[0]), 1).then(() => check(true, 'aynı takımdaki ikili birbirini duyuyor'), () => check(false, 'aynı takım ikilisi duymuyor'))
await waitMic(pageOf(alone[0]), 0).then(() => check(true, 'tek kalan diğer takımı duymuyor'), () => check(false, 'tek kalan hâlâ duyuyor'))

// Yetki tablosu: kurucu dağıtmayı sadece kendine alır, Ali'nin taşıması işlemez.
await mert.evaluate(() => window.telsiz.session.emit({t: 'perm', key: 'teams', who: 'owner'}))
await ali.waitForFunction(() => window.telsiz.session.view.perms.teams === 'owner', null, T)
await ali.evaluate(to => window.telsiz.session.sendMove(to), {[ids.Veli]: ''})
await veli.waitForTimeout(1500)
check(await veli.evaluate(() => window.telsiz.session.voice.room) !== '', 'yetkisi kalmayan taşıyamıyor')
await ali.evaluate(() => window.telsiz.go({kind: 'text', ch: 'genel'}))
await ali.getByRole('button', {name: 'Ayarlar'}).click()
check(await ali.getByText('Kim ne yapabilir').count() === 1 && await ali.getByText('Bu tabloyu sadece kurucu değiştirir.').count() === 1, 'üye tabloyu görüyor, değiştiremiyor')
await ali.getByRole('button', {name: 'Kapat'}).click()

// Oda silinince içindekiler ana odaya düşer.
const rid = await veli.evaluate(() => window.telsiz.session.voice.room)
await mert.evaluate(r => window.telsiz.session.dropRoom(r), rid)
await veli.waitForFunction(() => window.telsiz.session.voice.room === '', null, T).then(() => check(true, 'silinen odadaki ana odaya düştü'), () => check(false, 'silinen odada kaldı'))

// Radyo: kurucu istasyon ekler, Ali seçer, radyo odasındaki cihaz çalar.
await mert.evaluate(() => {
  const s = window.telsiz.session
  window.__rid = s.makeRoom('Radyo', 'radio')
  s.addStation({title: 'Deneme', url: 'https://example.com/stream.mp3', tag: 'pop'})
})
await ali.waitForFunction(() => window.telsiz.session.view.stations.length === 1 && window.telsiz.session.view.rooms.some(r => r.kind === 'radio'), null, T)
await ali.evaluate(() => { const s = window.telsiz.session; s.addStation({title: 'Ali', url: 'https://example.com/a.mp3', tag: ''}) })
await mert.waitForTimeout(1500)
check(await mert.evaluate(() => window.telsiz.session.view.stations.length) === 1, 'üye istasyon ekleyemiyor')
await ali.evaluate(() => { const s = window.telsiz.session; const r = s.view.rooms.find(x => x.kind === 'radio'); s.tune(r.id, s.view.stations[0].id) })
await mert.waitForFunction(() => window.telsiz.session.view.rooms.find(x => x.kind === 'radio')?.sid, null, T)
check(true, 'odadaki istasyonu üye seçebiliyor')
await mert.evaluate(() => window.telsiz.enterRoom(window.__rid))
await mert.getByText('Grubun radyoları').waitFor(T).then(() => check(true, 'radyo paneli açıldı'), () => check(false, 'radyo paneli yok'))
check(await mert.evaluate(() => window.telsiz.radioBg?.sid) !== undefined, 'çalan istasyon hatırlandı')
await mert.evaluate(() => window.telsiz.enterRoom(''))
await mert.waitForTimeout(300)
check(await mert.getByText('Radyo arkada').count() === 1, 'başka odaya geçince radyo arkada kısık sürüyor')

await browser.close()
