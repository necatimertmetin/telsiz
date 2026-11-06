import {useSyncExternalStore} from 'react'
import {Session, type Me} from './session'
import {Call, type AudioPrefs} from './call'
import * as db from './db'
import {desktop} from './native'
import {newRoomCode, randomId} from './util'
import type {Ev} from './types'

type GroupRef = {code: string; title: string}
export type Route = {kind: 'text'; ch: string} | {kind: 'voice'}
type Ring = {code: string; name: string; title: string}

function load<T>(k: string, d: T): T {
  try { const v = localStorage.getItem('telsiz.' + k); return v ? {...(d as object), ...JSON.parse(v)} as T : d } catch { return d }
}
function loadArr<T>(k: string): T[] {
  try { return JSON.parse(localStorage.getItem('telsiz.' + k) ?? '[]') } catch { return [] }
}
function save(k: string, v: unknown) {
  try { localStorage.setItem('telsiz.' + k, JSON.stringify(v)) } catch { /* gizli pencere */ }
}

// Kısa, sentezlenmiş sesler: ses dosyası taşımaya gerek yok.
function beep(notes: [number, number][], vol = 0.05) {
  try {
    const c = new AudioContext()
    let t = c.currentTime
    for (const [f, d] of notes) {
      const o = c.createOscillator(), g = c.createGain()
      o.type = 'triangle'; o.frequency.value = f
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d)
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + d)
      t += d * 0.8
    }
    setTimeout(() => c.close(), 2000)
  } catch { /* ses yok */ }
}

class App {
  me = load<Me>('me', {uid: '', name: ''})
  groups = loadArr<GroupRef>('groups')
  sessions = new Map<string, Session>()
  calls = new Map<string, Call>()
  active: string | null = null
  route: Route = {kind: 'text', ch: 'genel'}
  prefs = load<AudioPrefs & {gameMode: boolean; sounds: boolean}>('prefs', {micId: '', speakerId: '', camId: '', gate: 0, noise: true, gameMode: false, sounds: true})
  volumes = load<Record<string, number>>('vol', {})
  turn = load<{raw: string}>('turn', {raw: ''})
  lastRead = load<Record<string, number>>('read', {})
  ring: Ring | null = null
  toast = ''
  sourcePicker: {id: string; name: string; thumb: string}[] | null = null

  private version = 0
  private subs = new Set<() => void>()
  private toastTimer?: ReturnType<typeof setTimeout>
  private ringTimer?: ReturnType<typeof setTimeout>

