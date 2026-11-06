// Android bildirim çubuğu: üst boşluk ekranı kaydırmadan içeriği aşağı alır.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const TOP = 40
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true})
const p = await (await browser.newContext({viewport: {width: 375, height: 760}, hasTouch: true, isMobile: true})).newPage()
await p.goto(URL)
await p.evaluate(top => document.documentElement.style.setProperty('--safe-area-inset-top', `${top}px`), TOP)
await p.getByLabel('Takma adın').fill('Mert')
await p.getByRole('button', {name: 'Devam'}).click()
await p.getByLabel('Grup adı').fill('Ses')
await p.getByRole('button', {name: 'Kur'}).click()
await p.locator('.topbar').first().waitFor()
const top = await p.locator('.topbar').first().evaluate(e => e.getBoundingClientRect().top)
check(top === TOP, `üst bar çubuğun altında (${top})`)
const fits = () => p.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)
check(await fits(), 'sayfa ekrandan taşmıyor')
const composer = await p.locator('.composer').evaluate(e => e.getBoundingClientRect().bottom)
check(composer <= 760, `yazma alanı ekranda (${composer})`)
await p.screenshot({path: 'e2e/out/safearea.png'})
await p.locator('.topbar button').first().click()
await p.waitForTimeout(300)
const inner = await p.locator('.left').evaluate(e => { const c = e.firstElementChild?.getBoundingClientRect().top; return {pad: getComputedStyle(e).paddingTop, c} })
check(inner.pad === `${TOP}px`, `yan menü de çubuğun altında (${inner.pad})`)
await p.screenshot({path: 'e2e/out/safearea-menu.png'})
await browser.close()
