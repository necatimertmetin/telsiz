import {useState} from 'react'
import {app} from '../lib/app'
import {canKick, isManager} from '../lib/history'
import type {Session} from '../lib/session'
import {Avatar} from './App'

type Who = {uid: string; name: string}

export function Roster({s, onClose}: {s: Session; onClose: () => void}) {
  const [kick, setKick] = useState<Who | null>(null)
  const [wipe, setWipe] = useState(false)
  const v = s.view, me = app.me.uid
  const online = new Set([me, ...[...s.peers.values()].map(p => p.uid), ...s.indirect().keys()])
  const all = new Map(v.people).set(me, app.me.name)
  for (const p of s.peers.values()) if (!all.has(p.uid)) all.set(p.uid, p.name)
  const list = [...all].filter(([uid]) => !v.banned.has(uid)).sort(([a], [b]) => +(b === v.owner) - +(a === v.owner))
  const gone = [...v.banned.keys()].map(uid => ({uid, name: v.people.get(uid) ?? 'Biri'}))
  const missing = kick ? list.filter(([uid]) => uid !== kick.uid && !online.has(uid)).map(([, name]) => name) : []

  return (
    <section className="roster">
      <h4>Üyeler</h4>
      {list.map(([uid, name]) => (
        <div className="rosterrow" key={uid}>
          <Avatar uid={uid} name={name} s={36} />
          <span className="who"><span className="ell">{name}{uid === me ? ' (sen)' : ''}</span><span className="dim small">{online.has(uid) ? 'Çevrimiçi' : 'Çevrimdışı'}</span></span>
          {uid === v.owner && <span className="role own">Kurucu</span>}
          {uid !== v.owner && me === v.owner && (
            <select aria-label={`${name} rolü`} value={v.admins.has(uid) ? 'admin' : 'member'} onChange={e => s.setRole(uid, e.target.value as 'admin' | 'member')}>
              <option value="admin">Yönetici</option>
              <option value="member">Üye</option>
            </select>
          )}
          {uid !== v.owner && me !== v.owner && v.admins.has(uid) && <span className="role">Yönetici</span>}
          {canKick(v, me, uid) && <button className="btn danger" onClick={() => { setWipe(false); setKick({uid, name}) }}>At</button>}
        </div>
      ))}

      {kick && (
        <div className="rosterask" role="alertdialog" aria-label="Üye atma onayı">
          <strong>Gruptan atılsın mı: {kick.name}</strong>
          <span className="dim small">Davet kodu değişir, eski link çalışmaz. Açık olanlar yeni odaya kendiliğinden geçer. Bu kişinin cihazındaki eski mesajlar silinemeyebilir.</span>
          {missing.length > 0 && <span className="warn small">{missing.join(', ')} çevrimdışı. Yeni linki sen göndermelisin.</span>}
          <div className="acts">
            <button className="btn" onClick={() => setKick(null)}>Vazgeç</button>
            <button className="btn danger" onClick={() => { const who = kick; setKick(null); void s.kick(who.uid) }}>Gruptan at</button>
          </div>
        </div>
      )}

      {isManager(v, me) && gone.length > 0 && <>
        <h4>Atılanlar</h4>
        {gone.map(u => (
          <div className="rosterrow" key={u.uid}>
            <Avatar uid={u.uid} name={u.name} s={36} />
            <span className="who"><span className="ell">{u.name}</span></span>
            <button className="btn" onClick={() => s.setRole(u.uid, 'member')}>Geri al</button>
          </div>
        ))}
        <p className="dim small">Geri alınan kişiye yeni davet linkini göndermen gerekir.</p>
      </>}

      {me === v.owner && <button className="btn danger" onClick={() => { setKick(null); setWipe(true) }}>Grubu sil</button>}
      {wipe && (
        <div className="rosterask" role="alertdialog" aria-label="Grup silme onayı">
          <strong>Grup silinsin mi: {v.title}</strong>
          <span className="dim small">Açık olan herkesin cihazından mesajlar ve dosyalar kalkar. Şu an kapalı cihazlar silmeyi kaçırabilir.</span>
          <div className="acts">
            <button className="btn" onClick={() => setWipe(false)}>Vazgeç</button>
            <button className="btn danger" onClick={() => { onClose(); void s.wipe() }}>Grubu sil</button>
          </div>
        </div>
      )}
    </section>
  )
}
