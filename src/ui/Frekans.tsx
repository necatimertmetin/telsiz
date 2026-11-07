import {useState, type ReactNode} from 'react'
import {app} from '../lib/app'
import {can, dmOthers, isDm} from '../lib/history'
import type {Session} from '../lib/session'
import {Avatar, chatName, KIND_ICON, Members, Notices, people, RadioBar, roomRows, useRoomDrop, dragProps, type ModalKind} from './App'
import {Chat} from './Chat'
import {Icon} from './Icon'
import {MiniCall, VoiceStage} from './Voice'

// Frekans arayüzü (masaüstü): üstte gruplar ve sinyaldekiler, solda kadran (frekanslar ve kanallar),
// ortada sahne, sağda kişiler. Sohbet, ses sahnesi, radyo ve ayarlar klasik arayüzle aynı bileşenler.

// Frekans numarası oda sırasından gelir: ses odaları 90-99.6, yazı kanalları 100.5-107.5.
export const voiceFreq = (i: number) => (90 + (i % 7) * 1.6).toFixed(1)
export const textFreq = (i: number) => (100.5 + (i % 6) * 1.4).toFixed(1)
const KIND_TAG = {voice: 'SES', music: 'MÜZİK', radio: 'RADYO'} as const

function Dial({f, kind, name}: {f: string | null; kind: string; name: string}) {
  const x = f ? Math.min(100, Math.max(0, (parseFloat(f) - 88) / 20 * 100)) : null
  return (
    <div className="fq-screen">
      <div className="fq-scrtop"><b>{f ?? '—'}</b><small>{kind}</small></div>
      <div className="fq-scrname ell">{name}</div>
      <div className="fq-scale" aria-hidden="true">
        {Array.from({length: 21}, (_, i) => <i key={i} className={i % 5 ? '' : 'big'} style={{left: i * 5 + '%'}} />)}
        {x !== null && <em style={{left: x + '%'}} />}
      </div>
      <div className="fq-scalen" aria-hidden="true"><span>88</span><span>98</span><span>108</span></div>
    </div>
  )
}

