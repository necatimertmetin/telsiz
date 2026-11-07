import {useEffect, useRef, useState, type FormEvent} from 'react'
import {app} from '../lib/app'
import type {Session} from '../lib/session'
import {tvCurrent, tvPos, ytId} from '../lib/tv'
import {Icon} from './Icon'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type YtPlayer = any
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    YT?: any
    onYouTubeIframeAPIReady?: () => void
    __tv?: YtPlayer
  }
}

let api: Promise<void> | null = null
const loadApi = () => api ??= new Promise(res => {
  if (window.YT?.Player) return res()
  window.onYouTubeIframeAPIReady = () => res()
  const el = document.createElement('script')
  el.src = 'https://www.youtube.com/iframe_api'
  document.head.append(el)
})

const fmt = (t: number) => {
  const s = Math.floor(t)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const readVol = () => { try { return Number(localStorage.getItem('telsiz.tvvol') ?? 60) } catch { return 60 } }
const PLAYING = 1, PAUSED = 2, BUFFERING = 3, ENDED = 0, ANY = -9

// YouTube'un kendi kontrolleri açık (çözünürlük, altyazı). Oradan durdurma ve sarma herkese gider,
// hız ise 1'e sabit: yoksa kişi ortak akıştan kayar.
export function TvPlayer({s}: {s: Session}) {
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YtPlayer>(null)
  const loaded = useRef('')
  const ours = useRef({st: ANY, at: 0})
  const played = useRef(false)
  const last = useRef({t: 0, at: 0, st: ANY})
  const retry = useRef({k: '', n: 0})
  const stuck = useRef({since: 0, t: -1, last: 0})
  const prev = useRef(ANY)
  const userPlay = useRef(false)
  const [time, setTime] = useState({cur: 0, dur: 0})
  const [mini, setMini] = useState(false)
  const [cinema, setCinema] = useState(() => { try { return localStorage.getItem('telsiz.cinema') === '1' } catch { return false } })
  const box = useRef<HTMLDivElement>(null)
  const [vol, setVol] = useState(readVol)
  const [seeking, setSeeking] = useState<number | null>(null)
  const item = tvCurrent(s.tv)

  useEffect(() => {
    let dead = false
    void loadApi().then(() => {
      if (dead || !host.current) return
      player.current = new window.YT.Player(host.current, {
        width: '100%', height: '100%',
        playerVars: {controls: 1, disablekb: 1, rel: 0, playsinline: 1, modestbranding: 1, fs: 0, origin: location.origin},
        events: {
          onReady: () => { window.__tv = player.current; player.current.setVolume(readVol()); sync() },
          onStateChange: (e: {data: number}) => {
            if (e.data === ENDED && loaded.current) return s.tvDo({a: 'ended', k: loaded.current})
            // Bizim verdiğimiz komutun sonucu değilse kişi YouTube çubuğuna basmıştır, herkese yay.
            // Sadece oynarken durma ve dururken oynama sayılır: yükleme bitip oynamaya geçmek kişinin işi değildir.
            // Hiç oynamamış oynatıcının durması (tarayıcı otomatik oynatmayı engelledi) da sayılmaz.
            const o = ours.current, own = performance.now() - o.at < 1500 && (o.st === ANY || o.st === e.data)
            const was = prev.current, wanted = userPlay.current
            prev.current = e.data
            if (e.data !== BUFFERING) userPlay.current = false
            if (e.data === PLAYING) played.current = true
            if (loaded.current && !own) {
              if (e.data === PAUSED && was === PLAYING && s.tv.playing && played.current) { mine(PAUSED); return s.tvDo({a: 'pause'}) }
              if (!s.tv.playing && was === PAUSED && e.data === BUFFERING) userPlay.current = true
              if (!s.tv.playing && e.data === PLAYING && (was === PAUSED || wanted)) { mine(PLAYING); return s.tvDo({a: 'play'}) }
            }
            sync()
          },
          onError: (e: {data: number}) => {
            const k = tvCurrent(s.tv)?.k
            // 5 = oynatıcı hatası, çoğu zaman geçici: önce sadece burada yeniden yükle, herkes için geçme.
            if (e.data === 5 && k && retry.current.k !== k) retry.current = {k, n: 0}
            if (e.data === 5 && k && retry.current.n++ < 2) { loaded.current = ''; sync(); return }
            app.showToast('Bu video burada oynatılamıyor, geçildi')
            if (k) s.tvDo({a: 'ended', k})
          },
        },
      })
    })
    const mine = (st = ANY) => { ours.current = {st, at: performance.now()} }
    const sync = () => {
      const p = player.current
      if (!p?.getPlayerState) return
      const tv = s.tv, cur = tvCurrent(tv)
      if (!cur) {
        if (loaded.current) { mine(); p.stopVideo(); loaded.current = '' }
        return
      }
      const want = tvPos(tv, performance.now())
      if (loaded.current !== cur.k) {
        loaded.current = cur.k
        mine()
        played.current = false
        p.loadVideoById({videoId: cur.id, startSeconds: want})
        return
      }
      const st = p.getPlayerState(), now = performance.now(), t = p.getCurrentTime()
      // YouTube çubuğundan sarıldıysa herkese yay: son sağlam ölçümden beri beklenmedik sıçrama varsa kişi sarmıştır.
      // Yüklenirken ölçülmez (sarılan yer temel olmasın); takılma geri sıçrama sayılmaz, sadece geride kalır.
      if (st === PLAYING || st === PAUSED) {
        const l = last.current, gap = (now - l.at) / 1000, exp = l.t + (l.st === PLAYING ? gap : 0)
        last.current = {t, at: now, st}
        if (ours.current.at < l.at && now - ours.current.at > 1500 && gap < 10 && (t > exp + 2.5 || t < l.t - 2.5)) {
          mine()
          s.tvDo({a: 'seek', pos: t})
          return
        }
      }
      // Yükleniyor'da hiç ilerlemeden kaldıysa (veri gelmiyor) videoyu bu cihazda yeniden aç, en çok 20 sn'de bir.
      // Sarmak yetmiyor: yarım kalan yüklemeyi her seferinde baştan başlatıyor.
      const k = stuck.current
      if (st !== BUFFERING || t !== k.t) { k.since = now; k.t = t }
      else if (now - k.since > 10000 && now - k.last > 20000) {
        k.last = now
        k.since = now
        loaded.current = ''
        return sync()
      }
      if (p.getPlaybackRate?.() !== 1) p.setPlaybackRate?.(1)
      if (tv.playing && st !== PLAYING && st !== BUFFERING && st !== ENDED) { mine(PLAYING); p.playVideo() }
      // Kişi YouTube'dan oynat'a bastıysa yüklenirken durdurma, oynayınca herkese yayılır.
      if (!tv.playing && st !== PAUSED && !(st === BUFFERING && userPlay.current)) { mine(PAUSED); p.pauseVideo() }
      if (st !== BUFFERING && Math.abs(t - want) > 1.5) { mine(); p.seekTo(want, true) }
      setTime({cur: p.getCurrentTime(), dur: p.getDuration() || 0})
    }
    const timer = setInterval(sync, 700)
    const off = s.onTv(sync)
    return () => {
      dead = true
      clearInterval(timer)
      off()
      player.current?.destroy?.()
      player.current = null
    }
  }, [s])

  const shown = seeking ?? time.cur
  return (
    <div ref={box} className={'tv' + (item ? '' : ' empty') + (mini ? ' mini' : '') + (cinema && !mini ? ' cinema' : '')}>
      <div className="tvscreen"><div ref={host} /></div>
      {item && (
        <div className="tvbar">
          <button className="ico sm" aria-label={s.tv.playing ? 'Durdur' : 'Oynat'} title={s.tv.playing ? 'Herkes için durdur' : 'Herkes için oynat'} onClick={() => s.tvDo({a: s.tv.playing ? 'pause' : 'play'})}><Icon n={s.tv.playing ? 'pause' : 'play'} s={18} /></button>
          <button className="ico sm" aria-label="Önceki" onClick={() => s.tvDo({a: 'prev'})}><Icon n="prev" s={18} /></button>
          <button className="ico sm" aria-label="Sonraki" onClick={() => s.tvDo({a: 'next'})}><Icon n="next" s={18} /></button>
          <span className="tvtime">{fmt(shown)} / {fmt(time.dur)}</span>
          <input className="grow" type="range" aria-label="Konum" min={0} max={Math.max(1, Math.floor(time.dur))} value={Math.floor(shown)}
            onChange={e => setSeeking(+e.target.value)}
            onPointerUp={e => { s.tvDo({a: 'seek', pos: +e.currentTarget.value}); setSeeking(null) }}
            onKeyUp={e => { s.tvDo({a: 'seek', pos: +e.currentTarget.value}); setSeeking(null) }} />
          <input className="tvvol" type="range" aria-label="Video sesi" title="Sadece senin için" min={0} max={100} value={vol} onChange={e => {
            const v = +e.target.value
            setVol(v)
            player.current?.setVolume?.(v)
            try { localStorage.setItem('telsiz.tvvol', String(v)) } catch { /* yok */ }
          }} />
          <button className="ico sm" aria-label={cinema ? 'Sinema modunu kapat' : 'Sinema modu'} aria-pressed={cinema} title={cinema ? 'Normal boy' : 'Sinema modu: videoyu büyüt (sadece sende)'} onClick={() => {
            setCinema(!cinema); setMini(false)
            try { localStorage.setItem('telsiz.cinema', cinema ? '0' : '1') } catch { /* yok */ }
          }}><Icon n="wide" s={18} /></button>
          <button className="ico sm" aria-label="Tam ekran" title="Tam ekran (sadece sende)" onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen()
            else void box.current?.requestFullscreen?.().catch(() => app.showToast('Tam ekran açılamadı'))
          }}><Icon n="full" s={18} /></button>
          <button className="ico sm" aria-label={mini ? 'Büyüt' : 'Müzik modu'} title={mini ? 'Büyüt' : 'Müzik modu: görüntüyü küçült'} onClick={() => setMini(!mini)}><Icon n="sfx" s={18} /></button>
        </div>
      )}
    </div>
  )
}

