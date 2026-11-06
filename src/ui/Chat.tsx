import {Fragment, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent} from 'react'
import {app} from '../lib/app'
import {dmPartner, isDm, MAX_TEXT} from '../lib/history'
import {saveBlob} from '../lib/native'
import type {Session} from '../lib/session'
import type {FileMeta, Msg} from '../lib/types'
import {colorFor, fmtDay, fmtSize, fmtTime, isImageUrl, linkify, previewKind} from '../lib/util'
import {Avatar} from './App'
import {Icon} from './Icon'

const EMOJI = ['👍', '😂', '🔥', '❤️', '💀', '😮', '🎯', '🇹🇷']

function FileCard({s, f, own}: {s: Session; f: FileMeta; own: boolean}) {
  const [url, setUrl] = useState<string | null>(null)
  const [big, setBig] = useState(false)
  const t = s.transfer(f)
  const kind = previewKind(f)
  useEffect(() => {
    let live = true
    s.fileUrl(f).then(u => { if (live) setUrl(u) })
    return () => { live = false }
  }, [s, f, t.status])

  const save = async () => {
    const b = await s.getBlob(f)
    if (!b) return void s.fetchFile(f)
    const note = await saveBlob(b, f.name, f.type).catch(() => 'Kaydedilemedi')
    if (note) app.showToast(note)
  }
  const pct = t.total ? Math.floor(t.got / t.total * 100) : 0
  const up = s.uploads.get(f.id)
  const status = url
    ? (up ? `Gönderiliyor %${Math.floor(up / f.size * 100)}` : own ? 'Gönderildi' : 'Hazır')
    : t.status === 'finding' ? 'Kaynak aranıyor…'
    : t.status === 'getting' ? `İniyor %${pct}`
    : t.status === 'missing' ? 'Dosya kimsede açık değil, sahibi girince iner'
    : 'İndirmek için dokun'

  return (
    <>
      {url && kind === 'image' && <button className="thumb" onClick={() => setBig(true)}><img src={url} alt={f.name} loading="lazy" /></button>}
      {url && kind === 'video' && <video className="thumb" src={url} controls playsInline preload="metadata" />}
      {url && kind === 'audio' && <audio src={url} controls preload="metadata" />}
      <div className="filecard">
        <Icon n="file" />
        <div className="grow ell">
          <div className="ell fname" title={f.name}>{f.name}</div>
          <div className="dim small">{fmtSize(f.size)} · {status}</div>
          {t.status === 'getting' && <div className="bar"><i style={{width: pct + '%'}} /></div>}
        </div>
        <button className="ico" aria-label="İndir" title="İndir" onClick={() => void save()}><Icon n="down" s={18} /></button>
      </div>
      {big && url && <div className="overlay" onClick={() => setBig(false)}><img className="lightbox" src={url} alt={f.name} /></div>}
    </>
  )
}

function Text({text}: {text: string}) {
  return <>{linkify(text).map((t, i) => t.url ? <a key={i} href={t.url} target="_blank" rel="noreferrer noopener">{t.text}</a> : <Fragment key={i}>{t.text}</Fragment>)}</>
}

// Link doğrudan bir resim ya da GIF ise mesajın içinde gösterilir.
function LinkedImages({text}: {text: string}) {
  const urls = linkify(text).flatMap(t => t.url && isImageUrl(t.url) ? [t.url] : [])
  return <>{urls.slice(0, 3).map(u => <a key={u} className="thumb" href={u} target="_blank" rel="noreferrer noopener"><img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" onError={e => { e.currentTarget.parentElement!.style.display = 'none' }} /></a>)}</>
}

function Recorder({onDone}: {onDone: (f: File) => void}) {
  const [secs, setSecs] = useState<number | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const send = useRef(false)
  const timer = useRef<ReturnType<typeof setInterval>>(undefined)

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}})
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t))
      const r = new MediaRecorder(stream, type ? {mimeType: type} : undefined)
      const parts: Blob[] = []
      r.ondataavailable = e => { if (e.data.size) parts.push(e.data) }
      r.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        clearInterval(timer.current)
        setSecs(null)
        if (!send.current || !parts.length) return
        const mime = r.mimeType.split(';')[0]
        const stamp = new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute: '2-digit'}).replace(':', '.')
        onDone(new File(parts, `ses-kaydi-${stamp}.${mime.includes('mp4') ? 'm4a' : mime.split('/')[1]}`, {type: mime}))
      }
      r.start()
      rec.current = r
      send.current = false
      setSecs(0)
      const t0 = Date.now()
      timer.current = setInterval(() => {
        const n = Math.floor((Date.now() - t0) / 1000)
        setSecs(n)
        if (n >= 300) stop(true)
      }, 500)
    } catch { app.showToast('Mikrofon açılamadı') }
  }
  const stop = (ok: boolean) => { send.current = ok; rec.current?.stop() }
  useEffect(() => () => { send.current = false; if (rec.current?.state === 'recording') rec.current.stop() }, [])

  if (secs === null) return <button className="ico" aria-label="Ses kaydet" title="Ses kaydet" onClick={() => void start()}><Icon n="mic" /></button>
  return (
    <div className="recbar" role="status">
      <span className="recdot" /> <b>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</b>
      <button className="ico" aria-label="Kaydı iptal et" onClick={() => stop(false)}><Icon n="x" /></button>
      <button className="ico send" aria-label="Kaydı gönder" onClick={() => stop(true)}><Icon n="send" /></button>
    </div>
  )
}

