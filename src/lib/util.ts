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

// SVG ve HTML bilerek yok: gelen dosya tarayıcıda çalıştırılmaz, sadece indirilir.
export function previewKind(f: {type: string; name: string}): 'image' | 'video' | 'audio' | null {
  const t = f.type.toLowerCase()
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
