import {useEffect, useState} from 'react'
import {app} from '../lib/app'
import {desktop} from '../lib/native'
import type {Session} from '../lib/session'
import {Modal} from './Modal'

const REL = 'https://github.com/necatimertmetin/telsiz/releases/latest/download'

export function Settings({s, onClose}: {s: Session; onClose: () => void}) {
  const [name, setName] = useState(app.me.name)
  const [title, setTitle] = useState(s.view.title)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [turn, setTurn] = useState(app.turn.raw)
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
      <label className="field">Grup adı
        <input maxLength={40} value={title} onChange={e => setTitle(e.target.value)} onBlur={() => { const t = title.trim(); if (t && t !== s.view.title) s.emit({t: 'group', title: t} as never) }} />
      </label>

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
      <label className="check"><input type="checkbox" checked={p.gameMode} onChange={e => { p.gameMode = e.target.checked; app.savePrefs() }} /> Oyun modu: dosya yüklemesi 1 MB/sn ile sınırlı, otomatik indirme kapalı</label>
      <label className="check"><input type="checkbox" checked={p.sounds} onChange={e => { p.sounds = e.target.checked; app.savePrefs() }} /> Bildirim sesleri</label>
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
