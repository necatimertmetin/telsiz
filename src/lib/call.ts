import {Clipper, type ClipSource} from './clip'
import type {Session} from './session'
import {isVirtualMic, worstStat, type ScreenStat} from './util'
import {callStarted, callStopped, pickScreenCodec, reapplySpeaker} from './native'

export type Kind = 'mic' | 'cam' | 'screen'
export type ScreenQ = '720p30' | '1080p30' | '1080p60' | '1440p60'
const SCREEN_GAIN = 2.5

export type AudioPrefs = {screenGain: number; micGain: number; outVol: number; micId: string; micLabel?: string; speakerId: string; camId: string; gate: number; noise: boolean; ptt: boolean; screenQ: ScreenQ}
export const SCREEN_Q: Record<ScreenQ, {w: number; h: number; f: number; b: number; label: string}> = {
  '720p30': {w: 1280, h: 720, f: 30, b: 2_000_000, label: '720p 30 fps'},
  '1080p30': {w: 1920, h: 1080, f: 30, b: 3_500_000, label: '1080p 30 fps'},
  '1080p60': {w: 1920, h: 1080, f: 60, b: 6_000_000, label: '1080p 60 fps'},
  '1440p60': {w: 2560, h: 1440, f: 60, b: 10_000_000, label: '1440p 60 fps'},
}

const BITRATE = {mic: 48_000, cam: 700_000}
const SCREEN_AUDIO = 128_000
const GAME_CAM = 200_000 // oyun modunda oyunun pingi öncelikli
const GAME_SCREEN = 1_500_000

// Herkes herkese doğrudan yollar. 4 kişide kimse için 3 akıştan fazla yükleme yoktur,
// o yüzden kamera bilerek düşük çözünürlükte: oyun oynarken hattı doldurmasın.
const RELAY_WAIT = 6000

export class Call {
  remote = new Map<string, Partial<Record<Kind, MediaStream>>>()
  speaking = new Set<string>() // peerId, kendisi için 'me'
  level = 0
  pttDown = false
  facing: 'user' | 'environment' = 'user'
  streams: Partial<Record<Kind, MediaStream>> = {}

  private raw?: MediaStreamTrack // ölçüm için ham mikrofon; gürültü kapısı bunu etkilemez
  private send?: MediaStreamTrack
  private sent: Record<Kind, Set<string>> = {mic: new Set(), cam: new Set(), screen: new Set()}
  private audios = new Map<string, HTMLAudioElement>()
  private meters = new Map<string, {an: AnalyserNode; src: MediaStreamAudioSourceNode}>()
  private ctx?: AudioContext
  private virtualMic = false
  private micChain?: {src: MediaStreamAudioSourceNode; gain: GainNode}
  screenStats = new Map<string, ScreenStat>() // izlenen yayında peerId, kendi yayınında 'me'
  private statBytes = new Map<string, number>()
  private screenRaw?: {raw: MediaStreamTrack; src: MediaStreamAudioSourceNode; gain: GainNode}
  private localAn?: AnalyserNode
  private timer?: ReturnType<typeof setInterval>
  private tuner?: ReturnType<typeof setInterval>
  private known?: Set<string>
  private openUntil = 0
  private wake?: WakeLockSentinel | null
  private relaying = new Map<string, {stream: MediaStream; to: string}>()
  private gapSince = new Map<string, number>()
  clip?: Clipper
  private relayed = new Map<string, {via: string; el: HTMLAudioElement; an?: AnalyserNode; src?: MediaStreamAudioSourceNode}>()

  constructor(private s: Session, private prefs: () => AudioPrefs, private vol: (uid: string) => number, private changed: () => void, private gameMode: () => boolean, private roster: (joined: boolean) => void, private meUid: () => string) {
    s.room.onPeerStream = (stream: MediaStream, peerId: string, meta?: {kind?: Kind | 'relay'; uid?: string}) => {
      if (meta?.kind === 'relay' && meta.uid) this.gotRelay(stream, peerId, meta.uid)
      else this.gotStream(stream, peerId, (meta?.kind as Kind) ?? 'mic')
    }
    s.onPeerLeft = id => this.dropPeer(id)
    s.onPresence = () => this.sync()
  }

