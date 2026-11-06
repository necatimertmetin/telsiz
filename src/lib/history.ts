import type {Channel, Ev, FileMeta, Msg, Poll, Sched, View} from './types'

export const MAX_TEXT = 4000
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

function validFile(f: unknown): f is FileMeta {
  const x = f as FileMeta
  return !!x && str(x.id, 64) && str(x.name, 300) && Number.isSafeInteger(x.size) && x.size >= 0 && typeof x.type === 'string' && x.type.length <= 200
}

const CH_MAX = 300
const optCh = (v: unknown) => v === undefined || str(v, CH_MAX)

// İki kişilik sohbet de seçili kişilerle kurulan özel grup da aynı kimlikle çalışır: üyeler kimliğin içindedir.
export const dmId = (...uids: string[]) => 'dm:' + [...new Set(uids)].sort().join(':')
export const dmMembers = (ch: string) => ch.split(':').slice(1)
export const dmOthers = (ch: string, me: string) => dmMembers(ch).filter(u => u !== me)
export const isDm = (ch?: string) => !!ch && ch.startsWith('dm:')
export const dmPartner = (ch: string, me: string) => ch.split(':').slice(1).find(u => u !== me) ?? me

// Özel sohbet olayları sadece iki tarafa gider; gruptaki diğerleri bu olayları hiç almaz.
export function visibleTo(e: Ev, uid: string): boolean {
  const ch = (e as {ch?: string}).ch
  return !isDm(ch) || ch!.split(':').includes(uid)
}

function validPoll(p: unknown): p is Poll {
  const x = p as Poll
  return !!x && str(x.q, 200) && Array.isArray(x.opts) && x.opts.length >= 2 && x.opts.length <= 8 && x.opts.every(o => str(o, 80))
}

// Başka cihazlardan gelen her olay güvenilmez girdidir; uymayan düşer.
export function validEvent(e: unknown): e is Ev {
  const x = e as Record<string, unknown>
  if (!x || !str(x.id, 64) || !str(x.uid, 64) || !str(x.name, 40) || !Number.isFinite(x.ts)) return false
  switch (x.t) {
    case 'msg':
      if (!str(x.ch, CH_MAX) || typeof x.text !== 'string' || x.text.length > MAX_TEXT) return false
      if (x.file !== undefined && !validFile(x.file)) return false
      if (x.re !== undefined && !str(x.re, 64)) return false
      if (x.poll !== undefined && !validPoll(x.poll)) return false
      return x.text.length > 0 || x.file !== undefined || x.poll !== undefined
    case 'edit': return optCh(x.ch) && str(x.target, 64) && str(x.text, MAX_TEXT)
    case 'del': return optCh(x.ch) && str(x.target, 64)
    case 'react': return optCh(x.ch) && str(x.target, 64) && str(x.emoji, 16) && typeof x.on === 'boolean'
    case 'pin': return optCh(x.ch) && str(x.target, 64) && typeof x.on === 'boolean'
    case 'vote': return optCh(x.ch) && str(x.target, 64) && Number.isInteger(x.opt) && typeof x.on === 'boolean'
    case 'sched': return Array.isArray(x.days) && x.days.every(d => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) && typeof x.time === 'string' && /^\d\d:\d\d$/.test(x.time) && typeof x.on === 'boolean'
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
  let sched: Sched | null = null
  for (const e of sorted) {
    people.set(e.uid, e.name)
    if (e.t === 'msg') {
      if (!byId.has(e.id)) byId.set(e.id, {id: e.id, ch: e.ch, uid: e.uid, name: e.name, ts: e.ts, text: e.text, file: e.file, re: e.re, edited: false, pinned: false, reacts: {}, poll: e.poll, votes: {}})
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
    } else if (e.t === 'vote') {
      const m = byId.get(e.target)
      if (!m?.poll || e.opt < 0 || e.opt >= m.poll.opts.length) continue
      for (const k of Object.keys(m.votes)) m.votes[+k] = m.votes[+k].filter(u => u !== e.uid)
      if (e.on) m.votes[e.opt] = [...(m.votes[e.opt] ?? []), e.uid]
    } else if (e.t === 'sched') {
      sched = {days: e.days, time: e.time, on: e.on}
    } else if (e.t === 'pin') {
      const m = byId.get(e.target)
      if (m) m.pinned = e.on
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
  return {title, channels: [...chans.values()], msgs, byId, people, sched}
}

// Karşı tarafta olmayan olaylar: eşitleme iki yönlü çalışır, herkes elindekini gönderir.
export function missingFor(mine: Map<string, Ev>, theirIds: Iterable<string>): Ev[] {
  const theirs = new Set(theirIds)
  return [...mine.values()].filter(e => !theirs.has(e.id))
}