  constructor() {
    if (!this.me.uid) this.me.uid = randomId()
    if (this.me.name) this.start()
    desktop()?.onHotkey(k => {
      const c = this.liveCall()
      if (k === 'mute') c?.toggleMute(); else c?.toggleDeaf()
    })
    addEventListener('hashchange', () => this.readHash())
    const seen = () => { this.markRead(); this.bump() }
    addEventListener('focus', seen)
    document.addEventListener('visibilitychange', seen)
  }

  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f) } }
  getVersion = () => this.version
  bump = () => { this.version++; this.subs.forEach(f => f()) }

  private start() {
    for (const g of this.groups) this.open(g)
    this.active = localStorage.getItem('telsiz.active') ?? this.groups[0]?.code ?? null
    if (this.active && !this.sessions.has(this.active)) this.active = this.groups[0]?.code ?? null
    this.readHash()
  }

  private readHash() {
    const m = location.hash.match(/^#\/katil\/([a-z2-9-]+)/)
    if (m && this.me.name) {
      this.join(m[1])
      history.replaceState(null, '', location.pathname)
    }
  }

  private turnServers(): RTCIceServer[] {
    if (!this.turn.raw.trim()) return []
    try { const v = JSON.parse(this.turn.raw); return Array.isArray(v) ? v : [v] } catch { return [] }
  }

  private open(g: GroupRef) {
    if (this.sessions.has(g.code)) return
    const s = new Session(g.code, this.me, g.title, {
      changed: this.bump,
      message: (se, e) => this.onMessage(se, e),
      ring: (se, name) => this.onRing(se, name),
      getGameMode: () => this.prefs.gameMode,
    }, this.turnServers())
    this.sessions.set(g.code, s)
    this.calls.set(g.code, new Call(s, () => this.prefs, uid => this.volumes[uid] ?? 1, this.bump, () => this.prefs.gameMode))
  }

  get session() { return this.active ? this.sessions.get(this.active) ?? null : null }
  get call() { return this.active ? this.calls.get(this.active) ?? null : null }
  liveSession() { return [...this.sessions.values()].find(s => s.voice.in) ?? null }
  liveCall() { const s = this.liveSession(); return s ? this.calls.get(s.code) ?? null : null }

  setName(name: string) {
    const first = !this.me.name
    this.me = {...this.me, name: name.trim().slice(0, 32)}
    save('me', this.me)
    if (first) this.start()
    for (const s of this.sessions.values()) s.setMe(this.me)
    this.bump()
  }

  createGroup(title: string) {
    const code = newRoomCode()
    this.addGroup({code, title: title.trim() || 'Kanka Odası'})
    this.session?.emit({t: 'group', title: title.trim().slice(0, 40) || 'Kanka Odası'} as never)
  }

  join(code: string) {
    if (!this.sessions.has(code)) this.addGroup({code, title: 'Yeni grup'})
    else this.select(code)
  }

  private addGroup(g: GroupRef) {
    this.groups.push(g)
    save('groups', this.groups)
    this.open(g)
    this.select(g.code)
  }

  select(code: string) {
    this.active = code
    this.route = {kind: 'text', ch: 'genel'}
    try { localStorage.setItem('telsiz.active', code) } catch { /* yok */ }
    this.markRead()
    this.bump()
  }

  go(r: Route) { this.route = r; this.markRead(); this.bump() }

  markRead() {
    if (this.route.kind !== 'text' || !this.active || document.hidden) return
    this.lastRead[`${this.active}:${this.route.ch}`] = Date.now()
    save('read', this.lastRead)
    const last = this.session?.view.msgs.get(this.route.ch)?.at(-1)
    if (last) this.session?.sendSeen(this.route.ch, last.ts)
  }

  unread(s: Session, ch: string) {
    const last = this.lastRead[`${s.code}:${ch}`] ?? 0
    return (s.view.msgs.get(ch) ?? []).filter(m => m.ts > last && m.uid !== this.me.uid).length
  }
  unreadGroup(s: Session) { return [...s.view.msgs.keys()].reduce((n, ch) => n + this.unread(s, ch), 0) }

  async leaveGroup(code: string) {
    this.calls.get(code)?.leave()
    const s = this.sessions.get(code)
    await s?.leave()
    this.sessions.delete(code); this.calls.delete(code)
    this.groups = this.groups.filter(g => g.code !== code)
    save('groups', this.groups)
    void db.dropGroup(code)
    this.active = this.groups[0]?.code ?? null
    this.bump()
  }

  savePrefs() { save('prefs', this.prefs); for (const c of this.calls.values()) c.applyAudio(); this.bump() }
  setVolume(uid: string, v: number) { this.volumes[uid] = v; save('vol', this.volumes); for (const c of this.calls.values()) c.applyAudio(); this.bump() }
  saveTurn(raw: string) { this.turn = {raw}; save('turn', this.turn); this.bump() }

  showToast(t: string) {
    this.toast = t
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => { this.toast = ''; this.bump() }, 3000)
    this.bump()
  }

  private onMessage(s: Session, e: Ev & {t: 'msg'}) {
    const fresh = Date.now() - e.ts < 30_000
    const viewing = s.code === this.active && this.route.kind === 'text' && this.route.ch === e.ch && !document.hidden
    if (viewing) { this.markRead(); return }
    if (!fresh) return
    if (this.prefs.sounds) beep([[880, .08], [1175, .1]], .03)
    this.notify(e.name, e.text || e.file?.name || 'Dosya gönderdi')
  }

  private onRing(s: Session, name: string) {
    this.ring = {code: s.code, name, title: s.view.title}
    if (this.prefs.sounds) beep([[660, .18], [880, .18], [660, .18], [880, .22]], .07)
    this.notify('Telsiz', `${name} seni sese çağırıyor`)
    desktop()?.flash()
    clearTimeout(this.ringTimer)
    this.ringTimer = setTimeout(() => { this.ring = null; this.bump() }, 30_000)
    this.bump()
  }

  private notify(title: string, body: string) {
    if (!document.hidden || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    try { new Notification(title, {body, icon: 'icon-192.png'}) } catch { /* mobil kısıtı */ }
  }

  async joinVoice(cam = false) {
    const c = this.call
    if (!c) return
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {})
    this.liveCall()?.leave()
    try {
      await c.join(cam)
      if (this.prefs.sounds) beep([[523, .08], [784, .12]])
      this.route = {kind: 'voice'}
    } catch (e) {
      this.showToast((e as Error).name === 'NotAllowedError' ? 'Mikrofon izni verilmedi' : 'Mikrofon açılamadı')
    }
    this.bump()
  }

  leaveVoice() {
    this.liveCall()?.leave()
    if (this.prefs.sounds) beep([[784, .08], [523, .12]])
    if (this.route.kind === 'voice') this.route = {kind: 'text', ch: 'genel'}
    this.bump()
  }
}

export const app = new App()
export function useApp() {
  useSyncExternalStore(app.subscribe, app.getVersion)
  return app
}
// Test ve hata ayıklama için konsoldan erişim.
;(window as unknown as {telsiz: App}).telsiz = app
export {randomId}