function Row({s, m, head, onReply}: {s: Session; m: Msg; head: boolean; onReply: () => void}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.text)
  const [picker, setPicker] = useState(false)
  const [sel, setSel] = useState(false)
  const own = m.uid === app.me.uid
  const re = m.re ? s.view.byId.get(m.re) : undefined
  const react = (emoji: string) => {
    const on = !(m.reacts[emoji] ?? []).includes(app.me.uid)
    s.emit({t: 'react', target: m.id, emoji, on} as never)
    setPicker(false)
  }
  const saveEdit = () => {
    const t = draft.trim()
    if (t && t !== m.text) s.emit({t: 'edit', target: m.id, text: t} as never)
    setEditing(false)
  }
  return (
    <div className={'msg' + (head ? ' head' : '') + (sel ? ' sel' : '')} onClick={e => {
      // Dokunmatik ekranda hover yok: araçlar mesaja dokununca açılır.
      if (matchMedia('(hover: none)').matches && !(e.target as HTMLElement).closest('a,button,video,audio,textarea')) setSel(!sel)
    }}>
      {head ? <Avatar uid={m.uid} name={m.name} s={38} /> : <span className="gutter">{fmtTime(m.ts)}</span>}
      <div className="body">
        {re && <div className="reline ell"><Icon n="reply" s={13} /> <b>{re.name}</b> {re.text || re.file?.name}</div>}
        {head && <div className="who"><b style={{color: colorFor(m.uid)}}>{m.name}</b><time>{fmtTime(m.ts)}</time></div>}
        {editing ? (
          <textarea autoFocus value={draft} maxLength={MAX_TEXT} rows={2} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() } if (e.key === 'Escape') setEditing(false) }} aria-label="Mesajı düzenle" />
        ) : m.text && <div className="txt"><Text text={m.text} />{m.edited && <span className="dim small"> (düzenlendi)</span>}</div>}
        {m.text && <LinkedImages text={m.text} />}
        {m.file && <FileCard s={s} f={m.file} own={own} />}
        {Object.keys(m.reacts).length > 0 && (
          <div className="reacts">
            {Object.entries(m.reacts).map(([e, who]) => (
              <button key={e} className={who.includes(app.me.uid) ? 'mine' : ''} onClick={() => react(e)}>{e} {who.length}</button>
            ))}
          </div>
        )}
      </div>
      <div className={'tools' + (picker ? ' open' : '')}>
        {picker && <div className="picker">{EMOJI.map(e => <button key={e} onClick={() => react(e)}>{e}</button>)}</div>}
        <button className="ico sm" aria-label="Tepki" onClick={() => setPicker(!picker)}><Icon n="smile" s={16} /></button>
        <button className="ico sm" aria-label="Yanıtla" onClick={onReply}><Icon n="reply" s={16} /></button>
        {own && m.text && <button className="ico sm" aria-label="Düzenle" onClick={() => { setDraft(m.text); setEditing(true) }}><Icon n="edit" s={16} /></button>}
        {own && <button className="ico sm" aria-label="Sil" onClick={() => { if (confirm('Bu mesaj herkesten silinsin mi?')) s.emit({t: 'del', target: m.id} as never) }}><Icon n="trash" s={16} /></button>}
      </div>
    </div>
  )
}

