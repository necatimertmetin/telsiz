import {getRelaySockets, joinRoom, selfId} from 'trystero'
import {isLook} from './faces'
import {can, canAccept, canMove, dmMembers, isDm, materialize, missingFor, pinResult, shouldPurge, validEvent, visibleTo} from './history'
import {codeHash, openBox, sealBox, signEvent, signText, validPk, verifyEvent, verifyText, type Identity} from './identity'
import * as db from './db'
import {TV_EMPTY, tvApply, tvNewer, tvPos, validTv, ytId, type TvAction, type TvState} from './tv'
import {lowLatencySdp, newRoomCode, orderCodecs, parseInvite, randomId} from './util'
import {screenCodec} from './native'
import type {Ev, FileMeta, Other, Presence, Profile, RoomKind, Station, View, VoiceState} from './types'

export const CHUNK = 128 * 1024
export const AUTO_FETCH = 25 * 1024 * 1024 // küçük dosyalar herkese kendiliğinden iner
const KEEP_MAX = 300 * 1024 * 1024 // bunun altı cihazda kalır, üstü sadece oturum boyunca
const GAME_RATE = 1024 * 1024 // oyun modunda yükleme sınırı (bayt/sn)

// Opus varsayılanı 20 ms'lik paket. 10 ms'ye inmek her yönde ~10 ms kazandırır, karşı taraf
// bunu SDP'den okuduğu için gelen teklif/cevaba eklenir.
class LowLatencyPC extends RTCPeerConnection {
  // Sadece ekran izinde 'detail' ipucu var, kamera ve ses olduğu gibi kalır.
  addTrack(t: MediaStreamTrack, ...s: MediaStream[]) {
    const sender = super.addTrack(t, ...s)
    if (t.kind === 'video' && t.contentHint === 'detail') {
      try {
        const x = this.getTransceivers().find(y => y.sender === sender)
        const c = RTCRtpSender.getCapabilities('video')?.codecs
        if (x && c) x.setCodecPreferences(orderCodecs(c, screenCodec))
      } catch { /* tarayıcı kendi seçsin */ }
    }
    return sender
  }

  setRemoteDescription(d?: RTCSessionDescriptionInit) {
    return super.setRemoteDescription(d?.sdp ? {type: d.type, sdp: lowLatencySdp(d.sdp)} : d as RTCSessionDescriptionInit)
  }
}

export type Transfer = {status: 'idle' | 'finding' | 'getting' | 'done' | 'missing'; got: number; total: number}
export type Me = {uid: string; name: string}
export type Hooks = {
  changed(): void
  message(s: Session, e: Ev & {t: 'msg'}): void
  ring(s: Session, name: string): void
  getGameMode(): boolean
  profile(uid: string, p: Profile): void
  myProfile(): Profile
  sfx(s: Session, id: string, peerId: string): void
  pinOf(uid: string): string | undefined
  pin(uid: string, pk: string): void
  toast(text: string): void
  rekey(s: Session, code: string): void
  removed(s: Session, text: string): void
  absorb(s: Session): Promise<void>
  move(s: Session, room: string, by: string): void
}
type Incoming = {meta: FileMeta; parts: Blob[]; got: number; source: string}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Act = any

// Sadece test: iki kişi birbirine doğrudan bağlanamıyormuş gibi davranır.
function testBlock(uid: string) {
  let block: string | null = null
  try { block = localStorage.getItem('telsiz.block') } catch { /* yok */ }
  if (block === null) return {}
  return {onPeerHandshake: async (_: string, send: (d: string) => Promise<void>, receive: () => Promise<{data: string}>) => {
    await send(uid)
    const {data} = await receive()
    if (block!.split(',').includes(data)) throw new Error('test engeli')
  }}
}

