import {joinRoom} from 'trystero'
import {materialize, missingFor, validEvent} from './history'
import * as db from './db'
import {lowLatencySdp, randomId} from './util'
import type {Ev, FileMeta, Presence, View, VoiceState} from './types'

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
}
type Incoming = {meta: FileMeta; parts: Blob[]; got: number; source: string}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Act = any

export class Session {
  readonly events = new Map<string, Ev>()
  readonly peers = new Map<string, Presence>()
  readonly typing = new Map<string, {name: string; ch: string; until: number}>()
  readonly transfers = new Map<string, Transfer>()
  readonly uploads = new Map<string, number>()
  readonly stats = new Map<string, {rtt?: number; relayed?: boolean}>()
  view: View
  linkError = ''
  voice: VoiceState = {in: false, muted: false, deaf: false, cam: false, screen: false}
  onPeerLeft?: (peerId: string) => void
  onPresence?: () => void

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  room: any
  private a!: Record<'hello' | 'ids' | 'ev' | 'typing' | 'ring' | 'have' | 'req' | 'chunk', Act>
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
      {onJoinError: (d: {error?: string}) => { this.linkError = String(d?.error ?? 'bağlantı kurulamadı'); this.hooks.changed() }} as never,
    )
    const r = this.room
    this.a = {
      hello: r.makeAction('hello'), ids: r.makeAction('ids'), ev: r.makeAction('ev'), typing: r.makeAction('typing'),
      ring: r.makeAction('ring'), have: r.makeAction('have', {kind: 'request'}), req: r.makeAction('freq'), chunk: r.makeAction('chunk'),
    }
    this.a.hello.onMessage = (p: Presence, {peerId}: {peerId: string}) => this.gotHello(p, peerId)
    this.a.ids.onMessage = (ids: string[], {peerId}: {peerId: string}) => {
      if (!Array.isArray(ids)) return
      this.pushEvents(missingFor(this.events, ids), peerId)
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
      this.a.ids.send([...this.events.keys()], {target: peerId})
      this.retryWanted()
      this.hooks.changed()
    }
    r.onPeerLeave = (peerId: string) => {
      this.peers.delete(peerId); this.typing.delete(peerId); this.stats.delete(peerId)
      this.onPeerLeft?.(peerId)
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
    if (old.length) this.a.ids.send([...this.events.keys()])
  }

  private rebuild() { this.view = materialize(this.events.values(), this.fallbackTitle); this.hooks.changed() }
  private presence(): Presence { return {uid: this.me.uid, name: this.me.name, voice: this.voice} }

  private gotHello(p: Presence, peerId: string) {
    if (!p || typeof p.uid !== 'string' || typeof p.name !== 'string' || !p.voice) return
    this.peers.set(peerId, {uid: p.uid, name: p.name.slice(0, 40), voice: {...p.voice}})
    this.onPresence?.()
    this.hooks.changed()
  }

  announce() { this.a.hello.send(this.presence()); this.onPresence?.(); this.hooks.changed() }
  setMe(me: Me) { this.me = me; this.announce() }

  private pushEvents(evs: Ev[], target?: string) {
    for (let i = 0; i < evs.length; i += 100) this.a.ev.send(evs.slice(i, i + 100), target ? {target} : undefined)
  }

  private gotEvents(evs: unknown[], from: string) {
    if (!Array.isArray(evs)) return
    const fresh = evs.filter((e): e is Ev => validEvent(e) && !this.events.has(e.id))
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
    if (others.length) this.a.ev.send(fresh, {target: others})
  }

  emit(e: Omit<Ev, 'id' | 'ts' | 'uid' | 'name'>) {
    const ev = {...e, id: randomId(), ts: Date.now(), uid: this.me.uid, name: this.me.name} as Ev
    this.events.set(ev.id, ev)
    void db.saveEvents(this.code, [ev])
    this.a.ev.send([ev])
    this.rebuild()
    return ev
  }

  sendText(ch: string, text: string, re?: string) { this.emit({t: 'msg', ch, text, ...(re ? {re} : {})} as never) }
  sendTyping(ch: string) { this.a.typing.send(ch) }
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
