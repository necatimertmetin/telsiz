// Frekans arayüzü (masaüstü): ayardan açılır, kadran ve frekanslar, sese giriş, yazı kanalında "Hâlâ yayındasın", dar pencerede klasik.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']})
const T = {timeout: 30000}
const open = async name => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}, permissions: ['microphone', 'camera']})
  const p = await ctx.newPage()
  p.on('pageerror', e => check(false, `${name} sayfa hatası: ${e.message}`))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const noScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

const mert = await open('Mert'), ali = await open('Ali')
await mert.getByLabel('Grup adı').fill('Cumartesi ekibi')
await mert.getByRole('button', {name: 'Kur'}).click()
const code = await mert.evaluate(() => window.telsiz.active)
await ali.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await ali.getByRole('button', {name: 'Katıl', exact: true}).click()
await mert.waitForFunction(() => window.telsiz.session?.peers.size === 1, null, {timeout: 60000})

check(await mert.locator('.fq').count() === 0, 'varsayılan klasik')
await mert.getByRole('button', {name: 'Ayarlar', exact: true}).first().click()
await mert.getByRole('tab', {name: 'Görünüm'}).click()
await mert.getByRole('group', {name: 'Arayüz'}).getByRole('button', {name: 'Frekans'}).click()
await mert.keyboard.press('Escape')
await mert.locator('.fq').waitFor(T)
check(await mert.evaluate(() => window.telsiz.prefs.ui === 'frekans'), 'Frekans seçimi kaydedildi')
check(await mert.getByRole('navigation', {name: 'Gruplar'}).getByText('Cumartesi ekibi').isVisible(), 'grup üst çubukta')
await mert.locator('.fq-online', {hasText: 'Sinyalde 2'}).waitFor(T)
check(true, 'sinyalde 2 kişi')
check(await mert.locator('.fq-st').first().locator('.fq-f').innerText() === '90.0', 'ana oda 90.0')
check(await noScroll(mert), '1280 genişlikte yatay kaydırma yok')

await ali.evaluate(() => window.telsiz.joinVoice())
await mert.locator('.fq-st').first().click()
await mert.locator('.fq-who', {hasText: 'Ali'}).waitFor(T)
check(await mert.locator('.fq-screen b').innerText() === '90.0', 'kadran ana odayı gösteriyor')
check(await mert.locator('.fq-tag', {hasText: 'Frekans dışı'}).isVisible(), 'katılmadan "Frekans dışı"')
await mert.evaluate(() => window.telsiz.joinVoice())
await mert.getByText('● Yayındasın').waitFor(T)
check(/90\.0 MHz · yayında/.test(await mert.locator('.fq-mest').innerText()), 'alt satırda yayında')
await mert.waitForTimeout(800)
await mert.screenshot({path: 'e2e/out/frekans-ses.png'})

await mert.locator('.fq-st.txt', {hasText: 'genel'}).click()
await mert.getByText('Hâlâ yayındasın').waitFor(T)
check(await mert.locator('.fq-screen b').innerText() === '100.5', 'genel kanal 100.5')
await mert.locator('.composer textarea').fill('10da 90.0\'da')
await mert.keyboard.press('Enter')
await ali.waitForFunction(() => [...window.telsiz.session.view.msgs.get('genel')?.values() ?? []].some(m => m.text?.includes('90.0')), null, T)
check(true, 'mesaj gitti')
await mert.screenshot({path: 'e2e/out/frekans-yazi.png'})
await mert.getByRole('button', {name: /Sahneye dön/}).click()
await mert.getByText('● Yayındasın').waitFor(T)
check(true, 'Sahneye dön sese götürdü')

await mert.setViewportSize({width: 960, height: 700})
check(await mert.locator('.fq').isVisible() && await noScroll(mert), '960 genişlikte Frekans, kaydırma yok')
await mert.setViewportSize({width: 800, height: 700})
await mert.locator('.shell').waitFor(T)
check(await mert.locator('.fq').count() === 0, '800 genişlikte klasik')
console.log(process.exitCode ? 'HATA' : 'TAMAM')
await browser.close()
