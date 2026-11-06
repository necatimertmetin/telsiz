// Saldırı denemeleri: taklit, ham veride özel mesaj ve silinen metin arama, yedekle dönüş.
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
const wait = ms => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({channel: 'chrome', headless: true})
const open = async name => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}})
  const page = await ctx.newPage()
  page.on('pageerror', e => fail(`${name} sayfa hatası: ${e.message}`))
  await page.goto(URL)
  await page.getByLabel('Takma adın').fill(name)
  await page.getByRole('button', {name: 'Devam'}).click()
  return {name, ctx, page}
}
const join = async (u, code) => {
  await u.page.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
  await u.page.getByRole('button', {name: 'Katıl'}).click()
}
const seen = (u, t) => u.page.evaluate(x => [...window.telsiz.session.view.byId.values()].some(m => (m.text ?? '').includes(x)), t)
const raw = u => u.page.evaluate(async () => {
  await new Promise(r => setTimeout(r, 300))
  const db = await new Promise(r => { const q = indexedDB.open('telsiz', 1); q.onsuccess = () => r(q.result) })
  const rows = await new Promise(r => { const q = db.transaction('events').objectStore('events').getAll(); q.onsuccess = () => r(q.result) })
  db.close()
  return JSON.stringify(rows)
})
const uidOf = u => u.page.evaluate(() => window.telsiz.me.uid)
const dm = (u, to, text) => u.page.evaluate(([t, x]) => {
  const s = window.telsiz.session, me = window.telsiz.me.uid
  s.sendText('dm:' + [me, t].sort().join(':'), x)
}, [to, text])
const peersOf = u => u.page.evaluate(() => [...window.telsiz.session.peers.values()].map(p => p.uid))

const [A, B, C] = [await open('Mert'), await open('Ali'), await open('Veli')]
await A.page.getByLabel('Grup adı').fill('Guvenlik')
await A.page.getByRole('button', {name: 'Kur'}).click()
const code = await A.page.evaluate(() => window.telsiz.active)
await join(B, code); await join(C, code)
await waitFor(async () => (await peersOf(A)).length === 2 && (await peersOf(B)).length === 2 && (await peersOf(C)).length === 2, 60000, 'kişiler bağlanmadı') && pass('kimlik kanıtıyla üç kişi bağlandı')
const [ua, ub] = [await uidOf(A), await uidOf(B)]

// Özel mesaj şifreli saklanır, alıcı açar.
await dm(A, ub, 'cok-gizli-metin')
await waitFor(() => seen(B, 'cok-gizli-metin'), 15000, 'özel mesaj ulaşmadı') && pass('özel mesaj alıcıda açıldı')
check(!(await raw(B)).includes('cok-gizli-metin'), 'alıcının ham verisinde metin yok, şifreli')
check(!(await raw(A)).includes('cok-gizli-metin'), 'gönderenin ham verisinde metin yok, şifreli')
check(!(await raw(C)).includes('cok-gizli'), 'üçüncü kişiye hiç gitmedi')

// Normal grup mesajı imzalı gider.
await A.page.getByRole('textbox', {name: 'Mesaj'}).fill('imzali-mesaj')
await A.page.keyboard.press('Enter')
await waitFor(() => seen(B, 'imzali-mesaj'), 15000, 'grup mesajı ulaşmadı') && pass('imzalı grup mesajı kabul edildi')

// Silme: metin kimsenin verisinde kalmaz, yeni gelene de gitmez.
await A.page.getByRole('textbox', {name: 'Mesaj'}).fill('silinecek-metin')
await A.page.keyboard.press('Enter')
await waitFor(() => seen(C, 'silinecek-metin'), 15000, 'silinecek mesaj ulaşmadı')
await A.page.evaluate(() => {
  const s = window.telsiz.session
  const m = [...s.view.byId.values()].find(x => x.text === 'silinecek-metin')
  s.emit({t: 'del', target: m.id})
})
await waitFor(() => seen(C, 'silinecek-metin').then(x => !x), 15000, 'silme ulaşmadı')
check(!(await raw(C)).includes('silinecek-metin'), 'silinen metin arkadaşın ham verisinden de gitti')
check(!(await raw(A)).includes('silinecek-metin'), 'silinen metin sahibinin ham verisinden de gitti')
const N = await open('Yeni')
await join(N, code)
await waitFor(() => seen(N, 'imzali-mesaj'), 40000, 'yeni gelen geçmişi almadı') && pass('yeni gelen geçmişi aldı')
check(!(await raw(N)).includes('silinecek-metin'), 'yeni gelene silinen metin gitmedi')
await N.ctx.close()

// Taklit: Veli kendi kimlik numarasını Mertinkiyle değiştiriyor.
await C.page.evaluate(u => localStorage.setItem('telsiz.me', JSON.stringify({uid: u, name: 'Mert'})), ua)
await C.page.reload()
await C.page.waitForFunction(() => window.telsiz?.session)
await wait(9000)
check((await peersOf(B)).filter(u => u === ua).length <= 1, 'Ali de sahte Merti ikinci kişi olarak görmüyor')
const veliSees = await C.page.evaluate(() => window.telsiz.session.peers.size)
console.log('bilgi: taklitçinin görebildiği kişi', veliSees)
await C.page.evaluate(() => { window.telsiz.session.sendText('genel', 'sahte-mesaj') })
await wait(4000)
check(!(await seen(B, 'sahte-mesaj')), 'taklitçinin mesajı reddedildi')
await dm(B, ua, 'mert-e-ozel')
await waitFor(() => seen(A, 'mert-e-ozel'), 15000, 'gerçek Mert özel mesajı alamadı') && pass('gerçek Mert özel mesajı aldı')
await wait(2000)
check(!(await seen(C, 'mert-e-ozel')), 'taklitçi özel mesajı okuyamadı')
await C.ctx.close()

// Yedek kodu: anahtarla dönen kabul edilir, özel mesaj açılır.
const backup = await A.page.evaluate(() => window.telsiz.backupCode())
await A.ctx.close()
await wait(1500)
const R = await browser.newContext({viewport: {width: 1280, height: 800}})
const rp = await R.newPage()
rp.on('pageerror', e => fail(`yedek sayfa hatası: ${e.message}`))
await rp.goto(URL)
await rp.getByRole('button', {name: /yedek kodum var/}).click()
await rp.getByLabel('Yedek kodu').fill(backup)
await rp.getByRole('button', {name: 'Geri yükle'}).click()
const rseen = t => rp.evaluate(x => [...window.telsiz.session.view.byId.values()].some(m => (m.text ?? '').includes(x)), t)
await waitFor(() => rseen('imzali-mesaj'), 40000, 'yedekle dönen geçmişi almadı') && pass('yedekle dönen kabul edildi, geçmiş geldi')
await waitFor(() => rseen('cok-gizli-metin'), 15000, 'yedekle dönen özel mesajı açamadı') && pass('yedekteki anahtarla eski özel mesaj açıldı')
await rp.evaluate(() => window.telsiz.session.sendText('genel', 'yedekten-yeni-mesaj'))
await waitFor(() => seen(B, 'yedekten-yeni-mesaj'), 15000, 'yedekle dönenin mesajı reddedildi') && pass('yedekle dönenin yeni mesajı kabul edildi')

await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
