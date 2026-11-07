// Her yazı tipi gerçekten yükleniyor mu: seç, sayfanın yazısı o tiple çiziliyor mu bak.
import {chromium} from 'playwright-core'
const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const b = await chromium.launch({channel: 'chrome', headless: true})
const p = await (await b.newContext({viewport: {width: 1300, height: 850}})).newPage()
await p.goto(URL)
await p.getByLabel('Takma adın').fill('Mert')
await p.getByRole('button', {name: 'Devam'}).click()
await p.getByLabel('Grup adı').fill('Sinema')
await p.getByRole('button', {name: 'Kur'}).click()
await p.getByRole('button', {name: 'Ayarlar', exact: true}).first().click()
await p.getByRole('tab', {name: 'Görünüm'}).click()
const btns = p.getByRole('group', {name: 'Yazı tipi'}).getByRole('button')
const n = await btns.count()
for (let i = 0; i < n; i++) {
  await btns.nth(i).click()
  const id = await p.evaluate(() => window.telsiz.prefs.font), name = (await btns.nth(i).innerText()).replace(/\s+/g, ' ')
  const fam = await p.evaluate(() => getComputedStyle(document.body).fontFamily.split(',')[0].replace(/"/g, ''))
  const ok = id === 'system' || await p.waitForFunction(async f => { await document.fonts.load(`16px "${f}"`); return [...document.fonts].some(x => x.family.replace(/"/g, '') === f && x.status === 'loaded') }, fam, {timeout: 8000, polling: 300}).then(() => true, () => false)
  check(ok, `${name} yüklendi`)
}
await btns.filter({hasText: 'Orbitron'}).click()
await p.waitForTimeout(500)
await p.screenshot({path: 'e2e/out/font-orbitron.png'})
await b.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
