import {validStreamUrl} from './history'

// Radyo yayını kimseye aktarılmaz: odadaki herkes aynı istasyonu kendi cihazında açar.
// Böylece yükleme hızı harcanmaz, yayın kalitesi de kişiden kişiye bozulmaz.
export type Found = {title: string; url: string; tag: string}

const API = 'https://de1.api.radio-browser.info/json/stations/search'

// HLS (m3u8) tarayıcının ses ögesinde çalmaz, http de https sayfada açılmaz: ikisi de listeye girmez.
export function playable(x: {url_resolved?: unknown; hls?: unknown; codec?: unknown}): string | null {
  const u = x.url_resolved
  if (!validStreamUrl(u) || x.hls === 1 || /\.m3u8?(\?|$)/i.test(u) || /\.pls(\?|$)/i.test(u)) return null
  return u
}

export async function searchStations(q: string): Promise<Found[]> {
  const p = new URLSearchParams({limit: '25', hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true'})
  if (q.trim()) p.set('name', q.trim().slice(0, 60)); else p.set('countrycode', 'TR')
  const r = await fetch(`${API}?${p}`)
  const list = await r.json() as {name?: unknown; tags?: unknown; url_resolved?: unknown; hls?: unknown; codec?: unknown}[]
  const out: Found[] = []
  const seen = new Set<string>()
  for (const x of Array.isArray(list) ? list : []) {
    const url = playable(x)
    const title = typeof x.name === 'string' ? x.name.trim().slice(0, 60) : ''
    if (!url || !title || seen.has(title.toLocaleLowerCase('tr'))) continue
    seen.add(title.toLocaleLowerCase('tr'))
    const tag = typeof x.tags === 'string' ? x.tags.split(',')[0].trim().slice(0, 40) : ''
    out.push({title, url, tag})
  }
  return out
}

type Want = {url: string; vol: number; sink: string} | null

class RadioPlayer {
  private el: HTMLAudioElement | null = null
  private url = ''
  failed = ''
  playing = false
  onChange?: () => void

  set(w: Want) {
    if (!w) return this.stop()
    if (!this.el) {
      this.el = new Audio()
      this.el.preload = 'none'
      this.el.onplaying = () => { this.playing = true; this.failed = ''; this.onChange?.() }
      this.el.onerror = () => { this.playing = false; this.failed = this.url; this.onChange?.() }
    }
    const el = this.el
    el.volume = Math.max(0, Math.min(1, w.vol))
    const sink = (el as HTMLAudioElement & {setSinkId?: (id: string) => Promise<void>}).setSinkId
    if (sink && w.sink !== undefined) void sink.call(el, w.sink).catch(() => {})
    if (this.url === w.url) return
    this.url = w.url
    this.playing = false
    this.failed = ''
    el.src = w.url
    void el.play().catch(() => { /* ilk dokunuşta yeniden denenir */ })
  }

  // Tarayıcı sesi kullanıcı dokunana kadar bekletebilir.
  retry() { if (this.el && this.url && this.el.paused) void this.el.play().catch(() => {}) }

  stop() {
    if (!this.el || !this.url) return
    this.el.pause()
    this.el.removeAttribute('src')
    this.el.load()
    this.url = ''
    this.playing = false
    this.onChange?.()
  }
}

export const radio = new RadioPlayer()
