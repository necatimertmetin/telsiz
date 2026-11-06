import {useEffect, useRef, useState} from 'react'
import {app} from '../lib/app'
import {SCREEN_Q, type Call, type ScreenQ} from '../lib/call'
import {fmtScreenStat} from '../lib/util'
import {canShareScreen, desktop, isAndroidApp, setSpeaker, speakerOn} from '../lib/native'
import type {Session} from '../lib/session'
import {SFX} from '../lib/sfx'
import {Avatar, PUBLIC_URL} from './App'
import {Chat} from './Chat'
import {Icon} from './Icon'
import {TvPlayer, TvQueue} from './Watch'

function Video({stream, muted, mirror, volume = 1}: {stream: MediaStream; muted: boolean; mirror?: boolean; volume?: number}) {
  const r = useRef<HTMLVideoElement>(null)
  useEffect(() => { if (r.current) r.current.volume = volume }, [volume])
  const sink = app.prefs.speakerId
  useEffect(() => { if (!muted && sink) void (r.current as HTMLVideoElement & {setSinkId?: (i: string) => Promise<void>}).setSinkId?.(sink).catch(() => {}) }, [muted, sink, stream])
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
  const hasAudio = !!t.screen && !!t.stream && t.stream.getAudioTracks().length > 0
  const volKey = t.screen ? 's:' + t.uid : t.uid
  const stat = t.screen ? app.liveCall()?.screenStats.get(t.self ? 'me' : t.peerId ?? '') : undefined
  return (
    <div ref={r} className={'tile' + (t.talk ? ' talk' : '') + (big ? ' big' : '') + (hasAudio ? ' hasvol' : '')} onClick={onClick}>
      {t.stream
        ? <Video stream={t.stream} mirror={t.self && !t.screen} muted={!t.screen || t.self || !!deafened} volume={app.volumes[volKey] ?? 1} />
        : <Avatar uid={t.uid} name={t.name} s={big ? 112 : 76} on={t.talk} />}
      {stat && <div className="tilestat" role="status">{t.self ? 'En zayıf izleyici: ' : ''}{fmtScreenStat(stat)}</div>}
      <div className="tilebar">
        {t.muted && <Icon n="micOff" s={15} />}{t.deaf && <Icon n="headOff" s={15} />}{t.screen && <Icon n="screen" s={15} />}{hasAudio && <span className="saudio" title={t.self ? 'Ekranının sesi yayında' : 'Ekran sesi geliyor'}><Icon n="speaker" s={15} /></span>}
        <span className="ell">{t.name}{t.self ? ' (sen)' : ''}</span>
      </div>
      <div className="tileact" onClick={e => e.stopPropagation()}>
        {t.peerId && (!t.screen || hasAudio) && (
          <>
            {hasAudio && <span className="tilevol">Ses %{Math.round((app.volumes[volKey] ?? 1) * 100)}</span>}
            <input type="range" min="0" max="1" step="0.05" value={app.volumes[volKey] ?? 1} aria-label={`${t.name} ${t.screen ? 'ekran sesi' : 'ses düzeyi'}`} onChange={e => app.setVolume(volKey, +e.target.value)} />
          </>
        )}
        {t.self && hasAudio && (
          <>
            <span className="tilevol">Yayın sesi %{Math.round(app.prefs.screenGain * 100)}</span>
            <input type="range" min="0" max="2" step="0.05" value={app.prefs.screenGain} aria-label="Yayın ses düzeyi" title="Arkadaşlarına giden ekran sesi" onChange={e => { app.prefs.screenGain = +e.target.value; app.savePrefs() }} />
          </>
        )}
        {t.stream && document.pictureInPictureEnabled && <button className="ico sm" aria-label="Küçük pencerede izle" title="Küçük pencerede izle" onClick={() => void r.current?.querySelector('video')?.requestPictureInPicture().catch(() => {})}><Icon n="pip" s={16} /></button>}
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
    if (what === 'mic') void app.setMic(id).catch(() => app.showToast('Mikrofon değiştirilemedi'))
    else { app.prefs[key] = id; app.savePrefs() }
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

function SfxMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="cgroup solo">
      <button className="cbtn" aria-label="Ses efektleri" title="Ses efektleri" onClick={() => setOpen(!open)}><Icon n="sfx" /></button>
      {open && <div className="menuscrim" onClick={() => setOpen(false)} />}
      {open && (
        <div className="devmenu sfxgrid" role="menu" aria-label="Ses efektleri">
          {Object.entries(SFX).map(([id, x]) => <button key={id} onClick={() => app.sendSfx(id)}>{x.label}</button>)}
        </div>
      )}
    </div>
  )
}

