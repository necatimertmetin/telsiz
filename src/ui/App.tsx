import {useEffect, useState, type DragEvent, type FormEvent} from 'react'
import {faceUrl} from '../lib/faces'
import {app, useApp} from '../lib/app'
import {radio} from '../lib/radio'
import {RadioPanel} from './Radio'
import type {Session} from '../lib/session'
import {can, dmId, isManager, dmOthers, isDm, MAIN_ROOM, roleName, roomChat} from '../lib/history'
import type {RoomKind, VoiceState} from '../lib/types'
import {desktop} from '../lib/native'
import {colorFor, initials, parseInvite} from '../lib/util'
import {Chat} from './Chat'
import {Icon} from './Icon'
import {Modal} from './Modal'
import {Settings} from './Settings'
import {MiniCall, pipMedia, VoiceStage} from './Voice'
import {Frekans} from './Frekans'
import {syncTitlebar} from '../lib/titlebar'

export const PUBLIC_URL = 'https://necatimertmetin.github.io/telsiz/'

export function Avatar({uid, name, on, s = 34}: {uid: string; name: string; on?: boolean; s?: number}) {
  const p = app.profiles[uid]
  return (
    <span className={'av' + (on ? ' talk' : '')} style={{background: p?.color ?? colorFor(uid), width: s, height: s, fontSize: s * .44}}>
      <img src={p?.avatar ?? faceUrl(p?.look ?? 'monster', uid, p?.seed ?? 0, p?.icon ?? 0, p?.color ?? colorFor(uid), initials(name))} alt="" />
    </span>
  )
}

export function chatName(s: Session, ch: string) {
  const n = (u: string) => s.view.people.get(u) ?? [...s.peers.values()].find(p => p.uid === u)?.name ?? 'Biri'
  return dmOthers(ch, app.me.uid).map(n).join(', ')
}

function NewPrivate({s, onClose}: {s: Session; onClose: () => void}) {
  const [picked, setPicked] = useState<string[]>([])
  const {online, offline} = people(s)
  const list = [...online.filter(u => u.key !== 'me'), ...offline]
  return (
    <Modal title="Özel sohbet kur" onClose={onClose}>
      <p className="dim small">Seçtiğin kişilerle ayrı sohbet. Mesajlar sadece bu kişilerin cihazına gider, gruptaki diğerleri görmez.</p>
      {list.length === 0 && <p className="dim">Henüz seçilecek kimse yok.</p>}
      {list.map(u => (
        <label className="check" key={u.uid}><input type="checkbox" checked={picked.includes(u.uid)} onChange={e => setPicked(e.target.checked ? [...picked, u.uid] : picked.filter(x => x !== u.uid))} /> {u.name}</label>
      ))}
      <button className="btn pri" disabled={!picked.length} onClick={() => { app.go({kind: 'text', ch: dmId(app.me.uid, ...picked)}); onClose() }}>Sohbeti aç</button>
    </Modal>
  )
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
        <p className="dim">{/\/ses$/.test(location.hash) ? 'Arkadaşların sesli sohbette. İsmini yaz, direkt yanlarına bağlanırsın.' : 'Hesap yok, şifre yok. Arkadaşların seni tanısın diye bir isim yaz, yeter.'}</p>
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

export const KIND_ICON: Record<RoomKind, string> = {voice: 'wave', music: 'sfx', radio: 'radio'}
const KIND_NAME: [RoomKind, string][] = [['voice', 'Ses'], ['music', 'Müzik'], ['radio', 'Radyo']]
const KIND_HELP: Record<RoomKind, string> = {
  voice: 'Konuşma odası. Sadece bu odadakiler birbirini duyar.',
  music: 'YouTube linkleri sıraya girer, odadakiler aynı anda dinler.',
  radio: 'Odadakiler grubun radyolarından birini birlikte dinler. Yayın herkesin cihazına doğrudan gelir.',
}

function NewRoom({s, onClose}: {s: Session; onClose: () => void}) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<RoomKind>('voice')
  return (
    <Modal title="Oda kur" onClose={onClose}>
      <form className="col" onSubmit={e => {
        e.preventDefault()
        const rid = s.makeRoom(title.trim() || KIND_NAME.find(n => n[0] === kind)![1], kind)
        onClose()
        void app.enterRoom(rid)
      }}>
        <label className="lbl" htmlFor="roomname">Oda adı</label>
        <input id="roomname" autoFocus maxLength={40} placeholder="ör. Takım 3" value={title} onChange={e => setTitle(e.target.value)} />
        <span className="lbl">Oda türü</span>
        <div className="kinds" role="radiogroup" aria-label="Oda türü">
          {KIND_NAME.map(([k, n]) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}><Icon n={KIND_ICON[k]} /> {n}</button>
          ))}
        </div>
        <p className="dim small">{KIND_HELP[kind]}</p>
        <button className="btn pri">Odayı kur</button>
      </form>
    </Modal>
  )
}

