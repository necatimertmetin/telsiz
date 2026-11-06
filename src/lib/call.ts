import type {Session} from './session'
import {callStarted, callStopped, reapplySpeaker} from './native'

export type Kind = 'mic' | 'cam' | 'screen'
export type ScreenQ = '720p30' | '1080p30' | '1080p60' | '1440p60'
export type AudioPrefs = {micId: string; speakerId: string; camId: string; gate: number; noise: boolean; ptt: boolean; screenQ: ScreenQ}
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
  private localAn?: AnalyserNode
  private timer?: ReturnType<typeof setInterval>
  private tuner?: ReturnType<typeof setInterval>
  private known?: Set<string>
  private openUntil = 0
  private wake?: WakeLockSentinel | null

  constructor(private s: Session, private prefs: () => AudioPrefs, private vol: (uid: string) => number, private changed: () => void, private gameMode: () => boolean, private roster: (joined: boolean) => void) {
    s.room.onPeerStream = (stream: MediaStream, peerId: string, meta?: {kind?: Kind}) => this.gotStream(stream, peerId, meta?.kind ?? 'mic')
    s.onPeerLeft = id => this.dropPeer(id)
    s.onPresence = () => this.sync()
  }

  private async micStream() {
    const p = this.prefs()
    return navigator.mediaDevices.getUserMedia({
      audio: {deviceId: p.micId ? {ideal: p.micId} : undefined, echoCancellation: true, noiseSuppression: p.noise, autoGainControl: true, channelCount: 1, latency: {ideal: 0.01}} as MediaTrackConstraints,
    })
  }

  async join(withCam = false) {
    if (this.s.voice.in) return
    const mic = await this.micStream()
    this.raw = mic.getAudioTracks()[0]
    this.send = this.raw.clone()
    this.send.contentHint = 'speech'
    this.streams.mic = new MediaStream([this.send])
    this.ctx = new AudioContext({latencyHint: 'interactive'})
    await this.ctx.resume().catch(() => {})
    const an = this.ctx.createAnalyser()
    an.fftSize = 512
    this.ctx.createMediaStreamSource(new MediaStream([this.raw])).connect(an)
    this.localAn = an
    // requestAnimationFrame değil: oyun tam ekranken pencere görünmez sayılır ve rAF durur.
    this.timer = setInterval(() => this.tick(), 100)
    this.tuner = setInterval(() => void this.tune(), 3000)
    this.s.voice = {in: true, muted: false, deaf: false, cam: false, screen: false, sAudio: false}
    this.s.announce()
    void callStarted()
    this.wake = await navigator.wakeLock?.request('screen').catch(() => null)
    if (withCam) await this.toggleCam().catch(() => {})
  }

  leave() {
    if (!this.s.voice.in) return
    for (const k of ['screen', 'cam', 'mic'] as Kind[]) this.stopLocal(k)
    this.raw?.stop()
    clearInterval(this.timer); clearInterval(this.tuner)
    for (const id of [...this.remote.keys()]) this.dropPeer(id)
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

  private stopLocal(k: Kind) {
    const st = this.streams[k]
    if (!st) return
    const targets = [...this.sent[k]]
    if (targets.length) { try { this.s.room.removeStream(st, {target: targets}) } catch { /* akış zaten düştü */ } }
    st.getTracks().forEach(t => t.stop())
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
    this.applyAudio()
    this.changed()
  }

  // Gecikme ayarları: alıcı tamponu en aza, ses öncelikli. Yeni akışta alıcılar değiştiği için tekrar çalışır.
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
    const {speakerId} = this.prefs()
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
      this.level = Math.min(100, this.rms(this.localAn) * 400)
      const now = Date.now()
      // Kapı: sessizlikte hiç paket gitmez, klavye ve oda sesi arkadaşına ulaşmaz.
      if (this.level >= this.prefs().gate) this.openUntil = now + 350
      const open = this.prefs().ptt ? this.pttDown : now < this.openUntil
      this.send.enabled = !this.s.voice.muted && open
      if (this.send.enabled && this.level > 3) this.speaking.add('me'); else this.speaking.delete('me')
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
    // restrictOwnAudio: bu sekmedeki görüşme sesi yayına girmesin, arkadaşların kendini duymasın.
    const st = await navigator.mediaDevices.getDisplayMedia({
      video: {frameRate: {ideal: q.f, max: q.f}, width: {ideal: q.w, max: q.w}, height: {ideal: q.h, max: q.h}},
      audio: withAudio ? {echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true} as MediaTrackConstraints : false,
      systemAudio: 'include',
    } as DisplayMediaStreamOptions)
    st.getAudioTracks().forEach(t => { t.contentHint = 'music' })
    // 60 fps'te akıcılık, 30 fps'te yazı netliği öncelikli.
    st.getVideoTracks()[0].contentHint = q.f >= 60 ? 'motion' : 'detail'
    st.getVideoTracks()[0].onended = () => { if (this.streams.screen === st) void this.toggleScreen() }
    this.streams.screen = st
    this.s.voice.screen = true
    this.s.voice.sAudio = st.getAudioTracks().length > 0
    this.s.announce()
  }

  async changeScreenQuality() {
    const t = this.streams.screen?.getVideoTracks()[0]
    if (!t) return
    const q = SCREEN_Q[this.prefs().screenQ]
    t.contentHint = q.f >= 60 ? 'motion' : 'detail'
    await t.applyConstraints({frameRate: {ideal: q.f, max: q.f}, width: {ideal: q.w, max: q.w}, height: {ideal: q.h, max: q.h}})
    await this.tune()
  }

  async changeMic() {
    if (!this.s.voice.in || !this.send) return
    const mic = await this.micStream()
    const raw = mic.getAudioTracks()[0]
    const send = raw.clone()
    send.contentHint = 'speech'
    if (this.sent.mic.size) this.s.room.replaceTrack(this.send, send, {target: [...this.sent.mic]})
    this.streams.mic!.removeTrack(this.send)
    this.streams.mic!.addTrack(send)
    this.send.stop(); this.raw?.stop()
    this.send = send; this.raw = raw
    if (this.ctx && this.localAn) this.ctx.createMediaStreamSource(new MediaStream([raw])).connect(this.localAn)
  }
}
