// Profil resmi tarzları: hepsi kimlik + zar sayısından üretilir, ağda sadece tarz adı ve sayı gider.
export const LOOKS = [
  {id: 'monster', name: 'Canavar'},
  {id: 'badge', name: 'Rozet'},
  {id: 'pixel', name: 'Piksel'},
  {id: 'letter', name: 'Harf'},
] as const
export type Look = typeof LOOKS[number]['id']
export const isLook = (v: unknown): v is Look => LOOKS.some(l => l.id === v)

export const BADGES = [
  'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z',
  'M6 8h12a4 4 0 0 1 4 4v2a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-2a4 4 0 0 1 4-4zM7 10v4M5 12h4M15.5 11.5h.01M18 13h.01',
  'M3 9h18v11H3zM6 9l11-6M14 13h4M14 16h4M10 14.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  'M13 2 4 14h7l-1 8 9-12h-7z',
  'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M9 21h6',
  'M9 18V6l10-2v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  'M3 18h18l1-11-6 4-4-7-4 7-6-4zM3 21h18',
  'M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14zM10 20v-2M14 20v-2M9 11h.01M15 11h.01',
  'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
]

function rng(s: string) {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return () => { h = (Math.imul(h, 1103515245) + 12345) >>> 0; return h / 4294967296 }
}

// Zemin renginin koyusu: çizgiler için.
function ink(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(v * .28).toString(16).padStart(2, '0')
  return `#${ch(n >> 16 & 255)}${ch(n >> 8 & 255)}${ch(n & 255)}`
}

const n1 = (v: number) => Math.round(v * 10) / 10
function blob(r: number, rand: () => number, n = 9) {
  const p: [number, number][] = []
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, q = r * (.84 + rand() * .22); p.push([Math.cos(a) * q, Math.sin(a) * q]) }
  let d = `M${n1(p[0][0])} ${n1(p[0][1])}`
  for (let i = 0; i < n; i++) {
    const a = p[(i - 1 + n) % n], b = p[i], c = p[(i + 1) % n], e = p[(i + 2) % n]
    d += `C${n1(b[0] + (c[0] - a[0]) / 6)} ${n1(b[1] + (c[1] - a[1]) / 6)} ${n1(c[0] - (e[0] - b[0]) / 6)} ${n1(c[1] - (e[1] - b[1]) / 6)} ${n1(c[0])} ${n1(c[1])}`
  }
  return d + 'Z'
}

function monster(seed: string, bg: string) {
  const r = rng(seed), k = ink(bg)
  let g = `<g transform="translate(50 57)" stroke="${k}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`
  const top = r()
  if (top < .35) g += `<path d="M-17 -27L-25 -45L-6 -32M17 -27L25 -45L6 -32" fill="#fff"/>`
  else if (top < .65) g += `<path d="M${n1(r() * 10 - 5)} -30q7 -9 2 -16"/><circle cx="2" cy="-47" r="4.5" fill="${k}"/>`
  else if (top < .85) g += `<path d="M-30 -6q-10 -4 -10 -16M30 -6q10 -4 10 -16"/>`
  g += `<path d="${blob(31, r)}" fill="#fff"/>`
  const n = [1, 2, 2, 3][Math.floor(r() * 4)], er = n === 1 ? 10 : n === 2 ? 7.5 : 6
  const xs = n === 1 ? [0] : n === 2 ? [-11, 11] : [-15, 0, 15]
  const lid = r() < .25
  for (const x of xs) {
    g += `<circle cx="${x}" cy="-7" r="${er}" fill="#fff"/><circle cx="${n1(x + 1.5)}" cy="-5.5" r="${n1(er * .45)}" fill="${k}" stroke="none"/>`
    if (lid) g += `<path d="M${n1(x - er)} -8h${n1(er * 2)}"/>`
  }
  const m = Math.floor(r() * 5)
  g += m === 0 ? '<path d="M-13 10q13 13 26 0"/>'
    : m === 1 ? '<path d="M-13 9h26v8h-26zM-4.3 9v8M4.3 9v8"/>'
      : m === 2 ? `<path d="M-12 9q12 16 24 0z" fill="${k}"/>`
        : m === 3 ? '<path d="M-13 12l4.3 -4 4.3 4 4.3 -4 4.3 4 4.3 -4 4.3 4"/>'
          : '<path d="M-12 10q12 10 24 0"/><path d="M2 14q3 9 8 2" fill="#fff"/>'
  return `<rect width="100" height="100" fill="${bg}"/>${g}</g>`
}

function badge(icon: number, bg: string) {
  return `<rect width="100" height="100" fill="${bg}"/><g transform="translate(21 21) scale(2.4)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${BADGES[icon % BADGES.length]}"/></g>`
}

function pixel(seed: string, bg: string) {
  const r = rng(seed + 'p'), k = ink(bg), c = 11, o = 6
  let g = `<rect width="100" height="100" fill="${bg}"/>`
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    const edge = y === 0 || y === 7 || x === 0
    if (r() < (edge ? .35 : .75)) for (const xx of x === 3 ? [3, 4] : [x, 7 - x]) g += `<rect x="${o + xx * c}" y="${o + y * c}" width="${c}" height="${c}" fill="#fff"/>`
  }
  const ey = 2 + Math.floor(r() * 2)
  g += `<rect x="${o + 2 * c}" y="${o + ey * c}" width="${c}" height="${c}" fill="${k}"/><rect x="${o + 5 * c}" y="${o + ey * c}" width="${c}" height="${c}" fill="${k}"/>`
  g += `<rect x="${o + 3 * c}" y="${o + (ey + 2) * c}" width="${2 * c}" height="${c}" fill="${k}"/>`
  return g
}

function letter(ch: string, bg: string) {
  const k = ink(bg)
  let dots = ''
  for (let y = 7; y < 100; y += 14) for (let x = (y / 14 | 0) % 2 * 7; x < 100; x += 14) dots += `<circle cx="${x}" cy="${y}" r="2.2"/>`
  const safe = ch.replace(/[<>&"']/g, '?')
  return `<rect width="100" height="100" fill="${bg}"/><g fill="${k}" opacity=".28">${dots}</g><circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-width="5" stroke-dasharray="10 7"/><text x="50" y="67" text-anchor="middle" font-size="46" font-weight="700" fill="#fff" font-family="Barlow,system-ui,sans-serif">${safe}</text>`
}

const cache = new Map<string, string>()
export function faceUrl(look: Look, uid: string, seed: number, icon: number, bg: string, ch: string) {
  const key = [look, uid, seed, icon, bg, ch].join('|')
  let u = cache.get(key)
  if (!u) {
    const id = uid + ':' + seed
    const body = look === 'badge' ? badge(icon, bg) : look === 'pixel' ? pixel(id, bg) : look === 'letter' ? letter(ch, bg) : monster(id, bg)
    u = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"${look === 'pixel' ? ' shape-rendering="crispEdges"' : ''}>${body}</svg>`)
    if (cache.size > 400) cache.clear()
    cache.set(key, u)
  }
  return u
}
