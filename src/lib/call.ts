import type {Session} from './session'
import {callStarted, callStopped} from './native'

export type Kind = 'mic' | 'cam' | 'screen'
export type AudioPrefs = {micId: string; speakerId: string; camId: string; gate: number; noise: boolean}

const BITRATE: Record<Kind, number> = {mic: 48_000, cam: 700_000, screen: 2_500_000}

// Herkes herkese doğrudan yollar. 4 kişide kimse için 3 akıştan fazla yükleme yoktur,
// o yüzden kamera bilerek düşük çözünürlükte: oyun oynarken hattı doldurmasın.
export class Call {
  remote = new Map<string, Partial<Record<Kind, MediaStream>>>()
  speaking = new Set<string>() // peerId, kendisi için 'me'
  level = 0
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
  private openUntil = 0
  private wake?: WakeLockSentinel | null

  constructor(private s: Session, private prefs: () => AudioPrefs, private vol: (uid: string) => number, private changed: () => void) {
    s.room.onPeerStream = (stream: MediaStream, peerId: string, meta?: {kind?: Kind}) => this.gotStream(stream, peerId, meta?.kind ?? 'mic')
    s.onPeerLeft = id => this.dropPeer(id)
    s.onPresence = () => this.sync()
  }

  private async micStream() {
    const p = this.prefs()
    return navigator.mediaDevices.getUserMedia({
      audio: {deviceId: p.micId ? {ideal: p.micId} : undefined, echoCancellation: true, noiseSuppression: p.noise, autoGainControl: true, channelCount: 1},
    })
  }

  async join(withCam = false) {
    if (this.s.voice.in) return
    const mic = await this.micStream()
    this.raw = mic.getAudioTracks()[0]
    this.send = this.raw.clone()
    this.send.contentHint = 'speech'
    this.streams.mic = new MediaStream([this.send])
    this.ctx = new AudioContext()
    await this.ctx.resume().catch(() => {})
    const an = this.ctx.createAnalyser()
    an.fftSize = 512
    this.ctx.createMediaStreamSource(new MediaStream([this.raw])).connect(an)
    this.localAn = an
    // requestAnimationFrame değil: oyun tam ekranken pencere görünmez sayılır ve rAF durur.
    this.timer = setInterval(() => this.tick(), 100)
    this.s.voice = {in: true, muted: false, deaf: false, cam: false, screen: false}
    this.s.announce()
    void callStarted()
    this.wake = await navigator.wakeLock?.request('screen').catch(() => null)
    if (withCam) await this.toggleCam().catch(() => {})
  }

  leave() {
    if (!this.s.voice.in) return
    for (const k of ['screen', 'cam', 'mic'] as Kind[]) this.stopLocal(k)
    this.raw?.stop()
    clearInterval(this.timer)
    for (const id of [...this.remote.keys()]) this.dropPeer(id)
    void this.ctx?.close()
    this.ctx = undefined
    this.speaking.clear()
    this.level = 0
    this.s.voice = {in: false, muted: false, deaf: false, cam: false, screen: false}
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
    for (const id of [...this.remote.keys()]) if (!inVoice.has(id)) this.dropPeer(id)
    for (const k of ['mic', 'cam', 'screen'] as Kind[]) {
      const st = this.streams[k]
      if (!st) continue
      const add = [...inVoice].filter(id => !this.sent[k].has(id))
      const gone = [...this.sent[k]].filter(id => !inVoice.has(id))
      if (add.length) {
        this.s.room.addStream(st, {target: add, metadata: {kind: k}})
        add.forEach(id => this.sent[k].add(id))
        setTimeout(() => this.capBitrate(), 1500)
      }
      if (gone.length) {
        try { this.s.room.removeStream(st, {target: gone}) } catch { /* peer gitti */ }
        gone.forEach(id => this.sent[k].delete(id))
      }
    }
    this.applyAudio()
    this.changed()
  }

  private async capBitrate() {
    const local = new Map<string, Kind>()
    for (const k of ['mic', 'cam', 'screen'] as Kind[]) this.streams[k]?.getTracks().forEach(t => local.set(t.id, k))
    for (const pc of Object.values(this.s.room.getPeers() as Record<string, RTCPeerConnection>)) {
      for (const sender of pc.getSenders()) {
        const k = sender.track && local.get(sender.track.id)
        if (!k) continue
        const p = sender.getParameters()
        if (!p.encodings?.length || p.encodings[0].maxBitrate === BITRATE[k]) continue
        p.encodings[0].maxBitrate = BITRATE[k]
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
      const open = now < this.openUntil
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
      video: {deviceId: this.prefs().camId && this.facing === 'user' ? {ideal: this.prefs().camId} : undefined, facingMode: this.facing, width: {ideal: 640}, height: {ideal: 360}, frameRate: {ideal: 24, max: 30}},
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

  async flipCam() {
    const old = this.streams.cam?.getVideoTracks()[0]
    if (!old) return
    this.facing = this.facing === 'user' ? 'environment' : 'user'
    old.stop()
    const next = (await this.camStream()).getVideoTracks()[0]
    this.s.room.replaceTrack(old, next, {target: [...this.sent.cam]})
    this.streams.cam!.removeTrack(old)
    this.streams.cam!.addTrack(next)
    this.changed()
  }

  async toggleScreen() {
    if (!this.s.voice.in) return
    if (this.streams.screen) {
      this.stopLocal('screen')
      this.s.voice.screen = false
      this.s.announce()
      return
    }
    const st = await navigator.mediaDevices.getDisplayMedia({video: {frameRate: {ideal: 30}}, audio: true})
    st.getVideoTracks()[0].contentHint = 'detail'
    st.getVideoTracks()[0].onended = () => { if (this.streams.screen === st) void this.toggleScreen() }
    this.streams.screen = st
    this.s.voice.screen = true
    this.s.announce()
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
