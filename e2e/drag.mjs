// Yönetici çevrimiçi üyeyi sürükleyip ses odasına alır; kenar çubukları kapanıp açılır.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const open = async name => {
  const p = await (await browser.newContext({viewport: {width: 1300, height: 800}, permissions: ['microphone', 'camera']})).newPage()
  p.on('pageerror', e => check(false, `${name} sayfa hatası: ${e.message}`))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const T = {timeout: 30000}
const mert = await open('Mert'), ali = await open('Ali'), veli = await open('Veli')
await mert.getByLabel('Grup adı').fill('Kanka')
await mert.getByRole('button', {name: 'Kur'}).click()
const code = await mert.evaluate(() => window.telsiz.active)
for (const p of [ali, veli]) {
  await p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
  await p.getByRole('button', {name: 'Katıl', exact: true}).click()
}
for (const p of [mert, ali, veli]) await p.waitForFunction(() => window.telsiz.session?.peers.size === 2, null, {timeout: 60000})
await mert.evaluate(() => window.telsiz.session.makeRoom('Strateji'))
await ali.waitForFunction(() => window.telsiz.session.view.rooms.some(r => r.title === 'Strateji'), null, T)

// Ali seste: kurucu onu Strateji odasına sürükler, Ali oraya geçer.
await ali.evaluate(() => window.telsiz.joinVoice(false, false, ''))
await mert.waitForFunction(() => [...window.telsiz.session.peers.values()].some(p => p.voice.in), null, T)
const room = mert.locator('.chan', {hasText: 'Strateji'})
await mert.locator('.right .member', {hasText: 'Ali'}).dragTo(room)
await ali.waitForFunction(() => window.telsiz.session.voice.room !== '' && window.telsiz.session.view.rooms.find(r => r.id === window.telsiz.session.voice.room)?.title === 'Strateji', null, T)
check(true, 'sesteki Ali sürüklenince Strateji odasına geçti')

// Veli seste değil: sürüklenince çağrı alır.
await mert.locator('.right .member', {hasText: 'Veli'}).dragTo(room)
await veli.locator('.ring', {hasText: 'Strateji'}).waitFor(T)
check(true, 'seste olmayan Veli çağrı aldı')

// Üye sürükleyemez. Takım dağıtma yetkisi yöneticilere kısılınca üyenin taşıma isteği de yok sayılır.
check(await ali.locator('.right .member[draggable=true]').count() === 0, 'üyede sürükleme yok')
const vuid = await veli.evaluate(() => window.telsiz.me.uid)
const rid = await ali.evaluate(() => window.telsiz.session.view.rooms[0].id)
await veli.evaluate(() => { window.telsiz.ring = null })
await veli.evaluate(() => window.telsiz.joinVoice(false, false, ''))
await mert.evaluate(() => window.telsiz.session.emit({t: 'perm', key: 'teams', who: 'admin'}))
await ali.waitForFunction(() => window.telsiz.session.view.perms.teams === 'admin', null, T)
await ali.evaluate(([u, r]) => window.telsiz.session.sendMove({[u]: r}), [vuid, rid])
await veli.waitForTimeout(1500)
check(await veli.evaluate(() => window.telsiz.session.voice.room) === '', 'üyenin taşıma isteği yok sayıldı')

// Kenar çubukları
await mert.getByRole('button', {name: 'Kanalları gizle'}).click()
check(!(await mert.locator('.side').isVisible()), 'kanallar gizlendi')
await mert.getByRole('button', {name: 'Üyeleri gizle'}).click()
check(!(await mert.locator('.right').isVisible()), 'üyeler gizlendi')
await mert.screenshot({path: 'e2e/out/drag-hidden.png'})
await mert.reload()
await mert.getByRole('button', {name: 'Kanalları göster'}).waitFor(T)
check(!(await mert.locator('.side').isVisible()), 'gizli kalması hatırlandı')
await mert.getByRole('button', {name: 'Kanalları göster'}).click()
await mert.getByRole('button', {name: 'Üyeleri göster'}).click()
check(await mert.locator('.side').isVisible() && await mert.locator('.right').isVisible(), 'ikisi de geri açıldı')
await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