export function TvQueue({s}: {s: Session}) {
  const [v, setV] = useState('')
  const add = (e: FormEvent) => {
    e.preventDefault()
    if (s.tvAddLink(v, app.me.name)) setV(''); else app.showToast('Bu bir YouTube linki değil')
  }
  return (
    <div className="tvqueue">
      <form className="row" onSubmit={add}>
        <input placeholder="YouTube linki yapıştır" value={v} onChange={e => setV(e.target.value)} aria-label="YouTube linki" />
        <button className="btn pri" disabled={!ytId(v)}>Ekle</button>
      </form>
      {!s.tv.queue.length && <p className="dim small">Liste boş. Buraya ya da oda sohbetine YouTube linki yazınca herkeste aynı anda açılır.</p>}
      {s.tv.queue.map((q, i) => (
        <div className={'tvrow' + (i === s.tv.idx ? ' now' : '')} key={q.k}>
          <button className="tvitem" aria-label={`${q.title} oynat`} onClick={() => s.tvDo({a: 'jump', i})}>
            <img src={`https://i.ytimg.com/vi/${q.id}/default.jpg`} alt="" width="64" height="48" />
            <span className="ell"><b className="ell">{q.title}</b><small className="dim">{q.by}</small></span>
          </button>
          <button className="ico sm" aria-label={`${q.title} kaldır`} onClick={() => s.tvDo({a: 'remove', k: q.k})}><Icon n="x" s={15} /></button>
        </div>
      ))}
    </div>
  )
}
