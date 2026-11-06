// Üç tarayıcı: A ile C birbirine bağlanamıyor, B ikisine de bağlı. Ses B üzerinden geçmeli.
// Kullanım: önce `npx vite preview --port 4173`, sonra `node e2e/relay.mjs`
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const pass = m => console.log('OK  ', m)
const fail = m => { console.log('FAIL', m); process.exitCode = 1 }
const check = (c, m) => c ? pass(m) : fail(m)
const waitFor = async (fn, ms, label) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 300)) }
  fail(label)
  return false
}

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
})

const open = async (name, uid, block) => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}})
  const page = await ctx.newPage()
  page.on('pageerror', e => fail(`${name} sayfa hatası: ${e.message}`))
  await page.addInitScript(([u, n, bl]) => {
    if (!localStorage.getItem('telsiz.block')) {
      localStorage.setItem('telsiz.me', JSON.stringify({uid: u, name: n}))
      localStorage.setItem('telsiz.block', bl)
    }
  }, [uid, name, block])
  await page.goto(URL)
  return {name, ctx, page}
}

const [ua, ub, uc] = ['aaaaaaaa2222', 'bbbbbbbb2222', 'cccccccc2222']
const A = await open('A', ua, uc)
const B = await open('B', ub, '')
const C = await open('C', uc, ua)

await A.page.getByLabel('Grup adı').fill('Aktarma')
await A.page.getByRole('button', {name: 'Kur'}).click()
const code = await A.page.evaluate(() => window.telsiz.active)
for (const u of [B, C]) {
  await u.page.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
  await u.page.getByRole('button', {name: 'Katıl'}).click()
}

const direct = u => u.page.evaluate(() => [...window.telsiz.session.peers.values()].map(p => p.name))
const ind = u => u.page.evaluate(() => [...window.telsiz.session.indirect().values()].map(p => p.name + '/' + p.via))
await waitFor(async () => (await direct(B)).length === 2, 60000, 'B ikisine bağlanamadı') && pass('B ikisine de bağlı')
await waitFor(async () => (await ind(A)).includes('C/B') && (await ind(C)).includes('A/B'), 30000, 'dolaylı kişi görünmedi') && pass('A, C yi B üzerinden görüyor; C de A yı')
check((await direct(A)).length === 1 && (await direct(C)).length === 1, 'A ile C doğrudan bağlı değil')

for (const u of [A, B, C]) await u.page.evaluate(() => window.telsiz.joinVoice())
const relayed = u => u.page.evaluate(() => [...window.telsiz.session.indirect().keys()].filter(k => window.telsiz.call?.hasRelay(k)).length)
await waitFor(async () => await relayed(A) === 1 && await relayed(C) === 1, 40000, 'aktarılan ses gelmedi') && pass('iki taraf da aktarılan sesi aldı')

// Gerçekten ses geliyor mu: aktarılan akışın seviyesi ölçülür.
// Sahte mikrofon saniyede bir kısa bip verir, o yüzden tek ölçüm değil birkaç saniyelik gözlem gerekir.
const level = u => u.page.evaluate(async () => {
  const call = window.telsiz.call
  const [uid] = [...window.telsiz.session.indirect().keys()]
  for (let i = 0; i < 80; i++) {
    if (call.speaking.has('r:' + uid)) return true
    await new Promise(r => setTimeout(r, 100))
  }
  return false
})
check(await level(C), 'C, A nın sesini B üzerinden duyuyor')
await A.page.screenshot({path: 'e2e/out/relay.png'})

// Bağlantı kopup gelince görüşme sürmeli.
await A.ctx.setOffline(true)
await new Promise(r => setTimeout(r, 4000))
await A.ctx.setOffline(false)
await waitFor(async () => (await direct(A)).length >= 1 && await A.page.evaluate(() => window.telsiz.session.voice.in), 45000, 'A bağlantı dönünce geri gelmedi') && pass('A kısa kesintiden sonra döndü')
await waitFor(() => A.page.evaluate(() => [...window.telsiz.call.remote.values()].some(r => r.mic)), 20000, 'A kesintiden sonra ses almıyor') && pass('A kesintiden sonra yine ses alıyor')

// Klip: 30 saniyeden sonra kaydedilen dosya sohbete düşer.
await B.page.evaluate(() => window.telsiz.call.toggleClip())
await new Promise(r => setTimeout(r, 33000))
await B.page.evaluate(() => window.telsiz.saveClip())
const clip = await B.page.evaluate(async () => {
  await new Promise(r => setTimeout(r, 1500))
  const m = [...window.telsiz.session.view.byId.values()].find(x => x.file?.name.startsWith('klip-'))
  return m ? {name: m.file.name, size: m.file.size} : null
})
check(!!clip && clip.size > 20000, `klip sohbete düştü (${clip?.size} bayt)`)
await B.page.evaluate(() => window.telsiz.call.toggleClip())

// Sayfa yenilenince sese dönüş önerilir.
await B.page.reload()
await waitFor(() => B.page.getByRole('button', {name: /geri dön/}).isVisible().catch(() => false), 15000, 'geri dön düğmesi çıkmadı') && pass('yenileyince sese dönüş önerildi')

await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
