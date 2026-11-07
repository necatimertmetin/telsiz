// Görüşmedeki arkadaş düşünce: "X ile bağlantı gitti" uyarısı, kendiliğinden yeniden deneme, "Şimdi dene" sese geri sokar.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']})
const T = {timeout: 30000}
const open = async name => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}, permissions: ['microphone']})
  const p = await ctx.newPage()
  p.on('pageerror', e => check(false, `${name} sayfa hatası: ${e.message}`))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return {p, ctx}
}

const {p: mert} = await open('Mert'), elif = await open('Elif')
await mert.getByLabel('Grup adı').fill('Gece')
await mert.getByRole('button', {name: 'Kur'}).click()
const code = await mert.evaluate(() => window.telsiz.active)
await elif.p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await elif.p.getByRole('button', {name: 'Katıl', exact: true}).click()
await mert.waitForFunction(() => window.telsiz.session?.peers.size === 1, null, {timeout: 60000})
for (const p of [mert, elif.p]) await p.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
await mert.waitForFunction(() => [...window.telsiz.session.peers.values()].some(p => p.voice.in), null, T)

// 1) Elif'in bağlantısı veda etmeden gider: "bağlantısı koptu", kendiliğinden yeniden deneme, "Şimdi dene".
await elif.p.evaluate(() => window.telsiz.session.room.leave())
await mert.getByText("Elif'in bağlantısı koptu").waitFor(T)
check(true, 'sebep: Elif in bağlantısı koptu')
check(!(await mert.getByText('Ayarlar > Gelişmiş bölümüne bak').count()), 'eski anlaşılmaz uyarı yok')
await mert.getByText('Kendiliğinden yeniden deneniyor').waitFor(T)
check(true, 'kendiliğinden yeniden deneme var')
await mert.screenshot({path: 'e2e/out/reconnect.png'})
const before = await mert.evaluate(() => window.telsiz.session.born)
await mert.getByRole('button', {name: 'Şimdi dene'}).click()
await mert.waitForFunction(b => window.telsiz.session.born !== b, before, T)
check(true, 'grup baştan açıldı')
await mert.waitForFunction(() => window.telsiz.session.voice.in, null, T)
check(true, 'sese geri girildi')

// 2) Elif geri gelir (sayfayı yeniler), sese girer, sonra uygulamayı kapatır: "uygulamayı kapattı", yeniden deneme yok.
await elif.p.reload()
await elif.p.waitForFunction(() => window.telsiz.session?.peers.size === 1, null, {timeout: 90000})
await mert.waitForFunction(() => window.telsiz.session.lost.size === 0, null, T)
check(true, 'geri gelince uyarı kalktı')
await elif.p.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
await mert.waitForFunction(() => [...window.telsiz.session.peers.values()].some(p => p.voice.in), null, T)
await elif.p.close({runBeforeUnload: true})
await mert.waitForFunction(() => window.telsiz.session.lost.size > 0, null, T)
await mert.getByText('Elif uygulamayı kapattı').waitFor(T)
check(true, 'sebep: Elif uygulamayı kapattı')
await mert.waitForTimeout(1500)
check(!(await mert.getByText('Kendiliğinden yeniden deneniyor').count()), 'kapattıysa yeniden deneme yok')
await mert.screenshot({path: 'e2e/out/reconnect-quit.png'})
console.log(process.exitCode ? 'HATA' : 'TAMAM')
await browser.close()
