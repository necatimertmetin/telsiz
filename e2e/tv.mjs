// Birlikte izleme: gerçek YouTube oynatıcısı, üç tarayıcı. İnternet gerekir.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const pass = m => console.log('OK  ', m)
const fail = m => { console.log('FAIL', m); process.exitCode = 1 }
const check = (c, m) => c ? pass(m) : fail(m)
const waitFor = async (fn, ms, label) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 300)) }
  fail(label)
  return false
}
const wait = ms => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const open = async name => {
  const ctx = await browser.newContext({viewport: {width: 1400, height: 900}})
  const p = await ctx.newPage()
  p.on('pageerror', e => fail(`${name} sayfa hatası: ${e.message}`))
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  return p
}
const time = p => p.evaluate(() => window.__tv?.getCurrentTime?.() ?? -1)
const state = p => p.evaluate(() => window.__tv?.getPlayerState?.() ?? -9)
const tv = p => p.evaluate(() => { const t = window.telsiz.session.tv; return {n: t.queue.length, idx: t.idx, playing: t.playing, title: t.queue[t.idx]?.title} })

const [a, b] = [await open('Mert'), await open('Ali')]
await a.getByLabel('Grup adı').fill('Sinema')
await a.getByRole('button', {name: 'Kur'}).click()
const code = await a.evaluate(() => window.telsiz.active)
await b.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await b.getByRole('button', {name: 'Katıl'}).click()
await waitFor(() => a.evaluate(() => window.telsiz.session.peers.size === 1), 60000, 'bağlanmadı')
for (const p of [a, b]) await p.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })

// Oda sohbeti: gruptaki metin kanallarına karışmaz.
await a.getByRole('textbox', {name: 'Mesaj'}).fill('oda selam')
await a.keyboard.press('Enter')
await waitFor(() => b.getByText('oda selam').isVisible(), 10000, 'oda sohbeti görünmedi') && pass('oda sohbeti yanda görünüyor')
check(await b.evaluate(() => !(window.telsiz.session.view.msgs.get('genel') ?? []).some(m => m.text === 'oda selam')), 'genel kanala düşmedi')

// Sohbete link yazınca iki tarafta da açılır.
await a.getByRole('textbox', {name: 'Mesaj'}).fill('https://www.youtube.com/watch?v=aqz-KE-bpKQ')
await a.keyboard.press('Enter')
await waitFor(async () => (await tv(b)).n === 1, 10000, 'sıra karşıya gitmedi') && pass('link sıraya girdi, karşı tarafta göründü')
await waitFor(async () => await state(a) === 1 && await state(b) === 1, 40000, 'video oynamadı') && pass('video iki tarafta da oynuyor')
await waitFor(async () => (await tv(b)).title?.includes('Big Buck'), 10000, 'başlık gelmedi') && pass('başlık geldi')
await wait(2500)
const diff = Math.abs(await time(a) - await time(b))
check(diff < 2, `iki taraf aynı yerde (fark ${diff.toFixed(2)} sn)`)
await a.screenshot({path: 'e2e/out/tv.png'})

// Durdurma ve sarma herkeste.
await b.getByRole('button', {name: 'Durdur', exact: true}).click()
await waitFor(async () => await state(a) === 2, 8000, 'durdurma yansımadı') && pass('Ali durdurdu, Mertte de durdu')
await a.getByRole('button', {name: 'Oynat', exact: true}).click()
await waitFor(async () => await state(b) === 1, 8000, 'oynatma yansımadı') && pass('Mert başlattı, Alide de başladı')
await a.evaluate(() => window.telsiz.session.tvDo({a: 'seek', pos: 120}))
await waitFor(async () => Math.abs(await time(b) - 120) < 4, 12000, 'sarma yansımadı') && pass('ileri sarma karşıya yansıdı')

// Geç gelen aynı yere iner.
const c = await open('Veli')
await c.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await c.getByRole('button', {name: 'Katıl'}).click()
await waitFor(() => c.evaluate(() => window.telsiz.session.peers.size === 2), 60000, 'üçüncü bağlanmadı')
await c.evaluate(() => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice() })
await waitFor(async () => await state(c) === 1, 40000, 'geç gelende oynamadı')
await wait(3000)
const late = Math.abs(await time(a) - await time(c))
check(late < 2.5, `geç gelen aynı yerde (fark ${late.toFixed(2)} sn)`)

// Sıra: listeye ekle, sonrakine geç, bitince kapan.
await b.evaluate(() => window.telsiz.session.tvAddLink('https://youtu.be/M7lc1UVf-VE', 'Ali'))
await waitFor(async () => (await tv(a)).n === 2, 8000, 'ikinci video sıraya girmedi') && pass('ikinci video sıraya girdi')
await a.getByRole('button', {name: 'Sonraki'}).click()
await waitFor(async () => (await tv(c)).idx === 1 && await c.evaluate(() => window.__tv.getVideoData().video_id === 'M7lc1UVf-VE'), 15000, 'sonrakine geçmedi') && pass('sonraki video herkeste açıldı')
await a.getByRole('tab', {name: /Liste/}).click()
await a.getByRole('button', {name: /kaldır/}).first().waitFor({timeout: 5000})
pass('liste sekmesi görünüyor')
check(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'yatay taşma yok')

await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