// Yönetici (ya da kurucu) çevrimiçi birini sol taraftaki bir ses odasına sürükler: sesteyse oraya geçer, değilse çağrı alır.
export const DRAG = 'application/x-telsiz-uid'
export function dragProps(s: Session, uid: string, name: string, inVoice: boolean) {
  if (uid === app.me.uid || !isManager(s.view, app.me.uid)) return {}
  return {draggable: true, onDragStart: (e: DragEvent) => { e.dataTransfer.setData(DRAG, JSON.stringify({uid, name, inVoice})); e.dataTransfer.effectAllowed = 'move' }}
}

export type VUser = {id: string; uid: string; name: string; v: VoiceState}

// Ses odaları ve içindekiler: klasik yan menü ve Frekans kadranı aynı listeyi kullanır.
export function roomRows(s: Session, onNavigate: () => void) {
  const all: VUser[] = [
    ...(s.voice.in ? [{id: 'me', uid: app.me.uid, name: app.me.name, v: s.voice}] : []),
    ...[...s.peers].filter(([, p]) => p.voice.in).map(([id, p]) => ({id, uid: p.uid, name: p.name, v: p.voice})),
    ...[...s.indirect().values()].filter(u => u.voice.in).map(u => ({id: 'r:' + u.uid, uid: u.uid, name: u.name, v: u.voice})),
  ]
  const known = new Set(s.view.rooms.map(r => r.id))
  const rooms = [{id: '', title: MAIN_ROOM, kind: 'voice' as RoomKind, sid: undefined as string | undefined}, ...s.view.rooms]
  return rooms.map(r => {
    // Henüz bilinmeyen odadaki kişi ana odada gösterilir.
    const users = all.filter(u => (known.has(u.v.room ?? '') ? u.v.room ?? '' : '') === r.id)
    const n = app.unread(s, roomChat(r.id))
    // Radyo odasında istasyon seçiliyse ve biri dinliyorsa (ya da sen arkada dinliyorsan) satır çalıyor görünür.
    const station = r.kind === 'radio' ? s.view.stations.find(x => x.id === r.sid) : undefined
    const bgHere = !!station && app.radioBg?.code === s.code && app.radioBg.sid === station.id && radio.playing
    const onAir = !!station && (users.length > 0 || bgHere)
    const mine = s.voice.in && (s.voice.room ?? '') === r.id
    const playing = onAir ? ((mine || bgHere) && radio.title ? radio.title : station!.title) : null
    const open = () => {
      // Seste başka odadaysan radyo odasına tıklamak seni taşımaz, radyoyu olduğun yerden açar.
      if (r.kind === 'radio' && s.voice.in && !mine) { app.peekRadio(r.id); onNavigate(); return }
      void app.enterRoom(r.id); onNavigate()
    }
    return {r, users, n, onAir, mine, playing, open}
  })
}

// Yönetici birini odaya bıraktığında.
export function useRoomDrop(s: Session) {
  const [over, setOver] = useState<string | null>(null)
  const props = (r: {id: string; title: string}) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(r.id) } },
    onDragLeave: () => setOver(o => o === r.id ? null : o),
    onDrop: (e: DragEvent) => {
      setOver(null)
      const raw = e.dataTransfer.getData(DRAG)
      if (!raw) return
      e.preventDefault()
      const u = JSON.parse(raw) as {uid: string; name: string; inVoice: boolean}
      s.sendMove({[u.uid]: r.id})
      app.showToast(u.inVoice ? `${u.name}, ${r.title} odasına alındı` : `${u.name}, ${r.title} odasına çağrıldı`)
    },
  })
  return {over, props}
}

