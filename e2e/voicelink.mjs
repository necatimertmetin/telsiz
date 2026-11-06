// Sese davet linki. Otomatik oynatma izni bilerek verilmedi: gerçek tarayıcı gibi davransın.
import {chromium} from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const pass = m => console.log('OK  ', m)
const fail = m => { console.log('FAIL', m); process.exitCode = 1 }
const check = (c, m) => c ? pass(m) : fail(m)
const waitFor = async (fn, ms, label) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 250)) }
  fail(label)
  return false
}

const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']})
const page = async () => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}})
  const p = await ctx.newPage()
  p.on('pageerror', e => fail(`sayfa hatası: ${e.message}`))
  return p
}
const voice = p => p.evaluate(() => { const s = window.telsiz?.liveSession(); return s ? {in: s.voice.in, muted: s.voice.muted} : null })
const sends = p => p.evaluate(() => window.telsiz.liveCall()?.streams.mic?.getAudioTracks()[0]?.enabled)
const hears = (p, name) => p.evaluate(n => [...window.telsiz.session.peers.values()].some(x => x.name === n && x.voice.in), name)

const host = await page()
await host.goto(URL)
await host.getByLabel('Takma adın').fill('Mert')
await host.getByRole('button', {name: 'Devam'}).click()
await host.getByLabel('Grup adı').fill('Link')
await host.getByRole('button', {name: 'Kur'}).click()
await host.getByRole('button', {name: 'Telsiz odası'}).click()
await host.getByRole('button', {name: 'Sesli katıl'}).last().click()
await host.getByRole('button', {name: 'Sese davet linki'}).waitFor({timeout: 8000})
pass('sesteyken link düğmesi görünüyor')
const code = await host.evaluate(() => window.telsiz.active)
const link = `${URL}#/katil/${code}/ses`

// İsmi olmayan: ad sorulur, yazınca sese açık mikrofonla girer.
const b = await page()
await b.goto(link)
await b.getByText('İsmini yaz, direkt').waitFor({timeout: 8000})
pass('yeni kişiye isim soruldu')
await b.getByLabel('Takma adın').fill('Ali')
await b.getByRole('button', {name: 'Devam'}).click()
await waitFor(async () => (await voice(b))?.in, 15000, 'yeni kişi sese girmedi') && pass('isim yazınca direkt sese girdi')
check((await voice(b)).muted === false && await sends(b) === true, 'yeni kişinin mikrofonu açık')
await waitFor(() => hears(host, 'Ali'), 60000, 'Ev sahibi yeni kişiyi seste görmedi') && pass('ev sahibi onu seste gördü')

// İsmi kayıtlı, grubu tanımıyor: sorulmadan girer ama mikrofon kapalı. Sayfaya hiç dokunulmadı.
const c = await page()
await c.goto(URL)
await c.getByLabel('Takma adın').fill('Veli')
await c.getByRole('button', {name: 'Devam'}).click()
await c.goto('about:blank')
await c.goto(link)
await waitFor(async () => (await voice(c))?.in, 15000, 'kayıtlı isimli kişi sese girmedi') && pass('kayıtlı isim sorulmadı, dokunmadan sese girdi')
check((await voice(c)).muted === true && await sends(c) === false, 'tanımadığı gruba mikrofon kapalı girdi')
check(await c.evaluate(() => window.telsiz.me.name) === 'Veli', 'kayıtlı isim kullanıldı')
await waitFor(() => hears(host, 'Veli'), 60000, 'Ev sahibi kayıtlı kişiyi görmedi') && pass('ev sahibi onu seste gördü')

// Grubu tanıyan: sorulmadan, mikrofon açık.
await b.goto('about:blank')
await b.goto(link)
await waitFor(async () => (await voice(b))?.in, 15000, 'grubu tanıyan sese girmedi') && pass('grubu tanıyan sorulmadan sese girdi')
check((await voice(b)).muted === false && await sends(b) === true, 'grubu tanıyanın mikrofonu açık')

await browser.close()
console.log(process.exitCode ? 'BAŞARISIZ' : 'TAMAM')