function ScreenMenu({call}: {call: Call}) {
  const [open, setOpen] = useState(false)
  const pick = (q: ScreenQ) => {
    app.prefs.screenQ = q
    app.savePrefs()
    void call.changeScreenQuality().catch(() => {})
    setOpen(false)
  }
  return (
    <>
      <button className="caret" aria-label="Yayın kalitesi seç" aria-expanded={open} title="Yayın kalitesi" onClick={() => setOpen(!open)}><Icon n="chev" s={14} /></button>
      {open && <div className="menuscrim" onClick={() => setOpen(false)} />}
      {open && (
        <div className="devmenu" role="menu" aria-label="Yayın kalitesi">
          <h5>Yayın kalitesi</h5>
          {(Object.keys(SCREEN_Q) as ScreenQ[]).map(q => (
            <button key={q} role="menuitemradio" aria-checked={app.prefs.screenQ === q} className={app.prefs.screenQ === q ? 'on' : ''} onClick={() => pick(q)}>
              <span className="ell">{SCREEN_Q[q].label}</span><span className="dim small">{SCREEN_Q[q].b / 1e6} Mb/sn</span>
            </button>
          ))}
          <p className="dim small">Yükleme hızın izleyen kişi başına bu kadar gider. Oyun modunda yayın kısılır.</p>
        </div>
      )}
    </>
  )
}

export function VoiceStage({s, call}: {s: Session; call: Call}) {
  const [focus, setFocus] = useState<string | null>(null)
  const [side, setSide] = useState(() => innerWidth > 1000)
  const [tab, setTab] = useState<'chat' | 'list'>('chat')
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
  for (const u of s.indirect().values()) if (u.voice.in)
    tiles.push({key: 'r:' + u.uid, uid: u.uid, name: `${u.name} (${u.via} üzerinden)`, muted: u.voice.muted, deaf: u.voice.deaf, talk: call.speaking.has('r:' + u.uid), self: false})
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
    <div className="room">
    <div className="stage">
      <TvPlayer s={s} />
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
        {canShareScreen() && (
          <div className="cgroup">
            <button className={'cbtn' + (v.screen ? ' act' : '')} aria-label="Ekran paylaş" title="Ekran paylaş" onClick={() => void shareScreen()}><Icon n="screen" /></button>
            <ScreenMenu call={call} />
          </div>
        )}
        <button className="cbtn" aria-label="Sese davet linki" title="Sese davet linkini kopyala" onClick={() => void navigator.clipboard.writeText(`${PUBLIC_URL}#/katil/${s.code}/ses`).then(() => app.showToast('Link kopyalandı, tıklayan direkt sese gelir')).catch(() => app.showToast('Kopyalanamadı'))}><Icon n="link" /></button>
        <button className={'cbtn' + (side ? ' act' : '')} aria-label="Oda sohbeti" title="Oda sohbeti ve video listesi" onClick={() => setSide(!side)}><Icon n="chat" /></button>
        <SfxMenu />
        <button className={'cbtn' + (call.clip ? ' act' : '')} aria-label="Klip kaydı" title={call.clip ? 'Klip kaydı açık, kapat' : 'Klip kaydını aç'} onClick={() => call.toggleClip()}><Icon n="clipper" /></button>
        {call.clip && <button className="cbtn wide" aria-label="Son anı kaydet" title="Son 30-60 saniyeyi sohbete gönder" onClick={() => void app.saveClip()}>Kaydet</button>}
        <button className="cbtn leave" aria-label="Çık" title="Çık" onClick={() => app.leaveVoice()}><Icon n="hang" /></button>
      </div>
    </div>
    {side && (
      <aside className="roomside" aria-label="Oda sohbeti">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Sohbet</button>
          <button role="tab" aria-selected={tab === 'list'} className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Liste{s.tv.queue.length ? ` (${s.tv.queue.length})` : ''}</button>
          <button className="ico sm sideclose" aria-label="Paneli kapat" onClick={() => setSide(false)}><Icon n="x" s={16} /></button>
        </div>
        {tab === 'chat' ? <Chat key={s.code + 'ses'} s={s} ch="ses" /> : <TvQueue s={s} />}
      </aside>
    )}
    </div>
  )
}