function VoiceRooms({s, onNavigate, onNew}: {s: Session; onNavigate: () => void; onNew: () => void}) {
  const call = app.call!
  const here = app.route.kind === 'voice' ? app.shownRoom(s).id : null
  const {over, props} = useRoomDrop(s)
  return (
    <>
      <div className="sect"><span>Ses odaları{s.settling && <span className="seeking"> · bağlanıyor</span>}</span> {can(s.view, app.me.uid, 'rooms') && <button className="ico sm" aria-label="Oda kur" title="Oda kur" onClick={onNew}><Icon n="plus" s={15} /></button>}</div>
      {roomRows(s, onNavigate).map(({r, users, n, onAir, playing, open}) => {
        return (
          <div key={r.id}>
            <button className={'chan' + (here === r.id ? ' on' : '') + (over === r.id ? ' dropon' : '') + (onAir ? ' onair' : '')} onClick={open} {...props(r)}>
              {onAir ? <span className="eq" aria-label="Radyo çalıyor"><i /><i /><i /></span> : <Icon n={KIND_ICON[r.kind]} s={17} />}<span className="ell">{r.title}</span>{n > 0 && <span className="badge in">{n}</span>}{users.length > 0 && <span className="count">{users.length}</span>}
            </button>
            {playing && <button className="radiosub" onClick={() => app.peekRadio(r.id)} title="Radyoyu aç"><span className="ell">{playing}</span></button>}
            {users.map(u => (
              <div key={u.id} className="vuser" {...dragProps(s, u.uid, u.name, true)}>
                <Avatar uid={u.uid} name={u.name} s={22} on={call.speaking.has(u.id)} />
                <span className="ell">{u.name}</span>
                {u.v.muted && <Icon n="micOff" s={14} />}{u.v.cam && <Icon n="video" s={14} />}{u.v.screen && <Icon n="screen" s={14} />}{u.v.sAudio && <span title="Ekran sesi yayında" className="saudio"><Icon n="speaker" s={14} /></span>}
              </div>
            ))}
          </div>
        )
      })}
    </>
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

export function people(s: Session) {
  const seen = new Set<string>()
  const online: {key: string; uid: string; name: string; peerId?: string}[] = [{key: 'me', uid: app.me.uid, name: app.me.name}]
  seen.add(app.me.uid)
  for (const [peerId, p] of s.peers) if (!seen.has(p.uid)) { seen.add(p.uid); online.push({key: peerId, uid: p.uid, name: p.name, peerId}) }
  for (const uid of s.indirect().keys()) seen.add(uid)
  const offline = [...s.view.people].filter(([uid]) => !seen.has(uid) && !s.view.banned.has(uid)).map(([uid, name]) => ({uid, name}))
  return {online, offline}
}

function Side({s, onInvite, onSettings, onNavigate, onPrivate, onNewRoom}: {s: Session; onInvite: () => void; onSettings: () => void; onNavigate: () => void; onPrivate: () => void; onNewRoom: () => void}) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const dms = [...s.view.msgs.keys()].filter(isDm)
  const live = app.liveSession()
  const liveCall = app.liveCall()
  return (
    <aside className="side">
      <header className="sidehead">
        <strong className="ell">{s.view.title}</strong>
        <button className="invite" title="Arkadaş davet et" aria-label="Davet et" onClick={onInvite}><Icon n="userPlus" s={16} /> Davet</button>
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
        <div className="sect">Özel sohbetler <button className="ico sm" aria-label="Özel sohbet kur" title="Özel sohbet kur" onClick={onPrivate}><Icon n="plus" s={15} /></button></div>
        {dms.map(ch => {
          const uid = dmOthers(ch, app.me.uid)[0]
          const name = chatName(s, ch)
          const n = app.unread(s, ch)
          return (
            <button key={ch} className={'chan' + (app.route.kind === 'text' && app.route.ch === ch ? ' on' : '')} onClick={() => { app.go({kind: 'text', ch}); onNavigate() }}>
              <Avatar uid={uid} name={name} s={20} /><span className="ell">{name}</span>{n > 0 && <span className="badge in">{n}</span>}
            </button>
          )
        })}
        <VoiceRooms s={s} onNavigate={onNavigate} onNew={onNewRoom} />
        <div className="onlymobile"><Members s={s} onOpen={onNavigate} /></div>
      </div>
      <RadioBar />
      {live && liveCall && (
        <div className="livebar">
          <button className="livetxt" onClick={() => { app.select(live.code); app.go({kind: 'voice'}); onNavigate() }}><b>Seste</b><span className="ell">{live.view.title} · {app.roomOf(live, live.voice.room ?? '').title}</span></button>
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

// Seste başka odadayken arkada çalan radyo.
export function RadioBar() {
  const live = app.liveSession()
  if (!live || !app.radioBg || app.roomOf(live, live.voice.room ?? '').kind === 'radio') return null
  return (
    <div className="radiobar">
      <Icon n="radio" s={16} />
      <span className="livetxt"><b>Radyo arkada</b><span className="ell">{radio.title ?? live.view.stations.find(x => x.id === app.radioBg?.sid)?.title}</span></span>
      <input type="range" min={0} max={1} step={.01} value={app.prefs.radioVol} aria-label="Radyo sesi" title={`%${Math.round(app.prefs.radioVol * 100)}`} onChange={e => { app.prefs.radioVol = +e.target.value; app.savePrefs() }} />
      <button className="ico sm" aria-label="İstasyonu değiştir" title="İstasyonu değiştir" onClick={() => { if (app.radioBg) app.peekRadio(app.radioBg.rid) }}><Icon n="radio" s={15} /></button>
      <button className="ico sm" aria-label="Radyoyu kapat" title="Radyoyu kapat" onClick={() => app.stopRadioBg()}><Icon n="x" s={15} /></button>
    </div>
  )
}

// Yedek, güncelleme, bağlantı uyarıları: iki arayüzde de sahnenin üstünde.
export function Notices({s, onSettings}: {s: Session; onSettings: () => void}) {
  const alone = s.peers.size === 0 && !s.settling
  const offline = !navigator.onLine
  return (
    <>
      {!app.backupSaved && <button className="backupbar" onClick={onSettings}>Yedek kodunu sakla, yoksa bu cihazı kaybedince gruplarına dönemezsin</button>}
      {app.update && <button className="updatebar" onClick={() => app.update?.run()}><Icon n="down" s={16} /> {app.update.label}</button>}
      {offline && <div className="notice warn">İnternet bağlantın yok. Bağlanınca arkadaşların ve mesajlar kendiliğinden gelir.</div>}
      {!offline && s.settling && <div className="notice seekbar"><span className="spin" aria-hidden="true" />Arkadaşlarına bağlanılıyor</div>}
      {!offline && !s.relayOk && <div className="notice warn">Eşleşme sunucularına ulaşılamıyor. Bağlı olduğun arkadaşlarınla devam edebilirsin, yeni bağlantı kurulamaz.</div>}
      {app.rejoin === s.code && !s.voice.in && <button className="backtocall" onClick={() => { app.rejoin = null; app.go({kind: 'voice'}); void app.joinVoice() }}><Icon n="wave" s={16} /> Görüşmeden düştün, geri dön</button>}
      {alone && (
        <div className="notice">{s.linkError ? 'Bir arkadaşınla bağlantı kurulamadı. Ayarlar > Gelişmiş bölümüne bak.' : 'Şu an grupta sadece sen varsın. Arkadaşların açınca kendiliğinden bağlanır, mesajlar da eşitlenir.'}</div>
      )}
    </>
  )
}

export function openDm(uid: string, onOpen?: () => void) {
  app.go({kind: 'text', ch: dmId(app.me.uid, uid)})
  onOpen?.()
}

export function Members({s, onOpen}: {s: Session; onOpen?: () => void}) {
  const {online, offline} = people(s)
  return (
    <>
      <div className="sect">{s.settling ? <span>Çevrimiçi<span className="seeking"> · aranıyor</span></span> : `Çevrimiçi · ${online.length}`}</div>
      {online.map(u => {
        const st = u.peerId ? s.stats.get(u.peerId) : undefined
        const p = u.peerId ? s.peers.get(u.peerId) : undefined
        return (
          <button className="member" key={u.key} disabled={u.key === 'me'} title={u.key === 'me' ? '' : isManager(s.view, app.me.uid) ? 'Özel mesaj. Ses odasına almak için sürükle' : 'Özel mesaj'} onClick={() => openDm(u.uid, onOpen)} {...dragProps(s, u.uid, u.name, !!p?.voice.in)}>
            <Avatar uid={u.uid} name={u.name} s={30} />
            <span className="ell grow">{u.name}{u.key === 'me' ? ' (sen)' : ''}</span>
            {roleName(s.view, u.uid) && <span className="role">{roleName(s.view, u.uid)}</span>}
            {p?.voice.in && <Icon n="wave" s={14} />}
            {st?.rtt !== undefined && <span className="ping" title={st.relayed ? 'Aktarma sunucusu üzerinden' : 'Doğrudan bağlı'}>{Math.round(st.rtt)} ms</span>}
          </button>
        )
      })}
      {[...s.indirect().values()].map(u => (
        <button className="member warn" key={u.uid} title="Bu kişiyle doğrudan bağlantı kurulamadı" onClick={() => openDm(u.uid, onOpen)}>
          <Avatar uid={u.uid} name={u.name} s={30} /><span className="ell grow">{u.name}<small className="via">{u.via} üzerinden</small></span>
        </button>
      ))}
      {s.settling && <div className="member seekrow"><span className="spin" aria-hidden="true" />Arkadaşların aranıyor</div>}
      {offline.length > 0 && <div className="sect">{s.settling ? 'Henüz görünmeyenler' : 'Çevrimdışı'}</div>}
      {offline.map(u => <button className="member off" key={u.uid} title="Özel mesaj" onClick={() => openDm(u.uid, onOpen)}><Avatar uid={u.uid} name={u.name} s={30} /><span className="ell">{u.name}</span></button>)}
    </>
  )
}

function SourcePicker() {
  const list = app.sourcePicker
  const audio = app.prefs.shareAudio
  const setAudio = (v: boolean) => { app.prefs.shareAudio = v; app.savePrefs() }
  if (!list) return null
  const close = () => { app.sourcePicker = null; app.bump() }
  return (
    <Modal title="Ne paylaşılsın?" onClose={close}>
      <p>Bilgisayarın sesi de gitsin mi?</p>
      <div className="row">
        <button className={'btn' + (audio ? ' pri' : '')} aria-pressed={audio} onClick={() => setAudio(true)}>Sesli</button>
        <button className={'btn' + (audio ? '' : ' pri')} aria-pressed={!audio} onClick={() => setAudio(false)}>Sessiz</button>
      </div>
      {audio && <p className="dim small">Windows tüm sesi yakalar. Arkadaşların kendi sesini yankı olarak duyarsa Sessiz'e al.</p>}
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

// Windows uygulamasına küçültünce gösterilecek görüntü var mı diye söylenir (değişince bir kez).
let pipSent: boolean | null = null
function tellPip(on: boolean) {
  if (on === pipSent) return
  pipSent = on
  desktop()?.setPipAvail?.(on)
}

// Frekans şimdilik geniş ekranda; dar pencerede ve telefonda klasik görünüm kalır.
const WIDE = '(min-width: 900px)'
function useWide() {
  const [w, setW] = useState(() => matchMedia(WIDE).matches)
  useEffect(() => {
    const m = matchMedia(WIDE), f = () => setW(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return w
}

export type ModalKind = 'add' | 'invite' | 'settings' | 'private' | 'room'

export function App() {
  useApp()
  const [modal, setModal] = useState<'add' | 'invite' | 'settings' | 'private' | 'room' | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [searching, setSearching] = useState(false)
  const wide = useWide()
  useEffect(syncTitlebar)
  const unread = [...app.sessions.values()].reduce((n, x) => n + app.unreadGroup(x), 0)
  useEffect(() => { document.title = unread ? `(${unread}) Telsiz` : 'Telsiz' }, [unread])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    addEventListener('keydown', onKey)
    addEventListener('online', app.bump); addEventListener('offline', app.bump)
    return () => { removeEventListener('keydown', onKey); removeEventListener('online', app.bump); removeEventListener('offline', app.bump) }
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
  const title = route.kind === 'voice' ? app.shownRoom(s).title
    : isDm(route.ch) ? '@ ' + chatName(s, route.ch)
    : '# ' + (s.view.channels.find(c => c.id === route.ch)?.title ?? 'genel')
  const liveCall = app.liveCall()
  tellPip(!!(live && liveCall && pipMedia(live, liveCall)))
  if (app.pipMode && live && liveCall) return <div className="pipwin"><div className="wcostrip pipdrag" /><MiniCall s={live} call={liveCall} full /></div>

  const overlays = <>
      {app.radioPeek !== null && (() => {
        const r = s.view.rooms.find(x => x.id === app.radioPeek && x.kind === 'radio')
        return r && <Modal title={r.title} wide onClose={() => app.peekRadio(null)}><RadioPanel s={s} room={r} /></Modal>
      })()}
      {modal === 'add' && <Modal title="Grup ekle" onClose={() => setModal(null)}><GroupForm onDone={() => setModal(null)} /></Modal>}
      {modal === 'invite' && <Invite s={s} onClose={() => setModal(null)} />}
      {modal === 'settings' && <Settings s={s} onClose={() => setModal(null)} />}
      {modal === 'private' && <NewPrivate s={s} onClose={() => setModal(null)} />}
      {modal === 'room' && <NewRoom s={s} onClose={() => setModal(null)} />}
      <SourcePicker />
      {ring && (
        <div className="ring" role="alert">
          <Icon n="bell" /><span className="grow"><b>{ring.name}</b> {ring.text ?? 'seni sese çağırıyor'} · {ring.title}</span>
          <button className="btn pri" onClick={() => { app.select(ring.code); const room = ring.room ?? ''; app.ring = null; app.voiceRoom = room; void app.joinVoice(false, false, room) }}>Katıl</button>
          <button className="ico" aria-label="Kapat" onClick={() => { app.ring = null; app.bump() }}><Icon n="x" /></button>
        </div>
      )}
      {app.toast && <div className="toast" role="status">{app.toast}</div>}
  </>

  if (app.prefs.ui === 'frekans' && wide) return <Frekans s={s} onModal={setModal}>{overlays}</Frekans>

  return (
    <div className={'shell' + (drawer ? ' drawer' : '') + (app.prefs.hideSide ? ' noside' : '') + (app.prefs.hideMembers ? ' nomembers' : '')}>
      <div className="scrim" onClick={() => setDrawer(false)} />
      <div className="left">
        <Rail onAdd={() => setModal('add')} />
        <Side s={s} onInvite={() => setModal('invite')} onSettings={() => setModal('settings')} onNavigate={() => setDrawer(false)} onPrivate={() => setModal('private')} onNewRoom={() => setModal('room')} />
      </div>
      <main className="main">
        <header className="topbar">
          <button className="ico onlymobile" aria-label="Menü" onClick={() => setDrawer(true)}><Icon n="menu" /></button>
          <button className="ico onlywide" title={app.prefs.hideSide ? 'Kanalları göster' : 'Kanalları gizle'} aria-label={app.prefs.hideSide ? 'Kanalları göster' : 'Kanalları gizle'} aria-pressed={!app.prefs.hideSide} onClick={() => { app.prefs.hideSide = !app.prefs.hideSide; app.savePrefs() }}><Icon n="menu" /></button>
          {searching && app.route.kind === 'text'
            ? <input className="searchbox grow" autoFocus placeholder="Mesajlarda ara" value={app.search} aria-label="Mesajlarda ara" onChange={e => { app.search = e.target.value; app.bump() }} onKeyDown={e => { if (e.key === 'Escape') { setSearching(false); app.search = ''; app.bump() } }} />
            : <strong className="ell grow">{title}</strong>}
          {app.route.kind === 'text' && <button className="ico" title="Ara" aria-label="Ara" onClick={() => { setSearching(!searching); app.search = ''; app.bump() }}><Icon n={searching ? 'x' : 'search'} /></button>}
          {app.route.kind === 'text' && !s.voice.in && <button className="ico" title="Sesli katıl" aria-label="Sesli katıl" onClick={() => void app.joinVoice()}><Icon n="wave" /></button>}
          {app.route.kind === 'text' && !s.voice.in && <button className="ico" title="Görüntülü katıl" aria-label="Görüntülü katıl" onClick={() => void app.joinVoice(true)}><Icon n="video" /></button>}
          <button className="ico" title="Davet et" aria-label="Davet et" onClick={() => setModal('invite')}><Icon n="link" /></button>
          <button className="ico onlyxl" title={app.prefs.hideMembers ? 'Üyeleri göster' : 'Üyeleri gizle'} aria-label={app.prefs.hideMembers ? 'Üyeleri göster' : 'Üyeleri gizle'} aria-pressed={!app.prefs.hideMembers} onClick={() => { app.prefs.hideMembers = !app.prefs.hideMembers; app.savePrefs() }}><Icon n="users" /></button>
        </header>
        <Notices s={s} onSettings={() => setModal('settings')} />
        {app.route.kind === 'text' ? <Chat key={s.code + app.route.ch} s={s} ch={app.route.ch} /> : <VoiceStage s={s} call={app.call!} />}
        {live && app.liveCall() && (live !== s || app.route.kind === 'text') && <MiniCall s={live} call={app.liveCall()!} />}
      </main>
      <aside className="right"><div className="wcostrip" /><div className="scroll"><Members s={s} /></div></aside>
      {overlays}
    </div>
  )
}
