// CS2 maç bilgisi (GSI): sahte Steam klasörüne cfg kurulur, oyunun yerine sahte POST'lar atılır.
// Electron'daki kişinin takımı/canı Chrome'daki arkadaşın kutusunda, harita ve skor başlıkta görünmeli.
// Önce `npx vite preview --port 4173` açık olmalı. Kurulu Telsiz açık olabilir: ayrı profil ve ayrı port kullanılır.
import {_electron as electron, chromium} from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const check = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1 }
const URL = 'http://localhost:4173/'
const PORT = 31983
const T = {timeout: 30000}

// Sahte Steam: kütüphane 2'de CS2 var.
const root = path.resolve('e2e/out/cs-steam')
fs.rmSync(root, {recursive: true, force: true})
const steam = path.join(root, 'Steam'), lib = path.join(root, 'Oyunlar')
const cfgDir = path.join(lib, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg')
fs.mkdirSync(path.join(steam, 'steamapps'), {recursive: true})
fs.mkdirSync(cfgDir, {recursive: true})
const esc = p => p.replace(/\\/g, '\\\\')
fs.writeFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${esc(steam)}"\n\t\t"apps"\n\t\t{\n\t\t\t"228980"\t\t"1"\n\t\t}\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"${esc(lib)}"\n\t\t"apps"\n\t\t{\n\t\t\t"730"\t\t"38000000"\n\t\t}\n\t}\n}\n`)

const dir = path.resolve('desktop')
const app = await electron.launch({
  executablePath: path.join(dir, 'node_modules/electron/dist/electron.exe'),
  args: [dir, '--user-data-dir=' + path.resolve('e2e/out/electron-profile'), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  cwd: dir,
  env: {...process.env, TELSIZ_URL: URL, TELSIZ_GSI_PORT: String(PORT), TELSIZ_STEAM_PATH: steam},
})
const w = await app.firstWindow()
w.on('pageerror', e => check(false, 'Electron sayfa hatası: ' + e.message))
await w.waitForLoadState()
await w.waitForFunction(() => window.telsiz)
if (!(await w.evaluate(() => window.telsiz.me.name))) {
  await w.getByLabel('Takma adın').fill('Masaustu')
  await w.getByRole('button', {name: 'Devam'}).click()
}
if (!(await w.evaluate(() => window.telsiz.groups.length))) await w.getByRole('button', {name: 'Kur'}).click()
await w.waitForFunction(() => window.telsiz.active)
const ui0 = await w.evaluate(() => window.telsiz.prefs.ui)
await w.evaluate(() => { window.telsiz.prefs.ui = 'klasik'; window.telsiz.savePrefs() })
const code = await w.evaluate(() => window.telsiz.active)

// Ayarlar > Oyun: kur düğmesi.
await w.getByRole('button', {name: 'Ayarlar', exact: true}).first().click()
await w.getByRole('tab', {name: 'Oyun'}).click()
const setupBtn = w.getByRole('button', {name: /CS2 bağlantısını (kur|yenile)/})
check(await setupBtn.isVisible(), 'Windows uygulamasında kur düğmesi var')
await setupBtn.click()
await w.getByText(/Kuruldu|yenilendi/).waitFor(T)
const cfgFile = path.join(cfgDir, 'gamestate_integration_telsiz.cfg')
check(fs.existsSync(cfgFile), 'cfg, libraryfolders.vdf içindeki CS2 kütüphanesine yazıldı')
const cfg = fs.readFileSync(cfgFile, 'utf8')
const token = /"token"\s+"([0-9a-f]+)"/.exec(cfg)?.[1]
check(!!token && token.length >= 32, 'rastgele token yazıldı')
check(cfg.includes(`"uri" "http://127.0.0.1:${PORT}/"`), 'adres sadece 127.0.0.1')
check(/"heartbeat" "10/.test(cfg) && /"throttle"/.test(cfg), 'throttle ve heartbeat var')
await w.keyboard.press('Escape')

const post = async (body, tok = token) => (await fetch(`http://127.0.0.1:${PORT}/`, {method: 'POST', body: JSON.stringify({...body, auth: {token: tok}})})).status
const ME = '76561190000000001'
const game = (hp, team = 'CT', extra = {}) => ({
  provider: {name: 'Counter-Strike 2', appid: 730, steamid: ME},
  map: {mode: 'competitive', name: 'de_mirage', phase: 'live', round: 12, team_ct: {score: 7}, team_t: {score: 5}},
  round: {phase: 'live'},
  player: {steamid: ME, name: 'mert', team, activity: 'playing', state: {health: hp, armor: 100}},
  ...extra,
})

check(await post(game(87), 'yanlis') === 403, 'yanlış token reddedildi')
check(await w.evaluate(() => !window.telsiz.cs), 'yanlış token veriyi geçirmedi')

// Chrome'daki arkadaş gruba girer, ikisi de sese.
const browser = await chromium.launch({channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']})
const p = await (await browser.newContext({viewport: {width: 1280, height: 800}, permissions: ['microphone', 'camera']})).newPage()
p.on('pageerror', e => check(false, 'Chrome sayfa hatası: ' + e.message))
await p.goto(URL)
await p.getByLabel('Takma adın').fill('Arkadas')
await p.getByRole('button', {name: 'Devam'}).click()
await p.getByLabel('Davet linki ya da kod').fill(`https://x/#/katil/${code}`)
await p.getByRole('button', {name: 'Katıl', exact: true}).click()
await p.waitForFunction(() => window.telsiz.session?.peers.size >= 1, null, {timeout: 60000})
const myUid = await w.evaluate(() => window.telsiz.me.uid)
await w.evaluate(() => window.telsiz.joinVoice(false, false, ''))
await p.evaluate(() => window.telsiz.joinVoice(false, false, ''))
await w.evaluate(() => window.telsiz.go({kind: 'voice'}))
await p.evaluate(() => window.telsiz.go({kind: 'voice'}))

// Arkadaşın Chrome'da gördüğü Electron kişisinin cs durumu.
const peerCs = uid => p.evaluate(uid => [...window.telsiz.session.peers.values()].find(x => x.uid === uid)?.voice.cs ?? null, uid)
const waitPeer = (fn, arg) => p.waitForFunction(([src, uid, arg]) => {
  const cs = [...window.telsiz.session.peers.values()].find(x => x.uid === uid)?.voice.cs
  return new Function('cs', 'arg', src)(cs, arg)
}, [fn, myUid, arg], T).then(() => true, () => false)

check(await post(game(87)) === 200, 'doğru token kabul edildi')
await w.waitForFunction(() => window.telsiz.cs?.hp === 87, null, T)
check(await w.locator('.tile .tilecs').first().textContent() === 'CT · 87 can', 'kendi kutumda "CT · 87 can"')
check((await w.locator('.topbar .csscore').textContent()).includes('Mirage · CT 7 – 5 T · 13. tur'), 'klasik üst çubukta harita ve skor')
check(await waitPeer('return cs && cs.hp === 87 && cs.team === "CT"'), 'arkadaşa presence ile gitti')
await p.locator('.tilecs', {hasText: 'CT · 87 can'}).waitFor(T)
check(true, 'arkadaşın ekranında kutuda "CT · 87 can"')
check((await p.locator('.topbar .csscore').textContent()).includes('CT 7 – 5 T'), 'arkadaşın üst çubuğunda skor')
await w.screenshot({path: 'e2e/out/cs-electron.png'})

// Sık gelen veri: duyuru sınırlı, son değer yine de gider.
await w.evaluate(() => { const s = window.telsiz.session; window.__ann = 0; const a = s.announce.bind(s); s.announce = () => { window.__ann++; a() } })
for (let hp = 80; hp > 60; hp--) { await post(game(hp)); await new Promise(r => setTimeout(r, 50)) }
await w.waitForTimeout(2500)
const ann = await w.evaluate(() => window.__ann)
check(ann <= 3, `20 güncellemede ${ann} duyuru (sınırlı)`)
check(await waitPeer('return cs && cs.hp === 61'), 'son can (61) arkadaşa ulaştı')

// Ölünce: "öldü", kutu soluk. Başkasını izlerken gelen veri kendi durumunu bozmaz.
await post(game(0))
check(await waitPeer('return cs && cs.alive === false'), 'ölüm arkadaşa gitti')
await p.locator('.tile.csdead .tilecs', {hasText: 'öldü'}).waitFor(T)
const faded = await p.locator('.tile.csdead').first().evaluate(el => getComputedStyle([...el.children].find(c => !c.matches('.tilebar, .tileact'))).opacity)
check(+faded < 1, `ölen kişi soluk (opaklık ${faded})`)
await p.screenshot({path: 'e2e/out/cs-arkadas-oldu.png'})
await post(game(100, 'T', {player: {steamid: '76561190000000999', team: 'T', state: {health: 100}}}))
check(await waitPeer('return cs && !cs.team && cs.map === "de_mirage"'), 'izleyiciyken başkasının canı benimki sanılmıyor')

// Frekans arayüzünde başlıkta skor.
await w.evaluate(() => { window.telsiz.prefs.ui = 'frekans'; window.telsiz.savePrefs() })
await w.locator('.fq').waitFor()
await w.locator('.fq-head .csscore').waitFor(T)
check((await w.locator('.fq-head .csscore').textContent()).includes('Mirage'), 'Frekans başlığında harita ve skor')
await w.screenshot({path: 'e2e/out/cs-frekans.png'})
await w.evaluate(() => { window.telsiz.prefs.ui = 'klasik'; window.telsiz.savePrefs() })

// Maçtan çıkınca (menü: harita yok) temizlenir.
await post(game(100))
await waitPeer('return cs && cs.hp === 100')
await post({provider: {steamid: ME}, player: {steamid: ME, activity: 'menu'}})
check(await waitPeer('return !cs'), 'maçtan çıkınca arkadaşta da silindi')
check(await p.locator('.tilecs').count() === 0, 'kutudan yazı kalktı')

// 30 sn veri gelmezse temizlenir (saat geri alınarak).
await post(game(55))
check(await waitPeer('return cs && cs.hp === 55'), 'yeniden maçta')
await w.evaluate(() => { window.telsiz.csAt = Date.now() - 31_000 })
check(await waitPeer('return !cs'), '30 sn sessizlikte silindi')

// Sesten çıkınca cs duyurulmaz.
await post(game(42))
await w.waitForFunction(() => window.telsiz.cs?.hp === 42, null, T)
await w.evaluate(() => window.telsiz.liveCall()?.leave())
check(await p.waitForFunction(uid => { const x = [...window.telsiz.session.peers.values()].find(x => x.uid === uid); return x && !x.voice.in && !x.voice.cs }, myUid, T).then(() => true, () => false), 'ses dışındayken cs gitmiyor')

// Tarayıcıda kur düğmesi yok.
await p.getByRole('button', {name: 'Ayarlar', exact: true}).first().click()
await p.getByRole('tab', {name: 'Oyun'}).click()
check(await p.getByRole('button', {name: /CS2 bağlantısını/}).count() === 0, 'tarayıcıda kur düğmesi görünmüyor')

await post({provider: {steamid: ME}})
await w.evaluate(ui => { window.telsiz.prefs.ui = ui; window.telsiz.savePrefs() }, ui0)
console.log(process.exitCode ? 'HATA' : 'TAMAM')
await browser.close()
await app.close()
