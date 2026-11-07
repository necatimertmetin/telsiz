import type {Box, Channel, Ev, FileMeta, Msg, Poll, Sched, View} from './types'

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

function validBox(b: unknown): b is Box {
  const x = b as Box
  return !!x && str(x.iv, 32) && str(x.ct, MAX_TEXT * 12) && !!x.keys && typeof x.keys === 'object' && Object.keys(x.keys).length <= 20 && Object.values(x.keys).every(k => !!k && str(k.iv, 32) && str(k.ct, 128))
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
    case 'sealed': return str(x.ch, CH_MAX) && isDm(x.ch) && validBox(x.box)
    case 'chan': return str(x.chId, 64) && str(x.title, 40)
    case 'role': return str(x.target, 64) && (x.role === 'admin' || x.role === 'member')
    case 'kick': return str(x.target, 64) && str(x.prev, 64) && validBox(x.box)
    case 'wipe': case 'hi': return true
    case 'group': return str(x.title, 40)
    default: return false
  }
}

// Bu tarihten sonra imzasız olay kabul edilmez. Eski mesajlar imzasız kaldığı için geçmiş bozulmasın diye ayrım var.
export const LEGACY_UNTIL = Date.UTC(2026, 10, 10)

export function canAccept(e: Ev) {
  const ch = (e as {ch?: string}).ch
  if (e.sig ? false : e.ts >= LEGACY_UNTIL) return false
  // Yetki olayı imzasız olamaz: eski tarih yazarak kural atlanmasın.
  if (!e.sig && (e.t === 'role' || e.t === 'kick' || e.t === 'wipe')) return false
  return !isDm(ch) || !e.sig || dmMembers(ch!).includes(e.uid)
}

export const pinResult = (pinned: string | undefined, pk: string) => !pinned ? 'new' : pinned === pk ? 'same' : 'conflict'

// Sadece mesajın sahibi silebilir, mesajdan eski tarihli silme sayılmaz.
export const shouldPurge = (m: Ev, del: Ev) => m.uid === del.uid && del.ts >= m.ts

const order = (a: Ev, b: Ev) => a.ts - b.ts || (a.id < b.id ? -1 : 1)

export const isManager = (v: View, uid: string) => uid === v.owner || v.admins.has(uid)
export const roleName = (v: View, uid: string) => uid === v.owner ? 'Kurucu' : v.admins.has(uid) ? 'Yönetici' : ''
// Kurucu atılamaz, yönetici de başka yöneticiyi atamaz.
export const canKick = (v: Pick<View, 'owner' | 'admins'>, by: string, target: string) =>
  by !== target && target !== v.owner && (by === v.owner || (v.admins.has(by) && !v.admins.has(target)))

// Tüm durum olay kümesinden türetilir: olaylar hangi sırayla gelirse gelsin herkes aynı sonucu görür.
export function materialize(events: Iterable<Ev>, fallbackTitle = 'Grup'): View {
  const sorted = [...events].sort(order)
  const byId = new Map<string, Msg>()
  const people = new Map<string, string>()
  const chans = new Map<string, Channel>([['genel', {id: 'genel', title: 'genel'}]])
  let title = fallbackTitle
  let sched: Sched | null = null
  // Kurucu grubu kuran kişidir: ilk 'group' olayını yazan. Yetkiler sırayla işlenir, herkes aynı sonucu bulur.
  const owner = sorted.find(e => e.t === 'group')?.uid ?? sorted[0]?.uid ?? ''
  const admins = new Set<string>()
  const banned = new Map<string, number>()
  const prevs = new Set<string>()
  let lastKick: string | null = null
  let wiped = false
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
    } else if (e.t === 'role') {
      const unban = e.role === 'member' && banned.has(e.target) && admins.has(e.uid)
      if (e.uid !== owner && !unban) continue
      if (e.role === 'admin') admins.add(e.target); else admins.delete(e.target)
      banned.delete(e.target)
    } else if (e.t === 'kick') {
      if (!canKick({owner, admins}, e.uid, e.target)) continue
      banned.set(e.target, e.ts)
      admins.delete(e.target)
      prevs.add(e.prev)
      lastKick = e.id
    } else if (e.t === 'wipe') {
      if (e.uid === owner) wiped = true
    }
  }
  const msgs = new Map<string, Msg[]>()
  for (const m of byId.values()) {
    if (!msgs.has(m.ch)) msgs.set(m.ch, [])
    msgs.get(m.ch)!.push(m)
  }
  return {title, channels: [...chans.values()], msgs, byId, people, sched, owner, admins, banned, prevs, lastKick, wiped}
}

// Karşı tarafta olmayan olaylar: eşitleme iki yönlü çalışır, herkes elindekini gönderir.
export function missingFor(mine: Map<string, Ev>, theirIds: Iterable<string>): Ev[] {
  const theirs = new Set(theirIds)
  return [...mine.values()].filter(e => !theirs.has(e.id))
}
