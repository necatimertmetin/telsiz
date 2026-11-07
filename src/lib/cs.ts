// CS2 maç bilgisi: Windows uygulaması oyunun resmi Game State Integration (GSI) çıktısını dinler.
// Oyuna dokunulmaz, oyun bilgiyi kendisi 127.0.0.1'e yollar. Kişi kendi durumunu ses odasındakilere duyurur.

export type CsTeam = 'CT' | 'T'
export type CsState = {map: string; phase?: string; round?: number; ct?: number; t?: number; team?: CsTeam; hp?: number; alive?: boolean}

// Kabuğun yolladığı, oyunun JSON'undan süzülmüş hali.
export type GsiFeed = {
  steamid?: string
  player?: {team?: string; health?: number; alive?: boolean} | null
  map?: {name?: string; phase?: string; round?: number; ct?: number; t?: number} | null
  round?: string | null
}

const num = (x: unknown, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x) : undefined
const str = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 ? x.slice(0, max) : undefined
const team = (x: unknown): CsTeam | undefined => x === 'CT' || x === 'T' ? x : undefined

// Dışarıdan gelen her şey (arkadaşın presence'ı dahil) bundan geçer. Harita yoksa maç yok sayılır.
export function cleanCs(x: unknown): CsState | undefined {
  if (!x || typeof x !== 'object') return undefined
  const o = x as Record<string, unknown>
  const map = str(o.map, 40)
  if (!map) return undefined
  const out: CsState = {map}
  const phase = str(o.phase, 20), round = num(o.round, 99), ct = num(o.ct, 99), t = num(o.t, 99), tm = team(o.team), hp = num(o.hp, 100)
  if (phase) out.phase = phase
  if (round !== undefined) out.round = round
  if (ct !== undefined) out.ct = ct
  if (t !== undefined) out.t = t
  if (tm) out.team = tm
  if (hp !== undefined) out.hp = hp
  if (typeof o.alive === 'boolean') out.alive = o.alive
  return out
}

// Ana menüde haritası olmayan veri gelir: maçtan çıkıldı demektir.
export function fromGsi(f: GsiFeed | null | undefined): CsState | undefined {
  const m = f?.map
  if (!m) return undefined
  const p = f?.player
  return cleanCs({map: m.name, phase: m.phase, round: m.round, ct: m.ct, t: m.t, ...(p ? {team: p.team, hp: p.health, alive: p.alive} : {})})
}

export const sameCs = (a: CsState | undefined, b: CsState | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// Kutu yazısı: "CT · 87 can" ya da "öldü". Takım bilinmiyorsa (izleyici) boş.
export function csLine(c: CsState | undefined) {
  if (!c?.team) return ''
  if (c.alive === false || c.hp === 0) return 'öldü'
  return c.hp === undefined ? c.team : `${c.team} · ${c.hp} can`
}
export const csDead = (c: CsState | undefined) => !!c?.team && (c.alive === false || c.hp === 0)

// "Mirage · CT 7 – 5 T · 13. tur"
export function csMapName(m: string) {
  const n = m.replace(/^(de|cs|ar|dz|gd)_/, '').replace(/_/g, ' ')
  return n.charAt(0).toLocaleUpperCase('tr') + n.slice(1)
}
export function csScore(c: CsState | undefined) {
  if (!c) return ''
  const parts = [csMapName(c.map)]
  if (c.ct !== undefined && c.t !== undefined) parts.push(`CT ${c.ct} – ${c.t} T`)
  if (c.phase === 'warmup') parts.push('ısınma')
  else if (c.phase === 'gameover') parts.push('maç bitti')
  else if (c.round !== undefined) parts.push(`${c.round + 1}. tur`)
  return parts.join(' · ')
}