function Rooms({s}: {s: Session}) {
  const call = app.call!
  const here = app.route.kind === 'voice' ? app.shownRoom(s).id : null
  const {over, props} = useRoomDrop(s)
  return (
    <>
      {roomRows(s, () => {}).map(({r, users, n, onAir, playing, open}, i) => (
        <div key={r.id}>
          <button className={'fq-st' + (here === r.id ? ' on' : '') + (over === r.id ? ' dropon' : '')} onClick={open} {...props(r)}>
            <span className="fq-f">{voiceFreq(i)}</span>
            <span className="fq-stn">
              <span className="ell fq-stt">{r.title}</span>
              <span className="ell fq-who">{playing ?? (users.length ? users.map(u => u.name).join(', ') : r.kind === 'voice' ? 'boş' : KIND_TAG[r.kind].toLocaleLowerCase('tr-TR'))}</span>
            </span>
            {n > 0 && <span className="fq-n">{n}</span>}
            {onAir ? <span className="eq" aria-label="Radyo çalıyor"><i /><i /><i /></span>
              : users.length > 0 ? <span className="fq-live" aria-label={`${users.length} kişi`}><i /><i /><i /></span>
              : <Icon n={KIND_ICON[r.kind]} s={15} />}
          </button>
          {users.length > 0 && here === r.id && users.map(u => (
            <div key={u.id} className="fq-vuser" {...dragProps(s, u.uid, u.name, true)}>
              <Avatar uid={u.uid} name={u.name} s={20} on={call.speaking.has(u.id)} />
              <span className="ell">{u.name}</span>
              {u.v.muted && <Icon n="micOff" s={13} />}{u.v.cam && <Icon n="video" s={13} />}{u.v.screen && <Icon n="screen" s={13} />}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

function Channels({s}: {s: Session}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const sel = (ch: string) => app.route.kind === 'text' && app.route.ch === ch
  return (
    <>
      <div className="fq-lbl">Yazı kanalları <button className="ico sm" aria-label="Kanal ekle" title="Kanal ekle" onClick={() => setAdding(!adding)}><Icon n="plus" s={14} /></button></div>
      {adding && (
        <form className="pad" onSubmit={e => {
          e.preventDefault()
          const t = title.trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, '-').slice(0, 40)
          if (t) { const id = crypto.randomUUID().slice(0, 12); s.emit({t: 'chan', chId: id, title: t} as never); app.go({kind: 'text', ch: id}) }
          setTitle(''); setAdding(false)
        }}>
          <input autoFocus placeholder="kanal-adi" value={title} onChange={e => setTitle(e.target.value)} aria-label="Kanal adı" />
        </form>
      )}
      {s.view.channels.map(c => {
        const n = app.unread(s, c.id)
        return (
          <button key={c.id} className={'fq-st txt' + (sel(c.id) ? ' on' : '') + (n ? ' unread' : '')} onClick={() => app.go({kind: 'text', ch: c.id})}>
            <span className="fq-f">#</span><span className="ell grow">{c.title}</span>{n > 0 && <span className="fq-n">{n}</span>}
          </button>
        )
      })}
    </>
  )
}

function Dms({s, onNew}: {s: Session; onNew: () => void}) {
  const dms = [...s.view.msgs.keys()].filter(isDm)
  return (
    <>
      <div className="fq-lbl">Özel sohbetler <button className="ico sm" aria-label="Özel sohbet kur" title="Özel sohbet kur" onClick={onNew}><Icon n="plus" s={14} /></button></div>
      {dms.map(ch => {
        const n = app.unread(s, ch)
        const name = chatName(s, ch)
        return (
          <button key={ch} className={'fq-st txt' + (app.route.kind === 'text' && app.route.ch === ch ? ' on' : '') + (n ? ' unread' : '')} onClick={() => app.go({kind: 'text', ch})}>
            <Avatar uid={dmOthers(ch, app.me.uid)[0]} name={name} s={20} /><span className="ell grow">{name}</span>{n > 0 && <span className="fq-n">{n}</span>}
          </button>
        )
      })}
    </>
  )
}

function Me() {
  const live = app.liveSession()
  const call = app.liveCall()
  const room = live ? app.roomOf(live, live.voice.room ?? '') : null
  const idx = live && room ? [{id: ''}, ...live.view.rooms].findIndex(r => r.id === room.id) : -1
  const back = () => { if (live) { app.select(live.code); app.go({kind: 'voice'}) } }
  return (
    <footer className="fq-me">
      <span className={live ? 'fq-meav on' : 'fq-meav'}><Avatar uid={app.me.uid} name={app.me.name} s={34} /></span>
      <button className="fq-mest" disabled={!live} onClick={back} title={live ? 'Sahneye dön' : ''}>
        <b className="ell">{app.me.name}</b>
        <span className={'ell' + (live ? ' ok' : '')}>{live && room ? `${voiceFreq(idx)} MHz · yayında` : 'frekans dışı'}</span>
      </button>
      <button className={'ico sm' + (live?.voice.muted ? ' off' : '')} disabled={!live} aria-label="Mikrofon" title="Mikrofon" onClick={() => call?.toggleMute()}><Icon n={live?.voice.muted ? 'micOff' : 'mic'} s={17} /></button>
      <button className={'ico sm' + (live?.voice.deaf ? ' off' : '')} disabled={!live} aria-label="Kulaklık" title="Kulaklık" onClick={() => call?.toggleDeaf()}><Icon n={live?.voice.deaf ? 'headOff' : 'head'} s={17} /></button>
    </footer>
  )
}

function Ptt() {
  if (!app.prefs.ptt) return null
  const hold = (d: boolean) => () => app.setPttDown(d)
  return <button className="fq-ptt" onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerLeave={hold(false)} onPointerCancel={hold(false)}>Bas konuş · {app.prefs.pttLabel}</button>
}

export function Frekans({s, onModal, children}: {s: Session; onModal: (m: ModalKind) => void; children: ReactNode}) {
  const [searching, setSearching] = useState(false)
  const route = app.route
  const live = app.liveSession()
  const liveCall = app.liveCall()
  const {online} = people(s)
  const rooms = [{id: '', kind: 'voice' as const}, ...s.view.rooms]

  let f: string | null = null, kind = 'YAZI', name = ''
  if (route.kind === 'voice') {
    const r = app.shownRoom(s)
    f = voiceFreq(Math.max(0, rooms.findIndex(x => x.id === r.id)))
    kind = KIND_TAG[r.kind]; name = r.title
  } else if (isDm(route.ch)) {
    kind = 'ÖZEL'; name = '@ ' + chatName(s, route.ch)
  } else {
    const i = s.view.channels.findIndex(c => c.id === route.ch)
    f = i >= 0 ? textFreq(i) : null
    name = '# ' + (s.view.channels[i]?.title ?? 'genel')
  }
  const joined = route.kind === 'voice' && s.voice.in
  const voiceN = route.kind === 'voice' ? roomRows(s, () => {}).find(x => x.r.id === app.shownRoom(s).id)?.users.length ?? 0 : 0
  const liveRoom = live ? app.roomOf(live, live.voice.room ?? '') : null
  const liveIdx = live && liveRoom ? [{id: ''}, ...live.view.rooms].findIndex(r => r.id === liveRoom.id) : 0
  const toggle = (k: 'hideMembers') => { app.prefs[k] = !app.prefs[k]; app.savePrefs() }

  return (
    <div className={'fq' + (app.prefs.hideMembers ? ' nomembers' : '')} data-ui="frekans">
      <header className="fq-top">
        <div className="fq-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4.5 10.5a8 8 0 0 1 15 0" /><path d="M8 11a4 4 0 0 1 8 0" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><path d="M12 13.5V21" /></svg>
          <span>Telsiz</span>
        </div>
        <nav className="fq-groups" aria-label="Gruplar">
          {[...app.sessions.values()].map(x => {
            const n = app.unreadGroup(x)
            return (
              <button key={x.code} title={x.view.title} className={x.code === app.active ? 'on' : ''} aria-current={x.code === app.active || undefined} onClick={() => app.select(x.code)}>
                <span className="ell">{x.view.title}</span>
                {x.voice.in && <span className="fq-led" aria-label="seste" />}
                {n > 0 && x.code !== app.active && <span className="fq-n">{n > 99 ? '99+' : n}</span>}
              </button>
            )
          })}
          <button className="fq-add" aria-label="Grup ekle" title="Grup ekle" onClick={() => onModal('add')}><Icon n="plus" s={16} /></button>
        </nav>
        <div className="grow" />
        <button className="fq-online" title={online.map(u => u.name).join(', ')} aria-pressed={!app.prefs.hideMembers} aria-label={app.prefs.hideMembers ? 'Üyeleri göster' : 'Üyeleri gizle'} onClick={() => toggle('hideMembers')}>
          <span className="fq-lblin">{s.settling ? 'Aranıyor' : `Sinyalde ${online.length}`}</span>
          <span className="fq-stack">{online.slice(0, 6).map(u => <Avatar key={u.key} uid={u.uid} name={u.name} s={26} />)}</span>
        </button>
        <button className="fq-invite" onClick={() => onModal('invite')}><Icon n="userPlus" s={16} /> Davet et</button>
        <button className="ico sm fq-gear" aria-label="Ayarlar" title="Ayarlar" onClick={() => onModal('settings')}><Icon n="gear" s={18} /></button>
      </header>

      <aside className="fq-dial">
        <div className="fq-dialtop"><Dial f={f} kind={kind} name={name} /></div>
        <div className="scroll">
          <div className="fq-lbl">Ses frekansları{s.settling && <span className="seeking"> · bağlanıyor</span>} {can(s.view, app.me.uid, 'rooms') && <button className="ico sm" aria-label="Oda kur" title="Oda kur" onClick={() => onModal('room')}><Icon n="plus" s={14} /></button>}</div>
          <Rooms s={s} />
          <Channels s={s} />
          <Dms s={s} onNew={() => onModal('private')} />
        </div>
        <RadioBar />
        <Me />
      </aside>

      <main className="main fq-main">
        <Notices s={s} onSettings={() => onModal('settings')} />
        {route.kind === 'text' && live && liveRoom && (
          <button className="fq-back" onClick={() => { app.select(live.code); app.go({kind: 'voice'}) }}>
            <span className="fq-led" aria-hidden="true" /><b>Hâlâ yayındasın</b>
            <span className="ell grow">{liveRoom.title} · {voiceFreq(liveIdx)} MHz{live !== s ? ` · ${live.view.title}` : ''}</span>
            <span className="fq-backgo">Sahneye dön</span>
          </button>
        )}
        <div className="fq-head">
          {route.kind === 'voice' && (joined ? <span className="fq-tag on">● Yayındasın</span> : <span className="fq-tag">Frekans dışı</span>)}
          {searching && route.kind === 'text'
            ? <input className="searchbox grow" autoFocus placeholder="Mesajlarda ara" value={app.search} aria-label="Mesajlarda ara" onChange={e => { app.search = e.target.value; app.bump() }} onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); app.search = ''; app.bump() } }} />
            : <h1 className="ell">{name}</h1>}
          {!searching && f && <span className="fq-meta">{f} MHz{route.kind === 'voice' ? ` · ${voiceN} kişi` : ''}</span>}
          <div className="grow" />
          {joined && <Ptt />}
          {route.kind === 'text' && <button className="ico" title="Ara" aria-label="Ara" onClick={() => { setSearching(!searching); app.search = ''; app.bump() }}><Icon n={searching ? 'x' : 'search'} /></button>}
          {route.kind === 'text' && !s.voice.in && <button className="ico" title="Sesli katıl" aria-label="Sesli katıl" onClick={() => void app.joinVoice()}><Icon n="wave" /></button>}
          {route.kind === 'text' && !s.voice.in && <button className="ico" title="Görüntülü katıl" aria-label="Görüntülü katıl" onClick={() => void app.joinVoice(true)}><Icon n="video" /></button>}
        </div>
        <div className="fq-frame">
          {route.kind === 'text' ? <Chat key={s.code + route.ch} s={s} ch={route.ch} /> : <VoiceStage s={s} call={app.call!} />}
        </div>
        {live && liveCall && (live !== s || route.kind === 'text') && <MiniCall s={live} call={liveCall} />}
      </main>

      <aside className="fq-side">
        <div className="fq-sidehead"><span className="fq-lblin">Sinyaldekiler</span><span className="dim small">· {s.view.title}</span></div>
        <div className="scroll"><Members s={s} /></div>
      </aside>
      {children}
    </div>
  )
}
