import {getRelaySockets, joinRoom} from 'trystero'
import {dmOthers, isDm, materialize, missingFor, validEvent, visibleTo} from './history'
import * as db from './db'
import {lowLatencySdp, randomId} from './util'
import type {Ev, FileMeta, Other, Presence, Profile, View, VoiceState} from './types'

export const CHUNK = 128 * 1024
export const AUTO_FETCH = 25 * 1024 * 1024 // küçük dosyalar herkese kendiliğinden iner
const KEEP_MAX = 300 * 1024 * 1024 // bunun altı cihazda kalır, üstü sadece oturum boyunca
const GAME_RATE = 1024 * 1024 // oyun modunda yükleme sınırı (bayt/sn)

// Opus varsayılanı 20 ms'lik paket. 10 ms'ye inmek her yönde ~10 ms kazandırır, karşı taraf
// bunu SDP'den okuduğu için gelen teklif/cevaba eklenir.
class LowLatencyPC extends RTCPeerConnection {
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
  private a!: Record<'hello' | 'ids' | 'ev' | 'typing' | 'ring' | 'have' | 'req' | 'chunk' | 'seen' | 'prof' | 'sfx', Act>
  private blobs = new Map<string, Blob>()
  private urls = new Map<string, string>()
  private incoming = new Map<string, Incoming>()
  private wanted = new Map<string, FileMeta>()
  private serving = new Set<string>()
  private statTimer: ReturnType<typeof setInterval>

  constructor(readonly code: string, private me: Me, private fallbackTitle: string, private hooks: Hooks, turn: RTCIceServer[]) {
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
      ring: r.makeAction('ring'), have: r.makeAction('have', {kind: 'request'}), req: r.makeAction('freq'), chunk: r.makeAction('chunk'), seen: r.makeAction('seen'), prof: r.makeAction('prof'), sfx: r.makeAction('sfx'),
    }
    this.a.hello.onMessage = (p: Presence, {peerId}: {peerId: string}) => this.gotHello(p, peerId)
    this.a.prof.onMessage = (d: {uid: string} & Profile) => {
      if (!d || typeof d.uid !== 'string') return
      const color = typeof d.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : undefined
      const avatar = typeof d.avatar === 'string' && d.avatar.startsWith('data:image/jpeg;base64,') && d.avatar.length < 60_000 ? d.avatar : undefined
      this.hooks.profile(d.uid, {color, avatar})
    }
    this.a.sfx.onMessage = (id: string, {peerId}: {peerId: string}) => { if (typeof id === 'string') this.hooks.sfx(this, id, peerId) }
    this.a.ids.onMessage = (d: {uid?: string; ids?: string[]}, {peerId}: {peerId: string}) => {
      if (!d || !Array.isArray(d.ids) || typeof d.uid !== 'string') return
      this.pushEvents(missingFor(this.events, d.ids).filter(e => visibleTo(e, d.uid!)), peerId)
    }
    this.a.seen.onMessage = (d: {uid: string; ch: string; ts: number}) => {
      if (!d || typeof d.uid !== 'string' || typeof d.ch !== 'string' || !Number.isFinite(d.ts)) return
      if (isDm(d.ch) && !d.ch.split(':').includes(this.me.uid)) return
      const m = this.seen.get(d.ch) ?? new Map<string, number>()
      if ((m.get(d.uid) ?? 0) < d.ts) { m.set(d.uid, d.ts); this.seen.set(d.ch, m); this.hooks.changed() }
    }
    this.a.ev.onMessage = (evs: unknown[], {peerId}: {peerId: string}) => this.gotEvents(evs, peerId)
    this.a.typing.onMessage = (ch: string, {peerId}: {peerId: string}) => {
      const p = this.peers.get(peerId)
      if (p && typeof ch === 'string') { this.typing.set(peerId, {name: p.name, ch, until: Date.now() + 3500}); this.hooks.changed() }
    }
    this.a.ring.onMessage = (_: unknown, {peerId}: {peerId: string}) => {
      const p = this.peers.get(peerId)
      if (p) this.hooks.ring(this, p.name)
    }
    this.a.have.onRequest = async (id: string) => !!(await this.blobOf(id))
    this.a.req.onMessage = (d: {id: string; off: number}, {peerId}: {peerId: string}) => void this.serve(peerId, d)
    this.a.chunk.onMessage = (data: ArrayBuffer, {peerId, metadata}: {peerId: string; metadata: {id: string; off: number}}) => this.gotChunk(data, peerId, metadata)

