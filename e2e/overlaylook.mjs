// Oyun üstü konuşan listesi: koyu ve açık sahnede görüntü alır.
import {chromium} from 'playwright-core'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const browser = await chromium.launch({channel: 'chrome', headless: true})
const p = await browser.newPage({viewport: {width: 230, height: 180}})
const errors = []
p.on('pageerror', e => errors.push(e.message))
await p.addInitScript(() => { window.telsizOverlay = {onData: f => { window.push = f }} })
await p.goto(pathToFileURL(resolve('desktop/overlay.html')).href)
await p.evaluate(() => window.push([{name: 'Mert', talk: true, muted: false}, {name: 'elif', talk: false, muted: false}, {name: 'Ali', talk: false, muted: true}, {name: 'Çok uzun bir takma ad yazan arkadaş', talk: false, muted: true}]))
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
check(await p.locator('.u').count() === 4, 'dört kişi çiziliyor')
check(await p.locator('.u.talk b').evaluate(e => getComputedStyle(e).backgroundColor) === 'rgb(94, 224, 122)', 'konuşanın noktası yeşil')
check(await p.locator('.u svg').count() === 2, 'sessizlerde ikon var')
check(await p.locator('.u').last().evaluate(e => e.getBoundingClientRect().width <= 210), 'uzun ad taşmıyor')
for (const [name, bg] of [['koyu', '#14161a'], ['acik', '#c9ccd0']]) {
  await p.addStyleTag({content: `html{background:${bg}!important}`})
  await p.screenshot({path: `e2e/out/overlay-${name}.png`})
}
check(errors.length === 0, `sayfa hatası yok ${errors.join(' | ')}`)
await browser.close()