export class Session {
  readonly events = new Map<string, Ev>()
  readonly peers = new Map<string, Presence>()
  readonly typing = new Map<string, {name: string; ch: string; until: number}>()
  readonly transfers = new Map<string, Transfer>()
  readonly uploads = new Map<string, number>()
  readonly seen = new Map<string, Map<string, number>>() // kanal -> kişi -> son görülen mesaj zamanı
  private mySeen = new Map<string, number>()
  readonly stats = new Map<string, {rtt?: number; relayed?: boolean}>()
  view: View
  linkError = ''
  relayOk = true
  voice: VoiceState = {in: false, muted: false, deaf: false, cam: false, screen: false, sAudio: false}
  onPeerLeft?: (peerId: string) => void
  onPresence?: () => void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  room: any
  private a!: Record<'hello' | 'ids' | 'ev' | 'typing' | 'ring' | 'have' | 'req' | 'chunk' | 'seen' | 'prof' | 'sfx' | 'auth' | 'tv' | 'move', Act>
  private blobs = new Map<string, Blob>()
  private urls = new Map<string, string>()
  private incoming = new Map<string, Incoming>()
  private wanted = new Map<string, FileMeta>()
  private serving = new Set<string>()
  private statTimer: ReturnType<typeof setInterval>
  private plain = new Map<string, Ev>() // açılmış hali; ekran bunu gösterir, ağa 'events' gider
  private authed = new Map<string, string>() // bağlantı → imzasıyla kanıtlanmış kimlik
  private waiting = new Map<string, (() => void)[]>()
  private inbox: Promise<unknown> = Promise.resolve()
  private outbox: Promise<unknown> = Promise.resolve()
  private fileCh = new Map<string, string>()
  private leaving = false
  // Her ses odasının kendi izleme listesi var. Ekran seste olduğun odanınkini gösterir.
  readonly tvs = new Map<string, TvState>()
  get tvRoom() { return this.voice.in ? this.voice.room ?? '' : '' }
  get tv(): TvState { return this.tvs.get(this.tvRoom) ?? TV_EMPTY }
  private tvSubs = new Set<() => void>()

