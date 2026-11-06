import {useEffect, useState, type FormEvent} from 'react'
import {app, useApp} from '../lib/app'
import type {Session} from '../lib/session'
import {dmId, dmPartner, isDm} from '../lib/history'
import {desktop} from '../lib/native'
import {colorFor, initials, parseInvite} from '../lib/util'
import {Chat} from './Chat'
import {Icon} from './Icon'
import {Modal} from './Modal'
import {Settings} from './Settings'
import {VoiceStage} from './Voice'

export const PUBLIC_URL = 'https://necatimertmetin.github.io/telsiz/'

export function Avatar({uid, name, on, s = 34}: {uid: string; name: string; on?: boolean; s?: number}) {
  return <span className={'av' + (on ? ' talk' : '')} style={{background: colorFor(uid), width: s, height: s, fontSize: s * .44}}>{initials(name)}</span>
}

function NameStep() {
  const [v, setV] = useState('')
  const [restore, setRestore] = useState(false)
  const [code, setCode] = useState('')
  const submit = (e: FormEvent) => { e.preventDefault(); if (v.trim()) app.setName(v) }
  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <img src="icon.svg" width="72" height="72" alt="" />
        <h1>Telsiz</h1>
        <p className="dim">Hesap yok, şifre yok. Arkadaşların seni tanısın diye bir isim yaz, yeter.</p>
        <input autoFocus maxLength={32} placeholder="Takma adın" value={v} onChange={e => setV(e.target.value)} aria-label="Takma adın" />
        <button className="btn pri" disabled={!v.trim()}>Devam</button>
        {restore ? (
          <>
            <input placeholder="Yedek kodunu yapıştır" value={code} onChange={e => setCode(e.target.value)} aria-label="Yedek kodu" />
            <button type="button" className="btn" disabled={!code.trim()} onClick={() => { if (!app.importBackup(code)) app.showToast('Yedek kodu geçersiz') }}>Geri yükle</button>
          </>
        ) : <button type="button" className="linkbtn" onClick={() => setRestore(true)}>Daha önce kullandım, yedek kodum var</button>}
        {app.toast && <p className="dim small">{app.toast}</p>}
      </form>
    </div>
  )
}

function GroupForm({onDone}: {onDone?: () => void}) {
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const parsed = parseInvite(code)
  return (
    <>
      <form onSubmit={e => { e.preventDefault(); app.createGroup(title); onDone?.() }}>
        <label className="lbl">Yeni grup kur</label>
        <div className="row">
          <input maxLength={40} placeholder="Grup adı (ör. Hafta Sonu CS)" value={title} onChange={e => setTitle(e.target.value)} aria-label="Grup adı" />
          <button className="btn pri">Kur</button>
        </div>
      </form>
      <div className="explain dim small">
        <span><b>Kim görebilir?</b> Sadece davet kodunu bilenler. Gruplar hiçbir yerde listelenmez, aranarak bulunamaz.</span>
        <span>Kurunca sana rastgele bir kod verilir. Linki kimle paylaşırsan o girer, kod onun için grubun anahtarıdır.</span>
        <span>Mesajlar ve dosyalar sunucuya gitmez, doğrudan cihazlar arasında şifreli gider ve sadece grubun cihazlarında durur.</span>
      </div>
      <div className="or"><span>ya da</span></div>
      <form onSubmit={e => { e.preventDefault(); if (parsed) { app.join(parsed); onDone?.() } }}>
        <label className="lbl">Davet ile katıl</label>
        <div className="row">
          <input placeholder="Davet linki ya da kod" value={code} onChange={e => setCode(e.target.value)} aria-label="Davet linki ya da kod" />
          <button className="btn" disabled={!parsed}>Katıl</button>
        </div>
      </form>
    </>
  )
}

