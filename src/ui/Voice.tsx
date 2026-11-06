import {useEffect, useRef, useState} from 'react'
import {app} from '../lib/app'
import type {Call} from '../lib/call'
import {canShareScreen, desktop, isAndroidApp, setSpeaker, speakerOn} from '../lib/native'
import type {Session} from '../lib/session'
import {Avatar} from './App'
import {Icon} from './Icon'

function Video({stream, muted, mirror}: {stream: MediaStream; muted: boolean; mirror?: boolean}) {
  const r = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (r.current && r.current.srcObject !== stream) r.current.srcObject = stream
    void r.current?.play().catch(() => {})
  }, [stream])
  return <video ref={r} autoPlay playsInline muted={muted} className={mirror ? 'mirror' : ''} />
}

type Tile = {key: string; uid: string; name: string; peerId?: string; stream?: MediaStream; screen?: boolean; muted?: boolean; deaf?: boolean; talk: boolean; self: boolean}

function TileView({t, big, onClick}: {t: Tile; big: boolean; onClick: () => void}) {
  const r = useRef<HTMLDivElement>(null)
  const deafened = app.liveSession()?.voice.deaf
  return (
    <div ref={r} className={'tile' + (t.talk ? ' talk' : '') + (big ? ' big' : '')} onClick={onClick}>
      {t.stream
        ? <Video stream={t.stream} mirror={t.self && !t.screen} muted={!t.screen || t.self || !!deafened} />
        : <Avatar uid={t.uid} name={t.name} s={big ? 112 : 76} on={t.talk} />}
      <div className="tilebar">
        {t.muted && <Icon n="micOff" s={15} />}{t.deaf && <Icon n="headOff" s={15} />}{t.screen && <Icon n="screen" s={15} />}
        <span className="ell">{t.name}{t.self ? ' (sen)' : ''}</span>
      </div>
      <div className="tileact" onClick={e => e.stopPropagation()}>
        {t.peerId && !t.screen && (
          <input type="range" min="0" max="1" step="0.05" value={app.volumes[t.uid] ?? 1} aria-label={`${t.name} ses düzeyi`} onChange={e => app.setVolume(t.uid, +e.target.value)} />
        )}
        {t.stream && <button className="ico sm" aria-label="Tam ekran" onClick={() => void r.current?.requestFullscreen?.()}><Icon n="full" s={16} /></button>}
      </div>
    </div>
  )
}

type Opt = {id: string; label: string}
const KIND = {mic: 'audioinput', spk: 'audiooutput', cam: 'videoinput'} as const
const NAME = {mic: 'Mikrofon', spk: 'Ses çıkışı', cam: 'Kamera'}

function DeviceMenu({what, call}: {what: keyof typeof KIND; call: Call}) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<Opt[]>([])
  const [, redraw] = useState(0)
  const androidSpk = what === 'spk' && isAndroidApp()
  const canSink = 'setSinkId' in HTMLMediaElement.prototype

  useEffect(() => {
    if (!open || androidSpk) return
    const load = () => navigator.mediaDevices.enumerateDevices().then(list => {
      const same = list.filter(d => d.kind === KIND[what] && d.deviceId !== 'default' && d.deviceId !== 'communications')
      setOpts(same.map((d, i) => ({id: d.deviceId, label: d.label || `${NAME[what]} ${i + 1}`})))
    }).catch(() => {})
    void load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [open, what, androidSpk])

  const key = ({mic: 'micId', spk: 'speakerId', cam: 'camId'} as const)[what]
  const pick = (id: string) => {
    app.prefs[key] = id
    app.savePrefs()
    if (what === 'mic') void call.changeMic().catch(() => app.showToast('Mikrofon değiştirilemedi'))
    if (what === 'cam') void call.changeCam().catch(() => app.showToast('Kamera değiştirilemedi'))
    setOpen(false)
  }
  const row = (id: string, label: string, on: boolean, click: () => void) => (
    <button key={id || 'def'} role="menuitemradio" aria-checked={on} className={on ? 'on' : ''} onClick={click}><span className="ell">{label}</span>{on && <Icon n="check" s={16} />}</button>
  )
  const noPick = what === 'spk' && !androidSpk && (!canSink || opts.length === 0)

  return (
    <>
      <button className="caret" aria-label={`${NAME[what]} seç`} aria-expanded={open} title={`${NAME[what]} seç`} onClick={() => setOpen(!open)}><Icon n="chev" s={14} /></button>
      {open && <div className="menuscrim" onClick={() => setOpen(false)} />}
      {open && (
        <div className="devmenu" role="menu" aria-label={NAME[what]}>
          <h5>{NAME[what]}</h5>
          {androidSpk ? (
            <>
              {row('sp', 'Hoparlör', speakerOn, () => { void setSpeaker(true); setOpen(false); redraw(x => x + 1) })}
              {row('ear', 'Kulaklık / diyafon', !speakerOn, () => { void setSpeaker(false); setOpen(false); redraw(x => x + 1) })}
            </>
          ) : noPick ? (
            <p className="dim small">Bu tarayıcı ses çıkışını seçtirmiyor. Telefonda ses diyafondan geliyorsa Android uygulamasını kur. iPhone'da kamerayı açmak sesi hoparlöre alabilir.</p>
          ) : (
            <>
              {row('', 'Varsayılan', !app.prefs[key], () => pick(''))}
              {opts.map(o => row(o.id, o.label, app.prefs[key] === o.id, () => pick(o.id)))}
            </>
          )}
        </div>
      )}
    </>
  )
}

