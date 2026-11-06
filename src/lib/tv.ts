// Odada birlikte izleme. Durum herkeste aynı tutulur: en yüksek sürüm kazanır, eşitlikte kimlik karar verir.
// Saat farkı sorun olmasın diye duvar saati gönderilmez, gönderim anındaki konum gönderilir.
export type TvItem = {k: string; id: string; title: string; by: string}
export type TvState = {queue: TvItem[]; idx: number; playing: boolean; pos: number; rev: [number, string]; at: number}

export const TV_EMPTY: TvState = {queue: [], idx: 0, playing: false, pos: 0, rev: [0, ''], at: 0}
const MAX_QUEUE = 200

export function ytId(text: string): string | null {
  const m = text.match(/(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i)
  return m ? m[1] : null
}

export const tvNewer = (a: TvState['rev'], b: TvState['rev']) => a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]

export const tvPos = (s: TvState, now: number) => s.pos + (s.playing ? Math.max(0, now - s.at) / 1000 : 0)

export const tvCurrent = (s: TvState) => s.queue[s.idx] ?? null

export function validTv(x: unknown): x is Omit<TvState, 'at'> {
  const s = x as TvState
  return !!s && Array.isArray(s.queue) && s.queue.length <= MAX_QUEUE
    && s.queue.every(i => !!i && /^[\w-]{11}$/.test(i.id) && typeof i.k === 'string' && i.k.length <= 64 && typeof i.title === 'string' && i.title.length <= 200 && typeof i.by === 'string' && i.by.length <= 40)
    && Number.isInteger(s.idx) && s.idx >= 0 && s.idx <= s.queue.length
    && typeof s.playing === 'boolean' && Number.isFinite(s.pos) && s.pos >= 0
    && Array.isArray(s.rev) && Number.isInteger(s.rev[0]) && s.rev[0] > 0 && typeof s.rev[1] === 'string'
}

export type TvAction =
  | {a: 'add'; item: TvItem}
  | {a: 'play'} | {a: 'pause'}
  | {a: 'seek'; pos: number}
  | {a: 'next'} | {a: 'prev'}
  | {a: 'jump'; i: number}
  | {a: 'remove'; k: string}
  | {a: 'ended'; k: string} // iki kişi aynı anda bitirse de bir kez ilerler
  | {a: 'retitle'; k: string; title: string}

// Yeni durumu verir; değişiklik yoksa null döner ve ağa bir şey gitmez.
export function tvApply(s: TvState, act: TvAction, uid: string, now: number): TvState | null {
  const pos = tvPos(s, now)
  const next = (over: Partial<TvState>): TvState => ({...s, pos, ...over, rev: [s.rev[0] + 1, uid], at: now})
  const go = (idx: number) => {
    if (idx >= s.queue.length) return next({idx: s.queue.length, pos: 0, playing: false})
    return next({idx: Math.max(0, idx), pos: 0, playing: true})
  }
  switch (act.a) {
    case 'add': {
      if (s.queue.length >= MAX_QUEUE) return null
      const queue = [...s.queue, act.item]
      return s.idx >= s.queue.length ? next({queue, idx: s.queue.length, pos: 0, playing: true}) : next({queue})
    }
    case 'play': return tvCurrent(s) && !s.playing ? next({playing: true}) : null
    case 'pause': return s.playing ? next({playing: false}) : null
    case 'seek': return tvCurrent(s) ? next({pos: Math.max(0, act.pos)}) : null
    case 'next': return tvCurrent(s) ? go(s.idx + 1) : null
    case 'prev': return s.queue.length ? (pos > 5 && tvCurrent(s) ? next({pos: 0}) : go(s.idx - 1)) : null
    case 'jump': return act.i >= 0 && act.i < s.queue.length ? go(act.i) : null
    case 'retitle': return s.queue.some(x => x.k === act.k) ? next({queue: s.queue.map(x => x.k === act.k ? {...x, title: act.title} : x)}) : null
    case 'ended': return tvCurrent(s)?.k === act.k ? go(s.idx + 1) : null
    case 'remove': {
      const i = s.queue.findIndex(x => x.k === act.k)
      if (i < 0) return null
      const queue = s.queue.filter(x => x.k !== act.k)
      if (i < s.idx) return next({queue, idx: s.idx - 1})
      if (i > s.idx) return next({queue})
      return next({queue, idx: Math.min(s.idx, queue.length), pos: 0, playing: s.playing && s.idx < queue.length})
    }
  }
}
