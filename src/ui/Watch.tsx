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
const PLAYING = 1, PAUSED = 2, BUFFERING = 3, ENDED = 0

// Oynatıcının kendi kontrolleri kapalı: herkesin komutu ortak durumdan geçsin, kimse kendi başına kaymasın.
export function TvPlayer({s}: {s: Session}) {
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<YtPlayer>(null)
  const loaded = useRef('')
  const [time, setTime] = useState({cur: 0, dur: 0})
  const [mini, setMini] = useState(false)
  const [vol, setVol] = useState(readVol)
  const [seeking, setSeeking] = useState<number | null>(null)
  const item = tvCurrent(s.tv)

  useEffect(() => {
    let dead = false
    void loadApi().then(() => {
      if (dead || !host.current) return
      player.current = new window.YT.Player(host.current, {
        width: '100%', height: '100%',
        playerVars: {controls: 0, disablekb: 1, rel: 0, playsinline: 1, modestbranding: 1, fs: 0, origin: location.origin},
        events: {
          onReady: () => { window.__tv = player.current; player.current.setVolume(readVol()); sync() },
          onStateChange: (e: {data: number}) => {
            if (e.data === ENDED && loaded.current) s.tvDo({a: 'ended', k: loaded.current})
            else sync()
          },
          onError: () => {
            const k = tvCurrent(s.tv)?.k
            app.showToast('Bu video burada oynatılamıyor, geçildi')
            if (k) s.tvDo({a: 'ended', k})
          },
        },
      })
    })
    const sync = () => {
      const p = player.current
      if (!p?.getPlayerState) return
      const tv = s.tv, cur = tvCurrent(tv)
      if (!cur) {
        if (loaded.current) { p.stopVideo(); loaded.current = '' }
        return
      }
      const want = tvPos(tv, performance.now())
      if (loaded.current !== cur.k) {
        loaded.current = cur.k
        p.loadVideoById({videoId: cur.id, startSeconds: want})
        return
      }
      const st = p.getPlayerState()
      if (tv.playing && st !== PLAYING && st !== BUFFERING && st !== ENDED) p.playVideo()
      if (!tv.playing && st !== PAUSED) p.pauseVideo()
      if (st !== BUFFERING && Math.abs(p.getCurrentTime() - want) > 1.5) p.seekTo(want, true)
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
    <div className={'tv' + (item ? '' : ' empty') + (mini ? ' mini' : '')}>
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