export function VoiceStage({s, call}: {s: Session; call: Call}) {
  const [focus, setFocus] = useState<string | null>(null)
  const v = s.voice
  const others = [...s.peers].filter(([, p]) => p.voice.in)

  if (!v.in) return (
    <div className="prejoin">
      <div className="card">
        <h2>Telsiz odası</h2>
        <p className="dim">{others.length ? `İçeride: ${others.map(([, p]) => p.name).join(', ')}` : 'Şu an kimse yok.'}</p>
        <div className="col">
          <button className="btn pri" onClick={() => void app.joinVoice()}><Icon n="mic" s={18} /> Sesli katıl</button>
          <button className="btn" onClick={() => void app.joinVoice(true)}><Icon n="video" s={18} /> Görüntülü katıl</button>
          <button className="btn ghost" disabled={!s.peers.size} onClick={() => { s.ring(); app.showToast('Herkese çağrı gitti') }}><Icon n="bell" s={18} /> Herkesi çağır</button>
        </div>
      </div>
    </div>
  )

  const tiles: Tile[] = []
  if (call.streams.screen) tiles.push({key: 'me-screen', uid: app.me.uid, name: 'Ekranın', stream: call.streams.screen, screen: true, talk: false, self: true})
  for (const [peerId, p] of others) {
    const r = call.remote.get(peerId)
    if (p.voice.screen && r?.screen) tiles.push({key: peerId + '-screen', uid: p.uid, name: p.name, stream: r.screen, screen: true, talk: false, self: false, peerId})
  }
  tiles.push({key: 'me', uid: app.me.uid, name: app.me.name, stream: call.streams.cam, muted: v.muted, deaf: v.deaf, talk: call.speaking.has('me'), self: true})
  for (const [peerId, p] of others) {
    const r = call.remote.get(peerId)
    tiles.push({key: peerId, uid: p.uid, name: p.name, peerId, stream: p.voice.cam ? r?.cam : undefined, muted: p.voice.muted, deaf: p.voice.deaf, talk: call.speaking.has(peerId), self: false})
  }
  const focused = tiles.find(t => t.key === focus)
  const rest = focused ? tiles.filter(t => t !== focused) : tiles

  const shareScreen = async () => {
    const d = desktop()
    if (d && !call.streams.screen) {
      app.sourcePicker = await d.listSources()
      app.bump()
      return
    }
    const was = !!call.streams.screen
    await call.toggleScreen().catch(() => {})
    if (!was && call.streams.screen && !call.streams.screen.getAudioTracks().length)
      app.showToast('Ses gitmiyor: seçimde ses paylaşımını aç')
  }

  return (
    <div className="stage">
      {focused && <div className="focus"><TileView t={focused} big onClick={() => setFocus(null)} /></div>}
      <div className={'grid n' + Math.min(rest.length, 6) + (focused ? ' strip' : '')}>
        {rest.map(t => <TileView key={t.key} t={t} big={false} onClick={() => setFocus(t.key)} />)}
      </div>
      {!others.length && <p className="dim stagehint">Odada sadece sen varsın. <button className="linkbtn" disabled={!s.peers.size} onClick={() => { s.ring(); app.showToast('Herkese çağrı gitti') }}>Herkesi çağır</button></p>}
      <div className="controls">
        <div className="cgroup">
          <button className={'cbtn' + (v.muted ? ' off' : '')} aria-label="Mikrofon" title="Mikrofon" onClick={() => call.toggleMute()}><Icon n={v.muted ? 'micOff' : 'mic'} /></button>
          <DeviceMenu what="mic" call={call} />
        </div>
        <div className="cgroup">
          <button className={'cbtn' + (v.deaf ? ' off' : '')} aria-label="Kulaklık" title="Kulaklık" onClick={() => call.toggleDeaf()}><Icon n={v.deaf ? 'headOff' : 'head'} /></button>
          <DeviceMenu what="spk" call={call} />
        </div>
        <div className="cgroup">
          <button className={'cbtn' + (v.cam ? ' act' : '')} aria-label="Kamera" title="Kamera" onClick={() => void call.toggleCam().catch(() => app.showToast('Kamera açılamadı'))}><Icon n={v.cam ? 'video' : 'videoOff'} /></button>
          <DeviceMenu what="cam" call={call} />
        </div>
        {v.cam && navigator.maxTouchPoints > 0 && <button className="cbtn" aria-label="Kamerayı çevir" onClick={() => void call.flipCam()}><Icon n="flip" /></button>}
        {canShareScreen() && <button className={'cbtn' + (v.screen ? ' act' : '')} aria-label="Ekran paylaş" title="Ekran paylaş" onClick={() => void shareScreen()}><Icon n="screen" /></button>}
        <button className="cbtn leave" aria-label="Çık" title="Çık" onClick={() => app.leaveVoice()}><Icon n="hang" /></button>
      </div>
    </div>
  )
}
