import {useSyncExternalStore} from 'react'
import {Session, type Me} from './session'
import {Call, type AudioPrefs} from './call'
import * as db from './db'
import {androidPlugin, desktop, isAndroidApp, shellVersion} from './native'
import {decodeBackup, encodeBackup, isNewer, newRoomCode, randomId} from './util'

const latestTag = async (): Promise<string | undefined> =>
  (await fetch('https://api.github.com/repos/necatimertmetin/telsiz/releases/latest').then(r => r.json()))?.tag_name
import {codeHash, loadIdentity, newIdentity, validJwk, type Identity, type KeysJwk} from './identity'
import {playSfx} from './sfx'
import type {Ev, Profile} from './types'

type GroupRef = {code: string; title: string}
export type Route = {kind: 'text'; ch: string} | {kind: 'voice'}
type Ring = {code: string; name: string; title: string; text?: string}

function load<T>(k: string, d: T): T {
  try { const v = localStorage.getItem('telsiz.' + k); return v ? {...(d as object), ...JSON.parse(v)} as T : d } catch { return d }
}
function loadArr<T>(k: string): T[] {
  try { return JSON.parse(localStorage.getItem('telsiz.' + k) ?? '[]') } catch { return [] }
}
function save(k: string, v: unknown) {
  try { localStorage.setItem('telsiz.' + k, JSON.stringify(v)) } catch { /* gizli pencere */ }
}

