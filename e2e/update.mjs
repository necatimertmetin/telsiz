// Ayarlardaki güncelleme düğmesi. Kabuk ve GitHub taklit edilir; gerçek kurulum burada sınanmaz.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true})

const desktop = extra => `window.telsizDesktop = {onHotkey(){}, listSources: async () => [], pickSource: async () => {}, flash(){}, onUpdate(cb){ window.__ready = cb }, installUpdate(){ window.__installed = true }, ${extra}}`
const android = v => `window.Capacitor = {getPlatform: () => 'android', Plugins: {Telsiz: {callStart: async () => {}, callStop: async () => {}, setSpeaker: async () => {}, appVersion: async () => ({version: '${v}'}), installUpdate: async () => {}}}}`

async function open({init, tag = 'v1.5.0', ua, fail}) {
  const ctx = await browser.newContext({viewport: {width: 1200, height: 900}, userAgent: ua})
  const p = await ctx.newPage()
  if (init) await p.addInitScript(init)
  await p.route('https://api.github.com/**', r => fail ? r.abort() : r.fulfill({json: {tag_name: tag}, headers: {'access-control-allow-origin': '*'}}))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill('Mert')
  await p.getByRole('button', {name: 'Devam'}).click()
  await p.getByLabel('Grup adı').fill('Test')
  await p.getByRole('button', {name: 'Kur'}).click()
  await p.getByRole('button', {name: 'Ayarlar', exact: true}).click()
  await p.getByRole('tab', {name: 'Yedek ve cihaz'}).click()
  return p
}
const press = p => p.getByRole('button', {name: 'Güncellemeleri denetle'}).click()
const status = p => p.getByRole('status').filter({hasNotText: /^$/}).first()

let p = await open({})
check(await p.getByRole('button', {name: 'Güncellemeleri denetle'}).count() === 0, 'sitede düğme yok')

p = await open({init: desktop(`appVersion: async () => '1.5.0', checkUpdate: async () => { window.__checked = true; return true }`)})
await press(p)
await p.getByText('Güncelsin (1.5.0)').waitFor({timeout: 5000})
check(!await p.evaluate(() => window.__checked), 'güncelse indirme başlamıyor')

p = await open({init: desktop(`appVersion: async () => '1.4.0', checkUpdate: async () => { window.__checked = true; return true }`)})
await press(p)
await p.getByText('v1.5.0 indiriliyor').waitFor({timeout: 5000})
check(await p.evaluate(() => window.__checked), 'yeni sürümde indirme başladı')
await p.evaluate(() => window.__ready())
await p.getByRole('dialog').getByRole('button', {name: 'Güncelleme hazır, yeniden başlat'}).click()
check(await p.evaluate(() => window.__installed), 'hazır olunca ayarlardan kurulur')

p = await open({init: desktop(`appVersion: async () => '1.4.0', checkUpdate: async () => false`)})
await press(p)
await p.getByRole('dialog').getByRole('button', {name: 'Yeni sürüm v1.5.0: indirme sayfası'}).waitFor({timeout: 5000})
check(true, 'taşınabilir sürüm indirme sayfasına gider')

p = await open({init: desktop(''), ua: 'Mozilla/5.0 Telsiz/1.4.0 Chrome/130.0.0.0 Electron/33.0.0'})
await press(p)
await p.getByRole('dialog').getByRole('button', {name: 'Yeni sürüm v1.5.0: indirme sayfası'}).waitFor({timeout: 5000})
check(true, 'yeni köprüsü olmayan kurulu uygulamada da çalışıyor')

// Android açılışta zaten denetler, düğme yerine doğrudan güncelleme çıkar.
p = await open({init: android('1.5.0')})
await press(p)
await p.getByText('Güncelsin (1.5.0)').waitFor({timeout: 5000})
check(true, 'Android güncelse söylüyor')

p = await open({init: android('1.4.0')})
await p.getByRole('dialog').getByRole('button', {name: 'Yeni sürüm v1.5.0: güncelle'}).waitFor({timeout: 5000})
check(true, 'Android güncelleme düğmesi çıkıyor')

p = await open({init: desktop(`appVersion: async () => '1.4.0', checkUpdate: async () => true`), fail: true})
await press(p)
await p.getByText('Denetlenemedi').waitFor({timeout: 5000})
check(true, 'internet yoksa hata yazıyor')

await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
