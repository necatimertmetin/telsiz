import {useEffect, useState, type ReactNode} from 'react'
import {app, applyText, applyTheme, DOODLES, doodleOf, fontLabel, FONTS, loadFontPreviews, SIZES, THEMES} from '../lib/app'
import {BADGES, faceUrl, LOOKS} from '../lib/faces'
import {desktop, saveBlob} from '../lib/native'
import type {Session} from '../lib/session'
import {colorFor, initials} from '../lib/util'
import {Avatar} from './App'
import {Icon} from './Icon'
import {Modal} from './Modal'
import {Roster} from './Roster'
import {csScore} from '../lib/cs'

async function pickAvatar(f: File) {
  const bmp = await createImageBitmap(f)
  const side = Math.min(bmp.width, bmp.height)
  const c = Object.assign(document.createElement('canvas'), {width: 96, height: 96})
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 96, 96)
  app.setProfile({avatar: c.toDataURL('image/jpeg', .8)})
}

const REL = 'https://github.com/necatimertmetin/telsiz/releases/latest/download'

const TABS = [
  {id: 'profil', name: 'Profil', icon: 'users', hint: 'Gruptakiler seni böyle görür.'},
  {id: 'grup', name: 'Grup', icon: 'chat', hint: 'Bu grubun adı ve maç hatırlatması.'},
  {id: 'uyeler', name: 'Üyeler ve yetkiler', icon: 'shield', hint: 'Gruptakiler, roller ve izinler.'},
  {id: 'ses', name: 'Ses ve görüntü', icon: 'mic', hint: 'Bu cihazın mikrofonu, hoparlörü ve kamerası.'},
  {id: 'oyun', name: 'Oyun', icon: 'game', hint: 'Oyun oynarken pingi ve ekranı koruyan ayarlar.'},
  {id: 'bildirim', name: 'Bildirimler', icon: 'bell', hint: 'Ne zaman ses çıksın.'},
  {id: 'gorunum', name: 'Görünüm', icon: 'palette', hint: 'Renkler sadece bu cihazda değişir.'},
  {id: 'yedek', name: 'Yedek ve cihaz', icon: 'down', hint: 'Yedek kodu, güncelleme ve bağlantı.'},
] as const
type Tab = typeof TABS[number]['id']

function Switch({title, hint, checked, onChange}: {title: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void}) {
  return (
    <label className="sw">
      <span><b>{title}</b>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}

// CS2 maç bilgisi: Valve'ın resmi Game State Integration dosyası oyunun cfg klasörüne yazılır.
// Oyunun kendisine dokunulmaz. Sadece Windows uygulamasında görünür.
const CS_FAIL = {steam: 'Steam bulunamadı.', cs2: 'CS2 kurulu bulunamadı.', write: 'Dosya yazılamadı, CS2 klasörüne izin yok.'}
function CsSetup() {
  const [set, setSet] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void desktop()?.csStatus?.().then(r => setSet(r.set)).catch(() => setSet(false)) }, [])
  const run = async () => {
    setBusy(true)
    const r = await desktop()!.csSetup!().catch(() => null)
    setBusy(false)
    if (!r) { setMsg('Kurulamadı.'); return }
    if (r.ok) { setSet(true); setMsg(r.existed ? 'Bağlantı yenilendi. CS2 açıksa yeniden başlat.' : 'Kuruldu. CS2 açıksa yeniden başlat.') } else setMsg(CS_FAIL[r.reason] ?? 'Kurulamadı.')
  }
  const status = app.cs ? `Bağlı: ${csScore(app.cs)}` : set ? 'Kurulu. Maça girince bilgi gelir.' : set === false ? 'Kurulu değil.' : ''
  return <>
    <h4>CS2 maç bilgisi</h4>
    <p className="dim small">Seste takımın, canın ve skor arkadaşlarının kutusunda görünür. Valve'ın resmi oyun durumu özelliği kullanılır, oyuna dokunulmaz.</p>
    <div className="row wrap">
      <button className="btn" disabled={busy} onClick={() => void run()}>{busy ? 'Kuruluyor…' : set ? 'CS2 bağlantısını yenile' : 'CS2 bağlantısını kur'}</button>
      <span className="dim small" role="status">{app.cs ? status : msg ?? status}</span>
    </div>
  </>
}

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width:700px)').matches