// Masaüstü uygulamasında arka plan kısıtı kapalı olduğu için document.hidden hep false kalır, odak da bakılmalı.
const away = () => document.hidden || !document.hasFocus()

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
  roomChatOpen = false
  prefs = load<AudioPrefs & {gameMode: boolean; sounds: boolean; pttVk: number; pttLabel: string; sfx: boolean; overlay: boolean; shareAudio: boolean}>('prefs', {micId: '', speakerId: '', camId: '', gate: 0, noise: true, gameMode: false, sounds: true, ptt: false, screenQ: '1080p60', pttVk: 86, pttLabel: 'V', sfx: true, overlay: true, screenGain: 1, shareAudio: true, micGain: 1, outVol: 1})
  volumes = load<Record<string, number>>('vol', {})
  turn = load<{raw: string}>('turn', {raw: ''})
  lastRead = load<Record<string, number>>('read', {})
  ring: Ring | null = null
  toast = ''
  search = ''
  profiles = load<Record<string, Profile>>('prof', {})
  rejoin: string | null = null
  backupSaved = load<{v: boolean}>('backup2', {v: false}).v
  pins = load<Record<string, string>>('pins', {})
  keys: KeysJwk | null = load<{k: KeysJwk | null}>('keys', {k: null}).k
  identity!: Promise<Identity>
  update: {label: string; run: () => void} | null = null
  sourcePicker: {id: string; name: string; thumb: string}[] | null = null

  private version = 0
  private subs = new Set<() => void>()
  private toastTimer?: ReturnType<typeof setTimeout>
  private ringTimer?: ReturnType<typeof setTimeout>

  constructor() {
    if (!this.me.uid) this.me.uid = randomId()
    // Tarayıcı yer açarken bu sitenin verisini silmesin diye kalıcı depolama istenir.
    void navigator.storage?.persist?.().catch(() => {})
    // Anahtar ilk açılışta sessizce üretilir, kullanıcı hiçbir şey yapmaz.
    this.identity = (validJwk(this.keys) ? loadIdentity(this.keys) : newIdentity()).then(id => {
      this.keys = id.jwk
      save('keys', {k: id.jwk})
      this.pins[this.me.uid] = id.pk
      save('pins', this.pins)
      this.bump()
      return id
    })
    if (this.me.name) this.start()
    desktop()?.onHotkey(k => {
      const c = this.liveCall()
      if (k === 'clip') void this.saveClip()
      else if (k === 'mute') c?.toggleMute(); else c?.toggleDeaf()
    })
    addEventListener('hashchange', () => this.readHash())
    this.setupPtt()
    desktop()?.onUpdate?.(() => {
      this.update = {label: 'Güncelleme hazır, yeniden başlat', run: () => desktop()?.installUpdate?.()}
      this.bump()
    })
    void this.checkShellUpdate()
    setInterval(() => this.pushOverlay(), 300)
    setInterval(() => this.checkSchedules(), 20_000)
    addEventListener('pagehide', () => {
      try { const l = this.liveSession(); if (l) sessionStorage.setItem('telsiz.voice', l.code); else sessionStorage.removeItem('telsiz.voice') } catch { /* yok */ }
    })
    try { this.rejoin = sessionStorage.getItem('telsiz.voice') } catch { /* yok */ }
    const seen = () => { this.markRead(); this.bump() }
    addEventListener('focus', seen)
    document.addEventListener('visibilitychange', seen)
  }

  backupCode() {
    const color = this.profiles[this.me.uid]?.color
    return encodeBackup({uid: this.me.uid, name: this.me.name, ...(this.keys ? {keys: this.keys} : {}), ...(color ? {color} : {}), groups: this.groups.map(g => {
      const s = this.sessions.get(g.code)
      return {code: g.code, title: s?.view.title ?? g.title}
    })})
  }

  markBackupSaved() { this.backupSaved = true; save('backup2', {v: true}); this.bump() }

  // Kimlik değiştiği için temiz başlangıç gerekir: bağlantılar yeni kimlikle yeniden kurulur.
  importBackup(input: string): boolean {
    const b = decodeBackup(input)
    if (!b) return false
    const have = new Set(b.groups.map(g => g.code))
    // Eski kodda anahtar yok: arkadaşlar o kimliği eski anahtarıyla tanıyor, yeni kimlikle dönülür.
    const uid = b.keys ? b.uid : randomId()
    save('me', {uid, name: b.name})
    if (b.keys) save('keys', {k: b.keys}); else localStorage.removeItem('telsiz.keys')
    save('groups', [...b.groups, ...this.groups.filter(g => !have.has(g.code))])
    if (b.color) save('prof', {...this.profiles, [uid]: {...this.profiles[uid], color: b.color}})
    save('backup2', {v: true})
    localStorage.removeItem('telsiz.pins')
    location.reload()
    return true
  }

  private setPttDown(d: boolean) {
    const c = this.liveCall()
    if (c) c.pttDown = d
  }

  applyPtt() { desktop()?.setPtt?.(this.prefs.ptt ? this.prefs.pttVk : 0) }

  // Masaüstünde tuş oyun açıkken de yakalanır; web ve eski kabukta sadece pencere odaklıyken çalışır.
  private setupPtt() {
    const d = desktop()
    if (d?.setPtt && d.onPtt) {
      d.onPtt(x => this.setPttDown(x))
      this.applyPtt()
      return
    }
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(t.tagName)
    const key = (down: boolean) => (e: KeyboardEvent) => { if (this.prefs.ptt && e.keyCode === this.prefs.pttVk && !typing(e.target)) this.setPttDown(down) }
    addEventListener('keydown', key(true))
    addEventListener('keyup', key(false))
    addEventListener('blur', () => this.setPttDown(false))
  }

  // Android kurulum için kullanıcıdan tek onay ister, sessiz kurulum bu kanalda mümkün değil.
  private async checkShellUpdate() {
    const d = desktop(), p = androidPlugin()
    if (!(isAndroidApp() && p) && !d) return
    if (d) {
      if (!d.onUpdate) this.update = {label: 'Yeni sürüm var, otomatik güncelleme için bir kez kur', run: this.releasePage}
      return this.bump()
    }
    if (!p!.appVersion) { this.update = {label: 'Yeni sürüm var, bir kez elle kur', run: this.releasePage}; return this.bump() }
    try {
      const [version, tag] = await Promise.all([shellVersion(), latestTag()])
      if (tag && version && isNewer(tag, version)) this.offerApk(tag)
    } catch { /* internet yoksa sonraki açılışta bakılır */ }
  }

  private releasePage = () => { window.open('https://github.com/necatimertmetin/telsiz/releases/latest', '_blank') }

  private offerApk(tag: string) {
    this.update = {label: `Yeni sürüm ${tag}: güncelle`, run: () => {
      this.update = null
      this.showToast('İndiriliyor, kurulum ekranı açılacak')
      void androidPlugin()?.installUpdate?.({url: 'https://github.com/necatimertmetin/telsiz/releases/latest/download/Telsiz.apk'}).catch(() => this.showToast('Güncelleme indirilemedi'))
    }}
    this.bump()
  }

  // Ayarlardaki düğme. Sonucu ekranda gösterilecek metin olarak döner.
  async checkUpdateNow(): Promise<string> {
    try {
      const [version, tag] = await Promise.all([shellVersion(), latestTag()])
      if (!version || !tag) return 'Denetlenemedi, biraz sonra yine dene'
      if (!isNewer(tag, version)) return `Güncelsin (${version})`
      const d = desktop()
      if (!d) { this.offerApk(tag); return `Yeni sürüm: ${tag}` }
      // İndirme bitince üstteki güncelleme çubuğu kendiliğinden çıkar.
      if (await d.checkUpdate?.()) return `${tag} indiriliyor, bitince burada yeniden başlat düğmesi çıkar`
      this.update = {label: `Yeni sürüm ${tag}: indirme sayfası`, run: this.releasePage}
      this.bump()
      return `Yeni sürüm: ${tag}`
    } catch { return 'Denetlenemedi, internetini kontrol et' }
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
    const m = location.hash.match(/^#\/katil\/([a-z2-9-]+)(\/ses)?/)
    if (m && this.me.name) {
      const known = this.sessions.has(m[1])
      this.join(m[1])
      history.replaceState(null, '', location.pathname)
      // Adını yeni yazan ya da grubu tanıyan bilerek geliyor. Diğeri tanımadığı bir linke tıklamış
      // olabilir: fark etmeden yabancı odaya sesi gitmesin diye mikrofon kapalı girer.
      if (m[2]) void this.joinFromLink(!known && !this.namedNow)
      this.namedNow = false
    }
  }

  private namedNow = false
  private async joinFromLink(muted: boolean) {
    const code = this.active
    await this.joinVoice(false, muted)
    if (!this.liveSession()) { this.rejoin = code; this.bump(); return }
    if (muted) this.showToast('Sese mikrofonun kapalı girdin, açmak için mikrofona bas')
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
      profile: (uid, p) => { this.profiles[uid] = p; save('prof', this.profiles); this.bump() },
      myProfile: () => this.profiles[this.me.uid] ?? {},
      sfx: (se, id, peerId) => this.onSfx(se, id, peerId),
      pinOf: uid => this.pins[uid],
      pin: (uid, pk) => { this.pins[uid] = pk; save('pins', this.pins) },
      toast: t => this.showToast(t),
      rekey: (se, code) => void this.moveGroup(se.code, code),
      removed: (se, text) => void this.leaveGroup(se.code).then(() => this.showToast(text)),
      absorb: se => this.absorb(se),
    }, this.turnServers(), this.identity)
    this.sessions.set(g.code, s)
    this.calls.set(g.code, new Call(s, () => this.prefs, uid => (this.volumes[uid] ?? 1) * this.prefs.outVol, this.bump, () => this.prefs.gameMode, j => {
      if (this.prefs.sounds) beep(j ? [[523, .07], [659, .09]] : [[659, .07], [440, .09]], .04)
    }, () => this.me.uid))
  }

  get session() { return this.active ? this.sessions.get(this.active) ?? null : null }
  get call() { return this.active ? this.calls.get(this.active) ?? null : null }
  liveSession() { return [...this.sessions.values()].find(s => s.voice.in) ?? null }
  liveCall() { const s = this.liveSession(); return s ? this.calls.get(s.code) ?? null : null }

  setName(name: string) {
    const first = !this.me.name
    this.namedNow = first
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

  go(r: Route) { this.route = r; this.search = ''; this.markRead(); this.bump() }

  markRead() {
    const ch = this.route.kind === 'text' ? this.route.ch : this.roomChatOpen ? 'ses' : ''
    if (!ch || !this.active || away()) return
    const last = this.session?.view.msgs.get(ch)?.at(-1)
    // Karşının saati ileri olsa da açılan mesaj okunmuş sayılır.
    this.lastRead[`${this.active}:${ch}`] = Math.max(Date.now(), last?.ts ?? 0)
    save('read', this.lastRead)
    if (last) this.session?.sendSeen(ch, last.ts)
  }

  unread(s: Session, ch: string) {
    const last = this.lastRead[`${s.code}:${ch}`] ?? 0
    return (s.view.msgs.get(ch) ?? []).filter(m => m.ts > last && m.uid !== this.me.uid).length
  }
  unreadGroup(s: Session) { return [...s.view.msgs.keys()].reduce((n, ch) => n + this.unread(s, ch), 0) }

  // Davet kodu değişince grup yeni odaya taşınır: geçmiş, okunma bilgisi ve ses kaldığı yerden sürer.
  private async moveGroup(old: string, code: string) {
    const g = this.groups.find(x => x.code === old), s = this.sessions.get(old)
    if (!g || !s) return
    if (this.sessions.has(code)) {
      await this.sessions.get(code)!.absorbEvents(await db.loadEvents(old))
      return this.leaveGroup(old, true)
    }
    const wasIn = s.voice.in, muted = s.voice.muted, title = s.view.title, active = this.active === old
    this.calls.get(old)?.leave()
    await s.leave()
    this.sessions.delete(old); this.calls.delete(old)
    await db.moveEvents(old, code)
    for (const k of Object.keys(this.lastRead)) {
      if (!k.startsWith(old + ':')) continue
      this.lastRead[code + k.slice(old.length)] = this.lastRead[k]
      delete this.lastRead[k]
    }
    save('read', this.lastRead)
    g.code = code; g.title = title
    save('groups', this.groups)
    this.open(g)
    if (active) { this.active = code; try { localStorage.setItem('telsiz.active', code) } catch { /* yok */ } }
    this.showToast('Davet kodu yenilendi')
    if (wasIn) {
      const keep = this.active, route = this.route
      this.active = code
      await this.joinVoice(false, muted)
      this.active = keep; this.route = route
    }
    this.bump()
  }

  // Yeni linkle giren kişinin eski koddaki grubu aynı gruba katılır, listede iki kez durmaz.
  private async absorb(s: Session) {
    for (const g of [...this.groups]) {
      if (g.code === s.code || !s.view.prevs.has(await codeHash(g.code))) continue
      await s.absorbEvents(await db.loadEvents(g.code))
      await this.leaveGroup(g.code, true)
    }
  }

  async leaveGroup(code: string, keepFiles = false) {
    this.calls.get(code)?.leave()
    const s = this.sessions.get(code)
    if (s && !keepFiles) for (const m of s.view.byId.values()) if (m.file) void db.deleteFile(m.file.id).catch(() => {})
    await s?.leave()
    this.sessions.delete(code); this.calls.delete(code)
    this.groups = this.groups.filter(g => g.code !== code)
    save('groups', this.groups)
    void db.dropGroup(code)
    if (this.active === code || !this.active) this.active = this.groups[0]?.code ?? null
    this.bump()
  }

  // Çıkan cihaz seçimden silinmez: takılınca kaldığı yerden devam eder.
  async setMic(id: string) {
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    this.prefs.micId = id
    this.prefs.micLabel = id ? list.find(d => d.kind === 'audioinput' && d.deviceId === id)?.label ?? '' : ''
    this.savePrefs()
    await this.liveCall()?.changeMic()
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

  async saveClip() {
    const s = this.liveSession(), c = this.liveCall()
    if (!s || !c?.clip) { this.showToast('Önce klip kaydını aç'); return }
    const blob = await c.clip.save()
    if (!blob) { this.showToast('Henüz kaydedilecek bir şey yok'); return }
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-')
    const ch = this.route.kind === 'text' ? this.route.ch : 'genel'
    s.sendFile(ch, new File([blob], `klip-${stamp}.webm`, {type: 'video/webm'}))
    this.showToast('Klip sohbete gönderildi')
  }

  // Oyunun üstündeki küçük pencere: sadece değişiklik olunca gönderilir.
  private lastOverlay = ''
  private pushOverlay() {
    const d = desktop()
    if (!d?.setOverlay) return
    const s = this.liveSession(), c = this.liveCall()
    let people: {name: string; talk: boolean; muted: boolean}[] | null = null
    if (s && c && this.prefs.overlay) {
      people = [{name: this.me.name, talk: c.speaking.has('me'), muted: s.voice.muted}]
      for (const [id, p] of s.peers) if (p.voice.in) people.push({name: p.name, talk: c.speaking.has(id), muted: p.voice.muted})
      for (const u of s.indirect().values()) if (u.voice.in) people.push({name: u.name, talk: c.speaking.has('r:' + u.uid), muted: u.voice.muted})
    }
    const key = JSON.stringify(people)
    if (key === this.lastOverlay) return
    this.lastOverlay = key
    d.setOverlay(people)
  }

  setProfile(p: Profile) {
    this.profiles[this.me.uid] = {...this.profiles[this.me.uid], ...p}
    save('prof', this.profiles)
    for (const s of this.sessions.values()) s.sendProfile()
    this.bump()
  }

  private lastSfx = new Map<string, number>()
  private onSfx(s: Session, id: string, peerId: string) {
    const now = Date.now()
    if (!s.voice.in || s.voice.deaf || !this.prefs.sfx || now - (this.lastSfx.get(peerId) ?? 0) < 700) return
    this.lastSfx.set(peerId, now)
    playSfx(id, this.prefs.speakerId)
  }

  sendSfx(id: string) {
    const s = this.liveSession()
    if (!s) return
    s.sendSfx(id)
    if (!s.voice.deaf) playSfx(id, this.prefs.speakerId)
  }

  // Grup ayarındaki gün ve saat gelince, uygulama açıksa herkes aynı hatırlatmayı görür.
  private checkSchedules() {
    const now = new Date()
    const hm = now.toTimeString().slice(0, 5)
    for (const s of this.sessions.values()) {
      const c = s.view.sched
      if (!c?.on || !c.days.includes(now.getDay()) || c.time !== hm) continue
      const key = `${s.code}:${now.toDateString()}`
      if (this.remindedAt === key) continue
      this.remindedAt = key
      this.ring = {code: s.code, name: 'Maç vakti', title: s.view.title, text: 'Sese gelin'}
      if (this.prefs.sounds) playSfx('ace', this.prefs.speakerId)
      this.notify('Telsiz', `${s.view.title}: maç vakti`)
      desktop()?.flash()
      this.bump()
    }
  }
  private remindedAt = ''

  private onMessage(s: Session, e: Ev & {t: 'msg'}) {
    const fresh = Date.now() - e.ts < 30_000
    const viewing = s.code === this.active && !away() && (this.route.kind === 'text' ? this.route.ch === e.ch : this.roomChatOpen && e.ch === 'ses')
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
    if (!away() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    try { new Notification(title, {body, icon: 'icon-192.png'}) } catch { /* mobil kısıtı */ }
  }

  async joinVoice(cam = false, muted = false) {
    const c = this.call
    if (!c) return
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => {})
    this.liveCall()?.leave()
    try {
      await c.join(cam, muted)
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