  constructor(readonly code: string, private me: Me, private fallbackTitle: string, private hooks: Hooks, turn: RTCIceServer[], private identity: Promise<Identity>) {
    this.view = materialize([], fallbackTitle)
    this.room = joinRoom(
      {appId: 'telsiz-p2p-v1', password: code, relayConfig: {redundancy: 5, warnOnRelayFailure: false}, rtcPolyfill: LowLatencyPC, ...(turn.length ? {turnConfig: turn} : {})} as never,
      code,
      {
        onJoinError: (d: {error?: string}) => { this.linkError = String(d?.error ?? 'bağlantı kurulamadı'); this.hooks.changed() },
        ...testBlock(me.uid),
      } as never,
    )
    const r = this.room
    this.a = {
      hello: r.makeAction('hello'), ids: r.makeAction('ids'), ev: r.makeAction('ev'), typing: r.makeAction('typing'),
      ring: r.makeAction('ring'), have: r.makeAction('have', {kind: 'request'}), req: r.makeAction('freq'), chunk: r.makeAction('chunk'), seen: r.makeAction('seen'), prof: r.makeAction('prof'), sfx: r.makeAction('sfx'), auth: r.makeAction('auth'), tv: r.makeAction('tv'), move: r.makeAction('move'),
    }
    // Takım dağıtma ve yöneticinin sürükleyip taşıması: gönderenin kimliği bağlantıdan bilinir, yetkisi yoksa yok sayılır.
    this.a.move.onMessage = (d: {to?: Record<string, string>}, {peerId}: {peerId: string}) => {
      const by = this.authed.get(peerId)
      const room = d?.to && typeof d.to === 'object' ? d.to[this.me.uid] : undefined
      if (!by || typeof room !== 'string' || !canMove(this.view, by)) return
      if (room && !this.view.rooms.some(x => x.id === room)) return
      this.hooks.move(this, room, this.view.people.get(by) ?? this.peers.get(peerId)?.name ?? 'Biri')
    }
    this.a.hello.onMessage = (p: Presence, {peerId}: {peerId: string}) => this.whenAuthed(peerId, () => this.gotHello(p, peerId))
    this.a.auth.onMessage = (d: {uid: string; pk: string; sig: string}, {peerId}: {peerId: string}) => void this.gotAuth(d, peerId)
    this.a.tv.onMessage = (d: unknown, {peerId}: {peerId: string}) => {
      const room = typeof (d as {room?: unknown})?.room === 'string' ? (d as {room: string}).room.slice(0, 32) : ''
      const cur = this.tvs.get(room) ?? TV_EMPTY
      if (!this.authed.has(peerId) || !validTv(d) || !tvNewer(d.rev, cur.rev)) return
      // Konum gönderim anına ait: yolda geçen süre eklenir, saat farkı işe karışmaz.
      const late = d.playing ? (this.stats.get(peerId)?.rtt ?? 0) / 2000 : 0
      const {room: _r, ...state} = d as typeof d & {room?: string}
      this.tvs.set(room, {...state, pos: state.pos + late, at: performance.now()})
      this.tvChanged()
    }
    this.a.prof.onMessage = (d: {uid: string} & Profile, {peerId}: {peerId: string}) => {
      if (!d || d.uid !== this.authed.get(peerId)) return
      const color = typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : undefined
      const avatar = typeof d.avatar === 'string' && d.avatar.startsWith('data:image/jpeg;base64,') && d.avatar.length < 60_000 ? d.avatar : undefined
      const look = isLook(d.look) ? d.look : undefined
      const num = (v: unknown, max: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < max ? v as number : undefined
      this.hooks.profile(d.uid, {color, avatar, look, seed: num(d.seed, 100000), icon: num(d.icon, 64)})
    }
    this.a.sfx.onMessage = (id: string, {peerId}: {peerId: string}) => { if (typeof id === 'string') this.hooks.sfx(this, id, peerId) }
    this.a.ids.onMessage = (d: {uid?: string; ids?: string[]}, {peerId}: {peerId: string}) => {
      if (!d || !Array.isArray(d.ids)) return
      // Kim olduğu kendi beyanından değil, kanıtından alınır.
      this.whenAuthed(peerId, () => this.pushEvents(missingFor(this.events, d.ids!).filter(e => visibleTo(e, this.authed.get(peerId)!)), peerId))
    }
    this.a.seen.onMessage = (d: {uid: string; ch: string; ts: number}, {peerId}: {peerId: string}) => {
      if (!d || d.uid !== this.authed.get(peerId) || typeof d.ch !== 'string' || !Number.isFinite(d.ts)) return
      if (isDm(d.ch) && !d.ch.split(':').includes(this.me.uid)) return
      const m = this.seen.get(d.ch) ?? new Map<string, number>()
      if ((m.get(d.uid) ?? 0) < d.ts) { m.set(d.uid, d.ts); this.seen.set(d.ch, m); this.hooks.changed() }
    }
    this.a.ev.onMessage = (evs: unknown[], {peerId}: {peerId: string}) => { this.inbox = this.inbox.then(() => this.gotEvents(evs, peerId)).catch(() => {}) }
    this.a.typing.onMessage = (ch: string, {peerId}: {peerId: string}) => {
      const p = this.peers.get(peerId)
      if (p && typeof ch === 'string') { this.typing.set(peerId, {name: p.name, ch, until: Date.now() + 3500}); this.hooks.changed() }
    }
    this.a.ring.onMessage = (_: unknown, {peerId}: {peerId: string}) => {
      const p = this.peers.get(peerId)
      if (p) this.hooks.ring(this, p.name)
    }
    this.a.have.onRequest = async (id: string, {peerId}: {peerId: string}) => this.mayGet(id, peerId) && !!(await this.blobOf(id))
    this.a.req.onMessage = (d: {id: string; off: number}, {peerId}: {peerId: string}) => void this.serve(peerId, d)
    this.a.chunk.onMessage = (data: ArrayBuffer, {peerId, metadata}: {peerId: string; metadata: {id: string; off: number}}) => this.gotChunk(data, peerId, metadata)

    r.onPeerJoin = (peerId: string) => {
      this.linkError = ''
      void this.sendAuth(peerId)
      this.hooks.changed()
    }
    r.onPeerLeave = (peerId: string) => {
      this.peers.delete(peerId); this.typing.delete(peerId); this.stats.delete(peerId)
      this.authed.delete(peerId); this.waiting.delete(peerId)
      this.onPeerLeft?.(peerId)
      this.announce()
      for (const inc of this.incoming.values()) if (inc.source === peerId) { inc.source = ''; void this.locate(inc.meta) }
      this.hooks.changed()
    }
    this.statTimer = setInterval(() => void this.sampleStats(), 5000)
    void this.loadStored()
  }

  private async loadStored() {
    const old = await db.loadEvents(this.code).catch(() => [])
    const id = await this.identity
    for (const e of old) {
      this.events.set(e.id, e)
      const open = await this.reveal(e, id)
      if (open) this.plain.set(e.id, open)
    }
    await this.purge()
    this.rebuild()
    if (old.length) this.a.ids.send({uid: this.me.uid, ids: [...this.events.keys()]})
    void this.enforce()
  }

  // Silme, atılma ve yeni kod burada uygulanır. Gitmeden önce az beklenir: olay diğerlerine de aktarılsın.
  private async enforce() {
    if (this.leaving) return
    const {view, me} = this
    const off = (f: () => void) => { this.leaving = true; setTimeout(f, 800) }
    if (view.wiped) return off(() => this.hooks.removed(this, `${view.title} grubu silindi`))
    if (view.banned.has(me.uid)) return off(() => this.hooks.removed(this, `${view.title} grubundan çıkarıldın`))
    const kick = view.lastKick ? this.events.get(view.lastKick) : undefined
    if (kick?.t === 'kick' && kick.pk && kick.box.keys[me.uid]) {
      const inner = await openBox(await this.identity, kick.box, me.uid, kick.pk).catch(() => null) as {code?: unknown} | null
      const code = typeof inner?.code === 'string' ? parseInvite(inner.code) : null
      if (code && code !== this.code && !this.leaving) return off(() => this.hooks.rekey(this, code))
    }
    if (view.prevs.size) await this.hooks.absorb(this)
  }

  // Ses odası: kurulur ya da silinir. Kimlik kısa ve rastgele, başlık değişse de oda aynı kalır.
  makeRoom(title: string, kind: RoomKind = 'voice') {
    const rid = randomId().slice(0, 12)
    this.emit({t: 'vroom', rid, title: title.trim().slice(0, 40), on: true, kind} as never)
    return rid
  }
  dropRoom(rid: string) {
    const r = this.view.rooms.find(x => x.id === rid)
    if (r) this.emit({t: 'vroom', rid, title: r.title, on: false} as never)
  }
  addStation(st: Omit<Station, 'id'>) { this.emit({t: 'station', sid: randomId().slice(0, 12), ...st, on: true} as never) }
  dropStation(st: Station) { this.emit({t: 'station', sid: st.id, title: st.title, url: st.url, tag: st.tag, on: false} as never) }
  tune(rid: string, sid: string) { this.emit({t: 'tune', rid, sid} as never) }
  // Yeni kurulan oda olayı önce gitsin: karşı taraf bilmediği odaya taşınmayı reddeder.
  async flush() { await this.outbox }
  sendMove(to: Record<string, string>) { this.a.move.send({to}) }

  setRole(uid: string, role: 'admin' | 'member') { this.emit({t: 'role', target: uid, role} as never) }

  // Yeni kod kalan üyelere şifreli gider. Atılan kişi kutuyu açamaz, eski kod da boş kalır.
  async kick(uid: string) {
    const id = await this.identity
    const members: Record<string, string> = {}
    const pk = (u: string) => this.hooks.pinOf(u)
    for (const u of new Set([this.me.uid, ...this.view.people.keys(), ...this.authed.values()])) {
      const key = pk(u)
      if (u !== uid && key && !this.view.banned.has(u) && Object.keys(members).length < 20) members[u] = key
    }
    const box = await sealBox(id, {code: newRoomCode()}, members)
    this.emit({t: 'kick', target: uid, prev: await codeHash(this.code), box} as never)
    await this.outbox
    await this.enforce()
  }

  async wipe() {
    this.emit({t: 'wipe'} as never)
    await this.outbox
    await this.enforce()
  }

  // Aynı grubun eski kodundaki geçmiş buraya katılır, bildirim çalmaz.
  absorbEvents(evs: Ev[]) { return this.gotEvents(evs, '', true) }

  private rebuild() {
    this.view = materialize(this.plain.values(), this.fallbackTitle)
    this.fileCh.clear()
    for (const m of this.view.byId.values()) if (m.file) this.fileCh.set(m.file.id, m.ch)
    this.hooks.changed()
  }

  // Bağlantının karşı ucu kimliğini imzayla kanıtlar. İmza iki ucun bağlantı numarasını içerir:
  // başkasına verilmiş kanıt burada geçmez, araya giren biri de kanıtı aktaramaz.
  private proofText(uid: string, from: string, to: string) { return `telsiz-auth-1|${this.code}|${uid}|${from}|${to}` }

  private async sendAuth(peerId: string) {
    const id = await this.identity
    const sig = await signText(id, this.proofText(this.me.uid, selfId, peerId))
    this.a.auth.send({uid: this.me.uid, pk: id.pk, sig}, {target: peerId})
  }

  private async gotAuth(d: {uid: string; pk: string; sig: string}, peerId: string) {
    if (!d || typeof d.uid !== 'string' || !validPk(d.pk) || typeof d.sig !== 'string') return
    await this.identity // kendi anahtarım kayıtlı olsun: aynı hesabın diğer cihazı onunla karşılaştırılır
    if (!await verifyText(d.pk, this.proofText(d.uid, peerId, selfId), d.sig)) return
    if (this.view.banned.has(d.uid)) return
    const pin = pinResult(this.hooks.pinOf(d.uid), d.pk)
    if (pin === 'conflict') return
    if (pin === 'new') this.hooks.pin(d.uid, d.pk)
    this.authed.set(peerId, d.uid)
    for (const f of this.waiting.get(peerId) ?? []) f()
    this.waiting.delete(peerId)
    this.a.hello.send(this.presence(), {target: peerId})
    this.a.prof.send({uid: this.me.uid, ...this.hooks.myProfile()}, {target: peerId})
    this.announce()
    this.a.ids.send({uid: this.me.uid, ids: [...this.events.keys()]}, {target: peerId})
    for (const room of this.tvs.keys()) this.a.tv.send(this.tvWire(room), {target: peerId})
    for (const [ch, ts] of this.mySeen) if (!isDm(ch)) this.a.seen.send({uid: this.me.uid, ch, ts}, {target: peerId})
    this.retryWanted()
    this.hooks.changed()
    // Hiç yazmamış kişi de üye listesinde dursun: yeni kod ona da gitsin. Önce geçmiş eşitlenir.
    setTimeout(() => { if (!this.leaving && !this.view.people.has(this.me.uid)) this.emit({t: 'hi'} as never) }, 3000)
  }

  private whenAuthed(peerId: string, f: () => void) {
    if (this.authed.has(peerId)) return f()
    const list = this.waiting.get(peerId) ?? []
    if (list.length < 8) this.waiting.set(peerId, [...list, f])
  }

  // Şifreli olayın açılmış hali. Bu cihaz üye değilse boş döner.
  private async reveal(e: Ev, id: Identity): Promise<Ev | null> {
    if (e.t !== 'sealed') return e
    try {
      const inner = await openBox(id, e.box, this.me.uid, e.pk!) as Record<string, unknown>
      const open = {...inner, id: e.id, ts: e.ts, uid: e.uid, name: e.name, ch: e.ch}
      return validEvent(open) ? open : null
    } catch { return null }
  }

  // Silinen mesajın metni, düzenlemeleri, tepkileri ve dosyası cihazdan gerçekten kalkar.
  private async purge() {
    const gone: string[] = []
    for (const del of [...this.plain.values()]) {
      if (del.t !== 'del') continue
      const m = this.plain.get(del.target)
      if (!m || !shouldPurge(m, del)) continue
      for (const e of [...this.plain.values()]) if (e.id === m.id || (e as {target?: string}).target === m.id) if (e.t !== 'del') gone.push(e.id)
      const file = m.t === 'msg' ? m.file : undefined
      if (file) {
        this.blobs.delete(file.id); this.incoming.delete(file.id); this.wanted.delete(file.id); this.transfers.delete(file.id)
        const url = this.urls.get(file.id)
        if (url) { URL.revokeObjectURL(url); this.urls.delete(file.id) }
        await db.deleteFile(file.id).catch(() => {})
      }
    }
    for (const id of gone) { this.plain.delete(id); this.events.delete(id) }
    if (gone.length) await db.deleteEvents(this.code, gone).catch(() => {})
    return new Set(gone)
  }

  // Özel sohbetin dosyasını sadece üyeleri isteyebilir.
  private mayGet(fileId: string, peerId: string) {
    const ch = this.fileCh.get(fileId)
    if (!isDm(ch)) return this.authed.has(peerId)
    const uid = this.authed.get(peerId)
    return !!uid && dmMembers(ch!).includes(uid)
  }
  private presence(): Presence {
    const others: Other[] = [...this.peers.values()].map(p => ({uid: p.uid, name: p.name, voice: p.voice}))
    return {uid: this.me.uid, name: this.me.name, voice: this.voice, others}
  }

  // Bana doğrudan bağlı olmayan ama bir arkadaşıma bağlı kişiler.
  indirect(): Map<string, Other & {via: string}> {
    const direct = new Set([this.me.uid, ...[...this.peers.values()].map(p => p.uid)])
    const out = new Map<string, Other & {via: string}>()
    for (const p of this.peers.values())
      for (const o of p.others ?? []) if (!direct.has(o.uid) && !out.has(o.uid)) out.set(o.uid, {...o, via: p.name})
    return out
  }

  // Eski sürüm 'room' alanını bilmez, ana odanın listesi onlarla da eşleşir.
  private tvWire(room: string) {
    const t = this.tvs.get(room) ?? TV_EMPTY
    const {at: _, ...w} = t
    return {...w, pos: tvPos(t, performance.now()), ...(room ? {room} : {})}
  }
  private tvChanged() { for (const f of this.tvSubs) f(); this.hooks.changed() }
  onTv(f: () => void) { this.tvSubs.add(f); return () => { this.tvSubs.delete(f) } }

  tvDo(act: TvAction) {
    const room = this.tvRoom
    const next = tvApply(this.tv, act, this.me.uid, performance.now())
    if (!next) return
    this.tvs.set(room, next)
    this.a.tv.send(this.tvWire(room))
    this.tvChanged()
  }

  // Link sırada hemen görünür, başlık gelince güncellenir.
  tvAddLink(text: string, by: string) {
    const id = ytId(text)
    if (!id) return false
    const k = randomId()
    this.tvDo({a: 'add', item: {k, id, title: 'YouTube videosu', by: by.slice(0, 40)}})
    void fetch(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + id)}`)
      .then(r => r.json())
      .then((d: {title?: string}) => { if (d.title) this.tvDo({a: 'retitle', k, title: d.title.slice(0, 200)}) })
      .catch(() => {})
    return true
  }

  sendSfx(id: string) { this.a.sfx.send(id) }
  sendProfile() { this.a.prof.send({uid: this.me.uid, ...this.hooks.myProfile()}) }

  private gotHello(p: Presence, peerId: string) {
    if (!p || typeof p.uid !== 'string' || typeof p.name !== 'string' || !p.voice) return
    if (p.uid === this.me.uid) return // aynı hesabın diğer cihazı: eşitlenir, üye olarak görünmez
    const others = Array.isArray(p.others) ? p.others.filter(o => o && typeof o.uid === 'string' && typeof o.name === 'string' && o.voice).slice(0, 20) : []
    const old = this.peers.get(peerId)
    const room = typeof p.voice.room === 'string' && p.voice.room.length <= 32 ? p.voice.room : ''
    const next = {uid: p.uid, name: p.name.slice(0, 40), voice: {...p.voice, room}, others}
    this.peers.set(peerId, next)
    // Komşunun kendi durumu değişince diğerlerine de duyurulur; sadece 'others' değişince
    // duyurulmaz, yoksa iki kişi birbirine sonsuza dek haber verir.
    const same = old && old.uid === next.uid && old.name === next.name && JSON.stringify(old.voice) === JSON.stringify(next.voice)
    if (same) { this.onPresence?.(); this.hooks.changed() } else this.announce()
  }

  announce() { this.a.hello.send(this.presence()); this.onPresence?.(); this.hooks.changed() }
  setMe(me: Me) { this.me = me; this.announce() }

  private pushEvents(evs: Ev[], target?: string) {
    for (let i = 0; i < evs.length; i += 100) this.a.ev.send(evs.slice(i, i + 100), target ? {target} : undefined)
  }

  // İmzası tutmayan ya da kayıtlı anahtarla uyuşmayan olay sessizce düşer.
  private async trusted(e: Ev) {
    if (!canAccept(e)) return false
    const ban = this.view.banned.get(e.uid)
    if (ban !== undefined && e.ts > ban) return false
    if (!e.sig) return true
    if (!validPk(e.pk) || !await verifyEvent(e)) return false
    const pin = pinResult(this.hooks.pinOf(e.uid), e.pk)
    if (pin === 'new') this.hooks.pin(e.uid, e.pk)
    return pin !== 'conflict'
  }

  private async gotEvents(evs: unknown[], from: string, quiet = false) {
    if (!Array.isArray(evs)) return
    const id = await this.identity
    const fresh: Ev[] = []
    for (const e of evs) {
      if (!validEvent(e) || this.events.has(e.id) || !visibleTo(e, this.me.uid) || !await this.trusted(e)) continue
      const open = await this.reveal(e, id)
      this.events.set(e.id, e)
      if (open) this.plain.set(e.id, open)
      fresh.push(e)
    }
    if (!fresh.length) return
    const gone = await this.purge()
    const kept = fresh.filter(e => !gone.has(e.id))
    if (!kept.length) return
    void db.saveEvents(this.code, kept)
    this.rebuild()
    if (quiet) return
    for (const w of kept) {
      const e = this.plain.get(w.id)
      if (e?.t !== 'msg') continue
      this.hooks.message(this, e)
      if (e.file && e.file.size <= AUTO_FETCH && !this.hooks.getGameMode()) void this.fetchFile(e.file)
    }
    // İki kişi birbirine doğrudan bağlanamasa da ortak arkadaş üzerinden yazışma ulaşır.
    const others = Object.keys(this.room.getPeers()).filter(p => p !== from)
    const open = kept.filter(e => !isDm((e as {ch?: string}).ch))
    if (others.length && open.length) this.a.ev.send(open, {target: others})
    await this.enforce()
  }

  emit(e: Omit<Ev, 'id' | 'ts' | 'uid' | 'name'>) {
    const x = e as {ch?: string; target?: string}
    const parent = x.target ? this.view.byId.get(x.target) : undefined
    const ch = x.ch ?? (parent && isDm(parent.ch) ? parent.ch : undefined)
    const ev = {...e, ...(ch ? {ch} : {}), id: randomId(), ts: Date.now(), uid: this.me.uid, name: this.me.name} as Ev
    if (isDm(ch)) {
      const missing = dmMembers(ch!).filter(u => !this.hooks.pinOf(u))
      if (missing.length) {
        const names = missing.map(u => this.view.people.get(u) ?? 'Biri').join(', ')
        this.hooks.toast(`${names} yeni sürüme geçip bağlanınca özel mesaj atabilirsin`)
        return ev
      }
    }
    this.plain.set(ev.id, ev)
    this.rebuild()
    this.outbox = this.outbox.then(() => this.publish(ev)).catch(e => console.warn('gönderilemedi', e))
    return ev
  }

  // Ekrana hemen düşer; şifreleme ve imza arkada sırayla yapılır, sıra bozulmaz.
  private async publish(ev: Ev) {
    const id = await this.identity
    const ch = (ev as {ch?: string}).ch
    if (!this.plain.has(ev.id)) return
    let wire: Ev = ev
    if (isDm(ch)) {
      const {id: _i, ts: _t, uid: _u, name: _n, ch: _c, ...inner} = ev as Ev & {ch: string}
      const members = Object.fromEntries(dmMembers(ch!).map(u => [u, this.hooks.pinOf(u)!]))
      wire = {t: 'sealed', id: ev.id, ts: ev.ts, uid: ev.uid, name: ev.name, ch: ch!, box: await sealBox(id, inner, members)}
    }
    const signed = await signEvent(id, wire)
    this.events.set(ev.id, signed)
    void db.saveEvents(this.code, [signed])
    if (ev.t === 'del') { const gone = await this.purge(); if (gone.size) this.rebuild() }
    if (isDm(ch)) {
      const target = this.peerIdsOf(ch!)
      if (target.length) this.a.ev.send([signed], {target})
    } else this.a.ev.send([signed])
  }

  private peerIdsOf(ch: string) {
    const uids = new Set(dmMembers(ch))
    return [...this.authed].filter(([, uid]) => uids.has(uid)).map(([id]) => id)
  }

  sendSeen(ch: string, ts: number) {
    if ((this.mySeen.get(ch) ?? 0) >= ts) return
    this.mySeen.set(ch, ts)
    const msg = {uid: this.me.uid, ch, ts}
    if (isDm(ch)) {
      const target = this.peerIdsOf(ch)
      if (target.length) this.a.seen.send(msg, {target})
    } else this.a.seen.send(msg)
  }

  sendText(ch: string, text: string, re?: string) { this.emit({t: 'msg', ch, text, ...(re ? {re} : {})} as never) }
  sendTyping(ch: string) {
    if (!isDm(ch)) return void this.a.typing.send(ch)
    const target = this.peerIdsOf(ch)
    if (target.length) this.a.typing.send(ch, {target})
  }
  ring() { this.a.ring.send(1) }

  sendFile(ch: string, file: File, text = '') {
    const meta: FileMeta = {id: randomId(), name: file.name.slice(-300) || 'dosya', size: file.size, type: file.type}
    this.blobs.set(meta.id, file)
    this.transfers.set(meta.id, {status: 'done', got: file.size, total: file.size})
    if (file.size <= KEEP_MAX) void db.saveFile(meta.id, file).catch(() => {})
    this.emit({t: 'msg', ch, text, file: meta} as never)
  }

  private async blobOf(id: string): Promise<Blob | undefined> {
    const b = this.blobs.get(id) ?? await db.getFile(id).catch(() => undefined)
    if (b) this.blobs.set(id, b)
    return b
  }

  transfer(meta: FileMeta): Transfer {
    return this.transfers.get(meta.id) ?? {status: 'idle', got: 0, total: meta.size}
  }

  // Önizleme için: dosya cihazda varsa adresini verir, yoksa boş döner.
  async fileUrl(meta: FileMeta): Promise<string | null> {
    const cached = this.urls.get(meta.id)
    if (cached) return cached
    const b = await this.blobOf(meta.id)
    if (!b) return null
    this.transfers.set(meta.id, {status: 'done', got: meta.size, total: meta.size})
    const url = URL.createObjectURL(b.type ? b : new Blob([b], {type: meta.type}))
    this.urls.set(meta.id, url)
    return url
  }

  async getBlob(meta: FileMeta) { return this.blobOf(meta.id) }

  async fetchFile(meta: FileMeta) {
    if (this.incoming.has(meta.id) || await this.blobOf(meta.id)) {
      if (this.blobs.has(meta.id)) { this.transfers.set(meta.id, {status: 'done', got: meta.size, total: meta.size}); this.hooks.changed() }
      return
    }
    this.wanted.set(meta.id, meta)
    this.incoming.set(meta.id, {meta, parts: [], got: 0, source: ''})
    await this.locate(meta)
  }

  private async locate(meta: FileMeta) {
    const inc = this.incoming.get(meta.id)
    if (!inc) return
    this.transfers.set(meta.id, {status: 'finding', got: inc.got, total: meta.size})
    this.hooks.changed()
    for (const peerId of Object.keys(this.room.getPeers())) {
      if (!this.mayGet(meta.id, peerId)) continue
      const yes = await this.a.have.request(meta.id, {target: peerId, timeoutMs: 5000}).catch(() => false)
      if (yes && this.room.getPeers()[peerId]) {
        inc.source = peerId
        this.transfers.set(meta.id, {status: 'getting', got: inc.got, total: meta.size})
        this.a.req.send({id: meta.id, off: inc.got}, {target: peerId})
        this.hooks.changed()
        return
      }
    }
    this.transfers.set(meta.id, {status: 'missing', got: inc.got, total: meta.size})
    this.hooks.changed()
  }

  private retryWanted() {
    for (const inc of this.incoming.values()) if (!inc.source) void this.locate(inc.meta)
  }

  private async serve(peerId: string, d: {id: string; off: number}) {
    if (!d || typeof d.id !== 'string' || !Number.isSafeInteger(d.off) || d.off < 0 || !this.mayGet(d.id, peerId)) return
    const blob = await this.blobOf(d.id)
    if (!blob) return
    const key = `${peerId}:${d.id}`
    if (this.serving.has(key)) return
    this.serving.add(key)
    try {
      for (let off = d.off; off < blob.size && this.room.getPeers()[peerId]; off += CHUNK) {
        const started = performance.now()
        const buf = await blob.slice(off, off + CHUNK).arrayBuffer()
        await this.a.chunk.send(buf, {target: peerId, metadata: {id: d.id, off}})
        this.uploads.set(d.id, off + buf.byteLength)
        if (off % (CHUNK * 16) === 0) this.hooks.changed()
        if (this.hooks.getGameMode()) {
          const wait = buf.byteLength / GAME_RATE * 1000 - (performance.now() - started)
          if (wait > 0) await new Promise(r => setTimeout(r, wait))
        }
      }
    } catch { /* karşı taraf gitti: alıcı başka kaynaktan devam eder */ }
    this.serving.delete(key)
    this.uploads.delete(d.id)
    this.hooks.changed()
  }

  private gotChunk(data: ArrayBuffer, peerId: string, m: {id: string; off: number}) {
    const inc = m && this.incoming.get(m.id)
    if (!inc || inc.source !== peerId || m.off !== inc.got) return
    // Parçalar Blob olarak tutulur: tarayıcı büyük dosyada belleği diske taşır.
    inc.parts.push(new Blob([data]))
    inc.got += data.byteLength
    this.transfers.set(m.id, {status: 'getting', got: inc.got, total: inc.meta.size})
    if (inc.got >= inc.meta.size) {
      const blob = new Blob(inc.parts, {type: inc.meta.type})
      this.blobs.set(m.id, blob)
      this.incoming.delete(m.id)
      this.wanted.delete(m.id)
      this.transfers.set(m.id, {status: 'done', got: inc.got, total: inc.got})
      if (blob.size <= KEEP_MAX) void db.saveFile(m.id, blob).catch(() => {})
      this.hooks.changed()
    } else if (inc.got % (CHUNK * 8) === 0) this.hooks.changed()
  }

  private async sampleStats() {
    try { this.relayOk = Object.values(getRelaySockets() as Record<string, WebSocket>).some(w => w.readyState === 1) } catch { /* yok */ }
    for (const [peerId, pc] of Object.entries(this.room.getPeers() as Record<string, RTCPeerConnection>)) {
      const s = this.stats.get(peerId) ?? {}
      s.rtt = await this.room.ping(peerId).catch(() => undefined)
      const report = await pc.getStats().catch(() => null)
      report?.forEach(x => {
        if (x.type === 'candidate-pair' && x.nominated && x.state === 'succeeded')
          s.relayed = report.get(x.localCandidateId)?.candidateType === 'relay' || report.get(x.remoteCandidateId)?.candidateType === 'relay'
      })
      this.stats.set(peerId, s)
    }
    const now = Date.now()
    for (const [k, v] of this.typing) if (v.until < now) this.typing.delete(k)
    this.hooks.changed()
  }

  async leave() {
    clearInterval(this.statTimer)
    for (const u of this.urls.values()) URL.revokeObjectURL(u)
    await this.room.leave()
  }
}
