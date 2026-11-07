import {validStreamUrl} from './history'
import {androidPlugin, desktop} from './native'

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

// Arama süzgeçleri: ülke kodu ve tür etiketi radio-browser'ın kendi alanları.
export const COUNTRIES: [string, string][] = [['', 'Tüm ülkeler'], ['TR', 'Türkiye'], ['AZ', 'Azerbaycan'], ['GR', 'Yunanistan'], ['RU', 'Rusya'], ['UA', 'Ukrayna'], ['DE', 'Almanya'], ['GB', 'İngiltere'], ['US', 'ABD'], ['FR', 'Fransa'], ['IT', 'İtalya'], ['ES', 'İspanya'], ['NL', 'Hollanda'], ['BG', 'Bulgaristan'], ['RS', 'Sırbistan'], ['EG', 'Mısır'], ['IR', 'İran'], ['BR', 'Brezilya'], ['JP', 'Japonya'], ['KR', 'Kore']]
export const GENRES: [string, string][] = [['', 'Tüm türler'], ['pop', 'Pop'], ['rock', 'Rock'], ['jazz', 'Caz'], ['blues', 'Blues'], ['classical', 'Klasik'], ['electronic', 'Elektronik'], ['hip hop', 'Hip hop'], ['rap', 'Rap'], ['metal', 'Metal'], ['folk', 'Halk müziği'], ['arabesk', 'Arabesk'], ['turkish folk', 'Türkü'], ['lounge', 'Lounge'], ['chillout', 'Chill'], ['lofi', 'Lo-fi'], ['80s', '80ler'], ['90s', '90lar'], ['news', 'Haber'], ['talk', 'Sohbet'], ['sport', 'Spor']]

export async function searchStations(q: string, f: {country?: string; tag?: string} = {}): Promise<Found[]> {
  const p = new URLSearchParams({limit: '40', hidebroken: 'true', is_https: 'true', order: 'clickcount', reverse: 'true'})
  if (q.trim()) p.set('name', q.trim().slice(0, 60))
  if (f.country) p.set('countrycode', f.country)
  if (f.tag) { p.set('tag', f.tag); p.set('tagExact', 'false') }
  // Hiçbir şey seçilmemişse Türkiye'nin sevilenleri gelir.
  if (!q.trim() && !f.country && !f.tag) p.set('countrycode', 'TR')
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

const KEY = new TextEncoder().encode("StreamTitle='")
function find(buf: Uint8Array, key: Uint8Array, from: number) {
  outer: for (let i = Math.max(0, from); i + key.length <= buf.length; i++) {
    for (let j = 0; j < key.length; j++) if (buf[i + j] !== key[j]) continue outer
    return i
  }
  return -1
}

// Tarayıcı çoğu yayında akışın içini okumaya izin vermez (CORS); izin verenlerde çalışır.
async function webTitle(url: string): Promise<string | null> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 10000)
  try {
    const r = await fetch(url, {headers: {'Icy-MetaData': '1'}, signal: ac.signal})
    const rd = r.body!.getReader()
    let buf = new Uint8Array(0)
    while (buf.length < 400000) {
      const {value, done} = await rd.read()
      if (done) break
      const n = new Uint8Array(buf.length + value.length); n.set(buf); n.set(value, buf.length); buf = n
      const i = find(buf, KEY, 0)
      if (i < 0) continue
      const s = i + KEY.length
      let e = -1
      for (let k = s; k + 1 < buf.length; k++) if (buf[k] === 39 && buf[k + 1] === 59) { e = k; break }
      if (e < 0) continue
      const raw = buf.subarray(s, e), u = new TextDecoder().decode(raw)
      return (u.includes(String.fromCharCode(0xfffd)) ? new TextDecoder('windows-1254').decode(raw) : u).slice(0, 200)
    }
    return null
  } catch { return null } finally { clearTimeout(t); ac.abort() }
}

// Şu an çalan şarkı: uygulamada doğrudan, tarayıcıda izin veren yayınlarda.
export async function readTitle(url: string): Promise<string | null> {
  const d = desktop()?.radioTitle, a = androidPlugin()?.radioTitle
  const t = d ? await d(url).catch(() => null) : a ? (await a({url}).catch(() => ({title: undefined}))).title ?? null : await webTitle(url)
  return cleanTitle(t)
}

// Bazı Türk yayınları eski kodlamayı yanlış çevirip gönderir: "HER ÞEY BÝTMEDÝ" gibi.
// Þ Ý Ð þ ý ð Türkçede yok, bunlar Ş İ Ğ ş ı ğ olmalı.
const FIX: Record<string, string> = {'Þ': 'Ş', 'Ý': 'İ', 'Ð': 'Ğ', 'þ': 'ş', 'ý': 'ı', 'ð': 'ğ'}
export function cleanTitle(t: string | null | undefined): string | null {
  const clean = t?.replace(/[ÞÝÐþýð]/g, c => FIX[c]).replace(/\s+/g, ' ').trim().slice(0, 200) ?? ''
  return clean && !/^[-\s|]*$/.test(clean) ? clean : null
}

class RadioPlayer {
  private el: HTMLAudioElement | null = null
  private url = ''
  failed = ''
  playing = false
  title: string | null = null
  onChange?: () => void
  private poll: ReturnType<typeof setTimeout> | null = null

  // Çalarken 30 sn'de bir şarkı adına bakılır; yayın değişince ya da durunca bırakılır.
  private watch() {
    if (this.poll) clearTimeout(this.poll)
    const url = this.url
    if (!url) return
    const tick = async () => {
      const t = await readTitle(url)
      if (this.url !== url) return
      if (t !== this.title) { this.title = t; this.onChange?.() }
      this.poll = setTimeout(() => void tick(), 30000)
    }
    this.poll = setTimeout(() => void tick(), 1500)
  }

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
    this.title = null
    this.watch()
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
    this.title = null
    if (this.poll) clearTimeout(this.poll)
    this.onChange?.()
  }
}

export const radio = new RadioPlayer()
