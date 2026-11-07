// Tanıtım kaydı için sahte arkadaşlar: Ece, Burak ve Deniz görünmez tarayıcıda gruba girer.
// Kullanım: node tanitim/demo-arkadaslar.mjs "<davet linki>"   (URL=http://localhost:4173/ ile yerel sürüm)
// Her Enter bir sonraki adımı yapar. Sahte mikrofonlar bip çalar, hoparlörü kıs.
import {chromium} from 'playwright-core'
import {createInterface} from 'node:readline/promises'

const link = process.argv[2]
if (!link || !link.includes('/katil/')) { console.log('Davet linkini ver: node tanitim/demo-arkadaslar.mjs "https://.../#/katil/KOD"'); process.exit(1) }
const URL = process.env.URL ?? 'https://necatimertmetin.github.io/telsiz/'
const rl = createInterface({input: process.stdin, output: process.stdout})
const step = async m => { await rl.question(`\n> ${m} (Enter)`) }
const wait = ms => new Promise(r => setTimeout(r, ms))

const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const friend = async name => {
  const ctx = await browser.newContext({viewport: {width: 1280, height: 800}, permissions: ['microphone', 'camera']})
  const p = await ctx.newPage()
  await p.goto(URL)
  await p.getByLabel('Takma adın').fill(name)
  await p.getByRole('button', {name: 'Devam'}).click()
  await p.getByLabel('Davet linki ya da kod').fill(link)
  await p.getByRole('button', {name: 'Katıl', exact: true}).click()
  await p.waitForFunction(() => window.telsiz.session?.peers.size > 0, null, {timeout: 90000})
  console.log(`${name} grupta`)
  return p
}
const say = (p, text, ch = 'genel') => p.evaluate(([t, c]) => window.telsiz.session.sendText(c, t), [text, ch])
const voice = (p, muted) => p.evaluate(m => { window.telsiz.go({kind: 'voice'}); return window.telsiz.joinVoice(false, m, '') }, muted)

const [ece, burak, deniz] = await Promise.all(['Ece', 'Burak', 'Deniz'].map(friend))

await step('Genel kanala mesajlar gelsin')
await say(ece, 'bu akşam kim var?'); await wait(1500)
await say(burak, "10'da 90.0'dayım"); await wait(1800)
await say(deniz, 'ben de geliyorum, kafam yandı bugün'); await wait(1500)
await say(ece, 'link attım, girin')

await step('Ece ve Burak sese girsin (Burak konuşuyor görünür, Ece sessiz)')
await voice(burak, false)
await voice(ece, true)

await step('Deniz de sese girsin (sessiz)')
await voice(deniz, true)

await step('Burak susar, Ece konuşur')
await burak.evaluate(() => window.telsiz.liveCall()?.toggleMute())
await ece.evaluate(() => window.telsiz.liveCall()?.toggleMute())

await step('Herkes çıksın, betik kapansın')
await browser.close()
rl.close()
