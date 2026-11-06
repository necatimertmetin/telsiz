// Son anı kaydetmek için iki kaydedici 30 saniye arayla döner: biri hep en az 30 saniyedir kayıtta.
// WebM parçası kesilemediğinden klip 30 ile 60 saniye arası çıkar. Kayıt basılana kadar cihazdan çıkmaz.
export const CLIP_STEP = 30_000

type Rec = {rec: MediaRecorder; chunks: Blob[]; startedAt: number; done: Promise<Blob>; stopMix: () => void}
export type ClipSource = {video?: MediaStreamTrack; audio: MediaStream[]}

const MIME = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

export class Clipper {
  private recs: Rec[] = []
  private timer?: ReturnType<typeof setInterval>

  constructor(private ctx: AudioContext, private source: () => ClipSource) {}

  get on() { return this.timer !== undefined }

  start() {
    if (this.on) return
    this.spawn()
    this.timer = setInterval(() => this.turn(), CLIP_STEP)
  }

  stop() {
    clearInterval(this.timer)
    this.timer = undefined
    for (const r of this.recs) this.end(r)
    this.recs = []
  }

  private end(r: Rec) {
    if (r.rec.state !== 'inactive') r.rec.stop()
    r.stopMix()
  }

  private turn() {
    if (this.recs.length >= 2) this.end(this.recs.shift()!)
    this.spawn()
  }

  private spawn() {
    const src = this.source()
    const dest = this.ctx.createMediaStreamDestination()
    const nodes = src.audio.filter(s => s.getAudioTracks().length).map(s => {
      const n = this.ctx.createMediaStreamSource(s)
      n.connect(dest)
      return n
    })
    const stream = new MediaStream([...dest.stream.getAudioTracks(), ...(src.video ? [src.video] : [])])
    const mimeType = MIME.find(m => MediaRecorder.isTypeSupported(m))
    const rec = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 96_000})
    const chunks: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise<Blob>(ok => { rec.onstop = () => ok(new Blob(chunks, {type: 'video/webm'})) })
    rec.start(1000)
    this.recs.push({rec, chunks, startedAt: Date.now(), done, stopMix: () => nodes.forEach(n => n.disconnect())})
  }

  // En eski kaydedici biter, yerine yenisi girer; arabellek boş kalmaz.
  async save(): Promise<Blob | null> {
    const r = this.recs.shift()
    if (!r) return null
    this.end(r)
    this.spawn()
    const blob = await r.done
    return blob.size ? blob : null
  }
}
