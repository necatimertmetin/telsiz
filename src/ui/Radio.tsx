import {useEffect, useState} from 'react'
import {app} from '../lib/app'
import {can} from '../lib/history'
import {radio, searchStations, type Found} from '../lib/radio'
import type {Session} from '../lib/session'
import type {VRoom} from '../lib/types'
import {Icon} from './Icon'

// Radyo odası: çalan istasyon herkeste aynı, yayın her cihaza doğrudan gelir.
export function RadioPanel({s, room}: {s: Session; room: VRoom}) {
  const [adding, setAdding] = useState(false)
  const inRoom = s.voice.in && (s.voice.room ?? '') === room.id
  const now = s.view.stations.find(x => x.id === room.sid)
  const mayAdd = can(s.view, app.me.uid, 'radio')
  const failed = !!now && radio.failed === now.url
  useEffect(() => {
    radio.onChange = app.bump
    return () => { radio.onChange = undefined }
  }, [])

  return (
    <div className="radio">
      <section className="radionow">
        {now ? <>
          <span className={'live' + (inRoom && radio.playing ? ' on' : '')}><i />{inRoom ? radio.playing ? 'ÇALIYOR' : failed ? 'AÇILAMADI' : 'BAĞLANIYOR' : 'ODADA ÇALAN'}</span>
          <h2>{now.title}</h2>
          {inRoom && radio.title && <p className="radiosong" title={radio.title}><Icon n="sfx" s={16} /><span className="ell">{radio.title}</span></p>}
          <p className="dim">{room.tunedBy ? `${room.tunedBy} seçti. ` : ''}Herkes aynı yayını kendi cihazında dinliyor.</p>
          {failed && <p className="warn small">Bu yayın şu an açılmıyor. Listeden başka bir istasyon seç.</p>}
          {inRoom && !radio.playing && !failed && <button className="btn" onClick={() => radio.retry()}><Icon n="play" s={16} /> Çal</button>}
        </> : <>
          <h2>Henüz istasyon seçilmedi</h2>
          <p className="dim">{s.view.stations.length ? 'Listeden birine bas, odadaki herkeste o çalar.' : mayAdd ? 'Önce grubun radyolarına bir istasyon ekle.' : 'Grubun radyo listesi boş. Yöneticiler istasyon ekleyebilir.'}</p>
        </>}
        <label className="radiovol">
          <span>Radyo sesi <b>%{Math.round(app.prefs.radioVol * 100)}</b></span>
          <input type="range" min={0} max={1} step={.05} value={app.prefs.radioVol} onChange={e => { app.prefs.radioVol = +e.target.value; app.savePrefs() }} />
        </label>
        <label className="check"><input type="checkbox" checked={app.prefs.radioBg} onChange={e => { app.prefs.radioBg = e.target.checked; app.savePrefs() }} /> Başka odaya geçince arkada kısık çalsın</label>
        {!inRoom && <button className="btn pri" onClick={() => void (s.voice.in ? app.enterRoom(room.id) : app.joinVoice(false, false, room.id))}><Icon n="radio" s={18} /> Odaya gir ve dinle</button>}
      </section>
      <section className="stations">
        <div className="sect">Grubun radyoları</div>
        {s.view.stations.map(st => (
          <div className={'strow' + (st.id === room.sid ? ' on' : '')} key={st.id}>
            <button className="stbtn" onClick={() => { s.tune(room.id, st.id); if (inRoom) radio.retry() }}><span className="ell">{st.title}</span><span className="dim small">{st.tag}</span></button>
            {mayAdd && <button className="ico sm" aria-label={`${st.title} listeden çıkar`} title="Listeden çıkar" onClick={() => s.dropStation(st)}><Icon n="x" s={14} /></button>}
          </div>
        ))}
        {mayAdd && (adding ? <StationSearch s={s} onClose={() => setAdding(false)} /> : <button className="btn" onClick={() => setAdding(true)}><Icon n="plus" s={16} /> Radyo ekle</button>)}
      </section>
    </div>
  )
}

function StationSearch({s, onClose}: {s: Session; onClose: () => void}) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<Found[] | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      setErr(false)
      searchStations(q).then(r => { if (live) setList(r) }).catch(() => { if (live) { setList([]); setErr(true) } })
    }, q ? 400 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [q])
  const have = new Set(s.view.stations.map(x => x.url))
  return (
    <div className="stsearch">
      <div className="row">
        <input autoFocus placeholder="İstasyon ara (boşsa Türkiye'nin sevilenleri)" value={q} onChange={e => setQ(e.target.value)} aria-label="İstasyon ara" />
        <button className="ico" aria-label="Aramayı kapat" onClick={onClose}><Icon n="x" s={16} /></button>
      </div>
      {list === null && <p className="dim small">Aranıyor...</p>}
      {err && <p className="warn small">Radyo listesine ulaşılamadı.</p>}
      {list?.length === 0 && !err && <p className="dim small">Çalınabilir yayın bulunamadı.</p>}
      {list?.map(f => (
        <div className="strow" key={f.url}>
          <span className="stbtn"><span className="ell">{f.title}</span><span className="dim small">{f.tag}</span></span>
          <button className="btn" disabled={have.has(f.url)} onClick={() => s.addStation(f)}>{have.has(f.url) ? 'Ekli' : 'Ekle'}</button>
        </div>
      ))}
    </div>
  )
}
