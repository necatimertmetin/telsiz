import type {Channel, Ev, FileMeta, Msg, View} from './types'

export const MAX_TEXT = 4000
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

function validFile(f: unknown): f is FileMeta {
  const x = f as FileMeta
  return !!x && str(x.id, 64) && str(x.name, 300) && Number.isSafeInteger(x.size) && x.size >= 0 && typeof x.type === 'string' && x.type.length <= 200
}

// Başka cihazlardan gelen her olay güvenilmez girdidir; uymayan düşer.
export function validEvent(e: unknown): e is Ev {
  const x = e as Record<string, unknown>
  if (!x || !str(x.id, 64) || !str(x.uid, 64) || !str(x.name, 40) || !Number.isFinite(x.ts)) return false
  switch (x.t) {
    case 'msg':
      if (!str(x.ch, 64) || typeof x.text !== 'string' || x.text.length > MAX_TEXT) return false
      if (x.file !== undefined && !validFile(x.file)) return false
      if (x.re !== undefined && !str(x.re, 64)) return false
      return x.text.length > 0 || x.file !== undefined
    case 'edit': return str(x.target, 64) && str(x.text, MAX_TEXT)
    case 'del': return str(x.target, 64)
    case 'react': return str(x.target, 64) && str(x.emoji, 16) && typeof x.on === 'boolean'
    case 'chan': return str(x.chId, 64) && str(x.title, 40)
    case 'group': return str(x.title, 40)
    default: return false
  }
}

const order = (a: Ev, b: Ev) => a.ts - b.ts || (a.id < b.id ? -1 : 1)

// Tüm durum olay kümesinden türetilir: olaylar hangi sırayla gelirse gelsin herkes aynı sonucu görür.
export function materialize(events: Iterable<Ev>, fallbackTitle = 'Grup'): View {
  const sorted = [...events].sort(order)
  const byId = new Map<string, Msg>()
  const people = new Map<string, string>()
  const chans = new Map<string, Channel>([['genel', {id: 'genel', title: 'genel'}]])
  let title = fallbackTitle
  for (const e of sorted) {
    people.set(e.uid, e.name)
    if (e.t === 'msg') {
      if (!byId.has(e.id)) byId.set(e.id, {id: e.id, ch: e.ch, uid: e.uid, name: e.name, ts: e.ts, text: e.text, file: e.file, re: e.re, edited: false, reacts: {}})
    } else if (e.t === 'edit') {
      const m = byId.get(e.target)
      if (m && m.uid === e.uid) { m.text = e.text; m.edited = true }
    } else if (e.t === 'del') {
      const m = byId.get(e.target)
      if (m && m.uid === e.uid) byId.delete(e.target)
    } else if (e.t === 'react') {
      const m = byId.get(e.target)
      if (!m) continue
      const set = new Set(m.reacts[e.emoji] ?? [])
      if (e.on) set.add(e.uid); else set.delete(e.uid)
      if (set.size) m.reacts[e.emoji] = [...set]; else delete m.reacts[e.emoji]
    } else if (e.t === 'chan') {
      chans.set(e.chId, {id: e.chId, title: e.title})
    } else if (e.t === 'group') {
      title = e.title
    }
  }
  const msgs = new Map<string, Msg[]>()
  for (const m of byId.values()) {
    if (!msgs.has(m.ch)) msgs.set(m.ch, [])
    msgs.get(m.ch)!.push(m)
  }
  return {title, channels: [...chans.values()], msgs, byId, people}
}

// Karşı tarafta olmayan olaylar: eşitleme iki yönlü çalışır, herkes elindekini gönderir.
export function missingFor(mine: Map<string, Ev>, theirIds: Iterable<string>): Ev[] {
  const theirs = new Set(theirIds)
  return [...mine.values()].filter(e => !theirs.has(e.id))
}
