// Oda sohbetindeki mesaj görünür yerde sayılır ve panel açılınca okundu olur.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']})
const open = async name => {
  const p = await (await browser.newContext({viewport: {width: 1400, height: 800}})).newPage()
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const a = await open('Mert'), b = await open('Ali')
await a.getByLabel('Grup adı').fill('Ses')
await a.getByRole('button', {name: 'Kur'}).click()
const code = await a.evaluate(() => window.telsiz.active)
await b.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await b.getByRole('button', {name: 'Katıl'}).click()
await a.waitForFunction(() => window.telsiz.session.peers.size === 1, null, {timeout: 60000})
for (const p of [a, b]) await p.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
check(await a.locator('.roomside').count() === 0, 'boş oda sohbeti kapalı başlıyor')
await b.getByRole('button', {name: 'Oda sohbeti'}).click()
await a.getByRole('button', {name: 'Oda sohbeti'}).click()
await a.getByRole('button', {name: 'Paneli kapat'}).click()

const send = async text => {
  await b.getByRole('tabpanel').or(b.locator('.roomside')).locator('textarea').fill(text)
  await b.locator('.roomside textarea').press('Enter')
}
const unread = () => a.evaluate(() => window.telsiz.unreadGroup(window.telsiz.session))
await send('panel kapaliyken')
await a.waitForFunction(() => window.telsiz.session.view.msgs.get('ses')?.length === 1, null, {timeout: 15000})
check(await unread() === 1, 'panel kapalıyken mesaj okunmamış')
check(await a.locator('.chan .badge').textContent() === '1', 'sayı Telsiz odası satırında görünüyor')
await a.getByRole('button', {name: 'Oda sohbeti'}).click()
await a.waitForTimeout(300)
check(await unread() === 0, 'panel açılınca okundu')
check(await a.locator('.chan .badge').count() === 0, 'sayı kayboldu')
await send('panel acikken')
await a.waitForFunction(() => window.telsiz.session.view.msgs.get('ses')?.length === 2, null, {timeout: 15000})
await a.waitForTimeout(200)
check(await unread() === 0, 'panel açıkken gelen mesaj sayılmıyor')
await a.evaluate(() => {
  const t = window.telsiz, m = t.session.view.msgs.get('ses').at(-1)
  t.lastRead[`${t.active}:genel`] = 0
  t.session.view.msgs.set('genel', [{...m, ch: 'genel', ts: Date.now() + 3600e3}])
  t.go({kind: 'text', ch: 'genel'})
})
check(await unread() === 0, 'saati ileri arkadaşın mesajı da okundu sayılıyor')
await browser.close()
