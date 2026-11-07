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

// Elif'in bağlantısı gider (pencere kapanır).
await elif.ctx.close()
await mert.getByText('Elif ile bağlantı gitti').waitFor(T)
check(true, 'uyarı kimin gittiğini söylüyor')
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
await mert.waitForTimeout(16000)
check(await mert.getByText('Elif ile bağlantı gitti').isVisible(), 'yeniden açınca da kim gittiği hatırlanıyor')
console.log(process.exitCode ? 'HATA' : 'TAMAM')
await browser.close()
