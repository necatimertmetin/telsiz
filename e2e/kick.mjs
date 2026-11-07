// Roller, kod yenilemeli atma, kapalı cihazın yeni linkle dönüşü, grup silme.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true})
const open = async name => {
  const p = await (await browser.newContext({viewport: {width: 1280, height: 800}})).newPage()
  p.on('pageerror', e => check(false, `${name} sayfa hatası: ${e.message}`))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const code = p => p.evaluate(() => window.telsiz.active)
const join = async (p, c) => {
  await p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${c}`)
  await p.getByRole('button', {name: 'Katıl', exact: true}).click()
}
const peers = (p, n) => p.waitForFunction(x => window.telsiz.session?.peers.size === x, n, {timeout: 60000})
const uid = p => p.evaluate(() => window.telsiz.me.uid)
const say = (p, t) => p.evaluate(x => window.telsiz.session.sendText('genel', x), t)
const has = (p, t) => p.evaluate(x => [...window.telsiz.session.view.byId.values()].some(m => m.text === x), t)
const hear = (p, t) => p.waitForFunction(x => [...(window.telsiz.session?.view.byId.values() ?? [])].some(m => m.text === x), t, {timeout: 30000})

const mert = await open('Mert'), ali = await open('Ali'), veli = await open('Veli'), can = await open('Can')
await mert.getByLabel('Grup adı').fill('Kanka')
await mert.getByRole('button', {name: 'Kur'}).click()
const first = await code(mert)
for (const p of [ali, veli, can]) await join(p, first)
for (const p of [mert, ali, veli, can]) await peers(p, 3)
await say(mert, 'eski mesaj')
await ali.waitForFunction(() => window.telsiz.session.view.people.size === 4, null, {timeout: 15000})
check(true, 'hiç yazmayan da üye listesinde')
for (const p of [ali, veli, can]) await hear(p, 'eski mesaj')

const [aliId, veliId] = [await uid(ali), await uid(veli)]
check(await mert.evaluate(() => window.telsiz.session.view.owner === window.telsiz.me.uid), 'kuran kişi kurucu')
await veli.evaluate(u => window.telsiz.session.setRole(u, 'admin'), veliId)
await veli.waitForTimeout(500)
check(await mert.evaluate(u => !window.telsiz.session.view.admins.has(u), veliId), 'üye kendini yönetici yapamıyor')
await mert.evaluate(u => window.telsiz.session.setRole(u, 'admin'), aliId)
await ali.waitForFunction(u => window.telsiz.session.view.admins.has(u), aliId, {timeout: 15000})
check(true, 'kurucu yönetici atadı')
await veli.evaluate(u => window.telsiz.session.kick(u), aliId)
await veli.waitForTimeout(1500)
check(await code(ali) === first && await ali.evaluate(u => !window.telsiz.session.view.banned.has(u), aliId), 'üye kimseyi atamıyor')

// Can kapalıyken atma olur.
await can.goto('about:blank')
await peers(ali, 2)
await ali.getByRole('button', {name: 'Ayarlar'}).click()
await ali.getByRole('tab', {name: 'Üyeler ve yetkiler'}).click()
await ali.getByRole('button', {name: 'At', exact: true}).first().click()
check(await ali.getByText('Can çevrimdışı').waitFor({timeout: 10000}).then(() => true, async () => { console.log(await ali.locator('.roster').innerText()); return false }), 'kapalı üye için uyarı çıkıyor')
await ali.getByRole('button', {name: 'Vazgeç'}).click()
await ali.getByRole('button', {name: 'Kapat'}).click()
await ali.evaluate(u => { void window.telsiz.session.kick(u) }, veliId)
await mert.waitForFunction(c => window.telsiz.active !== c, first, {timeout: 15000})
await ali.waitForFunction(c => window.telsiz.active !== c, first, {timeout: 15000})
await veli.waitForFunction(() => window.telsiz.groups.length === 0, null, {timeout: 15000})
const next = await code(mert)
check(next !== first && await code(ali) === next, 'kalanlar yeni koda geçti')
check(await veli.evaluate(() => window.telsiz.groups.length) === 0, 'atılan gruptan düştü')
await peers(mert, 1)
check(await has(mert, 'eski mesaj') && await has(ali, 'eski mesaj'), 'geçmiş yeni kodda duruyor')
await say(ali, 'yeni odada')
await hear(mert, 'yeni odada')
check(true, 'yeni odada yazışma sürüyor')

await join(veli, first)
await veli.waitForTimeout(4000)
check(await veli.evaluate(() => window.telsiz.session.peers.size) === 0 && !await has(veli, 'yeni odada'), 'atılan eski linkle kimseye ulaşamıyor')

// Can geri döner: eski grup boş, yeni linkle tek gruba iner.
await can.goto(URL)
await can.waitForFunction(() => window.telsiz.groups.length === 1, null, {timeout: 15000})
await say(can, 'can eski odada')
await can.getByRole('button', {name: 'Grup ekle'}).click()
await join(can, next)
await hear(can, 'yeni odada')
await can.waitForFunction(() => window.telsiz.groups.length === 1, null, {timeout: 15000})
await hear(can, 'can eski odada')
check(await has(can, 'eski mesaj'), 'kapalı üye yeni linkle tek gruba indi, eski mesajları da duruyor')

await peers(mert, 2)
await mert.evaluate(() => { void window.telsiz.session.wipe() })
for (const p of [mert, ali, can]) await p.waitForFunction(() => window.telsiz.groups.length === 0, null, {timeout: 15000})
const left = await ali.evaluate(c => new Promise(res => { const r = indexedDB.open('telsiz', 1); r.onsuccess = () => { const q = r.result.transaction('events').objectStore('events').index('g').count(c); q.onsuccess = () => res(q.result) } }), next)
check(left === 0, 'silinen grup herkesin cihazından kalktı')
await browser.close()