    r.onPeerJoin = (peerId: string) => {
      this.linkError = ''
      this.a.hello.send(this.presence(), {target: peerId})
      this.a.prof.send({uid: this.me.uid, ...this.hooks.myProfile()}, {target: peerId})
      this.announce()
      this.a.ids.send({uid: this.me.uid, ids: [...this.events.keys()]}, {target: peerId})
      for (const [ch, ts] of this.mySeen) if (!isDm(ch)) this.a.seen.send({uid: this.me.uid, ch, ts}, {target: peerId})
      this.retryWanted()
      this.hooks.changed()
    }
    r.onPeerLeave = (peerId: string) => {
      this.peers.delete(peerId); this.typing.delete(peerId); this.stats.delete(peerId)
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
    for (const e of old) this.events.set(e.id, e)
    this.rebuild()
    if (old.length) this.a.ids.send({uid: this.me.uid, ids: [...this.events.keys()]})
  }

  private rebuild() { this.view = materialize(this.events.values(), this.fallbackTitle); this.hooks.changed() }
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

  sendSfx(id: string) { this.a.sfx.send(id) }
  sendProfile() { this.a.prof.send({uid: this.me.uid, ...this.hooks.myProfile()}) }

  private gotHello(p: Presence, peerId: string) {
    if (!p || typeof p.uid !== 'string' || typeof p.name !== 'string' || !p.voice) return
    const others = Array.isArray(p.others) ? p.others.filter(o => o && typeof o.uid === 'string' && typeof o.name === 'string' && o.voice).slice(0, 20) : []
    const old = this.peers.get(peerId)
    const next = {uid: p.uid, name: p.name.slice(0, 40), voice: {...p.voice}, others}
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

  private gotEvents(evs: unknown[], from: string) {
    if (!Array.isArray(evs)) return
    const fresh = evs.filter((e): e is Ev => validEvent(e) && !this.events.has(e.id) && visibleTo(e, this.me.uid))
    if (!fresh.length) return
    for (const e of fresh) this.events.set(e.id, e)
    void db.saveEvents(this.code, fresh)
    this.rebuild()
    for (const e of fresh) if (e.t === 'msg') {
      this.hooks.message(this, e)
      if (e.file && e.file.size <= AUTO_FETCH && !this.hooks.getGameMode()) void this.fetchFile(e.file)
    }
    // İki kişi birbirine doğrudan bağlanamasa da ortak arkadaş üzerinden yazışma ulaşır.
    const others = Object.keys(this.room.getPeers()).filter(p => p !== from)
    const open = fresh.filter(e => !isDm((e as {ch?: string}).ch))
    if (others.length && open.length) this.a.ev.send(open, {target: others})
  }

  emit(e: Omit<Ev, 'id' | 'ts' | 'uid' | 'name'>) {
    const x = e as {ch?: string; target?: string}
    const parent = x.target ? this.view.byId.get(x.target) : undefined
    const ch = x.ch ?? (parent && isDm(parent.ch) ? parent.ch : undefined)
    const ev = {...e, ...(ch ? {ch} : {}), id: randomId(), ts: Date.now(), uid: this.me.uid, name: this.me.name} as Ev
    this.events.set(ev.id, ev)
    void db.saveEvents(this.code, [ev])
    if (isDm(ch)) {
      const target = this.peerIdsOf(ch!)
      if (target.length) this.a.ev.send([ev], {target})
    } else this.a.ev.send([ev])
    this.rebuild()
    return ev
  }

  private peerIdsOf(ch: string) {
    const uids = new Set(dmOthers(ch, this.me.uid))
    return [...this.peers].filter(([, p]) => uids.has(p.uid)).map(([id]) => id)
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
    if (!d || typeof d.id !== 'string' || !Number.isSafeInteger(d.off) || d.off < 0) return
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