function Invite({s, onClose}: {s: Session; onClose: () => void}) {
  const link = `${PUBLIC_URL}#/katil/${s.code}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); app.showToast('Davet linki kopyalandı') } catch { app.showToast('Kopyalanamadı, kodu elle seç') }
  }
  return (
    <Modal title="Arkadaşlarını davet et" onClose={onClose}>
      <p className="dim">Bu linke tıklayan kurulum yapmadan gruba girer, uygulamada açanlar kodu yapıştırır. Grubu görebilmenin tek yolu bu kod: bilen herkes girer ve eski mesajları görür. Kodu değiştirmek mümkün değil, bu yüzden sadece arkadaşlarınla paylaş. Sızarsa yeni grup kurun.</p>
      <code className="code">{s.code}</code>
      <div className="row">
        <button className="btn pri" onClick={copy}><Icon n="link" s={18} /> Linki kopyala</button>
        {typeof navigator.share === 'function' && <button className="btn" onClick={() => navigator.share({title: 'Telsiz', text: 'Gruba gel', url: link}).catch(() => {})}>Paylaş</button>}
      </div>
    </Modal>
  )
}

function Rail({onAdd}: {onAdd: () => void}) {
  return (
    <nav className="rail" aria-label="Gruplar">
      {[...app.sessions.values()].map(s => {
        const n = app.unreadGroup(s)
        return (
          <button key={s.code} title={s.view.title} className={'gbtn' + (s.code === app.active ? ' on' : '')} onClick={() => app.select(s.code)}>
            {initials(s.view.title)}
            {s.voice.in && <span className="dot live" />}
            {n > 0 && s.code !== app.active && <span className="badge">{n > 99 ? '99+' : n}</span>}
          </button>
        )
      })}
      <button className="gbtn add" title="Grup ekle" aria-label="Grup ekle" onClick={onAdd}><Icon n="plus" /></button>
    </nav>
  )
}

function people(s: Session) {
  const seen = new Set<string>()
  const online: {key: string; uid: string; name: string; peerId?: string}[] = [{key: 'me', uid: app.me.uid, name: app.me.name}]
  seen.add(app.me.uid)
  for (const [peerId, p] of s.peers) if (!seen.has(p.uid)) { seen.add(p.uid); online.push({key: peerId, uid: p.uid, name: p.name, peerId}) }
  const offline = [...s.view.people].filter(([uid]) => !seen.has(uid)).map(([uid, name]) => ({uid, name}))
  return {online, offline}
}

function Side({s, onInvite, onSettings, onNavigate}: {s: Session; onInvite: () => void; onSettings: () => void; onNavigate: () => void}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const call = app.call!
  const dms = [...s.view.msgs.keys()].filter(isDm)
  const inVoice = [{id: 'me', uid: app.me.uid, name: app.me.name, on: s.voice.in, v: s.voice}, ...[...s.peers].map(([id, p]) => ({id, uid: p.uid, name: p.name, on: p.voice.in, v: p.voice}))].filter(x => x.on)
  const live = app.liveSession()
  const liveCall = app.liveCall()
  return (
    <aside className="side">
      <header className="sidehead">
        <strong className="ell">{s.view.title}</strong>
        <button className="ico" title="Davet et" aria-label="Davet et" onClick={onInvite}><Icon n="plus" s={18} /></button>
      </header>
      <div className="scroll">
        <div className="sect">Yazı kanalları <button className="ico sm" aria-label="Kanal ekle" title="Kanal ekle" onClick={() => setAdding(!adding)}><Icon n="plus" s={15} /></button></div>
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
            <button key={c.id} className={'chan' + (app.route.kind === 'text' && app.route.ch === c.id ? ' on' : '')} onClick={() => { app.go({kind: 'text', ch: c.id}); onNavigate() }}>
              <Icon n="hash" s={17} /><span className="ell">{c.title}</span>{n > 0 && <span className="badge in">{n}</span>}
            </button>
          )
        })}
        {dms.length > 0 && <div className="sect">Özel sohbetler</div>}
        {dms.map(ch => {
          const uid = dmPartner(ch, app.me.uid)
          const name = s.view.people.get(uid) ?? 'Biri'
          const n = app.unread(s, ch)
          return (
            <button key={ch} className={'chan' + (app.route.kind === 'text' && app.route.ch === ch ? ' on' : '')} onClick={() => { app.go({kind: 'text', ch}); onNavigate() }}>
              <Avatar uid={uid} name={name} s={20} /><span className="ell">{name}</span>{n > 0 && <span className="badge in">{n}</span>}
            </button>
          )
        })}
        <div className="sect">Ses</div>
        <button className={'chan' + (app.route.kind === 'voice' ? ' on' : '')} onClick={() => { app.go({kind: 'voice'}); onNavigate() }}>
          <Icon n="wave" s={17} /><span className="ell">Telsiz odası</span>{inVoice.length > 0 && <span className="count">{inVoice.length}</span>}
        </button>
        {inVoice.map(u => (
          <div key={u.id} className="vuser">
            <Avatar uid={u.uid} name={u.name} s={22} on={call.speaking.has(u.id)} />
            <span className="ell">{u.name}</span>
            {u.v.muted && <Icon n="micOff" s={14} />}{u.v.cam && <Icon n="video" s={14} />}{u.v.screen && <Icon n="screen" s={14} />}{u.v.sAudio && <span title="Ekran sesi yayında" className="saudio"><Icon n="speaker" s={14} /></span>}
          </div>
        ))}
        <div className="onlymobile"><Members s={s} onOpen={onNavigate} /></div>
      </div>
      {live && liveCall && (
        <div className="livebar">
          <button className="livetxt" onClick={() => { app.select(live.code); app.go({kind: 'voice'}); onNavigate() }}><b>Seste</b><span className="ell">{live.view.title}</span></button>
          <button className="ico danger" title="Sesten çık" aria-label="Sesten çık" onClick={() => app.leaveVoice()}><Icon n="hang" /></button>
        </div>
      )}
      <footer className="me">
        <Avatar uid={app.me.uid} name={app.me.name} s={32} />
        <span className="ell grow">{app.me.name}</span>
        <button className={'ico' + (live?.voice.muted ? ' off' : '')} disabled={!live} aria-label="Mikrofon" title="Mikrofon" onClick={() => liveCall?.toggleMute()}><Icon n={live?.voice.muted ? 'micOff' : 'mic'} s={18} /></button>
        <button className={'ico' + (live?.voice.deaf ? ' off' : '')} disabled={!live} aria-label="Kulaklık" title="Kulaklık" onClick={() => liveCall?.toggleDeaf()}><Icon n={live?.voice.deaf ? 'headOff' : 'head'} s={18} /></button>
        <button className="ico" aria-label="Ayarlar" title="Ayarlar" onClick={onSettings}><Icon n="gear" s={18} /></button>
      </footer>
    </aside>
  )
}

function openDm(uid: string, onOpen?: () => void) {
  app.go({kind: 'text', ch: dmId(app.me.uid, uid)})
  onOpen?.()
}

function Members({s, onOpen}: {s: Session; onOpen?: () => void}) {
  const {online, offline} = people(s)
  return (
    <>
      <div className="sect">Çevrimiçi · {online.length}</div>
      {online.map(u => {
        const st = u.peerId ? s.stats.get(u.peerId) : undefined
        const p = u.peerId ? s.peers.get(u.peerId) : undefined
        return (
          <button className="member" key={u.key} disabled={u.key === 'me'} title={u.key === 'me' ? '' : 'Özel mesaj'} onClick={() => openDm(u.uid, onOpen)}>
            <Avatar uid={u.uid} name={u.name} s={30} />
            <span className="ell grow">{u.name}{u.key === 'me' ? ' (sen)' : ''}</span>
            {p?.voice.in && <Icon n="wave" s={14} />}
            {st?.rtt !== undefined && <span className="ping" title={st.relayed ? 'Aktarma sunucusu üzerinden' : 'Doğrudan bağlı'}>{Math.round(st.rtt)} ms</span>}
          </button>
        )
      })}
      {offline.length > 0 && <div className="sect">Çevrimdışı</div>}
      {offline.map(u => <button className="member off" key={u.uid} title="Özel mesaj" onClick={() => openDm(u.uid, onOpen)}><Avatar uid={u.uid} name={u.name} s={30} /><span className="ell">{u.name}</span></button>)}
    </>
  )
}

function SourcePicker() {
  const list = app.sourcePicker
  const [audio, setAudio] = useState(false)
  if (!list) return null
  const close = () => { app.sourcePicker = null; app.bump() }
  return (
    <Modal title="Ne paylaşılsın?" onClose={close}>
      <label className="check"><input type="checkbox" checked={audio} onChange={e => setAudio(e.target.checked)} /> Bilgisayarın sesini de paylaş</label>
      {audio && <p className="dim small">Windows tüm sesi yakalar. Arkadaşların kendi sesini yankı olarak duyarsa kapat.</p>}
      <div className="sources">
        {list.map(x => (
          <button key={x.id} onClick={async () => {
            close()
            await desktop()!.pickSource(x.id, audio)
            await app.liveCall()?.toggleScreen(audio).catch(() => app.showToast('Ekran paylaşılamadı'))
          }}><img src={x.thumb} alt="" /><span className="ell">{x.name}</span></button>
        ))}
      </div>
    </Modal>
  )
}

export function App() {
  useApp()
  const [modal, setModal] = useState<'add' | 'invite' | 'settings' | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)
  const unread = [...app.sessions.values()].reduce((n, x) => n + app.unreadGroup(x), 0)
  useEffect(() => { document.title = unread ? `(${unread}) Telsiz` : 'Telsiz' }, [unread])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  if (!app.me.name) return <NameStep />
  if (!app.groups.length) return (
    <div className="center"><div className="card wide">
      <h2>Selam {app.me.name}</h2>
      <GroupForm />
      <p className="dim small">Birinizin grup kurup davet linkini diğerlerine atması yeterli.</p>
    </div></div>
  )

  const s = app.session!
  const live = app.liveSession()
  const ring = app.ring
  const route = app.route
  const title = route.kind === 'voice' ? 'Telsiz odası'
    : isDm(route.ch) ? '@ ' + (s.view.people.get(dmPartner(route.ch, app.me.uid)) ?? [...s.peers.values()].find(p => p.uid === dmPartner(route.ch, app.me.uid))?.name ?? 'Özel sohbet')
    : '# ' + (s.view.channels.find(c => c.id === route.ch)?.title ?? 'genel')
  const alone = s.peers.size === 0

  return (
    <div className={'shell' + (drawer ? ' drawer' : '')}>
      <div className="scrim" onClick={() => setDrawer(false)} />
      <div className="left">
        <Rail onAdd={() => setModal('add')} />
        <Side s={s} onInvite={() => setModal('invite')} onSettings={() => setModal('settings')} onNavigate={() => setDrawer(false)} />
      </div>
      <main className="main">
        <header className="topbar">
          <button className="ico onlymobile" aria-label="Menü" onClick={() => setDrawer(true)}><Icon n="menu" /></button>
          {searching && app.route.kind === 'text'
            ? <input className="searchbox grow" autoFocus placeholder="Mesajlarda ara" value={app.search} aria-label="Mesajlarda ara" onChange={e => { app.search = e.target.value; app.bump() }} onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); app.search = ''; app.bump() } }} />
            : <strong className="ell grow">{title}</strong>}
          {app.route.kind === 'text' && <button className="ico" title="Ara" aria-label="Ara" onClick={() => { setSearching(!searching); app.search = ''; app.bump() }}><Icon n={searching ? 'x' : 'search'} /></button>}
          {app.route.kind === 'text' && !s.voice.in && <button className="ico" title="Sesli katıl" aria-label="Sesli katıl" onClick={() => void app.joinVoice()}><Icon n="wave" /></button>}
          {app.route.kind === 'text' && !s.voice.in && <button className="ico" title="Görüntülü katıl" aria-label="Görüntülü katıl" onClick={() => void app.joinVoice(true)}><Icon n="video" /></button>}
          <button className="ico" title="Davet et" aria-label="Davet et" onClick={() => setModal('invite')}><Icon n="link" /></button>
        </header>
        {!app.backupSaved && <button className="backupbar" onClick={() => setModal('settings')}>Yedek kodunu sakla, yoksa bu cihazı kaybedince gruplarına dönemezsin</button>}
        {app.update && <button className="updatebar" onClick={() => app.update?.run()}><Icon n="down" s={16} /> {app.update.label}</button>}
        {alone && (
          <div className="notice">{s.linkError ? 'Bir arkadaşınla bağlantı kurulamadı. Ayarlar > Gelişmiş bölümüne bak.' : 'Şu an grupta sadece sen varsın. Arkadaşların açınca kendiliğinden bağlanır, mesajlar da eşitlenir.'}</div>
        )}
        {live && app.route.kind === 'text' && (
          <button className="backtocall" onClick={() => { app.select(live.code); app.go({kind: 'voice'}) }}><Icon n="wave" s={16} /> Görüşmeye dön</button>
        )}
        {app.route.kind === 'text' ? <Chat key={s.code + app.route.ch} s={s} ch={app.route.ch} /> : <VoiceStage s={s} call={app.call!} />}
      </main>
      <aside className="right"><div className="scroll"><Members s={s} /></div></aside>

      {modal === 'add' && <Modal title="Grup ekle" onClose={() => setModal(null)}><GroupForm onDone={() => setModal(null)} /></Modal>}
      {modal === 'invite' && <Invite s={s} onClose={() => setModal(null)} />}
      {modal === 'settings' && <Settings s={s} onClose={() => setModal(null)} />}
      <SourcePicker />
      {ring && (
        <div className="ring" role="alert">
          <Icon n="bell" /><span className="grow"><b>{ring.name}</b> seni sese çağırıyor · {ring.title}</span>
          <button className="btn pri" onClick={() => { app.select(ring.code); app.ring = null; void app.joinVoice() }}>Katıl</button>
          <button className="ico" aria-label="Kapat" onClick={() => { app.ring = null; app.bump() }}><Icon n="x" /></button>
        </div>
      )}
      {app.toast && <div className="toast" role="status">{app.toast}</div>}
    </div>
  )
}
