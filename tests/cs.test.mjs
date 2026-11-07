// Kabuğun GSI kodu (Node) ve web tarafının cs süzgeci birlikte denenir; Node türleri tsc'ye girmesin diye .mjs.
import {describe, expect, it} from 'vitest'
import {createRequire} from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {cleanCs, csDead, csLine, csScore, fromGsi, sameCs} from '../src/lib/cs'

const require = createRequire(import.meta.url)
const gsi = require('../desktop/gsi.cjs')

const game = (over = {}) => ({
  provider: {steamid: '7656'},
  map: {name: 'de_mirage', phase: 'live', round: 12, team_ct: {score: 7}, team_t: {score: 5}},
  round: {phase: 'live'},
  player: {steamid: '7656', team: 'CT', state: {health: 87}},
  auth: {token: 'x'},
  ...over,
})

describe('gsi reduce (kabuk)', () => {
  it('kendi oyuncunu alır', () => {
    const r = gsi.reduce(game())
    expect(r.player).toEqual({team: 'CT', health: 87, alive: true})
    expect(r.map).toEqual({name: 'de_mirage', phase: 'live', round: 12, ct: 7, t: 5})
    expect(r.round).toBe('live')
  })
  it('izlenen başka oyuncuyu almaz', () => {
    expect(gsi.reduce(game({player: {steamid: '999', team: 'T', state: {health: 100}}})).player).toBeNull()
  })
  it('menüde harita yok', () => {
    expect(gsi.reduce({provider: {steamid: '7656'}, player: {steamid: '7656', activity: 'menu'}}).map).toBeNull()
  })
})

describe('cs durumu', () => {
  it('kabuk verisinden durum çıkar', () => {
    const c = fromGsi(gsi.reduce(game()))
    expect(c).toEqual({map: 'de_mirage', phase: 'live', round: 12, ct: 7, t: 5, team: 'CT', hp: 87, alive: true})
    expect(csLine(c)).toBe('CT · 87 can')
    expect(csScore(c)).toBe('Mirage · CT 7 – 5 T · 13. tur')
  })
  it('ölü', () => {
    const c = fromGsi(gsi.reduce(game({player: {steamid: '7656', team: 'T', state: {health: 0}}})))
    expect(csLine(c)).toBe('öldü')
    expect(csDead(c)).toBe(true)
  })
  it('maçtan çıkınca boş', () => {
    expect(fromGsi(gsi.reduce({provider: {steamid: '1'}}))).toBeUndefined()
    expect(fromGsi(null)).toBeUndefined()
  })
  it('izleyicide takım yazmaz ama skor kalır', () => {
    const c = fromGsi(gsi.reduce(game({player: {steamid: '9', team: 'T'}})))
    expect(csLine(c)).toBe('')
    expect(csScore(c)).toContain('Mirage')
  })
  it('arkadaştan gelen bozuk veri süzülür', () => {
    expect(cleanCs({map: 'de_x', hp: 5000, team: 'Z', alive: 'evet', round: -1, junk: 1})).toEqual({map: 'de_x'})
    expect(cleanCs({map: ''})).toBeUndefined()
    expect(cleanCs('de_dust2')).toBeUndefined()
    expect(cleanCs({map: 'a'.repeat(500)}).map.length).toBe(40)
  })
  it('karşılaştırma', () => {
    expect(sameCs(undefined, undefined)).toBe(true)
    expect(sameCs({map: 'a', hp: 1}, {map: 'a', hp: 2})).toBe(false)
  })
})

describe('cfg kurulumu', () => {
  it('libraryfolders.vdf içinden CS2 kütüphanesini bulup yazar', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-steam-'))
    const steam = path.join(root, 'Steam'), lib = path.join(root, 'Lib2')
    const cfg = path.join(lib, 'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo', 'cfg')
    fs.mkdirSync(path.join(steam, 'steamapps'), {recursive: true})
    fs.mkdirSync(cfg, {recursive: true})
    fs.writeFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"
{
  "0" { "path" "${steam.replace(/\\/g, '\\\\')}" "apps" { "228980" "1" } }
  "1" { "path" "${lib.replace(/\\/g, '\\\\')}" "apps" { "730" "123" } }
}`)
    expect(gsi.libraries(steam)[0]).toBe(lib)
    process.env.TELSIZ_STEAM_PATH = steam
    try {
      const r = await gsi.setup('tok123')
      expect(r).toMatchObject({ok: true, existed: false})
      const text = fs.readFileSync(path.join(cfg, 'gamestate_integration_telsiz.cfg'), 'utf8')
      expect(text).toContain('"token" "tok123"')
      expect(text).toContain('"uri" "http://127.0.0.1:')
      process.env.TELSIZ_STEAM_PATH = path.join(root, 'yok')
      expect(await gsi.setup('t')).toEqual({ok: false, reason: 'steam'})
      fs.rmSync(cfg, {recursive: true})
      process.env.TELSIZ_STEAM_PATH = steam
      expect(await gsi.setup('t')).toEqual({ok: false, reason: 'cs2'})
    } finally {
      delete process.env.TELSIZ_STEAM_PATH
      fs.rmSync(root, {recursive: true, force: true})
    }
  })
})
