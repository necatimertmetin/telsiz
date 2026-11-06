import {useEffect, useState} from 'react'
import {app} from '../lib/app'
import {desktop, saveBlob} from '../lib/native'
import type {Session} from '../lib/session'
import {colorFor} from '../lib/util'
import {Avatar} from './App'
import {Modal} from './Modal'

async function pickAvatar(f: File) {
  const bmp = await createImageBitmap(f)
  const side = Math.min(bmp.width, bmp.height)
  const c = Object.assign(document.createElement('canvas'), {width: 96, height: 96})
  c.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 96, 96)
  app.setProfile({avatar: c.toDataURL('image/jpeg', .8)})
}

const REL = 'https://github.com/necatimertmetin/telsiz/releases/latest/download'

export function Settings({s, onClose}: {s: Session; onClose: () => void}) {
  const [name, setName] = useState(app.me.name)
  const [title, setTitle] = useState(s.view.title)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [turn, setTurn] = useState(app.turn.raw)
  const [listening, setListening] = useState(false)
  const [restore, setRestore] = useState('')
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
  useEffect(() => { navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {}) }, [])

  const pick = (kind: MediaDeviceKind, label: string, value: string, set: (v: string) => void) => {
    const list = devices.filter(d => d.kind === kind && d.label)
    if (!list.length) return null
    return (
      <label className="field">{label}
        <select value={value} onChange={e => set(e.target.value)}>
          <option value="">Varsayılan</option>
          {list.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      </label>
    )
  }
  const live = app.liveCall()

  return (
    <Modal title="Ayarlar" onClose={onClose}>
      <label className="field">Takma adın
        <input maxLength={32} value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name !== app.me.name) app.setName(name) }} />
      </label>
      <div className="row">
        <Avatar uid={app.me.uid} name={app.me.name} s={52} />
        <label className="btn">Fotoğraf seç<input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pickAvatar(f); e.target.value = '' }} /></label>
        <input type="color" aria-label="Profil rengi" value={app.profiles[app.me.uid]?.color ?? colorFor(app.me.uid)} onChange={e => app.setProfile({color: e.target.value})} />
        {app.profiles[app.me.uid]?.avatar && <button className="linkbtn" onClick={() => app.setProfile({avatar: undefined})}>Kaldır</button>}
      </div>
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
      <label className="check"><input type="checkbox" checked={sched.on} onChange={e => setSched({...sched, on: e.target.checked})} /> Gruptaki herkese hatırlat (uygulama açıkken)</label>

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

      <h4>Ses ve görüntü</h4>
      {pick('audioinput', 'Mikrofon', p.micId, v => { p.micId = v; app.savePrefs(); void live?.changeMic() })}
      {pick('audiooutput', 'Hoparlör', p.speakerId, v => { p.speakerId = v; app.savePrefs() })}
      {pick('videoinput', 'Kamera', p.camId, v => { p.camId = v; app.savePrefs() })}
      <label className="field">Ses eşiği: {p.gate === 0 ? 'kapalı' : p.gate}
        <input type="range" min="0" max="40" value={p.gate} onChange={e => { p.gate = +e.target.value; app.savePrefs() }} />
        {live && <div className="bar meter"><i style={{width: live.level + '%'}} /></div>}
        <span className="dim small">Bunun altındaki sesler gitmez. Klavye sesi geçiyorsa yükselt.</span>
      </label>
      <label className="check"><input type="checkbox" checked={p.noise} onChange={e => { p.noise = e.target.checked; app.savePrefs(); void live?.changeMic() }} /> Gürültü engelleme</label>
      <label className="check"><input type="checkbox" checked={p.gameMode} onChange={e => { p.gameMode = e.target.checked; app.savePrefs() }} /> Oyun modu: oyunun pingi için kamera ve dosya yüklemesi kısılır, otomatik indirme kapanır</label>
      {desktop()?.setOverlay && <label className="check"><input type="checkbox" checked={p.overlay} onChange={e => { p.overlay = e.target.checked; app.savePrefs() }} /> Oyunun üstünde konuşanları göster (oyun "pencereli tam ekran" olmalı)</label>}
      <label className="check"><input type="checkbox" checked={p.sfx} onChange={e => { p.sfx = e.target.checked; app.savePrefs() }} /> Arkadaşların ses efektlerini duy</label>
      <label className="check"><input type="checkbox" checked={p.sounds} onChange={e => { p.sounds = e.target.checked; app.savePrefs() }} /> Bildirim sesleri</label>
      <label className="check"><input type="checkbox" checked={p.ptt} onChange={e => { p.ptt = e.target.checked; app.savePrefs(); app.applyPtt() }} /> Bas-konuş: sadece tuşa basılıyken ses gitsin</label>
      {p.ptt && (
        <div className="row">
          <button className="btn" onClick={() => setListening(true)}>{listening ? 'Bir tuşa bas…' : `Tuş: ${p.pttLabel}`}</button>
          <span className="dim small">{desktop()?.setPtt ? 'Oyun açıkken de çalışır. Fare yan tuşları da olur.' : 'Tarayıcıda sadece pencere açıkken çalışır. Oyunda için Windows uygulamasını kullan.'}</span>
        </div>
      )}
      {desktop() && <p className="dim small">Oyundayken: Ctrl+Shift+M mikrofon, Ctrl+Shift+D kulaklık.</p>}

      {!desktop() && !window.Capacitor && (
        <>
          <h4>Uygulamalar</h4>
          <div className="row wrap">
            <a className="btn" href={`${REL}/Telsiz-Kurulum.exe`}>Windows</a>
            <a className="btn" href={`${REL}/Telsiz.apk`}>Android</a>
          </div>
          <p className="dim small">Windows uygulamasında oyundayken kısayolla mikrofon kapanır. iPhone'da Safari'de aç, Paylaş &gt; Ana Ekrana Ekle.</p>
        </>
      )}

      <details>
        <summary>Gelişmiş: bağlantı sorunu</summary>
        <p className="dim small">Birine bağlanamıyorsan operatörün doğrudan bağlantıyı engelliyor olabilir. Ücretsiz bir TURN hesabının bilgilerini JSON olarak buraya yapıştır. Bilgi sadece bu cihazda kalır, grupta bir kişinin girmesi çoğu zaman yeter.</p>
        <textarea rows={3} spellCheck={false} value={turn} placeholder='{"urls":"turn:...","username":"...","credential":"..."}' onChange={e => setTurn(e.target.value)} aria-label="TURN ayarı" />
        <button className="btn" onClick={() => { app.saveTurn(turn); location.reload() }}>Kaydet ve yeniden başlat</button>
      </details>

      <button className="btn danger" onClick={() => { if (confirm(`"${s.view.title}" grubundan çıkılsın mı? Bu cihazdaki geçmiş silinir.`)) { onClose(); void app.leaveGroup(s.code) } }}>Gruptan çık</button>
    </Modal>
  )
}