export function Chat({s, ch}: {s: Session; ch: string}) {
  const msgs = s.view.msgs.get(ch) ?? []
  const [text, setText] = useState('')
  const [reply, setReply] = useState<Msg | null>(null)
  const [drag, setDrag] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const lastTyping = useRef(0)
  const dm = isDm(ch)
  const partner = dm ? dmPartner(ch, app.me.uid) : ''
  const chTitle = dm ? (s.view.people.get(partner) ?? [...s.peers.values()].find(p => p.uid === partner)?.name ?? 'Özel sohbet') : s.view.channels.find(c => c.id === ch)?.title ?? 'genel'
  const lastOwn = msgs.findLastIndex(m => m.uid === app.me.uid)
  const seenBy = lastOwn < 0 ? [] : [...(s.seen.get(ch) ?? [])]
    .filter(([u, ts]) => u !== app.me.uid && ts >= msgs[lastOwn].ts)
    .map(([u]) => s.view.people.get(u) ?? [...s.peers.values()].find(p => p.uid === u)?.name ?? 'Biri')

  useLayoutEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight })
  useEffect(() => { app.markRead() }, [msgs.length])

  const send = () => {
    const t = text.trim()
    if (!t) return
    s.sendText(ch, t, reply?.id)
    setText(''); setReply(null)
    stick.current = true
    area.current?.focus()
  }
  const addFiles = (files: Iterable<File>) => {
    for (const f of files) s.sendFile(ch, f)
    stick.current = true
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
    if (e.key === 'Escape') setReply(null)
  }
  const onPaste = (e: ClipboardEvent) => { if (e.clipboardData.files.length) { e.preventDefault(); addFiles(e.clipboardData.files) } }
  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDrag(false)
    if (e.dataTransfer.files.length) return addFiles(e.dataTransfer.files)
    // Tarayıcıdan sürüklenen GIF dosya olarak değil adres olarak gelir.
    const url = e.dataTransfer.getData('text/uri-list').split('\n')[0].trim()
    if (url.startsWith('https://')) { s.sendText(ch, url); stick.current = true }
  }
  const typers = [...s.typing.values()].filter(t => t.ch === ch).map(t => t.name)

  return (
    <div className="chat" onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      <div className="log" ref={box} onScroll={e => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
        {msgs.length === 0 && <div className="empty"><h3>{dm ? '@' : '#'} {chTitle}</h3><p className="dim">{dm ? 'Bu sohbet sadece ikinizin cihazında durur, gruptaki diğerlerine gitmez.' : 'Henüz mesaj yok. İlkini sen yaz, dosya sürükle ya da yapıştır.'}</p></div>}
        {msgs.map((m, i) => {
          const p = msgs[i - 1]
          const newDay = !p || new Date(p.ts).toDateString() !== new Date(m.ts).toDateString()
          const head = newDay || !p || p.uid !== m.uid || m.ts - p.ts > 5 * 60_000 || !!m.re
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day"><span>{fmtDay(m.ts)}</span></div>}
              <Row s={s} m={m} head={head} onReply={() => { setReply(m); area.current?.focus() }} />
              {i === lastOwn && seenBy.length > 0 && <div className="seen">Görüldü: {seenBy.join(', ')}</div>}
            </Fragment>
          )
        })}
      </div>
      <div className="typing">{typers.length > 0 && `${typers.join(', ')} yazıyor…`}</div>
      {reply && <div className="replybar"><Icon n="reply" s={15} /><span className="ell grow"><b>{reply.name}</b> {reply.text || reply.file?.name}</span><button className="ico sm" aria-label="Yanıtı kaldır" onClick={() => setReply(null)}><Icon n="x" s={15} /></button></div>}
      <div className="composer">
        <input ref={fileInput} type="file" multiple hidden onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        <button className="ico" aria-label="Dosya ekle" title="Dosya ekle" onClick={() => fileInput.current?.click()}><Icon n="clip" /></button>
        <textarea ref={area} rows={1} value={text} maxLength={MAX_TEXT} placeholder={dm ? `${chTitle} kişisine yaz` : `#${chTitle} kanalına yaz`} aria-label="Mesaj"
          onChange={e => {
            setText(e.target.value)
            if (Date.now() - lastTyping.current > 2500) { lastTyping.current = Date.now(); s.sendTyping(ch) }
          }}
          onKeyDown={onKey} onPaste={onPaste} />
        {text.trim() ? <button className="ico send" aria-label="Gönder" onClick={send}><Icon n="send" /></button> : <Recorder onDone={f => addFiles([f])} />}
      </div>
      {drag && <div className="dropzone">Dosyayı bırak, gruba gönderelim</div>}
    </div>
  )
}
