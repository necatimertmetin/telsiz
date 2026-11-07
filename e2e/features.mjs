// Üç tarayıcıyla yeni özellikler: özel grup, anket, komut botu, profil, maç hatırlatması, yedek kutusu.
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
const open = async name => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}})
  const page = await ctx.newPage()
  page.on('pageerror', e => fail(`${name} sayfa hatası: ${e.message}`))
  await page.goto(URL)
  await page.getByLabel('Takma adın').fill(name)
  await page.getByRole('button', {name: 'Devam'}).click()
  return {name, page}
}
const [A, B, C] = [await open('Mert'), await open('Ali'), await open('Veli')]
await A.page.getByLabel('Grup adı').fill('Yeni')
await A.page.getByRole('button', {name: 'Kur'}).click()
const code = await A.page.evaluate(() => window.telsiz.active)
for (const u of [B, C]) {
  await u.page.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
  await u.page.getByRole('button', {name: 'Katıl'}).click()
}
await waitFor(() => A.page.evaluate(() => window.telsiz.session.peers.size === 2), 60000, 'kişiler bağlanmadı')

const say = async (p, t) => { await p.getByRole('textbox', {name: 'Mesaj'}).fill(t); await p.keyboard.press('Enter') }
const has = (u, t) => u.page.evaluate(x => [...window.telsiz.session.view.byId.values()].some(m => (m.text ?? '').includes(x)), t)

// Özel grup: seçilenlere gider, seçilmeyene gitmez.
await A.page.getByRole('button', {name: 'Özel sohbet kur'}).click()
await A.page.getByLabel('Ali').check()
await A.page.getByRole('button', {name: 'Sohbeti aç'}).click()
await say(A.page, 'sadece aliye')
await waitFor(() => has(B, 'sadece aliye'), 10000, 'özel mesaj Aliye gitmedi') && pass('özel grup mesajı seçilene gitti')
await new Promise(r => setTimeout(r, 1500))
check(!(await has(C, 'sadece aliye')), 'seçilmeyen kişiye gitmedi')
await A.page.getByRole('button', {name: /genel/}).first().click()

// Komut botu
await say(A.page, '/takim')
await waitFor(() => has(B, 'Takım 1'), 10000, 'takım komutu gitmedi') && pass('komut botu sonucu herkese gitti')
check(!(await has(B, '/takim')), 'komutun kendisi sohbete düşmedi')

// Anket
await A.page.getByRole('button', {name: 'Anket kur'}).click()
await A.page.getByLabel('Soru').fill('Kaçta?')
await A.page.getByLabel('Seçenek 1').fill('21')
await A.page.getByLabel('Seçenek 2').fill('22')
await A.page.getByRole('button', {name: 'Gönder'}).click()
const poll = B.page.locator('.poll button').nth(1)
await poll.waitFor({timeout: 10000})
await B.page.getByRole('button', {name: 'genel'}).first().click().catch(() => {})
await poll.click()
await waitFor(() => A.page.locator('.poll button').nth(1).innerText().then(t => t.includes('Ali')), 10000, 'oy görünmedi') && pass('oy diğer kişide göründü')
await A.page.screenshot({path: 'e2e/out/features.png'})

// Profil
await A.page.evaluate(() => window.telsiz.setProfile({color: '#aa22cc'}))
const uid = await A.page.evaluate(() => window.telsiz.me.uid)
await waitFor(() => B.page.evaluate(u => window.telsiz.profiles[u]?.color === '#aa22cc', uid), 10000, 'profil rengi gitmedi') && pass('profil rengi arkadaşa ulaştı')

// Maç hatırlatması: şimdiki dakikaya kurulur.
await A.page.evaluate(() => {
  const n = new Date(Date.now() + 60000)
  window.telsiz.session.emit({t: 'sched', days: [n.getDay()], time: n.toTimeString().slice(0, 5), on: true})
})
await waitFor(() => B.page.getByText('Maç vakti').first().isVisible(), 90000, 'hatırlatma çıkmadı') && pass('maç hatırlatması gruptaki diğer kişide çıktı')

// Yedek kodu kutusu
await C.page.getByRole('button', {name: 'Ayarlar'}).first().click()
await C.page.getByRole('tab', {name: 'Yedek ve cihaz'}).click()
const box = await C.page.evaluate(() => { const e = document.querySelector('.code.small'); return {h: e.clientHeight, full: e.scrollHeight} })
check(box.h >= 60, `yedek kodu kutusu yeterince yüksek (${box.h}px, içerik ${box.full}px)`)
await C.page.screenshot({path: 'e2e/out/backup.png'})

await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
