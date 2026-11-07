// CS2 Game State Integration: Valve'ın resmi yolu. Oyun, cfg klasöründeki dosyayı görünce durumunu
// buraya POST eder. Oyunun belleğine ya da dosyalarına başka hiçbir şekilde dokunulmaz (VAC riski yok).
// Sunucu sadece 127.0.0.1'i dinler, her istek cfg'ye yazılan rastgele token ile doğrulanır.
const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {execFile} = require('child_process')

const PORT = +(process.env.TELSIZ_GSI_PORT || 31982)
const CFG_NAME = 'gamestate_integration_telsiz.cfg'

// Oyunun JSON'undan sadece gereken alanlar. Başkasını izlerken (ölüyken) player o kişidir, alınmaz.
function reduce(d) {
  const me = d?.provider?.steamid
  const p = d?.player
  const mine = p && typeof me === 'string' && p.steamid === me
  const m = d?.map
  const hp = mine ? p.state?.health : undefined
  return {
    steamid: typeof me === 'string' ? me : undefined,
    player: mine ? {team: p.team, health: typeof hp === 'number' ? hp : undefined, alive: typeof hp === 'number' ? hp > 0 : undefined} : null,
    map: m && typeof m.name === 'string' ? {name: m.name, phase: m.phase, round: m.round, ct: m.team_ct?.score, t: m.team_t?.score} : null,
    round: typeof d?.round?.phase === 'string' ? d.round.phase : null,
  }
}

function startServer(getToken, send) {
  const srv = http.createServer((req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    let body = '', big = false
    req.setEncoding('utf8')
    req.on('data', c => { body += c; if (body.length > 256 * 1024) { big = true; req.destroy() } })
    req.on('end', () => {
      if (big) return
      let d = null
      try { d = JSON.parse(body) } catch { /* bozuk */ }
      const token = getToken()
      if (!d || !token || d.auth?.token !== token) { res.writeHead(403).end(); return }
      res.writeHead(200).end()
      send(reduce(d))
    })
  })
  srv.on('error', e => console.log('gsi-error', e.code || e.message))
  srv.listen(PORT, '127.0.0.1')
  return srv
}

// Steam'in yolu kayıt defterinde. Test için TELSIZ_STEAM_PATH ile verilebilir.
function steamPath() {
  if (process.env.TELSIZ_STEAM_PATH) return Promise.resolve(process.env.TELSIZ_STEAM_PATH)
  return new Promise(ok => execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {windowsHide: true}, (err, out) => {
    const m = !err && /SteamPath\s+REG_SZ\s+(.+)/i.exec(out)
    ok(m ? m[1].trim() : null)
  }))
}

// libraryfolders.vdf: her kütüphanenin yolu ve içindeki oyunlar. 730 = CS2.
function libraries(steam) {
  let vdf = ''
  try { vdf = fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8') } catch { /* yok */ }
  const libs = []
  const re = /"path"\s+"([^"]+)"/g
  let m, last = null
  while ((m = re.exec(vdf))) {
    if (last) last.text = vdf.slice(last.at, m.index)
    last = {path: m[1].replace(/\\\\/g, '\\'), at: m.index, text: ''}
    libs.push(last)
  }
  if (last) last.text = vdf.slice(last.at)
  const withCs = libs.filter(l => /"apps"[\s\S]*?"730"\s+"/.test(l.text)).map(l => l.path)
  // Önce 730'u listeleyen kütüphaneler, sonra diğerleri ve Steam'in kendi klasörü (vdf eskiyse).
  return [...new Set([...withCs, ...libs.map(l => l.path), steam])]
}

function cfgText(token) {
  return `"Telsiz"
{
  "uri" "http://127.0.0.1:${PORT}/"
  "timeout" "5.0"
  "buffer" "0.5"
  "throttle" "1.0"
  "heartbeat" "10.0"
  "auth"
  {
    "token" "${token}"
  }
  "data"
  {
    "provider" "1"
    "map" "1"
    "round" "1"
    "player_id" "1"
    "player_state" "1"
  }
}
`
}

// Sonuç: {ok: true, path, existed} ya da {ok: false, reason: 'steam' | 'cs2' | 'write'}.
async function setup(token) {
  const steam = await steamPath()
  if (!steam || !fs.existsSync(steam)) return {ok: false, reason: 'steam'}
  const dir = libraries(steam).map(l => path.join(l, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg')).find(d => fs.existsSync(d))
  if (!dir) return {ok: false, reason: 'cs2'}
  const file = path.join(dir, CFG_NAME)
  const existed = fs.existsSync(file)
  try { fs.writeFileSync(file, cfgText(token)) } catch { return {ok: false, reason: 'write'} }
  return {ok: true, path: file, existed}
}

// Token kullanıcının bilgisayarında üretilir ve orada kalır.
function tokenStore(file) {
  let data = {}
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {} } catch { /* yok */ }
  return {
    get: () => typeof data.token === 'string' ? data.token : null,
    ensure() {
      if (typeof data.token !== 'string') { data = {...data, token: crypto.randomBytes(24).toString('hex')}; try { fs.writeFileSync(file, JSON.stringify(data)) } catch { /* yok */ } }
      return data.token
    },
    mark(p) { data = {...data, path: p}; try { fs.writeFileSync(file, JSON.stringify(data)) } catch { /* yok */ } },
    status: () => ({set: typeof data.path === 'string' && fs.existsSync(data.path)}),
  }
}

module.exports = {reduce, startServer, setup, tokenStore, libraries, PORT}
