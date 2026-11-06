import {validJwk, type KeysJwk} from './identity'
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789'

export function randomId(len = 16): string {
  const b = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(b, x => ALPHA[x % ALPHA.length]).join('')
}

// 16 karakter ~ 79 bit: grubun tek anahtarı, tahmin edilemez olmalı.
export const newRoomCode = () => randomId(16).match(/.{4}/g)!.join('-')
const CODE = /[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}/

export function parseInvite(input: string): string | null {
  return input.trim().toLowerCase().match(CODE)?.[0] ?? null
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do { n /= 1024; i++ } while (n >= 1024 && i < u.length - 1)
  return `${n >= 100 ? Math.round(n) : n.toFixed(1).replace('.', ',')} ${u[i]}`
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('tr-TR', {hour: '2-digit', minute: '2-digit'})
}

export function fmtDay(ts: number, now = Date.now()): string {
  const d = (x: number) => new Date(x).toDateString()
  if (d(ts) === d(now)) return 'Bugün'
  if (d(ts) === d(now - 864e5)) return 'Dün'
  return new Date(ts).toLocaleDateString('tr-TR', {day: 'numeric', month: 'long', year: 'numeric'})
}

const EXT: Record<string, string> = {gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4'}

// SVG ve HTML bilerek yok: gelen dosya tarayıcıda çalıştırılmaz, sadece indirilir.
export function previewKind(f: {type: string; name: string}): 'image' | 'video' | 'audio' | null {
  const t = (f.type || EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] || '').toLowerCase()
  if (/^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(t)) return 'image'
  if (/^video\/(mp4|webm|ogg|quicktime)$/.test(t)) return 'video'
  if (/^audio\//.test(t)) return 'audio'
  return null
}

export type Token = {text: string; url?: string}
export function linkify(s: string): Token[] {
  const out: Token[] = []
  let last = 0
  for (const m of s.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = m[0].replace(/[.,;:!?)]+$/, '')
    if (m.index > last) out.push({text: s.slice(last, m.index)})
    out.push({text: url, url})
    last = m.index + url.length
  }
  if (last < s.length) out.push({text: s.slice(last)})
  return out
}

const COLORS = ['#f5a524', '#5ec26a', '#55a8e8', '#e8705f', '#b98ae8', '#3cc4b4', '#e88ac0', '#c9c25a']
export function colorFor(uid: string): string {
  let h = 0
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

export const initials = (name: string) => name.trim().slice(0, 1).toLocaleUpperCase('tr-TR') || '?'

// Seçilen kodek öne alınır, diğerleri karşı taraf desteklemezse diye listede kalır.
export function orderCodecs<T extends {mimeType: string}>(codecs: T[], first: string): T[] {
  const is = (c: T) => c.mimeType.toLowerCase() === first.toLowerCase()
  return [...codecs.filter(is), ...codecs.filter(c => !is(c))]
}

export function lowLatencySdp(sdp: string): string {
  return sdp.replace(/(a=fmtp:\d+ minptime=10[^\r\n]*\r?\n)(?!a=ptime)/g, '$1a=ptime:10\r\n')
}

export const isImageUrl = (url: string) => /^https:\/\/[^\s]+\.(gif|png|jpe?g|webp)(\?[^\s]*)?$/i.test(url)

// '1.2.0' > '1.1.9'; başındaki v ve eksik parçalar sorun değil.
export function isNewer(latest: string, current: string): boolean {
  const n = (v: string) => v.replace(/^v/, '').split('.').map(x => parseInt(x) || 0)
  const [a, b] = [n(latest), n(current)]
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

export function mentions(text: string, name: string): boolean {
  const t = text.toLocaleLowerCase('tr-TR')
  return t.includes('@herkes') || (!!name && t.includes('@' + name.toLocaleLowerCase('tr-TR')))
}

export type Backup = {uid: string; name: string; groups: {code: string; title: string}[]; color?: string; keys?: KeysJwk}

// Yedek kodu kimliği ve grup anahtarlarını taşır: hesap yerine geçer, şifre gibi saklanmalı.
export function encodeBackup(b: Backup): string {
  const bytes = new TextEncoder().encode(JSON.stringify(b))
  let bin = ''
  for (const x of bytes) bin += String.fromCharCode(x)
  return 'telsiz1.' + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeBackup(input: string): Backup | null {
  const m = input.trim().match(/telsiz1\.([A-Za-z0-9_-]+)/)
  if (!m) return null
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))
    const b = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))) as Backup
    const code = /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/
    if (typeof b.uid !== 'string' || !/^[a-z2-9]{8,64}$/.test(b.uid) || typeof b.name !== 'string' || !b.name.trim() || !Array.isArray(b.groups)) return null
    const groups = b.groups.filter(g => g && typeof g.code === 'string' && code.test(g.code)).map(g => ({code: g.code, title: String(g.title ?? 'Grup').slice(0, 40)}))
    const color = typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : undefined
    return {uid: b.uid, name: b.name.slice(0, 32), groups, ...(color ? {color} : {}), ...(validJwk(b.keys) ? {keys: b.keys} : {})}
  } catch { return null }
}
