// Aynı hesap iki cihazda: yedek koduyla taşınır, iki yönde eşitlenir, üye listesinde çift görünmez.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const pass = m => console.log('OK  ', m)
const fail = m => { console.log('FAIL', m); process.exitCode = 1 }
const check = (c, m) => c ? pass(m) : fail(m)
const waitFor = async (fn, ms, label) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 250)) }
  fail(label)
  return false
}

const browser = await chromium.launch({channel: 'chrome', headless: true})
const page = async () => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}})
  const p = await ctx.newPage()
  p.on('pageerror', e => fail(`sayfa hatası: ${e.message}`))
  await p.goto(URL)
  return p
}
const name = async (p, n) => { await p.getByLabel('Takma adın').fill(n); await p.getByRole('button', {name: 'Devam'}).click() }
const seen = (p, t) => p.evaluate(x => [...window.telsiz.session.view.byId.values()].some(m => (m.text ?? '').includes(x)), t)
const say = (p, t) => p.evaluate(x => window.telsiz.session.sendText('genel', x), t)

const web = await page()
await name(web, 'Mert')
await web.getByLabel('Grup adı').fill('Pembe oda')
await web.getByRole('button', {name: 'Kur'}).click()
await say(web, 'webden-ilk')
const backup = await web.evaluate(async () => { await window.telsiz.identity; return window.telsiz.backupCode() })

const app = await page()
await app.getByRole('button', {name: /yedek kodum var/}).click()
await app.getByLabel('Yedek kodu').fill(backup)
await app.getByRole('button', {name: 'Geri yükle'}).click()
await waitFor(() => seen(app, 'webden-ilk'), 60000, 'ikinci cihaz geçmişi almadı') && pass('ikinci cihaz geçmişi aldı')
await waitFor(() => app.evaluate(() => window.telsiz.session.view.title === 'Pembe oda'), 10000, 'grup adı eşitlenmedi') && pass('grup adı da eşitlendi')

await say(app, 'masaustunden')
await waitFor(() => seen(web, 'masaustunden'), 15000, 'ikinciden birinciye gitmedi') && pass('ikinci cihazın mesajı birinciye gitti')
await say(web, 'webden-ikinci')
await waitFor(() => seen(app, 'webden-ikinci'), 15000, 'birinciden ikinciye gitmedi') && pass('birinci cihazın mesajı ikinciye gitti')
check(await web.evaluate(() => window.telsiz.session.peers.size) === 0, 'kişi kendini üye listesinde görmüyor')

// Arkadaş iki cihazda da tek kişi görünür, özel mesaj iki cihaza da düşer.
const friend = await page()
await name(friend, 'Ali')
const code = await web.evaluate(() => window.telsiz.active)
await friend.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await friend.getByRole('button', {name: 'Katıl'}).click()
await waitFor(() => web.evaluate(() => window.telsiz.session.peers.size === 1) && app.evaluate(() => window.telsiz.session.peers.size === 1), 60000, 'arkadaş iki cihazda da görünmedi') && pass('arkadaş iki cihazda da göründü')
const me = await web.evaluate(() => window.telsiz.me.uid)
await friend.evaluate(u => window.telsiz.session.sendText('dm:' + [u, window.telsiz.me.uid].sort().join(':'), 'iki-cihaza-ozel'), me)
await waitFor(() => seen(web, 'iki-cihaza-ozel'), 15000, 'özel mesaj birinci cihaza gitmedi') && pass('özel mesaj birinci cihazda açıldı')
await waitFor(() => seen(app, 'iki-cihaza-ozel'), 15000, 'özel mesaj ikinci cihaza gitmedi') && pass('özel mesaj ikinci cihazda açıldı')

await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