  private async micStream() {
    const p = this.prefs()
    const list = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    const inputs = list.filter(d => d.kind === 'audioinput')
    // Cihaz kimliği değişebilir: seçim adından da bulunur, kullanıcı varsayılana düşmez.
    const dev = inputs.find(d => d.deviceId === (p.micId || 'default')) ?? (p.micLabel ? inputs.find(d => d.label === p.micLabel) : undefined)
    if (p.micId && dev?.label) p.micLabel = dev.label
    const micId = p.micId && (dev?.deviceId ?? p.micId)
    // Ölçüm: gürültü engelleme müzik benzeri sesi üçte birine indiriyor.
    this.virtualMic = isVirtualMic(dev?.label ?? '')
    const talk = !this.virtualMic
    const audio = {echoCancellation: talk, noiseSuppression: talk && p.noise, autoGainControl: talk, channelCount: 1, latency: {ideal: 0.01}} as MediaTrackConstraints
    if (!micId) return navigator.mediaDevices.getUserMedia({audio})
    // 'ideal' seçimi yok sayıp varsayılan mikrofonu açıyor. Cihaz çıkarılmışsa varsayılana dönülür.
    return navigator.mediaDevices.getUserMedia({audio: {...audio, deviceId: {exact: micId}}}).catch(e => {
      if ((e as Error).name !== 'OverconstrainedError' && (e as Error).name !== 'NotFoundError') throw e
      this.virtualMic = false
      return navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: p.noise, autoGainControl: true, channelCount: 1}})
    })
  }

  async join(withCam = false, muted = false) {
    if (this.s.voice.in) return
    const mic = await this.micStream()
    this.raw = mic.getAudioTracks()[0]
    this.send = this.raw.clone()
    this.send.contentHint = this.virtualMic ? 'music' : 'speech'
    this.send.enabled = !muted
    this.streams.mic = new MediaStream([this.send])
    this.ctx = new AudioContext({latencyHint: 'interactive'})
    // Linkten gelen henüz sayfaya dokunmamış olabilir: tarayıcı sesi ilk dokunuşa kadar bekletir, görüşme bekletmez.
    const ctx = this.ctx
    await Promise.race([ctx.resume().catch(() => {}), new Promise(r => setTimeout(r, 400))])
    addEventListener('pointerdown', () => void ctx.resume().catch(() => {}), {once: true})
    const an = this.ctx.createAnalyser()
    an.fftSize = 512
    this.ctx.createMediaStreamSource(new MediaStream([this.raw])).connect(an)
    this.localAn = an
    this.applyMicGain()
    // requestAnimationFrame değil: oyun tam ekranken pencere görünmez sayılır ve rAF durur.
    this.timer = setInterval(() => this.tick(), 100)
    this.tuner = setInterval(() => { void this.tune(); void this.sampleScreen(); this.sync() }, 3000)
    this.s.voice = {in: true, muted, deaf: false, cam: false, screen: false, sAudio: false}
    this.s.announce()
    void callStarted()
    this.wake = await navigator.wakeLock?.request('screen').catch(() => null)
    if (withCam) await this.toggleCam().catch(() => {})
  }

  leave() {
    if (!this.s.voice.in) return
    this.clip?.stop()
    this.clip = undefined
    for (const k of ['screen', 'cam', 'mic'] as Kind[]) this.stopLocal(k)
    this.raw?.stop()
    this.micChain = undefined
    clearInterval(this.timer); clearInterval(this.tuner)
    for (const id of [...this.remote.keys()]) this.dropPeer(id)
    for (const [uid, r] of this.relayed) this.dropRelayed(uid, r)
    for (const r of this.relaying.values()) { try { this.s.room.removeStream(r.stream, {target: r.to}) } catch { /* gitti */ } }
    this.relaying.clear()
    void this.ctx?.close()
    this.ctx = undefined
    this.speaking.clear()
    this.level = 0
    this.known = undefined
    this.s.voice = {in: false, muted: false, deaf: false, cam: false, screen: false, sAudio: false}
    this.s.announce()
    void callStopped()
    void this.wake?.release().catch(() => {})
  }

  // Klip: kendi yayının yoksa arkadaşının ekranı, o da yoksa kamerası kaydedilir; ses hep karışık.
  private clipSource(): ClipSource {
    const all = [...this.remote.values()]
    const pick = this.streams.screen ?? all.find(r => r.screen)?.screen ?? all.find(r => r.cam)?.cam ?? this.streams.cam
    const audio = [...all.map(r => r.mic), ...all.map(r => r.screen), this.streams.screen, [...this.relayed.values()].map(r => r.el.srcObject as MediaStream)].flat().filter(Boolean) as MediaStream[]
    if (this.raw) audio.push(new MediaStream([this.raw]))
    return {video: pick?.getVideoTracks()[0], audio}
  }

  toggleClip() {
    if (!this.ctx) return
    if (this.clip) { this.clip.stop(); this.clip = undefined }
    else { this.clip = new Clipper(this.ctx, () => this.clipSource()); this.clip.start() }
    this.changed()
  }

  private stopLocal(k: Kind) {
    const st = this.streams[k]
    if (!st) return
    const targets = [...this.sent[k]]
    if (targets.length) { try { this.s.room.removeStream(st, {target: targets}) } catch { /* akış zaten düştü */ } }
    st.getTracks().forEach(t => t.stop())
    if (k === 'screen' && this.screenRaw) { this.screenRaw.src.disconnect(); this.screenRaw.raw.stop(); this.screenRaw = undefined }
    this.sent[k].clear()
    delete this.streams[k]
  }

  private voicePeers() {
    return [...this.s.peers].filter(([, p]) => p.voice.in).map(([id]) => id)
  }

  // Tek doğruluk kaynağı: kim seste ise ona akış gider, çıkana gitmez. Her varlık değişiminde çalışır.
  sync() {
    if (!this.s.voice.in) {
      for (const id of [...this.remote.keys()]) this.dropPeer(id)
      return
    }
    const inVoice = new Set(this.voicePeers())
    if (this.known) {
      if ([...inVoice].some(id => !this.known!.has(id))) this.roster(true)
      else if ([...this.known].some(id => !inVoice.has(id))) this.roster(false)
    }
    this.known = inVoice
    for (const id of [...this.remote.keys()]) if (!inVoice.has(id)) this.dropPeer(id)
    for (const k of ['mic', 'cam', 'screen'] as Kind[]) {
      const st = this.streams[k]
      if (!st) continue
      const add = [...inVoice].filter(id => !this.sent[k].has(id))
      const gone = [...this.sent[k]].filter(id => !inVoice.has(id))
      if (add.length) {
        this.s.room.addStream(st, {target: add, metadata: {kind: k}})
        add.forEach(id => this.sent[k].add(id))
        setTimeout(() => void this.tune(), 1500)
      }
      if (gone.length) {
        try { this.s.room.removeStream(st, {target: gone}) } catch { /* peer gitti */ }
        gone.forEach(id => this.sent[k].delete(id))
      }
    }
    this.syncRelay(inVoice)
    this.applyAudio()
    this.changed()
  }

  // Doğrudan bağlanamayan iki kişiyi ikisine de bağlı olan taşır. Birden çok aday varsa
  // herkes aynı kişiyi seçsin diye en küçük kimlik seçilir, ses iki kez gelmez.
  private syncRelay(inVoice: Set<string>) {
    const me = this.meUid()
    const want = new Map<string, {stream: MediaStream; to: string; uid: string}>()
    const seen = new Set<string>()
    const peers = [...inVoice].map(id => ({id, p: this.s.peers.get(id)!})).filter(x => x.p)
    for (const from of peers) for (const to of peers) {
      if (from.id === to.id || !to.p.others || to.p.others.some(o => o.uid === from.p.uid)) continue
      // Bağlantı yeni kuruluyor olabilir: kısa boşluk aktarma sayılmaz, yoksa ses iki kez gelir.
      const key = `${from.p.uid}>${to.p.uid}`
      const since = this.gapSince.get(key) ?? Date.now()
      seen.add(key)
      this.gapSince.set(key, since)
      if (Date.now() - since < RELAY_WAIT) continue
      const cands = [me, ...[...this.s.peers.values()].filter(z => (z.others ?? []).some(o => o.uid === from.p.uid) && (z.others ?? []).some(o => o.uid === to.p.uid)).map(z => z.uid)]
      if (cands.sort()[0] !== me) continue
      const stream = this.remote.get(from.id)?.mic
      if (stream) want.set(`${from.p.uid}>${to.id}`, {stream, to: to.id, uid: from.p.uid})
    }
    for (const k of this.gapSince.keys()) if (!seen.has(k)) this.gapSince.delete(k)
    for (const [k, r] of this.relaying) if (want.get(k)?.stream !== r.stream) {
      try { this.s.room.removeStream(r.stream, {target: r.to}) } catch { /* gitti */ }
      this.relaying.delete(k)
    }
    for (const [k, w] of want) if (!this.relaying.has(k)) {
      this.s.room.addStream(w.stream, {target: w.to, metadata: {kind: 'relay', uid: w.uid}})
      this.relaying.set(k, {stream: w.stream, to: w.to})
    }
    for (const [uid, r] of this.relayed) if (!this.s.indirect().get(uid)?.voice.in) this.dropRelayed(uid, r)
  }

  private dropRelayed(uid: string, r: {el: HTMLAudioElement; src?: MediaStreamAudioSourceNode}) {
    r.el.srcObject = null
    r.src?.disconnect()
    this.relayed.delete(uid)
    this.speaking.delete('r:' + uid)
  }

  private gotRelay(stream: MediaStream, via: string, uid: string) {
    if (!this.s.voice.in) return
    const old = this.relayed.get(uid)
    if (old) this.dropRelayed(uid, old)
    const el = new Audio()
    el.autoplay = true
    el.srcObject = stream
    void el.play().catch(() => {})
    const entry: {via: string; el: HTMLAudioElement; an?: AnalyserNode; src?: MediaStreamAudioSourceNode} = {via, el}
    if (this.ctx) {
      entry.src = this.ctx.createMediaStreamSource(stream)
      entry.an = this.ctx.createAnalyser()
      entry.an.fftSize = 512
      entry.src.connect(entry.an)
    }
    this.relayed.set(uid, entry)
    this.applyAudio()
    this.changed()
  }

  hasRelay(uid: string) { return this.relayed.has(uid) }

  // Gecikme ayarları: alıcı tamponu en aza, ses öncelikli. Yeni akışta alıcılar değiştiği için tekrar çalışır.
  private async readStat(key: string, target: RTCRtpSender | RTCRtpReceiver, type: string, field: 'bytesSent' | 'bytesReceived') {
    let out: ScreenStat | undefined
    ;(await target.getStats()).forEach(r => {
      if (r.type !== type || r.kind !== 'video' || !r.frameWidth) return
      const before = this.statBytes.get(key)
      this.statBytes.set(key, r[field])
      out = {w: r.frameWidth, h: r.frameHeight, fps: r.framesPerSecond ?? 0, mbps: before === undefined ? 0 : (r[field] - before) * 8 / 3e6, limit: r.qualityLimitationReason}
    })
    return out
  }

  // Yayının gerçek durumu: seçilen kalite değil, o an giden ya da gelen görüntü.
  private async sampleScreen() {
    const mine = this.streams.screen?.getVideoTracks()[0]
    const peers = Object.entries(this.s.room.getPeers() as Record<string, RTCPeerConnection>)
    const next = new Map<string, ScreenStat>(), sent: ScreenStat[] = []
    for (const [id, pc] of peers) {
      const sender = mine && pc.getSenders().find(x => x.track === mine)
      const got = sender && await this.readStat('out:' + id, sender, 'outbound-rtp', 'bytesSent').catch(() => undefined)
      if (got) sent.push(got)
      const track = this.remote.get(id)?.screen?.getVideoTracks()[0]
      const receiver = track && pc.getReceivers().find(x => x.track === track)
      const seen = receiver && await this.readStat('in:' + id, receiver, 'inbound-rtp', 'bytesReceived').catch(() => undefined)
      if (seen) next.set(id, seen)
    }
    const worst = worstStat(sent)
    if (worst) next.set('me', worst)
    if (!next.size && !this.screenStats.size) return
    this.screenStats = next
    this.changed()
  }

  private async tune() {
    const game = this.gameMode()
    const local = new Map<string, Kind>()
    for (const k of ['mic', 'cam', 'screen'] as Kind[]) this.streams[k]?.getTracks().forEach(t => local.set(t.id, k))
    for (const pc of Object.values(this.s.room.getPeers() as Record<string, RTCPeerConnection>)) {
      for (const r of pc.getReceivers()) {
        const x = r as RTCRtpReceiver & {jitterBufferTarget?: number | null; playoutDelayHint?: number}
        if ('jitterBufferTarget' in x) { if (x.jitterBufferTarget !== 0) x.jitterBufferTarget = 0 }
        else (r as unknown as {playoutDelayHint: number}).playoutDelayHint = 0
      }
      for (const sender of pc.getSenders()) {
        const k = sender.track && local.get(sender.track.id)
        if (!k) continue
        const p = sender.getParameters()
        const e = p.encodings?.[0]
        if (!e) continue
        const q = SCREEN_Q[this.prefs().screenQ]
        const audio = sender.track!.kind === 'audio'
        const rate = k === 'mic' ? BITRATE.mic
          : k === 'cam' ? (game ? GAME_CAM : BITRATE.cam)
          : audio ? SCREEN_AUDIO : game ? Math.min(GAME_SCREEN, q.b) : q.b
        const pri = k === 'mic' ? 'high' : k === 'screen' ? 'medium' : 'low'
        const fps = k === 'screen' && !audio ? q.f : undefined
        if (e.maxBitrate === rate && e.networkPriority === pri && e.maxFramerate === fps) continue
        e.maxBitrate = rate
        if (fps) e.maxFramerate = fps
        e.priority = pri
        e.networkPriority = pri
        await sender.setParameters(p).catch(() => {})
      }
    }
  }

  private gotStream(stream: MediaStream, peerId: string, kind: Kind) {
    if (!this.s.voice.in) return
    const r = this.remote.get(peerId) ?? {}
    r[kind] = stream
    this.remote.set(peerId, r)
    if (kind === 'mic') {
      let el = this.audios.get(peerId)
      if (!el) { el = new Audio(); el.autoplay = true; this.audios.set(peerId, el) }
      el.srcObject = stream
      void el.play().catch(() => {})
      setTimeout(reapplySpeaker, 600)
      if (this.ctx) {
        this.meters.get(peerId)?.src.disconnect()
        const src = this.ctx.createMediaStreamSource(stream)
        const an = this.ctx.createAnalyser()
        an.fftSize = 512
        src.connect(an)
        this.meters.set(peerId, {an, src})
      }
    }
    this.applyAudio()
    this.changed()
  }

  private dropPeer(id: string) {
    this.sent.mic.delete(id); this.sent.cam.delete(id); this.sent.screen.delete(id)
    const el = this.audios.get(id)
    if (el) { el.srcObject = null; this.audios.delete(id) }
    this.meters.get(id)?.src.disconnect()
    this.meters.delete(id)
    this.remote.delete(id)
    this.speaking.delete(id)
    this.changed()
  }

  applyAudio() {
    const {speakerId, screenGain} = this.prefs()
    this.applyMicGain()
    if (this.screenRaw) this.screenRaw.gain.gain.value = SCREEN_GAIN * screenGain
    for (const [uid, r] of this.relayed) {
      r.el.muted = this.s.voice.deaf
      r.el.volume = Math.min(1, this.vol(uid))
    }
    for (const [id, el] of this.audios) {
      const uid = this.s.peers.get(id)?.uid ?? ''
      el.muted = this.s.voice.deaf
      el.volume = Math.min(1, this.vol(uid))
      if (speakerId) void (el as HTMLAudioElement & {setSinkId?: (i: string) => Promise<void>}).setSinkId?.(speakerId).catch(() => {})
    }
  }

  private rms(an: AnalyserNode) {
    const buf = new Uint8Array(an.fftSize)
    an.getByteTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += ((v - 128) / 128) ** 2
    return Math.sqrt(sum / buf.length)
  }

  private tick() {
    const before = [...this.speaking].join()
    if (this.localAn && this.send) {
      this.level = Math.min(100, this.rms(this.localAn) * 400 * this.prefs().micGain)
      const now = Date.now()
      // Kapı: sessizlikte hiç paket gitmez, klavye ve oda sesi arkadaşına ulaşmaz.
      if (this.level >= this.prefs().gate) this.openUntil = now + 350
      const open = this.prefs().ptt ? this.pttDown : now < this.openUntil
      this.send.enabled = !this.s.voice.muted && open
      if (this.send.enabled && this.level > 3) this.speaking.add('me'); else this.speaking.delete('me')
    }
    for (const [uid, r] of this.relayed) if (r.an) {
      if (this.rms(r.an) > 0.012) this.speaking.add('r:' + uid); else this.speaking.delete('r:' + uid)
    }
    for (const [id, {an}] of this.meters) {
      if (this.rms(an) > 0.012) this.speaking.add(id); else this.speaking.delete(id)
    }
    if ([...this.speaking].join() !== before) this.changed()
  }

  toggleMute() {
    if (!this.s.voice.in) return
    const v = this.s.voice
    v.muted = !v.muted
    if (!v.muted) v.deaf = false
    this.applyAudio()
    this.s.announce()
  }

  toggleDeaf() {
    if (!this.s.voice.in) return
    const v = this.s.voice
    v.deaf = !v.deaf
    if (v.deaf) v.muted = true
    this.applyAudio()
    this.s.announce()
  }

  private async camStream() {
    return navigator.mediaDevices.getUserMedia({
      video: {...(this.prefs().camId ? {deviceId: {exact: this.prefs().camId}} : {facingMode: this.facing}), width: {ideal: 640}, height: {ideal: 360}, frameRate: {ideal: 24, max: 30}},
    })
  }

  async toggleCam() {
    if (!this.s.voice.in) return
    if (this.streams.cam) {
      this.stopLocal('cam')
      this.s.voice.cam = false
    } else {
      this.streams.cam = await this.camStream()
      this.s.voice.cam = true
    }
    this.s.announce()
  }

  // Telefonlar iki kamerayı aynı anda açamaz: önce eskisi kapanır.
  private async swapCam() {
    const old = this.streams.cam?.getVideoTracks()[0]
    if (!old) return
    old.stop()
    const next = (await this.camStream()).getVideoTracks()[0]
    if (this.sent.cam.size) this.s.room.replaceTrack(old, next, {target: [...this.sent.cam]})
    this.streams.cam!.removeTrack(old)
    this.streams.cam!.addTrack(next)
    this.changed()
  }

  async flipCam() {
    this.facing = this.facing === 'user' ? 'environment' : 'user'
    this.prefs().camId = ''
    await this.swapCam()
  }

  changeCam() { return this.swapCam() }

  async toggleScreen(withAudio = true) {
    if (!this.s.voice.in) return
    if (this.streams.screen) {
      this.stopLocal('screen')
      this.s.voice.screen = false
      this.s.voice.sAudio = false
      this.s.announce()
      return
    }
    const q = SCREEN_Q[this.prefs().screenQ]
    await pickScreenCodec()
    // restrictOwnAudio: bu sekmedeki görüşme sesi yayına girmesin, arkadaşların kendini duymasın.
    const st = await navigator.mediaDevices.getDisplayMedia({
      video: {frameRate: {ideal: q.f, max: q.f}, width: {ideal: q.w, max: q.w}, height: {ideal: q.h, max: q.h}},
      audio: withAudio ? {echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true} as MediaTrackConstraints : false,
      systemAudio: 'include',
    } as DisplayMediaStreamOptions)
    this.boostScreen(st)
    // 'motion' sıkışınca çözünürlüğü 270p'ye kadar düşürüyor. Bant yetmezse fps düşsün, görüntü net kalsın.
    st.getVideoTracks()[0].contentHint = 'detail'
    st.getVideoTracks()[0].onended = () => { if (this.streams.screen === st) void this.toggleScreen() }
    this.streams.screen = st
    this.s.voice.screen = true
    this.s.voice.sAudio = st.getAudioTracks().length > 0
    this.s.announce()
  }

  // Sistem sesi, otomatik kazançlı mikrofonun yanında kısık kalır. Yükseltilir, sınırlayıcı da patlamayı önler.
  private boostScreen(st: MediaStream) {
    const raw = st.getAudioTracks()[0]
    if (!raw) return
    raw.contentHint = 'music'
    if (!this.ctx) return
    const src = this.ctx.createMediaStreamSource(new MediaStream([raw]))
    const gain = this.ctx.createGain()
    const limit = this.ctx.createDynamicsCompressor()
    const dest = this.ctx.createMediaStreamDestination()
    gain.gain.value = SCREEN_GAIN * this.prefs().screenGain
    limit.threshold.value = -9; limit.knee.value = 3; limit.ratio.value = 20; limit.attack.value = .002; limit.release.value = .2
    src.connect(gain).connect(limit).connect(dest)
    const out = dest.stream.getAudioTracks()[0]
    out.contentHint = 'music'
    st.removeTrack(raw)
    st.addTrack(out)
    this.screenRaw = {raw, src, gain}
  }

  async changeScreenQuality() {
    const t = this.streams.screen?.getVideoTracks()[0]
    if (!t) return
    const q = SCREEN_Q[this.prefs().screenQ]
    t.contentHint = 'detail'
    await t.applyConstraints({frameRate: {ideal: q.f, max: q.f}, width: {ideal: q.w, max: q.w}, height: {ideal: q.h, max: q.h}})
    await this.tune()
  }

  async changeMic() {
    if (!this.s.voice.in || !this.send) return
    const mic = await this.micStream()
    const raw = mic.getAudioTracks()[0]
    this.micChain?.src.disconnect()
    this.micChain = undefined
    const send = this.prefs().micGain === 1 ? raw.clone() : this.gainedTrack(raw)
    this.raw?.stop()
    this.raw = raw
    this.swapSend(send)
    if (this.ctx && this.localAn) this.ctx.createMediaStreamSource(new MediaStream([raw])).connect(this.localAn)
  }

  private swapSend(send: MediaStreamTrack) {
    send.contentHint = this.virtualMic ? 'music' : 'speech'
    if (this.sent.mic.size) this.s.room.replaceTrack(this.send!, send, {target: [...this.sent.mic]})
    this.streams.mic!.removeTrack(this.send!)
    this.streams.mic!.addTrack(send)
    this.send!.stop()
    this.send = send
  }

  // %100'de ses bu yola girmez: gecikme eklenmez, sayfa sesi askıdayken de mikrofon gider.
  private gainedTrack(raw: MediaStreamTrack) {
    const ctx = this.ctx!
    const src = ctx.createMediaStreamSource(new MediaStream([raw]))
    const gain = ctx.createGain()
    const limit = ctx.createDynamicsCompressor()
    const dest = ctx.createMediaStreamDestination()
    gain.gain.value = this.prefs().micGain
    limit.threshold.value = -3; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = .002; limit.release.value = .15
    src.connect(gain).connect(limit).connect(dest)
    this.micChain = {src, gain}
    return dest.stream.getAudioTracks()[0]
  }

  private applyMicGain() {
    const v = this.prefs().micGain
    if (this.micChain) this.micChain.gain.gain.value = v
    else if (v !== 1 && this.ctx && this.raw && this.send) this.swapSend(this.gainedTrack(this.raw))
  }
}
