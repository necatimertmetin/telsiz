// Mikrofon ve kulaklık okları aynı ses panelini açar; masaüstü ve telefon genişliğinde.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const errors = []
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']})
const open = async (name, viewport) => {
  const p = await (await browser.newContext({viewport})).newPage()
  p.on('pageerror', e => errors.push(e.message))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  await p.getByLabel('Grup adı').fill('Ses')
  await p.getByRole('button', {name: 'Kur'}).click()
  await p.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
  await p.getByRole('button', {name: 'Mikrofon seç'}).waitFor()
  return p
}
const panel = p => p.getByRole('dialog', {name: 'Ses ayarları'})
const inView = p => panel(p).evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight })

const d = await open('Mert', {width: 1280, height: 720})
await d.getByRole('button', {name: 'Mikrofon seç'}).click()
check(await panel(d).isVisible(), 'mikrofon oku paneli açıyor')
check(await d.getByLabel('Mikrofon sesi').isVisible() && await d.getByLabel('Duyduğum ses').isVisible(), 'iki çubuk aynı panelde')
check(await inView(d), 'masaüstünde panel ekranın içinde')
await d.getByLabel('Mikrofon sesi').fill('1.5')
check(await panel(d).getByText('%150').isVisible(), 'mikrofon yüzdesi güncelleniyor')
const rows = panel(d).getByRole('menu', {name: 'Mikrofon'}).getByRole('menuitemradio')
check(await rows.count() >= 2, `mikrofon listesi dolu (${await rows.count()})`)
await rows.last().click()
await new Promise(r => setTimeout(r, 500))
check(await panel(d).isVisible(), 'cihaz seçince panel açık kalıyor')
check(await rows.last().getAttribute('aria-checked') === 'true', 'seçilen cihaz işaretli')
await d.screenshot({path: 'e2e/out/audiopanel-desktop.png'})
await d.locator('.menuscrim').click({position: {x: 5, y: 5}})
check(await panel(d).count() === 0, 'dışarı tıklayınca kapanıyor')
await d.getByRole('button', {name: 'Ses çıkışı seç'}).click()
check(await panel(d).isVisible(), 'kulaklık oku aynı paneli açıyor')
await d.locator('.menuscrim').click({position: {x: 5, y: 5}})
await d.getByRole('button', {name: 'Kamera seç'}).click()
check(await d.getByRole('menu', {name: 'Kamera'}).isVisible() && await panel(d).count() === 0, 'kamera menüsü ayrı kalıyor')
await d.locator('.menuscrim').click({position: {x: 5, y: 5}})
await d.evaluate(() => window.telsiz.leaveVoice())
await d.waitForTimeout(500)
check(errors.length === 0, `sesten çıkış temiz ${errors.join(' | ')}`)

const m = await open('Ali', {width: 375, height: 700})
await m.getByRole('button', {name: 'Mikrofon seç'}).click()
check(await inView(m), 'telefonda panel ekranın içinde')
check(await m.evaluate(() => document.documentElement.scrollWidth === innerWidth), 'telefonda yatay taşma yok')
await m.screenshot({path: 'e2e/out/audiopanel-phone.png'})
check(errors.length === 0, `sayfa hatası yok ${errors.join(' | ')}`)
await browser.close()