export function Settings({s, onClose}: {s: Session; onClose: () => void}) {
  const [tab, setTab] = useState<Tab | null>(() => narrow() ? null : 'profil')
  const [name, setName] = useState(app.me.name)
  const [title, setTitle] = useState(s.view.title)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [turn, setTurn] = useState(app.turn.raw)
  const [listening, setListening] = useState(false)
  const [restore, setRestore] = useState('')
  const [upMsg, setUpMsg] = useState<string | null>(null)
  const [upBusy, setUpBusy] = useState(false)
  const [ads, setAds] = useState<boolean | null>(null)
  useEffect(() => { void desktop()?.adblockOn?.().then(setAds) }, [])
  useEffect(() => { if (tab === 'gorunum') loadFontPreviews() }, [tab])
  const sched = s.view.sched ?? {days: [5, 6], time: '21:00', on: false}
  const setSched = (c: typeof sched) => s.emit({t: 'sched', ...c} as never)
  useEffect(() => {
    if (!listening) return
    const done = (vk: number, label: string) => { p.pttVk = vk; p.pttLabel = label; app.savePrefs(); app.applyPtt(); setListening(false) }
    const key = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); done(e.keyCode, e.key.length === 1 ? e.key.toLocaleUpperCase('tr-TR') : e.code) }
    const mouse = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) { e.preventDefault(); done(e.button === 3 ? 5 : 6, `Fare ${e.button + 1}`) } }
    addEventListener('keydown', key, true)
    addEventListener('mousedown', mouse, true)
    return () => { removeEventListener('keydown', key, true); removeEventListener('mousedown', mouse, true) }
  })
  const p = app.prefs
  const mine = app.profiles[app.me.uid] ?? {}
  const bg = mine.color ?? colorFor(app.me.uid)
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => { p[k] = v; app.savePrefs() }
  useEffect(() => { navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {}) }, [])

  const pick = (kind: MediaDeviceKind, label: string, value: string, change: (v: string) => void) => {
    const list = devices.filter(d => d.kind === kind && d.label)
    if (!list.length) return null
    return (
      <label className="field">{label}
        <select value={value} onChange={e => change(e.target.value)}>
          <option value="">Varsayılan</option>
          {list.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </label>
    )
  }
  const live = app.liveCall()
  // Seviye çubuğu sadece kişi konuşmaya başlayınca değil, sürekli güncellensin.
  const [, redraw] = useState(0)
  useEffect(() => {
    if (!live || tab !== 'ses') return
    const t = setInterval(() => redraw(x => x + 1), 150)
    return () => clearInterval(t)
  }, [live, tab])

  const pane = (): ReactNode => {
    switch (tab) {
      case 'profil': return <>
        <div className="profilerow">
          <Avatar uid={app.me.uid} name={app.me.name} s={72} />
          {!mine.avatar && mine.look !== 'badge' && mine.look !== 'letter' && <button className="btn" onClick={() => app.setProfile({seed: Math.floor(Math.random() * 100000)})}>Zarla, yenisi gelsin</button>}
          <label className="btn">Fotoğraf seç<input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pickAvatar(f); e.target.value = '' }} /></label>
          <input type="color" aria-label="Profil rengi" title="Profil rengi" value={app.profiles[app.me.uid]?.color ?? colorFor(app.me.uid)} onChange={e => app.setProfile({color: e.target.value})} />
          {app.profiles[app.me.uid]?.avatar && <button className="linkbtn" onClick={() => app.setProfile({avatar: undefined})}>Fotoğrafı kaldır</button>}
        </div>
        {mine.avatar && <p className="dim small">Fotoğraf seçili. Tarzlardan birini seçmek için fotoğrafı kaldır.</p>}
        <h4>Tarz</h4>
        <div className="looks" role="group" aria-label="Profil resmi tarzı">
          {LOOKS.map(l => (
            <button key={l.id} aria-pressed={!mine.avatar && (mine.look ?? 'monster') === l.id} onClick={() => app.setProfile({look: l.id, avatar: undefined})}>
              <img src={faceUrl(l.id, app.me.uid, mine.seed ?? 0, mine.icon ?? 0, bg, initials(app.me.name))} alt="" width="52" height="52" />{l.name}
            </button>
          ))}
        </div>
        {!mine.avatar && mine.look === 'badge' && <>
          <h4>Rozet</h4>
          <div className="looks icons" role="group" aria-label="Rozet ikonu">
            {BADGES.map((_, i) => (
              <button key={i} aria-label={`Rozet ${i + 1}`} aria-pressed={(mine.icon ?? 0) === i} onClick={() => app.setProfile({icon: i})}>
                <img src={faceUrl('badge', app.me.uid, 0, i, bg, '')} alt="" width="40" height="40" />
              </button>
            ))}
          </div>
        </>}
        <label className="field">Takma adın
          <input maxLength={32} value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== app.me.name) app.setName(name) }} />
        </label>
      </>
      case 'grup': return <>
        <label className="field">Grup adı
          <input maxLength={40} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { const t = title.trim(); if (t && t !== s.view.title) s.emit({t: 'group', title: t} as never) }} />
        </label>
        <h4>Maç hatırlatması</h4>
        <div className="days">
          {['Pz', 'Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct'].map((d, i) => (
            <button key={d} className={sched.days.includes(i) ? 'on' : ''} aria-pressed={sched.days.includes(i)} onClick={() => setSched({...sched, days: sched.days.includes(i) ? sched.days.filter(x => x !== i) : [...sched.days, i]})}>{d}</button>
          ))}
          <input type="time" value={sched.time} aria-label="Saat" onChange={e => setSched({...sched, time: e.target.value})} />
        </div>
        <Switch title="Gruptaki herkese hatırlat" hint="Seçili günlerde bu saatte, uygulama açıkken" checked={sched.on} onChange={on => setSched({...sched, on})} />
        <h4>Gruptan ayrıl</h4>
        <p className="dim small">Bu cihazdaki geçmiş silinir. Tekrar girmek için davet linki gerekir.</p>
        <div><button className="btn danger" onClick={() => void app.ask(`"${s.view.title}" grubundan çıkılsın mı? Bu cihazdaki geçmiş silinir.`, 'Gruptan çık').then(ok => { if (ok) { onClose(); void app.leaveGroup(s.code) } })}>Gruptan çık</button></div>
      </>
      case 'uyeler': return <Roster s={s} onClose={onClose} />
      case 'ses': return <>
        <div className="setgrid">
          {pick('audioinput', 'Mikrofon', p.micId, v => { void app.setMic(v) })}
          {pick('audiooutput', 'Hoparlör', p.speakerId, v => set('speakerId', v))}
          {pick('videoinput', 'Kamera', p.camId, v => set('camId', v))}
        </div>
        <label className="field">Ses eşiği: {p.gate === 0 ? 'kapalı' : p.gate}
          <input type="range" min="0" max="40" value={p.gate} onChange={e => set('gate', +e.target.value)} />
          {live && <div className="bar meter"><i style={{width: live.level + '%'}} /></div>}
          <span className="dim small">Bunun altındaki sesler gitmez. Klavye sesi geçiyorsa yükselt.{!live && ' Seviyeyi görmek için sese gir.'}</span>
        </label>
        <Switch title="Gürültü engelleme" hint="Fan ve uğultu gibi sabit sesleri keser" checked={p.noise} onChange={v => { set('noise', v); void live?.changeMic() }} />
        <Switch title="Bas-konuş" hint="Sadece tuşa basılıyken ses gider" checked={p.ptt} onChange={v => { set('ptt', v); app.applyPtt() }} />
        {p.ptt && (
          <div className="row">
            <button className="btn" onClick={() => setListening(true)}>{listening ? 'Bir tuşa bas…' : `Tuş: ${p.pttLabel}`}</button>
            <span className="dim small">{desktop()?.setPtt ? 'Oyun açıkken de çalışır. Fare yan tuşları da olur.' : 'Tarayıcıda sadece pencere açıkken çalışır. Oyunda için Windows uygulamasını kullan.'}</span>
          </div>
        )}
      </>
      case 'oyun': return <>
        <Switch title="Oyun modu" hint="Oyunun pingi için kamera ve dosya yüklemesi kısılır, otomatik indirme kapanır" checked={p.gameMode} onChange={v => set('gameMode', v)} />
        {desktop()?.setOverlay && <Switch title="Oyunun üstünde konuşanlar" hint='Oyun "pencereli tam ekran" olmalı' checked={p.overlay} onChange={v => set('overlay', v)} />}
        <h4>Kısayollar</h4>
        {desktop()
          ? <div className="permrow"><span>Mikrofon aç/kapa</span><b>Ctrl+Shift+M</b></div>
          : <p className="dim small">Oyundayken kısayolla mikrofonu kapatmak ve bas-konuş için Windows uygulamasını kullan.</p>}
        {desktop() && <div className="permrow"><span>Kulaklık aç/kapa</span><b>Ctrl+Shift+D</b></div>}
        <div className="permrow"><span>Bas-konuş</span><b>{p.ptt ? p.pttLabel : 'Kapalı'}</b></div>
        {desktop()?.csSetup && <CsSetup />}
      </>
      case 'bildirim': return <>
        <Switch title="Bildirim sesleri" hint="Mesaj, çağrı ve sese giriş-çıkış" checked={p.sounds} onChange={v => set('sounds', v)} />
        <Switch title="Arkadaşların ses efektleri" hint="Ses odasında çalınan efektleri duy" checked={p.sfx} onChange={v => set('sfx', v)} />
      </>
      case 'gorunum': return <>
        <h4>Arayüz</h4>
        <div className="days sizes" role="group" aria-label="Arayüz">
          {([['frekans', 'Frekans'], ['klasik', 'Klasik']] as const).map(([v, n]) => <button key={v} className={p.ui === v ? 'on' : ''} aria-pressed={p.ui === v} onClick={() => set('ui', v)}>{n}</button>)}
        </div>
        <p className="dim small">Frekans yeni görünüm. Telefonda ve dar pencerede bölümler alt sekmelerde.</p>
        <h4>Tema</h4>
        <div className="themes" role="group" aria-label="Tema">
          {THEMES.map(t => (
            <button key={t.id} aria-pressed={p.theme === t.id} onClick={() => { set('theme', t.id); applyTheme(t.id, p.doodle) }}>
              <i style={{background: t.bg}}><b style={{background: t.card}} /><b style={{background: t.card}} /><em style={{background: t.acc}} /></i>
              {t.name}
            </button>
          ))}
        </div>
        <h4>Yazı boyutu</h4>
        <div className="days sizes" role="group" aria-label="Yazı boyutu">
          {SIZES.map(z => <button key={z.v} className={p.size === z.v ? 'on' : ''} aria-pressed={p.size === z.v} onClick={() => { set('size', z.v); applyText(p.font, z.v) }}>{z.name}</button>)}
        </div>
        <h4>Yazı tipi</h4>
        <div className="fonts" role="group" aria-label="Yazı tipi">
          {FONTS.map(x => (
            <button key={x.id} aria-pressed={p.font === x.id} onClick={() => { set('font', x.id); applyText(x.id, p.size) }}>
              <b style={{fontFamily: `${x.css},system-ui,sans-serif`}}>{fontLabel(x.name)}</b>
              {x.name !== fontLabel(x.name) && <small className="dim">{x.name.slice(fontLabel(x.name).length + 2, -1)}</small>}
            </button>
          ))}
        </div>
        <h4>Sohbet arka planı</h4>
        <div className="doodles" role="group" aria-label="Sohbet arka planı">
          {DOODLES.map(d => (
            <button key={d.id} aria-pressed={doodleOf(p.doodle) === d.id} onClick={() => { set('doodle', d.id); applyTheme(p.theme, d.id) }}>
              <i className={'doodleprev ' + d.id} data-off={d.id === 'off' || undefined} />
              {d.name}
            </button>
          ))}
        </div>
      </>
      case 'yedek': return <>
        <h4>Yedek kodu</h4>
        <p className="dim small">Hesap yok, kimliğin ve grupların bu cihazda duruyor. Bu kodu sakla: başka cihazda ya da veriler silinince yapıştırıp aynı isim ve gruplarla dönersin, eski mesajlar arkadaşlarından iner. Kodu alan gruplarına girer, kimseyle paylaşma.</p>
        <code className="code small">{app.backupCode()}</code>
        <div className="row wrap">
          <button className="btn pri" onClick={async () => {
            try { await navigator.clipboard.writeText(app.backupCode()); app.markBackupSaved(); app.showToast('Yedek kodu kopyalandı') } catch { app.showToast('Kopyalanamadı, kodu elle seç') }
          }}>Kopyala</button>
          <button className="btn" onClick={() => { void saveBlob(new Blob([app.backupCode()], {type: 'text/plain'}), 'telsiz-yedek.txt', 'text/plain').then(n => { app.markBackupSaved(); if (n) app.showToast(n) }) }}>Dosya olarak indir</button>
        </div>
        <details>
          <summary>Başka cihazdan geri yükle</summary>
          <input placeholder="Yedek kodunu yapıştır" value={restore} onChange={e => setRestore(e.target.value)} aria-label="Yedek kodu" />
          <button className="btn" disabled={!restore.trim()} onClick={() => { if (!app.importBackup(restore)) app.showToast('Yedek kodu geçersiz') }}>Geri yükle</button>
        </details>

        {!desktop() && !window.Capacitor && <>
          <h4>Uygulamalar</h4>
          <div className="row wrap">
            <a className="btn" href={`${REL}/Telsiz-Kurulum.exe`}>Windows</a>
            <a className="btn" href={`${REL}/Telsiz.apk`}>Android</a>
          </div>
          <p className="dim small">Windows uygulamasında oyundayken kısayolla mikrofon kapanır. iPhone'da Safari'de aç, Paylaş &gt; Ana Ekrana Ekle.</p>
        </>}

        {desktop()?.setAdblock && ads !== null && <Switch title="YouTube reklamlarını engelle (deneysel)" hint="Sadece bu bilgisayarda. YouTube engeli fark edip videoyu durdurursa kapat." checked={ads} onChange={async v => {
          setAds(v)
          if (!await desktop()!.setAdblock!(v)) { setAds(!v); app.showToast('Reklam engeli açılamadı') } else app.showToast(v ? 'Reklam engeli açık, videoyu yeniden aç' : 'Reklam engeli kapandı')
        }} />}

        {(desktop() || window.Capacitor) && <>
          <h4>Güncelleme</h4>
          <div>
            {app.update
              ? <button className="btn pri" onClick={() => app.update?.run()}>{app.update.label}</button>
              : <button className="btn" disabled={upBusy} onClick={async () => { setUpBusy(true); setUpMsg(await app.checkUpdateNow()); setUpBusy(false) }}>{upBusy ? 'Denetleniyor…' : 'Güncellemeleri denetle'}</button>}
          </div>
          {upMsg && <p className="dim small" role="status">{upMsg}</p>}
        </>}

        <details>
          <summary>Gelişmiş: bağlantı sorunu</summary>
          <p className="dim small">Birine bağlanamıyorsan operatörün doğrudan bağlantıyı engelliyor olabilir. Ücretsiz bir TURN hesabının bilgilerini JSON olarak buraya yapıştır. Bilgi sadece bu cihazda kalır, grupta bir kişinin girmesi çoğu zaman yeter.</p>
          <textarea rows={3} spellCheck={false} value={turn} placeholder='{"urls":"turn:...","username":"...","credential":"..."}' onChange={e => setTurn(e.target.value)} aria-label="TURN ayarı" />
          <button className="btn" onClick={() => { app.saveTurn(turn); location.reload() }}>Kaydet ve yeniden başlat</button>
        </details>
      </>
      default: return null
    }
  }

  const cur = TABS.find(t => t.id === tab)
  return (
    <Modal title="Ayarlar" onClose={onClose} wide>
      <div className={'setwrap' + (tab ? '' : ' list')}>
        <nav className="setnav" role="tablist" aria-label="Ayar bölümleri" aria-orientation="vertical">
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              <Icon n={t.icon} s={18} />{t.name}<span className="navgo"><Icon n="right" s={16} /></span>
            </button>
          ))}
        </nav>
        {cur && (
          <section className="setpane" role="tabpanel" aria-label={cur.name} key={cur.id}>
            <button className="setback" onClick={() => setTab(null)}><Icon n="back" s={16} />Ayarlar</button>
            <header><h3>{cur.name}</h3><p className="dim small">{cur.hint}</p></header>
            {pane()}
          </section>
        )}
      </div>
    </Modal>
  )
}
